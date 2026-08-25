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

assert.deepEqual(analytics.sanitizePayload("home_banner_click", {
  contentId: "ROOT_WITH_YOU_V060",
  bannerPosition: 3,
  sourcePage: "home",
  answers: { private: true },
}), {
  contentId: "ROOT_WITH_YOU_V060",
  bannerPosition: 3,
  sourcePage: "home",
});
assert.deepEqual(analytics.sanitizePayload("trial_pack_action", {
  assessmentType: "GUT_REGULARITY",
  questionnaireVersion: 2,
  result: "OPENED",
  failureReason: "",
  openid: "private",
}), {
  assessmentType: "GUT_REGULARITY",
  questionnaireVersion: 2,
  result: "OPENED",
  failureReason: "",
});

async function main() {
  assert.deepEqual(await analytics.track("assessment_complete", {
    assessmentType: "GUT_REGULARITY",
    questionnaireVersion: 2,
    isRetest: false,
  }), { sent: false, reason: "LOCAL_V060_COMPAT" });
  assert.deepEqual(await analytics.track("assessment_result_view", {
    assessmentType: "GUT_REGULARITY",
    questionnaireVersion: 2,
    resultCode: "HEALTHY",
  }), { sent: false, reason: "LOCAL_V060_COMPAT" });
  console.log("analytics tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
