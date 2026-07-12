const REVIEW_TYPE_LABELS = {
  FREE_ORDER_REVIEW: "免单机会复核",
  REWARD_REVIEW: "奖励发放复核",
  MANUAL_REVIEW: "人工复核",
};

const DEFAULT_TEMPLATES = {
  DEFAULT: {
    title: "人工复核",
    pendingReason: "运营需要人工确认活动达标、奖励配置或外部证据。",
    evidenceRequired: ["活动参与记录", "奖励配置", "外部订单或发放证据"],
    userExplanation: "当前事项需要运营人工确认，处理期间不需要重复提交。",
    operatorGuidance: "先核对用户活动记录、奖励规则和外部证据，再处理通过或拒绝。",
    nextAction: "等待状态自动更新；如超过预计处理时间，可联系顾问协助催办。",
    overdueCopy: "已超过预计处理时间，建议联系顾问协助催办。",
    resolvedCopy: "运营已完成复核，奖励页会同步更新处理结果。",
    approvedCopy: "运营已确认复核通过，奖励页会同步更新发放状态。",
    rejectedCopy: "运营已完成复核，本次暂不满足发放条件。",
  },
  FREE_ORDER_REVIEW: {
    title: "免单机会复核",
    pendingReason: "运营会核对连续任务完成记录、免单名额和订单/支付证据。",
    evidenceRequired: ["7 天打卡与 Day8 问卷记录", "免单机会奖励配置与库存", "Root 会员中心订单/支付证据"],
    userExplanation: "免单机会需要确认任务达标、活动名额和订单证据，处理期间不用重复提交。",
    operatorGuidance: "核对打卡天数、Day8 问卷、免单规则库存和有赞订单/支付证据后再处理。",
    nextAction: "等待运营复核；如超过预计处理时间，可联系顾问协助催办。",
    approvedCopy: "运营已确认免单机会通过，奖励页会继续同步发放状态。",
    rejectedCopy: "运营已完成复核，本次暂不满足免单机会发放条件。",
  },
  REWARD_REVIEW: {
    title: "奖励发放复核",
    pendingReason: "运营会核对达标条件、奖励库存和外部发放结果。",
    evidenceRequired: ["活动达标记录", "奖励配置与库存", "有赞券/企微标签等外部发放结果"],
    userExplanation: "奖励发放需要人工确认库存或外部回执，处理期间不用重复提交。",
    operatorGuidance: "核对奖励规则、发放任务、外部回执和失败原因后再处理。",
    nextAction: "等待奖励状态同步；若超过预计时间，可联系顾问协助催办。",
    approvedCopy: "运营已确认奖励复核通过，后续会继续同步发放状态。",
    rejectedCopy: "运营已完成复核，本次奖励暂不满足发放条件。",
  },
  MANUAL_REVIEW: {
    title: "人工复核",
    pendingReason: "运营会根据活动规则、奖励库存和外部订单证据确认。",
  },
};

const TEMPLATE_FIELDS = [
  "title",
  "pendingReason",
  "evidenceRequired",
  "userExplanation",
  "operatorGuidance",
  "nextAction",
  "overdueCopy",
  "resolvedCopy",
  "approvedCopy",
  "rejectedCopy",
];

const USER_VISIBLE_FIELDS = new Set([
  "title",
  "pendingReason",
  "evidenceRequired",
  "userExplanation",
  "nextAction",
  "overdueCopy",
  "resolvedCopy",
  "approvedCopy",
  "rejectedCopy",
]);

const TEXT_FIELDS = new Set(TEMPLATE_FIELDS.filter((field) => field !== "evidenceRequired"));
const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);
const REVIEW_TEMPLATE_KEYS = TEMPLATE_KEYS.filter((key) => key !== "DEFAULT");
const ALLOWED_PLACEHOLDERS = new Set([
  "reviewType",
  "reviewTypeLabel",
  "reason",
  "rewardTitle",
  "expectedResolutionAt",
  "slaHours",
  "status",
  "resolution",
  "publicNote",
  "operatorId",
]);
const PRIVATE_PLACEHOLDERS = new Set(["operatorId"]);
const SENSITIVE_TEXT_PATTERN = /(openid|unionid|token|secret|access[_-]?token|password|passwd|密钥|手机号|手机|电话|身份证)/i;
const MAX_TEXT_LENGTH = 220;
const PREVIEW_REASON = {
  FREE_ORDER_REVIEW: "免单机会需要运营确认",
  REWARD_REVIEW: "奖励发放需要运营确认",
  MANUAL_REVIEW: "人工确认规则与外部证据",
};

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，;；\n]+/).map((item) => text(item)).filter(Boolean);
  }
  return fallback;
}

function parseJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return objectValue(parsed);
  } catch (_) {
    return {};
  }
}

function templateSource(context = {}) {
  const env = context.env || process.env;
  if (context.manualReviewExplanationTemplates !== undefined) {
    return { source: "manualReviewExplanationTemplates", raw: context.manualReviewExplanationTemplates };
  }
  if (context.manual_review_explanation_templates !== undefined) {
    return { source: "manual_review_explanation_templates", raw: context.manual_review_explanation_templates };
  }
  return { source: "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES", raw: env && env.ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES };
}

function parseTemplateConfig(raw) {
  if (!raw) return { configured: false, parsed: {}, errors: [] };
  if (typeof raw === "object" && !Array.isArray(raw)) return { configured: true, parsed: raw, errors: [] };
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        configured: true,
        parsed: {},
        errors: [{ templateKey: "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES", field: "JSON", message: "模板配置必须是 JSON 对象" }],
      };
    }
    return { configured: true, parsed, errors: [] };
  } catch (error) {
    return {
      configured: true,
      parsed: {},
      errors: [{ templateKey: "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES", field: "JSON", message: `模板 JSON 无法解析：${error.message}` }],
    };
  }
}

function configuredTemplates(context = {}) {
  const source = templateSource(context);
  const parsed = parseJsonObject(source.raw);
  return objectValue(parsed.templates || parsed);
}

function mergeTemplate(reviewType, context = {}) {
  const type = text(reviewType, "MANUAL_REVIEW").toUpperCase();
  const configured = configuredTemplates(context);
  return {
    ...DEFAULT_TEMPLATES.DEFAULT,
    ...objectValue(DEFAULT_TEMPLATES[type]),
    ...objectValue(configured.DEFAULT),
    ...objectValue(configured[type]),
  };
}

function reviewTypeLabel(reviewType) {
  const type = text(reviewType, "MANUAL_REVIEW").toUpperCase();
  return REVIEW_TYPE_LABELS[type] || REVIEW_TYPE_LABELS.MANUAL_REVIEW;
}

function templateVars(item, context = {}) {
  const metadata = objectValue(item && item.metadata);
  return {
    reviewType: item && item.review_type ? item.review_type : "",
    reviewTypeLabel: reviewTypeLabel(item && item.review_type),
    reason: item && item.reason ? item.reason : "",
    rewardTitle: text(context.rewardTitle || context.reward_title || metadata.rewardTitle || metadata.reward_title),
    expectedResolutionAt: text(context.expectedResolutionAt || context.expected_resolution_at || metadata.expectedResolutionAt || metadata.expected_resolution_at),
    slaHours: text(context.slaHours || context.sla_hours || metadata.slaHours || metadata.sla_hours),
    status: item && item.status ? item.status : "",
    resolution: item && item.resolution ? item.resolution : "",
    publicNote: text(context.publicNote || context.public_note || metadata.publicNote || metadata.public_note),
    operatorId: item && item.operator_id ? item.operator_id : "",
  };
}

function renderText(value, vars) {
  return text(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => text(vars[key]));
}

function renderList(value, vars, fallback = []) {
  return arrayValue(value, fallback).map((item) => renderText(item, vars)).filter(Boolean);
}

function placeholderKeys(value) {
  const values = Array.isArray(value) ? value : [value];
  const keys = [];
  values.forEach((item) => {
    const raw = typeof item === "string" ? item : "";
    const matches = raw.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    for (const match of matches) keys.push(match[1]);
  });
  return keys;
}

function fieldTextValues(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") return [value];
  return [];
}

function pushIssue(target, templateKey, field, message) {
  target.push({ templateKey, field, message });
}

function validateTemplateField(templateKey, field, value, errors, warnings) {
  if (!TEMPLATE_FIELDS.includes(field)) {
    pushIssue(warnings, templateKey, field, "模板字段当前不会被渲染，请确认是否拼写错误");
    return;
  }
  if (field === "evidenceRequired") {
    if (!Array.isArray(value) && typeof value !== "string") {
      pushIssue(errors, templateKey, field, "所需证据必须是字符串数组或用逗号/换行分隔的字符串");
      return;
    }
    if (Array.isArray(value) && value.length === 0) {
      pushIssue(warnings, templateKey, field, "所需证据为空，用户可能无法判断需要等待哪些材料");
    }
    if (Array.isArray(value) && value.some((item) => typeof item !== "string")) {
      pushIssue(errors, templateKey, field, "所需证据数组只能包含字符串");
    }
  } else if (TEXT_FIELDS.has(field) && typeof value !== "string") {
    pushIssue(errors, templateKey, field, "模板文案字段必须是字符串");
    return;
  }

  const values = fieldTextValues(value);
  values.forEach((item) => {
    if (item.length > MAX_TEXT_LENGTH) {
      pushIssue(warnings, templateKey, field, `单段文案超过 ${MAX_TEXT_LENGTH} 字，建议上线前压缩`);
    }
    if (SENSITIVE_TEXT_PATTERN.test(item)) {
      const issueTarget = USER_VISIBLE_FIELDS.has(field) ? errors : warnings;
      pushIssue(issueTarget, templateKey, field, "模板包含敏感标识或密钥类词汇，上线前需要移除");
    }
  });

  placeholderKeys(value).forEach((key) => {
    if (!ALLOWED_PLACEHOLDERS.has(key)) {
      pushIssue(errors, templateKey, field, `不支持的占位符 {{${key}}}`);
    }
    if (USER_VISIBLE_FIELDS.has(field) && PRIVATE_PLACEHOLDERS.has(key)) {
      pushIssue(errors, templateKey, field, `用户可见字段不能使用内部占位符 {{${key}}}`);
    }
  });
}

function validateManualReviewExplanationTemplates(context = {}) {
  const source = templateSource(context);
  const parsed = parseTemplateConfig(source.raw);
  const errors = [...parsed.errors];
  const warnings = [];
  const templates = objectValue(parsed.parsed.templates || parsed.parsed);

  Object.entries(templates).forEach(([templateKey, template]) => {
    if (!TEMPLATE_KEYS.includes(templateKey)) {
      pushIssue(warnings, templateKey, "templateKey", "未知复核类型不会被默认复核流程使用");
    }
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      pushIssue(errors, templateKey, "template", "模板配置必须是对象");
      return;
    }
    Object.entries(template).forEach(([field, value]) => {
      validateTemplateField(templateKey, field, value, errors, warnings);
    });
  });

  return {
    source: source.source,
    configured: parsed.configured,
    status: errors.length ? "BLOCKED" : warnings.length ? "NEEDS_REVIEW" : "READY",
    errors,
    warnings,
  };
}

function previewItem(reviewType) {
  return {
    review_type: reviewType,
    reason: PREVIEW_REASON[reviewType] || PREVIEW_REASON.MANUAL_REVIEW,
    status: "OPEN",
    resolution: "",
    operator_id: "ops-admin",
    metadata: {
      rewardTitle: reviewType === "FREE_ORDER_REVIEW" ? "免单机会" : "达标返券",
      expectedResolutionAt: "2026-06-20 18:00",
      slaHours: 24,
    },
  };
}

function resolutionCopy(template, item) {
  const resolution = text(item && item.resolution).toUpperCase();
  if (resolution === "APPROVED") return template.approvedCopy || template.resolvedCopy;
  if (resolution === "REJECTED") return template.rejectedCopy || template.resolvedCopy;
  return template.resolvedCopy;
}

function explainManualReview(item, context = {}) {
  if (!item) return null;
  const reviewType = text(item.review_type, "MANUAL_REVIEW").toUpperCase();
  const template = mergeTemplate(reviewType, context);
  const vars = templateVars(item, context);
  const publicNote = text(context.publicNote || vars.publicNote);
  const isResolved = item.status === "RESOLVED";
  const isOverdue = Boolean(context.overdue);
  const resolvedCopy = renderText(resolutionCopy(template, item), vars);
  const userExplanation = renderText(template.userExplanation || template.pendingReason, vars);
  const statusCopy = isResolved
    ? publicNote || resolvedCopy
    : isOverdue
      ? renderText(template.overdueCopy, vars)
      : userExplanation;

  return {
    templateKey: reviewType,
    reviewTypeLabel: reviewTypeLabel(reviewType),
    title: renderText(template.title, vars),
    pendingReason: renderText(template.pendingReason, vars),
    evidenceRequired: renderList(template.evidenceRequired, vars, DEFAULT_TEMPLATES.DEFAULT.evidenceRequired),
    userExplanation,
    operatorGuidance: renderText(template.operatorGuidance, vars),
    nextAction: renderText(template.nextAction, vars),
    resolvedCopy,
    overdueCopy: renderText(template.overdueCopy, vars),
    statusCopy,
    publicNote,
  };
}

function listManualReviewExplanationTemplates(context = {}) {
  const validation = validateManualReviewExplanationTemplates(context);
  const configured = configuredTemplates(context);
  const templates = REVIEW_TEMPLATE_KEYS.map((templateKey) => {
    const explanation = explainManualReview(previewItem(templateKey), context);
    return {
      templateKey,
      reviewTypeLabel: explanation.reviewTypeLabel,
      configured: Boolean(objectValue(configured[templateKey]) && Object.keys(objectValue(configured[templateKey])).length),
      title: explanation.title,
      pendingReason: explanation.pendingReason,
      evidenceRequired: explanation.evidenceRequired,
      userExplanation: explanation.userExplanation,
      nextAction: explanation.nextAction,
      overdueCopy: explanation.overdueCopy,
      resolvedCopy: explanation.resolvedCopy,
      operatorGuidance: explanation.operatorGuidance,
    };
  });
  return {
    ...validation,
    templates,
  };
}

module.exports = {
  explainManualReview,
  listManualReviewExplanationTemplates,
  validateManualReviewExplanationTemplates,
};
