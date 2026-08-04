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
  "/api/v1/products",
  "/api/v1/order/match",
  "/api/v1/checkin/",
  "/api/v1/questionnaire",
  "/api/v1/refund/",
  "/api/v1/coupon/",
  "/api/v1/user/continue-daily",
  "/api/v1/daily/",
  "/api/v1/event/track",
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

function verifyFormalRouteSurface() {
  const startedAt = Date.now();
  const appSource = fs.readFileSync(path.join(projectRoot, "backend", "src", "app.js"), "utf8");
  const backendPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "backend", "package.json"), "utf8"));
  const missingRequiredRoutes = [
    "/api/v1/jobs/health-data-retention-cleanup",
  ].filter((route) => !appSource.includes(route));
  const remainingRetiredRoutes = [...RETIRED_JOB_ROUTES, ...RETIRED_ADMIN_ROUTES, ...RETIRED_USER_ROUTES, ...RETIRED_STATIC_ROUTES]
    .filter((route) => appSource.includes(route));
  const remainingCommands = RETIRED_PACKAGE_COMMANDS.filter((name) =>
    Object.prototype.hasOwnProperty.call(backendPackage.scripts || {}, name));

  const details = [];
  if (missingRequiredRoutes.length) details.push(`missing required routes: ${missingRequiredRoutes.join(", ")}`);
  if (remainingRetiredRoutes.length) details.push(`retired routes remain: ${remainingRetiredRoutes.join(", ")}`);
  if (remainingCommands.length) details.push(`retired commands remain: ${remainingCommands.join(", ")}`);
  return {
    label: "formal route surface",
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
    verifyFormalRouteSurface(),
    runCommand("backend tests", "npm", ["test", "--prefix", "backend"]),
    runCommand("miniprogram formal scope and performance", "npm", ["run", "check", "--prefix", "miniprogram"]),
    runCommand("admin checks", "npm", ["run", "check", "--prefix", "admin"]),
    runCommand("admin production build and performance gate", "npm", ["run", "build:verify", "--prefix", "admin"]),
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
