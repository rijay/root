const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const healthJson = JSON.parse(read("pages/health/index.json"));
const healthWxml = read("pages/health/index.wxml");
const healthWxss = read("pages/health/index.wxss");
const healthScript = read("pages/health/index.js");

assert.equal(healthJson.usingComponents["campaign-popup"], "/components/campaign-popup/index");
assert.match(healthWxml, /MY HEALTH · ROOT/);
assert.match(healthWxml, /assessment-card--/);
assert.match(healthWxml, /历史结果/);
assert.match(healthWxml, /本页不提供疾病诊断/);
assert.match(healthWxss, /linear-gradient\(148deg, var\(--color-brand-olive\)/);
assert.match(healthWxss, /var\(--color-olive-mid\)/);
assert.match(healthScript, /syncTabBar\(this, 2\)/);
assert.match(healthScript, /confirmRetest/);
assert.match(healthScript, /getHealthConsentStatus/);

const assessmentScript = read("subpkg/health/pages/assessment/index.js");
const assessmentWxml = read("subpkg/health/pages/assessment/index.wxml");
const resultWxml = read("subpkg/health/pages/result/index.wxml");
const historyWxml = read("subpkg/health/pages/history/index.wxml");
const compareWxml = read("subpkg/health/pages/compare/index.wxml");

assert.match(assessmentScript, /persistDraft/);
assert.match(assessmentScript, /ensureHealthConsent/);
assert.match(assessmentWxml, /progressPercent/);
assert.match(resultWxml, /重新评测/);
assert.match(resultWxml, /查看历史结果/);
assert.match(historyWxml, /自选两次对比/);
assert.match(compareWxml, /同一问卷 ID、同一版本/);

console.log("Root v0.6.0 health high-fidelity contract PASS");
