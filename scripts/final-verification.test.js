const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseOptions, runCommand } = require("./final-verification");
const { spawn } = require("node:child_process");

test("verification retains complete failure logs and terminates hung stages", async (t) => {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-verification-test-"));
  t.after(() => fs.rmSync(logRoot, { recursive: true, force: true }));
  const failed = await runCommand({ id: "failure", label: "failure", command: process.execPath,
    args: ["-e", "console.error('original failure'); console.log('noise\\n'.repeat(15000)); process.exit(2)"] }, { logRoot });
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.exitCode, 2);
  assert.match(fs.readFileSync(failed.logPath, "utf8"), /original failure/);
  const hung = await runCommand({ id: "hung", label: "hung", command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"] }, { logRoot, timeoutMs: 100 });
  assert.equal(hung.status, "FAIL");
  assert.equal(hung.timedOut, true);
  assert.ok(hung.durationMs < 5000);
  const missing = await runCommand({ id: "missing", label: "missing", command: path.join(logRoot, "absent"), args: [] }, { logRoot });
  assert.equal(missing.status, "FAIL");
  assert.match(missing.error, /ENOENT/);
});

test("verification rejects typos instead of reporting an empty green run", () => {
  assert.throws(() => parseOptions(["--only=backed"]), /Unknown check/);
  assert.throws(() => parseOptions(["--timeout-ms=0"]), /positive integer/);
  assert.throws(() => parseOptions(["--bogus"]), /Unknown option/);
  assert.deepEqual([...parseOptions(["--only=backend,miniprogram"]).only], ["backend", "miniprogram"]);
});

test("timeout cleans a detached-stdio descendant even after its parent exits", { skip: process.platform === "win32" }, async (t) => {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-descendant-test-"));
  const marker = path.join(logRoot, "heartbeat");
  const pidFile = path.join(logRoot, "pid");
  t.after(() => {
    if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile)), "SIGKILL"); } catch (_) {} }
    fs.rmSync(logRoot, { recursive: true, force: true });
  });
  const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),20)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();setInterval(()=>{},1000)`;
  const result = await runCommand({ id: "descendant", label: "descendant", command: process.execPath, args: ["-e", parent] }, { logRoot, timeoutMs: 500 });
  assert.equal(result.timedOut, true);
  assert.ok(fs.existsSync(marker), "descendant ran before timeout");
  const size = fs.statSync(marker).size;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.statSync(marker).size, size, "descendant stopped writing after cleanup");
});

test("cancelling verification cleans the active stage", { skip: process.platform === "win32" }, async (t) => {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-interrupt-test-"));
  const pidFile = path.join(logRoot, "pid");
  const code = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const wrapperCode = `require(${JSON.stringify(require.resolve('./final-verification'))}).runCommand({id:'stage',label:'stage',command:process.execPath,args:['-e',${JSON.stringify(code)}]},{logRoot:${JSON.stringify(logRoot)}}).then(r=>process.exitCode=r.interrupted==='SIGINT'?130:1)`;
  const wrapper = spawn(process.execPath, ["-e", wrapperCode], { stdio: "ignore" });
  const closed = new Promise((resolve) => wrapper.once("close", (exitCode) => resolve(exitCode)));
  t.after(() => {
    wrapper.kill("SIGKILL");
    if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile)), "SIGKILL"); } catch (_) {} }
    fs.rmSync(logRoot, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(pidFile), "stage is running before interruption");
  const pid = Number(fs.readFileSync(pidFile));
  wrapper.kill("SIGINT");
  assert.equal(await closed, 130);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
