const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const budgets = require("../config/performance-budgets.json");
const runtimeBudgets = require("../config/performance-runtime-budgets");
const projectConfig = require("../project.config.json");
const {
  buildPackageBudgetReport,
  evaluateMeasurementStatus,
  evaluateMetric,
} = require("../../scripts/miniprogram-performance-report");

assert.equal(budgets.schemaVersion, 1);
assert.equal(budgets.units.bytesPerKiB, 1024);
assert.equal(budgets.baseLibrary.minimum, "2.32.3");
assert.equal(budgets.baseLibrary.acceptanceStable, "3.15.2");
assert.equal(projectConfig.libVersion, budgets.baseLibrary.acceptanceStable);

assert.equal(budgets.packages.main.targetBytes, 1.3 * 1024 * 1024);
assert.equal(budgets.packages.main.hardLimitBytes, 1.5 * 1024 * 1024);
assert.equal(budgets.packages.singleSubpackage.hardLimitBytes, 1.2 * 1024 * 1024);
assert.equal(budgets.packages.total.hardLimitBytes, 8 * 1024 * 1024);
assert.equal(budgets.packages.mainLocalMedia.hardLimitBytes, 300 * 1024);
assert.equal(budgets.render.setData.singleUpdateHardLimitBytes, 64 * 1024);
assert.equal(budgets.render.nodes.pageHardLimit, 1200);
assert.equal(budgets.network.maxConcurrentRequests, 4);
assert.equal(budgets.network.readTimeoutMs, 8000);
assert.equal(budgets.network.writeTimeoutMs, 12000);
assert.equal(budgets.memory.androidStableTargetMiB, 120);
assert.equal(budgets.memory.androidPeakHardLimitMiB, 180);
assert.deepEqual(runtimeBudgets, {
  network: budgets.network,
  collection: budgets.collection,
});

assert.deepEqual(evaluateMetric(100, { target: 100, hardLimit: 120 }), {
  status: "PASS",
  value: 100,
  target: 100,
  hardLimit: 120,
});
assert.equal(evaluateMetric(110, { target: 100, hardLimit: 120 }).status, "WARN");
assert.equal(evaluateMetric(121, { target: 100, hardLimit: 120 }).status, "BLOCK");
assert.equal(evaluateMeasurementStatus([]), "BLOCKED_MISSING_SAMPLES");
assert.equal(
  evaluateMeasurementStatus([{ sampleCount: 29 }]),
  "BLOCKED_INSUFFICIENT_SAMPLES",
);
assert.equal(evaluateMeasurementStatus([{ sampleCount: 30 }]), "CANDIDATE_SAMPLES_READY");

const legacyReport = buildPackageBudgetReport({
  projectRoot,
  budgets,
  evidenceClass: "LEGACY_NON_FORMAL_BASELINE",
});
assert.equal(legacyReport.evidenceClass, "LEGACY_NON_FORMAL_BASELINE");
assert.equal(legacyReport.releaseGateEligible, false);
assert.equal(legacyReport.packageState, "LOCAL_SOURCE_ESTIMATE");
assert.ok(legacyReport.packages.main.bytes > 0);
assert.ok(legacyReport.packages.total.bytes >= legacyReport.packages.main.bytes);
assert.ok(Array.isArray(legacyReport.packages.subpackages));
assert.ok(legacyReport.warnings.includes("旧产品数据不得作为正式上线 Gate 通过证据"));
assert.notEqual(legacyReport.status, "BLOCK", "Bundled source exceeds a package or media hard limit; inspect miniprogram-performance-report.js output");

console.log("mini-program performance budget tests ok");
