const assert = require("node:assert/strict");
const {
  buildHeader,
  cancelRequestScope,
  createRequestError,
  parseResponse,
  request,
  resetRequestStateForTests,
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
  resetRequestStateForTests();
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

async function verifyDevtoolsUsesLoopbackRequest() {
  resetRequestStateForTests();
  const calls = [];
  global.wx = {
    getDeviceInfo() { return { platform: "devtools" }; },
    getStorageSync() { return ""; },
    removeStorageSync() {},
    request(options) {
      calls.push(options);
      options.success({ statusCode: 200, data: { code: 0, data: { local: true } } });
      return { abort() {} };
    },
    cloud: {
      callContainer() { throw new Error("devtools local requests must not reach cloudContainer"); },
    },
  };
  try {
    assert.deepEqual(await request({ url: "/health", method: "GET", dedupe: false }), { local: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8787/health");
  } finally {
    resetRequestStateForTests();
    delete global.wx;
  }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function verifyReadSchedulingAndDeduplication() {
  resetRequestStateForTests();
  const calls = [];
  global.wx = {
    getStorageSync() { return "token"; },
    removeStorageSync() {},
    cloud: {
      callContainer(options) {
        calls.push(options);
        return { abort() {} };
      },
    },
  };
  try {
    const pending = Array.from({ length: 6 }, (_, index) => request({
      url: `/api/v1/public/${index}`,
      method: "GET",
    }));
    await nextTurn();
    assert.equal(calls.length, 4);
    calls[0].success({ statusCode: 200, data: { code: 0, data: { index: 0 } } });
    await nextTurn();
    assert.equal(calls.length, 5);
    calls[1].success({ statusCode: 200, data: { code: 0, data: { index: 1 } } });
    await nextTurn();
    assert.equal(calls.length, 6);
    for (let index = 2; index < calls.length; index += 1) {
      calls[index].success({ statusCode: 200, data: { code: 0, data: { index } } });
    }
    await Promise.all(pending);

    resetRequestStateForTests();
    calls.length = 0;
    const first = request({ url: "/api/v1/public/same", method: "GET", data: { page: 1 } });
    const second = request({ url: "/api/v1/public/same", method: "GET", data: { page: 1 } });
    await nextTurn();
    assert.equal(calls.length, 1);
    calls[0].success({ statusCode: 200, data: { code: 0, data: { ok: true } } });
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  } finally {
    resetRequestStateForTests();
    delete global.wx;
  }
}

async function verifyTimeoutsAndScopeCancellation() {
  resetRequestStateForTests();
  const calls = [];
  let aborts = 0;
  let inFlightWrite = null;
  global.wx = {
    getStorageSync() { return "token"; },
    removeStorageSync() {},
    cloud: {
      callContainer(options) {
        calls.push(options);
        if (options.path.includes("cancel-me")) return { abort() { aborts += 1; } };
        if (options.path.includes("result-unknown")) {
          options.fail({ errMsg: "request:fail timeout" });
          return { abort() { aborts += 1; } };
        }
        if (options.path.includes("write-in-flight")) {
          inFlightWrite = options;
          return { abort() { aborts += 1; } };
        }
        options.success({ statusCode: 200, data: { code: 0, data: { ok: true } } });
        return { abort() { aborts += 1; } };
      },
    },
  };
  try {
    await request({ url: "/api/v1/public/read", method: "GET" });
    await request({ url: "/api/v1/public/write", method: "POST", data: { ok: true } });
    assert.equal(calls[0].timeout, 8000);
    assert.equal(calls[1].timeout, 12000);

    const cancelled = request({
      url: "/api/v1/public/cancel-me",
      method: "GET",
      scope: "page:cancel-test",
    });
    await nextTurn();
    assert.equal(cancelRequestScope("page:cancel-test"), 1);
    await assert.rejects(cancelled, (error) => error.code === "REQUEST_CANCELLED");
    assert.equal(aborts, 1);

    await assert.rejects(
      request({
        url: "/api/v1/public/result-unknown",
        method: "POST",
        scope: "page:write-timeout",
      }),
      (error) => error.code === "WRITE_RESULT_UNKNOWN" && error.resultUnknown === true,
    );

    const write = request({
      url: "/api/v1/public/write-in-flight",
      method: "POST",
      scope: "page:write-in-flight",
    });
    await nextTurn();
    assert.equal(cancelRequestScope("page:write-in-flight"), 0);
    assert.ok(inFlightWrite);
    inFlightWrite.success({ statusCode: 200, data: { code: 0, data: { ok: true } } });
    assert.deepEqual(await write, { ok: true });
    assert.equal(aborts, 1);
  } finally {
    resetRequestStateForTests();
    delete global.wx;
  }
}

verifyDevtoolsUsesLoopbackRequest()
  .then(verifyRetryUsesFreshAttemptIdentity)
  .then(verifyReadSchedulingAndDeduplication)
  .then(verifyTimeoutsAndScopeCancellation)
  .then(() => console.log("request tests ok"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
