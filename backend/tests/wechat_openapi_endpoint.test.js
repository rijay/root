const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_WECHAT_OPENAPI_BASE_URL,
  resolveWechatOpenApiUrl,
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

test("WeChat OpenAPI permits explicit loopback HTTP only in test mode", () => {
  const target = resolveWechatOpenApiUrl("/wxa/business/getuserphonenumber", {
    NODE_ENV: "test",
    ROOT_WECHAT_OPENAPI_BASE_URL: "http://127.0.0.1:18080",
  });
  assert.equal(target.href, "http://127.0.0.1:18080/wxa/business/getuserphonenumber");

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
