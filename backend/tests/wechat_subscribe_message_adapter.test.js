const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertWechatSubscriptionSendConfiguration,
  createWechatSubscribeMessageAdapter,
} = require("../src/wechatSubscribeMessageAdapter");

const config = Object.freeze({ appid: "wx-test-appid", secret: "test-secret" });
const payload = Object.freeze({
  touser: "test-openid",
  template_id: "test-template",
  data: { thing1: { value: "test" } },
});

test("untrusted subscription endpoint is rejected before token acquisition or network access", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const adapter = createWechatSubscribeMessageAdapter({
    resolveAccessToken: async () => {
      tokenCalls += 1;
      return "must-never-be-requested";
    },
    fetchJson: async () => {
      fetchCalls += 1;
      return { errcode: 0 };
    },
  });

  await assert.rejects(
    () => adapter.send({
      config,
      payload,
      env: {
        NODE_ENV: "production",
        ROOT_WECHAT_SUBSCRIBE_SEND_URL: "https://attacker.example/cgi-bin/message/subscribe/send",
      },
    }),
    (error) => error.code === "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED"
      && error.status === 503
      && error.deliveryOutcome === "NOT_SENT"
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("an untrusted shared OpenAPI base is also rejected before token acquisition", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const adapter = createWechatSubscribeMessageAdapter({
    resolveAccessToken: async () => { tokenCalls += 1; return "must-never-be-requested"; },
    fetchJson: async () => { fetchCalls += 1; return { errcode: 0 }; },
  });
  await assert.rejects(
    () => adapter.send({
      config,
      payload,
      env: { NODE_ENV: "production", ROOT_WECHAT_OPENAPI_BASE_URL: "https://attacker.example" },
    }),
    (error) => error.code === "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED"
      && error.deliveryOutcome === "NOT_SENT"
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("test-mode and protected-runtime loopback targets never receive subscription tokens", async () => {
  for (const env of [
    {
      NODE_ENV: "test",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "http://127.0.0.1:18080/cgi-bin/message/subscribe/send",
    },
    {
      NODE_ENV: "test",
      K_SERVICE: "candidate-service",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "http://127.0.0.1:18080/cgi-bin/message/subscribe/send",
    },
    {
      NODE_ENV: "test",
      ROOT_CLOUDBASE_ENV_ID: "production-environment",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "http://127.0.0.1:18080/cgi-bin/message/subscribe/send",
    },
  ]) {
    let tokenCalls = 0;
    let fetchCalls = 0;
    const adapter = createWechatSubscribeMessageAdapter({
      resolveAccessToken: async () => { tokenCalls += 1; return "must-not-leak"; },
      fetchJson: async () => { fetchCalls += 1; return { errcode: 0 }; },
    });
    await assert.rejects(
      () => adapter.send({ config, payload, env }),
      (error) => error.code === "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED"
        && error.deliveryOutcome === "NOT_SENT"
    );
    assert.equal(tokenCalls, 0);
    assert.equal(fetchCalls, 0);
  }
});

test("official subscription endpoint is validated before token and again before fetch", async () => {
  const order = [];
  const calls = [];
  const adapter = createWechatSubscribeMessageAdapter({
    resolveAccessToken: async (receivedConfig) => {
      order.push("token");
      assert.equal(receivedConfig, config);
      return "opaque-test-token";
    },
    fetchJson: async (url, options) => {
      order.push("fetch");
      calls.push({ url: url.href, options });
      return { errcode: 0, msgid: "not-persisted-here" };
    },
  });

  const result = await adapter.send({ config, payload, env: { NODE_ENV: "production" } });
  assert.deepEqual(order, ["token", "fetch"]);
  assert.deepEqual(result, { errcode: 0, msgid: "not-persisted-here" });
  assert.equal(calls.length, 1);
  const target = new URL(calls[0].url);
  assert.equal(target.origin, "https://api.weixin.qq.com");
  assert.equal(target.pathname, "/cgi-bin/message/subscribe/send");
  assert.equal(target.searchParams.get("access_token"), "opaque-test-token");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
});

test("token acquisition and provider failures retain fail-closed delivery outcomes", async () => {
  const tokenFailure = new Error("token unavailable");
  const tokenAdapter = createWechatSubscribeMessageAdapter({
    resolveAccessToken: async () => { throw tokenFailure; },
    fetchJson: async () => assert.fail("network must not run after token failure"),
  });
  await assert.rejects(
    () => tokenAdapter.send({ config, payload, env: { NODE_ENV: "production" } }),
    (error) => error === tokenFailure && error.deliveryOutcome === "NOT_SENT"
  );

  for (const [externalCode, expected] of [["43101", "NO_GRANT"], ["47003", "NOT_SENT"], ["", "UNKNOWN"]]) {
    const providerFailure = new Error("provider failure");
    providerFailure.externalCode = externalCode;
    const providerAdapter = createWechatSubscribeMessageAdapter({
      resolveAccessToken: async () => "opaque-test-token",
      fetchJson: async () => { throw providerFailure; },
    });
    await assert.rejects(
      () => providerAdapter.send({ config, payload, env: { NODE_ENV: "production" } }),
      (error) => error === providerFailure && error.deliveryOutcome === expected
    );
  }
});

test("missing credentials fail before token or network calls", async () => {
  let called = false;
  const adapter = createWechatSubscribeMessageAdapter({
    resolveAccessToken: async () => { called = true; },
    fetchJson: async () => { called = true; },
  });
  await assert.rejects(
    () => adapter.send({ config: {}, payload, env: { NODE_ENV: "production" } }),
    (error) => error.code === "WECHAT_SUBSCRIBE_CONFIG_MISSING"
      && error.deliveryOutcome === "NOT_SENT"
  );
  assert.equal(called, false);
});

test("startup configuration guard validates enabled delivery before serving traffic", () => {
  assert.deepEqual(assertWechatSubscriptionSendConfiguration({}), { enabled: false, endpoint: "" });
  assert.deepEqual(assertWechatSubscriptionSendConfiguration({
    NODE_ENV: "production",
    ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true",
  }), {
    enabled: true,
    endpoint: "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
  });
  assert.throws(
    () => assertWechatSubscriptionSendConfiguration({
      NODE_ENV: "production",
      ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "https://attacker.example/cgi-bin/message/subscribe/send",
    }),
    { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED" }
  );
});
