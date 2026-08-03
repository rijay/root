const { createClientError } = require("./clientError");
const { nowISO } = require("./dates");
const { createId } = require("./seed");
const formalHealthAccessPolicy = require("./formalHealthAccessPolicy");
const healthOperations = require("./healthOperationsModule");

function responseRows(data) {
  if (!Array.isArray(data.healthScaleResponses)) data.healthScaleResponses = [];
  return data.healthScaleResponses;
}

function rootUserId(user) {
  return user && (user.root_user_id || user.user_id);
}

function publicResult(row) {
  if (!row || !row.result_json || !row.result_json.title) return null;
  return {
    responseId: row.health_scale_response_id,
    scaleVersionId: row.scale_version_id,
    scaleVersionLabel: row.scale_version_label,
    scaleName: row.scale_name,
    score: row.score,
    minimumScore: row.minimum_score,
    maximumScore: row.maximum_score,
    levelId: row.result_level_id,
    levelTitle: row.result_json.title,
    summary: row.result_json.summary,
    tips: Array.isArray(row.result_json.tips) ? [...row.result_json.tips] : [],
    disclaimer: "结果用于整理日常状态，不构成疾病诊断或治疗建议。",
    completedAt: row.submitted_at,
  };
}

function getDefinition(data, versionId, profile, query = {}, context = {}) {
  formalHealthAccessPolicy.assertEligible(profile, context);
  const scale = healthOperations.resolvePublishedScale(data, versionId, context);
  const content = scale.content;
  const groupSize = 20;
  const groupCount = Math.ceil(content.questions.length / groupSize);
  const group = Number(query.group || 1);
  if (!Number.isInteger(group) || group < 1 || group > groupCount) {
    throw createClientError("HEALTH_SCALE_GROUP_INVALID", "题目分组无效", 400);
  }
  const questionOffset = (group - 1) * groupSize;
  return {
    definition: {
      versionId: scale.versionId,
      version: scale.version,
      versionLabel: scale.versionLabel,
      name: content.name,
      description: content.questionSummary,
      questionCount: content.questions.length,
      estimatedMinutes: Math.max(1, Math.ceil(content.questions.length / 5)),
      group,
      groupCount,
      groupSize,
      questionOffset,
      questions: content.questions.slice(questionOffset, questionOffset + groupSize).map((question) => ({
        id: question.id,
        title: question.title,
        type: question.type,
        required: question.required,
        options: question.options.map((option) => ({ value: option.value, label: option.label })),
      })),
    },
  };
}

function normalizeAnswers(input, questions) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const knownIds = new Set(questions.map((question) => question.id));
  if (Object.keys(source).some((id) => !knownIds.has(id))) {
    throw createClientError("HEALTH_SCALE_ANSWER_INVALID", "作答内容包含无效题目", 422);
  }
  const answers = {};
  for (const question of questions) {
    const value = String(source[question.id] || "").trim();
    if (!value) throw createClientError("HEALTH_SCALE_ANSWER_REQUIRED", "请完成全部必答题", 422);
    if (!question.options.some((option) => option.value === value)) {
      throw createClientError("HEALTH_SCALE_ANSWER_INVALID", "作答选项无效，请重新选择", 422);
    }
    answers[question.id] = value;
  }
  return answers;
}

function calculate(content, answers) {
  const score = content.questions.reduce((total, question) => {
    const option = question.options.find((item) => item.value === answers[question.id]);
    return total + option.score;
  }, 0);
  const minimumScore = content.questions.reduce((total, question) => total + Math.min(...question.options.map((item) => item.score)), 0);
  const maximumScore = content.questions.reduce((total, question) => total + Math.max(...question.options.map((item) => item.score)), 0);
  const level = content.resultLevels.find((item) => score >= item.minScore && score <= item.maxScore);
  if (!level) throw createClientError("HEALTH_SCALE_RESULT_UNAVAILABLE", "评测结果暂时无法生成，请稍后重试", 500);
  return { score, minimumScore, maximumScore, level };
}

function latestRow(data, user, scaleVersionId) {
  const ownerId = rootUserId(user);
  return responseRows(data)
    .filter((row) => row.root_user_id === ownerId && row.scale_version_id === scaleVersionId)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)))[0] || null;
}

function latestResult(data, user, scaleVersionId) {
  return publicResult(latestRow(data, user, String(scaleVersionId || "").trim()));
}

function submit(data, user, profile, versionId, input = {}, context = {}) {
  formalHealthAccessPolicy.assertWriteEnabled(context);
  formalHealthAccessPolicy.assertEligible(profile, context);
  const scale = healthOperations.resolvePublishedScale(data, versionId, context);
  const ownerId = rootUserId(user);
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  if (idempotencyKey) {
    const duplicate = responseRows(data).find((row) => row.root_user_id === ownerId
      && row.scale_version_id === scale.versionId && row.idempotency_key === idempotencyKey);
    if (duplicate) return { success: true, result: publicResult(duplicate) };
  }
  const answers = normalizeAnswers(input.answers, scale.content.questions);
  const { score, minimumScore, maximumScore, level } = calculate(scale.content, answers);
  const row = {
    health_scale_response_id: createId("hsr"),
    root_user_id: ownerId,
    scale_logical_id: scale.logicalId,
    scale_version_id: scale.versionId,
    scale_version: scale.version,
    scale_version_label: scale.versionLabel,
    scale_name: scale.content.name,
    answers_json: answers,
    score,
    minimum_score: minimumScore,
    maximum_score: maximumScore,
    result_level_id: level.id,
    result_json: { title: level.title, summary: level.summary, tips: level.tips },
    advice_version_id: scale.content.adviceVersionId,
    submitted_at: context.now || nowISO(),
    idempotency_key: idempotencyKey || null,
  };
  responseRows(data).push(row);
  return { success: true, result: publicResult(row) };
}

module.exports = { getDefinition, latestResult, submit };
