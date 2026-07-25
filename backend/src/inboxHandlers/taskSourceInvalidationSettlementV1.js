const crypto = require("node:crypto");

const HANDLER_VERSION = "settlement-source-invalidation-v1";
const EVENT_TYPE = "task.source_invalidated.v1";
const SOURCE_NAME = "myroot-task-projection";
const AGGREGATE_TYPE = "TASK_SOURCE_INVALIDATION";
const SOURCE_EVENT_TYPE = "activity.enrollment.canceled.v1";
const SOURCE_CONFIRMED_EVENT_TYPE = "activity.enrollment.confirmed.v1";
const SOURCE_TYPE = "TASK_SOURCE_INVALIDATION";
const STOP_REVIEW_TYPE = "SETTLEMENT_STOP_CANDIDATE";
const RECALC_REVIEW_TYPE = "SETTLEMENT_RECALC_CANDIDATE";
const STOP_CANDIDATE = "STOP_OR_CANCEL";
const RECALC_CANDIDATE = "ADJUSTMENT_OR_RECALCULATION";
const SETTLED_STATUSES = Object.freeze([
  "QUALIFIED",
  "UNQUALIFIED",
  "NOT_QUALIFIED",
  "ADJUSTED",
  "REVIEW_REQUIRED",
]);
const PAYLOAD_KEYS = Object.freeze([
  "taskActivityAssignmentId",
  "rootUserId",
  "taskDefinitionId",
  "taskDefinitionVersion",
  "activityEnrollmentId",
  "activitySessionId",
  "taskSourceInvalidationEventId",
  "reasonCode",
  "sourceCancellationReasonCode",
  "sourceEventId",
]);
const METADATA_KEYS = Object.freeze([
  "contractVersion",
  "handlerVersion",
  "candidateKind",
  "decision",
  "appendOnly",
  "taskSourceInvalidationEventId",
  "taskActivityAssignmentId",
  "rootUserId",
  "campaignId",
  "taskDefinitionId",
  "taskDefinitionVersion",
  "activityEnrollmentId",
  "activitySessionId",
  "sourceConfirmedEventId",
  "sourceEventId",
  "sourceEventType",
  "sourceCancellationReasonCode",
  "reasonCode",
  "sourceInvalidatedAt",
  "campaignRuleVersionId",
  "ruleVersion",
  "originalSettlementRecordId",
  "originalSettlementStatus",
  "originalSettlementEvaluatedAt",
]);
const WORKFLOW_METADATA_KEYS = Object.freeze(["publicNote", "resolutionNote"]);

const STATEMENTS = Object.freeze({
  AUTHORITY_ACQUIRE: "settlement_source_authority.acquire.v1",
  SOURCE_SELECT: "settlement_source_task.select_for_update.v1",
  CANDIDATE_SELECT: "settlement_source_candidate.select_for_update.v1",
  SETTLEMENT_SELECT: "settlement_source_record.select_latest_for_update.v1",
  RULE_BY_SETTLEMENT_SELECT: "settlement_source_rule.select_by_settlement_for_update.v1",
  LATEST_RULE_SELECT: "settlement_source_rule.select_latest_published_for_update.v1",
  CANDIDATE_INSERT: "settlement_source_candidate.insert.v1",
  SOURCE_VERIFY: "settlement_source_task.verify.v1",
  CANDIDATE_VERIFY: "settlement_source_candidate.verify.v1",
});

function handlerError() {
  const error = new Error("task source invalidation Settlement projection could not be applied");
  error.code = "SETTLEMENT_SOURCE_INVALIDATION_FAILED";
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalText(value, maximumLength) {
  return value === null || value === undefined || exactText(value, maximumLength);
}

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function digest(domain, ...parts) {
  const hash = crypto.createHash("sha256").update(`${domain}\0`, "utf8");
  for (const part of parts) hash.update(String(part), "utf8").update("\0", "utf8");
  return hash.digest("hex");
}

function sourceInvalidationId(assignmentId, sourceEventId) {
  const value = crypto.createHash("sha256")
    .update(
      `myroot:task-source-invalidation:v1:${assignmentId}\0${sourceEventId}`,
      "utf8"
    )
    .digest("hex");
  return `task_invalid_${value.slice(0, 51)}`;
}

function normalizeEnvelope(envelope) {
  if (!plainRecord(envelope)
    || envelope.eventType !== EVENT_TYPE
    || envelope.schemaVersion !== "1"
    || envelope.sourceName !== SOURCE_NAME
    || envelope.aggregateType !== AGGREGATE_TYPE
    || envelope.partitionPosition !== 1
    || envelope.aggregateVersion !== 1
    || !exactText(envelope.eventId, 64)
    || !exactText(envelope.aggregateId, 64)
    || !exactText(envelope.partitionKey, 191)
    || !exactText(envelope.occurredAt, 40)
    || !exactText(envelope.producerVersion, 64)
    || !exactText(envelope.idempotencyKey, 191)
    || !exactText(envelope.payloadDigest, 64)
    || !/^[a-f0-9]{64}$/.test(envelope.payloadDigest)
    || !optionalText(envelope.correlationId, 128)
    || !exactText(envelope.causationId, 64)
    || !exactKeys(envelope.payload, PAYLOAD_KEYS)) throw handlerError();
  const payload = envelope.payload;
  if (!exactText(payload.taskActivityAssignmentId, 64)
    || !exactText(payload.rootUserId, 32)
    || !exactText(payload.taskDefinitionId, 32)
    || !exactText(payload.taskDefinitionVersion, 64)
    || !exactText(payload.activityEnrollmentId, 64)
    || !exactText(payload.activitySessionId, 64)
    || !exactText(payload.taskSourceInvalidationEventId, 64)
    || payload.reasonCode !== "SOURCE_CANCELED"
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(
      payload.sourceCancellationReasonCode
    )
    || !exactText(payload.sourceEventId, 64)
    || !byteEqual(envelope.aggregateId, payload.taskSourceInvalidationEventId)
    || !byteEqual(
      envelope.partitionKey,
      `task_source_invalidation:${payload.taskSourceInvalidationEventId}`
    )
    || !byteEqual(
      envelope.idempotencyKey,
      `task-source-invalidation:${payload.taskSourceInvalidationEventId}:v1`
    )
    || !byteEqual(
      payload.taskSourceInvalidationEventId,
      sourceInvalidationId(
        payload.taskActivityAssignmentId,
        payload.sourceEventId
      )
    )
    || !byteEqual(
      envelope.payloadDigest,
      crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")
    )) throw handlerError();
  return Object.freeze({
    eventId: envelope.eventId,
    occurredAt: envelope.occurredAt,
    invalidationId: payload.taskSourceInvalidationEventId,
    assignmentId: payload.taskActivityAssignmentId,
    rootUserId: payload.rootUserId,
    taskDefinitionId: payload.taskDefinitionId,
    taskDefinitionVersion: payload.taskDefinitionVersion,
    activityEnrollmentId: payload.activityEnrollmentId,
    activitySessionId: payload.activitySessionId,
    sourceEventId: payload.sourceEventId,
    sourceCancellationReasonCode: payload.sourceCancellationReasonCode,
  });
}

function handlerEvidence(value) {
  if (!plainRecord(value)
    || value.handlerVersion !== HANDLER_VERSION
    || !exactText(value.registrationDigest, 64)
    || !/^[a-f0-9]{64}$/.test(value.registrationDigest)) throw handlerError();
  return value;
}

function exactSource(row, fact) {
  return plainRecord(row)
    && byteEqual(row.task_activity_assignment_id, fact.assignmentId)
    && byteEqual(row.root_user_id, fact.rootUserId)
    && byteEqual(row.task_definition_id, fact.taskDefinitionId)
    && byteEqual(row.task_definition_version, fact.taskDefinitionVersion)
    && byteEqual(row.activity_enrollment_id, fact.activityEnrollmentId)
    && byteEqual(row.activity_session_id, fact.activitySessionId)
    && row.initial_status === "AVAILABLE"
    && exactText(row.source_confirmed_event_id, 64)
    && row.source_confirmed_event_type === SOURCE_CONFIRMED_EVENT_TYPE
    && exactText(row.source_confirmed_at, 40)
    && exactText(row.campaign_id, 64)
    && byteEqual(row.task_source_invalidation_event_id, fact.invalidationId)
    && byteEqual(row.invalidation_assignment_id, fact.assignmentId)
    && byteEqual(row.source_event_id, fact.sourceEventId)
    && row.source_event_type === SOURCE_EVENT_TYPE
    && row.reason_code === fact.sourceCancellationReasonCode
    && byteEqual(row.occurred_at, fact.occurredAt);
}

function normalizeSettlement(row, fact, source) {
  if (!plainRecord(row)
    || !exactText(row.settlement_record_id, 32)
    || !byteEqual(row.root_user_id, fact.rootUserId)
    || !byteEqual(row.campaign_id, source.campaign_id)
    || !Number.isSafeInteger(row.rule_version)
    || row.rule_version < 1
    || !exactText(row.campaign_rule_version_id, 32)
    || !["PENDING", ...SETTLED_STATUSES].includes(row.status)
    || !exactText(row.evaluated_at, 40)
    || !exactText(row.created_at, 40)) throw handlerError();
  return Object.freeze({
    settlementRecordId: row.settlement_record_id,
    status: row.status,
    ruleVersion: row.rule_version,
    campaignRuleVersionId: row.campaign_rule_version_id,
    evaluatedAt: row.evaluated_at,
  });
}

function normalizeRule(row, source, settlement) {
  if (!plainRecord(row)
    || !exactText(row.campaign_rule_version_id, 32)
    || !byteEqual(row.campaign_id, source.campaign_id)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || row.status !== "PUBLISHED"
    || !exactText(row.published_at, 40)
    || (settlement && (
      !byteEqual(row.campaign_rule_version_id, settlement.campaignRuleVersionId)
      || row.version !== settlement.ruleVersion
    ))) throw handlerError();
  return Object.freeze({
    campaignRuleVersionId: row.campaign_rule_version_id,
    ruleVersion: row.version,
  });
}

function candidateId(fact, rule) {
  return `mri_${digest(
    "myroot:settlement-source-invalidation-candidate:v1",
    fact.invalidationId,
    rule.campaignRuleVersionId,
    rule.ruleVersion
  ).slice(0, 28)}`;
}

function candidatePlan(fact, source, settlement, rule) {
  const settled = Boolean(settlement && SETTLED_STATUSES.includes(settlement.status));
  const candidateKind = settled ? RECALC_CANDIDATE : STOP_CANDIDATE;
  const reviewType = settled ? RECALC_REVIEW_TYPE : STOP_REVIEW_TYPE;
  const metadata = Object.freeze({
    contractVersion: 1,
    handlerVersion: HANDLER_VERSION,
    candidateKind,
    decision: settled ? "RECALCULATION_REQUIRED" : "STOP_AUTOMATIC_SETTLEMENT",
    appendOnly: true,
    taskSourceInvalidationEventId: fact.invalidationId,
    taskActivityAssignmentId: fact.assignmentId,
    rootUserId: fact.rootUserId,
    campaignId: source.campaign_id,
    taskDefinitionId: fact.taskDefinitionId,
    taskDefinitionVersion: fact.taskDefinitionVersion,
    activityEnrollmentId: fact.activityEnrollmentId,
    activitySessionId: fact.activitySessionId,
    sourceConfirmedEventId: source.source_confirmed_event_id,
    sourceEventId: fact.sourceEventId,
    sourceEventType: SOURCE_EVENT_TYPE,
    sourceCancellationReasonCode: fact.sourceCancellationReasonCode,
    reasonCode: "SOURCE_CANCELED",
    sourceInvalidatedAt: fact.occurredAt,
    campaignRuleVersionId: rule.campaignRuleVersionId,
    ruleVersion: rule.ruleVersion,
    originalSettlementRecordId: settlement ? settlement.settlementRecordId : null,
    originalSettlementStatus: settlement ? settlement.status : null,
    originalSettlementEvaluatedAt: settlement ? settlement.evaluatedAt : null,
  });
  return Object.freeze({
    candidateId: candidateId(fact, rule),
    candidateKind,
    reviewType,
    campaignRuleVersionId: rule.campaignRuleVersionId,
    ruleVersion: rule.ruleVersion,
    originalSettlementRecordId: settlement ? settlement.settlementRecordId : null,
    metadata,
    idempotencyKey: [
      "task-source-invalidation",
      fact.invalidationId,
      "rule",
      rule.campaignRuleVersionId,
      rule.ruleVersion,
    ].join(":"),
  });
}

function candidateMetadata(row) {
  if (plainRecord(row.metadata)) return row.metadata;
  if (typeof row.metadata !== "string") throw handlerError();
  let parsed;
  try { parsed = JSON.parse(row.metadata); } catch { throw handlerError(); }
  if (!plainRecord(parsed)) throw handlerError();
  return parsed;
}

function metadataBase(value) {
  if (!plainRecord(value)) throw handlerError();
  const keys = Object.keys(value);
  if (METADATA_KEYS.some((key) => !keys.includes(key))
    || keys.some((key) => !METADATA_KEYS.includes(key) && !WORKFLOW_METADATA_KEYS.includes(key))
    || value.contractVersion !== 1
    || value.handlerVersion !== HANDLER_VERSION
    || value.appendOnly !== true) throw handlerError();
  const base = {};
  for (const key of METADATA_KEYS) base[key] = value[key];
  return base;
}

function legalCandidateLifecycle(row, metadata) {
  if (!["OPEN", "RESOLVED"].includes(row.status)
    || row.priority !== "HIGH"
    || !exactText(row.created_at, 40)
    || !exactText(row.updated_at, 40)) return false;
  if (row.status === "OPEN") {
    return (row.operator_id === null || row.operator_id === "")
      && (row.resolved_at === null || row.resolved_at === "")
      && (row.resolution === null || row.resolution === "")
      && !Object.hasOwn(metadata, "publicNote")
      && !Object.hasOwn(metadata, "resolutionNote");
  }
  return exactText(row.operator_id, 64)
    && exactText(row.resolved_at, 40)
    && exactText(row.resolution, 8_192)
    && Object.hasOwn(metadata, "resolutionNote")
    && typeof metadata.resolutionNote === "string"
    && (!Object.hasOwn(metadata, "publicNote") || typeof metadata.publicNote === "string");
}

function normalizeExistingCandidate(row, fact, source) {
  if (!plainRecord(row)) throw handlerError();
  const metadata = candidateMetadata(row);
  const base = metadataBase(metadata);
  if (!Number.isSafeInteger(base.ruleVersion) || base.ruleVersion < 1
    || !exactText(base.campaignRuleVersionId, 32)) throw handlerError();
  const settlement = base.originalSettlementRecordId === null
    ? null
    : Object.freeze({
      settlementRecordId: base.originalSettlementRecordId,
      status: base.originalSettlementStatus,
      evaluatedAt: base.originalSettlementEvaluatedAt,
    });
  if ((settlement === null && (
    base.originalSettlementStatus !== null || base.originalSettlementEvaluatedAt !== null
  )) || (settlement && (
    !exactText(settlement.settlementRecordId, 32)
    || !["PENDING", ...SETTLED_STATUSES].includes(settlement.status)
    || !exactText(settlement.evaluatedAt, 40)
  ))) throw handlerError();
  const plan = candidatePlan(fact, source, settlement, {
    campaignRuleVersionId: base.campaignRuleVersionId,
    ruleVersion: base.ruleVersion,
  });
  if (!byteEqual(row.manual_review_item_id, plan.candidateId)
    || !byteEqual(row.root_user_id, fact.rootUserId)
    || !byteEqual(row.campaign_id, source.campaign_id)
    || row.review_type !== plan.reviewType
    || row.source_type !== SOURCE_TYPE
    || !byteEqual(row.source_id, fact.invalidationId)
    || row.reason !== "TASK_SOURCE_INVALIDATED"
    || !byteEqual(row.idempotency_key, plan.idempotencyKey)
    || canonicalJson(base) !== canonicalJson(plan.metadata)
    || !legalCandidateLifecycle(row, metadata)) throw handlerError();
  return plan;
}

function output(plan, fact) {
  return {
    result: {
      taskSourceInvalidationEventId: fact.invalidationId,
      settlementCandidateId: plan.candidateId,
      candidateKind: plan.candidateKind,
      campaignRuleVersionId: plan.campaignRuleVersionId,
      ruleVersion: plan.ruleVersion,
      originalSettlementRecordId: plan.originalSettlementRecordId,
    },
    manifest: {
      targetFactIds: [plan.candidateId],
      settlementCandidateId: plan.candidateId,
    },
  };
}

async function readSource(context, statementId, fact) {
  const rows = await context.executeStatement(statementId, {
    assignmentId: fact.assignmentId,
    invalidationId: fact.invalidationId,
  });
  if (!Array.isArray(rows) || rows.length !== 1 || !exactSource(rows[0], fact)) {
    throw handlerError();
  }
  return rows[0];
}

async function apply(context) {
  if (!plainRecord(context)
    || typeof context.executeStatement !== "function"
    || typeof context.stageOutbox !== "function") throw handlerError();
  handlerEvidence(context.handlerEvidence);
  const fact = normalizeEnvelope(context.envelope);
  const source = await readSource(context, STATEMENTS.SOURCE_SELECT, fact);
  const authority = await context.executeStatement(STATEMENTS.AUTHORITY_ACQUIRE, {
    rootUserId: fact.rootUserId,
    campaignId: source.campaign_id,
  });
  if (!plainRecord(authority)
    || !Number.isSafeInteger(authority.affectedRows)
    || authority.affectedRows < 0
    || authority.affectedRows > 1) throw handlerError();
  const candidates = await context.executeStatement(STATEMENTS.CANDIDATE_SELECT, {
    sourceId: fact.invalidationId,
  });
  if (!Array.isArray(candidates) || candidates.length > 1) throw handlerError();
  if (candidates.length === 1) {
    return output(normalizeExistingCandidate(candidates[0], fact, source), fact);
  }

  const settlementRows = await context.executeStatement(STATEMENTS.SETTLEMENT_SELECT, {
    rootUserId: fact.rootUserId,
    campaignId: source.campaign_id,
  });
  if (!Array.isArray(settlementRows) || settlementRows.length > 1) throw handlerError();
  const settlement = settlementRows.length === 1
    ? normalizeSettlement(settlementRows[0], fact, source)
    : null;
  const ruleRows = settlement
    ? await context.executeStatement(STATEMENTS.RULE_BY_SETTLEMENT_SELECT, {
      campaignRuleVersionId: settlement.campaignRuleVersionId,
      campaignId: source.campaign_id,
      ruleVersion: settlement.ruleVersion,
    })
    : await context.executeStatement(STATEMENTS.LATEST_RULE_SELECT, {
      campaignId: source.campaign_id,
    });
  if (!Array.isArray(ruleRows) || ruleRows.length !== 1) throw handlerError();
  const rule = normalizeRule(ruleRows[0], source, settlement);
  const plan = candidatePlan(fact, source, settlement, rule);
  const inserted = await context.executeStatement(STATEMENTS.CANDIDATE_INSERT, {
    candidateId: plan.candidateId,
    rootUserId: fact.rootUserId,
    campaignId: source.campaign_id,
    reviewType: plan.reviewType,
    sourceId: fact.invalidationId,
    metadataJson: canonicalJson(plan.metadata),
    idempotencyKey: plan.idempotencyKey,
    createdAt: fact.occurredAt,
    updatedAt: fact.occurredAt,
  });
  if (!plainRecord(inserted) || inserted.affectedRows !== 1) throw handlerError();
  return output(plan, fact);
}

function exactOutput(result, manifest, plan, fact) {
  return exactKeys(result, [
    "taskSourceInvalidationEventId",
    "settlementCandidateId",
    "candidateKind",
    "campaignRuleVersionId",
    "ruleVersion",
    "originalSettlementRecordId",
  ])
    && exactKeys(manifest, ["targetFactIds", "settlementCandidateId"])
    && result.taskSourceInvalidationEventId === fact.invalidationId
    && result.settlementCandidateId === plan.candidateId
    && result.candidateKind === plan.candidateKind
    && result.campaignRuleVersionId === plan.campaignRuleVersionId
    && result.ruleVersion === plan.ruleVersion
    && result.originalSettlementRecordId === plan.originalSettlementRecordId
    && manifest.settlementCandidateId === plan.candidateId
    && Array.isArray(manifest.targetFactIds)
    && manifest.targetFactIds.length === 1
    && manifest.targetFactIds[0] === plan.candidateId;
}

async function verify(context) {
  if (!plainRecord(context) || typeof context.executeStatement !== "function") return false;
  let fact;
  try {
    handlerEvidence(context.handlerEvidence);
    fact = normalizeEnvelope(context.envelope);
    const source = await readSource(context, STATEMENTS.SOURCE_VERIFY, fact);
    const rows = await context.executeStatement(STATEMENTS.CANDIDATE_VERIFY, {
      candidateId: context.result && context.result.settlementCandidateId,
    });
    if (!Array.isArray(rows) || rows.length !== 1) return false;
    const plan = normalizeExistingCandidate(rows[0], fact, source);
    return exactOutput(context.result, context.manifest, plan, fact);
  } catch {
    return false;
  }
}

module.exports = Object.freeze({
  apply,
  verify,
  outboxBuilders: Object.freeze({}),
});
