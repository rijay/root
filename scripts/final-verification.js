#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

function runCommand(label, command, args, cwd = projectRoot) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
  return {
    label,
    status: result.status === 0 ? "PASS" : "FAIL",
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function verifyFormalJobSurface() {
  const startedAt = Date.now();
  const appSource = fs.readFileSync(path.join(projectRoot, "backend", "src", "app.js"), "utf8");
  const backendPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "backend", "package.json"), "utf8"));
  const missingRequiredRoutes = [
    "/api/v1/jobs/health-data-retention-cleanup",
    "POST ${V1_RUNTIME_CYCLE_ROUTE}",
  ].filter((route) => !appSource.includes(route));
  const remainingRetiredRoutes = RETIRED_JOB_ROUTES.filter((route) => appSource.includes(route));
  const remainingCommands = RETIRED_PACKAGE_COMMANDS.filter((name) =>
    Object.prototype.hasOwnProperty.call(backendPackage.scripts || {}, name));

  const details = [];
  if (missingRequiredRoutes.length) details.push(`missing required routes: ${missingRequiredRoutes.join(", ")}`);
  if (remainingRetiredRoutes.length) details.push(`retired routes remain: ${remainingRetiredRoutes.join(", ")}`);
  if (remainingCommands.length) details.push(`retired commands remain: ${remainingCommands.join(", ")}`);
  return {
    label: "formal Job surface",
    status: details.length ? "FAIL" : "PASS",
    durationMs: Date.now() - startedAt,
    stdout: details.join("\n"),
    stderr: "",
  };
}

function tail(value, lineCount = 30) {
  return String(value || "").trim().split("\n").slice(-lineCount).join("\n");
}

function main() {
  const checks = [
    verifyFormalJobSurface(),
    runCommand("backend tests", "npm", ["test", "--prefix", "backend"]),
    runCommand("miniprogram formal scope and performance", "npm", ["run", "check", "--prefix", "miniprogram"]),
    runCommand("admin checks", "npm", ["run", "check", "--prefix", "admin"]),
    runCommand("admin production build", "npm", ["run", "build", "--prefix", "admin"]),
    runCommand("V1 route registry", "npm", ["run", "v1:routes:check"]),
  ];

  for (const check of checks) {
    console.log(`[${check.status}] ${check.label} (${check.durationMs}ms)`);
    if (check.status === "FAIL") {
      const evidence = [tail(check.stdout), tail(check.stderr)].filter(Boolean).join("\n");
      if (evidence) console.error(evidence);
    }
  }

  const failed = checks.filter((check) => check.status !== "PASS");
  console.log(`正式上线本地门禁：${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main();
