const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const domain = require("../src/domain");
const { createApp } = require("../src/app");
const {
  resolveTrustedWechatIdentity,
} = require("../src/trustedWechatIdentity");
const {
  createCloudbaseTrustedWechatIdentityAdapter,
} = require("../src/cloudbaseTrustedWechatIdentityAdapter");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function postJson(baseUrl, pathname, headers, body) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body || {}));
  });
}

test("raw X-WX headers are not identity assertions", async () => {
  const result = await resolveTrustedWechatIdentity({
    request: { headers: { "x-wx-openid": "spoofed_openid" } },
    env: {},
  });
  assert.equal(result, null);
});

test("a verified Adapter assertion is normalized", async () => {
  const result = await resolveTrustedWechatIdentity({
    adapter: async () => ({
      openid: " openid_verified ",
      unionid: " unionid_verified ",
      appCode: " myroot ",
      source: "CLOUDBASE",
    }),
    request: { headers: { "x-wx-openid": "untrusted_transport_value" } },
    env: {},
  });

  assert.deepEqual(result, {
    openid: "openid_verified",
    unionid: "unionid_verified",
    appCode: "MYROOT",
    source: "CLOUDBASE",
  });
});

test("verified assertion Adapter rejects incomplete and unknown assertions", async () => {
  await assert.rejects(
    () => resolveTrustedWechatIdentity({ adapter: async () => ({ source: "CLOUDBASE" }) }),
    (error) => error && error.code === "TRUSTED_WECHAT_IDENTITY_INVALID"
  );
  await assert.rejects(
    () => resolveTrustedWechatIdentity({ adapter: async () => ({ openid: "openid", source: "RAW_HEADER" }) }),
    (error) => error && error.code === "TRUSTED_WECHAT_IDENTITY_SOURCE_INVALID"
  );
  await assert.rejects(
    () => resolveTrustedWechatIdentity({
      adapter: async () => ({ openid: "openid", source: "CLOUDBASE" }),
    }),
    (error) => error && error.code === "TRUSTED_WECHAT_APP_CODE_INVALID"
  );
});

test("domain ignores raw identity headers and creates no user", async () => {
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, {}, {
      env: {},
      headers: { "x-wx-openid": "spoofed_openid", "x-wx-unionid": "spoofed_unionid" },
    }),
    (error) => error && error.code === 1007
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
});

test("HTTP Adapter cannot elevate raw X-WX headers without a verified Adapter", async (t) => {
  const server = createApp({ env: {} });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await postJson(baseUrl, "/api/v1/auth/login", {
    "X-WX-OPENID": "spoofed_http_openid",
    "X-WX-UNIONID": "spoofed_http_unionid",
  }, {});

  assert.equal(result.code, 1007);
  assert.equal(server.store.rootUsers.length, 0);
  assert.equal(server.store.wechatIdentities.length, 0);
});

test("HTTP login falls back to code2session when CloudBase source metadata is unknown", async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      openid: "code2session_fallback_openid",
      unionid: "code2session_fallback_unionid",
    }));
  });
  const wechatBaseUrl = await listen(upstream);
  t.after(() => upstream.close());

  const env = {
    NODE_ENV: "test",
    ROOT_WECHAT_APPID: "wx_myroot_app",
    ROOT_WECHAT_APPSECRET: "test_secret",
    ROOT_WECHAT_APP_CODE: "MYROOT",
    ROOT_WECHAT_OPENAPI_BASE_URL: wechatBaseUrl,
  };
  const server = createApp({
    env,
    trustedWechatIdentityAdapter: createCloudbaseTrustedWechatIdentityAdapter({
      ...env,
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
    }),
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await postJson(baseUrl, "/api/v1/auth/login", {
    "X-WX-ENV": "myroot-prod",
    "X-WX-APPID": "wx_myroot_app",
    "X-WX-SOURCE": "wx_client",
    "X-WX-PLATFORM": "harmonyos",
    "X-WX-OPENID": "untrusted_cloudbase_openid",
    "X-WX-UNIONID": "untrusted_cloudbase_unionid",
  }, {
    appCode: "MYROOT",
    wxCode: "fresh_wechat_code",
    flowVersion: "FORMAL_LAUNCH_V1",
  });

  assert.equal(result.code, 0);
  assert.equal(server.store.wechatIdentities.length, 1);
  assert.equal(server.store.wechatIdentities[0].openid, "code2session_fallback_openid");
  assert.equal(server.store.wechatIdentities[0].unionid, "code2session_fallback_unionid");
});

test("domain accepts only the verified identity supplied through its Interface", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {}, {
    env: {},
    headers: { "x-wx-openid": "spoofed_openid" },
    trustedWechatIdentity: {
      openid: "verified_openid",
      unionid: "verified_unionid",
      appCode: "MYROOT",
      source: "CLOUDBASE",
    },
  });

  assert.equal(login.code, 0);
  assert.equal(store.wechatIdentities[0].openid, "verified_openid");
  assert.equal(store.wechatIdentities[0].unionid, "verified_unionid");
});

test("trusted appCode owns the application scope and rejects a spoofed body override", async () => {
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, { appCode: "ROOT_MEMBER_CENTER" }, {
      env: { NODE_ENV: "production" },
      trustedWechatIdentity: {
        openid: "verified_myroot_openid",
        unionid: "",
        appCode: "MYROOT",
        source: "CLOUDBASE",
      },
    }),
    (error) => error && error.code === "TRUSTED_WECHAT_APP_CODE_MISMATCH" && error.status === 401
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
});

test("HTTP login cannot relabel a verified MYROOT openid as another app", async (t) => {
  const server = createApp({
    env: { NODE_ENV: "production" },
    trustedWechatIdentityAdapter: async () => ({
      openid: "verified_http_myroot_openid",
      unionid: "",
      appCode: "MYROOT",
      source: "CLOUDBASE",
    }),
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await postJson(baseUrl, "/api/v1/auth/login", {}, {
    appCode: "ROOT_MEMBER_CENTER",
  });

  assert.equal(result.code, "TRUSTED_WECHAT_APP_CODE_MISMATCH");
  assert.equal(server.store.rootUsers.length, 0);
  assert.equal(server.store.wechatIdentities.length, 0);
});

test("protected code2session login cannot relabel the deployment AppID scope", async () => {
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, {
      wxCode: "must_not_reach_wechat",
      appCode: "ROOT_MEMBER_CENTER",
    }, {
      NODE_ENV: "production",
      ROOT_WECHAT_APPID: "myroot_appid",
      ROOT_WECHAT_APPSECRET: "myroot_appsecret",
    }),
    (error) => error && error.code === "WECHAT_DEPLOYMENT_APP_CODE_MISMATCH" && error.status === 401
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
});

test("protected login rejects a trusted assertion from another deployment app", async () => {
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, {}, {
      env: { NODE_ENV: "production", ROOT_WECHAT_APP_CODE: "MYROOT" },
      trustedWechatIdentity: {
        openid: "member_center_openid_in_myroot_deployment",
        unionid: "",
        appCode: "ROOT_MEMBER_CENTER",
        source: "CLOUDBASE",
      },
    }),
    (error) => error
      && error.code === "TRUSTED_WECHAT_DEPLOYMENT_APP_CODE_MISMATCH"
      && error.status === 401
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
});

test("unsafe body identity override cannot be enabled in production", async () => {
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, { openid: "body_openid" }, {
      NODE_ENV: "production",
      ROOT_ALLOW_OPENID_LOGIN: "true",
    }),
    (error) => error && error.code === 1007
  );

  assert.equal(store.rootUsers.length, 0);
});

test("code2session success without a valid openid creates no ROOT user or session", async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  const baseUrl = await listen(upstream);
  t.after(() => upstream.close());
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, { wxCode: "valid_shape_code" }, {
      NODE_ENV: "test",
      ROOT_WECHAT_OPENAPI_BASE_URL: baseUrl,
      ROOT_WECHAT_APPID: "test_appid",
      ROOT_WECHAT_APPSECRET: "test_secret",
      ROOT_WECHAT_APP_CODE: "MYROOT",
    }),
    (error) => error && error.code === "WECHAT_CODE2SESSION_IDENTITY_INVALID" && error.status === 502
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
  assert.equal(store.sessions.length, 0);
});

test("code2session rejects an explicitly malformed unionid before any write", async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ openid: "valid_code2session_openid", unionid: "bad union id" }));
  });
  const baseUrl = await listen(upstream);
  t.after(() => upstream.close());
  const store = domain.createStore();

  await assert.rejects(
    () => domain.loginWithWechat(store, { wxCode: "valid_shape_code" }, {
      NODE_ENV: "test",
      ROOT_WECHAT_OPENAPI_BASE_URL: baseUrl,
      ROOT_WECHAT_APPID: "test_appid",
      ROOT_WECHAT_APPSECRET: "test_secret",
      ROOT_WECHAT_APP_CODE: "MYROOT",
    }),
    (error) => error && error.code === "WECHAT_CODE2SESSION_IDENTITY_INVALID"
  );
  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
  assert.equal(store.sessions.length, 0);
});
