const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_WECHAT_OPENAPI_BASE_URL,
  assertWechatSubscribeCredentialTarget,
  resolveWechatOpenApiUrl,
  resolveWechatSubscribeSendUrl,
} = require("../src/wechatOpenApiEndpoint");

test("WeChat OpenAPI defaults to HTTPS", () => {
  const target = resolveWechatOpenApiUrl("/wxa/business/getuserphonenumber", {});
  assert.equal(DEFAULT_WECHAT_OPENAPI_BASE_URL, "https://api.weixin.qq.com");
  assert.equal(target.href, "https://api.weixin.qq.com/wxa/business/getuserphonenumber");
});

test("WeChat OpenAPI rejects plaintext and credential-bearing endpoints", () => {
  for (const rawBase of [
    "http://api.weixin.qq.com",
    "http://127.0.0.1:8080",
    "https://attacker.example",
    "https://api.weixin.qq.com/credential-proxy/",
    "https://user:secret@api.weixin.qq.com",
    "https://api.weixin.qq.com?token=secret",
  ]) {
    assert.throws(
      () => resolveWechatOpenApiUrl("/wxa/business/getuserphonenumber", {
        NODE_ENV: "production",
        ROOT_WECHAT_OPENAPI_BASE_URL: rawBase,
      }),
      { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED", status: 503 }
    );
  }
});

test("subscription send endpoint is exact and rejects credential exfiltration targets", () => {
  assert.equal(
    resolveWechatSubscribeSendUrl({ NODE_ENV: "production" }).href,
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send"
  );
  assert.equal(
    resolveWechatSubscribeSendUrl({
      NODE_ENV: "production",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
    }).href,
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send"
  );

  for (const endpoint of [
    "https://attacker.example/cgi-bin/message/subscribe/send",
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send/",
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?redirect=attacker",
    "https://user:secret@api.weixin.qq.com/cgi-bin/message/subscribe/send",
  ]) {
    assert.throws(
      () => resolveWechatSubscribeSendUrl({
        NODE_ENV: "production",
        ROOT_WECHAT_SUBSCRIBE_SEND_URL: endpoint,
      }),
      { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED", status: 503 }
    );
  }
});

test("credential-bearing subscription target is revalidated at the network seam", () => {
  const official = new URL("https://api.weixin.qq.com/cgi-bin/message/subscribe/send");
  official.searchParams.set("access_token", "opaque-test-token");
  assert.equal(assertWechatSubscribeCredentialTarget(official, { NODE_ENV: "production" }).href, official.href);

  for (const endpoint of [
    "https://attacker.example/cgi-bin/message/subscribe/send?access_token=opaque-test-token",
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=one&access_token=two",
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=one&redirect=attacker",
    "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=",
  ]) {
    assert.throws(
      () => assertWechatSubscribeCredentialTarget(endpoint, { NODE_ENV: "production" }),
      { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED" }
    );
  }
});

test("WeChat OpenAPI permits explicit loopback HTTP only in test mode", () => {
  const target = resolveWechatOpenApiUrl("/wxa/business/getuserphonenumber", {
    NODE_ENV: "test",
    ROOT_WECHAT_OPENAPI_BASE_URL: "http://127.0.0.1:18080",
  });
  assert.equal(target.href, "http://127.0.0.1:18080/wxa/business/getuserphonenumber");

  assert.throws(
    () => resolveWechatSubscribeSendUrl({
      NODE_ENV: "test",
      ROOT_WECHAT_SUBSCRIBE_SEND_URL: "http://127.0.0.1:18080/cgi-bin/message/subscribe/send",
    }),
    { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED" }
  );

  assert.throws(
    () => resolveWechatOpenApiUrl("/wxa/business/getuserphonenumber", {
      NODE_ENV: "test",
      ROOT_WECHAT_OPENAPI_BASE_URL: "http://attacker.example",
    }),
    { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED" }
  );
});

test("protected runtime markers override test-mode loopback allowances", () => {
  for (const protectedMarker of [
    { K_SERVICE: "candidate-service" },
    { ROOT_CLOUDBASE_ENV_ID: "production-environment" },
  ]) {
    assert.throws(
      () => resolveWechatOpenApiUrl("/sns/jscode2session", {
        NODE_ENV: "test",
        ROOT_WECHAT_OPENAPI_BASE_URL: "http://127.0.0.1:18080",
        ...protectedMarker,
      }),
      { code: "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED" }
    );
  }
});
