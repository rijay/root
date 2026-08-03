const { createClientError } = require("./clientError");
const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");
const formalHealthAccessPolicy = require("./formalHealthAccessPolicy");
const assessmentModule = require("./assessmentModule");
const healthSafetyPolicy = require("./healthSafetyPolicy");
const lifestyleAdviceModule = require("./lifestyleAdviceModule");
const healthOperationsModule = require("./healthOperationsModule");

const QUESTIONNAIRE_ID = assessmentModule.QUESTIONNAIRE_ID;
const QUESTIONNAIRE_VERSION = assessmentModule.QUESTIONNAIRE_VERSION;
const CAMPAIGN_ID = "ROOT4U";
const { MINIMUM_AGE, ageOn, assertEligible, assertWriteEnabled } = formalHealthAccessPolicy;

function answerRows(data) {
  if (!Array.isArray(data.questionnaireAnswers)) data.questionnaireAnswers = [];
  return data.questionnaireAnswers;
}

function latest(data, rootUserId) {
  return answerRows(data)
    .filter((item) => item.root_user_id === rootUserId && item.questionnaire_id === QUESTIONNAIRE_ID)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)))[0] || null;
}

function evaluateAnswers(answers, data = null, context = {}) {
  const safety = healthSafetyPolicy.evaluateSafety(answers);
  const assessment = safety.status === "STANDARD_GUIDANCE"
    ? assessmentModule.scoreAssessment(answers)
    : null;
  const fixedResult = lifestyleAdviceModule.buildResult({ assessment, safety });
  const publishedRecommendations = assessment && data
    ? healthOperationsModule.resolvePublishedRecommendations(data, assessment, context)
    : [];
  const publishedPolicy = assessment && data
    ? healthOperationsModule.resolvePublishedLifestylePolicy(data, context)
    : null;
  const recommendedResult = publishedRecommendations.length
    ? { ...fixedResult, recommendations: publishedRecommendations }
    : fixedResult;
  const result = publishedPolicy ? { ...recommendedResult, ...publishedPolicy } : recommendedResult;
  return { safety, assessment, result };
}

function resultFor(answers) {
  return evaluateAnswers(answers).result;
}

function publicResult(row) {
  const result = row && row.answers_json && row.answers_json.result;
  if (!result || typeof result !== "object") return null;
  return {
    ...result,
    completedAt: row.submitted_at,
    questionnaireVersion: row.version,
  };
}

function bootstrap(data, user, profile, consentStatus, context = {}) {
  let age = -1;
  let eligibility = "PROFILE_REQUIRED";
  if (profile && profile.complete) {
    age = ageOn(profile.birthDate, context.today || todayISO());
    eligibility = age >= MINIMUM_AGE ? "ELIGIBLE" : "AGE_RESTRICTED";
  }
  const row = latest(data, user.root_user_id || user.user_id);
  const result = consentStatus.active ? publicResult(row) : null;
  return {
    eligibility,
    minimumAge: MINIMUM_AGE,
    consentRequired: Boolean(consentStatus.required && !consentStatus.active),
    consentConfigured: Boolean(consentStatus.configured),
    assessmentState: result ? "COMPLETED" : "NOT_STARTED",
    result,
  };
}

function getDefinition(data, profile, context = {}) {
  assertEligible(profile, context);
  return { definition: healthOperationsModule.resolveInitializationDefinition(data, profile) };
}

function adminInitializationDefinition(query = {}) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || query.page_size || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw createClientError("FORMAL_HEALTH_ADMIN_QUERY_INVALID", "分页参数无效", 400);
  }
  const keyword = String(query.keyword || query.search || "").trim().toLowerCase();
  if (keyword.length > 120) {
    throw createClientError("FORMAL_HEALTH_ADMIN_QUERY_INVALID", "搜索内容过长", 400);
  }
  const type = String(query.type || "").trim().toLowerCase();
  if (type && !["single", "multi"].includes(type)) {
    throw createClientError("FORMAL_HEALTH_ADMIN_QUERY_INVALID", "题目类型无效", 400);
  }
  const requestedVersion = String(query.version || "").trim();
  const definition = assessmentModule.getPublishedDefinition();
  const items = definition.questions.map((question, index) => ({
    id: question.id,
    number: String(index + 1).padStart(2, "0"),
    title: question.title,
    type: question.type,
    typeLabel: question.type === "multi" ? "多选" : "单选",
    required: question.required,
    optionCount: question.options.length,
    options: question.options,
    routing: question.id === "safety" ? "SAFETY" : "STANDARD",
    routingLabel: question.id === "safety" ? "安全分流" : "普通分类",
    status: "CANDIDATE",
    version: definition.version,
    versionLabel: `v${definition.version}.0`,
  }))
    .filter((item) => !keyword || [item.number, item.id, item.title, item.versionLabel]
      .some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !type || item.type === type)
    .filter((item) => !requestedVersion || requestedVersion === String(item.version) || requestedVersion === item.versionLabel);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total: items.length,
      totalPages: items.length ? Math.ceil(items.length / pageSize) : 0,
    },
    currentVersion: `v${definition.version}.0`,
    scoringVersion: definition.scoringVersion,
    previewPath: "/pages/health/index",
  };
}

function submit(data, user, profile, input = {}, context = {}) {
  assertWriteEnabled(context);
  assertEligible(profile, context);
  const rootUserId = user.root_user_id || user.user_id;
  const previous = latest(data, rootUserId);
  if (previous && publicResult(previous)) {
    throw createClientError("FORMAL_HEALTH_ALREADY_COMPLETED", "健康起点评测已完成", 409);
  }
  const definition = healthOperationsModule.resolveInitializationDefinition(data, profile);
  const answers = assessmentModule.normalizeAnswers(input.answers, definition);
  const evaluation = evaluateAnswers(answers, data, context);
  const submittedAt = context.now || nowISO();
  const row = {
    questionnaire_answer_id: createId("qan"),
    root_user_id: rootUserId,
    campaign_id: CAMPAIGN_ID,
    questionnaire_id: QUESTIONNAIRE_ID,
    questionnaire_type: QUESTIONNAIRE_ID,
    version: definition.version,
    scoring_version: assessmentModule.SCORING_VERSION,
    answers_json: {
      answers,
      evaluation: {
        safety: evaluation.safety,
        assessment: evaluation.assessment,
      },
      result: evaluation.result,
    },
    submitted_at: submittedAt,
    idempotency_key: String(input.idempotencyKey || input.idempotency_key || "").trim() || null,
  };
  answerRows(data).push(row);
  return {
    success: true,
    answerId: row.questionnaire_answer_id,
    questionnaireVersion: row.version,
    result: publicResult(row),
  };
}

module.exports = {
  MINIMUM_AGE,
  QUESTIONNAIRE_ID,
  QUESTIONNAIRE_VERSION,
  adminInitializationDefinition,
  ageOn,
  bootstrap,
  getDefinition,
  resultFor,
  submit,
};
