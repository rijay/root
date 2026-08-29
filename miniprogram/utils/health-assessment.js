const { request } = require("./request");
const { track } = require("./analytics");
const env = require("../config/env");
const localAssessment = require("./local-health-assessment");
const { decorateAdvice } = require("./health-advice-ui");
const { assessmentChannelContext } = require("./channel-attribution");
const useLocalAssessmentStorage = env.healthAssessmentStorageMode === "LOCAL_DEVICE";
const inflightAdviceRequests = new Map();

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

function initialCatalog() {
  return {
    storageMode: useLocalAssessmentStorage ? "LOCAL_DEVICE" : "SERVER",
    assessments: Object.values(localAssessment.DEFINITIONS).map((definition) => decorateCatalogItem({
      assessmentType: definition.assessmentType,
      definition: {
        assessmentDefinitionId: definition.assessmentDefinitionId,
        assessmentType: definition.assessmentType,
        questionnaireId: definition.questionnaireId,
        questionnaireVersion: definition.questionnaireVersion,
        title: definition.title,
        description: definition.description,
        estimatedMinutes: definition.estimatedMinutes,
        available: definition.available,
      },
      available: definition.available !== false,
      unavailableReason: "",
      historyCount: 0,
      latest: null,
      inProgress: null,
      canResume: false,
      canRetest: false,
    })),
  };
}

async function getCatalog() {
  const data = useLocalAssessmentStorage
    ? localAssessment.catalog()
    : await request({ url: "/api/v1/health/assessments/catalog" });
  return {
    ...data,
    storageMode: useLocalAssessmentStorage ? data.storageMode : "SERVER",
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
        ...assessmentChannelContext(),
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

async function deleteAssessment(assessmentId) {
  if (useLocalAssessmentStorage) {
    throw new Error("当前本地兼容模式不支持单条删除");
  }
  const result = await request({
    url: `/api/v1/health/assessments/${assessmentId}`,
    method: "DELETE",
  });
  track("assessment_delete", { deleted: result.deleted === true });
  return result;
}

function decorateOverview(data = {}) {
  const missingLabels = (data.missingAssessmentTypes || []).map((type) => TYPE_LABELS[type] || "健康评测");
  return {
    ...data,
    missingLabels,
    missingText: missingLabels.join("、"),
    advice: decorateAdvice(data.advice),
    states: (data.states || []).map((item) => ({
      ...item,
      typeLabel: TYPE_LABELS[item.assessmentType] || "健康评测",
      completedAtText: formatDate(item.completedAt),
    })),
  };
}

async function getHealthOverview() {
  return decorateOverview(await request({ url: "/api/v1/health/overview" }));
}

async function generateHealthAdvice(currentOverview = {}) {
  const inputKey = (currentOverview.states || []).map((item) => item.assessmentId).filter(Boolean).sort().join(":");
  const requestKey = inputKey || "current";
  if (inflightAdviceRequests.has(requestKey)) return inflightAdviceRequests.get(requestKey);
  const pending = request({
    url: "/api/v1/health/advice/generate",
    method: "POST",
    idempotencyKey: `health-advice:${requestKey}`,
  }).then(decorateOverview);
  inflightAdviceRequests.set(requestKey, pending);
  pending.finally(() => {
    if (inflightAdviceRequests.get(requestKey) === pending) inflightAdviceRequests.delete(requestKey);
  }).catch(() => {});
  return pending;
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
  deleteAssessment,
  decorateAssessment,
  decorateCatalogItem,
  decorateOverview,
  formatDate,
  getAssessment,
  getCatalog,
  getHistory,
  getHealthOverview,
  initialCatalog,
  generateHealthAdvice,
  saveDraft,
  startAssessment,
  completeAssessment,
};
