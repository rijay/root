const assert = require("node:assert/strict");

const storage = new Map([
  ["ROOT_TOKEN", "local-test-token"],
  ["ROOT_LOCAL_USER_SCOPE_V060", "root-local-test"],
]);

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const local = require("../utils/local-health-assessment");
const { getLocalProduct, listLocalProducts } = require("../utils/local-product-catalog");
const { isConfiguredProductPath, mergeJumpTarget } = require("../utils/youzan-jump");

function firstAnswers(definition) {
  return definition.questions.reduce((answers, question) => {
    const first = question.options[0];
    answers[question.field] = question.type === "multi" ? [first.value] : first.value;
    return answers;
  }, {});
}

const products = listLocalProducts();
assert.equal(products.products.length, 2);
assert.equal(getLocalProduct("4749049439").youzan.path, "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1");
assert.equal(getLocalProduct("4875324599").youzan.path, "packages/goods/detail/index?alias=3f2cc448cksvnmk&shopAutoEnter=1");
products.products.forEach((product) => {
  assert.equal(isConfiguredProductPath(product.youzan.path), true);
  assert.equal(mergeJumpTarget(product).appId, "wxfb75c0b432670215");
});

const catalog = local.catalog();
assert.equal(catalog.storageMode, "LOCAL_DEVICE");
assert.deepEqual(catalog.assessments.map((item) => item.assessmentType), ["INITIAL", "GUT_REGULARITY"]);
assert.equal(local.DEFINITIONS.GUT_REGULARITY.questionnaireVersion, 2);
assert.equal(local.DEFINITIONS.GUT_REGULARITY.resultCopyVersion, 5);
assert.deepEqual(local.DEFINITIONS.GUT_REGULARITY.questions.map((item) => item.field), ["Q1", "Q2", "Q3", "Q4", "Q5"]);

const REQUIRED_GUT_PRIORITY_ACTIONS = Object.freeze({
  CONSTIPATION: "补充益生元纤维，帮助软化便便促蠕动",
  LOOSE: "补充可溶性纤维，帮助吸水让便便成形",
  ALTERNATING: "补充益生元纤维，双向调节排便节奏",
  SENSITIVE: "补充低FODMAP益生元，温和滋养不胀气",
  HEALTHY: "日常补充益生元，持续滋养肠道有益菌",
});

function assertRequiredGutPriorityAction(assessment) {
  const actions = assessment.result.priorityAction.split("\n").filter(Boolean);
  const expected = REQUIRED_GUT_PRIORITY_ACTIONS[assessment.result.resultCode];
  assert.equal(actions[0], expected);
  assert.equal(actions.filter((item) => item === expected).length, 1);
}

const healthyAnswers = { Q1: "A", Q2: "B", Q3: ["A"], Q4: ["A"], Q5: ["A"] };
const gutHealthy = local.start("GUT_REGULARITY").assessment;
assert.equal(local.saveDraft(gutHealthy.assessmentId, healthyAnswers).safetyTriggered, false);
const completedHealthy = local.complete(gutHealthy.assessmentId, healthyAnswers).assessment;
assert.equal(completedHealthy.status, "COMPLETED");
assert.equal(completedHealthy.result.resultCode, "HEALTHY");
assert.equal(completedHealthy.result.copyVersion, 5);
assert.match(completedHealthy.result.summary, /排便频率和便便形态较为稳定/);
assertRequiredGutPriorityAction(completedHealthy);

const gutTypeFive = local.start("GUT_REGULARITY").assessment;
const completedTypeFive = local.complete(gutTypeFive.assessmentId, { ...healthyAnswers, Q2: "C" }).assessment;
assert.equal(completedTypeFive.result.resultCode, "HEALTHY");
assertRequiredGutPriorityAction(completedTypeFive);

const gutLoose = local.start("GUT_REGULARITY").assessment;
const completedLoose = local.complete(gutLoose.assessmentId, { ...healthyAnswers, Q2: "D" }).assessment;
assert.equal(completedLoose.result.resultCode, "LOOSE");
assertRequiredGutPriorityAction(completedLoose);

const gutNormal = local.start("GUT_REGULARITY").assessment;
const completedGut = local.complete(gutNormal.assessmentId, { ...healthyAnswers, Q1: "B", Q2: "A", Q5: ["E"] }).assessment;
assert.equal(completedGut.result.resultCode, "CONSTIPATION");
assertRequiredGutPriorityAction(completedGut);

const gutAlternating = local.start("GUT_REGULARITY").assessment;
const completedAlternating = local.complete(gutAlternating.assessmentId, { ...healthyAnswers, Q1: "E" }).assessment;
assert.equal(completedAlternating.result.resultCode, "ALTERNATING");
assertRequiredGutPriorityAction(completedAlternating);

const gutSensitive = local.start("GUT_REGULARITY").assessment;
const completedSensitive = local.complete(gutSensitive.assessmentId, { ...healthyAnswers, Q3: ["B"] }).assessment;
assert.equal(completedSensitive.result.resultCode, "SENSITIVE");
assertRequiredGutPriorityAction(completedSensitive);

const initialAnswers = firstAnswers(local.DEFINITIONS.INITIAL);
const firstInitial = local.complete(local.start("INITIAL").assessment.assessmentId, initialAnswers).assessment;
const changedAnswers = { ...initialAnswers, primary_goal: "sleep", sleep_duration: "under_5" };
const secondInitial = local.complete(local.start("INITIAL").assessment.assessmentId, changedAnswers).assessment;
assert.equal(secondInitial.isRetest, true);
assert.equal(local.compare(firstInitial.assessmentId, secondInitial.assessmentId).comparable, true);
assert.equal(local.history().total, 8);

delete global.wx;
console.log("local v0.6.0 compatibility tests passed");
