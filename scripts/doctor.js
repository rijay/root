#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const git = (...args) => {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (_) { return ""; }
};
let failures = 0;
function check(label, ok, action) {
  console.log(`[${ok ? "OK" : "FIX"}] ${label}${ok ? "" : `: ${action}`}`);
  if (!ok) failures += 1;
}

console.log(`Workspace: ${root}`);
console.log(`Git: ${git("branch", "--show-current") || "detached"} @ ${git("rev-parse", "--short", "HEAD") || "unavailable"}`);
check("Node 22 (same line as CI)", process.versions.node.split(".")[0] === "22", "nvm install && nvm use; see .nvmrc");
for (const [scope, dependency] of [["backend", "mysql2"], ["admin", "vite"]]) {
  let installed = true;
  try { require.resolve(dependency, { paths: [path.join(root, scope)] }); } catch (_) { installed = false; }
  check(`${scope} dependencies`, installed, `npm ci --prefix ${scope} --ignore-scripts`);
}
const packageVersion = readJson("miniprogram/package.json").version;
console.log(`Mini-program: ${packageVersion}; open ${path.join(root, "miniprogram")}`);
const status = git("status", "--porcelain");
console.log(`Local changes: ${status ? status.split("\n").length : 0} paths (preserve other tasks' changes)`);
const upstream = git("rev-parse", "--abbrev-ref", "@{upstream}");
console.log(`Upstream: ${upstream || "not configured; local checks do not establish remote CI"}`);
if (git("rev-parse", "--verify", "origin/main")) console.log(`Cached origin/main vs HEAD (behind / ahead): ${git("rev-list", "--left-right", "--count", "origin/main...HEAD")}; refresh remote evidence before handoff.`);
check("Admin source build", fs.existsSync(path.join(root, "admin/dist/index.html")), "npm run admin:build");
console.log("Local API: npm run dev:local (127.0.0.1:8787); Admin HMR: npm run dev:admin (127.0.0.1:5177/admin/)");
console.log("Port conflict: lsof -nP -iTCP:8787 -sTCP:LISTEN; inspect the existing task before stopping anything.");
console.log("Focused checks: npm run verify -- --only=backend,miniprogram,admin; local journey: npm run qa:local");
if (failures) process.exitCode = 1;
