const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = JSON.parse(read("app.json"));
const healthScript = read("pages/health/index.js");
const healthWxml = read("pages/health/index.wxml");
const assessmentScript = read("subpkg/health/pages/assessment/index.js");
const resultWxml = read("subpkg/health/pages/result/index.wxml");
const historyScript = read("subpkg/health/pages/history/index.js");
const compareScript = read("subpkg/health/pages/compare/index.js");
const consentWxml = read("pages/health-consent/index.wxml");

const healthPackage = app.subPackages.find((item) => item.root === "subpkg/health");
assert.deepEqual(healthPackage.pages, [
  "pages/assessment/index",
  "pages/result/index",
  "pages/history/index",
  "pages/compare/index",
]);
assert.match(healthScript, /getCatalog/);
assert.match(healthScript, /confirmRetest/);
assert.match(healthScript, /getHealthConsentStatus/);
assert.doesNotMatch(healthScript, /task|reward|checkin|coupon/i);
assert.match(healthWxml, /初始评测|INITIAL/);
assert.match(healthWxml, /GUT/);
assert.match(healthWxml, /不提供疾病诊断/);
assert.match(assessmentScript, /ensureHealthConsent/);
assert.match(assessmentScript, /saveDraft/);
assert.match(resultWxml, /重新评测/);
assert.match(resultWxml, /查看历史结果/);
assert.match(historyScript, /compareRecent/);
assert.match(compareScript, /QUESTIONNAIRE_VERSION_MISMATCH/);
assert.match(consentWxml, /首页、产品、活动和会员支持不以同意为前提/);
assert.doesNotMatch(consentWxml, /任务|奖励|打卡/);

console.log("formal health tests ok");
