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
assert.deepEqual(analytics.sanitizePayload("assessment_source_confirm", {
  assessmentType: "GUT_REGULARITY",
  optionId: "OFFLINE_EVENT",
  configVersion: 2,
  answers: { private: true },
}), {
  assessmentType: "GUT_REGULARITY",
  optionId: "OFFLINE_EVENT",
  configVersion: 2,
});

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
assert.deepEqual(analytics.sanitizePayload("member_center_entry", {
  entryKey: "orders",
  result: "SUCCESS",
  failureReason: "",
  sourcePage: "/pages/profile/index",
  shortLink: "private",
}), {
  entryKey: "orders",
  result: "SUCCESS",
  failureReason: "",
  sourcePage: "/pages/profile/index",
});

async function main() {
  assert.deepEqual(await analytics.track("assessment_complete", {
    assessmentType: "GUT_REGULARITY",
    questionnaireVersion: 2,
    isRetest: false,
  }), { sent: false, reason: "DEVELOPMENT_ANALYTICS_DISABLED" });
  assert.deepEqual(await analytics.track("assessment_result_view", {
    assessmentType: "GUT_REGULARITY",
    questionnaireVersion: 2,
    resultCode: "HEALTHY",
  }), { sent: false, reason: "DEVELOPMENT_ANALYTICS_DISABLED" });
  console.log("analytics tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
