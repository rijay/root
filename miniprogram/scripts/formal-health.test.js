const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = JSON.parse(read("app.json"));
const healthPackage = app.subPackages.find((item) => item.root === "subpkg/health");

assert.deepEqual(healthPackage.pages, [
  "pages/assessment/index",
  "pages/result/index",
  "pages/history/index",
  "pages/compare/index",
]);
assert.equal(healthPackage.pages.includes("pages/scale-assessment/index"), false);
assert.equal(healthPackage.pages.includes("pages/initial-assessment/index"), false);

const healthScript = read("pages/health/index.js");
const healthWxml = read("pages/health/index.wxml");
assert.match(healthScript, /getCatalog/);
assert.match(healthScript, /assessmentType=/);
assert.doesNotMatch(healthScript, /root4u\/scales|openRecommendedScale/);
assert.match(healthWxml, /初始评测与肠道规律自测/);
assert.match(healthWxml, /重新评测/);
assert.match(healthWxml, /评测历史与回测对比/);
assert.match(healthWxml, /不构成医疗诊断/);
assert.match(healthWxml, /不上传到 myRoot 服务器/);
assert.match(healthWxml, /最长保留 180 天/);
assert.doesNotMatch(healthWxml, /任务|奖励|打卡|订单/);

const assessmentScript = read("subpkg/health/pages/assessment/index.js");
const assessmentWxml = read("subpkg/health/pages/assessment/index.wxml");
assert.match(assessmentScript, /ensureHealthConsent/);
assert.match(assessmentScript, /routeGuard/);
assert.match(assessmentScript, /saveDraft/);
assert.match(assessmentScript, /completeAssessment/);
assert.match(assessmentScript, /requestedType/);
assert.match(assessmentScript, /shouldRedirectToIntro/);
assert.match(assessmentScript, /GUT_INTRO_PATH/);
assert.match(assessmentScript, /retryInitialize/);
assert.match(assessmentWxml, /本次为复测/);
assert.match(assessmentWxml, /上一步/);
assert.match(assessmentWxml, /提交评测/);
assert.match(assessmentWxml, /bristol-stool-scale\.jpg/);
assert.match(assessmentWxml, /不构成诊断、治疗或用药建议/);

const localAssessment = read("utils/local-health-assessment.js");
const localRetention = read("utils/local-health-retention.js");
assert.match(localAssessment, /GUT_REGULARITY/);
assert.match(localAssessment, /ROOT_GUT_5Q/);
assert.match(localAssessment, /questionnaireVersion:\s*2/);
assert.match(localAssessment, /resultCopyVersion:\s*5/);
assert.match(localAssessment, /REQUIRED_GUT_PRIORITY_ACTIONS\s*=\s*Object\.freeze/);
assert.match(localAssessment, /CONSTIPATION:\s*"补充益生元纤维，帮助软化便便促蠕动"/);
assert.match(localAssessment, /LOOSE:\s*"补充可溶性纤维，帮助吸水让便便成形"/);
assert.match(localAssessment, /ALTERNATING:\s*"补充益生元纤维，双向调节排便节奏"/);
assert.match(localAssessment, /SENSITIVE:\s*"补充低FODMAP益生元，温和滋养不胀气"/);
assert.match(localAssessment, /HEALTHY:\s*"日常补充益生元，持续滋养肠道有益菌"/);
assert.match(localAssessment, /answers\.Q2 === "D"/);
assert.doesNotMatch(localAssessment, /\["C", "D"\]\.includes\(answers\.Q2\)/);
assert.match(localAssessment, /以上建议仅供日常健康管理参考/);
assert.match(localRetention, /pruneExpiredAttempts/);
assert.match(localRetention, /cleanupExpiredLocalHealthData/);

const historyScript = read("subpkg/health/pages/history/index.js");
const resultScript = read("subpkg/health/pages/result/index.js");
const compareScript = read("subpkg/health/pages/compare/index.js");
assert.match(historyScript, /compareSelected/);
assert.match(historyScript, /compareRecent/);
assert.match(resultScript, /startAssessment/);
assert.match(resultScript, /rootGutTrialShortLink/);
assert.match(compareScript, /QUESTIONNAIRE_VERSION_MISMATCH/);

const consentWxml = read("pages/health-consent/index.wxml");
assert.match(consentWxml, /首页、活动和会员支持不以同意为前提/);
assert.doesNotMatch(consentWxml, /任务|奖励|打卡/);

const legalScript = read("pages/legal/index.js");
assert.match(legalScript, /问卷答案、评测结果和回测记录仅在当前设备处理/);
assert.match(legalScript, /不上传到 myRoot 服务器/);
assert.match(legalScript, /最长保留 180 天/);

console.log("v0.6.0 formal health tests ok");
