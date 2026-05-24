#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const backendDir = path.join(projectRoot, "backend");
const miniprogramDir = path.join(projectRoot, "miniprogram");

function collectFiles(dir, predicate, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, predicate, results);
      continue;
    }
    if (predicate(fullPath)) results.push(fullPath);
  }
  return results.sort();
}

function runCommand(label, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 12,
  });
  return {
    label,
    command: [command, ...args].join(" "),
    status: result.status === 0 ? "PASS" : "FAIL",
    code: result.status,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function syntaxCheck() {
  const files = [
    ...collectFiles(path.join(backendDir, "src"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(backendDir, "scripts"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(backendDir, "tests"), (file) => file.endsWith(".js")),
    path.join(backendDir, "public", "admin.js"),
  ];
  const failures = [];
  const startedAt = Date.now();
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failures.push({ file, stdout: result.stdout || "", stderr: result.stderr || "" });
    }
  }
  return {
    label: "JavaScript syntax check",
    command: `node --check (${files.length} files)`,
    status: failures.length ? "FAIL" : "PASS",
    code: failures.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    filesChecked: files.length,
    failures,
  };
}

function okPayload(payload) {
  if (!payload || payload.code !== 0) {
    throw new Error(payload && payload.message ? payload.message : "HTTP Interface 返回异常");
  }
  return payload.data;
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return response.json();
}

async function getJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  return response.json();
}

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function httpSmoke() {
  const startedAt = Date.now();
  const { createApp } = require(path.join(backendDir, "src", "app"));
  const { createSqliteStore } = require(path.join(backendDir, "src", "store"));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-final-verify-"));
  const sqliteFile = path.join(tempDir, "verify.sqlite");
  const storeAdapter = createSqliteStore(sqliteFile);
  const server = createApp({ storeAdapter, env: {} });
  const checks = [];

  try {
    const baseUrl = await listen(server);
    const health = okPayload(await getJson(baseUrl, "/health"));
    checks.push({ id: "health", status: health.service === "root-checkin" ? "PASS" : "FAIL" });

    const dashboard = okPayload(await getJson(baseUrl, "/api/v1/admin/dashboard"));
    checks.push({ id: "dashboard", status: dashboard.launchReadiness ? "PASS" : "FAIL" });

    const sampleText = [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOTVERIFY001,验收样本一,13800100001,ROOT 7日试饮装,199,已支付,已发货,上海市验收地址1",
      "YZROOTVERIFY002,验收样本二,13800100002,ROOT 7日试饮装,199,已支付,已签收,上海市验收地址2",
      "YZROOTVERIFY003,验收样本三,13800100003,ROOT 7日试饮装,199,已支付,运输中,上海市验收地址3",
    ].join("\n");
    const samplePreview = okPayload(await postJson(baseUrl, "/api/v1/admin/external-samples/preview", {
      sourceType: "YOUZAN_ORDER",
      text: sampleText,
    }));
    checks.push({ id: "sample_preview", status: samplePreview.review.decision_status === "READY" ? "PASS" : "FAIL" });

    const adapterFailure = await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "WECHAT_LEAD",
      adapterKind: "WEWORK_CONTACT",
      mode: "PREVIEW",
      limit: 1,
    });
    checks.push({ id: "adapter_failure_ledger", status: adapterFailure.code !== 0 ? "PASS" : "FAIL" });

    const adapters = okPayload(await getJson(baseUrl, "/api/v1/admin/external-adapters"));
    const latestFailure = (adapters.runs || []).find((run) => run.adapter_kind === "WEWORK_CONTACT" && run.status === "FAILED");
    checks.push({ id: "adapter_run_recorded", status: latestFailure ? "PASS" : "FAIL" });

    const releaseRecord = okPayload(await getJson(baseUrl, "/api/v1/admin/release-record?target=gray"));
    checks.push({ id: "release_record", status: releaseRecord.status === "BLOCKED" ? "PASS" : "FAIL" });

    const calibration = okPayload(await getJson(baseUrl, "/api/v1/admin/adapter-calibration"));
    checks.push({ id: "adapter_calibration", status: calibration.sources.length === 3 ? "PASS" : "FAIL" });

    const failed = checks.filter((check) => check.status !== "PASS");
    return {
      label: "HTTP Interface smoke",
      status: failed.length ? "FAIL" : "PASS",
      code: failed.length ? 1 : 0,
      durationMs: Date.now() - startedAt,
      baseUrl,
      storeAdapter: storeAdapter.kind,
      checks,
    };
  } finally {
    await closeServer(server);
    if (typeof storeAdapter.close === "function") storeAdapter.close();
  }
}

function summarize(results) {
  const failed = results.filter((item) => item.status !== "PASS");
  return {
    status: failed.length ? "FAIL" : "PASS",
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
  };
}

function printHumanReport(results) {
  const summary = summarize(results);
  process.stdout.write("# ROOT 最终开发验收\n\n");
  process.stdout.write(`状态：${summary.status}\n`);
  process.stdout.write(`通过：${summary.passed}/${summary.total}\n\n`);
  for (const item of results) {
    process.stdout.write(`## ${item.label}\n`);
    process.stdout.write(`- 状态：${item.status}\n`);
    process.stdout.write(`- 耗时：${item.durationMs}ms\n`);
    if (item.command) process.stdout.write(`- 命令：${item.command}\n`);
    if (item.filesChecked) process.stdout.write(`- 文件数：${item.filesChecked}\n`);
    if (item.checks) {
      for (const check of item.checks) {
        process.stdout.write(`- ${check.id}: ${check.status}\n`);
      }
    }
    if (item.status !== "PASS") {
      if (item.stdout) process.stdout.write(`\nstdout:\n${item.stdout}\n`);
      if (item.stderr) process.stdout.write(`\nstderr:\n${item.stderr}\n`);
      if (item.failures) process.stdout.write(`\nfailures:\n${JSON.stringify(item.failures, null, 2)}\n`);
    }
    process.stdout.write("\n");
  }
}

async function runFinalVerification() {
  const results = [
    syntaxCheck(),
    runCommand("Backend tests", "npm", ["test", "--prefix", backendDir]),
    runCommand("Mini-program validation", "npm", ["run", "check", "--prefix", miniprogramDir]),
    await httpSmoke(),
  ];
  return { summary: summarize(results), results };
}

async function main() {
  const json = process.argv.includes("--json");
  try {
    const report = await runFinalVerification();
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report.results);
    }
    process.exitCode = report.summary.status === "PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`最终验收失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  httpSmoke,
  runFinalVerification,
  syntaxCheck,
};
