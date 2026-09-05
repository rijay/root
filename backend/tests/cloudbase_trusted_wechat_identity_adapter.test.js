const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createCloudbaseTrustedWechatIdentityAdapter,
  hasCloudbaseIdentityHeaders,
} = require("../src/cloudbaseTrustedWechatIdentityAdapter");

const ACTIVE_ENV = Object.freeze({
  ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
  ROOT_WECHAT_APPID: "wx_myroot_app",
  ROOT_WECHAT_APP_CODE: "MYROOT",
});

function request(headers = {}) {
  return { headers };
}

function trustedHeaders(overrides = {}) {
  return {
    "x-wx-env": "myroot-prod",
    "x-wx-appid": "wx_myroot_app",
    "x-wx-source": "wx_devtools",
    "x-wx-platform": "devtools",
    "x-wx-openid": "openid_verified",
    "x-wx-unionid": "unionid_verified",
    ...overrides,
  };
}

test("CloudBase identity Adapter stays disabled without an explicit environment and AppID", () => {
  assert.equal(createCloudbaseTrustedWechatIdentityAdapter({}), null);
  assert.equal(createCloudbaseTrustedWechatIdentityAdapter({ ROOT_CLOUDBASE_ENV_ID: "myroot-prod" }), null);
  assert.equal(createCloudbaseTrustedWechatIdentityAdapter({ ROOT_WECHAT_APPID: "wx_myroot_app" }), null);
});

test("ordinary public requests produce no trusted CloudBase identity", async () => {
  const adapter = createCloudbaseTrustedWechatIdentityAdapter(ACTIVE_ENV);
  assert.equal(hasCloudbaseIdentityHeaders({ authorization: "Bearer public" }), false);
  assert.equal(await adapter({ request: request({ authorization: "Bearer public" }) }), null);
});

test("matching CloudBase SDK headers produce a verified identity assertion", async () => {
  const adapter = createCloudbaseTrustedWechatIdentityAdapter(ACTIVE_ENV);
  assert.deepEqual(await adapter({ request: request(trustedHeaders()) }), {
    openid: "openid_verified",
    unionid: "unionid_verified",
    appCode: "MYROOT",
    source: "CLOUDBASE",
  });
});

test("trusted phone clients accept only the documented client source and platform pair", async () => {
  const adapter = createCloudbaseTrustedWechatIdentityAdapter(ACTIVE_ENV);
  const result = await adapter({ request: request(trustedHeaders({
    "x-wx-source": "wx_client",
    "x-wx-platform": "ios",
  })) });
  assert.equal(result.openid, "openid_verified");
});

test("unknown or missing source/platform pairs fall back without trusting CloudBase headers", async () => {
  const adapter = createCloudbaseTrustedWechatIdentityAdapter(ACTIVE_ENV);
  const cases = [
    trustedHeaders({ "x-wx-source": "wx_client", "x-wx-platform": "harmonyos" }),
    trustedHeaders({ "x-wx-source": "wx_client", "x-wx-platform": "" }),
    trustedHeaders({ "x-wx-source": "", "x-wx-platform": "android" }),
    trustedHeaders({ "x-wx-source": "unknown_client", "x-wx-platform": "android" }),
  ];

  for (const headers of cases) {
    assert.equal(await adapter({ request: request(headers) }), null);
  }
});

test("environment, AppID, openid and resource-sharing mismatches fail closed", async () => {
  const adapter = createCloudbaseTrustedWechatIdentityAdapter(ACTIVE_ENV);
  const cases = [
    [trustedHeaders({ "x-wx-env": "other-env" }), "CLOUDBASE_IDENTITY_ENV_MISMATCH"],
    [trustedHeaders({ "x-wx-appid": "wx_other_app" }), "CLOUDBASE_IDENTITY_APPID_MISMATCH"],
    [trustedHeaders({ "x-wx-openid": "" }), "CLOUDBASE_IDENTITY_OPENID_MISSING"],
    [trustedHeaders({ "x-wx-from-openid": "shared_openid" }), "CLOUDBASE_IDENTITY_RESOURCE_SHARING_UNSUPPORTED"],
  ];

  for (const [headers, code] of cases) {
    await assert.rejects(
      () => adapter({ request: request(headers) }),
      (error) => error && error.code === code && error.status === 401,
    );
  }
});
