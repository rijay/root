const { nowISO } = require("./dates");
const {
  HEALTH_AI_DATA_LIMITS,
  HEALTH_AI_DATA_POLICY_VERSION,
} = require("./healthAiDataPolicy");
const { isValidPrivacyContact } = require("./privacyConfig");
const { createId } = require("./seed");
const { createClientError } = require("./clientError");

const HEALTH_CONSENT_TYPE = "HEALTH_SENSITIVE_INFO";
const HEALTH_CONSENT_POLICY_VERSION = "root4u-health-sensitive-2026-08-27-v9";
const DECISIONS = new Set(["GRANTED", "WITHDRAWN"]);

const PURPOSES = [
  "完成 Root4U 健康起点评测与生活方式分类",
  "生成日常生活方式建议和后续评测推荐",
  "在两项评测均完成且未进入安全提示分支时，从经审核的通用建议池中组合生活方式建议",
  "在账号中保存问卷答案、评测结果和回测记录，支持跨设备查看与主动删除",
  "在出现需要进一步确认的信息时提供必要人工协助",
];

const DATA_CATEGORIES = [
  "排便频率、便便形态与消化感受",
  "睡眠、活动、饮食、饮水、压力和精力情况",
  "健康目标、安全与适用性确认",
  "评测结果代码与建议池匹配结果（仅在 myRoot 服务端处理，不对外提供）",
];

function ensureList(data) {
  if (!Array.isArray(data.privacyConsentRecords)) data.privacyConsentRecords = [];
  return data.privacyConsentRecords;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function consentConfig(context = {}) {
  const env = context.env || context || {};
  const required = enabled(env.ROOT_REQUIRE_HEALTH_CONSENT);
  const controllerName = String(env.ROOT_PRIVACY_CONTROLLER_NAME || "").trim();
  const contact = String(env.ROOT_PRIVACY_CONTACT || "").trim();
  const retentionDays = positiveInteger(env.ROOT_HEALTH_DATA_RETENTION_DAYS);
  const cleanupEnabled = enabled(env.ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED);
  return {
    required,
    configured: !required || Boolean(
      controllerName
      && isValidPrivacyContact(contact)
      && retentionDays === HEALTH_AI_DATA_LIMITS.healthContentRetentionDays
      && cleanupEnabled
    ),
    controllerName,
    contact,
    retentionDays,
    cleanupEnabled,
  };
}

function latestRecord(data, rootUserId) {
  const records = ensureList(data)
    .filter((item) => item.root_user_id === rootUserId && item.consent_type === HEALTH_CONSENT_TYPE);
  return records.length ? records[records.length - 1] : null;
}

function publicRecord(record) {
  if (!record) return null;
  return {
    consentRecordId: record.privacy_consent_record_id,
    consentType: record.consent_type,
    policyVersion: record.policy_version,
    decision: record.decision,
    sourceChannel: record.source_channel,
    occurredAt: record.occurred_at,
  };
}

function noticePayload(config) {
  return {
    consentType: HEALTH_CONSENT_TYPE,
    policyVersion: HEALTH_CONSENT_POLICY_VERSION,
    title: "身体反馈与健康记录单独同意",
    purposes: PURPOSES.slice(),
    dataCategories: DATA_CATEGORIES.slice(),
    necessity: "这些信息会安全保存到你的 myRoot 账号，仅用于你主动参加的 Root4U 评测、生活方式建议、历史回测和必要人工协助，不用于医疗诊断。",
    refusalImpact: "不同意不会影响首页、活动和会员支持，但无法提交 Root4U 健康评测或查看基于评测生成的建议。",
    modelProcessingText: "健康建议采用预先起草并经人工审核的通用建议池。内容制作只使用产品定义的 6 类健康起点和 5 类肠道状态，不使用任何真实用户的身份、问卷答案、评测结果、健康状态、请求日志或其他个人信息。你使用小程序时，myRoot 服务端只在本地按评测结果组合已审核建议；建议池缺失或未通过审核时自动使用经审核固定建议，不会对外发送用户健康数据。",
    controllerName: config.controllerName,
    contact: config.contact,
    retentionDays: config.retentionDays,
    retentionText: config.retentionDays
      ? `问卷答案、评测结果、回测记录和健康建议自最后保存起最长保留 ${config.retentionDays} 天；你可随时删除单条评测，在线主数据和关联建议最迟在 ${HEALTH_AI_DATA_LIMITS.primaryDeletionSlaHours} 小时内删除。运行时只在 myRoot 服务端本地匹配建议，不对外发送用户健康数据。加密滚动备份最长保留 ${HEALTH_AI_DATA_LIMITS.backupRetentionDays} 天，恢复备份前会重新执行删除。到期后仅保留不含健康内容的必要版本、时间和同意审计事实。法律法规要求继续保存的，只作隔离存储和安全保护。`
      : "保存期限待运营负责人确认。",
    dataManagement: {
      policyVersion: HEALTH_AI_DATA_POLICY_VERSION,
      primaryDeletionSlaHours: HEALTH_AI_DATA_LIMITS.primaryDeletionSlaHours,
      applicationLogRetentionDays: HEALTH_AI_DATA_LIMITS.applicationLogRetentionDays,
      securityLogRetentionDays: HEALTH_AI_DATA_LIMITS.securityLogRetentionDays,
      backupRetentionDays: HEALTH_AI_DATA_LIMITS.backupRetentionDays,
      privacyEvidenceRetentionDays: HEALTH_AI_DATA_LIMITS.privacyEvidenceRetentionDays,
      runtimeModelPersonalDataTransfer: false,
      healthContentRetentionDays: config.retentionDays || 0,
    },
  };
}

function getPublicPrivacyNotice(context = {}) {
  const config = consentConfig(context);
  return {
    configured: Boolean(
      config.controllerName &&
      isValidPrivacyContact(config.contact) &&
      config.retentionDays === HEALTH_AI_DATA_LIMITS.healthContentRetentionDays
    ),
    ...noticePayload(config),
  };
}

function getHealthConsentStatus(data, rootUserId, context = {}) {
  const config = consentConfig(context);
  const latest = latestRecord(data, rootUserId);
  const active = !config.required || Boolean(
    config.configured &&
    latest &&
    latest.policy_version === HEALTH_CONSENT_POLICY_VERSION &&
    latest.decision === "GRANTED"
  );
  return {
    required: config.required,
    configured: config.configured,
    active,
    latest: publicRecord(latest),
    notice: noticePayload(config),
  };
}

function consentError(code, message, status = 403) {
  return createClientError(code, message, status);
}

function recordHealthConsentDecision(data, rootUserId, body = {}, context = {}) {
  const config = consentConfig(context);
  if (!config.required) return { ...getHealthConsentStatus(data, rootUserId, context), recorded: false, reason: "NOT_REQUIRED" };
  if (!config.configured) {
    throw consentError(45102, "敏感信息处理说明尚未配置，请联系人工协助");
  }
  const decision = String(body.decision || "").trim().toUpperCase();
  if (!DECISIONS.has(decision)) throw consentError(45103, "请选择同意或撤回", 400);
  if (String(body.policyVersion || body.policy_version || "") !== HEALTH_CONSENT_POLICY_VERSION) {
    throw consentError(45104, "隐私说明已更新，请重新阅读后确认", 409);
  }
  const current = latestRecord(data, rootUserId);
  if (current && current.policy_version === HEALTH_CONSENT_POLICY_VERSION && current.decision === decision) {
    return { ...getHealthConsentStatus(data, rootUserId, context), recorded: false, reason: "UNCHANGED" };
  }
  const now = nowISO();
  const record = {
    privacy_consent_record_id: createId("pcr"),
    root_user_id: rootUserId,
    consent_type: HEALTH_CONSENT_TYPE,
    policy_version: HEALTH_CONSENT_POLICY_VERSION,
    decision,
    purposes_json: PURPOSES.slice(),
    data_categories_json: DATA_CATEGORIES.slice(),
    source_channel: String(context.sourceChannel || "MINIPROGRAM_HEALTH_CONSENT").trim().slice(0, 64),
    occurred_at: now,
    created_at: now,
  };
  ensureList(data).push(record);
  return { ...getHealthConsentStatus(data, rootUserId, context), recorded: true, record: publicRecord(record) };
}

function requireHealthConsent(data, rootUserId, context = {}) {
  const status = getHealthConsentStatus(data, rootUserId, context);
  if (!status.required) return status;
  if (!status.configured) throw consentError(45102, "敏感信息处理说明尚未配置，请联系人工协助");
  if (!status.active) throw consentError(45101, "请先单独同意身体反馈与健康记录说明");
  return status;
}

module.exports = {
  DATA_CATEGORIES,
  HEALTH_CONSENT_POLICY_VERSION,
  HEALTH_CONSENT_TYPE,
  PURPOSES,
  consentConfig,
  getPublicPrivacyNotice,
  getHealthConsentStatus,
  recordHealthConsentDecision,
  requireHealthConsent,
};
