const { nowISO } = require("./dates");
const { isValidPrivacyContact } = require("./privacyConfig");
const { createId } = require("./seed");

const HEALTH_CONSENT_TYPE = "HEALTH_SENSITIVE_INFO";
const HEALTH_CONSENT_POLICY_VERSION = "health-sensitive-2026-07-11-v1";
const DECISIONS = new Set(["GRANTED", "WITHDRAWN"]);

const PURPOSES = [
  "记录活动任务、问卷和身体反馈进度",
  "按活动规则进行结算与奖励资格判断",
  "在用户主动请求或出现异常反馈时提供人工协助",
];

const DATA_CATEGORIES = [
  "排便情况与便型",
  "身体感受和健康问卷答案",
  "用户主动选择的打卡图片",
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
    configured: !required || Boolean(controllerName && isValidPrivacyContact(contact) && retentionDays && cleanupEnabled),
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
    necessity: "这些信息仅用于你主动参加的身体记录任务、活动结算和必要人工协助，不用于医疗诊断。",
    refusalImpact: "不同意不会影响商品浏览和人工咨询，但无法提交身体画像、健康问卷或打卡记录，也无法计算依赖这些记录的任务与奖励。",
    controllerName: config.controllerName,
    contact: config.contact,
    retentionDays: config.retentionDays,
    retentionText: config.retentionDays
      ? `原始身体反馈原则上保存不超过 ${config.retentionDays} 天；到期后自动脱敏记录并清理可控云存储图片，任务完成、结算和同意审计事实按必要期限保留。法律法规另有要求的除外。`
      : "保存期限待运营负责人确认。",
  };
}

function getPublicPrivacyNotice(context = {}) {
  const config = consentConfig(context);
  return {
    configured: Boolean(
      config.controllerName &&
      isValidPrivacyContact(config.contact) &&
      config.retentionDays
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
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
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
