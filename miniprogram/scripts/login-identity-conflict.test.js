const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loginPage(t, response) {
  const previous = { wx: global.wx, Page: global.Page, getApp: global.getApp };
  const storage = new Map();
  const calls = { requests: [], modals: [], navigation: [], toasts: [] };
  const app = { globalData: {} };
  global.getApp = () => app;
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getDeviceInfo: () => ({ platform: "devtools" }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    login: (options) => options.success({ code: "synthetic_wechat_code" }),
    request(options) {
      calls.requests.push(options);
      options.success(response);
    },
    showModal: (options) => calls.modals.push(options),
    showToast: (options) => calls.toasts.push(options),
    switchTab: (options) => calls.navigation.push(options.url),
    redirectTo: (options) => calls.navigation.push(options.url),
  };
  let definition;
  global.Page = (value) => { definition = value; };
  const pagePath = require.resolve("../pages/login/index");
  delete require.cache[pagePath];
  require(pagePath);
  const transport = require("../utils/request");
  require("../utils/performance-monitor").performanceMonitor.setUploadEnabled(false);
  const intent = require("../utils/auth-intent");
  const session = require("../utils/login-session");
  intent.remember("/pages/health/index");
  const pendingIntent = structuredClone(storage.get(intent.AUTH_INTENT_STORAGE_KEY));
  t.after(() => {
    transport.resetRequestStateForTests();
    delete require.cache[pagePath];
    global.wx = previous.wx;
    global.Page = previous.Page;
    global.getApp = previous.getApp;
  });
  const page = {
    ...definition,
    data: { ...definition.data, agreementAccepted: true },
    setData(patch) { Object.assign(this.data, patch); },
  };
  const submit = () => page.loginWithPhone({ detail: { code: "synthetic_phone_code" } });
  function assertNoLogin() {
    assert.equal(calls.requests.length, 1, "a conflict must not retry a single-use phone code");
    assert.equal(page.data.loading, false);
    assert.equal(storage.get("ROOT_TOKEN"), undefined);
    assert.equal(storage.get(session.LOGIN_SESSION_KEY), undefined);
    assert.deepEqual(storage.get(intent.AUTH_INTENT_STORAGE_KEY), pendingIntent);
    assert.deepEqual(calls.navigation, []);
    assert.deepEqual(calls.toasts, []);
  }
  return { page, calls, storage, submit, assertNoLogin };
}

for (const code of [
  "WECHAT_APP_OPENID_AMBIGUOUS",
  "WECHAT_APP_IDENTITY_AMBIGUOUS",
  "WECHAT_UNIONID_BINDING_AMBIGUOUS",
  "WECHAT_IDENTITY_BINDING_CONFLICT",
]) {
  test(`login page handles legacy 409 ${code} without retry guidance`, async (t) => {
    const h = loginPage(t, { statusCode: 409, data: { code, message: "绑定冲突", data: null } });
    await h.submit();
    assert.equal(h.page.data.identityConflict, true);
    assert.deepEqual(h.calls.modals, []);
    h.assertNoLogin();
  });
}

test("login page handles the structured conflict outcome without creating a login session", async (t) => {
  const h = loginPage(t, {
    statusCode: 200,
    data: { code: 0, data: { sessionOutcome: "IDENTITY_CONFLICT", token: "" } },
  });
  await h.submit();
  assert.equal(h.page.data.identityConflict, true);
  assert.deepEqual(h.calls.modals, []);
  h.assertNoLogin();
});

test("temporary login failure still requests a fresh phone authorization", async (t) => {
  const h = loginPage(t, {
    statusCode: 503,
    data: { code: "WECHAT_OPENAPI_UNAVAILABLE", message: "服务暂时不可用", data: null },
  });
  await h.submit();
  assert.equal(h.page.data.identityConflict, false);
  assert.equal(h.calls.modals.length, 1);
  assert.match(h.calls.modals[0].content, /再次点击“手机号快捷登录”重新授权/);
  h.assertNoLogin();
});

test("successful login retains the pending destination and stores the session", async (t) => {
  const h = loginPage(t, {
    statusCode: 200,
    data: { code: 0, data: { sessionOutcome: "REGISTERED", token: "synthetic_session_token" } },
  });
  await h.submit();
  assert.equal(h.page.data.identityConflict, false);
  assert.equal(h.page.data.loading, false);
  assert.equal(h.storage.get("ROOT_TOKEN"), "synthetic_session_token");
  assert.ok(h.storage.get("ROOT_LOGIN_SESSION_V1").sessionId);
  assert.deepEqual(h.calls.navigation, ["/pages/health/index"]);
  assert.deepEqual(h.calls.modals, []);
});

test("binding conflict copy states a permanent conflict and a recovery route", () => {
  const template = fs.readFileSync(path.join(__dirname, "../pages/login/index.wxml"), "utf8");
  assert.match(template, /账号绑定冲突/);
  assert.match(template, /重新授权无法解决/);
  assert.match(template, /原绑定微信登录/);
  assert.match(template, /联系客服核实/);
  assert.doesNotMatch(template, /资料核验中/);
});
