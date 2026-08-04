const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const script = read("pages/profile/index.js");
const envScript = read("config/env.js");
const wxml = read("pages/profile/index.wxml");
const wxss = read("pages/profile/index.wxss");
const supportScript = read("subpkg/profile/pages/support/index.js");

assert.match(script, /\/api\/v1\/user\/formal-profile/);
assert.match(script, /navigateToMiniProgram/);
assert.match(script, /shortLink/);
assert.doesNotMatch(script, /rootMemberCenterOrdersPath|rootMemberCenterCouponsPath/);
assert.match(envScript, /rootMemberCenterOrdersShortLink:\s*"#小程序:\/\/ROOT会员中心\/vTORPdF67tiEwCb"/);
assert.match(envScript, /rootMemberCenterCouponsShortLink:\s*"#小程序:\/\/ROOT会员中心\/vTORPdF67tiEwCb"/);
assert.match(script, /clearToken/);
assert.match(wxml, /我的订单/);
assert.match(wxml, /优惠券/);
assert.match(wxml, /常见问题/);
assert.match(wxml, /联系客服/);
assert.match(wxml, /建议与反馈/);
assert.match(wxml, /关于 Root/);
assert.match(wxml, /退出登录/);
assert.doesNotMatch(wxml, /会员等级|积分|余额/);
assert.doesNotMatch(wxml, /›|＞|&gt;/);
assert.match(wxss, /profile-row__arrow/);
assert.match(supportScript, /faq|feedback|contact/);

console.log("formal profile home tests ok");
