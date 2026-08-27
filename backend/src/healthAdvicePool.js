const manifest = require("../data/health-advice-pool.v1.json");
const {
  INITIAL_RESULTS,
  GUT_RESULTS,
  REQUIRED_GUT_FIBER_ACTIONS,
  normalizeSyntheticScenario,
} = require("./healthAdviceCatalog");

const POOL_VERSION = "root4u-health-advice-pool-v1";
const EXPECTED_ACTIONS_PER_GROUP = 6;
const EXPECTED_FOLLOW_UP_COUNT = 6;
const REVIEWED_STATUS = "APPROVED";
const FIBER_LOCK_STATUS = "LOCKED_FROM_V0.6.1";
const FORBIDDEN_COPY = /诊断|治疗|治愈|疗效|处方|停药|换药|疾病判断|保证有效|药物剂量/;

function text(value) {
  return String(value || "").trim();
}

function safeText(value, maxLength = 160) {
  const normalized = text(value);
  if (!normalized || normalized.length > maxLength || FORBIDDEN_COPY.test(normalized)) return "";
  return normalized;
}

function stableIndex(value, length) {
  let hash = 2166136261;
  const source = text(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return length ? (hash >>> 0) % length : 0;
}

function stateSelectionKey(states) {
  if (!Array.isArray(states)) return "";
  return states
    .map((item) => `${text(item && item.assessmentType)}:${text(item && item.assessmentId)}`)
    .sort()
    .join("|");
}

function normalizeAction(item, expectedPrefix, options = {}) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const id = text(source.id);
  const topic = text(source.topic);
  const actionText = safeText(source.text, 120);
  const reviewStatus = text(source.reviewStatus);
  if (!id.startsWith(`${expectedPrefix}-`) || (!topic && options.requireTopic !== false) || !actionText) return null;
  if (!["PENDING_REVIEW", REVIEWED_STATUS].includes(reviewStatus)) return null;
  return Object.freeze({ id, topic, text: actionText, reviewStatus });
}

function normalizeGroup(source, code, options = {}) {
  const candidate = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.map((item) => normalizeAction(item, code)).filter(Boolean)
    : [];
  const summary = safeText(candidate.summary, 160);
  const summaryReviewStatus = text(candidate.summaryReviewStatus);
  const caution = options.caution ? safeText(candidate.caution, 180) : "";
  const cautionReviewStatus = options.caution ? text(candidate.cautionReviewStatus) : "";
  const valid = Boolean(
    text(candidate.label)
    && summary
    && ["PENDING_REVIEW", REVIEWED_STATUS].includes(summaryReviewStatus)
    && actions.length === EXPECTED_ACTIONS_PER_GROUP
    && new Set(actions.map((item) => item.id)).size === EXPECTED_ACTIONS_PER_GROUP
    && (!options.caution || (caution && ["PENDING_REVIEW", REVIEWED_STATUS].includes(cautionReviewStatus)))
  );
  return {
    valid,
    value: Object.freeze({
      label: text(candidate.label),
      summary,
      summaryReviewStatus,
      caution,
      cautionReviewStatus,
      actions: Object.freeze(actions),
    }),
  };
}

function createHealthAdvicePool(source = manifest) {
  const candidate = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const initialSource = candidate.initialGroups && typeof candidate.initialGroups === "object"
    ? candidate.initialGroups
    : {};
  const gutSource = candidate.gutGroups && typeof candidate.gutGroups === "object"
    ? candidate.gutGroups
    : {};
  const fiberSource = candidate.fixedFiberRules && typeof candidate.fixedFiberRules === "object"
    ? candidate.fixedFiberRules
    : {};
  const initialGroups = new Map();
  const gutGroups = new Map();
  let invalidComponentCount = 0;
  let pendingReviewCount = 0;
  const allIds = new Set();
  const allActionTexts = new Set();

  Object.keys(INITIAL_RESULTS).forEach((code) => {
    const group = normalizeGroup(initialSource[code], code);
    if (!group.valid) invalidComponentCount += 1;
    initialGroups.set(code, group.value);
  });
  Object.keys(GUT_RESULTS).forEach((code) => {
    const group = normalizeGroup(gutSource[code], code, { caution: true });
    if (!group.valid) invalidComponentCount += 1;
    gutGroups.set(code, group.value);
    const fiber = fiberSource[code] || {};
    if (text(fiber.text) !== REQUIRED_GUT_FIBER_ACTIONS[code]
      || text(fiber.reviewStatus) !== FIBER_LOCK_STATUS) invalidComponentCount += 1;
  });
  if (Object.keys(initialSource).sort().join("\0") !== Object.keys(INITIAL_RESULTS).sort().join("\0")) {
    invalidComponentCount += 1;
  }
  if (Object.keys(gutSource).sort().join("\0") !== Object.keys(GUT_RESULTS).sort().join("\0")) {
    invalidComponentCount += 1;
  }
  if (Object.keys(fiberSource).sort().join("\0") !== Object.keys(GUT_RESULTS).sort().join("\0")) {
    invalidComponentCount += 1;
  }

  const followUps = Array.isArray(candidate.followUps)
    ? candidate.followUps.map((item) => normalizeAction(item, "FOLLOWUP", { requireTopic: false })).filter(Boolean)
    : [];
  if (followUps.length !== EXPECTED_FOLLOW_UP_COUNT) invalidComponentCount += 1;

  const groups = [...initialGroups.values(), ...gutGroups.values()];
  groups.forEach((group) => {
    if (group.summaryReviewStatus !== REVIEWED_STATUS) pendingReviewCount += 1;
    if (group.caution && group.cautionReviewStatus !== REVIEWED_STATUS) pendingReviewCount += 1;
    group.actions.forEach((item) => {
      if (allIds.has(item.id) || allActionTexts.has(item.text)) invalidComponentCount += 1;
      allIds.add(item.id);
      allActionTexts.add(item.text);
      if (item.reviewStatus !== REVIEWED_STATUS) pendingReviewCount += 1;
    });
  });
  followUps.forEach((item) => {
    if (allIds.has(item.id) || allActionTexts.has(item.text)) invalidComponentCount += 1;
    allIds.add(item.id);
    allActionTexts.add(item.text);
    if (item.reviewStatus !== REVIEWED_STATUS) pendingReviewCount += 1;
  });

  const expectedComponentCount = (Object.keys(INITIAL_RESULTS).length * EXPECTED_ACTIONS_PER_GROUP)
    + (Object.keys(GUT_RESULTS).length * EXPECTED_ACTIONS_PER_GROUP)
    + EXPECTED_FOLLOW_UP_COUNT
    + Object.keys(INITIAL_RESULTS).length
    + (Object.keys(GUT_RESULTS).length * 2);
  const actualComponentCount = allIds.size
    + Object.keys(INITIAL_RESULTS).length
    + (Object.keys(GUT_RESULTS).length * 2);
  if (actualComponentCount !== expectedComponentCount) invalidComponentCount += 1;
  const structurallyValid = Boolean(
    candidate.schemaVersion === 1
    && candidate.poolVersion === POOL_VERSION
    && text(candidate.source) === "CODEX_OFFLINE_DRAFT"
    && text(candidate.generatedAt)
    && invalidComponentCount === 0
  );
  const configured = Boolean(
    structurallyValid
    && candidate.reviewStatus === REVIEWED_STATUS
    && text(candidate.reviewedAt)
    && text(candidate.reviewer)
    && pendingReviewCount === 0
  );

  return Object.freeze({
    poolVersion: POOL_VERSION,
    source: text(candidate.source),
    structurallyValid,
    configured,
    expectedComponentCount,
    actualComponentCount,
    pendingReviewCount,
    invalidComponentCount,
    combinationsPerScenario: EXPECTED_ACTIONS_PER_GROUP * EXPECTED_ACTIONS_PER_GROUP,
    totalScenarioCombinations: Object.keys(INITIAL_RESULTS).length
      * Object.keys(GUT_RESULTS).length
      * EXPECTED_ACTIONS_PER_GROUP
      * EXPECTED_ACTIONS_PER_GROUP,
    lookup(states) {
      if (!configured) return null;
      let scenario;
      try {
        const initial = states.find((item) => item && item.assessmentType === "INITIAL");
        const gut = states.find((item) => item && item.assessmentType === "GUT_REGULARITY");
        scenario = normalizeSyntheticScenario({
          initialResultCode: initial && initial.resultCode,
          gutResultCode: gut && gut.resultCode,
        });
      } catch {
        return null;
      }
      const initialGroup = initialGroups.get(scenario.initialResultCode);
      const gutGroup = gutGroups.get(scenario.gutResultCode);
      const selectionKey = stateSelectionKey(states) || `${scenario.initialResultCode}:${scenario.gutResultCode}`;
      const initialAction = initialGroup.actions[stableIndex(`${selectionKey}:initial`, initialGroup.actions.length)];
      const gutAction = gutGroup.actions[stableIndex(`${selectionKey}:gut`, gutGroup.actions.length)];
      const followUp = followUps[stableIndex(`${selectionKey}:follow-up`, followUps.length)];
      return Object.freeze({
        initialResultCode: scenario.initialResultCode,
        gutResultCode: scenario.gutResultCode,
        selection: Object.freeze({
          initialActionId: initialAction.id,
          gutActionId: gutAction.id,
          followUpId: followUp.id,
        }),
        advice: Object.freeze({
          summary: `${initialGroup.summary}${gutGroup.summary}`,
          actions: Object.freeze([
            REQUIRED_GUT_FIBER_ACTIONS[scenario.gutResultCode],
            initialAction.text,
            gutAction.text,
          ]),
          cautions: Object.freeze([gutGroup.caution]),
          followUp: followUp.text,
        }),
      });
    },
  });
}

const defaultHealthAdvicePool = createHealthAdvicePool();

module.exports = {
  EXPECTED_ACTIONS_PER_GROUP,
  EXPECTED_FOLLOW_UP_COUNT,
  POOL_VERSION,
  createHealthAdvicePool,
  defaultHealthAdvicePool,
  stableIndex,
  stateSelectionKey,
};
