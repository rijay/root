const assert = require("node:assert/strict");
const {
  buildHeader,
  createRequestError,
  parseResponse,
  request,
  safeErrorSummary,
} = require("../utils/request");

assert.deepEqual(
  buildHeader("token", "attempt-1", "intent-1", { "X-Test": "ok" }),
  {
    "Content-Type": "application/json",
    "X-Request-Id": "attempt-1",
    "X-Idempotency-Key": "intent-1",
    Authorization: "Bearer token",
    "X-Test": "ok",
  },
);

assert.deepEqual(parseResponse({ statusCode: 200, data: { code: 0, data: { ok: true } } }), { ok: true });

assert.throws(
  () => parseResponse({ statusCode: 503, data: { code: 0, data: { ok: true } } }),
  (error) => error.code === "HTTP_503" && error.status === 503,
);

assert.throws(
  () => parseResponse({
    statusCode: 403,
    data: {
      code: "ACTIVE_MEMBERSHIP_REQUIRED",
      message: "该活动仅对有效会员开放",
      data: { correlationId: "corr.activity.001" },
    },
  }),
  (error) => error.code === "ACTIVE_MEMBERSHIP_REQUIRED"
    && error.status === 403
    && error.correlationId === "corr.activity.001",
);

const networkError = createRequestError({
  code: "NETWORK_ERROR",
  message: "Bearer raw-secret-token 13800138000",
});
assert.equal(networkError.code, "NETWORK_ERROR");
assert.equal(networkError.status, 0);
assert.ok(!networkError.message.includes("raw-secret-token"));
assert.ok(!safeErrorSummary(networkError).message.includes("13800138000"));

async function verifyRetryUsesFreshAttemptIdentity() {
  const headers = [];
  global.wx = {
    getStorageSync() { return "token"; },
    removeStorageSync() {},
    cloud: {
      callContainer(options) {
        headers.push(options.header);
        options.success({ statusCode: 200, data: { code: 0, data: { ok: true } } });
      },
    },
  };
  const originalRandom = Math.random;
  let sequence = 0;
  Math.random = () => 0.1 + (++sequence / 100);
  try {
    await request({ url: "/api/v1/activities/cancel", method: "POST", idempotencyKey: "ACTIVITY_INTENT_CANCEL_STABLE" });
    await request({ url: "/api/v1/activities/cancel", method: "POST", idempotencyKey: "ACTIVITY_INTENT_CANCEL_STABLE" });
  } finally {
    Math.random = originalRandom;
    delete global.wx;
  }
  assert.equal(headers.length, 2);
  assert.equal(headers[0]["X-Idempotency-Key"], "ACTIVITY_INTENT_CANCEL_STABLE");
  assert.equal(headers[1]["X-Idempotency-Key"], "ACTIVITY_INTENT_CANCEL_STABLE");
  assert.notEqual(headers[0]["X-Request-Id"], headers[1]["X-Request-Id"]);
}

verifyRetryUsesFreshAttemptIdentity()
  .then(() => console.log("request tests ok"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
