const { nowISO } = require("./dates");
const { createId } = require("./seed");

const COMPLETED_STATUSES = new Set(["COMPLETED", "SAFETY_STOPPED"]);
const AVAILABLE_REVIEW_STATUS = "APPROVED";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function definitions(data) {
  return ensureList(data, "healthAssessmentDefinitions");
}

function attempts(data) {
  return ensureList(data, "healthAssessmentAttempts");
}

function businessError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function definitionId(definition) {
  return text(definition.assessment_definition_id || definition.assessmentDefinitionId);
}

function questionnaireId(definition) {
  return text(definition.questionnaire_id || definition.questionnaireId);
}

function questionnaireVersion(definition) {
  return number(definition.questionnaire_version || definition.questionnaireVersion || definition.version, 0);
}

function assessmentType(definition) {
  return text(definition.assessment_type || definition.assessmentType).toUpperCase();
}

function reviewState(definition) {
  const status = text(definition.status).toUpperCase();
  const content = text(definition.content_review_status || definition.contentReviewStatus).toUpperCase();
  const professional = text(definition.professional_review_status || definition.professionalReviewStatus).toUpperCase();
  const compliance = text(definition.compliance_review_status || definition.complianceReviewStatus).toUpperCase();
  if (status !== "ACTIVE") return { available: false, reason: "NOT_ACTIVE" };
  if (content !== AVAILABLE_REVIEW_STATUS
    || professional !== AVAILABLE_REVIEW_STATUS
    || compliance !== AVAILABLE_REVIEW_STATUS) {
    return { available: false, reason: "CONTENT_REVIEW_PENDING" };
  }
  if (!definitionId(definition) || !questionnaireId(definition) || questionnaireVersion(definition) < 1) {
    return { available: false, reason: "DEFINITION_INVALID" };
  }
  if (!Array.isArray(definition.questions) || !definition.questions.length) {
    return { available: false, reason: "QUESTIONNAIRE_NOT_CONFIGURED" };
  }
  const copies = Array.isArray(definition.result_copies) ? definition.result_copies : [];
  if (!copies.length || !text(definition.default_result_code)) {
    return { available: false, reason: "RESULT_COPY_NOT_CONFIGURED" };
  }
  return { available: true, reason: "" };
}

function latestDefinition(data, requestedType) {
  const normalizedType = text(requestedType).toUpperCase();
  const matches = definitions(data)
    .filter((item) => assessmentType(item) === normalizedType)
    .sort((left, right) => questionnaireVersion(right) - questionnaireVersion(left));
  return matches[0] || null;
}

function availableDefinition(data, requestedType) {
  const normalizedType = text(requestedType).toUpperCase();
  return definitions(data)
    .filter((item) => assessmentType(item) === normalizedType && reviewState(item).available)
    .sort((left, right) => questionnaireVersion(right) - questionnaireVersion(left))[0] || null;
}

function publicOption(option) {
  if (option && typeof option === "object") {
    return {
      value: option.value,
      label: text(option.label, String(option.value || "")),
      ...(option.exclusive === true ? { exclusive: true } : {}),
    };
  }
  return { value: option, label: String(option || "") };
}

function publicQuestion(question) {
  return {
    field: text(question.field),
    type: text(question.type, "single").toLowerCase(),
    title: text(question.title),
    description: text(question.description),
    required: question.required !== false,
    min: number(question.min),
    max: number(question.max),
    minLabel: text(question.min_label || question.minLabel),
    maxLabel: text(question.max_label || question.maxLabel),
    options: (Array.isArray(question.options) ? question.options : []).map(publicOption),
    visibleIf: clone(question.visible_if || question.visibleIf || null),
  };
}

function definitionPayload(definition, options = {}) {
  if (!definition) return null;
  const review = reviewState(definition);
  const payload = {
    assessmentDefinitionId: definitionId(definition),
    assessmentType: assessmentType(definition),
    questionnaireId: questionnaireId(definition),
    questionnaireVersion: questionnaireVersion(definition),
    title: text(definition.title),
    description: text(definition.description),
    estimatedMinutes: number(definition.estimated_minutes || definition.estimatedMinutes, 0),
    resultCopyVersion: number(definition.result_copy_version || definition.resultCopyVersion, 0),
    available: review.available,
    unavailableReason: review.reason,
  };
  if (options.includeQuestions && review.available) {
    payload.questions = definition.questions.map(publicQuestion);
  }
  return payload;
}

function resultCopy(definition, resultCode) {
  const copies = Array.isArray(definition.result_copies) ? definition.result_copies : [];
  return copies.find((item) => text(item.code) === text(resultCode)) || null;
}

function resultPayload(attempt) {
  const result = attempt.result_json && typeof attempt.result_json === "object"
    ? attempt.result_json
    : {};
  return {
    resultCode: text(result.resultCode || result.result_code),
    title: text(result.title),
    summary: text(result.summary),
    priorityAction: text(result.priorityAction || result.priority_action),
    riskNotice: text(result.riskNotice || result.risk_notice),
    retestAdvice: text(result.retestAdvice || result.retest_advice),
    copyVersion: number(result.copyVersion || result.copy_version, 0),
  };
}

function dimensionPayload(attempt) {
  const dimensions = Array.isArray(attempt.dimensions_json) ? attempt.dimensions_json : [];
  return dimensions.map((item) => ({
    key: text(item.key),
    label: text(item.label, text(item.key)),
    score: number(item.score, 0),
    unit: text(item.unit),
    direction: text(item.direction, "NEUTRAL"),
  }));
}

function attemptPayload(attempt, definition, options = {}) {
  if (!attempt) return null;
  const payload = {
    assessmentId: attempt.assessment_id,
    assessmentType: attempt.assessment_type,
    questionnaireId: attempt.questionnaire_id,
    questionnaireVersion: Number(attempt.questionnaire_version || 0),
    status: attempt.status,
    safetyState: text(attempt.safety_state, "NONE"),
    isRetest: Boolean(attempt.is_retest),
    startedAt: attempt.started_at,
    completedAt: attempt.completed_at || "",
    updatedAt: attempt.updated_at,
    resultCopyVersion: Number(attempt.result_copy_version || 0),
    result: COMPLETED_STATUSES.has(attempt.status) ? resultPayload(attempt) : null,
    dimensions: COMPLETED_STATUSES.has(attempt.status) ? dimensionPayload(attempt) : [],
  };
  if (options.includeDraft && attempt.status === "IN_PROGRESS") {
    payload.answers = clone(attempt.answers_json || {});
    payload.definition = definitionPayload(definition, { includeQuestions: true });
  }
  return payload;
}

function answerMatches(value, rule = {}) {
  const operator = text(rule.operator, "EQ").toUpperCase();
  const expected = rule.value !== undefined ? rule.value : rule.equals;
  if (operator === "CONTAINS") return Array.isArray(value) && value.includes(expected);
  if (operator === "CONTAINS_ANY") {
    return Array.isArray(value) && Array.isArray(rule.values) && rule.values.some((item) => value.includes(item));
  }
  if (operator === "IN") return Array.isArray(rule.values) && rule.values.includes(value);
  if (operator === "NOT_IN") return Array.isArray(rule.values) && !rule.values.includes(value);
  if (operator === "TRUTHY") return Boolean(value) === (rule.value === undefined ? true : Boolean(rule.value));
  if (operator === "NE") return value !== expected;
  return value === expected;
}

function questionVisible(question, answers) {
  const rule = question.visible_if || question.visibleIf;
  if (!rule) return true;
  if (Array.isArray(rule.all)) return rule.all.every((item) => answerMatches(answers[item.field], item));
  if (Array.isArray(rule.any)) return rule.any.some((item) => answerMatches(answers[item.field], item));
  return answerMatches(answers[rule.field], rule);
}

function isMissing(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

function pruneHiddenAnswers(definition, answers) {
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  const source = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const fields = new Set(questions.map((question) => text(question.field)).filter(Boolean));
  const pruned = Object.keys(source).reduce((result, field) => {
    if (fields.has(field)) result[field] = clone(source[field]);
    return result;
  }, {});
  for (let pass = 0; pass <= questions.length; pass += 1) {
    let changed = false;
    questions.forEach((question) => {
      const field = text(question.field);
      if (field && Object.prototype.hasOwnProperty.call(pruned, field) && !questionVisible(question, pruned)) {
        delete pruned[field];
        changed = true;
      }
    });
    if (!changed) break;
  }
  return pruned;
}

function validateAnswer(question, value) {
  if (isMissing(value)) return;
  const type = text(question.type, "single").toLowerCase();
  const options = (Array.isArray(question.options) ? question.options : []).map((item) => (
    item && typeof item === "object" ? item.value : item
  ));
  if (type === "single" && !options.includes(value)) {
    throw businessError(6104, "评测选项无效");
  }
  if (type === "multi") {
    if (!Array.isArray(value) || value.some((item) => !options.includes(item))) {
      throw businessError(6104, "评测选项无效");
    }
    const exclusiveValues = (Array.isArray(question.options) ? question.options : [])
      .filter((item) => item && typeof item === "object" && item.exclusive === true)
      .map((item) => item.value);
    if (value.length > 1 && value.some((item) => exclusiveValues.includes(item))) {
      throw businessError(6104, "评测选项无效");
    }
  }
  if (type === "scale") {
    const parsed = number(value);
    if (parsed === null || parsed < number(question.min, 0) || parsed > number(question.max, 0)) {
      throw businessError(6105, "评测分值超出范围");
    }
  }
  if (type === "boolean" && typeof value !== "boolean") {
    throw businessError(6106, "评测答案格式无效");
  }
  if (type === "text" && (typeof value !== "string" || value.length > 500)) {
    throw businessError(6107, "评测文本格式无效");
  }
}

function validateAnswers(definition, answers, requireComplete = false) {
  const source = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const questions = Array.isArray(definition.questions) ? definition.questions : [];
  const fields = new Set(questions.map((item) => text(item.field)).filter(Boolean));
  Object.keys(source).forEach((field) => {
    if (!fields.has(field)) throw businessError(6103, "评测包含未知题目");
  });
  const pruned = pruneHiddenAnswers(definition, source);
  questions.forEach((question) => {
    if (!questionVisible(question, pruned)) return;
    const value = pruned[question.field];
    if (requireComplete && question.required !== false && isMissing(value)) {
      throw businessError(6102, "请完成当前评测后再提交");
    }
    validateAnswer(question, value);
  });
  return pruned;
}

function safetyTrigger(definition, answers) {
  const rules = Array.isArray(definition.safety_rules) ? definition.safety_rules : [];
  const rule = rules.find((item) => answerMatches(answers[item.field], item));
  if (!rule) return null;
  return {
    safetyState: text(rule.safety_state, "STOPPED"),
    resultCode: text(rule.result_code),
  };
}

function optionScore(question, answer) {
  const options = Array.isArray(question.options) ? question.options : [];
  const scoreFor = (value) => {
    const option = options.find((item) => item && typeof item === "object" && item.value === value);
    if (option && number(option.score) !== null) return number(option.score, 0);
    const map = question.score_map || question.scoreMap || {};
    return number(map[String(value)], 0);
  };
  if (Array.isArray(answer)) return answer.reduce((sum, value) => sum + scoreFor(value), 0);
  if (text(question.type).toLowerCase() === "scale" && !(question.score_map || question.scoreMap)) {
    return number(answer, 0);
  }
  return scoreFor(answer);
}

function computeDimensions(definition, answers) {
  const configs = Array.isArray(definition.dimensions) ? definition.dimensions : [];
  const scores = new Map(configs.map((item) => [text(item.key), 0]));
  (definition.questions || []).forEach((question) => {
    const key = text(question.dimension_key || question.dimensionKey);
    if (!key || !scores.has(key) || isMissing(answers[question.field])) return;
    scores.set(key, scores.get(key) + optionScore(question, answers[question.field]));
  });
  return configs.map((item) => ({
    key: text(item.key),
    label: text(item.label, text(item.key)),
    score: scores.get(text(item.key)) || 0,
    unit: text(item.unit),
    direction: text(item.direction, "NEUTRAL"),
  }));
}

function dimensionRuleMatches(dimensions, rule = {}) {
  const dimension = dimensions.find((item) => item.key === text(rule.dimension_key || rule.dimensionKey));
  if (!dimension) return false;
  const target = number(rule.value, 0);
  const operator = text(rule.operator, "GTE").toUpperCase();
  if (operator === "GT") return dimension.score > target;
  if (operator === "LTE") return dimension.score <= target;
  if (operator === "LT") return dimension.score < target;
  if (operator === "EQ") return dimension.score === target;
  return dimension.score >= target;
}

function answerConditionMatches(answers, condition = {}) {
  if (Array.isArray(condition.all)) {
    return condition.all.every((item) => answerConditionMatches(answers, item));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((item) => answerConditionMatches(answers, item));
  }
  if (condition.not) return !answerConditionMatches(answers, condition.not);
  return answerMatches(answers[condition.field], condition);
}

function selectResultCode(definition, dimensions, answers = {}) {
  const rules = Array.isArray(definition.result_rules) ? definition.result_rules : [];
  const matched = rules.find((rule) => {
    const all = Array.isArray(rule.all) ? rule.all : [];
    const any = Array.isArray(rule.any) ? rule.any : [];
    const answerCondition = rule.answer_condition || rule.answerCondition;
    return (!all.length || all.every((item) => dimensionRuleMatches(dimensions, item)))
      && (!any.length || any.some((item) => dimensionRuleMatches(dimensions, item)))
      && (!answerCondition || answerConditionMatches(answers, answerCondition));
  });
  return text(matched && matched.result_code, text(definition.default_result_code));
}

function buildResult(definition, code) {
  const copy = resultCopy(definition, code);
  if (!copy) throw businessError(6110, "评测结果文案尚未配置", 409);
  return {
    resultCode: text(copy.code),
    title: text(copy.title),
    summary: text(copy.summary),
    priorityAction: text(copy.priority_action || copy.priorityAction),
    riskNotice: text(copy.risk_notice || copy.riskNotice),
    retestAdvice: text(copy.retest_advice || copy.retestAdvice),
    copyVersion: number(definition.result_copy_version || definition.resultCopyVersion, 0),
  };
}

function definitionForAttempt(data, attempt) {
  return definitions(data).find((item) => definitionId(item) === attempt.assessment_definition_id) || null;
}

function ownedAttempt(data, rootUserId, assessmentId) {
  const attempt = attempts(data).find((item) => item.assessment_id === text(assessmentId));
  if (!attempt || attempt.root_user_id !== rootUserId) throw businessError(6101, "评测记录不存在", 404);
  return attempt;
}

function listCompleted(data, rootUserId, requestedType = "") {
  const type = text(requestedType).toUpperCase();
  const allAttempts = attempts(data);
  return allAttempts
    .filter((item) => item.root_user_id === rootUserId
      && COMPLETED_STATUSES.has(item.status)
      && (!type || item.assessment_type === type))
    .sort((left, right) => {
      const completedDelta = String(right.completed_at).localeCompare(String(left.completed_at));
      if (completedDelta) return completedDelta;
      return allAttempts.indexOf(right) - allAttempts.indexOf(left);
    });
}

function catalog(data, rootUserId) {
  const types = ["INITIAL", "GUT_REGULARITY"];
  return {
    assessments: types.map((type) => {
      const latestConfigured = latestDefinition(data, type);
      const definition = availableDefinition(data, type);
      const history = listCompleted(data, rootUserId, type);
      const inProgress = definition ? attempts(data).find((item) => (
        item.root_user_id === rootUserId
        && item.assessment_type === type
        && item.assessment_definition_id === definitionId(definition)
        && item.status === "IN_PROGRESS"
      )) : null;
      return {
        assessmentType: type,
        definition: definitionPayload(definition || latestConfigured),
        available: Boolean(definition),
        unavailableReason: definition ? "" : reviewState(latestConfigured || {}).reason,
        historyCount: history.length,
        latest: history[0] ? attemptPayload(history[0], definitionForAttempt(data, history[0])) : null,
        inProgress: inProgress ? attemptPayload(inProgress, definition) : null,
        canResume: Boolean(inProgress),
        canRetest: Boolean(definition && history.length),
      };
    }),
  };
}

function start(data, rootUserId, input = {}, context = {}) {
  const type = text(input.assessmentType || input.assessment_type, "INITIAL").toUpperCase();
  const definition = availableDefinition(data, type);
  if (!definition) throw businessError(6108, "评测内容仍在审核或配置中", 409);
  const current = attempts(data).find((item) => item.root_user_id === rootUserId
    && item.assessment_type === type
    && item.assessment_definition_id === definitionId(definition)
    && item.status === "IN_PROGRESS");
  if (current) return { assessment: attemptPayload(current, definition, { includeDraft: true }), created: false };

  const now = nowISO();
  const prior = listCompleted(data, rootUserId, type);
  const attempt = {
    assessment_id: createId("has"),
    root_user_id: rootUserId,
    assessment_definition_id: definitionId(definition),
    assessment_type: type,
    questionnaire_id: questionnaireId(definition),
    questionnaire_version: questionnaireVersion(definition),
    status: "IN_PROGRESS",
    safety_state: "NONE",
    is_retest: prior.length > 0,
    answers_json: {},
    dimensions_json: [],
    result_json: {},
    result_copy_version: number(definition.result_copy_version || definition.resultCopyVersion, 0),
    source_channel: text(context.sourceChannel || context.source_channel || input.sourceChannel || input.source_channel, "MINIPROGRAM_HEALTH"),
    started_at: now,
    completed_at: "",
    created_at: now,
    updated_at: now,
  };
  attempts(data).push(attempt);
  return { assessment: attemptPayload(attempt, definition, { includeDraft: true }), created: true };
}

function get(data, rootUserId, assessmentId) {
  const attempt = ownedAttempt(data, rootUserId, assessmentId);
  const definition = definitionForAttempt(data, attempt);
  return attemptPayload(attempt, definition, { includeDraft: true });
}

function saveDraft(data, rootUserId, assessmentId, input = {}) {
  const attempt = ownedAttempt(data, rootUserId, assessmentId);
  if (attempt.status !== "IN_PROGRESS") throw businessError(6109, "已完成的评测不能修改", 409);
  const definition = definitionForAttempt(data, attempt);
  if (!definition || !reviewState(definition).available) throw businessError(6108, "评测内容当前不可用", 409);
  const answers = validateAnswers(definition, input.answers || input.answers_json || {}, false);
  attempt.answers_json = clone(answers);
  attempt.updated_at = nowISO();
  return {
    assessment: attemptPayload(attempt, definition, { includeDraft: true }),
    safetyTriggered: Boolean(safetyTrigger(definition, answers)),
  };
}

function complete(data, rootUserId, assessmentId, input = {}) {
  const attempt = ownedAttempt(data, rootUserId, assessmentId);
  const definition = definitionForAttempt(data, attempt);
  if (!definition || !reviewState(definition).available) throw businessError(6108, "评测内容当前不可用", 409);
  if (COMPLETED_STATUSES.has(attempt.status)) {
    return { assessment: attemptPayload(attempt, definition), created: false };
  }
  if (attempt.status !== "IN_PROGRESS") throw businessError(6109, "评测状态不可提交", 409);
  const answers = validateAnswers(
    definition,
    input.answers || input.answers_json || attempt.answers_json || {},
    false,
  );
  const safety = safetyTrigger(definition, answers);
  let dimensions = [];
  let code = "";
  if (safety) {
    code = safety.resultCode;
    attempt.status = "SAFETY_STOPPED";
    attempt.safety_state = safety.safetyState;
  } else {
    validateAnswers(definition, answers, true);
    dimensions = computeDimensions(definition, answers);
    code = selectResultCode(definition, dimensions, answers);
    attempt.status = "COMPLETED";
    attempt.safety_state = "NONE";
  }
  attempt.answers_json = clone(answers);
  attempt.dimensions_json = clone(dimensions);
  attempt.result_json = buildResult(definition, code);
  attempt.completed_at = nowISO();
  attempt.updated_at = attempt.completed_at;
  return { assessment: attemptPayload(attempt, definition), created: true };
}

function history(data, rootUserId, query = {}) {
  const type = text(query.assessmentType || query.assessment_type).toUpperCase();
  const rows = listCompleted(data, rootUserId, type).map((item) => (
    attemptPayload(item, definitionForAttempt(data, item))
  ));
  return { assessments: rows, total: rows.length };
}

function remove(data, rootUserId, assessmentId) {
  const normalizedId = text(assessmentId);
  const allAttempts = attempts(data);
  const index = allAttempts.findIndex((item) => (
    item.assessment_id === normalizedId && item.root_user_id === rootUserId
  ));
  if (index < 0) {
    return { assessmentId: normalizedId, deleted: false };
  }
  allAttempts.splice(index, 1);
  if (Array.isArray(data.healthAdviceSnapshots)) {
    data.healthAdviceSnapshots = data.healthAdviceSnapshots.filter((item) => (
      item.initial_assessment_id !== normalizedId && item.gut_assessment_id !== normalizedId
    ));
  }
  return { assessmentId: normalizedId, deleted: true, deletedAt: nowISO() };
}

function compare(data, rootUserId, input = {}) {
  const requestedLeft = ownedAttempt(data, rootUserId, input.leftAssessmentId || input.left_assessment_id);
  const requestedRight = ownedAttempt(data, rootUserId, input.rightAssessmentId || input.right_assessment_id);
  if (requestedLeft.assessment_id === requestedRight.assessment_id) {
    const payload = attemptPayload(requestedLeft, definitionForAttempt(data, requestedLeft));
    return { comparable: false, reason: "SAME_ASSESSMENT", left: payload, right: payload, dimensions: [] };
  }
  const allAttempts = attempts(data);
  const ordered = [requestedLeft, requestedRight].sort((left, right) => {
    const completedDelta = String(left.completed_at || left.updated_at)
      .localeCompare(String(right.completed_at || right.updated_at));
    if (completedDelta) return completedDelta;
    return allAttempts.indexOf(left) - allAttempts.indexOf(right);
  });
  const [left, right] = ordered;
  const leftPayload = attemptPayload(left, definitionForAttempt(data, left));
  const rightPayload = attemptPayload(right, definitionForAttempt(data, right));
  if (!COMPLETED_STATUSES.has(left.status) || !COMPLETED_STATUSES.has(right.status)) {
    return { comparable: false, reason: "ASSESSMENT_NOT_COMPLETED", left: leftPayload, right: rightPayload, dimensions: [] };
  }
  if (left.questionnaire_id !== right.questionnaire_id
    || Number(left.questionnaire_version) !== Number(right.questionnaire_version)) {
    return { comparable: false, reason: "QUESTIONNAIRE_VERSION_MISMATCH", left: leftPayload, right: rightPayload, dimensions: [] };
  }
  if (left.status === "SAFETY_STOPPED" || right.status === "SAFETY_STOPPED") {
    return { comparable: false, reason: "SAFETY_RESULT_NOT_COMPARABLE", left: leftPayload, right: rightPayload, dimensions: [] };
  }
  const leftDimensions = new Map(dimensionPayload(left).map((item) => [item.key, item]));
  const rightDimensions = new Map(dimensionPayload(right).map((item) => [item.key, item]));
  const shared = [...leftDimensions.keys()].filter((key) => rightDimensions.has(key));
  if (!shared.length) {
    return { comparable: false, reason: "NO_SHARED_DIMENSIONS", left: leftPayload, right: rightPayload, dimensions: [] };
  }
  return {
    comparable: true,
    reason: "",
    left: leftPayload,
    right: rightPayload,
    dimensions: shared.map((key) => {
      const before = leftDimensions.get(key);
      const after = rightDimensions.get(key);
      return {
        key,
        label: after.label || before.label,
        beforeScore: before.score,
        afterScore: after.score,
        delta: after.score - before.score,
        unit: after.unit || before.unit,
        direction: after.direction || before.direction,
      };
    }),
    notice: "差异仅用于同版问卷的近期状态观察，不代表疾病变化或干预疗效。",
  };
}

module.exports = {
  COMPLETED_STATUSES,
  attemptPayload,
  catalog,
  compare,
  complete,
  definitionPayload,
  get,
  history,
  remove,
  pruneHiddenAnswers,
  reviewState,
  saveDraft,
  start,
  validateAnswers,
};
