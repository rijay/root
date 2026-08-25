const assert = require("node:assert/strict");
const {
  decorateAssessment,
  decorateCatalogItem,
  formatDate,
} = require("../utils/health-assessment");

assert.equal(formatDate(""), "");
assert.equal(formatDate("not-a-date"), "not-a-date");

const completed = decorateAssessment({
  assessmentId: "has_001",
  assessmentType: "INITIAL",
  questionnaireVersion: 3,
  status: "COMPLETED",
  result: { title: "近期状态结果", priorityAction: "先完成第一步。\n再观察第二步。" },
});
assert.equal(completed.typeLabel, "初始评测");
assert.equal(completed.versionText, "问卷 v3");
assert.equal(completed.resultTitle, "近期状态结果");
assert.deepEqual(completed.result.priorityActionItems, ["先完成第一步。", "再观察第二步。"]);
assert.equal(completed.safetyStopped, false);

const safetyStopped = decorateAssessment({
  assessmentType: "GUT_REGULARITY",
  status: "SAFETY_STOPPED",
});
assert.equal(safetyStopped.typeLabel, "肠道规律自测");
assert.equal(safetyStopped.safetyStopped, true);

const gated = decorateCatalogItem({
  assessmentType: "GUT_REGULARITY",
  available: false,
  unavailableReason: "CONTENT_REVIEW_PENDING",
});
assert.equal(gated.title, "肠道规律自测");
assert.equal(gated.unavailableText, "内容审核中");
assert.deepEqual(gated.definition, {});

const available = decorateCatalogItem({
  assessmentType: "INITIAL",
  available: true,
  definition: {
    title: "ROOT 初始评测",
    description: "建立可复测基线",
    estimatedMinutes: 4,
  },
  latest: completed,
  inProgress: {
    assessmentId: "has_draft",
    assessmentType: "INITIAL",
    questionnaireVersion: 3,
    status: "IN_PROGRESS",
  },
});
assert.equal(available.title, "ROOT 初始评测");
assert.equal(available.description, "建立可复测基线");
assert.equal(available.estimatedText, "约 4 分钟");
assert.equal(available.latest.resultTitle, "近期状态结果");
assert.equal(available.canResume, true);
assert.equal(available.inProgress.assessmentId, "has_draft");

console.log("health assessment tests ok");
