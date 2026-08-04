const assert = require("node:assert/strict");
const test = require("node:test");

const { createUedReviewStore } = require("../scripts/ued-review-server");

test("UED review Store is deterministic, representative and process-local", () => {
  const first = createUedReviewStore();
  const second = createUedReviewStore();

  assert.equal(first.contentVersions.length, 5);
  assert.equal(first.activityDefinitionVersions.length, 2);
  assert.equal(first.activitySessions.length, 1);
  assert.equal(first.activityEnrollments.length, 2);
  assert.equal(first.users.length, 2);
  assert.equal(first.auditLogs.length, 2);
  assert.equal(first.healthContentVersions.length >= 6, true);
  assert.equal(first.contentVersions.some((row) => row.content.internalName === "Root Foundation 01"), true);
  assert.equal(first.activityDefinitionVersions.some((row) => row.title === "江畔时光电影节"), true);
  assert.equal(first.healthContentVersions.some((row) => row.content_json.name === "睡眠节律评测"), true);

  first.users[0].nickname = "changed only in first Store";
  assert.equal(second.users[0].nickname, "Root用户");
});
