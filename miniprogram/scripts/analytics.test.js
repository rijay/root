const assert = require("node:assert/strict");
const analytics = require("../utils/analytics");

const safe = analytics.sanitizePayload("assessment_complete", {
  assessmentType: "INITIAL",
  questionnaireVersion: 3,
  isRetest: true,
  answers: { secret: true },
  nickname: "secret",
});
assert.deepEqual(safe, {
  assessmentType: "INITIAL",
  questionnaireVersion: 3,
  isRetest: true,
});
assert.equal(JSON.stringify(safe).includes("secret"), false);
assert.equal(analytics.sanitizePayload("unknown_event", {}), null);
assert.equal(analytics.failureReason({ code: "CAPACITY_FULL" }), "CAPACITY_FULL");
assert.equal(analytics.failureReason({ message: "private details" }), "REQUEST_FAILED");

console.log("analytics tests passed");
