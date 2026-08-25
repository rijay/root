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
    implementationPaths: ["miniprogram/pages/health/index.wxml", "miniprogram/pages/health-consent/index.wxml", "miniprogram/subpkg/health/pages/scale-assessment/index.wxml"],
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
    boardNodes: ["372:506"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/App.vue", "admin/src/modules/release/ReleaseWorkbench.vue"],
  },
  {
    key: "admin-content-operations",
    title: "内容运营",
    surface: "ADMIN",
    sectionNode: "372:593",
    boardNodes: ["372:597"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/content/WelcomeContentPage.vue", "admin/src/modules/content/HomeCarouselPage.vue"],
  },
  {
    key: "admin-shared-detail",
    title: "共用详情编辑",
    surface: "ADMIN",
    sectionNode: "372:747",
    boardNodes: ["372:751"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/content/SharedDetailPage.vue"],
  },
  {
    key: "admin-activities",
    title: "活动管理",
    surface: "ADMIN",
    sectionNode: "372:945",
    boardNodes: ["372:949"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/activities/ActivityManagementPage.vue"],
  },
  {
    key: "admin-registrations",
    title: "活动报名记录",
    surface: "ADMIN",
    sectionNode: "372:1096",
    boardNodes: ["372:1100"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/activities/ActivityRegistrationsPage.vue"],
  },
  {
    key: "admin-initialization",
    title: "初始化建档",
    surface: "ADMIN",
    sectionNode: "372:1248",
    boardNodes: ["372:1252"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/InitializationPage.vue"],
  },
  {
    key: "admin-scales",
    title: "量表管理",
    surface: "ADMIN",
    sectionNode: "372:1399",
    boardNodes: ["372:1403"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/ScaleManagementPage.vue"],
  },
  {
    key: "admin-recommendations",
    title: "推荐规则",
    surface: "ADMIN",
    sectionNode: "372:1550",
    boardNodes: ["372:1554"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/RecommendationRulesPage.vue"],
  },
  {
    key: "admin-lifestyle",
    title: "生活方式建议",
    surface: "ADMIN",
    sectionNode: "372:1701",
    boardNodes: ["372:1705"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/health/LifestyleAdvicePage.vue"],
  },
  {
    key: "admin-user-query",
    title: "用户查询",
    surface: "ADMIN",
    sectionNode: "372:1853",
    boardNodes: ["372:1857"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/users/UserQueryPage.vue"],
  },
  {
    key: "admin-audit",
    title: "操作审计",
    surface: "ADMIN",
    sectionNode: "372:2004",
    boardNodes: ["372:2008"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/audit/OperationAuditPage.vue"],
  },
  {
    key: "admin-publish-confirmation",
    title: "发布确认",
    surface: "ADMIN",
    sectionNode: "372:2155",
    boardNodes: ["372:2239"],
    viewport: "1240x820",
    implementationPaths: ["admin/src/modules/publish/PublishConfirmationDialog.vue"],
  },
]);

const CONTROLLED_CAPTURED_AT = "2026-08-04T09:08:00.000Z";
const miniCapture = (names) => names.map((name) => `screenshots/implementation/miniprogram/${name}`);
const adminCapture = (name) => [`screenshots/implementation/admin/${name}`];
const referenceCapture = (name) => [`screenshots/reference/${name}`];

function referenceRefsFor(screen, review) {
  return [...new Set([
    ...screen.boardNodes.map((node) => `screenshots/reference/design-${node.replace(":", "_")}.png`),
    ...(review.referenceRefs || []),
  ])];
}

function beforeRefsFor(screen, review) {
  if (screen.surface !== "ADMIN") return [];
  return review.screenshotRefs.map((reference) => reference.replace(
    "screenshots/implementation/admin/",
    "screenshots/implementation/admin/before/",
  ));
}

const CONTROLLED_REVIEWS = Object.freeze({
  welcome: {
    screenshotRefs: miniCapture(["01-welcome-01.png", "01-welcome-02.png"]),
    captureClass: "LOCAL_SIMULATOR_HIGH_FIDELITY_ASSET",
    capturedAt: "2026-08-05T00:58:00.000Z",
    differences: ["已接入 Ardot 高保真欢迎页背景；正式上线前仍需用微信真机确认不同屏幕比例下的裁切与文字可读性。"],
  },
  "home-and-shared-detail": {
    screenshotRefs: miniCapture(["02-home.png", "02-content-detail.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["正式商品与活动摄影素材尚未进入代码库，当前使用开发占位背景。"],
  },
  "wechat-login-register": {
    screenshotRefs: miniCapture(["03-login.png", "03-register.png"]),
    captureClass: "LOCAL_SIMULATOR_RUNTIME",
    differences: ["微信隐私保护授权弹窗属于平台态，本轮未取得可重复截图。"],
  },
  "root4u-entry-assessment": {
    screenshotRefs: miniCapture(["04-health-entry.png", "04-health-initial-assessment.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["题目态使用本地临时代表数据，不证明候选环境问卷版本或真实用户数据。"],
  },
  "root4u-result-safety": {
    screenshotRefs: miniCapture(["05-health-result.png", "05-health-safety.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["结果与安全分流使用本地临时代表数据，不证明真实评分结果或医疗处置。"],
  },
  "activity-discovery-enrollment": {
    screenshotRefs: miniCapture(["06-activities.png", "06-activity-detail.png", "06-activity-enrollments-guest.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["活动卡片与详情使用本地临时代表数据，正式活动摄影与候选环境报名状态仍待验证。"],
  },
  "profile-guest-member": {
    screenshotRefs: miniCapture(["07-profile.png", "07-profile-member.png", "07-profile-member-failure.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["会员中心失败态为本地临时状态，不证明跨小程序跳转已在真机通过。"],
  },
  "profile-privacy-account": {
    screenshotRefs: miniCapture(["08-about-root.png", "08-privacy-account.png", "08-account-cancellation.png"]),
    captureClass: "LOCAL_MOCKED_STATE",
    differences: ["注销弹层仅验收视觉和文案，不代表注销申请已接入或提交。"],
  },
  "admin-release-workbench": {
    screenshotRefs: adminCapture("09-release-workbench.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖 5 项内容草稿与发布流程；设计示例中的阻断项、定时上线和回滚入口仍需候选环境数据复验。"],
  },
  "admin-content-operations": {
    screenshotRefs: adminCapture("10-content-operations.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖两条首页轮播与编辑抽屉；图片为受控本地占位素材，不替代正式摄影和候选环境素材尺寸复验。"],
  },
  "admin-shared-detail": {
    screenshotRefs: adminCapture("11-shared-detail.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖三张页面图、热点选择与路径编辑；当前目标处于待检查态，跨小程序和公众号白名单需候选环境复验。"],
  },
  "admin-activities": {
    screenshotRefs: adminCapture("12-activity-management.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖两条活动、一个开放场次和编辑抽屉；主视觉仍为受控占位素材，保存发布授权不在本地视觉证据范围内。"],
  },
  "admin-registrations": {
    screenshotRefs: adminCapture("13-activity-registrations.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖待确认与已报名记录以及状态详情抽屉；名单导出和审核写操作未执行。"],
  },
  "admin-initialization": {
    screenshotRefs: adminCapture("14-health-initialization.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖完整 12 问列表与安全适用性题目编辑抽屉；候选环境签署版本仍需复验。"],
  },
  "admin-scales": {
    screenshotRefs: adminCapture("15-health-scales.png"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖已发布/草稿两种量表及题目、计分、结果分层编辑态；代表量表为 2 道题，不替代候选内容版本。"],
  },
  "admin-recommendations": {
    screenshotRefs: adminCapture("16-health-recommendations.png"),
    referenceRefs: referenceCapture("372_1550-20260804_162258703.webp"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖两条规则、已发布量表映射和编辑抽屉；实际候选推荐配置仍需版本证据。"],
  },
  "admin-lifestyle": {
    screenshotRefs: adminCapture("17-health-lifestyle.png"),
    referenceRefs: referenceCapture("372_1701-20260804_162258704.webp"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖当前生效与草稿策略、固定降级和校验项编辑抽屉；本地固定建议不证明候选环境配置已发布。"],
  },
  "admin-user-query": {
    screenshotRefs: adminCapture("18-user-query.png"),
    referenceRefs: referenceCapture("372_1853-20260804_162258705.webp"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已按批准稿补齐统一列表与详情抽屉；为保留最小化数据 Interface，仍只允许完整手机号精确查询，不提供全量用户列表。"],
  },
  "admin-audit": {
    screenshotRefs: adminCapture("19-operation-audit.png"),
    referenceRefs: referenceCapture("372_2004-20260804_162258705.webp"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖两条脱敏审计记录与详情抽屉；代表记录为本地只读投影，不证明候选环境审计完整性。"],
  },
  "admin-publish-confirmation": {
    screenshotRefs: adminCapture("20-publish-confirmation.png"),
    referenceRefs: referenceCapture("372_2155-20260804_162258707.webp"),
    captureClass: "LOCAL_BROWSER_UED_REVIEW_STORE",
    differences: ["已覆盖 5 项内容变更的二次确认弹窗；小程序预览未完成，因此确认发布按规则保持禁用。"],
  },
});

function validateScreenDefinitions() {
  assert.equal(SCREENS.length, 20, "R12 must map exactly 20 approved sections");
  assert.equal(new Set(SCREENS.map((screen) => screen.key)).size, 20, "screen keys must be unique");
  assert.equal(new Set(SCREENS.map((screen) => screen.sectionNode)).size, 20, "section nodes must be unique");
  assert.deepEqual(Object.keys(CONTROLLED_REVIEWS).sort(), SCREENS.map((screen) => screen.key).sort(), "controlled review keys must match screen keys");
  SCREENS.forEach((screen) => screen.implementationPaths.forEach((file) => {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `mapped implementation missing: ${file}`);
  }));
  SCREENS.forEach((screen) => {
    const review = CONTROLLED_REVIEWS[screen.key];
    assert.equal(review.screenshotRefs.length > 0, true, `controlled screenshots missing: ${screen.key}`);
    review.screenshotRefs.forEach((reference) => {
      const target = path.join(evidenceRoot, "ued-r0", reference);
      assert.equal(fs.existsSync(target), true, `controlled screenshot file missing: ${reference}`);
      const header = fs.readFileSync(target).subarray(0, 24);
      assert.equal(header.subarray(1, 4).toString("ascii"), "PNG", `controlled screenshot must be PNG: ${reference}`);
      const expected = screen.surface === "ADMIN" ? [1240, 820] : [602, 1300];
      assert.deepEqual([header.readUInt32BE(16), header.readUInt32BE(20)], expected, `controlled screenshot dimensions invalid: ${reference}`);
    });
    referenceRefsFor(screen, review).forEach((reference) => {
      const target = path.join(evidenceRoot, "ued-r0", reference);
      assert.equal(fs.existsSync(target), true, `Ardot reference screenshot missing: ${reference}`);
      if (reference.endsWith(".png")) {
        const header = fs.readFileSync(target).subarray(0, 24);
        assert.equal(header.subarray(1, 4).toString("ascii"), "PNG", `Ardot reference must be PNG: ${reference}`);
        assert.equal(header.readUInt32BE(16) > 0 && header.readUInt32BE(20) > 0, true, `Ardot reference dimensions invalid: ${reference}`);
      }
    });
    beforeRefsFor(screen, review).forEach((reference) => {
      assert.equal(fs.existsSync(path.join(evidenceRoot, "ued-r0", reference)), true, `controlled before screenshot missing: ${reference}`);
    });
  });
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
      liveReadbackStatus: "VERIFIED_2026-08-04_20_TOP_LEVEL_SECTIONS",
    },
    expectedScreenCount: 20,
    mappedScreenCount: SCREENS.length,
    handoffClaims: {
      screenCount: 20,
      archivedPagesExcluded: true,
      allCanonicalStatesCovered: false,
    },
    screens: SCREENS.map((screen) => {
      const review = CONTROLLED_REVIEWS[screen.key];
      return {
        ...screen,
        implementationStatus: "MAPPED_LOCAL_SOURCE",
        screenshotStatus: "CONTROLLED_CAPTURE_COMPLETE",
        captureClass: review.captureClass,
        screenshotRefs: review.screenshotRefs,
        beforeRefs: beforeRefsFor(screen, review),
        referenceRefs: referenceRefsFor(screen, review),
      };
    }),
  };
}

function visualReview(generatedAt) {
  const directComparisons = SCREENS.filter((screen) => referenceRefsFor(screen, CONTROLLED_REVIEWS[screen.key]).length > 0);
  return {
    schemaVersion: 1,
    generatedAt,
    evidenceClass: "LOCAL_CONTROLLED_VISUAL_REVIEW_COMPLETE",
    status: "BLOCK",
    releaseGateEligible: false,
    requiredReviewCount: SCREENS.length,
    controlledCaptureCount: SCREENS.length,
    completedReviewCount: directComparisons.length,
    referenceExportBlockedCount: SCREENS.length - directComparisons.length,
    allCanonicalStatesCovered: false,
    externalGatesRemain: ["WECHAT_PRIVACY_AUTHORIZATION", "REAL_DEVICE_IOS", "REAL_DEVICE_ANDROID", "FORMAL_PHOTOGRAPHY", "CANDIDATE_DATA_STATES"],
    reviews: SCREENS.map((screen) => {
      const review = CONTROLLED_REVIEWS[screen.key];
      const directlyCompared = referenceRefsFor(screen, review).length > 0;
      return {
        key: screen.key,
        sectionNode: screen.sectionNode,
        boardNodes: screen.boardNodes,
        status: directlyCompared ? "REVIEWED_WITH_OPEN_DIFFERENCES" : "CAPTURED_REFERENCE_EXPORT_BLOCKED",
        ownerRole: "ENGINEERING_AND_QA",
        capturedAt: review.capturedAt || CONTROLLED_CAPTURED_AT,
        reviewedAt: directlyCompared ? (review.capturedAt || CONTROLLED_CAPTURED_AT) : null,
        viewport: screen.viewport,
        captureClass: review.captureClass,
        referenceStatus: directlyCompared ? "ARDOT_REFERENCE_EXPORTED" : "ARDOT_LIVE_READBACK_CONFIRMED_EXPORT_TIMEOUT",
        screenshotRefs: review.screenshotRefs,
        beforeRefs: beforeRefsFor(screen, review),
        referenceRefs: referenceRefsFor(screen, review),
        differences: review.differences,
      };
    }),
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
