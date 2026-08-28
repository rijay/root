const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const healthJson = JSON.parse(read("pages/health/index.json"));
const healthWxml = read("pages/health/index.wxml");
const healthWxss = read("pages/health/index.wxss");
assert.equal(healthJson.usingComponents["root-wordmark"], "/components/root-wordmark/index");
assert.match(healthWxml, /health-entry__tab-header/);
assert.match(healthWxml, /health-entry__wordmark/);
assert.match(healthWxml, /health-assessment-list/);
assert.match(healthWxml, /health-assessment-card__start/);
assert.match(healthWxss, /health-entry__tab-header\s*\{[^}]*top:\s*78px[^}]*align-items:\s*center[^}]*height:\s*38px/s);
assert.match(healthWxss, /health-entry__wordmark\s*\{[^}]*width:\s*84px[^}]*height:\s*22px/s);
assert.match(healthWxss, /health-entry__title\s*\{[^}]*top:\s*168px/s);
assert.match(healthWxss, /health-entry--v060\s*\{[^}]*padding-top:\s*338px/s);
assert.match(healthWxss, /health-assessment-list\s*\{[^}]*position:\s*static[^}]*margin:\s*0 20px/s);
assert.match(healthWxss, /health-history-entry\s*\{[^}]*position:\s*static/s);
assert.match(healthWxss, /health-assessment-card__start\s*\{[^}]*flex:\s*1[^}]*width:\s*auto\s*!important[^}]*min-width:\s*0/s);
assert.match(healthWxss, /health-assessment-card__start\s*\{[^}]*height:\s*44px/s);
assert.match(healthWxss, /health-assessment-card__latest\s*\{[^}]*min-height:\s*44px/s);
assert.match(healthWxss, /health-history-entry\s*\{[^}]*width:\s*calc\(100% - 40px\)\s*!important/s);
assert.match(healthWxss, /health-history-entry\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
assert.match(healthWxss, /health-history-entry\s*\{[^}]*padding:\s*0 16px[^}]*line-height:\s*20px[^}]*text-align:\s*center/s);
assert.match(healthWxss, /health-local-note\s*\{[^}]*display:\s*block[^}]*width:\s*calc\(100% - 56px\)[^}]*margin:\s*14px 28px 0[^}]*box-sizing:\s*border-box/s);
assert.match(healthWxss, /health-local-note\s*\{[^}]*white-space:\s*normal[^}]*word-break:\s*break-all/s);
assert.match(healthWxss, /health-overview-card\s*\{[^}]*position:\s*static[^}]*margin:\s*22px 20px 0/s);

const assessmentWxml = read("subpkg/health/pages/assessment/index.wxml");
const assessmentWxss = read("subpkg/health/pages/assessment/index.wxss");
assert.match(assessmentWxml, /assessment-progress__track/);
assert.match(assessmentWxml, /question-card/);
assert.match(assessmentWxml, /assessment-save/);
assert.match(assessmentWxml, /previous-action/);
assert.match(assessmentWxml, /next-action/);
assert.match(assessmentWxss, /assessment-content\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
assert.match(assessmentWxss, /answer-option\.is-selected/);
assert.match(assessmentWxss, /answer-option\s*\{[^}]*width:\s*100%\s*!important/s);
assert.match(assessmentWxss, /previous-action\s*\{[^}]*width:\s*210rpx\s*!important/s);
assert.match(assessmentWxss, /next-action\s*\{[^}]*width:\s*auto\s*!important[^}]*min-width:\s*0/s);
assert.match(assessmentWxss, /assessment-actions\s*\{[^}]*background:\s*var\(--color-root-bg\)/s);

const historyWxml = read("subpkg/health/pages/history/index.wxml");
const resultWxml = read("subpkg/health/pages/result/index.wxml");
const compareWxml = read("subpkg/health/pages/compare/index.wxml");
assert.match(historyWxml, /compareSelected/);
assert.match(resultWxml, /restart/);
assert.match(compareWxml, /reasonText/);

const tabWxml = read("custom-tab-bar/index.wxml");
const tabScript = read("custom-tab-bar/index.js");
assert.match(tabWxml, /wx:if="\{\{!hidden\}\}"/);
assert.match(tabScript, /setHidden/);

console.log("v0.6.0 health high-fidelity checks passed");
