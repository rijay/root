const crypto = require("node:crypto");

const HANDLER_VERSION = "activity-task-source-v1";
const CONFIRMED_EVENT_TYPE = "activity.enrollment.confirmed.v1";
const CANCELED_EVENT_TYPE = "activity.enrollment.canceled.v1";
const SOURCE_INVALIDATED_CONTRACT_ID = "task.source_invalidated.v1";
const PAYLOAD_KEYS = Object.freeze([
  "activityEnrollmentEventId",
  "activityEnrollmentId",
  "activitySessionId",
  "activityTaskAssignmentId",
  "rootUserId",
  "taskDefinitionId",
  "taskDefinitionVersion",
  "transition",
  "reasonCode",
]);

const STATEMENTS = Object.freeze({
  CONFIRMED_SELECT: "activity_task_assignment.select_conflicts_for_update.v1",
  CONFIRMED_INSERT: "activity_task_assignment.insert.v1",
  CONFIRMED_VERIFY: "activity_task_assignment.verify_by_id.v1",
  CANCELED_SELECT: "activity_task_assignment.select_for_invalidation.v1",
  INVALIDATION_SELECT: "task_source_invalidation.select_conflicts_for_update.v1",
  INVALIDATION_INSERT: "task_source_invalidation.insert.v1",
  INVALIDATION_VERIFY: "task_source_invalidation.verify_by_id.v1",
});

function handlerError() {
  const error = new Error("activity enrollment task projection could not be applied");
  error.code = "ACTIVITY_TASK_PROJECTION_FAILED";
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
    && value === value.trim();
}

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function invalidationId(assignmentId, sourceEventId) {
  const digest = crypto
    .createHash("sha256")
    .update(`myroot:task-source-invalidation:v1:${assignmentId}\0${sourceEventId}`, "utf8")
    .digest("hex");
  return `task_invalid_${digest.slice(0, 51)}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sourceInvalidatedEnvelope(fact, sourceEnvelope) {
  if (!exactText(sourceEnvelope.producerVersion, 64)) throw handlerError();
  if (sourceEnvelope.correlationId !== null && sourceEnvelope.correlationId !== undefined
    && !exactText(sourceEnvelope.correlationId, 128)) throw handlerError();
  if (sourceEnvelope.releaseId !== null && sourceEnvelope.releaseId !== undefined
    && !exactText(sourceEnvelope.releaseId, 96)) throw handlerError();
  const payload = {
    taskActivityAssignmentId: fact.assignmentId,
    rootUserId: fact.rootUserId,
    taskDefinitionId: fact.taskDefinitionId,
    taskDefinitionVersion: fact.taskDefinitionVersion,
    activityEnrollmentId: fact.activityEnrollmentId,
    activitySessionId: fact.activitySessionId,
    taskSourceInvalidationEventId: fact.invalidationId,
    reasonCode: "SOURCE_CANCELED",
    sourceCancellationReasonCode: fact.reasonCode,
    sourceEventId: fact.sourceEventId,
  };
  const payloadDigest = crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  const eventIdentity = `task-source-invalidation:${fact.invalidationId}:v1`;
  const outboxIdDigest = crypto.createHash("sha256")
    .update(`myroot:task-source-invalidated-outbox:v1:${fact.invalidationId}`, "utf8")
    .digest("hex");
  return {
    outbox_event_id: `outbox_${outboxIdDigest.slice(0, 48)}`,
    topic: "task.source.events",
    event_type: "task.source_invalidated.v1",
    schema_version: "1",
    source_name: "myroot-task-projection",
    partition_key: `task_source_invalidation:${fact.invalidationId}`,
    partition_position: 1,
    aggregate_type: "TASK_SOURCE_INVALIDATION",
    aggregate_id: fact.invalidationId,
    aggregate_version: 1,
    occurred_at: fact.occurredAt,
    producer_version: sourceEnvelope.producerVersion,
    correlation_id: sourceEnvelope.correlationId || null,
    causation_id: sourceEnvelope.eventId,
    idempotency_key: eventIdentity,
    dedupe_key: eventIdentity,
    payload_json: payload,
    payload_digest: payloadDigest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: 5,
    available_at: fact.occurredAt,
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_json: null,
    release_id: sourceEnvelope.releaseId || null,
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: fact.occurredAt,
    updated_at: fact.occurredAt,
  };
}

function normalizeEnvelope(envelope) {
  if (!plainRecord(envelope)
    || ![CONFIRMED_EVENT_TYPE, CANCELED_EVENT_TYPE].includes(envelope.eventType)
    || envelope.schemaVersion !== "1"
    || envelope.sourceName !== "myroot-api"
    || envelope.aggregateType !== "ACTIVITY_ENROLLMENT_TASK_SOURCE"
    || !exactText(envelope.eventId, 64)
    || !exactText(envelope.aggregateId, 64)
    || !exactText(envelope.partitionKey, 191)
    || !exactText(envelope.occurredAt, 40)
    || !exactKeys(envelope.payload, PAYLOAD_KEYS)) throw handlerError();
  const payload = envelope.payload;
  if (!exactText(payload.activityEnrollmentEventId, 64)
    || !exactText(payload.activityEnrollmentId, 64)
    || !exactText(payload.activitySessionId, 64)
    || !exactText(payload.activityTaskAssignmentId, 64)
    || !exactText(payload.rootUserId, 32)
    || !exactText(payload.taskDefinitionId, 32)
    || !exactText(payload.taskDefinitionVersion, 64)
    || !byteEqual(envelope.aggregateId, payload.activityTaskAssignmentId)
    || !byteEqual(
      envelope.partitionKey,
      `activity_task_assignment:${payload.activityTaskAssignmentId}`
    )) throw handlerError();

  const confirmed = envelope.eventType === CONFIRMED_EVENT_TYPE;
  if ((confirmed && (
    envelope.partitionPosition !== 1
    || envelope.aggregateVersion !== 1
    || payload.transition !== "CONFIRMED"
    || payload.reasonCode !== null
  )) || (!confirmed && (
    envelope.partitionPosition !== 2
    || envelope.aggregateVersion !== 2
    || payload.transition !== "CANCELED"
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(payload.reasonCode)
  ))) throw handlerError();

  return Object.freeze({
    kind: confirmed ? "CONFIRMED" : "CANCELED",
    assignmentId: payload.activityTaskAssignmentId,
    rootUserId: payload.rootUserId,
    taskDefinitionId: payload.taskDefinitionId,
    taskDefinitionVersion: payload.taskDefinitionVersion,
    activityEnrollmentId: payload.activityEnrollmentId,
    activitySessionId: payload.activitySessionId,
    sourceEventId: payload.activityEnrollmentEventId,
    sourceEventType: envelope.eventType,
    reasonCode: payload.reasonCode,
    occurredAt: envelope.occurredAt,
    invalidationId: confirmed
      ? null
      : invalidationId(payload.activityTaskAssignmentId, payload.activityEnrollmentEventId),
  });
}

function handlerEvidence(value) {
  if (!plainRecord(value)
    || value.handlerVersion !== HANDLER_VERSION
    || !exactText(value.registrationDigest, 64)
    || !/^[a-f0-9]{64}$/.test(value.registrationDigest)) throw handlerError();
  return value;
}

function exactAssignmentIdentity(row, fact) {
  return plainRecord(row)
    && byteEqual(row.task_activity_assignment_id, fact.assignmentId)
    && byteEqual(row.root_user_id, fact.rootUserId)
    && byteEqual(row.task_definition_id, fact.taskDefinitionId)
    && byteEqual(row.task_definition_version, fact.taskDefinitionVersion)
    && byteEqual(row.activity_enrollment_id, fact.activityEnrollmentId)
    && byteEqual(row.activity_session_id, fact.activitySessionId)
    && row.initial_status === "AVAILABLE"
    && byteEqual(row.source_confirmed_event_type, CONFIRMED_EVENT_TYPE);
}

function exactConfirmedAssignment(row, fact) {
  return exactAssignmentIdentity(row, fact)
    && byteEqual(row.source_confirmed_event_id, fact.sourceEventId)
    && byteEqual(row.source_confirmed_at, fact.occurredAt);
}

function exactInvalidation(row, fact) {
  return plainRecord(row)
    && byteEqual(row.task_source_invalidation_event_id, fact.invalidationId)
    && byteEqual(row.task_activity_assignment_id, fact.assignmentId)
    && byteEqual(row.source_event_id, fact.sourceEventId)
    && byteEqual(row.source_event_type, fact.sourceEventType)
    && byteEqual(row.reason_code, fact.reasonCode)
    && byteEqual(row.occurred_at, fact.occurredAt);
}

function confirmedInsertParameters(fact) {
  return {
    assignmentId: fact.assignmentId,
    rootUserId: fact.rootUserId,
    taskDefinitionId: fact.taskDefinitionId,
    taskDefinitionVersion: fact.taskDefinitionVersion,
    activityEnrollmentId: fact.activityEnrollmentId,
    activitySessionId: fact.activitySessionId,
    sourceConfirmedEventId: fact.sourceEventId,
    sourceConfirmedEventType: fact.sourceEventType,
    sourceConfirmedAt: fact.occurredAt,
    createdAt: fact.occurredAt,
    updatedAt: fact.occurredAt,
  };
}

async function applyConfirmed(context, fact) {
  const rows = await context.executeStatement(STATEMENTS.CONFIRMED_SELECT, {
    assignmentId: fact.assignmentId,
    activityEnrollmentId: fact.activityEnrollmentId,
    taskDefinitionId: fact.taskDefinitionId,
    taskDefinitionVersion: fact.taskDefinitionVersion,
    sourceConfirmedEventId: fact.sourceEventId,
  });
  if (!Array.isArray(rows) || rows.length > 1) throw handlerError();
  if (rows.length === 1) {
    if (!exactConfirmedAssignment(rows[0], fact)) throw handlerError();
  } else {
    const inserted = await context.executeStatement(
      STATEMENTS.CONFIRMED_INSERT,
      confirmedInsertParameters(fact)
    );
    if (!plainRecord(inserted) || inserted.affectedRows !== 1) throw handlerError();
  }
  return {
    result: {
      taskActivityAssignmentId: fact.assignmentId,
      sourceConfirmedEventId: fact.sourceEventId,
    },
    manifest: {
      targetFactIds: [fact.assignmentId],
      taskActivityAssignmentId: fact.assignmentId,
    },
  };
}

async function applyCanceled(context, fact) {
  const assignments = await context.executeStatement(STATEMENTS.CANCELED_SELECT, {
    assignmentId: fact.assignmentId,
  });
  if (!Array.isArray(assignments) || assignments.length !== 1
    || !exactAssignmentIdentity(assignments[0], fact)) throw handlerError();

  const invalidations = await context.executeStatement(STATEMENTS.INVALIDATION_SELECT, {
    invalidationId: fact.invalidationId,
    sourceEventId: fact.sourceEventId,
  });
  if (!Array.isArray(invalidations) || invalidations.length > 1) throw handlerError();
  if (invalidations.length === 1) {
    if (!exactInvalidation(invalidations[0], fact)) throw handlerError();
  } else {
    const inserted = await context.executeStatement(STATEMENTS.INVALIDATION_INSERT, {
      invalidationId: fact.invalidationId,
      assignmentId: fact.assignmentId,
      sourceEventId: fact.sourceEventId,
      sourceEventType: fact.sourceEventType,
      reasonCode: fact.reasonCode,
      occurredAt: fact.occurredAt,
      createdAt: fact.occurredAt,
    });
    if (!plainRecord(inserted) || inserted.affectedRows !== 1) throw handlerError();
  }

  context.stageOutbox(
    SOURCE_INVALIDATED_CONTRACT_ID,
    sourceInvalidatedEnvelope(fact, context.envelope)
  );

  return {
    result: {
      taskActivityAssignmentId: fact.assignmentId,
      taskSourceInvalidationEventId: fact.invalidationId,
    },
    manifest: {
      targetFactIds: [fact.assignmentId, fact.invalidationId],
      taskActivityAssignmentId: fact.assignmentId,
    },
  };
}

async function apply(context) {
  if (!plainRecord(context)
    || typeof context.executeStatement !== "function"
    || typeof context.stageOutbox !== "function") throw handlerError();
  handlerEvidence(context.handlerEvidence);
  const fact = normalizeEnvelope(context.envelope);
  return fact.kind === "CONFIRMED"
    ? applyConfirmed(context, fact)
    : applyCanceled(context, fact);
}

function exactResultShape(result, manifest, fact) {
  if (!plainRecord(result) || !plainRecord(manifest)) return false;
  if (fact.kind === "CONFIRMED") {
    return exactKeys(result, ["taskActivityAssignmentId", "sourceConfirmedEventId"])
      && exactKeys(manifest, ["targetFactIds", "taskActivityAssignmentId"])
      && result.taskActivityAssignmentId === fact.assignmentId
      && result.sourceConfirmedEventId === fact.sourceEventId
      && manifest.taskActivityAssignmentId === fact.assignmentId
      && Array.isArray(manifest.targetFactIds)
      && manifest.targetFactIds.length === 1
      && manifest.targetFactIds[0] === fact.assignmentId;
  }
  return exactKeys(result, ["taskActivityAssignmentId", "taskSourceInvalidationEventId"])
    && exactKeys(manifest, ["targetFactIds", "taskActivityAssignmentId"])
    && result.taskActivityAssignmentId === fact.assignmentId
    && result.taskSourceInvalidationEventId === fact.invalidationId
    && manifest.taskActivityAssignmentId === fact.assignmentId
    && Array.isArray(manifest.targetFactIds)
    && manifest.targetFactIds.length === 2
    && manifest.targetFactIds[0] === fact.assignmentId
    && manifest.targetFactIds[1] === fact.invalidationId;
}

async function verify(context) {
  if (!plainRecord(context)
    || typeof context.executeStatement !== "function") return false;
  let fact;
  try {
    handlerEvidence(context.handlerEvidence);
    fact = normalizeEnvelope(context.envelope);
  } catch {
    return false;
  }
  if (!exactResultShape(context.result, context.manifest, fact)) return false;
  let assignments;
  try {
    assignments = await context.executeStatement(STATEMENTS.CONFIRMED_VERIFY, {
      assignmentId: fact.assignmentId,
    });
  } catch {
    return false;
  }
  if (!Array.isArray(assignments) || assignments.length !== 1) return false;
  if (fact.kind === "CONFIRMED") return exactConfirmedAssignment(assignments[0], fact);
  if (!exactAssignmentIdentity(assignments[0], fact)) return false;
  let invalidations;
  try {
    invalidations = await context.executeStatement(STATEMENTS.INVALIDATION_VERIFY, {
      invalidationId: fact.invalidationId,
    });
  } catch {
    return false;
  }
  return Array.isArray(invalidations)
    && invalidations.length === 1
    && exactInvalidation(invalidations[0], fact);
}

module.exports = Object.freeze({
  apply,
  verify,
  outboxBuilders: Object.freeze({
    [SOURCE_INVALIDATED_CONTRACT_ID](envelope) { return envelope; },
  }),
});
