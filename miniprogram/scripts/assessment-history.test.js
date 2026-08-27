const assert = require("node:assert/strict");
const {
  buildHistoryView,
  pairComparable,
  recentComparablePair,
  selectedRows,
  toggleSelection,
} = require("../utils/assessment-history");

function row(id, completedAt, overrides = {}) {
  return {
    assessmentId: id,
    assessmentType: "INITIAL",
    typeLabel: "初始评测",
    questionnaireId: "ROOT_INITIAL",
    questionnaireVersion: 1,
    versionText: "问卷 v1",
    status: "COMPLETED",
    completedAt,
    dimensions: [{ key: "state", score: 1 }],
    ...overrides,
  };
}

const rows = [
  row("initial-old", "2026-08-01T08:00:00.000Z"),
  row("gut-new", "2026-08-04T08:00:00.000Z", {
    assessmentType: "GUT_REGULARITY",
    typeLabel: "肠道规律自测",
    questionnaireId: "ROOT_GUT",
  }),
  row("initial-new", "2026-08-03T08:00:00.000Z"),
  row("initial-v2", "2026-08-05T08:00:00.000Z", { questionnaireVersion: 2, versionText: "问卷 v2" }),
];

assert.equal(pairComparable(rows[0], rows[2]), true);
assert.equal(pairComparable(rows[0], rows[1]), false);
assert.equal(pairComparable(rows[0], { ...rows[2], status: "SAFETY_STOPPED" }), false);
assert.deepEqual(recentComparablePair(rows).map((item) => item.assessmentId), ["initial-old", "initial-new"]);
assert.deepEqual(
  recentComparablePair([
    row("newer-from-server", "2026-08-03T08:00:00.000Z"),
    row("older-from-server", "2026-08-03T08:00:00.000Z"),
  ]).map((item) => item.assessmentId),
  ["older-from-server", "newer-from-server"],
);

const view = buildHistoryView(rows, "INITIAL", ["initial-old", "missing"]);
assert.deepEqual(view.selectedIds, ["initial-old"]);
assert.deepEqual(view.visibleAssessments.map((item) => item.assessmentId), ["initial-v2", "initial-new", "initial-old"]);
assert.deepEqual(view.recentPairIds, ["initial-old", "initial-new"]);
assert.equal(
  buildHistoryView(rows.map((item) => ({ ...item, dimensions: [] })), "ALL", []).recentPairText,
  "暂无可进行数值对比的同版记录",
);

assert.deepEqual(toggleSelection(["initial-old"], "initial-new"), {
  selectedIds: ["initial-old", "initial-new"],
  rejected: false,
});
assert.equal(toggleSelection(["initial-old", "initial-new"], "gut-new").rejected, true);
assert.deepEqual(selectedRows(rows, ["initial-new", "initial-old"]).map((item) => item.assessmentId), ["initial-old", "initial-new"]);

console.log("assessment history tests passed");
