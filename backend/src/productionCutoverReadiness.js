const CUTOVER_ITEMS = [
  {
    id: "wechat_open_platform",
    group: "identity",
    label: "微信开放平台认证与应用绑定",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_WECHAT_OPEN_PLATFORM_CERTIFIED",
    supportingEnv: ["WECHAT_APPID"],
    action: "完成微信开放平台认证，并把 myRoot 会员体验中心与 Root 会员中心绑定到同一开放平台主体。",
  },
  {
    id: "cloudbase_unionid",
    group: "identity",
    label: "CloudBase unionid 真实透传",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_CLOUDBASE_UNIONID_VERIFIED",
    supportingEnv: ["ROOT_PUBLIC_BASE_URL"],
    action: "在真实 CloudBase 请求中验证 x-wx-openid 与 x-wx-unionid，发布记录只保留脱敏预览。",
  },
  {
    id: "root_member_center_appid",
    group: "commerce",
    label: "Root 会员中心 appId 确认",
    ownerRole: "产品/研发",
    proofEnv: "ROOT_CUTOVER_ROOT_MEMBER_CENTER_APPID_CONFIRMED",
    supportingAnyOf: [["ROOT_MEMBER_CENTER_APPID", "YOUZAN_MINIPROGRAM_APPID"]],
    action: "确认有赞商城小程序 Root 会员中心的正式 appId 与 myRoot 跳转配置一致。",
  },
  {
    id: "youzan_live_fields",
    group: "commerce",
    label: "有赞订单/客户/商品字段校准",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_YOUZAN_FIELDS_CALIBRATED",
    supportingEnv: ["YOUZAN_ORDER_LIST_URL", "YOUZAN_CUSTOMER_LIST_URL"],
    action: "用 Root 会员中心真实导出或小批量拉取校准订单、客户、商品和 unionid/手机号字段。",
  },
  {
    id: "youzan_credentials_rotated",
    group: "commerce",
    label: "有赞密钥轮换与只读探针",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_YOUZAN_CREDENTIALS_ROTATED",
    supportingEnv: ["YOUZAN_CLIENT_ID", "YOUZAN_CLIENT_SECRET"],
    action: "轮换已暴露密钥，使用受控密钥完成商品、订单、客户和优惠券只读探针；验证分页、去重、隐私字段形态及已知样本回读。",
  },
  {
    id: "health_advice_model_provider",
    group: "health",
    label: "健康建议模型受托处理与降级验收",
    ownerRole: "产品/研发/合规",
    proofEnv: "ROOT_CUTOVER_HEALTH_ADVICE_MODEL_VERIFIED",
    supportingEnv: [
      "ROOT_HEALTH_ADVICE_MODEL_ENABLED",
      "ROOT_HEALTH_ADVICE_MODEL_ENDPOINT",
      "ROOT_HEALTH_ADVICE_MODEL_API_KEY",
      "ROOT_HEALTH_ADVICE_MODEL_NAME",
      "ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME",
    ],
    action: "确认境内模型服务、数据不用于训练和必要留存约定；完成最小输入、固定 JSON、超时降级、高风险不调用模型及隐私影响评估。",
  },
  {
    id: "wework_live_fields",
    group: "operations",
    label: "企微客户联系字段校准",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_WEWORK_FIELDS_CALIBRATED",
    supportingEnv: ["WEWORK_CONTACT_LIST_URL", "WEWORK_CONTACT_WRITEBACK_URL"],
    action: "确认外部联系人、来源活动、备注、手机号和联系回写字段。",
  },
  {
    id: "cloudbase_jobs_created",
    group: "operations",
    label: "CloudBase 定时触发器创建",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_CLOUDBASE_JOBS_CREATED",
    supportingEnv: ["ROOT_JOB_BASE_URL"],
    supportingAnyOf: [["ROOT_ADMIN_JOB_TOKEN", "ROOT_ADMIN_JOB_TOKENS"]],
    action: "在 CloudBase 控制台创建 Adapter 重试、运营预警、生命周期结算和生命周期导出相关触发器。",
  },
  {
    id: "external_channels_verified",
    group: "operations",
    label: "外部通道与负责人验收",
    ownerRole: "运营/研发",
    proofEnv: "ROOT_CUTOVER_EXTERNAL_CHANNELS_VERIFIED",
    supportingEnv: ["ROOT_OPERATIONAL_ALERT_WEBHOOK_URL"],
    action: "确认站内预警、外部 Webhook、导出交付模板和负责人路由可被运营接收。",
  },
  {
    id: "export_storage_verified",
    group: "data",
    label: "生命周期导出存储验收",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_EXPORT_STORAGE_VERIFIED",
    supportingAnyOf: [["ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER", "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR", "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET"]],
    action: "确认生命周期导出文件的对象目录或对象存储、过期清理、签名下载和访问权限。",
  },
  {
    id: "rollback_drill_completed",
    group: "release",
    label: "发布回滚演练完成",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_ROLLBACK_DRILL_COMPLETED",
    action: "完成 MANUAL_SAMPLE、Adapter rollback、字段快照回滚和运营人工兜底路径演练。",
  },
  {
    id: "cloudrun_candidate_runtime",
    proofScope: "RELEASE",
    group: "release",
    label: "CloudRun 候选运行 Gate",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_CLOUDRUN_CANDIDATE_VERIFIED",
    supportingEnv: ["ROOT_PUBLIC_BASE_URL", "ROOT_CLOUDBASE_ENV_ID"],
    action: "核对候选版本与 releaseId、0% 路由、/health、/ready、VPC/环境变量/规格，并用 15 次无参数请求证明默认流量未误入候选。",
  },
  {
    id: "miniprogram_trial_core_flow",
    proofScope: "RELEASE",
    group: "release",
    label: "同版本体验版真机核心流程",
    ownerRole: "产品/研发",
    proofEnv: "ROOT_CUTOVER_MINIPROGRAM_TRIAL_VERIFIED",
    supportingEnv: ["WECHAT_APPID", "ROOT_PUBLIC_BASE_URL"],
    action: "上传与候选后端同版本的体验版，在关闭调试的真机完成登录、隐私、健康同意、身体画像、参加活动、打卡、订阅授权和商品跳转。",
  },
  {
    id: "cloudrun_canary_observation",
    proofScope: "RELEASE",
    group: "release",
    label: "5% 灰度观察与回滚阈值",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_CLOUDRUN_CANARY_VERIFIED",
    supportingEnv: ["ROOT_PUBLIC_BASE_URL"],
    action: "完成备份且阻塞项清零后进入 5% 灰度，至少观察 30 分钟并覆盖 20 并发核心流程，记录错误率、延迟和明确回滚阈值；超阈值立即回滚。",
  },
  {
    id: "release_artifact_traceability",
    proofScope: "RELEASE",
    group: "release",
    label: "候选工件与版本库追溯",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_RELEASE_ARTIFACT_TRACEABILITY_VERIFIED",
    action: "确认候选 ZIP、SHA256、BuildId、版本号与已推送 commit/tag 一一对应，部署工作树无未追溯改动且回滚源码可获取。",
  },
];

const GROUP_LABELS = {
  identity: "账号身份",
  commerce: "有赞商城",
  health: "健康建议",
  operations: "运营触达",
  data: "数据导出",
  release: "发布回滚",
};

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function boolEnv(value) {
  return ["1", "true", "yes", "y", "approved", "ready", "done", "verified"].includes(String(value || "").trim().toLowerCase());
}

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function envRows(env, names = []) {
  return names.map((name) => ({ name, present: present(env, name) }));
}

function anyOfRows(env, groups = []) {
  return groups.map((names) => ({
    names,
    present: names.some((name) => present(env, name)),
    presentNames: names.filter((name) => present(env, name)),
    missingNames: names.filter((name) => !present(env, name)),
  }));
}

function latestProofFor(item, proofs = []) {
  return proofs.find((proof) => proof && proof.itemId === item.id) || null;
}

function itemMessage(item, proof, missingRequired, missingAnyOf) {
  const {
    target,
    proofReady,
    proofRejected,
    proofRecord,
    envProofReady,
    recordProofReady,
    recordEvidenceReady,
    releaseBindingRequired,
    releaseBindingReady,
    expectedReleaseVersion,
    expectedReleaseId,
    expectedReleaseIdConfigured,
    recordReleaseVersion,
    recordReleaseId,
  } = proof;
  if (proofRejected) return `${item.label} 已被拒绝，需要重新验收后记录 VERIFIED。${item.action}`;
  if (proofRecord && proofRecord.status === "VERIFIED" && !text(proofRecord.evidenceRef)) {
    return `${item.label} 的 VERIFIED 记录缺少 evidenceRef，需要重新录入可追溯证据。${item.action}`;
  }
  if (releaseBindingRequired && (!expectedReleaseVersion || !expectedReleaseId || !expectedReleaseIdConfigured)) {
    return `当前候选缺少 version 或显式 ROOT_RELEASE_ID，无法校验发布级证明。${item.action}`;
  }
  if (releaseBindingRequired && recordEvidenceReady && !releaseBindingReady) {
    if (!recordReleaseVersion || !recordReleaseId) {
      return `${item.label} 的 VERIFIED 记录未绑定候选 version 与 releaseId，需要在当前候选重新验收。${item.action}`;
    }
    return `${item.label} 的 VERIFIED 记录绑定 ${recordReleaseVersion}/${recordReleaseId}，与当前候选 ${expectedReleaseVersion}/${expectedReleaseId} 不一致。${item.action}`;
  }
  if (target === "production" && envProofReady && !recordProofReady) {
    return `${item.proofEnv} 只能证明环境已准备；正式目标仍需带 evidenceRef 的后台 VERIFIED 记录。${item.action}`;
  }
  if (!proofReady) return `缺少带 evidenceRef 的后台 VERIFIED 记录。${item.action}`;
  const support = [];
  if (missingRequired.length) support.push(`缺少支持变量 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) {
    support.push(`至少需要其一：${missingAnyOf.map((names) => names.join(" / ")).join("；")}`);
  }
  if (support.length) return `${support.join("；")}。${item.action}`;
  return "生产证明与支持变量已就绪。";
}

function buildCutoverItem(item, env, target, proofs = [], runtimeBinding = {}) {
  const required = envRows(env, item.supportingEnv || []);
  const anyOf = anyOfRows(env, item.supportingAnyOf || []);
  const missingRequired = required.filter((row) => !row.present).map((row) => row.name);
  const missingAnyOf = anyOf.filter((row) => !row.present).map((row) => row.names);
  const proofRecord = latestProofFor(item, proofs);
  const proofScope = item.proofScope || "ENVIRONMENT";
  const expectedReleaseVersion = text(runtimeBinding.version);
  const expectedReleaseId = text(runtimeBinding.releaseId, expectedReleaseVersion);
  const expectedReleaseIdConfigured = runtimeBinding.releaseIdConfigured === true;
  const recordReleaseVersion = text(proofRecord && (proofRecord.releaseVersion || proofRecord.release_version));
  const recordReleaseId = text(proofRecord && (proofRecord.releaseId || proofRecord.release_id));
  const releaseBindingRequired = target === "production" && proofScope === "RELEASE";
  const releaseBindingReady = !releaseBindingRequired || Boolean(
    expectedReleaseVersion &&
    expectedReleaseId &&
    expectedReleaseIdConfigured &&
    recordReleaseVersion === expectedReleaseVersion &&
    recordReleaseId === expectedReleaseId &&
    proofRecord.releaseIdConfigured === true
  );
  const envProofReady = boolEnv(env && env[item.proofEnv]);
  const recordEvidenceReady = Boolean(proofRecord && proofRecord.status === "VERIFIED" && text(proofRecord.evidenceRef));
  const recordProofReady = recordEvidenceReady && releaseBindingReady;
  const proofRejected = proofRecord && proofRecord.status === "REJECTED";
  const proofReady = target === "production" ? recordProofReady : envProofReady || recordProofReady;
  const supportReady = !missingRequired.length && !missingAnyOf.length;
  const status = proofRejected
    ? "BLOCKED"
    : proofReady
    ? supportReady ? "READY" : target === "production" ? "BLOCKED" : "NEEDS_REVIEW"
    : target === "production" ? "BLOCKED" : "NEEDS_REVIEW";
  return {
    id: item.id,
    group: item.group,
    groupLabel: GROUP_LABELS[item.group] || item.group,
    label: item.label,
    ownerRole: item.ownerRole,
    proofScope,
    proofEnv: item.proofEnv,
    proofReady,
    proofSource: recordProofReady ? "RECORD" : target !== "production" && envProofReady ? "ENV" : "NONE",
    proofPolicy: target === "production"
      ? releaseBindingRequired ? "VERIFIED_RECORD_WITH_EVIDENCE_AND_RELEASE_BINDING" : "VERIFIED_RECORD_WITH_EVIDENCE"
      : "ENV_OR_VERIFIED_RECORD_WITH_EVIDENCE",
    envProofReady,
    recordEvidenceReady,
    recordProofReady,
    releaseBindingRequired,
    releaseBindingReady,
    expectedReleaseVersion,
    expectedReleaseId,
    expectedReleaseIdConfigured,
    recordReleaseVersion,
    recordReleaseId,
    proofRecord: proofRecord || null,
    proofRejected: Boolean(proofRejected),
    supportingEnv: required,
    supportingAnyOf: anyOf,
    missingRequired,
    missingAnyOf,
    status,
    action: item.action,
    message: itemMessage(item, {
      target,
      proofReady,
      proofRejected,
      proofRecord,
      envProofReady,
      recordProofReady,
      recordEvidenceReady,
      releaseBindingRequired,
      releaseBindingReady,
      expectedReleaseVersion,
      expectedReleaseId,
      expectedReleaseIdConfigured,
      recordReleaseVersion,
      recordReleaseId,
    }, missingRequired, missingAnyOf),
  };
}

function summarize(items) {
  const blockers = items.filter((item) => item.status === "BLOCKED").length;
  const warnings = items.filter((item) => item.status === "NEEDS_REVIEW").length;
  const ready = items.filter((item) => item.status === "READY").length;
  return {
    requiredProofCount: items.length,
    readyProofCount: items.filter((item) => item.proofReady).length,
    readyCount: ready,
    blockerCount: blockers,
    warningCount: warnings,
    releaseScopedProofCount: items.filter((item) => item.proofScope === "RELEASE").length,
    releaseBoundReadyCount: items.filter((item) => item.proofScope === "RELEASE" && item.releaseBindingReady && item.recordEvidenceReady).length,
    total: items.length,
  };
}

function groupItems(items) {
  return Object.entries(GROUP_LABELS).map(([group, label]) => {
    const rows = items.filter((item) => item.group === group);
    const summary = summarize(rows);
    const status = summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY";
    return {
      group,
      label,
      status,
      summary,
    };
  }).filter((group) => group.summary.total > 0);
}

function buildProductionCutoverReadiness(options = {}) {
  const target = normalizeTarget(options.target);
  const env = options.env || process.env;
  const proofs = Array.isArray(options.proofs) ? options.proofs : [];
  const runtimeMetadata = options.runtimeMetadata || {};
  const runtimeBinding = {
    version: text(options.releaseVersion || runtimeMetadata.version),
    releaseId: text(options.releaseId || runtimeMetadata.releaseId, text(options.releaseVersion || runtimeMetadata.version)),
    releaseIdConfigured: options.releaseIdConfigured === true || runtimeMetadata.releaseIdConfigured === true,
  };
  const items = CUTOVER_ITEMS.map((item) => buildCutoverItem(item, env, target, proofs, runtimeBinding));
  const summary = summarize(items);
  const groups = groupItems(items);
  const blockers = items
    .filter((item) => item.status === "BLOCKED")
    .map((item) => `${item.groupLabel}/${item.label}: ${item.message}`);
  const warnings = items
    .filter((item) => item.status === "NEEDS_REVIEW")
    .map((item) => `${item.groupLabel}/${item.label}: ${item.message}`);
  const status = summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY";
  return {
    status,
    target,
    runtimeBinding,
    summary,
    groups,
    items,
    blockers,
    warnings,
  };
}

module.exports = {
  CUTOVER_ITEMS,
  buildProductionCutoverReadiness,
};
