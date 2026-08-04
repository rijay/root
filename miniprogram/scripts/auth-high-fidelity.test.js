const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const {
  initializePrivacyAuthorization,
  resetPrivacyAuthorizationForTests,
  setPrivacyPresenter,
} = require("../utils/privacy-authorization");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const loginWxml = read("pages/login/index.wxml");
const loginWxss = read("pages/login/index.wxss");
assert.match(loginWxml, /id="root-privacy-consent"/);
assert.match(loginWxml, /style="width: 350px;"/);
assert.match(loginWxss, /login-page__kicker[\s\S]*line-height:\s*18px/);
assert.match(loginWxss, /login-page__title[\s\S]*margin:\s*18px 4px 0/);
assert.match(loginWxss, /login-page__button[\s\S]*width:\s*350px/);
assert.match(loginWxss, /login-page__button[\s\S]*margin:\s*184px 0 0/);
assert.match(loginWxss, /login-page__privacy[\s\S]*margin:\s*20px 10px 0/);

const privacyWxml = read("components/privacy-consent/index.wxml");
const privacyWxss = read("components/privacy-consent/index.wxss");
const privacyScript = read("components/privacy-consent/index.js");
assert.match(privacyWxml, /微信平台隐私保护提示 · 流程示意/);
assert.match(privacyWxml, /\{\{privacyCopy\}\}/);
assert.match(privacyWxss, /height:\s*458px/);
assert.match(privacyWxss, /privacy-actions[\s\S]*position:\s*absolute[\s\S]*top:\s*324px/);
assert.match(privacyWxss, /privacy-button[\s\S]*width:\s*350px/);
assert.match(privacyWxss, /privacy-copy[\s\S]*white-space:\s*pre-line/);
assert.match(privacyScript, /为完成会员身份验证/);
assert.match(privacyScript, /申请获取并验证手机号/);

const registerWxml = read("pages/register/index.wxml");
const registerWxss = read("pages/register/index.wxss");
assert.match(registerWxml, /register-page__avatar-wordmark/);
assert.match(registerWxml, /register-page__avatar" style="width: 72px;"/);
assert.match(registerWxml, /register-gender__option[^>]+style="width: 142px;"/);
assert.match(registerWxml, /register-page__submit" style="width: 350px;"/);
assert.match(registerWxss, /register-page__avatar-row[\s\S]*margin:\s*26px 4px 0/);
assert.match(registerWxss, /register-page__submit[\s\S]*width:\s*350px/);
assert.match(registerWxss, /register-page__submit[\s\S]*margin:\s*40px 0 0/);
assert.match(registerWxss, /register-gender__option[\s\S]*width:\s*142px/);

resetPrivacyAuthorizationForTests();
let platformPrivacyHandler = null;
const initialized = initializePrivacyAuthorization({
  onNeedPrivacyAuthorization(handler) { platformPrivacyHandler = handler; },
});
assert.equal(initialized, true);
assert.equal(typeof platformPrivacyHandler, "function");
let presentedReferrer = "";
const clearPresenter = setPrivacyPresenter(({ resolve, eventInfo }) => {
  presentedReferrer = eventInfo.referrer;
  resolve({ event: "exposureAuthorization" });
});
let platformResolution = null;
platformPrivacyHandler((result) => { platformResolution = result; }, { referrer: "button.getPhoneNumber" });
assert.equal(presentedReferrer, "button.getPhoneNumber");
assert.deepEqual(platformResolution, { event: "exposureAuthorization" });
clearPresenter();
platformPrivacyHandler((result) => { platformResolution = result; }, { referrer: "button.chooseAvatar" });
assert.deepEqual(platformResolution, { event: "disagree" });
resetPrivacyAuthorizationForTests();

console.log("auth high-fidelity contract: 28/28 PASS");
