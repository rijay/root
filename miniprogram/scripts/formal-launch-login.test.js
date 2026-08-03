const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const authIntent = require("../utils/auth-intent");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const now = Date.parse("2026-08-03T05:00:00.000Z");
assert.equal(authIntent.remember("/pages/health/index", now), true);
assert.equal(authIntent.peek(now), "/pages/health/index");
assert.equal(authIntent.consume(now), "/pages/health/index");
assert.equal(authIntent.consume(now), "");
assert.equal(authIntent.remember("/pages/tasks/index", now), false);
assert.equal(authIntent.remember("https://example.com", now), false);

const loginWxml = read("pages/login/index.wxml");
assert.match(loginWxml, /<root-wordmark tone="dark"/);
assert.match(loginWxml, /注册Root会员/);
assert.match(loginWxml, /探索更多可能/);
assert.match(loginWxml, /open-type="getPhoneNumber"/);
assert.match(loginWxml, /手机号快捷登录/);
assert.match(loginWxml, /<privacy-consent/);
assert.doesNotMatch(loginWxml, /7 天|打卡|任务|微信身份进入/);

const loginScript = read("pages/login/index.js");
assert.match(loginScript, /consumeAuthIntent/);
assert.match(loginScript, /手机号已验证/);
assert.match(loginScript, /IDENTITY_CONFLICT/);
assert.doesNotMatch(loginScript, /consumeActivityLoginRecovery/);

const registerWxml = read("pages/register/index.wxml");
assert.match(registerWxml, /\{\{title\}\}/);
assert.match(registerWxml, /open-type="chooseAvatar"/);
assert.match(registerWxml, /type="nickname"/);
assert.match(registerWxml, /mode="date"/);
assert.match(registerWxml, /手机号 \*/);
assert.match(registerWxml, /生日 \*/);
assert.match(registerWxml, /性别 \*/);
assert.match(registerWxml, />登录</);
assert.doesNotMatch(registerWxml, /7 天|打卡|任务|结算|订单/);

const registerScript = read("pages/register/index.js");
assert.match(registerScript, /欢迎注册/);
assert.match(registerScript, /必填项未填写/);
assert.match(registerScript, /成功注册/);
assert.match(registerScript, /Root用户/);
assert.match(registerScript, /consumeAuthIntent/);
assert.match(registerScript, /uploadCloudAvatar/);

const customTabScript = read("custom-tab-bar/index.js");
assert.match(customTabScript, /PROTECTED_TAB_INDEXES/);
assert.match(customTabScript, /rememberAuthIntent/);
assert.match(customTabScript, /wx\.navigateTo/);

const healthScript = read("pages/health/index.js");
const profileScript = read("pages/profile/index.js");
assert.match(healthScript, /\/pages\/health\/index/);
assert.match(profileScript, /\/pages\/profile\/index/);
assert.doesNotMatch(healthScript, /health-start/);
assert.doesNotMatch(profileScript, /intent=profile/);

delete global.wx;
console.log("formal launch login tests ok");
