const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = JSON.parse(read("app.json"));
const healthScript = read("pages/health/index.js");
const healthWxml = read("pages/health/index.wxml");
const assessmentScript = read("subpkg/health/pages/initial-assessment/index.js");
const assessmentWxml = read("subpkg/health/pages/initial-assessment/index.wxml");
const consentWxml = read("pages/health-consent/index.wxml");

assert.ok(app.subPackages.some((item) => item.root === "subpkg/health" && item.pages.includes("pages/initial-assessment/index")));
assert.match(healthScript, /\/api\/v1\/health\/root4u/);
assert.match(healthScript, /ensureHealthConsent/);
assert.match(healthScript, /readSessionPageCache/);
assert.match(healthScript, /requestWithDeadline/);
assert.doesNotMatch(healthScript, /writePublicPageCache/);
assert.doesNotMatch(healthScript, /task|reward|checkin|coupon/i);
assert.match(healthWxml, /今天先从三件小事开始/);
assert.match(healthScript, /item\.availability === "PUBLISHED"/);
assert.match(healthScript, /已为你匹配/);
assert.match(healthWxml, /wx:key="viewKey"/);
assert.match(healthWxml, /这不是疾病诊断/);
assert.match(healthWxml, /不会因为本次回答自动创建工单或承诺主动联系/);
assert.doesNotMatch(healthWxml, /open-type="contact"/);
assert.match(assessmentScript, /\/api\/v1\/health\/root4u\/initial-assessment/);
assert.match(assessmentScript, /idempotencyKey/);
assert.doesNotMatch(assessmentScript, /setStorageSync\([^,]+,\s*this\.data\.answers/);
assert.match(assessmentWxml, /完成建档/);
assert.match(assessmentWxml, /<page-navigation[^>]+bind:back="goBack"/);
assert.match(consentWxml, /首页、活动和会员支持不以同意为前提/);
assert.doesNotMatch(consentWxml, /任务|奖励|打卡/);

console.log("formal health tests ok");
