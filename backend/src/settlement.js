const { nowISO } = require("./dates");
const { createId } = require("./seed");
const campaign = require("./campaign");
const taskProgress = require("./taskProgress");
const manualReview = require("./manualReview");

const SOURCE_INVALIDATION_SOURCE_TYPE = "TASK_SOURCE_INVALIDATION";
const SOURCE_INVALIDATION_HANDLER_VERSION = "settlement-source-invalidation-v1";
const SOURCE_INVALIDATION_STOP_REVIEW_TYPE = "SETTLEMENT_STOP_CANDIDATE";
const SOURCE_INVALIDATION_RECALC_REVIEW_TYPE = "SETTLEMENT_RECALC_CANDIDATE";
const SOURCE_INVALIDATION_SETTLED_STATUSES = Object.freeze([
  "QUALIFIED",
  "UNQUALIFIED",
  "NOT_QUALIFIED",
  "ADJUSTED",
  "REVIEW_REQUIRED",
]);

const DEFAULT_RULE_VERSION = {
  campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
  version: 1,
  status: "PUBLISHED",
  conditions_json: [
    {
      condition_type: "TASK_COUNT",
      task_type: "CHECKIN",
      min_count: 7,
      unique_by: "taskDate",
      label: "完成 7 天身体记录",
    },
    {
      condition_type: "QUESTIONNAIRE_COMPLETED",
      questionnaire_type: "DAY8_SUMMARY",
      label: "完成收尾问卷",
    },
  ],
  rewards_json: [],
};

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sourceInvalidationMetadata(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sourceInvalidationStateError() {
  return businessError(
    "SETTLEMENT_SOURCE_INVALIDATION_STATE_INVALID",
    "任务来源失效后的结算状态不可验证",
    503
  );
}

function sourceInvalidationInstant(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  const mysql = normalized.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/
  );
  const parsed = Date.parse(mysql
    ? `${mysql[1]}T${mysql[2]}.${String(mysql[3] || "0").padEnd(3, "0")}+08:00`
    : normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameSourceInvalidationInstant(left, right) {
  const leftInstant = sourceInvalidationInstant(left);
  return leftInstant !== null && leftInstant === sourceInvalidationInstant(right);
}

function validateSourceInvalidationCandidate(data, row, rootUserId, campaignId) {
  const metadata = sourceInvalidationMetadata(row.metadata);
  if (!isPlainObject(row)
    || row.root_user_id !== rootUserId
    || row.campaign_id !== campaignId
    || ![SOURCE_INVALIDATION_STOP_REVIEW_TYPE, SOURCE_INVALIDATION_RECALC_REVIEW_TYPE]
      .includes(row.review_type)
    || row.source_type !== SOURCE_INVALIDATION_SOURCE_TYPE
    || !text(row.source_id)
    || row.reason !== "TASK_SOURCE_INVALIDATED"
    || !["OPEN", "RESOLVED"].includes(row.status)
    || row.priority !== "HIGH"
    || !metadata
    || metadata.contractVersion !== 1
    || metadata.handlerVersion !== SOURCE_INVALIDATION_HANDLER_VERSION
    || metadata.appendOnly !== true
    || metadata.taskSourceInvalidationEventId !== row.source_id
    || metadata.rootUserId !== rootUserId
    || metadata.campaignId !== campaignId
    || !text(metadata.campaignRuleVersionId)
    || !Number.isSafeInteger(metadata.ruleVersion)
    || metadata.ruleVersion < 1) throw sourceInvalidationStateError();

  const idempotencyKey = [
    "task-source-invalidation",
    metadata.taskSourceInvalidationEventId,
    "rule",
    metadata.campaignRuleVersionId,
    metadata.ruleVersion,
  ].join(":");
  const rule = ensureList(data, "campaignRuleVersions").find((candidate) => (
    candidate.campaign_rule_version_id === metadata.campaignRuleVersionId
      && candidate.campaign_id === campaignId
      && Number(candidate.version) === metadata.ruleVersion
  ));
  if (row.idempotency_key !== idempotencyKey || !rule || rule.status !== "PUBLISHED") {
    throw sourceInvalidationStateError();
  }

  const originalId = metadata.originalSettlementRecordId;
  const originalStatus = metadata.originalSettlementStatus;
  const originalEvaluatedAt = metadata.originalSettlementEvaluatedAt;
  const original = originalId === null
    ? null
    : ensureList(data, "settlementRecords").find((candidate) => (
      candidate.settlement_record_id === originalId
    ));
  if (originalId === null) {
    if (originalStatus !== null || originalEvaluatedAt !== null) {
      throw sourceInvalidationStateError();
    }
  } else if (!original
    || original.root_user_id !== rootUserId
    || original.campaign_id !== campaignId
    || original.campaign_rule_version_id !== metadata.campaignRuleVersionId
    || Number(original.rule_version) !== metadata.ruleVersion
    || original.status !== originalStatus
    || !sameSourceInvalidationInstant(
      original.evaluated_at || original.created_at,
      originalEvaluatedAt
    )) {
    throw sourceInvalidationStateError();
  }

  const stop = row.review_type === SOURCE_INVALIDATION_STOP_REVIEW_TYPE;
  if (stop) {
    if (metadata.candidateKind !== "STOP_OR_CANCEL"
      || metadata.decision !== "STOP_AUTOMATIC_SETTLEMENT"
      || ![null, "PENDING"].includes(originalStatus)) throw sourceInvalidationStateError();
  } else if (metadata.candidateKind !== "ADJUSTMENT_OR_RECALCULATION"
    || metadata.decision !== "RECALCULATION_REQUIRED"
    || !SOURCE_INVALIDATION_SETTLED_STATUSES.includes(originalStatus)) {
    throw sourceInvalidationStateError();
  }
  return { stop, row, metadata };
}

function sourceInvalidationCandidates(data, rootUserId, campaignId) {
  return ensureList(data, "manualReviewItems")
    .filter((item) => item && item.source_type === SOURCE_INVALIDATION_SOURCE_TYPE)
    .filter((item) => item.root_user_id === rootUserId && item.campaign_id === campaignId)
    .map((item) => validateSourceInvalidationCandidate(
      data,
      item,
      rootUserId,
      campaignId
    ));
}

function assertSettlementSourceAvailable(data, rootUserId, campaignId, options = {}) {
  const candidates = sourceInvalidationCandidates(data, rootUserId, campaignId);
  const stop = candidates.find((candidate) => candidate.stop);
  if (stop) {
    throw businessError(
      "SETTLEMENT_SOURCE_INVALIDATED",
      "活动任务来源已取消，本次结算已停止",
      409
    );
  }
  if (options.forWrite === true && candidates.length > 0) {
    throw businessError(
      "SETTLEMENT_RECALCULATION_REQUIRED",
      "原结算需通过追加调整流程复核，不能自动重算或覆盖",
      409
    );
  }
  return true;
}

function normalizeLogic(value) {
  const logic = text(value, "AND").toUpperCase();
  return logic === "OR" ? "OR" : "AND";
}

function normalizeConditionsInput(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return value;
  return [];
}

function conditionLeafCount(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + conditionLeafCount(item), 0);
  if (!isPlainObject(value)) return 0;
  if (Array.isArray(value.conditions)) return value.conditions.reduce((sum, item) => sum + conditionLeafCount(item), 0);
  return 1;
}

function ensureDefaultRuleVersion(data) {
  campaign.ensureDefaultCampaign(data);
  const versions = ensureList(data, "campaignRuleVersions");
  let version = versions.find((item) => item.campaign_id === DEFAULT_RULE_VERSION.campaign_id && item.version === DEFAULT_RULE_VERSION.version);
  if (!version) {
    const now = nowISO();
    version = {
      campaign_rule_version_id: createId("crv"),
      ...DEFAULT_RULE_VERSION,
      published_at: now,
      created_at: now,
      updated_at: now,
    };
    versions.push(version);
  }
  return version;
}

function latestPublishedRuleVersion(data, campaignId, versionNo = null) {
  ensureDefaultRuleVersion(data);
  const versions = ensureList(data, "campaignRuleVersions")
    .filter((item) => item.campaign_id === campaignId && item.status === "PUBLISHED")
    .filter((item) => versionNo === null || Number(item.version) === Number(versionNo))
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  if (!versions.length) throw businessError(8001, "活动规则尚未发布");
  return versions[0];
}

function publishRuleVersion(data, input = {}) {
  const campaignId = text(input.campaignId || input.campaign_id, campaign.DEFAULT_CAMPAIGN_ID);
  campaign.ensureDefaultCampaign(data);
  const versions = ensureList(data, "campaignRuleVersions");
  const versionNo = Number(input.version || versions.filter((item) => item.campaign_id === campaignId).length + 1);
  const existing = versions.find((item) => item.campaign_id === campaignId && Number(item.version) === versionNo);
  if (existing && existing.status === "PUBLISHED") {
    return { ruleVersion: existing, created: false };
  }
  const now = nowISO();
  const ruleVersion = existing || {
    campaign_rule_version_id: createId("crv"),
    campaign_id: campaignId,
    version: versionNo,
    created_at: now,
  };
  Object.assign(ruleVersion, {
    status: "PUBLISHED",
    conditions_json: normalizeConditionsInput(input.conditions || input.conditions_json),
    rewards_json: arrayValue(input.rewards || input.rewards_json),
    published_at: ruleVersion.published_at || now,
    updated_at: now,
  });
  if (!conditionLeafCount(ruleVersion.conditions_json)) throw businessError(8002, "规则条件不能为空");
  if (!existing) versions.push(ruleVersion);
  return { ruleVersion, created: !existing };
}

function taskEventsFor(data, rootUserId, campaignId, taskType = "") {
  return ensureList(data, "taskEvents")
    .filter((event) => event.root_user_id === rootUserId && event.campaign_id === campaignId && event.status !== "VOID")
    .filter((event) => !taskType || event.task_type === taskType);
}

function uniqueCount(events, uniqueBy = "") {
  if (!uniqueBy) return events.length;
  const values = new Set(events.map((event) => {
    if (uniqueBy === "taskDate") return event.task_date || String(event.occurred_at || "").slice(0, 10);
    const payload = event.payload_json || {};
    return payload[uniqueBy] || event[uniqueBy] || event.task_event_id;
  }));
  return values.size;
}

function longestStreak(dateValues) {
  const dates = Array.from(new Set(dateValues.filter(Boolean))).sort();
  if (!dates.length) return 0;
  let best = 1;
  let current = 1;
  for (let index = 1; index < dates.length; index += 1) {
    const prev = new Date(`${dates[index - 1]}T00:00:00Z`).getTime();
    const next = new Date(`${dates[index]}T00:00:00Z`).getTime();
    if (next - prev === 24 * 60 * 60 * 1000) current += 1;
    else current = 1;
    best = Math.max(best, current);
  }
  return best;
}

function evaluateCondition(data, rootUserId, campaignId, condition = {}) {
  const type = text(condition.conditionType || condition.condition_type, "TASK_COUNT").toUpperCase();
  const taskType = text(condition.taskType || condition.task_type).toUpperCase();
  const label = text(condition.label, type);
  if (type === "TASK_COUNT" || type === "SHARE_COUNT") {
    const minCount = Number(condition.minCount || condition.min_count || 1);
    const events = taskEventsFor(data, rootUserId, campaignId, taskType || (type === "SHARE_COUNT" ? "SHARE" : ""));
    const actual = uniqueCount(events, condition.uniqueBy || condition.unique_by || "");
    return { conditionType: type, label, passed: actual >= minCount, actual, target: minCount, missing: Math.max(0, minCount - actual) };
  }
  if (type === "TASK_STREAK") {
    const minStreak = Number(condition.minStreak || condition.min_streak || 1);
    const events = taskEventsFor(data, rootUserId, campaignId, taskType || "CHECKIN");
    const actual = longestStreak(events.map((event) => event.task_date));
    return { conditionType: type, label, passed: actual >= minStreak, actual, target: minStreak, missing: Math.max(0, minStreak - actual) };
  }
  if (type === "QUESTIONNAIRE_COMPLETED") {
    const questionnaireType = text(condition.questionnaireType || condition.questionnaire_type || condition.questionnaireId || condition.questionnaire_id);
    const events = taskEventsFor(data, rootUserId, campaignId, "QUESTIONNAIRE");
    const matched = events.some((event) => {
      const payload = event.payload_json || {};
      return payload.questionnaireType === questionnaireType || payload.questionnaire_type === questionnaireType;
    });
    return { conditionType: type, label, passed: matched, actual: matched ? 1 : 0, target: 1, missing: matched ? 0 : 1 };
  }
  if (type === "CONSULTATION_REQUIRED") {
    const matched = taskEventsFor(data, rootUserId, campaignId, "CONSULTATION").length > 0;
    return { conditionType: type, label, passed: matched, actual: matched ? 1 : 0, target: 1, missing: matched ? 0 : 1 };
  }
  if (type === "PURCHASE_COMPLETED") {
    const productId = text(condition.youzanProductId || condition.youzan_product_id);
    const events = taskEventsFor(data, rootUserId, campaignId, "PURCHASE");
    const matched = events.some((event) => {
      const payload = event.payload_json || {};
      return !productId || payload.youzanProductId === productId || payload.youzan_product_id === productId;
    });
    return { conditionType: type, label, passed: matched, actual: matched ? 1 : 0, target: 1, missing: matched ? 0 : 1 };
  }
  return { conditionType: type, label, passed: false, actual: 0, target: 1, missing: 1, unsupported: true };
}

function evaluateConditionNode(data, rootUserId, campaignId, node) {
  if (Array.isArray(node)) {
    return evaluateConditionGroup(data, rootUserId, campaignId, { logic: "AND", conditions: node, implicit: true });
  }
  if (isPlainObject(node) && Array.isArray(node.conditions)) {
    return evaluateConditionGroup(data, rootUserId, campaignId, node);
  }
  return evaluateCondition(data, rootUserId, campaignId, node);
}

function evaluateConditionGroup(data, rootUserId, campaignId, group = {}) {
  const logic = normalizeLogic(group.logic || group.operator);
  const children = arrayValue(group.conditions).map((condition) => evaluateConditionNode(data, rootUserId, campaignId, condition));
  const passedCount = children.filter((condition) => condition.passed).length;
  const passed = children.length > 0 && (logic === "OR" ? passedCount > 0 : passedCount === children.length);
  const label = text(group.label, logic === "OR" ? "满足任一条件" : "满足全部条件");
  return {
    conditionType: "CONDITION_GROUP",
    label,
    logic,
    passed,
    actual: logic === "OR" ? (passed ? 1 : 0) : passedCount,
    target: logic === "OR" ? 1 : children.length,
    missing: passed ? 0 : logic === "OR" ? 1 : children.length - passedCount,
    conditions: children,
    implicit: Boolean(group.implicit),
  };
}

function flattenLeafConditions(node) {
  if (!node) return [];
  if (node.conditionType === "CONDITION_GROUP") return arrayValue(node.conditions).flatMap(flattenLeafConditions);
  return [node];
}

function missingConditionsFor(node) {
  if (!node) return [];
  if (node.conditionType !== "CONDITION_GROUP") return node.passed ? [] : [node];
  if (node.passed) return [];
  return arrayValue(node.conditions).flatMap(missingConditionsFor);
}

function buildSettlementResult(data, rootUserId, campaignId, ruleVersion) {
  const progress = taskProgress.computeTaskProgress(data, rootUserId, campaignId);
  const conditionTree = evaluateConditionNode(data, rootUserId, campaignId, ruleVersion.conditions_json);
  const leafConditions = flattenLeafConditions(conditionTree);
  const conditions = conditionTree.implicit ? leafConditions : [conditionTree];
  const missingConditions = missingConditionsFor(conditionTree);
  const qualified = leafConditions.length > 0 && conditionTree.passed;
  return {
    qualified,
    conditions,
    conditionTree,
    progress,
    missingConditions,
    evaluatedAt: nowISO(),
  };
}

function latestSettlementRecord(data, rootUserId, campaignId) {
  return ensureList(data, "settlementRecords")
    .filter((record) => record.root_user_id === rootUserId && record.campaign_id === campaignId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

function previewSettlement(data, rootUserId, campaignId = "", options = {}) {
  const activeCampaign = campaign.getActiveCampaign(data, { ...options, campaignId });
  const ruleVersion = latestPublishedRuleVersion(data, activeCampaign.campaign_id, options.version || null);
  assertSettlementSourceAvailable(data, rootUserId, activeCampaign.campaign_id);
  const result = buildSettlementResult(data, rootUserId, activeCampaign.campaign_id, ruleVersion);
  return {
    campaign: campaign.toCampaignPayload(activeCampaign, campaign.findParticipant(data, rootUserId, activeCampaign.campaign_id)),
    ruleVersion: toRuleVersionPayload(ruleVersion),
    result,
  };
}

function evaluateSettlement(data, rootUserId, campaignId = "", options = {}) {
  const preview = previewSettlement(data, rootUserId, campaignId, options);
  const ruleVersion = latestPublishedRuleVersion(data, preview.campaign.campaignId, options.version || null);
  assertSettlementSourceAvailable(data, rootUserId, preview.campaign.campaignId, {
    forWrite: true,
  });
  const now = nowISO();
  const record = {
    settlement_record_id: createId("str"),
    root_user_id: rootUserId,
    campaign_id: preview.campaign.campaignId,
    rule_version: ruleVersion.version,
    campaign_rule_version_id: ruleVersion.campaign_rule_version_id,
    status: preview.result.qualified ? "QUALIFIED" : "NOT_QUALIFIED",
    result_json: preview.result,
    rewards_json: [],
    evaluated_at: now,
    created_at: now,
  };
  ensureList(data, "settlementRecords").push(record);
  return { ...preview, settlementRecord: record };
}

function getSettlementStatus(data, rootUserId, campaignId = "", options = {}) {
  const preview = previewSettlement(data, rootUserId, campaignId, options);
  const latestRecord = latestSettlementRecord(data, rootUserId, preview.campaign.campaignId);
  const reviews = manualReview
    .listManualReviewItems(data, { rootUserId, campaignId: preview.campaign.campaignId })
    .map((item) => manualReview.toManualReviewPayload(item, options));
  return {
    ...preview,
    latestSettlement: latestRecord ? toSettlementRecordPayload(latestRecord) : null,
    manualReviews: reviews,
  };
}

function toRuleVersionPayload(ruleVersion) {
  return {
    ruleVersionId: ruleVersion.campaign_rule_version_id,
    campaignId: ruleVersion.campaign_id,
    version: ruleVersion.version,
    status: ruleVersion.status,
    conditions: ruleVersion.conditions_json || [],
    publishedAt: ruleVersion.published_at || "",
  };
}

function toSettlementRecordPayload(record) {
  return {
    settlementRecordId: record.settlement_record_id,
    rootUserId: record.root_user_id,
    campaignId: record.campaign_id,
    ruleVersion: record.rule_version,
    status: record.status,
    result: record.result_json || {},
    evaluatedAt: record.evaluated_at || record.created_at,
  };
}

module.exports = {
  DEFAULT_RULE_VERSION,
  ensureDefaultRuleVersion,
  evaluateCondition,
  evaluateSettlement,
  getSettlementStatus,
  latestPublishedRuleVersion,
  previewSettlement,
  publishRuleVersion,
  toRuleVersionPayload,
  toSettlementRecordPayload,
};
