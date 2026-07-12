const { nowISO } = require("./dates");
const campaign = require("./campaign");
const { createId } = require("./seed");

const DEFAULT_DEFINITIONS = [
  {
    questionnaire_type: "DAY4_MIDPOINT",
    version: 1,
    active: true,
    skip_allowed: true,
    required_fields: ["stoolChange", "comfortScore"],
    questions: [
      { field: "stoolChange", type: "single", title: "这几天排便状态有什么变化？", options: ["better", "same", "worse"] },
      { field: "comfortScore", type: "scale", title: "整体舒适度", min: 1, max: 5 },
      { field: "needsContact", type: "boolean", title: "是否希望运营联系你？" },
      { field: "contactReason", type: "text", title: "希望运营重点关注什么？", required: true, visibleIf: { field: "needsContact", equals: true } },
      { field: "feedback", type: "text", title: "还有什么想补充？", required: false },
    ],
  },
  {
    questionnaire_type: "DAY8_SUMMARY",
    version: 1,
    active: true,
    skip_allowed: false,
    required_fields: ["overallFeeling", "repurchaseIntent"],
    questions: [
      { field: "overallFeeling", type: "single", title: "7 天整体感受", options: ["better", "same", "worse"] },
      { field: "repurchaseIntent", type: "single", title: "是否愿意继续使用？", options: ["yes", "maybe", "no"] },
      { field: "needsContact", type: "boolean", title: "是否希望运营联系你？" },
      { field: "contactReason", type: "text", title: "希望运营重点关注什么？", required: true, visibleIf: { field: "needsContact", equals: true } },
      { field: "feedback", type: "text", title: "收尾反馈", required: false },
    ],
  },
];

function ensureDefinitions(data) {
  if (!Array.isArray(data.questionnaireDefinitions)) data.questionnaireDefinitions = [];
  DEFAULT_DEFINITIONS.forEach((definition) => {
    const exists = data.questionnaireDefinitions.some((item) => {
      return item.questionnaire_type === definition.questionnaire_type && item.version === definition.version;
    });
    if (!exists) data.questionnaireDefinitions.push({ ...definition, questions: definition.questions.map((item) => ({ ...item })) });
  });
  return data.questionnaireDefinitions;
}

function ensureResponses(data) {
  if (!Array.isArray(data.questionnaireResponses)) data.questionnaireResponses = [];
  return data.questionnaireResponses;
}

function ensureAnswers(data) {
  if (!Array.isArray(data.questionnaireAnswers)) data.questionnaireAnswers = [];
  return data.questionnaireAnswers;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function getQuestionnaire(data, type) {
  const definition = ensureDefinitions(data)
    .filter((item) => item.questionnaire_type === type && item.active)
    .sort((left, right) => right.version - left.version)[0];
  if (!definition) {
    const error = new Error("问卷不存在");
    error.code = 6001;
    throw error;
  }
  return definition;
}

function questionnaireIdOf(definition) {
  return definition.questionnaire_id || definition.questionnaireId || definition.questionnaire_type;
}

function getResponse(data, userId, sessionId, type) {
  return ensureResponses(data).find((item) => {
    return item.user_id === userId && item.session_id === sessionId && item.questionnaire_type === type;
  }) || null;
}

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function compareAnswer(value, rule = {}) {
  const operator = text(rule.operator || rule.op, rule.in !== undefined ? "IN" : rule.notIn !== undefined || rule.not_in !== undefined ? "NOT_IN" : rule.notEquals !== undefined || rule.not_equals !== undefined ? "NE" : rule.exists !== undefined ? "EXISTS" : rule.truthy !== undefined ? "TRUTHY" : "EQ").toUpperCase();
  if (operator === "EXISTS") return rule.exists === false ? isMissing(value) : !isMissing(value);
  if (operator === "TRUTHY") return rule.truthy === false ? !Boolean(value) : Boolean(value);
  if (operator === "NE" || operator === "NOT_EQUALS") return value !== (rule.notEquals !== undefined ? rule.notEquals : rule.not_equals);
  if (operator === "IN") return arrayValue(rule.in || rule.values).includes(value);
  if (operator === "NOT_IN") return !arrayValue(rule.notIn || rule.not_in || rule.values).includes(value);
  if (["GT", "GTE", "LT", "LTE"].includes(operator)) {
    const left = Number(value);
    const right = Number(rule.value !== undefined ? rule.value : rule.equals);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === "GT") return left > right;
    if (operator === "GTE") return left >= right;
    if (operator === "LT") return left < right;
    return left <= right;
  }
  return value === (rule.equals !== undefined ? rule.equals : rule.value);
}

function evaluateVisibleRule(rule, answers = {}) {
  if (!rule) return true;
  if (Array.isArray(rule)) return rule.every((item) => evaluateVisibleRule(item, answers));
  const conditions = rule.conditions || rule.all || rule.any;
  if (Array.isArray(conditions)) {
    const logic = text(rule.logic, rule.any ? "OR" : "AND").toUpperCase();
    return logic === "OR"
      ? conditions.some((item) => evaluateVisibleRule(item, answers))
      : conditions.every((item) => evaluateVisibleRule(item, answers));
  }
  const field = text(rule.field);
  if (!field) return true;
  return compareAnswer(answers[field], rule);
}

function isQuestionVisible(question, answers = {}) {
  return evaluateVisibleRule(question.visibleIf || question.visible_if || question.showIf || question.show_if, answers);
}

function visibleQuestions(definition, answers = {}) {
  return (definition.questions || []).filter((question) => isQuestionVisible(question, answers));
}

function requiredFieldsFor(definition, answers = {}) {
  const visibleFieldSet = new Set(visibleQuestions(definition, answers).map((question) => question.field));
  const required = new Set((definition.required_fields || []).filter((field) => visibleFieldSet.has(field)));
  (definition.questions || []).forEach((question) => {
    if (question.required === true && visibleFieldSet.has(question.field)) required.add(question.field);
  });
  return Array.from(required);
}

function validateQuestionnaireAnswers(definition, answers = {}) {
  const required = requiredFieldsFor(definition, answers);
  required.forEach((field) => {
    if (isMissing(answers[field])) {
      const error = new Error("问卷必填项未完成");
      error.code = 6002;
      throw error;
    }
  });
  definition.questions.forEach((question) => {
    const value = answers[question.field];
    if (value === undefined || value === null || value === "") return;
    if (question.type === "scale") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < question.min || number > question.max) {
        const error = new Error("问卷分值超出范围");
        error.code = 6003;
        throw error;
      }
    }
    if (question.type === "boolean" && typeof value !== "boolean") {
      const error = new Error("问卷布尔题格式错误");
      error.code = 6004;
      throw error;
    }
  });
}

function requiresFollow(response) {
  const answers = response.answers || response.answers_json || {};
  return Boolean(answers.needsContact || answers.overallFeeling === "worse" || answers.stoolChange === "worse");
}

function submitQuestionnaire(data, user, session, body = {}) {
  if (!session) {
    const error = new Error("暂无打卡周期");
    error.code = 4001;
    throw error;
  }
  const type = body.type || body.questionnaireType || body.questionnaire_type;
  const definition = getQuestionnaire(data, type);
  const idempotencyKey = body.idempotencyKey || body.idempotency_key || "";
  const existingByKey = idempotencyKey
    ? ensureResponses(data).find((item) => item.idempotency_key === idempotencyKey)
    : null;
  if (existingByKey) return { response: existingByKey, created: false };

  const existing = getResponse(data, user.user_id, session.session_id, type);
  if (existing) return { response: existing, created: false };

  const answers = body.answers || {};
  validateQuestionnaireAnswers(definition, answers);
  const response = {
    response_id: createId("qrs"),
    user_id: user.user_id,
    session_id: session.session_id,
    questionnaire_type: definition.questionnaire_type,
    version: definition.version,
    answers,
    submitted_at: nowISO(),
    needs_follow: false,
    idempotency_key: idempotencyKey,
  };
  response.needs_follow = requiresFollow(response);
  ensureResponses(data).push(response);
  return { response, created: true };
}

function getQuestionnaireStatus(data, userId, sessionId) {
  const responses = ensureResponses(data).filter((item) => item.user_id === userId && item.session_id === sessionId);
  return {
    DAY4_MIDPOINT: Boolean(responses.find((item) => item.questionnaire_type === "DAY4_MIDPOINT")),
    DAY8_SUMMARY: Boolean(responses.find((item) => item.questionnaire_type === "DAY8_SUMMARY")),
    responses,
  };
}

function findQuestionnaireAnswer(data, query = {}) {
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const campaignId = text(query.campaignId || query.campaign_id);
  const questionnaireId = text(query.questionnaireId || query.questionnaire_id || query.questionnaireType || query.questionnaire_type || query.type);
  const version = query.version === undefined || query.version === null || query.version === "" ? "" : Number(query.version);
  return ensureAnswers(data).find((item) => {
    if (rootUserId && item.root_user_id !== rootUserId) return false;
    if (campaignId && item.campaign_id !== campaignId) return false;
    if (questionnaireId && item.questionnaire_id !== questionnaireId && item.questionnaire_type !== questionnaireId) return false;
    if (version !== "" && Number(item.version) !== version) return false;
    return true;
  }) || null;
}

function listQuestionnaireAnswers(data, query = {}) {
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const campaignId = text(query.campaignId || query.campaign_id);
  return ensureAnswers(data).filter((item) => {
    if (rootUserId && item.root_user_id !== rootUserId) return false;
    if (campaignId && item.campaign_id !== campaignId) return false;
    return true;
  });
}

function submitQuestionnaireAnswer(data, input = {}, context = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  if (!rootUserId) {
    const error = new Error("请先登录");
    error.code = 1003;
    error.status = 401;
    throw error;
  }
  const activeCampaign = campaign.getActiveCampaign(data, {
    ...context,
    campaignId: input.campaignId || input.campaign_id,
  });
  campaign.joinCampaign(data, rootUserId, activeCampaign.campaign_id, context);
  const questionnaireType = text(input.type || input.questionnaireType || input.questionnaire_type || input.questionnaireId || input.questionnaire_id);
  const definition = getQuestionnaire(data, questionnaireType);
  const questionnaireId = questionnaireIdOf(definition);
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
  const answers = input.answers || input.answers_json || {};

  const existingByKey = idempotencyKey
    ? ensureAnswers(data).find((item) => item.idempotency_key === idempotencyKey)
    : null;
  if (existingByKey) return { answer: existingByKey, definition, created: false };

  const existing = findQuestionnaireAnswer(data, {
    rootUserId,
    campaignId: activeCampaign.campaign_id,
    questionnaireId,
    version: definition.version,
  });
  if (existing) return { answer: existing, definition, created: false };

  validateQuestionnaireAnswers(definition, answers);
  const now = nowISO();
  const answer = {
    questionnaire_answer_id: createId("qan"),
    root_user_id: rootUserId,
    campaign_id: activeCampaign.campaign_id,
    questionnaire_id: questionnaireId,
    questionnaire_type: definition.questionnaire_type,
    version: definition.version,
    answers_json: clone(answers),
    submitted_at: input.submittedAt || input.submitted_at || now,
    idempotency_key: idempotencyKey,
    source_channel: context.sourceChannel || context.source_channel || input.sourceChannel || input.source_channel || "",
    needs_follow: false,
    created_at: now,
  };
  answer.needs_follow = requiresFollow(answer);
  ensureAnswers(data).push(answer);
  return { answer, definition, created: true };
}

function getQuestionnaireAnswerStatus(data, rootUserId, campaignId) {
  const answers = listQuestionnaireAnswers(data, { rootUserId, campaignId });
  return {
    DAY4_MIDPOINT: Boolean(answers.find((item) => item.questionnaire_id === "DAY4_MIDPOINT" || item.questionnaire_type === "DAY4_MIDPOINT")),
    DAY8_SUMMARY: Boolean(answers.find((item) => item.questionnaire_id === "DAY8_SUMMARY" || item.questionnaire_type === "DAY8_SUMMARY")),
    answers,
  };
}

module.exports = {
  DEFAULT_DEFINITIONS,
  findQuestionnaireAnswer,
  getQuestionnaire,
  getQuestionnaireAnswerStatus,
  getQuestionnaireStatus,
  getResponse,
  isQuestionVisible,
  listQuestionnaireAnswers,
  requiresFollow,
  requiredFieldsFor,
  submitQuestionnaireAnswer,
  submitQuestionnaire,
  validateQuestionnaireAnswers,
  visibleQuestions,
};
