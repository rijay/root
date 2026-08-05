const { createApp } = require("../src/app");
const activityModule = require("../src/activityModule");
const contentModule = require("../src/contentModule");
const healthOperations = require("../src/healthOperationsModule");
const { createSeedData } = require("../src/seed");

const PORT = Number(process.env.PORT || 8787);
const NOW = "2026-08-04T08:00:00.000Z";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function contentContext() {
  return {
    now: NOW,
    operatorId: "ued-review-operator",
    env: {
      ROOT_CONTENT_WEBVIEW_HOSTS: JSON.stringify(["www.root.com"]),
      ROOT_MEMBER_CENTER_APPID: "wx-root-member-center",
    },
  };
}

function upload(data, scope, name) {
  const prepared = contentModule.prepareAssetUpload({
    scope,
    name,
    mimeType: "image/png",
    dataBase64: PNG_1X1,
  }, contentContext());
  return contentModule.recordUploadedAsset(data, prepared, {
    provider: "UED_REVIEW",
    externalRef: `https://assets.root.test/${prepared.objectKey}`,
  }).asset;
}

function seedContent(data) {
  const welcome1 = upload(data, "welcome-1", "welcome-foundation.png");
  const welcome2 = upload(data, "welcome-2", "welcome-balance.png");
  const detailAssets = [1, 2, 3].map((index) => upload(data, "shared-detail", `foundation-${index}.png`));
  const homeAssets = [1, 2].map((index) => upload(data, "home-carousel", `home-${index}.png`));

  contentModule.saveWelcomeDraft(data, {
    slot: 1,
    copy: "欢迎加入 Root Member Club\nSustained Foundation Balance",
    assetId: welcome1.assetId,
  }, contentContext());
  contentModule.saveWelcomeDraft(data, {
    slot: 2,
    copy: "平衡不是控制，而是理解。人如草木，根定而生。",
    assetId: welcome2.assetId,
  }, contentContext());
  const detail = contentModule.saveSharedDetailDraft(data, {
    title: "Root Foundation",
    previewCopy: "从肠道开始，理解身体的节奏",
    assets: detailAssets.map((asset, index) => ({
      assetId: asset.assetId,
      order: index + 1,
      hotspots: index === 0 ? [{
        id: "foundation-hotspot-1",
        x: 12,
        y: 48,
        width: 76,
        height: 14,
        targetType: "MINIPROGRAM_PAGE",
        target: "/pages/activities/index",
      }] : [],
    })),
  }, contentContext()).version;

  [
    [1, "Root Foundation 01", "把每天的选择，\n还给身体自己的节奏", 2, "LARGE", homeAssets[0]],
    [2, "身体节奏工作坊", "从日常感受出发，\n重新理解饮食与作息", 2, "MEDIUM", homeAssets[1]],
  ].forEach(([order, internalName, copy, lineCount, fontSize, asset]) => {
    contentModule.saveHomeCarouselDraft(data, {
      order,
      internalName,
      copy,
      assetId: asset.assetId,
      lineCount,
      fontSize,
      alignment: "CENTER",
      sharedDetailVersionId: detail.versionId,
      scheduleRange: ["2026-08-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"],
    }, contentContext());
  });
  return detail;
}

function activityInput(overrides = {}) {
  return {
    activityId: "activity_film_festival",
    activityVersionId: "activity_film_festival_v2",
    version: 2,
    title: "江畔时光电影节",
    summary: "7 月 18 日 17:30 · 黄浦江边 · 线下活动",
    objective: "在线下相遇，重新感受身体与城市的流动",
    audience: "希望改善生活节律的 ROOT 用户",
    agenda: "签到；热身；主题交流；自由观影",
    organizer: "ROOT 生活方式团队",
    feeDescription: "会员活动",
    bringItems: "请携带饮用水",
    cancelPolicy: "可在取消截止时间前自行取消",
    privacyNoticeText: "报名信息仅用于活动组织和通知",
    photographyNoticeText: "现场摄影仅用于已授权范围",
    contactDisplay: "ROOT 活动运营",
    detailVersion: "detail-film-v2",
    city: "上海",
    venueSummary: "陆家嘴富都滨江欢乐广场",
    activityType: "OFFLINE_EVENT",
    heroAssetRef: "ASSET_FILM_FESTIVAL",
    privacyNoticeRef: "PRIVACY_FILM_FESTIVAL",
    photographyNoticeRef: "PHOTO_FILM_FESTIVAL",
    contentApprovalRef: "APPROVAL_FILM_FESTIVAL",
    contactOwnerSignerRef: "ROOT_ACTIVITY_OPERATIONS",
    source: "OPS_BACKEND",
    ...overrides,
  };
}

function seedActivities(data) {
  const published = activityModule.upsertDraft(data, activityInput(), { now: NOW });
  const publishedRow = data.activityDefinitionVersions.find((row) => row.activity_version_id === published.activityVersionId);
  publishedRow.status = "PUBLISHED";
  publishedRow.published_at = NOW;
  activityModule.upsertDraft(data, activityInput({
    activityId: "activity_animal_flow",
    activityVersionId: "activity_animal_flow_v1",
    version: 1,
    title: "Animal Flow 体验课",
    summary: "7 月 25 日 13:30 · 静安区 · 线下课程",
    objective: "通过自重训练提升活动度、协调性与身体控制能力",
    agenda: "签到；动作讲解；分组练习；拉伸",
    detailVersion: "detail-animal-flow-v1",
    venueSummary: "静安区江宁路 418 号",
    heroAssetRef: "ASSET_ANIMAL_FLOW",
    privacyNoticeRef: "PRIVACY_ANIMAL_FLOW",
    photographyNoticeRef: "PHOTO_ANIMAL_FLOW",
    contentApprovalRef: "APPROVAL_ANIMAL_FLOW",
  }), { now: "2026-08-04T07:30:00.000Z" });

  data.activitySessions.push({
    activity_session_id: "session_film_festival",
    activity_version_id: published.activityVersionId,
    status: "OPEN",
    approval_mode: "AUTO",
    capacity: 80,
    registration_open_at: "2026-08-01T00:00:00.000Z",
    registration_close_at: "2026-08-17T12:00:00.000Z",
    cancel_close_at: "2026-08-17T12:00:00.000Z",
    review_deadline: null,
    session_start_at: "2026-08-18T09:30:00.000Z",
    session_end_at: "2026-08-18T12:00:00.000Z",
    allow_reapply: true,
    created_at: NOW,
    updated_at: NOW,
  });
  data.activityEnrollments.push(
    {
      activity_enrollment_id: "enrollment_root_user",
      activity_session_id: "session_film_festival",
      root_user_id: "root_ued_001",
      status: "CONFIRMED",
      reason_code: null,
      attempt_generation: 1,
      created_at: "2026-08-03T02:20:00.000Z",
      updated_at: "2026-08-03T02:20:00.000Z",
    },
    {
      activity_enrollment_id: "enrollment_crystal",
      activity_session_id: "session_film_festival",
      root_user_id: "root_ued_002",
      status: "PENDING",
      reason_code: null,
      attempt_generation: 1,
      created_at: "2026-08-03T03:05:00.000Z",
      updated_at: "2026-08-03T03:05:00.000Z",
    },
  );
}

function scaleInput(name, overrides = {}) {
  return {
    name,
    questionSummary: "12 道必答单选题，约 3 分钟完成",
    scoringSummary: "按连续分数区间分为稳定、关注和优先调整三层",
    audience: "ADULT_18_PLUS",
    questions: [
      {
        id: "state_quality",
        title: "过去一周，你通常觉得身体恢复程度如何？",
        type: "SINGLE",
        required: true,
        options: [
          { value: "good", label: "恢复较好", score: 0 },
          { value: "fair", label: "一般", score: 1 },
          { value: "poor", label: "恢复较差", score: 2 },
        ],
      },
      {
        id: "state_rhythm",
        title: "过去一周，你的日常节律规律吗？",
        type: "SINGLE",
        required: true,
        options: [
          { value: "regular", label: "大多规律", score: 0 },
          { value: "variable", label: "偶有波动", score: 1 },
          { value: "irregular", label: "经常不规律", score: 2 },
        ],
      },
    ],
    resultLevels: [
      { id: "steady", minScore: 0, maxScore: 1, title: "节律较稳", summary: "当前节律相对稳定。", tips: ["继续保持固定起床时间"] },
      { id: "watch", minScore: 2, maxScore: 2, title: "留意波动", summary: "近期状态有一些波动。", tips: ["先记录一周作息"] },
      { id: "adjust", minScore: 3, maxScore: 4, title: "优先调整", summary: "可以优先从日常节律开始调整。", tips: ["逐步固定入睡与起床时间"] },
    ],
    adviceVersionId: healthOperations.FIXED_CONTENT_VERSION_ID,
    approver: "健康内容负责人",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function publishHealthDraft(data, draft, publisher) {
  return publisher(data, {
    versionId: draft.versionId,
    expectedRevision: draft.revision,
    confirmed: true,
    confirmationText: "确认发布",
  }, { now: NOW, operatorId: "ued-review-operator" }).version;
}

function seedHealth(data) {
  const sleepDraft = healthOperations.saveScaleDraft(data, scaleInput("睡眠节律评测"), { now: NOW }).version;
  const sleep = publishHealthDraft(data, sleepDraft, healthOperations.publishScale);
  healthOperations.saveScaleDraft(data, scaleInput("压力活力评测", {
    name: "压力活力评测",
    effectiveAt: "2026-08-10T00:00:00.000Z",
  }), { now: "2026-08-04T07:40:00.000Z" });

  const bowelRule = healthOperations.saveRecommendationRuleDraft(data, {
    primaryCategory: "BOWEL",
    auxiliaryTags: ["饮水偏少", "进餐节律波动"],
    matchSummary: "优先推荐睡眠节律评测，帮助继续观察生活节律",
    priority: 10,
    matchMode: "ANY",
    maxRecommendations: 3,
    scaleVersionId: sleep.versionId,
    effectiveAt: "2026-08-01T00:00:00.000Z",
  }, { now: NOW }).version;
  publishHealthDraft(data, bowelRule, healthOperations.publishRecommendationRule);
  healthOperations.saveRecommendationRuleDraft(data, {
    primaryCategory: "SLEEP",
    auxiliaryTags: ["睡眠不足或不规律"],
    matchSummary: "睡眠标签命中时推荐睡眠节律评测",
    priority: 20,
    matchMode: "ANY",
    maxRecommendations: 2,
    scaleVersionId: sleep.versionId,
    effectiveAt: "2026-08-10T00:00:00.000Z",
  }, { now: "2026-08-04T07:45:00.000Z" });

  const policyInput = {
    name: "Root4U 生活方式建议",
    modelConfigurationId: "FIXED_ONLY",
    minimumFields: ["PRIMARY_CATEGORY", "AUXILIARY_TAGS", "ASSESSMENT_RESULTS"],
    minimumFieldsSummary: "仅发送分类、辅助标签与量表结果\n资料或评测结果变化时才重新生成",
    regenerationTrigger: "PROFILE_OR_ASSESSMENT_CHANGED",
    rotationSize: 3,
    validation: { structure: "REQUIRED", prohibitedLanguage: "REQUIRED", healthSafety: "REQUIRED" },
    fallbackContentVersionId: healthOperations.FIXED_CONTENT_VERSION_ID,
    approver: "健康内容负责人",
    effectiveAt: "2026-08-01T00:00:00.000Z",
  };
  const policy = healthOperations.saveLifestyleAdviceDraft(data, policyInput, { now: NOW }).version;
  publishHealthDraft(data, policy, healthOperations.publishLifestyleAdvice);
  healthOperations.saveLifestyleAdviceDraft(data, {
    ...policyInput,
    name: "固定 tips 内容库",
    effectiveAt: "2026-08-10T00:00:00.000Z",
  }, { now: "2026-08-04T07:50:00.000Z" });
}

function seedUsersAndAudit(data) {
  data.users.push(
    { user_id: "user_ued_001", root_user_id: "root_ued_001", phone: "13800006281", nickname: "Root用户", created_at: "2026-08-03T00:00:00.000Z" },
    { user_id: "user_ued_002", root_user_id: "root_ued_002", phone: "13900008319", nickname: "Crystal", created_at: "2026-08-03T01:00:00.000Z" },
  );
  data.formalProfiles.push(
    { profileId: "profile_ued_001", rootUserId: "root_ued_001", nickname: "Root用户", complete: true },
    { profileId: "profile_ued_002", rootUserId: "root_ued_002", nickname: "Crystal", complete: true },
  );
  data.auditLogs.push(
    {
      audit_log_id: "audit_ued_publish",
      action: "CONTENT_RELEASE_PUBLISH",
      target_type: "CONTENT_RELEASE",
      target_id: "CONTENT-CANDIDATE-20260804",
      operator_id: "ued-review-operator",
      after: { versionId: "v2026.08.03-02", version: 2, status: "SUCCESS" },
      metadata: { requestId: "PUB-8F21", status: "SUCCESS" },
      created_at: "2026-08-03T02:42:01.000Z",
    },
    {
      audit_log_id: "audit_ued_export",
      action: "ACTIVITY_ENROLLMENT_EXPORT",
      target_type: "ACTIVITY_ENROLLMENT",
      target_id: "activity_film_festival",
      operator_id: "ued-review-operator",
      after: { version: 1, status: "SUCCESS" },
      metadata: { requestId: "EXP-71A2", status: "SUCCESS" },
      created_at: "2026-08-03T01:58:00.000Z",
    },
  );
}

function createUedReviewStore() {
  const data = createSeedData();
  seedUsersAndAudit(data);
  seedContent(data);
  seedActivities(data);
  seedHealth(data);
  return data;
}

async function main() {
  const store = createUedReviewStore();
  const env = {
    ...process.env,
    NODE_ENV: "development",
    ROOT_REQUIRE_ADMIN_TOKEN: "false",
    ROOT_CONTENT_WEBVIEW_HOSTS: JSON.stringify(["www.root.com"]),
    ROOT_MEMBER_CENTER_APPID: "wx-root-member-center",
  };
  const server = createApp({ store, env });
  await server.readyPromise;
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`ROOT UED review backend listening on http://127.0.0.1:${PORT}`);
    console.log("Representative data is process-local and will be discarded when this server stops.");
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to start ROOT UED review backend:", error);
    process.exitCode = 1;
  });
}

module.exports = { createUedReviewStore };
