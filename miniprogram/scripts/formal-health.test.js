const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = JSON.parse(read("app.json"));
const healthPackage = app.subPackages.find((item) => item.root === "subpkg/health");

assert.deepEqual(healthPackage.pages, [
  "pages/assessment/index",
  "pages/source-confirmation/index",
  "pages/result/index",
  "pages/history/index",
  "pages/compare/index",
]);
assert.equal(healthPackage.pages.includes("pages/scale-assessment/index"), false);
assert.equal(healthPackage.pages.includes("pages/initial-assessment/index"), false);
assert.equal(fs.existsSync(path.join(root, "subpkg/health/pages/scale-assessment")), false);
assert.equal(fs.existsSync(path.join(root, "subpkg/health/pages/initial-assessment")), false);

const healthScript = read("pages/health/index.js");
const healthWxml = read("pages/health/index.wxml");
assert.match(healthScript, /getCatalog/);
assert.match(healthScript, /assessmentType=/);
assert.doesNotMatch(healthScript, /root4u\/scales|openRecommendedScale/);
assert.match(healthWxml, /初始评测与肠道规律自测/);
assert.match(healthWxml, /重新评测/);
assert.match(healthWxml, /评测历史与回测对比/);
assert.match(healthWxml, /不构成医疗诊断/);
assert.match(healthWxml, /保存到你的 myRoot 账号/);
assert.match(healthWxml, /评测历史中删除/);
assert.doesNotMatch(healthWxml, /任务|奖励|打卡|订单/);

const assessmentScript = read("subpkg/health/pages/assessment/index.js");
const assessmentWxml = read("subpkg/health/pages/assessment/index.wxml");
assert.match(assessmentScript, /ensureHealthConsent/);
assert.match(assessmentScript, /routeGuard/);
assert.match(assessmentScript, /saveDraft/);
assert.match(assessmentScript, /completeAssessment/);
assert.match(assessmentScript, /requestedType/);
assert.match(assessmentScript, /assessmentTypeFromOptions/);
assert.doesNotMatch(assessmentScript, /assessment_type \|\| "INITIAL"/);
assert.match(assessmentScript, /shouldRedirectToIntro/);
assert.match(assessmentScript, /GUT_INTRO_PATH/);
assert.match(assessmentScript, /retryInitialize/);
assert.match(assessmentWxml, /本次为复测/);
assert.match(assessmentWxml, /上一步/);
assert.match(assessmentWxml, /提交评测/);
assert.match(assessmentWxml, /bristol-stool-scale\.jpg/);
assert.match(assessmentWxml, /不构成诊断、治疗或用药建议/);

const healthAssessmentClient = read("utils/health-assessment.js");
assert.doesNotMatch(healthAssessmentClient, /LOCAL_DEVICE|local-health-assessment|local-health-retention/);
assert.match(healthAssessmentClient, /storageMode:\s*"SERVER"/);

const historyScript = read("subpkg/health/pages/history/index.js");
const resultScript = read("subpkg/health/pages/result/index.js");
const compareScript = read("subpkg/health/pages/compare/index.js");
assert.match(historyScript, /compareSelected/);
assert.match(historyScript, /compareRecent/);
assert.match(historyScript, /deleteAssessment/);
assert.match(resultScript, /startAssessment/);
assert.match(resultScript, /deleteAssessment/);
assert.match(resultScript, /rootGutTrialShortLink/);
assert.match(compareScript, /QUESTIONNAIRE_VERSION_MISMATCH/);

const consentWxml = read("pages/health-consent/index.wxml");
assert.match(consentWxml, /首页、活动和会员支持不以同意为前提/);
assert.match(consentWxml, /健康建议说明/);
assert.match(consentWxml, /notice\.modelProcessingText/);
assert.match(consentWxml, /class="consent-dock"/);
assert.match(read("pages/health-consent/index.wxss"), /\.consent-dock\s*\{[^}]*position:\s*fixed/s);
assert.doesNotMatch(consentWxml, /任务|奖励|打卡/);
assert.doesNotMatch(consentWxml, /Gate/);

const legalScript = read("pages/legal/index.js");
assert.match(legalScript, /保存到你的 myRoot 账号/);
assert.match(legalScript, /评测历史中随时删除/);
assert.match(legalScript, /三、健康建议/);
assert.match(legalScript, /合成状态场景/);
assert.match(legalScript, /不使用任何真实用户/);
assert.match(legalScript, /不对外提供用户身份/);
assert.doesNotMatch(legalScript, /AI 辅助|模型辅助|CloudBase AI|实时模型/);

console.log("v0.8.0 formal health tests ok");
