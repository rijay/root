const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const SUPPORTED_ASSESSMENT_TYPES = new Set(["GUT_REGULARITY"]);
const COMPLETED_STATUS = "COMPLETED";
const DEFAULT_TITLE = "你是从哪里知道 ROOT 的？";
const DEFAULT_SUBTITLE = "请选择最接近的一项，帮助我们优化后续活动与服务。";
const MAX_OPTIONS = 30;

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, maxLength = 128) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function businessError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assessmentType(value) {
  const normalized = text(value || "GUT_REGULARITY", 32).toUpperCase();
  if (!SUPPORTED_ASSESSMENT_TYPES.has(normalized)) {
    throw businessError("ASSESSMENT_SOURCE_TYPE_UNSUPPORTED", "当前评测类型不支持来源确认");
  }
  return normalized;
}

function status(value, fallback = "PAUSED") {
  const normalized = text(value || fallback, 16).toUpperCase();
  if (!new Set(["ACTIVE", "PAUSED"]).has(normalized)) {
    throw businessError("ASSESSMENT_SOURCE_STATUS_INVALID", "来源确认状态无效");
  }
  return normalized;
}

function optionId(value) {
  const normalized = text(value, 48).toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{0,47}$/.test(normalized) ? normalized : "";
}

function normalizeOptions(input) {
  if (!Array.isArray(input)) {
    throw businessError("ASSESSMENT_SOURCE_OPTIONS_INVALID", "渠道选项必须为数组");
  }
  if (input.length > MAX_OPTIONS) {
    throw businessError("ASSESSMENT_SOURCE_OPTIONS_LIMIT", `渠道选项最多 ${MAX_OPTIONS} 项`);
  }
  const options = input.map((item, index) => {
    const id = optionId(item && (item.optionId || item.option_id || item.id));
    const label = text(item && item.label, 40);
    if (!id || !label) {
      throw businessError("ASSESSMENT_SOURCE_OPTION_INVALID", `第 ${index + 1} 个渠道选项缺少有效 ID 或名称`);
    }
    return {
      option_id: id,
      label,
      sort_order: Number.isFinite(Number(item.sortOrder || item.sort_order))
        ? Number(item.sortOrder || item.sort_order)
        : (index + 1) * 10,
    };
  }).sort((left, right) => left.sort_order - right.sort_order);
  const ids = new Set();
  const labels = new Set();
  options.forEach((option) => {
    if (ids.has(option.option_id)) {
      throw businessError("ASSESSMENT_SOURCE_OPTION_DUPLICATE", `渠道选项 ID 重复：${option.option_id}`);
    }
    if (labels.has(option.label)) {
      throw businessError("ASSESSMENT_SOURCE_OPTION_LABEL_DUPLICATE", `渠道选项名称重复：${option.label}`);
    }
    ids.add(option.option_id);
    labels.add(option.label);
  });
  return options;
}

function configRows(data) {
  return ensureList(data, "assessmentSourceSurveyConfigs");
}

function configForType(data, type) {
  return configRows(data).find((item) => item.assessment_type === type) || null;
}

function publicOption(option) {
  return {
    optionId: option.option_id,
    label: option.label,
    sortOrder: Number(option.sort_order || 0),
  };
}

function publicConfig(row) {
  const options = row && Array.isArray(row.options_json) ? row.options_json.map(publicOption) : [];
  return {
    configured: Boolean(row),
    assessmentSourceConfigId: row ? row.assessment_source_config_id : "",
    assessmentType: row ? row.assessment_type : "GUT_REGULARITY",
    status: row ? row.status : "PAUSED",
    title: row ? row.title : DEFAULT_TITLE,
    subtitle: row ? row.subtitle : DEFAULT_SUBTITLE,
    configVersion: row ? Number(row.config_version || 0) : 0,
    options,
    createdAt: row ? row.created_at : "",
    updatedAt: row ? row.updated_at : "",
  };
}

function listConfiguration(data, query = {}) {
  const type = assessmentType(query.assessmentType || query.assessment_type || "GUT_REGULARITY");
  return publicConfig(configForType(data, type));
}

function saveConfiguration(data, input = {}, context = {}) {
  const type = assessmentType(input.assessmentType || input.assessment_type || "GUT_REGULARITY");
  const nextStatus = status(input.status);
  const options = normalizeOptions(input.options || []);
  if (nextStatus === "ACTIVE" && !options.length) {
    throw businessError("ASSESSMENT_SOURCE_ACTIVE_OPTIONS_REQUIRED", "启用来源确认前至少配置一个渠道选项");
  }
  const title = text(input.title || DEFAULT_TITLE, 80);
  const subtitle = text(input.subtitle || DEFAULT_SUBTITLE, 180);
  if (!title) throw businessError("ASSESSMENT_SOURCE_TITLE_REQUIRED", "来源确认标题必填");
  const rows = configRows(data);
  let row = configForType(data, type);
  const created = !row;
  const now = context.now || nowISO();
  if (!row) {
    row = {
      assessment_source_config_id: createId("asc"),
      assessment_type: type,
      config_version: 0,
      created_by: text(input.operatorId || input.operator_id, 64),
      created_at: now,
    };
    rows.push(row);
  }
  Object.assign(row, {
    status: nextStatus,
    title,
    subtitle,
    options_json: options,
    config_version: Number(row.config_version || 0) + 1,
    updated_by: text(input.operatorId || input.operator_id, 64),
    updated_at: now,
  });
  const config = publicConfig(row);
  const audit = auditLog.appendAuditLog(data, {
    action: created ? "ASSESSMENT_SOURCE_CONFIG_CREATE" : "ASSESSMENT_SOURCE_CONFIG_UPDATE",
    targetType: "ASSESSMENT_SOURCE_SURVEY_CONFIG",
    targetId: row.assessment_source_config_id,
    operatorId: input.operatorId || input.operator_id || "",
    reason: input.reason || "维护 0.7.2 评测来源确认配置",
    after: {
      assessmentType: type,
      status: row.status,
      configVersion: row.config_version,
      optionCount: options.length,
    },
    metadata: {
      requestId: input.requestId || input.request_id || "",
      releaseStage: "ASSESSMENT_SOURCE_CONFIRMATION",
    },
  });
  return { config, created, audit };
}

function ownedAttempt(data, rootUserId, assessmentId) {
  const normalizedId = text(assessmentId, 64);
  const attempt = ensureList(data, "healthAssessmentAttempts").find((item) => (
    item.assessment_id === normalizedId && item.root_user_id === rootUserId
  ));
  if (!attempt) throw businessError("ASSESSMENT_SOURCE_ASSESSMENT_NOT_FOUND", "评测记录不存在", 404);
  return attempt;
}

function existingConfirmation(attempt) {
  if (!attempt.discovery_channel_confirmed_at) return null;
  return {
    optionId: attempt.discovery_channel_option_id || "",
    label: attempt.discovery_channel_option_label || "",
    configVersion: Number(attempt.discovery_channel_config_version || 0),
    confirmedAt: attempt.discovery_channel_confirmed_at,
  };
}

function gate(data, rootUserId, assessmentId) {
  const attempt = ownedAttempt(data, rootUserId, assessmentId);
  if (attempt.assessment_type !== "GUT_REGULARITY") {
    return { required: false, reason: "ASSESSMENT_TYPE_NOT_ELIGIBLE", config: null, confirmation: null };
  }
  if (attempt.status === "SAFETY_STOPPED") {
    return { required: false, reason: "SAFETY_RESULT_PRIORITY", config: null, confirmation: null };
  }
  if (attempt.status !== COMPLETED_STATUS) {
    return { required: false, reason: "ASSESSMENT_NOT_COMPLETED", config: null, confirmation: null };
  }
  const confirmation = existingConfirmation(attempt);
  if (confirmation) return { required: false, reason: "ALREADY_CONFIRMED", config: null, confirmation };
  const row = configForType(data, attempt.assessment_type);
  const config = publicConfig(row);
  if (!row) return { required: false, reason: "NOT_CONFIGURED", config: null, confirmation: null };
  if (row.status !== "ACTIVE") return { required: false, reason: "CONFIG_PAUSED", config: null, confirmation: null };
  if (!config.options.length) return { required: false, reason: "NO_OPTIONS", config: null, confirmation: null };
  return { required: true, reason: "", config, confirmation: null };
}

function confirm(data, rootUserId, assessmentId, input = {}, context = {}) {
  const attempt = ownedAttempt(data, rootUserId, assessmentId);
  const current = existingConfirmation(attempt);
  const selectedOptionId = optionId(input.optionId || input.option_id);
  if (current) {
    if (current.optionId === selectedOptionId) return { confirmation: current, created: false };
    throw businessError("ASSESSMENT_SOURCE_ALREADY_CONFIRMED", "本次评测的来源已经确认", 409);
  }
  const currentGate = gate(data, rootUserId, assessmentId);
  if (!currentGate.required || !currentGate.config) {
    throw businessError("ASSESSMENT_SOURCE_CONFIRMATION_NOT_REQUIRED", "本次评测无需确认来源", 409);
  }
  const requestedVersion = Number(input.configVersion || input.config_version || 0);
  if (requestedVersion !== currentGate.config.configVersion) {
    throw businessError("ASSESSMENT_SOURCE_CONFIG_STALE", "渠道选项已更新，请重新选择", 409);
  }
  const selected = currentGate.config.options.find((item) => item.optionId === selectedOptionId);
  if (!selected) throw businessError("ASSESSMENT_SOURCE_OPTION_UNAVAILABLE", "所选渠道当前不可用", 409);
  const now = context.now || nowISO();
  Object.assign(attempt, {
    discovery_channel_option_id: selected.optionId,
    discovery_channel_option_label: selected.label,
    discovery_channel_config_version: currentGate.config.configVersion,
    discovery_channel_confirmed_at: now,
    updated_at: now,
  });
  return { confirmation: existingConfirmation(attempt), created: true };
}

module.exports = Object.freeze({
  DEFAULT_SUBTITLE,
  DEFAULT_TITLE,
  MAX_OPTIONS,
  confirm,
  gate,
  listConfiguration,
  normalizeOptions,
  saveConfiguration,
});
