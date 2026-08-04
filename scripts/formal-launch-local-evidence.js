#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildAdminPerformanceReport } = require("./admin-performance-report");
const { buildPackageBudgetReport } = require("./miniprogram-performance-report");

const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot = path.join(projectRoot, "docs", "evidence");

const SCREENS = Object.freeze([
  {
    key: "welcome",
    title: "欢迎体验",
    surface: "MINIPROGRAM",
    sectionNode: "368:3",
    boardNodes: ["368:8", "368:12"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/welcome/index.wxml", "miniprogram/pages/welcome/index.wxss"],
  },
  {
    key: "home-and-shared-detail",
    title: "首页与共用详情",
    surface: "MINIPROGRAM",
    sectionNode: "368:50",
    boardNodes: ["368:55", "368:59"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/home/index.wxml", "miniprogram/subpkg/content/pages/detail/index.wxml"],
  },
  {
    key: "wechat-login-register",
    title: "微信登录注册",
    surface: "MINIPROGRAM",
    sectionNode: "369:40",
    boardNodes: ["369:45", "369:47", "369:50"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/login/index.wxml", "miniprogram/pages/register/index.wxml", "miniprogram/pages/legal/index.wxml"],
  },
  {
    key: "root4u-entry-assessment",
    title: "Root4U 入口与评测",
    surface: "MINIPROGRAM",
    sectionNode: "372:2",
    boardNodes: ["372:7", "372:9"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/health/index.wxml", "miniprogram/subpkg/health/pages/initial-assessment/index.wxml"],
  },
  {
    key: "root4u-result-safety",
    title: "Root4U 结果与安全",
    surface: "MINIPROGRAM",
    sectionNode: "372:14",
    boardNodes: ["372:19", "372:21"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/health-consent/index.wxml", "miniprogram/subpkg/health/pages/scale-assessment/index.wxml"],
  },
  {
    key: "activity-discovery-enrollment",
    title: "活动发现与报名",
    surface: "MINIPROGRAM",
    sectionNode: "372:143",
    boardNodes: ["372:148", "372:150", "372:154"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/activities/index.wxml", "miniprogram/subpkg/activity/pages/detail/index.wxml", "miniprogram/subpkg/activity/pages/enrollments/index.wxml"],
  },
  {
    key: "profile-guest-member",
    title: "我的访客与会员",
    surface: "MINIPROGRAM",
    sectionNode: "372:240",
    boardNodes: ["372:245", "372:247", "372:249"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/pages/profile/index.wxml", "miniprogram/subpkg/profile/pages/support/index.wxml"],
  },
  {
    key: "profile-privacy-account",
    title: "我的隐私与账号",
    surface: "MINIPROGRAM",
    sectionNode: "372:254",
    boardNodes: ["372:259", "372:261", "372:263"],
    viewport: "390x844",
    implementationPaths: ["miniprogram/subpkg/profile/pages/privacy-account/index.wxml", "miniprogram/subpkg/profile/pages/about/index.wxml"],
  },
  {
    key: "admin-release-workbench",
    title: "后台框架与发布工作台",
    surface: "ADMIN",
    sectionNode: "372:502",
    boardNodes: ["372:502"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/App.vue", "admin/src/modules/release/ReleaseWorkbench.vue"],
  },
  {
    key: "admin-content-operations",
    title: "内容运营",
    surface: "ADMIN",
    sectionNode: "372:593",
    boardNodes: ["372:593"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/content/WelcomeContentPage.vue", "admin/src/modules/content/HomeCarouselPage.vue"],
  },
  {
    key: "admin-shared-detail",
    title: "共用详情编辑",
    surface: "ADMIN",
    sectionNode: "372:747",
    boardNodes: ["372:747"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/content/SharedDetailPage.vue"],
  },
  {
    key: "admin-activities",
    title: "活动管理",
    surface: "ADMIN",
    sectionNode: "372:945",
    boardNodes: ["372:945"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/activities/ActivityManagementPage.vue"],
  },
  {
    key: "admin-registrations",
    title: "活动报名记录",
    surface: "ADMIN",
    sectionNode: "372:1096",
    boardNodes: ["372:1096"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/activities/ActivityRegistrationsPage.vue"],
  },
  {
    key: "admin-initialization",
    title: "初始化建档",
    surface: "ADMIN",
    sectionNode: "372:1248",
    boardNodes: ["372:1248"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/InitializationPage.vue"],
  },
  {
    key: "admin-scales",
    title: "量表管理",
    surface: "ADMIN",
    sectionNode: "372:1399",
    boardNodes: ["372:1399"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/ScaleManagementPage.vue"],
  },
  {
    key: "admin-recommendations",
    title: "推荐规则",
    surface: "ADMIN",
    sectionNode: "372:1550",
    boardNodes: ["372:1550"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/RecommendationRulesPage.vue"],
  },
  {
    key: "admin-lifestyle",
    title: "生活方式建议",
    surface: "ADMIN",
    sectionNode: "372:1701",
    boardNodes: ["372:1701"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/LifestyleAdvicePage.vue"],
  },
  {
    key: "admin-user-query",
    title: "用户查询",
    surface: "ADMIN",
    sectionNode: "372:1853",
    boardNodes: ["372:1853"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/users/UserQueryPage.vue"],
  },
  {
    key: "admin-audit",
    title: "操作审计",
    surface: "ADMIN",
    sectionNode: "372:2004",
    boardNodes: ["372:2004"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/audit/OperationAuditPage.vue"],
  },
  {
    key: "admin-publish-confirmation",
    title: "发布确认",
    surface: "ADMIN",
    sectionNode: "372:2155",
    boardNodes: ["372:2155"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/publish/PublishConfirmationDialog.vue"],
  },
]);

function validateScreenDefinitions() {
  assert.equal(SCREENS.length, 20, "R12 must map exactly 20 approved sections");
  assert.equal(new Set(SCREENS.map((screen) => screen.key)).size, 20, "screen keys must be unique");
  assert.equal(new Set(SCREENS.map((screen) => screen.sectionNode)).size, 20, "section nodes must be unique");
  SCREENS.forEach((screen) => screen.implementationPaths.forEach((file) => {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `mapped implementation missing: ${file}`);
  }));
}

function screenIndex(generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "LOCAL_IMPLEMENTATION_MAPPING",
    releaseGateEligible: false,
    designSource: {
      file: "myRoot",
      uri: "cocraft://localhost/file/684679021092544",
      approvedPageNode: "368:1",
      liveReadbackStatus: "NOT_PERFORMED_BY_THIS_EVIDENCE_GENERATOR",
    },
    expectedScreenCount: 20,
    mappedScreenCount: SCREENS.length,
    handoffClaims: {
      screenCount: null,
      archivedPagesExcluded: null,
      allCanonicalStatesCovered: false,
    },
    screens: SCREENS.map((screen) => ({
      ...screen,
      implementationStatus: "MAPPED_LOCAL_SOURCE",
      screenshotStatus: "PENDING_CONTROLLED_CAPTURE",
      screenshotRefs: [],
    })),
  };
}

function visualReview(generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "VISUAL_REVIEW_PENDING",
    status: "BLOCK",
    releaseGateEligible: false,
    requiredReviewCount: SCREENS.length,
    completedReviewCount: 0,
    reviews: SCREENS.map((screen) => ({
      key: screen.key,
      sectionNode: screen.sectionNode,
      status: "PENDING_CONTROLLED_CAPTURE",
      ownerRole: "ENGINEERING_AND_QA",
      reviewedAt: null,
      screenshotRefs: [],
      differences: [],
    })),
  };
}

function missingMiniProgramDeviceEvidence(generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "MISSING_EXTERNAL_EVIDENCE",
    gate: "REAL_DEVICE",
    status: "BLOCK",
    releaseGateEligible: false,
    requiredSamplesPerCoreScenario: 30,
    samples: [],
    missing: ["IOS_DEVICE", "ANDROID_DEVICE", "OFFICE_NETWORK", "WEAK_NETWORK", "WECHAT_BUILD_ARTIFACT"],
  };
}

function missingAdminQueryEvidence(generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "MISSING_CANDIDATE_EVIDENCE",
    gate: "QUERY",
    status: "BLOCK",
    releaseGateEligible: false,
    datasetVersion: "ADMIN_PERFORMANCE_R0",
    requiredSamplesPerScenario: 20,
    scenarios: ["list", "detail", "write", "audit"].map((scenario) => ({ scenario, sampleCount: 0, status: "BLOCK" })),
  };
}

function missingAdminBrowserEvidence(generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "MISSING_EXTERNAL_EVIDENCE",
    gate: "BROWSER",
    status: "BLOCK",
    releaseGateEligible: false,
    requiredBrowsers: ["Chrome", "Edge"],
    requiredNetworkProfiles: ["office", "weak"],
    requiredViewport: "1240x820",
    sampleCount: 0,
    samples: [],
  };
}

function regressionReview(kind, report) {
  if (kind === "miniprogram") {
    return `# 小程序性能回归审查（R0）\n\n- 当前证据：本地源码包体估算，状态 ${report.status}。\n- 正式资格：否；仍缺微信构建产物、iOS/Android 真机、弱网、30 次样本、P75/P95、帧率和内存。\n- 相对基线规则：增长 5% 预警，增长 10% 阻断；没有已批准正式基线时不得用本地旧数据替代。\n- 当前主包：${report.packages.main.bytes} bytes；总包：${report.packages.total.bytes} bytes。\n`;
  }
  return `# 运营后台性能回归审查（R0）\n\n- 构建 Gate：${report.status}；查询 Gate：BLOCK；浏览器 Gate：BLOCK。\n- 正式资格：否；仍缺固定候选环境查询样本和 Chrome/Edge 标准网络、弱网、30 分钟稳定性证据。\n- 相对基线规则：增长 5% 预警，增长 10% 阻断；不设置运营 Gate。\n- 当前首屏压缩体积：${report.metrics.firstScreenCompressed.value} bytes；总压缩体积：${report.metrics.totalCompressed.value} bytes。\n`;
}

function buildEvidence(generatedAt = new Date().toISOString()) {
  validateScreenDefinitions();
  const miniProgramPackage = buildPackageBudgetReport({
    projectRoot,
    evidenceClass: "LOCAL_FORMAL_SOURCE_ESTIMATE",
    generatedAt,
  });
  const adminBuild = buildAdminPerformanceReport({
    projectRoot,
    evidenceClass: "LOCAL_FORMAL_BUILD",
    generatedAt,
  });
  return new Map([
    ["ued-r0/screen-index.json", screenIndex(generatedAt)],
    ["ued-r0/visual-review.json", visualReview(generatedAt)],
    ["performance-r0/package-budget.json", miniProgramPackage],
    ["performance-r0/real-device-results.json", missingMiniProgramDeviceEvidence(generatedAt)],
    ["performance-r0/regression-review.md", regressionReview("miniprogram", miniProgramPackage)],
    ["admin-performance-r0/build-budget.json", adminBuild],
    ["admin-performance-r0/query-results.json", missingAdminQueryEvidence(generatedAt)],
    ["admin-performance-r0/browser-results.json", missingAdminBrowserEvidence(generatedAt)],
    ["admin-performance-r0/regression-review.md", regressionReview("admin", adminBuild)],
  ]);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "generatedAt")
    .map(([key, child]) => [key, stableJson(child)]));
}

function writeEvidence(evidence) {
  evidence.forEach((value, relativePath) => {
    const target = path.join(evidenceRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const output = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(target, output, "utf8");
  });
}

function checkEvidence(evidence) {
  evidence.forEach((expected, relativePath) => {
    const target = path.join(evidenceRoot, relativePath);
    assert.equal(fs.existsSync(target), true, `evidence missing: ${relativePath}`);
    if (typeof expected === "string") {
      assert.equal(fs.readFileSync(target, "utf8"), expected, `evidence stale: ${relativePath}`);
      return;
    }
    assert.deepEqual(stableJson(JSON.parse(fs.readFileSync(target, "utf8"))), stableJson(expected), `evidence stale: ${relativePath}`);
  });
}

function main() {
  const mode = process.argv[2] || "--check";
  if (!["--write", "--check"].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
  const evidence = buildEvidence();
  if (mode === "--write") writeEvidence(evidence);
  else checkEvidence(evidence);
  process.stdout.write(`formal launch local evidence ${mode === "--write" ? "written" : "verified"}: ${evidence.size} files\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Formal launch local evidence failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { SCREENS, buildEvidence, validateScreenDefinitions };
