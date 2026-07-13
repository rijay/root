const assert = require("node:assert/strict");
const test = require("node:test");
const { runProductionRollbackDrill } = require("../src/productionRollbackDrill");

test("production rollback drill covers snapshots, deletes, cursor, idempotency, audit, and manual fallback", async () => {
  const report = await runProductionRollbackDrill({
    asOf: "2026-07-13",
    operatorId: "rollback-drill-test",
  });

  assert.equal(report.scope, "LOCAL_SIMULATION");
  assert.equal(report.syntheticDataOnly, true);
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.total, 9);
  assert.equal(report.summary.passed, 9);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.rollbackAuditCount, 6);
  assert.equal(report.checks.every((item) => item.status === "PASS"), true);
  assert.equal(report.manualFallbacks.length, 4);
});
