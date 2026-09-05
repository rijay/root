#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

const RETIRED_JOB_ROUTES = Object.freeze([
  "/api/v1/jobs/daily-audit",
  "/api/v1/jobs/checkin-reminders",
  "/api/v1/jobs/adapter-retry-due",
  "/api/v1/jobs/operational-alerts",
  "/api/v1/jobs/wework-touch-due",
  "/api/v1/jobs/lifecycle-settlement-due",
  "/api/v1/jobs/lifecycle-settlement-cleanup",
  "/api/v1/jobs/lifecycle-users-export",
  "/api/v1/jobs/lifecycle-user-exports-cleanup",
  "/api/v1/jobs/lifecycle-user-exports-delivery-retry",
  "/api/v1/jobs/youzan-identity-reconcile",
  "/api/v1/jobs/v1-runtime-cycle",
]);

const RETIRED_ADMIN_ROUTES = Object.freeze([
  "/api/v1/admin/lifecycle-settlement-jobs",
  "/api/v1/admin/lifecycle-settlement-jobs/create",
  "/api/v1/admin/lifecycle-settlement-jobs/run",
  "/api/v1/admin/lifecycle-settlement-jobs/cancel",
  "/api/v1/admin/lifecycle-settlement-jobs/retry-failed",
  "/api/v1/admin/lifecycle-users/settlement-batch-preview",
  "/api/v1/admin/lifecycle-users/settlement-batch-execute",
  "/api/v1/admin/settlement/preview",
  "/api/v1/admin/settlement/batch-preview",
  "/api/v1/admin/settlement/batch-execute",
  "/api/v1/admin/reward-delivery/execute",
  "/api/v1/admin/reward-delivery/status-query",
  "/api/v1/admin/config-workbench",
  "/api/v1/admin/campaigns/upsert",
  "/api/v1/admin/task-definitions/upsert",
  "/api/v1/admin/campaign-rules/publish",
  "/api/v1/admin/manual-reviews/batch-resolve",
  "/api/v1/admin/manual-reviews/",
  "/api/v1/admin/settlement-source-invalidations/",
  "/api/v1/admin/tasks",
  "/api/v1/admin/order-matching",
  "/api/v1/admin/order-after-sales",
  "/api/v1/admin/orders/",
  "/api/v1/admin/products/",
  "/api/v1/admin/refunds/",
  "/api/v1/admin/coupons/",
  "/api/v1/admin/dashboard",
  "/api/v1/admin/lifecycle-filter-presets",
  "/api/v1/admin/lifecycle-user-exports",
  "/api/v1/admin/lifecycle-users",
  "/api/v1/lifecycle-user-exports/",
  "/api/v1/admin/operational-analytics",
  "/api/v1/admin/operational-alert-rules",
  "/api/v1/admin/users/",
  "/api/v1/admin/consultation-",
  "/api/v1/admin/wework-touch-jobs",
  "/api/v1/admin/adapter-calibration",
  "/api/v1/admin/action-adapter-calibration",
  "/api/v1/admin/external-adapters",
  "/api/v1/admin/youzan-customers",
  "/api/v1/admin/external-samples",
  "/api/v1/admin/external-sample-reviews",
  "/api/v1/admin/imports",
  "/api/v1/admin/corrections",
  "/api/v1/admin/external-status-mappings",
  "/api/v1/admin/launch-readiness",
  "/api/v1/admin/release-evidence-pack",
  "/api/v1/admin/release-signoffs",
  "/api/v1/admin/admin-legacy-deprecation-decisions",
  "/api/v1/admin/production-cutover-proofs",
  "/api/v1/admin/root-member-center-jump-proofs",
]);

const RETIRED_USER_ROUTES = Object.freeze([
  "/api/v1/tasks/progress",
  "/api/v1/tasks/events",
  "/api/v1/settlement/status",
  "/api/v1/settlement/evaluate",
  "/api/v1/notifications/checkin-reminder-template",
  "/api/v1/notifications/subscriptions",
  "/api/v1/user/orders",
  "/api/v1/user/profile",
  "/api/v1/user/display-profile",
  "/api/v1/user/consultations",
  "/api/v1/campaigns/",
  "/api/v1/order/match",
  "/api/v1/checkin/",
  "/api/v1/questionnaire",
  "/api/v1/refund/",
  "/api/v1/coupon/",
  "/api/v1/user/continue-daily",
  "/api/v1/daily/",
  "/api/v1/upload/image",
]);

const RETIRED_STATIC_ROUTES = Object.freeze([
  "/admin-legacy",
  "/admin.css",
  "/admin.js",
]);

const RETIRED_PACKAGE_COMMANDS = Object.freeze([
  "adapter-retry",
  "checkin-reminders",
  "youzan-identity-reconcile",
  "lifecycle-user-exports-cleanup",
  "lifecycle-user-exports-delivery-retry",
  "lifecycle-users-export",
  "lifecycle-settlement-cleanup",
  "lifecycle-settlement",
  "operational-alerts",
  "wework-touch",
]);

const RETIRED_SOURCE_FILES = Object.freeze([
  "backend/src/rootMemberCenterReadiness.js",
  "miniprogram/utils/date-display.js",
  "miniprogram/utils/questionnaire-branching.js",
  "miniprogram/utils/task-presenter.js",
]);

function verifyFormalRouteSurface() {
  const startedAt = Date.now();
  const appSource = fs.readFileSync(path.join(projectRoot, "backend", "src", "app.js"), "utf8");
  const backendPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "backend", "package.json"), "utf8"));
  const missingRequiredRoutes = [
    "/api/v1/jobs/health-data-retention-cleanup",
    "/api/v1/products",
    "/api/v1/products/jump",
    "/api/v1/member-commerce/summary",
    "/api/v1/health/assessments/catalog",
    "/api/v1/health/assessments/history",
    "/api/v1/health/assessments/start",
    "/api/v1/health/assessments/compare",
    "/api/v1/operations/popup/claim",
    "/api/v1/operations/popup/action",
    "/api/v1/channels/attribution",
    "/api/v1/event/track",
  ].filter((route) => !appSource.includes(route));
  const remainingRetiredRoutes = [...RETIRED_JOB_ROUTES, ...RETIRED_ADMIN_ROUTES, ...RETIRED_USER_ROUTES, ...RETIRED_STATIC_ROUTES]
    .filter((route) => appSource.includes(route));
  const remainingCommands = RETIRED_PACKAGE_COMMANDS.filter((name) =>
    Object.prototype.hasOwnProperty.call(backendPackage.scripts || {}, name));
  const remainingRetiredFiles = RETIRED_SOURCE_FILES.filter((file) => fs.existsSync(path.join(projectRoot, file)));

  const details = [];
  if (missingRequiredRoutes.length) details.push(`missing required routes: ${missingRequiredRoutes.join(", ")}`);
  if (remainingRetiredRoutes.length) details.push(`retired routes remain: ${remainingRetiredRoutes.join(", ")}`);
  if (remainingCommands.length) details.push(`retired commands remain: ${remainingCommands.join(", ")}`);
  if (remainingRetiredFiles.length) details.push(`retired source files remain: ${remainingRetiredFiles.join(", ")}`);
  return {
    label: "formal route surface",
    status: details.length ? "FAIL" : "PASS",
    durationMs: Date.now() - startedAt,
    stdout: details.join("\n"),
    stderr: "",
  };
}

const CHECKS = Object.freeze([
  { id: "routes", label: "formal route surface" },
  { id: "backend", label: "backend tests", args: ["test", "--prefix", "backend"] },
  { id: "miniprogram", label: "miniprogram checks", args: ["run", "check", "--prefix", "miniprogram"] },
  { id: "admin", label: "admin checks", args: ["run", "check", "--prefix", "admin"] },
  { id: "build", label: "admin build and performance", args: ["run", "build:verify", "--prefix", "admin"] },
  { id: "tooling", label: "tooling and local QA", command: process.execPath,
    args: ["--test", "--test-reporter=spec", ...fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js")).sort().map((name) => `scripts/${name}`)] },
  { id: "evidence", label: "local evidence snapshot", args: ["run", "evidence:local:check"] },
]);

function parseOptions(args) {
  let only = CHECKS.map((check) => check.id);
  let timeoutMs = 180000;
  for (const arg of args) {
    if (arg === "--help") return { help: true };
    if (arg.startsWith("--only=")) only = arg.slice(7).split(",");
    else if (arg.startsWith("--timeout-ms=")) timeoutMs = Number(arg.slice(13));
    else throw new Error(`Unknown option: ${arg}. Run npm run verify -- --help`);
  }
  if (!only.length || only.some((id) => !CHECKS.some((check) => check.id === id))) throw new Error("Unknown check in --only");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer");
  return { only: new Set(only), timeoutMs };
}

function runCommand(check, { cwd = projectRoot, logRoot, timeoutMs = 180000 } = {}) {
  const startedAt = Date.now();
  const logPath = path.join(logRoot, `${check.id}.log`);
  const fd = fs.openSync(logPath, "w", 0o600);
  return new Promise((resolve) => {
    let tail = "", error = "", timedOut = false, interrupted = "", cleanup;
    const child = spawn(check.command || "npm", check.args, {
      cwd, env: process.env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk) => {
      fs.writeSync(fd, chunk);
      tail = (tail + chunk.toString()).slice(-65536);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const kill = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (failure) { if (failure.code !== "ESRCH") error = failure.message; }
    };
    const terminate = () => {
      if (cleanup) return;
      // Descendants may close stdio and outlive their parent; finish group cleanup independently.
      cleanup = new Promise((done) => setTimeout(() => { kill("SIGKILL"); done(); }, 1000));
      kill("SIGTERM");
    };
    const onInterrupt = () => { interrupted = "SIGINT"; terminate(); };
    const onTerminate = () => { interrupted = "SIGTERM"; terminate(); };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.on("error", (failure) => { error = failure.message; });
    child.on("close", async (exitCode, signal) => {
      clearTimeout(timer);
      if (cleanup) await cleanup;
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      fs.closeSync(fd);
      const failureLines = tail.split("\n").filter((line) => /not ok|error:|Error:|EPERM|EADDRINUSE|evidence stale/.test(line));
      resolve({ id: check.id, label: check.label, status: exitCode === 0 && !timedOut && !interrupted && !error ? "PASS" : "FAIL",
        durationMs: Date.now() - startedAt, exitCode, signal, timedOut, interrupted, error, logPath,
        details: failureLines.slice(0, 12).join("\n"),
        testSummary: tail.split("\n").filter((line) => /^(#|ℹ) (tests|suites|pass|fail|cancelled|skipped|todo) /.test(line)),
      });
    });
  });
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(`Usage: npm run verify -- [--only=${CHECKS.map((check) => check.id).join(",")}] [--timeout-ms=180000]`);
    console.log("Each stage writes a full log and a summary under .local-state/verification. Evidence requires a current admin build.");
    return;
  }
  const runRoot = path.join(projectRoot, ".local-state", "verification");
  fs.mkdirSync(runRoot, { recursive: true });
  const logRoot = fs.mkdtempSync(path.join(runRoot, "run-"));
  console.log(`Verification logs: ${logRoot}`);
  const results = [];
  for (const check of CHECKS.filter((item) => options.only.has(item.id))) {
    console.log(`[RUN] ${check.label}`);
    const result = check.id === "routes" ? { id: check.id, ...verifyFormalRouteSurface() }
      : await runCommand(check, { logRoot, timeoutMs: options.timeoutMs });
    results.push(result);
    fs.writeFileSync(path.join(logRoot, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`[${result.status}] ${result.label} (${result.durationMs}ms)`);
    if (result.testSummary?.length) console.log(result.testSummary.join("\n"));
    if (result.status === "FAIL") {
      if (result.timedOut) console.error(`Timed out after ${options.timeoutMs}ms; stage process group terminated.`);
      console.error(result.error || result.details || result.stdout || "See the complete stage log.");
      if (result.logPath) console.error(`Full log: ${result.logPath}`);
    }
    if (result.interrupted) { process.exitCode = result.interrupted === "SIGINT" ? 130 : 143; break; }
  }
  const passed = results.filter((result) => result.status === "PASS").length;
  console.log(`Local verification: ${passed}/${results.length} PASS (scope: ${[...options.only].join(",")})`);
  if (passed !== results.length && !process.exitCode) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { CHECKS, main, parseOptions, runCommand };
