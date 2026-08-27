const assert = require("node:assert/strict");
const test = require("node:test");

const manifest = require("../data/health-advice-pool.v1.json");
const {
  GUT_RESULTS,
  INITIAL_RESULTS,
  REQUIRED_GUT_FIBER_ACTIONS,
} = require("../src/healthAdviceCatalog");
const {
  createHealthAdvicePool,
  defaultHealthAdvicePool,
} = require("../src/healthAdvicePool");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approvedManifest() {
  const approved = clone(manifest);
  approved.reviewStatus = "APPROVED";
  approved.reviewedAt = "2026-08-27T12:00:00.000Z";
  approved.reviewer = "health-content-reviewer-1";
  Object.values(approved.initialGroups).forEach((group) => {
    group.summaryReviewStatus = "APPROVED";
    group.actions.forEach((item) => { item.reviewStatus = "APPROVED"; });
  });
  Object.values(approved.gutGroups).forEach((group) => {
    group.summaryReviewStatus = "APPROVED";
    group.cautionReviewStatus = "APPROVED";
    group.actions.forEach((item) => { item.reviewStatus = "APPROVED"; });
  });
  approved.followUps.forEach((item) => { item.reviewStatus = "APPROVED"; });
  return approved;
}

test("checked-in suggestion pool contains 88 review components and remains disabled before human approval", () => {
  assert.equal(defaultHealthAdvicePool.structurallyValid, true);
  assert.equal(defaultHealthAdvicePool.configured, false);
  assert.equal(defaultHealthAdvicePool.expectedComponentCount, 88);
  assert.equal(defaultHealthAdvicePool.actualComponentCount, 88);
  assert.equal(defaultHealthAdvicePool.pendingReviewCount, 88);
  assert.equal(defaultHealthAdvicePool.combinationsPerScenario, 36);
  assert.equal(defaultHealthAdvicePool.totalScenarioCombinations, 1080);
});

test("approved pool builds all 30 assessment states with the fixed fiber action first", () => {
  const pool = createHealthAdvicePool(approvedManifest());
  assert.equal(pool.configured, true);
  for (const initialResultCode of Object.keys(INITIAL_RESULTS)) {
    for (const gutResultCode of Object.keys(GUT_RESULTS)) {
      const states = [
        { assessmentType: "INITIAL", assessmentId: `initial-${initialResultCode}`, resultCode: initialResultCode },
        { assessmentType: "GUT_REGULARITY", assessmentId: `gut-${gutResultCode}`, resultCode: gutResultCode },
      ];
      const first = pool.lookup(states);
      const second = pool.lookup(states);
      assert.deepEqual(second, first);
      assert.equal(first.advice.actions.length, 3);
      assert.equal(first.advice.actions[0], REQUIRED_GUT_FIBER_ACTIONS[gutResultCode]);
      assert.equal(first.advice.cautions.length, 1);
      assert.match(first.selection.initialActionId, new RegExp(`^${initialResultCode}-`));
      assert.match(first.selection.gutActionId, new RegExp(`^${gutResultCode}-`));
    }
  }
});

test("pool fails closed on changed fiber copy, duplicate suggestions or incomplete human review", () => {
  const changedFiber = approvedManifest();
  changedFiber.fixedFiberRules.HEALTHY.text = "被改写的纤维建议";
  assert.equal(createHealthAdvicePool(changedFiber).configured, false);
  assert.equal(createHealthAdvicePool(changedFiber).structurallyValid, false);

  const duplicate = approvedManifest();
  duplicate.initialGroups.BASELINE.actions[1].text = duplicate.initialGroups.BASELINE.actions[0].text;
  assert.equal(createHealthAdvicePool(duplicate).configured, false);
  assert.equal(createHealthAdvicePool(duplicate).structurallyValid, false);

  const pending = approvedManifest();
  pending.gutGroups.SENSITIVE.actions[0].reviewStatus = "PENDING_REVIEW";
  assert.equal(createHealthAdvicePool(pending).structurallyValid, true);
  assert.equal(createHealthAdvicePool(pending).configured, false);
  assert.equal(createHealthAdvicePool(pending).pendingReviewCount, 1);
});
