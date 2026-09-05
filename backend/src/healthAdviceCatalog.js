const manifest = require("../data/health-advice-catalog.v1.json");

const CATALOG_VERSION = "root4u-health-advice-catalog-v1";
const TAXONOMY_VERSION = "root4u-health-advice-taxonomy-v1";
const CATALOG_PROMPT_VERSION = "root4u-health-advice-catalog-prompt-v2";
const CATALOG_ADAPTER_ID = "ROOT4U_REVIEWED_MODEL_CATALOG_V1";

const INITIAL_RESULTS = Object.freeze({
  BASELINE: Object.freeze({ label: "基础状态维护型", description: "建立稳定、可重复的日常观察。" }),
  BOWEL: Object.freeze({ label: "肠道规律关注型", description: "关注排便规律与相关生活节奏。" }),
  DIGESTION: Object.freeze({ label: "腹胀反酸关注型", description: "关注消化感受与进餐节奏。" }),
  SLEEP: Object.freeze({ label: "睡眠节律关注型", description: "关注睡眠与作息节律。" }),
  ENERGY: Object.freeze({ label: "压力活力关注型", description: "关注压力、恢复与精力状态。" }),
  LIFESTYLE: Object.freeze({ label: "活动饮食调整型", description: "关注活动、饮食与可执行的小变化。" }),
});

const GUT_RESULTS = Object.freeze({
  CONSTIPATION: Object.freeze({ label: "肠道节奏偏慢", description: "关注排便间隔、形态与排便感受。" }),
  LOOSE: Object.freeze({ label: "肠道节奏偏快", description: "关注排便次数、形态与便急感受。" }),
  ALTERNATING: Object.freeze({ label: "肠道节奏波动", description: "关注排便频率或形态的近期变化。" }),
  SENSITIVE: Object.freeze({ label: "肠道较敏感", description: "关注消化感受与可能的生活诱因。" }),
  HEALTHY: Object.freeze({ label: "肠道节奏稳定", description: "保持规律饮食、饮水与日常观察。" }),
});

const REQUIRED_GUT_FIBER_ACTIONS = Object.freeze({
  CONSTIPATION: "补充益生元纤维，帮助软化便便促蠕动",
  LOOSE: "补充可溶性纤维，帮助吸水让便便成形",
  ALTERNATING: "补充益生元纤维，双向调节排便节奏",
  SENSITIVE: "补充低FODMAP益生元，温和滋养不胀气",
  HEALTHY: "日常补充益生元，持续滋养肠道有益菌",
});

function text(value) {
  return String(value || "").trim();
}

function normalizedList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item).slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

const FORBIDDEN_COPY = /诊断|治疗|治愈|疗效|处方|停药|换药|疾病判断|保证有效|药物剂量/;

function normalizeCatalogAdvice(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const advice = {
    summary: text(source.summary).slice(0, 240),
    actions: normalizedList(source.actions, 3, 120),
    cautions: normalizedList(source.cautions, 3, 120),
    followUp: text(source.followUp).slice(0, 160),
  };
  if (!advice.summary || advice.actions.length !== 3 || !advice.followUp) return null;
  if (FORBIDDEN_COPY.test(JSON.stringify(advice))) return null;
  return advice;
}

function requiredFiberActionForGutResult(value) {
  return REQUIRED_GUT_FIBER_ACTIONS[text(value).toUpperCase()] || "";
}

function requiredFiberActionForScenario(value) {
  const scenario = normalizeSyntheticScenario(value);
  return requiredFiberActionForGutResult(scenario.gutResultCode);
}

function validateCatalogAdvice(value, scenario) {
  const advice = normalizeCatalogAdvice(value);
  if (!advice) return null;
  if (scenario && advice.actions[0] !== requiredFiberActionForScenario(scenario)) return null;
  return advice;
}

function applyRequiredFiberAction(value, scenario) {
  const advice = normalizeCatalogAdvice(value);
  if (!advice) return null;
  const requiredAction = requiredFiberActionForScenario(scenario);
  const remainingActions = advice.actions.filter((action) => action !== requiredAction).slice(0, 2);
  if (remainingActions.length !== 2) return null;
  return {
    ...advice,
    actions: [requiredAction, ...remainingActions],
  };
}

function normalizeSyntheticScenario(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const keys = Object.keys(source).sort();
  if (keys.join("\0") !== "gutResultCode\0initialResultCode") {
    const error = new Error("合成建议场景只能包含两个固定结果代码");
    error.code = "HEALTH_ADVICE_CATALOG_SCENARIO_INVALID";
    throw error;
  }
  const initialResultCode = text(source.initialResultCode).toUpperCase();
  const gutResultCode = text(source.gutResultCode).toUpperCase();
  if (!INITIAL_RESULTS[initialResultCode] || !GUT_RESULTS[gutResultCode]) {
    const error = new Error("合成建议场景不在固定枚举内");
    error.code = "HEALTH_ADVICE_CATALOG_SCENARIO_INVALID";
    throw error;
  }
  return Object.freeze({ initialResultCode, gutResultCode });
}

function scenarioKey(value) {
  const scenario = normalizeSyntheticScenario(value);
  return `${scenario.initialResultCode}:${scenario.gutResultCode}`;
}

const SYNTHETIC_SCENARIOS = Object.freeze(
  Object.keys(INITIAL_RESULTS).flatMap((initialResultCode) => (
    Object.keys(GUT_RESULTS).map((gutResultCode) => Object.freeze({ initialResultCode, gutResultCode }))
  ))
);

function scenarioForStates(states) {
  if (!Array.isArray(states)) return null;
  const initial = states.find((item) => item && item.assessmentType === "INITIAL");
  const gut = states.find((item) => item && item.assessmentType === "GUT_REGULARITY");
  try {
    return normalizeSyntheticScenario({
      initialResultCode: initial && initial.resultCode,
      gutResultCode: gut && gut.resultCode,
    });
  } catch {
    return null;
  }
}

function createHealthAdviceCatalog(source = manifest) {
  const candidate = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const entries = Array.isArray(candidate.entries) ? candidate.entries : [];
  const approvedEntries = new Map();
  let invalidEntryCount = 0;
  for (const entry of entries) {
    if (!entry || entry.reviewStatus !== "APPROVED") {
      invalidEntryCount += 1;
      continue;
    }
    let key;
    try {
      key = scenarioKey({
        initialResultCode: entry.initialResultCode,
        gutResultCode: entry.gutResultCode,
      });
    } catch {
      invalidEntryCount += 1;
      continue;
    }
    const scenario = {
      initialResultCode: entry.initialResultCode,
      gutResultCode: entry.gutResultCode,
    };
    const advice = validateCatalogAdvice(entry.advice, scenario);
    if (!advice || approvedEntries.has(key)) {
      invalidEntryCount += 1;
      continue;
    }
    approvedEntries.set(key, Object.freeze({ ...entry, advice: Object.freeze(advice) }));
  }
  const manifestApproved = candidate.schemaVersion === 1
    && candidate.catalogVersion === CATALOG_VERSION
    && candidate.taxonomyVersion === TAXONOMY_VERSION
    && candidate.promptVersion === CATALOG_PROMPT_VERSION
    && candidate.reviewStatus === "APPROVED"
    && text(candidate.generatedAt)
    && text(candidate.reviewedAt)
    && text(candidate.reviewer);
  const configured = Boolean(
    manifestApproved
    && entries.length === SYNTHETIC_SCENARIOS.length
    && approvedEntries.size === SYNTHETIC_SCENARIOS.length
    && invalidEntryCount === 0
  );
  return Object.freeze({
    adapterId: CATALOG_ADAPTER_ID,
    catalogVersion: CATALOG_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    modelName: text(candidate.modelName),
    configured,
    expectedEntryCount: SYNTHETIC_SCENARIOS.length,
    approvedEntryCount: approvedEntries.size,
    invalidEntryCount,
    lookup(states) {
      if (!configured) return null;
      const scenario = scenarioForStates(states);
      if (!scenario) return null;
      return approvedEntries.get(scenarioKey(scenario)) || null;
    },
  });
}

const defaultCatalog = createHealthAdviceCatalog();

module.exports = {
  CATALOG_ADAPTER_ID,
  CATALOG_PROMPT_VERSION,
  CATALOG_VERSION,
  GUT_RESULTS,
  INITIAL_RESULTS,
  REQUIRED_GUT_FIBER_ACTIONS,
  SYNTHETIC_SCENARIOS,
  TAXONOMY_VERSION,
  applyRequiredFiberAction,
  createHealthAdviceCatalog,
  defaultCatalog,
  normalizeSyntheticScenario,
  requiredFiberActionForGutResult,
  requiredFiberActionForScenario,
  scenarioForStates,
  scenarioKey,
  validateCatalogAdvice,
};
