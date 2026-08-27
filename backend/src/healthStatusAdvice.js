const { nowISO } = require("./dates");
const { createId } = require("./seed");
const {
  requiredFiberActionForGutResult,
  scenarioForStates,
  validateCatalogAdvice,
} = require("./healthAdviceCatalog");
const { defaultHealthAdvicePool } = require("./healthAdvicePool");

const REQUIRED_TYPES = Object.freeze(["INITIAL", "GUT_REGULARITY"]);
const COMPLETED_STATUSES = new Set(["COMPLETED", "SAFETY_STOPPED"]);
const PROMPT_VERSION = "root4u-health-advice-pool-selection-v1";
const CONTENT_VERSION = "root4u-reviewed-fallback-v3";
const RULE_VERSION = "root4u-combined-state-v3";

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function snapshots(data) {
  if (!Array.isArray(data.healthAdviceSnapshots)) data.healthAdviceSnapshots = [];
  return data.healthAdviceSnapshots;
}

function completedAttempts(data, rootUserId, type) {
  const all = Array.isArray(data.healthAssessmentAttempts) ? data.healthAssessmentAttempts : [];
  return all
    .filter((item) => item.root_user_id === rootUserId
      && item.assessment_type === type
      && COMPLETED_STATUSES.has(item.status))
    .sort((left, right) => String(right.completed_at || right.updated_at).localeCompare(String(left.completed_at || left.updated_at)));
}

function publicState(attempt) {
  if (!attempt) return null;
  const result = attempt.result_json && typeof attempt.result_json === "object" ? attempt.result_json : {};
  return {
    assessmentId: attempt.assessment_id,
    assessmentType: attempt.assessment_type,
    questionnaireVersion: Number(attempt.questionnaire_version || 0),
    status: attempt.status,
    safetyStopped: attempt.status === "SAFETY_STOPPED",
    resultCode: text(result.resultCode || result.result_code),
    title: text(result.title, "状态待查看"),
    summary: text(result.summary),
    completedAt: attempt.completed_at || "",
  };
}

function currentStates(data, rootUserId) {
  return REQUIRED_TYPES.map((type) => publicState(completedAttempts(data, rootUserId, type)[0])).filter(Boolean);
}

function inputIds(states) {
  return {
    initialAssessmentId: text(states.find((item) => item.assessmentType === "INITIAL")?.assessmentId),
    gutAssessmentId: text(states.find((item) => item.assessmentType === "GUT_REGULARITY")?.assessmentId),
  };
}

function matchingSnapshot(data, rootUserId, states) {
  const ids = inputIds(states);
  return snapshots(data).find((item) => (
    item.root_user_id === rootUserId
    && item.initial_assessment_id === ids.initialAssessmentId
    && item.gut_assessment_id === ids.gutAssessmentId
    && item.prompt_version === PROMPT_VERSION
  )) || null;
}

function publicAdvice(snapshot) {
  if (!snapshot) return null;
  const sourceLabels = {
    REVIEWED_ADVICE_POOL: "AI 辅助起草，经人工审核",
    REVIEWED_FALLBACK: "经审核规则建议",
    REVIEWED_SAFETY: "经审核安全提示",
  };
  return {
    adviceId: snapshot.health_advice_snapshot_id,
    source: snapshot.advice_source,
    sourceLabel: sourceLabels[snapshot.advice_source] || "经审核规则建议",
    modelName: "",
    promptVersion: snapshot.prompt_version,
    contentVersion: snapshot.content_version,
    generatedAt: snapshot.generated_at,
    ...snapshot.advice_json,
  };
}

function overview(data, rootUserId) {
  const states = currentStates(data, rootUserId);
  const presentTypes = new Set(states.map((item) => item.assessmentType));
  const missingAssessmentTypes = REQUIRED_TYPES.filter((type) => !presentTypes.has(type));
  const ready = missingAssessmentTypes.length === 0;
  return {
    ready,
    missingAssessmentTypes,
    states,
    advice: ready ? publicAdvice(matchingSnapshot(data, rootUserId, states)) : null,
  };
}

function fallbackAdvice(states) {
  const gut = states.find((item) => item.assessmentType === "GUT_REGULARITY") || {};
  const byGutResult = {
    CONSTIPATION: "把规律饮水、三餐节奏和每日活动作为这一阶段的观察重点。",
    LOOSE: "先保持饮食节奏稳定，记录排便形态和可能的诱发时段。",
    ALTERNATING: "近期状态存在波动，先减少同时改变多个生活习惯。",
    SENSITIVE: "近期感受较敏感，优先选择温和、少量、逐步的调整方式。",
    HEALTHY: "当前肠道节奏总体较稳定，可继续保持并定期回测。",
  };
  return {
    summary: byGutResult[gut.resultCode] || "结合两项评测，建议先用稳定、可重复的小行动继续观察近期状态。",
    actions: [
      requiredFiberActionForGutResult(gut.resultCode) || "未来 7 天保持相对固定的起床和进餐时间。",
      "每天选择一个固定时段记录饮水、活动和排便感受。",
      "一次只调整一个容易坚持的习惯，并在回测后再判断是否继续。",
    ],
    cautions: ["如出现持续、加重或令你担心的不适，请及时咨询专业人士。"],
    followUp: "建议在生活节奏或身体感受出现明显变化后重新评测。",
  };
}

function safetyAdvice() {
  return {
    summary: "本次结果进入安全提示分支，不继续生成普通生活方式建议。",
    actions: [
      "如相关情况正在持续、加重或令你担心，请尽快咨询专业人士。",
      "在获得专业意见前，避免自行进行幅度较大的饮食或补充剂调整。",
      "不要因为本次问卷或建议延迟寻求专业帮助。",
    ],
    cautions: ["本次结果仅作安全提示，不替代专业判断。"],
    followUp: "待专业人士确认适合继续自我观察后，再考虑回测。",
  };
}

function validateReviewedAdvice(value) {
  return validateCatalogAdvice(value);
}

function snapshotState(states) {
  return states.map((item) => ({
    assessmentType: item.assessmentType,
    questionnaireVersion: item.questionnaireVersion,
    resultCode: item.resultCode,
    title: item.title,
    safetyStopped: item.safetyStopped,
  }));
}

async function generate(data, rootUserId, context = {}) {
  const current = overview(data, rootUserId);
  if (!current.ready) return current;
  if (current.advice) return { ...current, reused: true };

  const safetyStopped = current.states.some((item) => item.safetyStopped);
  let advice = safetyStopped ? safetyAdvice() : null;
  let adviceSource = safetyStopped ? "REVIEWED_SAFETY" : "REVIEWED_FALLBACK";
  const pool = context.healthAdvicePool || defaultHealthAdvicePool;
  const poolEntry = !safetyStopped && pool && typeof pool.lookup === "function"
    ? pool.lookup(current.states)
    : null;
  if (poolEntry) {
    advice = validateCatalogAdvice(poolEntry.advice, scenarioForStates(current.states));
    if (advice) adviceSource = "REVIEWED_ADVICE_POOL";
  }
  if (!advice) advice = fallbackAdvice(current.states);

  const ids = inputIds(current.states);
  const now = nowISO();
  const snapshot = {
    health_advice_snapshot_id: createId("hasn"),
    root_user_id: rootUserId,
    initial_assessment_id: ids.initialAssessmentId,
    gut_assessment_id: ids.gutAssessmentId,
    states_json: snapshotState(current.states),
    advice_json: advice,
    advice_source: adviceSource,
    adapter_id: adviceSource === "REVIEWED_ADVICE_POOL" ? text(pool.adapterId) : "ROOT4U_REVIEWED_CONTENT",
    model_name: "",
    prompt_version: PROMPT_VERSION,
    content_version: adviceSource === "REVIEWED_ADVICE_POOL" ? text(pool.poolVersion) : CONTENT_VERSION,
    rule_version: RULE_VERSION,
    generated_at: now,
    created_at: now,
    updated_at: now,
  };
  snapshots(data).push(snapshot);
  return { ...overview(data, rootUserId), reused: false };
}

module.exports = {
  CONTENT_VERSION,
  PROMPT_VERSION,
  REQUIRED_TYPES,
  RULE_VERSION,
  fallbackAdvice,
  generate,
  overview,
  safetyAdvice,
  validateReviewedAdvice,
};
