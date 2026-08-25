const assert = require("node:assert/strict");

const storage = new Map([
  ["ROOT_LOCAL_USER_SCOPE_V060", "user:retention-test"],
]);

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const local = require("../utils/local-health-assessment");
const oldTime = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
const freshTime = new Date(Date.now() - 179 * 24 * 60 * 60 * 1000).toISOString();

function attempt(assessmentId, status, updatedAt) {
  return {
    assessmentId,
    assessmentType: "INITIAL",
    questionnaireId: "ROOT4U_INITIAL_PROFILE",
    questionnaireVersion: 1,
    status,
    safetyState: "NONE",
    answers: { privateAnswer: assessmentId },
    dimensions: [],
    result: status === "COMPLETED" ? { title: assessmentId } : null,
    startedAt: updatedAt,
    completedAt: status === "COMPLETED" ? updatedAt : "",
    updatedAt,
  };
}

storage.set(local.STORAGE_KEY, {
  storageVersion: 1,
  users: {
    "user:retention-test": {
      attempts: [
        attempt("expired-completed", "COMPLETED", oldTime),
        attempt("expired-draft", "IN_PROGRESS", oldTime),
        attempt("fresh-completed", "COMPLETED", freshTime),
      ],
    },
  },
});

assert.equal(local.LOCAL_HEALTH_RETENTION_DAYS, 180);
const history = local.history("INITIAL");
assert.deepEqual(history.assessments.map((item) => item.assessmentId), ["fresh-completed"]);

const persisted = storage.get(local.STORAGE_KEY);
assert.deepEqual(
  persisted.users["user:retention-test"].attempts.map((item) => item.assessmentId),
  ["fresh-completed"],
  "超过 180 天的已完成记录与草稿都应从本机自动删除",
);

delete global.wx;
console.log("local health retention tests passed");
