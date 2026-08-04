const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const healthJson = JSON.parse(read("pages/health/index.json"));
const healthWxml = read("pages/health/index.wxml");
const healthWxss = read("pages/health/index.wxss");
const healthScript = read("pages/health/index.js");

assert.equal(healthJson.usingComponents["root-wordmark"], "/components/root-wordmark/index");
assert.equal(healthJson.usingComponents["page-navigation"], "/components/page-navigation/index");
assert.match(healthWxml, /health-entry__wordmark/);
assert.match(healthWxml, /health-entry__step health-entry__step--active/);
assert.match(healthWxml, /health-result__classification/);
assert.match(healthWxml, /health-safety-screen/);
assert.match(healthWxml, /今天先从三件小事开始/);
assert.match(healthWxss, /health-entry__wordmark\s*\{[^}]*top:\s*74px/s);
assert.match(healthWxss, /health-entry__title\s*\{[^}]*top:\s*168px/s);
assert.match(healthWxss, /health-entry__step--01\s*\{[^}]*top:\s*326px/s);
assert.match(healthWxss, /health-entry__start\s*\{[^}]*top:\s*610px/s);
assert.match(healthWxss, /health-entry__step\s*\{[^}]*width:\s*calc\(100% - 40px\)/s);
assert.match(healthWxss, /health-entry__start,[\s\S]*width:\s*calc\(100% - 40px\) !important/);
assert.match(healthWxss, /health-result__classification\s*\{[^}]*top:\s*132px/s);
assert.match(healthWxss, /health-result__tips-title\s*\{[^}]*top:\s*326px/s);
assert.match(healthWxss, /health-safety-screen__return\s*\{[^}]*top:\s*724px/s);
assert.match(healthScript, /applyBootstrap/);
assert.match(healthScript, /hidden:\s*safety/);

const assessmentJson = JSON.parse(read("subpkg/health/pages/initial-assessment/index.json"));
const assessmentWxml = read("subpkg/health/pages/initial-assessment/index.wxml");
const assessmentWxss = read("subpkg/health/pages/initial-assessment/index.wxss");
const assessmentScript = read("subpkg/health/pages/initial-assessment/index.js");

assert.equal(assessmentJson.usingComponents["page-navigation"], "/components/page-navigation/index");
assert.match(assessmentWxml, /<page-navigation show-home="\{\{false\}\}"/);
assert.match(assessmentWxml, /\{\{progressLabel\}\}/);
assert.match(assessmentWxml, /style="width: 350px;"/);
assert.doesNotMatch(assessmentWxml, />上一步</);
assert.match(assessmentWxss, /assessment-progress\s*\{[^}]*top:\s*76px/s);
assert.match(assessmentWxss, /assessment-progress__track\s*\{[^}]*top:\s*122px/s);
assert.match(assessmentWxss, /assessment-title\s*\{[^}]*top:\s*196px/s);
assert.match(assessmentWxss, /assessment-options\s*\{[^}]*top:\s*294px/s);
assert.match(assessmentWxss, /assessment-next\s*\{[^}]*bottom:\s*64px/s);
assert.match(assessmentScript, /padStart\(2, "0"\)/);
assert.match(assessmentScript, /if \(this\.data\.currentIndex > 0\)/);
assert.match(assessmentScript, /这次使用 Root，\\n最想先改善哪类状态/);
assert.match(assessmentScript, /Math\.max\(844, 294 \+ optionCount \* 62 \+ 150\)/);

const tabWxml = read("custom-tab-bar/index.wxml");
const tabScript = read("custom-tab-bar/index.js");
assert.match(tabWxml, /wx:if="\{\{!hidden\}\}"/);
assert.match(tabScript, /setHidden/);
assert.match(read("components/page-navigation/index.js"), /interceptBack/);

console.log("Root4U high-fidelity contract: 33/33 PASS");
