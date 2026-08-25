const { request } = require("./request");
const { track } = require("./analytics");
const env = require("../config/env");
const localAssessment = require("./local-health-assessment");
const useLocalAssessmentStorage = env.healthAssessmentStorageMode === "LOCAL_DEVICE";

const TYPE_LABELS = {
  INITIAL: "初始评测",
  GUT_REGULARITY: "肠道规律自测",
};

const UNAVAILABLE_COPY = {
  NOT_ACTIVE: "当前未开放",
  CONTENT_REVIEW_PENDING: "内容审核中",
  DEFINITION_INVALID: "内容配置中",
  QUESTIONNAIRE_NOT_CONFIGURED: "题目配置中",
  RESULT_COPY_NOT_CONFIGURED: "结果说明配置中",
};

function requestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decorateAssessment(item = {}) {
  const priorityAction = item.result && item.result.priorityAction
    ? String(item.result.priorityAction)
    : "";
  return {
    ...item,
    result: item.result ? {
      ...item.result,
      priorityActionItems: priorityAction.split(/\n+/).map((value) => value.trim()).filter(Boolean),
    } : item.result,
    typeLabel: TYPE_LABELS[item.assessmentType] || "健康评测",
    completedAtText: formatDate(item.completedAt),
    versionText: item.questionnaireVersion ? `问卷 v${item.questionnaireVersion}` : "",
    resultTitle: item.result && item.result.title ? item.result.title : "结果待查看",
    safetyStopped: item.status === "SAFETY_STOPPED",
  };
}

function decorateCatalogItem(item = {}) {
  const definition = item.definition || {};
  return {
    ...item,
    definition,
    title: definition.title || TYPE_LABELS[item.assessmentType] || "健康评测",
    description: definition.description || (item.assessmentType === "GUT_REGULARITY"
      ? "用于近期肠道规律状态观察。"
      : "了解近期状态，为后续复测留下可比较基线。"),
    estimatedText: definition.estimatedMinutes ? `约 ${definition.estimatedMinutes} 分钟` : "",
    unavailableText: UNAVAILABLE_COPY[item.unavailableReason] || "暂未开放",
    latest: item.latest ? decorateAssessment(item.latest) : null,
    inProgress: item.inProgress ? decorateAssessment(item.inProgress) : null,
    canResume: item.canResume === true || Boolean(item.inProgress),
  };
}

async function getCatalog() {
  const data = useLocalAssessmentStorage
    ? localAssessment.catalog()
    : await request({ url: "/api/v1/health/assessments/catalog" });
  return {
    ...data,
    assessments: (data.assessments || []).map(decorateCatalogItem),
  };
}

async function startAssessment(assessmentType) {
  const result = useLocalAssessmentStorage
    ? localAssessment.start(assessmentType)
    : await request({
      url: "/api/v1/health/assessments/start",
      method: "POST",
      idempotencyKey: requestId("assessment-start"),
      data: {
        assessmentType,
        sourceChannel: "MINIPROGRAM_HEALTH_HOME",
      },
    });
  const assessment = result.assessment || {};
  track("assessment_start", {
    assessmentType: assessment.assessmentType || assessmentType,
    questionnaireVersion: assessment.questionnaireVersion || 0,
    isRetest: assessment.isRetest === true,
  });
  return result;
}

async function getAssessment(assessmentId) {
  const data = useLocalAssessmentStorage
    ? localAssessment.get(assessmentId)
    : await request({ url: `/api/v1/health/assessments/${assessmentId}` });
  return { ...data, assessment: decorateAssessment(data.assessment) };
}

async function saveDraft(assessmentId, answers) {
  if (useLocalAssessmentStorage) return localAssessment.saveDraft(assessmentId, answers);
  return request({
    url: `/api/v1/health/assessments/${assessmentId}/draft`,
    method: "POST",
    data: { answers },
  });
}

async function completeAssessment(assessmentId, answers) {
  const result = useLocalAssessmentStorage
    ? localAssessment.complete(assessmentId, answers)
    : await request({
      url: `/api/v1/health/assessments/${assessmentId}/complete`,
      method: "POST",
      idempotencyKey: `assessment-complete:${assessmentId}`,
      data: { answers, sourceChannel: "MINIPROGRAM_HEALTH_ASSESSMENT" },
    });
  const assessment = result.assessment || {};
  track("assessment_complete", {
    assessmentType: assessment.assessmentType || "",
    questionnaireVersion: assessment.questionnaireVersion || 0,
    isRetest: assessment.isRetest === true,
  });
  return result;
}

async function getHistory(assessmentType = "") {
  const query = assessmentType ? `?assessmentType=${encodeURIComponent(assessmentType)}` : "";
  const data = useLocalAssessmentStorage
    ? localAssessment.history(assessmentType)
    : await request({ url: `/api/v1/health/assessments/history${query}` });
  return {
    ...data,
    assessments: (data.assessments || []).map(decorateAssessment),
  };
}

async function compareAssessments(leftAssessmentId, rightAssessmentId) {
  const data = useLocalAssessmentStorage
    ? localAssessment.compare(leftAssessmentId, rightAssessmentId)
    : await request({
      url: "/api/v1/health/assessments/compare",
      method: "POST",
      data: { leftAssessmentId, rightAssessmentId },
    });
  track("assessment_compare_view", {
    leftVersion: data.left && data.left.questionnaireVersion || 0,
    rightVersion: data.right && data.right.questionnaireVersion || 0,
    comparable: data.comparable === true,
  });
  return {
    ...data,
    left: decorateAssessment(data.left),
    right: decorateAssessment(data.right),
    dimensions: (data.dimensions || []).map((item) => ({
      ...item,
      deltaText: item.delta > 0 ? `+${item.delta}` : String(item.delta),
      deltaTone: item.delta > 0 ? "up" : item.delta < 0 ? "down" : "same",
    })),
  };
}

module.exports = {
  TYPE_LABELS,
  compareAssessments,
  decorateAssessment,
  decorateCatalogItem,
  formatDate,
  getAssessment,
  getCatalog,
  getHistory,
  saveDraft,
  startAssessment,
  completeAssessment,
};
