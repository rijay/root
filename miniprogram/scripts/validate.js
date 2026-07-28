const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
const privateConfigPath = path.join(root, "project.private.config.json");
const privateConfig = fs.existsSync(privateConfigPath)
  ? JSON.parse(fs.readFileSync(privateConfigPath, "utf8"))
  : null;
const requiredExts = ["js", "json", "wxml", "wxss"];
const missing = [];

function checkPage(pagePath) {
  requiredExts.forEach((ext) => {
    const file = path.join(root, `${pagePath}.${ext}`);
    if (!fs.existsSync(file)) missing.push(file);
  });
}

app.pages.forEach(checkPage);
(app.subPackages || []).forEach((pkg) => {
  pkg.pages.forEach((page) => checkPage(path.join(pkg.root, page)));
});

[
  "static/brand/logo.png",
  "static/banner/activity.png",
  "static/badge/complete.png",
  "static/tabbar/home.png",
  "static/tabbar/home_active.png",
  "static/tabbar/profile.png",
  "static/tabbar/profile_active.png",
  "static/icon/checkin.png",
  "static/icon/refund.png",
  "static/icon/shop.png",
].forEach((asset) => {
  if (!fs.existsSync(path.join(root, asset))) missing.push(path.join(root, asset));
});

for (let index = 1; index <= 7; index += 1) {
  const name = `type${index}.png`;
  if (!fs.existsSync(path.join(root, "static/stool", name))) missing.push(path.join(root, "static/stool", name));
}

require("../utils/options.js");
const routerModule = require("../utils/router.js");
const requestModule = require("../utils/request.js");
const activityActions = require("../utils/activity-actions.js");
const activityCommandRecovery = require("../utils/activity-command-recovery.js");
const cloudRoute = require("../utils/cloud-route.js");
const transientHealthState = require("../utils/transient-health-state.js");
require("../utils/legal.js");
const privacyAuthorization = require("../utils/privacy-authorization.js");
require("../utils/cloud-media-upload.js");
const healthConsent = require("../utils/health-consent.js");
const campaignJoin = require("../utils/campaign-join.js");
const reminderSubscribe = require("../utils/checkin-reminder-subscribe.js");
const runtimeEnv = require("../config/env.js");
const { appVersion } = require("../config/version.js");
const youzanJump = require("../utils/youzan-jump.js");
const {
  formatDateCn,
  formatDateRangeCn,
  formatDateTimeCn,
  formatRelativeDateCn,
} = require("../utils/date-display.js");
require("../utils/option-labels.js");
require("../utils/checkin-presenter.js");
require("../subpkg/checkin/utils/share-poster.js");

const dateChecks = [
  [formatDateCn("2026-05-24", { referenceYear: 2026 }), "5月24日"],
  [formatDateCn("2025-05-24", { referenceYear: 2026 }), "2025年5月24日"],
  [formatDateRangeCn("2026-05-20", "2026-05-26", { referenceYear: 2026 }), "5月20日 至 5月26日"],
  [formatRelativeDateCn("2026-05-24", "2026-05-24"), "今天 · 5月24日"],
  [formatRelativeDateCn("2025-12-31", "2026-01-01"), "昨天 · 2025年12月31日"],
  [formatDateTimeCn("2026-05-24T09:08:00+08:00", { referenceYear: 2026 }), "5月24日 09:08"],
];

dateChecks.forEach(([actual, expected]) => {
  if (actual !== expected) {
    console.error(`Date display check failed: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
});

const scannedPages = app.pages.concat(
  (app.subPackages || []).flatMap((pkg) => pkg.pages.map((page) => path.join(pkg.root, page)))
);
const disallowedCopy = [
  "自动发布朋友圈",
  "一键发布小红书",
  "治好",
  "立刻改善",
  "开发调试登录",
  "调试模式使用演示手机号",
  "dev_phone_code",
  "dev_wx_code",
  "useMockPhone",
  "allowMockPhoneLogin",
  "微信授权并开始",
  "微信授权登录",
  "需要手机号才能继续",
];
const copyProblems = [];
const nativeControlProblems = [];
const networkProblems = [];
const routeContractProblems = [];

const expectedV1Tabs = [
  ["pages/home/index", "首页"],
  ["pages/health/index", "健康"],
  ["pages/activities/index", "活动"],
  ["pages/tasks/index", "任务"],
  ["pages/profile/index", "我的"],
];
const actualTabs = (((app.tabBar || {}).list) || []).map((item) => [item.pagePath, item.text]);
if (JSON.stringify(actualTabs) !== JSON.stringify(expectedV1Tabs)) {
  routeContractProblems.push("app.json: tabBar must be 首页 / 健康 / 活动 / 任务 / 我的 in canonical order");
}
if (!app.window || app.window.navigationBarTitleText !== "myRoot") {
  routeContractProblems.push("app.json: global navigation title must be myRoot");
}
[
  "pages/health/index",
  "pages/activities/index",
  "subpkg/activity/pages/detail/index",
  "subpkg/activity/pages/enrollments/index",
].forEach((requiredRoute) => {
  if (!scannedPages.includes(requiredRoute)) {
    routeContractProblems.push(`app.json: missing v1 shell route ${requiredRoute}`);
  }
});
const tabPathSet = new Set(expectedV1Tabs.map(([pagePath]) => `/${pagePath}`));
scannedPages.forEach((pagePath) => {
  const file = path.join(root, `${pagePath}.js`);
  const script = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const switchTabPattern = /wx\.switchTab\(\{\s*url:\s*["']([^"']+)["']/g;
  let match = switchTabPattern.exec(script);
  while (match) {
    const target = match[1].split("?")[0];
    if (!tabPathSet.has(target)) {
      routeContractProblems.push(`${pagePath}.js: non-Tab route ${target} must not use wx.switchTab`);
    }
    match = switchTabPattern.exec(script);
  }
});

const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (appVersion !== packageVersion) {
  routeContractProblems.push(`version mismatch: config=${appVersion}, package=${packageVersion}`);
}

if (runtimeEnv.requestAdapter !== "cloudContainer") {
  networkProblems.push(`config/env.js: default requestAdapter must be cloudContainer, got ${runtimeEnv.requestAdapter}`);
}
if (!runtimeEnv.cloudEnvId || !runtimeEnv.cloudServiceName) {
  networkProblems.push("config/env.js: cloudEnvId and cloudServiceName are required for wx.cloud.callContainer");
}
if (runtimeEnv.youzanAppId === "wx1234567890abcdef" || runtimeEnv.youzanProductPath === "pages/product/detail?id=ROOT_PREBIOTIC") {
  networkProblems.push("config/env.js: Root member center purchase jump must not use placeholder appid or product path");
}
if (runtimeEnv.youzanAppId && !youzanJump.isConfiguredAppId(runtimeEnv.youzanAppId)) {
  networkProblems.push("config/env.js: youzanAppId must be empty or a real Root member center mini-program appid");
}
if (projectConfig.setting && projectConfig.setting.urlCheck !== true) {
  networkProblems.push("project.config.json: setting.urlCheck must be true before upload");
}
if (privateConfig && privateConfig.setting && privateConfig.setting.urlCheck === false) {
  networkProblems.push("project.private.config.json: setting.urlCheck must not disable domain checks");
}

const requiredUploadSettings = {
  ignoreUploadUnusedFiles: true,
  minified: true,
  minifyJS: true,
  minifyWXML: true,
  minifyWXSS: true,
  uploadWithSourceMap: false,
};
Object.entries(requiredUploadSettings).forEach(([setting, expected]) => {
  const projectValue = projectConfig.setting && projectConfig.setting[setting];
  if (projectValue !== expected) {
    networkProblems.push(`project.config.json: setting.${setting} must be ${expected} before upload`);
  }
  const privateValue = privateConfig && privateConfig.setting && privateConfig.setting[setting];
  if (privateConfig && privateValue !== undefined && privateValue !== expected) {
    networkProblems.push(`project.private.config.json: setting.${setting} must remain ${expected} before upload`);
  }
});

const requiredPackIgnores = [
  ["folder", ".git"],
  ["folder", "scripts"],
  ["folder", "fixtures"],
  ["folder", "pages/dev-identity-probe"],
  ["file", "package.json"],
  ["file", "README.md"],
  ["file", ".gitignore"],
  ["file", "project.private.config.json"],
];
const configuredPackIgnores = new Set(
  (((projectConfig.packOptions || {}).ignore) || []).map((rule) => `${rule.type}:${rule.value}`)
);
requiredPackIgnores.forEach(([type, value]) => {
  if (!configuredPackIgnores.has(`${type}:${value}`)) {
    networkProblems.push(`project.config.json: packOptions.ignore must exclude ${type}:${value}`);
  }
});

if (scannedPages.includes("pages/dev-identity-probe/index")) {
  routeContractProblems.push("app.json: development identity probe must not be registered in a release package");
}

const diagnosticSecrets = [
  "release-token-value-that-must-not-leak",
  "oAbCdEfGhIjKlMnOpQrStUvWxYz12",
  "uAbCdEfGhIjKlMnOpQrStUvWxYz12",
  "13800138000",
];
const diagnosticInputs = [
  `cloud.callContainer:fail 102 Bearer ${diagnosticSecrets[0]} openid: ${diagnosticSecrets[1]}`,
  `{\"unionid\":\"${diagnosticSecrets[2]}\",\"phone\":\"${diagnosticSecrets[3]}\"}`,
  `https://root.test/probe?openid=${diagnosticSecrets[1]}&code=${diagnosticSecrets[0]}`,
  `raw identity ${diagnosticSecrets[1]}`,
];
const safeDiagnostics = diagnosticInputs.map((errMsg) => JSON.stringify(requestModule.safeErrorSummary({
  errCode: 102,
  errMsg,
})));
if (safeDiagnostics.some((diagnostic) => diagnosticSecrets.some((value) => diagnostic.includes(value)))) {
  networkProblems.push("utils/request.js: diagnostic error summary must redact credentials and identity values");
}
if (safeDiagnostics.some((diagnostic) => !diagnostic.includes('"code":"102"'))) {
  networkProblems.push("utils/request.js: diagnostic error summary must preserve non-sensitive error codes");
}

async function verifyCloudTransportFailureMessage() {
  const rawIdentity = diagnosticSecrets[1];
  const originalWarn = console.warn;
  let diagnosticLog = "";
  console.warn = (...args) => {
    diagnosticLog = JSON.stringify(args);
  };
  global.wx = {
    getStorageSync() {
      return "";
    },
    cloud: {
      callContainer(options) {
        options.fail({
          errCode: 102,
          errMsg: `cloud.callContainer:fail 102 openid=${rawIdentity}`,
        });
      },
    },
  };
  try {
    await requestModule.request({ url: "/health" });
    return "utils/request.js: cloud transport failure must reject";
  } catch (error) {
    const message = error && error.message ? error.message : "";
    if (message !== "服务暂时不可用（云托管102）") {
      return `utils/request.js: cloud transport failure exposed unexpected message ${message}`;
    }
    if (message.includes(rawIdentity)) {
      return "utils/request.js: cloud transport failure exposed raw identity data";
    }
    if (!diagnosticLog.includes('"code":"102"') || diagnosticLog.includes(rawIdentity)) {
      return "utils/request.js: cloud transport diagnostic log is not safely redacted";
    }
    return "";
  } finally {
    delete global.wx;
    console.warn = originalWarn;
  }
}

async function verifyRootMemberCenterShortLinkJump() {
  const shortLink = "#小程序://ROOT会员中心/lnQOjYsk8gZoABH";
  const target = youzanJump.mergeJumpTarget(
    { productId: "ROOT_PREBIOTIC_7D_RESET" },
    {
      jumpTarget: {
        appId: "wxfb75c0b432670215",
        path: shortLink,
        envVersion: "release",
      },
    },
  );
  if (target.shortLink !== shortLink || target.path !== "" || target.appId !== "wxfb75c0b432670215") {
    return "utils/youzan-jump.js: Root member center short link target was not normalized correctly";
  }
  let capturedOptions = null;
  global.wx = {
    navigateToMiniProgram(options) {
      capturedOptions = options;
      options.success({ errMsg: "navigateToMiniProgram:ok" });
    },
  };
  try {
    await youzanJump.jumpToYouzanProduct(target);
  } catch (error) {
    return `utils/youzan-jump.js: Root member center short link jump failed ${error && error.message ? error.message : error}`;
  } finally {
    delete global.wx;
  }
  if (!capturedOptions || capturedOptions.shortLink !== shortLink || capturedOptions.envVersion !== "release") {
    return "utils/youzan-jump.js: navigateToMiniProgram did not receive the configured short link";
  }
  if (capturedOptions.appId || capturedOptions.path) {
    return "utils/youzan-jump.js: short link jump must not mix appId/path arguments";
  }
  return "";
}

async function verifyRuntimeInterfaces() {
  const checks = [verifyCloudTransportFailureMessage, verifyRootMemberCenterShortLinkJump];
  for (const check of checks) {
    const problem = await check();
    if (problem) return problem;
  }
  return "";
}

scannedPages.forEach((pagePath) => {
  ["js", "wxml"].forEach((ext) => {
    const file = path.join(root, `${pagePath}.${ext}`);
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    disallowedCopy.forEach((phrase) => {
      if (content.includes(phrase)) copyProblems.push(`${file}: contains ${phrase}`);
    });
  });
});

scannedPages.forEach((pagePath) => {
  const file = path.join(root, `${pagePath}.wxml`);
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const buttonPattern = /<button\b[^>]*\bopen-type="[^"]+"[^>]*>/g;
  const layoutClassPattern = /\b(menu-row|avatar-picker|root-card|root-cell-group|display-profile-card)\b/;
  const matches = content.match(buttonPattern) || [];
  matches.forEach((tag) => {
    const classMatch = tag.match(/\bclass="([^"]*)"/);
    const className = classMatch ? classMatch[1] : "";
    if (/\bhitarea\b/.test(className)) return;
    if (layoutClassPattern.test(className)) {
      nativeControlProblems.push(`${file}: native open-type button must not own layout class "${className}"`);
    }
  });
});

const homeLogin = fs.readFileSync(path.join(root, "pages/home/index.wxml"), "utf8");
const standaloneLogin = fs.readFileSync(path.join(root, "pages/login/index.wxml"), "utf8");
[
  ["pages/home/index.wxml", homeLogin],
  ["pages/login/index.wxml", standaloneLogin],
].forEach(([file, content]) => {
  if (!content.includes("微信身份进入")) {
    copyProblems.push(`${path.join(root, file)}: missing 微信身份进入 copy`);
  }
  if (!content.includes("手机号后续可选补充")) {
    copyProblems.push(`${path.join(root, file)}: missing optional phone copy`);
  }
  if (!content.includes("openPrivacyPolicy")) {
    copyProblems.push(`${path.join(root, file)}: privacy policy link is not wired`);
  }
});

const reviewPagePath = "subpkg/profile/pages/review/index";
const reviewRoute = "/subpkg/profile/pages/review/index";
const reviewPage = fs.readFileSync(path.join(root, "subpkg/profile/pages/review/index.wxml"), "utf8");
const reviewScript = fs.readFileSync(path.join(root, "subpkg/profile/pages/review/index.js"), "utf8");
const homePage = fs.readFileSync(path.join(root, "pages/home/index.wxml"), "utf8");
const homeScript = fs.readFileSync(path.join(root, "pages/home/index.js"), "utf8");
const rewardsPage = fs.readFileSync(path.join(root, "pages/rewards/index.wxml"), "utf8");
const profilePage = fs.readFileSync(path.join(root, "pages/profile/index.wxml"), "utf8");
const ordersPage = fs.readFileSync(path.join(root, "subpkg/profile/pages/orders/index.wxml"), "utf8");
const ordersScript = fs.readFileSync(path.join(root, "subpkg/profile/pages/orders/index.js"), "utf8");
const supportPage = fs.readFileSync(path.join(root, "subpkg/profile/pages/support/index.wxml"), "utf8");
const supportScript = fs.readFileSync(path.join(root, "subpkg/profile/pages/support/index.js"), "utf8");
const questionnaireScript = fs.readFileSync(path.join(root, "subpkg/task/pages/questionnaire/index.js"), "utf8");
const legacyTodayScript = fs.readFileSync(path.join(root, "subpkg/checkin/pages/today/index.js"), "utf8");
const privacyComponentScript = fs.readFileSync(path.join(root, "components/privacy-consent/index.js"), "utf8");
const privacyComponentPage = fs.readFileSync(path.join(root, "components/privacy-consent/index.wxml"), "utf8");
const legalPageScript = fs.readFileSync(path.join(root, "pages/legal/index.js"), "utf8");
const legalPage = fs.readFileSync(path.join(root, "pages/legal/index.wxml"), "utf8");
const legalModule = fs.readFileSync(path.join(root, "utils/legal.js"), "utf8");
const healthConsentPage = fs.readFileSync(path.join(root, "pages/health-consent/index.wxml"), "utf8");
const healthConsentScript = fs.readFileSync(path.join(root, "pages/health-consent/index.js"), "utf8");
const taskCheckinScript = fs.readFileSync(path.join(root, "subpkg/task/pages/checkin/index.js"), "utf8");
const taskProgressPage = fs.readFileSync(path.join(root, "subpkg/task/pages/progress/index.wxml"), "utf8");
const taskProgressScript = fs.readFileSync(path.join(root, "subpkg/task/pages/progress/index.js"), "utf8");
const tasksScript = fs.readFileSync(path.join(root, "pages/tasks/index.js"), "utf8");
const resultPageScript = fs.readFileSync(path.join(root, "subpkg/checkin/pages/result/index.js"), "utf8");
const sharePosterScript = fs.readFileSync(path.join(root, "subpkg/checkin/pages/share-poster/index.js"), "utf8");
const appScript = fs.readFileSync(path.join(root, "app.js"), "utf8");
const requestScript = fs.readFileSync(path.join(root, "utils/request.js"), "utf8");
const cloudRouteScript = fs.readFileSync(path.join(root, "utils/cloud-route.js"), "utf8");
const campaignJoinScript = fs.readFileSync(path.join(root, "utils/campaign-join.js"), "utf8");
const reminderSubscribeScript = fs.readFileSync(path.join(root, "utils/checkin-reminder-subscribe.js"), "utf8");
const activityDetailScript = fs.readFileSync(path.join(root, "subpkg/activity/pages/detail/index.js"), "utf8");
const activityDetailPage = fs.readFileSync(path.join(root, "subpkg/activity/pages/detail/index.wxml"), "utf8");
const activitiesScript = fs.readFileSync(path.join(root, "pages/activities/index.js"), "utf8");
const activityEnrollmentsScript = fs.readFileSync(path.join(root, "subpkg/activity/pages/enrollments/index.js"), "utf8");
const activityEnrollmentsPage = fs.readFileSync(path.join(root, "subpkg/activity/pages/enrollments/index.wxml"), "utf8");
const activityCommandRecoveryScript = fs.readFileSync(path.join(root, "utils/activity-command-recovery.js"), "utf8");
const loginScript = fs.readFileSync(path.join(root, "pages/login/index.js"), "utf8");
const registerScript = fs.readFileSync(path.join(root, "pages/register/index.js"), "utf8");

[
  "components/privacy-consent/index.js",
  "components/privacy-consent/index.json",
  "components/privacy-consent/index.wxml",
  "components/privacy-consent/index.wxss",
  "utils/privacy-authorization.js",
  "utils/cloud-media-upload.js",
  "utils/cloud-route.js",
  "utils/campaign-join.js",
  "utils/health-consent.js",
  "utils/transient-health-state.js",
  "utils/activity-actions.js",
  "utils/activity-command-recovery.js",
  "scripts/request.test.js",
  "scripts/activity-actions.test.js",
  "scripts/activity-command-recovery.test.js",
  "scripts/activity-enrollments-model.test.js",
  "subpkg/activity/pages/enrollments/model.js",
].forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) missing.push(path.join(root, file));
});

if (!app.usingComponents || app.usingComponents["privacy-consent"] !== "/components/privacy-consent/index") {
  routeContractProblems.push("app.json: privacy-consent must be registered globally");
}
if (typeof privacyAuthorization.initializePrivacyAuthorization !== "function") {
  routeContractProblems.push("privacy authorization Module is unavailable");
}

transientHealthState.clearTransientHealthData();
transientHealthState.setTransientHealthData(transientHealthState.TRANSIENT_HEALTH_KEYS.LAST_RESULT, {
  feedback: "sensitive-health-test-value",
});
const consumedHealthState = transientHealthState.consumeTransientHealthData(
  transientHealthState.TRANSIENT_HEALTH_KEYS.LAST_RESULT,
  null,
);
const consumedHealthStateAgain = transientHealthState.consumeTransientHealthData(
  transientHealthState.TRANSIENT_HEALTH_KEYS.LAST_RESULT,
  null,
);
const legacyStorageRemoved = [];
transientHealthState.clearLegacyTransientHealthStorage({
  removeStorageSync(key) {
    legacyStorageRemoved.push(key);
  },
});
if (!consumedHealthState || consumedHealthState.feedback !== "sensitive-health-test-value" || consumedHealthStateAgain !== null) {
  routeContractProblems.push("transient health state must be consumed exactly once");
}
if (!legacyStorageRemoved.includes("ROOT_LAST_RESULT") || !legacyStorageRemoved.includes("ROOT_SHARE_POSTER_PAYLOAD")) {
  routeContractProblems.push("app launch must remove legacy persistent health caches");
}
if (legacyTodayScript.includes('setStorageSync("ROOT_LAST_RESULT"') ||
  resultPageScript.includes('getStorageSync("ROOT_LAST_RESULT"') ||
  resultPageScript.includes('setStorageSync("ROOT_SHARE_POSTER_PAYLOAD"') ||
  sharePosterScript.includes('getStorageSync("ROOT_SHARE_POSTER_PAYLOAD"')) {
  routeContractProblems.push("check-in results and poster payloads must not use persistent storage");
}
if (!legacyTodayScript.includes("setTransientHealthData") ||
  !resultPageScript.includes("consumeTransientHealthData") ||
  !sharePosterScript.includes("consumeTransientHealthData") ||
  !appScript.includes("clearLegacyTransientHealthStorage")) {
  routeContractProblems.push("transient health state Interface is incomplete");
}
if (typeof cloudRoute.appendCloudRoute !== "function" ||
  typeof cloudRoute.refreshCloudRoute !== "function" ||
  !appScript.includes("initializeCloudRoute(options, env.envVersion)") ||
  !appScript.includes("refreshCloudRoute(options, env.envVersion)") ||
  !requestScript.includes("appendCloudRoute(options.url, env.envVersion)") ||
  !cloudRouteScript.includes('envVersion === "release"') ||
  /myroot_canary=[A-Za-z0-9_-]{8,}/.test(cloudRouteScript)) {
  routeContractProblems.push("cloud route Module must remain launch-scoped, release-disabled and free of route values");
}
if (typeof campaignJoin.joinCampaign !== "function" ||
  !homeScript.includes("joinCampaign") ||
  !tasksScript.includes("joinCampaign") ||
  campaignJoinScript.includes("requestCheckinReminderSubscribe")) {
  routeContractProblems.push("campaign join Module must keep the join Interface separate from user-gesture reminder authorization");
}
if (typeof requestModule.parseResponse !== "function" ||
  typeof requestModule.createRequestError !== "function") {
  routeContractProblems.push("utils/request.js: structured request error Interface is unavailable");
}
if (typeof activityActions.deriveActivityAction !== "function" ||
  typeof activityActions.createMemberSupportRouteIntent !== "function" ||
  !activityDetailScript.includes('"/api/v1/activities/enroll"') ||
  !activityDetailScript.includes('"/api/v1/activities/cancel"') ||
  !activityDetailScript.includes("fetchAuthoritativeDetail") ||
  !activityDetailPage.includes('bindtap="confirmActivityAction"') ||
  activityDetailPage.includes("报名暂不可操作")) {
  routeContractProblems.push("Activity write Module must confirm, submit and reconcile against authoritative detail");
}
if (typeof activityCommandRecovery.createActivityPendingCommandRegistry !== "function" ||
  !activityCommandRecoveryScript.includes("payloadDigest") ||
  !activityCommandRecoveryScript.includes("idempotencyKey") ||
  !activityDetailScript.includes("pendingCommands.claim") ||
  !activityDetailScript.includes("retryPendingAction") ||
  !activityDetailScript.includes("confirmVoidPendingAction") ||
  !activityDetailPage.includes("审计检索标识")) {
  routeContractProblems.push("activity detail must persist payload-scoped unresolved commands and expose explicit reuse/void recovery");
}
if (!activityDetailScript.includes("createActivityLoginRouteIntent") ||
  !loginScript.includes("activityLoginRecoveryUrl") ||
  !registerScript.includes("activityLoginRecoveryUrl") ||
  !loginScript.includes("requiresRegistration") ||
  !activityDetailScript.includes("resumeConfirmation")) {
  routeContractProblems.push("Activity login recovery must use a typed, expiring route intent and preserve registration");
}
if (!activityEnrollmentsScript.includes('"/api/v1/activities/cancel"') ||
  !activityEnrollmentsScript.includes("commandReachedAuthorityState") ||
  !activityEnrollmentsScript.includes("fetchAuthoritativeActivity") ||
  !activityEnrollmentsScript.includes("buildEnrollmentsUrl") ||
  !activityEnrollmentsScript.includes("groupEnrollments") ||
  !activityEnrollmentsPage.includes('catchtap="confirmCancel"') ||
  !activityEnrollmentsPage.includes('bindtap="confirmCancelFromSheet"') ||
  activityEnrollmentsScript.includes("wx.showModal")) {
  routeContractProblems.push("My Enrollments must confirm cancellation and reconcile the authoritative enrollment fact");
}
if (!activityEnrollmentsScript.includes("pendingCommands.claim") ||
  !activityEnrollmentsScript.includes("retryPendingCancel") ||
  !activityEnrollmentsScript.includes("confirmVoidPendingCancel") ||
  !activityEnrollmentsPage.includes("审计检索标识")) {
  routeContractProblems.push("my enrollments must persist unresolved cancellations and expose explicit reuse/void recovery");
}
if (typeof activityActions.createMyEnrollmentsLoginRouteIntent !== "function" ||
  !activitiesScript.includes("createMyEnrollmentsLoginRouteIntent") ||
  !activityEnrollmentsScript.includes("createMyEnrollmentsLoginRouteIntent") ||
  !loginScript.includes("activityLoginRecoveryUrl") ||
  !registerScript.includes("activityLoginRecoveryUrl")) {
  routeContractProblems.push("My Enrollments login recovery must use a typed, expiring read-only route intent");
}
if (typeof reminderSubscribe.preloadCheckinReminderTemplate !== "function" ||
  typeof reminderSubscribe.requestCheckinReminderSubscribe !== "function" ||
  !tasksScript.includes("preloadCheckinReminderTemplate") ||
  !taskProgressScript.includes("preloadCheckinReminderTemplate") ||
  !taskProgressPage.includes('bindtap="enableReminder"') ||
  taskCheckinScript.includes("requestCheckinReminderSubscribe")) {
  routeContractProblems.push("check-in reminder Module must preload before a dedicated user-tap authorization Interface");
}
if (reminderSubscribeScript.includes("getStorageSync") ||
  reminderSubscribeScript.includes("setStorageSync") ||
  reminderSubscribeScript.includes("ALREADY_DECIDED")) {
  routeContractProblems.push("check-in reminder subscription must defer persistent authorization choices to WeChat");
}
if (!privacyComponentScript.includes("initializePrivacyAuthorization") ||
  !privacyComponentScript.includes('buttonId: "root-privacy-agree"') ||
  !privacyComponentPage.includes('open-type="agreePrivacyAuthorization"') ||
  !privacyComponentPage.includes('id="root-privacy-agree"')) {
  routeContractProblems.push("privacy-consent: platform privacy authorization Interface is incomplete");
}
[
  "2026年7月11日",
  "敏感个人信息",
  "腾讯云 CloudBase",
  "有赞",
  "企业微信",
].forEach((requiredText) => {
  if (!legalPageScript.includes(requiredText)) {
    routeContractProblems.push(`pages/legal/index.js: missing privacy disclosure ${requiredText}`);
  }
});
if (!legalModule.includes("wx.openPrivacyContract")) {
  routeContractProblems.push("utils/legal.js: privacy policy entry must prefer the platform privacy contract");
}
if (!legalPageScript.includes("/api/v1/privacy/notice") ||
  !legalPage.includes("privacyNotice.controllerName") ||
  !legalPage.includes("privacyNotice.contact") ||
  !legalPage.includes("privacyNotice.retentionText")) {
  routeContractProblems.push("pages/legal: fallback privacy policy must expose configured controller, contact and retention period");
}
if (typeof healthConsent.ensureHealthConsent !== "function" ||
  !healthConsentPage.includes("单独同意并继续") ||
  !healthConsentPage.includes("撤回同意") ||
  !healthConsentScript.includes('decision: "GRANTED"') ||
  !healthConsentScript.includes('decision: "WITHDRAWN"')) {
  routeContractProblems.push("pages/health-consent: sensitive information consent and withdrawal Interface is incomplete");
}
if (!homePage.includes("viewType === 'healthConsent'") ||
  !homePage.includes("continueHealthConsent") ||
  !homeScript.includes('viewType: "healthConsent"') ||
  !homeScript.includes("ensureHealthConsent({ navigate: shouldNavigate })") ||
  !healthConsent.ensureHealthConsent.toString().includes("options.navigate !== false")) {
  routeContractProblems.push("pages/home: health consent handoff must remain recoverable after login");
}
if (!routerModule.routePermissions["/pages/health-consent/index"] ||
  !profilePage.includes("/pages/health-consent/index?mode=manage")) {
  routeContractProblems.push("health consent management route must remain reachable from profile");
}
[
  ["pages/home/index.js", homeScript],
  ["subpkg/task/pages/checkin/index.js", taskCheckinScript],
  ["subpkg/task/pages/questionnaire/index.js", questionnaireScript],
  ["subpkg/checkin/pages/today/index.js", legacyTodayScript],
].forEach(([file, script]) => {
  if (!script.includes("ensureHealthConsent")) routeContractProblems.push(`${file}: missing health consent Gate`);
});
[
  "pages/register/index.wxml",
  "pages/profile/index.wxml",
  "subpkg/checkin/pages/today/index.wxml",
  "subpkg/checkin/pages/share-poster/index.wxml",
].forEach((file) => {
  const page = fs.readFileSync(path.join(root, file), "utf8");
  if (!page.includes("<privacy-consent")) routeContractProblems.push(`${file}: missing privacy-consent presenter`);
});
if (!legacyTodayScript.includes("uploadCloudMedia") ||
  !legacyTodayScript.includes("deleteCloudMedia") ||
  legacyTodayScript.includes('/api/v1/upload/image')) {
  routeContractProblems.push("legacy check-in images must upload to CloudBase and clean up failed submissions");
}

if (!scannedPages.includes(reviewPagePath)) {
  routeContractProblems.push(`${reviewPagePath}: missing from app.json scanned pages`);
}
if (!routerModule.routePermissions[reviewRoute] || !routerModule.routePermissions[reviewRoute].includes("CHECKIN_COMPLETED")) {
  routeContractProblems.push(`${reviewRoute}: route guard must allow settled users to review status`);
}
if (!rewardsPage.includes(reviewRoute) && !rewardsPage.includes("openReviewPage")) {
  routeContractProblems.push("pages/rewards/index.wxml: missing status review entry");
}
if (!reviewPage.includes("review-note") || !reviewScript.includes("expectedResolutionAt") || !reviewScript.includes("slaText")) {
  routeContractProblems.push("subpkg/profile/pages/review: missing manual review SLA or public note display");
}
if (!reviewPage.includes("review-explanation") || !reviewScript.includes("evidenceRequired") || !reviewScript.includes("openReviewSectionCopy")) {
  routeContractProblems.push("subpkg/profile/pages/review: missing manual review explanation template display");
}
if (!profilePage.includes(reviewRoute)) {
  routeContractProblems.push("pages/profile/index.wxml: missing status review menu entry");
}
if (
  !homePage.includes("activityHome") ||
  !homePage.includes("Root 会员中心商品") ||
  !homeScript.includes("/api/v1/tasks/progress") ||
  !homeScript.includes("/api/v1/products") ||
  !homeScript.includes("openHomePrimaryTask")
) {
  routeContractProblems.push("pages/home: rebuilt myRoot activity home must expose campaign progress, tasks and product mirror entries");
}
if (!ordersPage.includes("同步说明") || !ordersPage.includes("查看商品") || !ordersScript.includes("/api/v1/user/orders")) {
  routeContractProblems.push("subpkg/profile/pages/orders: missing order sync explainer or orders Interface");
}
if (!ordersScript.includes('/pages/products/index') || !ordersScript.includes('/subpkg/profile/pages/support/index')) {
  routeContractProblems.push("subpkg/profile/pages/orders/index.js: missing product/support fallback route");
}
if (!supportPage.includes('open-type="contact"')) {
  routeContractProblems.push("subpkg/profile/pages/support/index.wxml: missing WeChat contact entry");
}
if (!supportScript.includes('/api/v1/tasks/events') || !supportScript.includes('taskType: "CONSULTATION"')) {
  routeContractProblems.push("subpkg/profile/pages/support/index.js: consultation must record task event");
}
if (!supportPage.includes("跟进状态") || !supportScript.includes("/api/v1/user/consultations")) {
  routeContractProblems.push("subpkg/profile/pages/support: missing consultation follow-up status Interface");
}
if (!questionnaireScript.includes("/api/v1/questionnaire/answers") || !questionnaireScript.includes("questionnaireType")) {
  routeContractProblems.push("subpkg/task/pages/questionnaire/index.js: questionnaire must submit through questionnaire answer Interface");
}

if (missing.length) {
  console.error(`Missing files:\\n${missing.join("\\n")}`);
  process.exit(1);
}

if (copyProblems.length) {
  console.error(`Disallowed user-facing copy:\\n${copyProblems.join("\\n")}`);
  process.exit(1);
}

if (nativeControlProblems.length) {
  console.error(`Native control layout risks:\\n${nativeControlProblems.join("\\n")}`);
  process.exit(1);
}

if (networkProblems.length) {
  console.error(`Network config risks:\\n${networkProblems.join("\\n")}`);
  process.exit(1);
}

if (routeContractProblems.length) {
  console.error(`Route contract risks:\\n${routeContractProblems.join("\\n")}`);
  process.exit(1);
}

verifyRuntimeInterfaces()
  .then((problem) => {
    if (problem) {
      console.error(`Network config risks:\\n${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log("miniprogram validation ok");
  })
  .catch((error) => {
    console.error(`Network config risks:\\n${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
