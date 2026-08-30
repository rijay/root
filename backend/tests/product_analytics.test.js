const assert = require("node:assert/strict");
const test = require("node:test");

const productAnalytics = require("../src/productAnalytics");

test("v0.6 analytics keeps only allowlisted non-sensitive fields", () => {
  const payload = productAnalytics.sanitizePayload("assessment_complete", {
    assessmentType: "INITIAL",
    questionnaireVersion: 3,
    isRetest: true,
    answers: { stool: "secret" },
    nickname: "secret",
    resultBody: "secret",
  });
  assert.deepEqual(payload, {
    assessmentType: "INITIAL",
    questionnaireVersion: 3,
    isRetest: true,
  });
  assert.equal(JSON.stringify(payload).includes("secret"), false);
});

test("guest analytics is limited to public browsing and sharing events", () => {
  const data = { analyticsEvents: [] };
  const event = productAnalytics.recordEvent(data, {}, {
    eventName: "home_product_banner_click",
    payload: { productId: "4749049439", bannerPosition: "HOME_PRIMARY", loggedIn: false },
  }, { now: "2026-08-17T12:00:00.000Z" });
  assert.equal(event.root_user_id, "");
  assert.equal(event.event_name, "home_product_banner_click");
  assert.equal(data.analyticsEvents.length, 1);
  assert.throws(() => productAnalytics.recordEvent(data, {}, {
    eventName: "assessment_start",
    payload: { assessmentType: "INITIAL", questionnaireVersion: 1, isRetest: false },
  }), /需要登录/);
});

test("unknown events and incomplete payloads fail closed", () => {
  assert.throws(() => productAnalytics.sanitizePayload("unknown_event", {}), /分析事件无效/);
  assert.throws(() => productAnalytics.sanitizePayload("product_impression", {
    productId: "4749049439",
  }), /字段不完整/);
});

test("assessment source analytics keep only the configured option identity", () => {
  assert.deepEqual(productAnalytics.sanitizePayload("assessment_source_confirm", {
    assessmentType: "GUT_REGULARITY",
    optionId: "OFFLINE_EVENT",
    configVersion: 2,
    answers: { private: true },
  }), {
    assessmentType: "GUT_REGULARITY",
    optionId: "OFFLINE_EVENT",
    configVersion: 2,
  });
});
