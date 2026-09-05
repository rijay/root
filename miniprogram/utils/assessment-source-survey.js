const { request } = require("./request");
const { track } = require("./analytics");

function safeAssessmentId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(normalized) ? normalized : "";
}

function resultPath(assessmentId) {
  const normalized = safeAssessmentId(assessmentId);
  return normalized ? `/subpkg/health/pages/result/index?assessmentId=${encodeURIComponent(normalized)}` : "/pages/health/index";
}

function confirmationPath(assessmentId) {
  const normalized = safeAssessmentId(assessmentId);
  return normalized
    ? `/subpkg/health/pages/source-confirmation/index?assessmentId=${encodeURIComponent(normalized)}`
    : resultPath("");
}

async function getAssessmentSourceGate(assessmentId) {
  const normalized = safeAssessmentId(assessmentId);
  if (!normalized) throw new Error("评测记录无效");
  return request({
    url: `/api/v1/health/assessments/${normalized}/source-confirmation`,
    method: "GET",
  });
}

async function confirmAssessmentSource(assessmentId, optionId, configVersion) {
  const normalized = safeAssessmentId(assessmentId);
  if (!normalized) throw new Error("评测记录无效");
  const result = await request({
    url: `/api/v1/health/assessments/${normalized}/source-confirmation`,
    method: "POST",
    idempotencyKey: `assessment-source-confirm:${normalized}`,
    data: { optionId, configVersion },
  });
  track("assessment_source_confirm", {
    assessmentType: "GUT_REGULARITY",
    optionId: result.confirmation && result.confirmation.optionId || optionId || "",
    configVersion: result.confirmation && result.confirmation.configVersion || Number(configVersion || 0),
  });
  return result;
}

async function nextPathAfterAssessment(assessment = {}) {
  const assessmentId = safeAssessmentId(assessment.assessmentId || assessment.assessment_id);
  const fallback = resultPath(assessmentId);
  if (!assessmentId
    || String(assessment.assessmentType || assessment.assessment_type || "").toUpperCase() !== "GUT_REGULARITY"
    || String(assessment.status || "").toUpperCase() === "SAFETY_STOPPED") {
    return fallback;
  }
  try {
    const gate = await getAssessmentSourceGate(assessmentId);
    return gate && gate.required === true ? confirmationPath(assessmentId) : fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = Object.freeze({
  confirmationPath,
  confirmAssessmentSource,
  getAssessmentSourceGate,
  nextPathAfterAssessment,
  resultPath,
  safeAssessmentId,
});
