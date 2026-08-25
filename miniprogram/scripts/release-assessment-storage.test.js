const assert = require("node:assert/strict");

const storage = new Map([
  ["ROOT_TOKEN", "release-storage-test-token"],
  ["ROOT_LOCAL_USER_SCOPE_V060", "release-storage-test-user"],
]);

global.__wxConfig = { envVersion: "release" };
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

let remoteCalls = 0;
require.cache[require.resolve("../utils/request")] = {
  exports: {
    async request() {
      remoteCalls += 1;
      throw new Error("release assessment must not call the unfinished server API");
    },
  },
};
require.cache[require.resolve("../utils/analytics")] = {
  exports: { track() { return { sent: false, reason: "TEST" }; } },
};

const env = require("../config/env");
const assessment = require("../utils/health-assessment");
const local = require("../utils/local-health-assessment");

function firstAnswers(definition) {
  return definition.questions.reduce((answers, question) => {
    const first = question.options[0];
    answers[question.field] = question.type === "multi" ? [first.value] : first.value;
    return answers;
  }, {});
}

async function main() {
  assert.equal(env.envVersion, "release");
  assert.equal(env.localV060CompatMode, false, "正式环境的其他能力不得退回全局兼容模式");
  assert.equal(env.healthAssessmentStorageMode, "LOCAL_DEVICE");
  assert.equal(env.healthAssessmentRetentionDays, 180);

  const catalog = await assessment.getCatalog();
  assert.equal(catalog.storageMode, "LOCAL_DEVICE");
  assert.equal(catalog.assessments.length, 2);

  const answers = firstAnswers(local.DEFINITIONS.INITIAL);
  const first = await assessment.startAssessment("INITIAL");
  await assessment.saveDraft(first.assessment.assessmentId, answers);
  const completed = await assessment.completeAssessment(first.assessment.assessmentId, answers);
  const loaded = await assessment.getAssessment(completed.assessment.assessmentId);
  const history = await assessment.getHistory("INITIAL");

  assert.equal(loaded.assessment.status, "COMPLETED");
  assert.equal(history.total, 1);

  assert.equal(local.bindUserScope("member-a").bound, true);
  storage.set("ROOT_TOKEN", "rotated-release-storage-test-token");
  assert.equal((await assessment.getHistory("INITIAL")).total, 1, "token 更新后同一会员仍应看到本机历史");
  local.unbindUserScope();
  assert.equal((await assessment.getHistory("INITIAL")).total, 0, "退出后游客不得看到会员评测记录");
  local.bindUserScope("member-a");
  assert.equal((await assessment.getHistory("INITIAL")).total, 1, "同一会员再次登录后应恢复本机历史");
  local.unbindUserScope();
  local.bindUserScope("member-b");
  assert.equal((await assessment.getHistory("INITIAL")).total, 0, "不同会员不得共享本机评测记录");
  assert.equal(remoteCalls, 0, "release 评测链路不得调用未部署的服务端 Interface");
}

main()
  .then(() => {
    delete global.__wxConfig;
    delete global.wx;
    console.log("release assessment local-storage tests passed");
  })
  .catch((error) => {
    delete global.__wxConfig;
    delete global.wx;
    console.error(error);
    process.exit(1);
  });
