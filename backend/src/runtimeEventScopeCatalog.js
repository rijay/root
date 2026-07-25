const crypto = require("node:crypto");

const { assertResolvedInboxHandlerRegistration } = require("./inboxHandlerRegistry");

const WORKER_MODES = Object.freeze({
  ENABLED: "ENABLED",
  BLOCKED_SUCCESSOR_UNAVAILABLE: "BLOCKED_SUCCESSOR_UNAVAILABLE",
});

const ACTIVITY_PAYLOAD_KEYS = Object.freeze([
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
const TASK_SOURCE_INVALIDATED_PAYLOAD_KEYS = Object.freeze([
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

const RUNTIME_EVENT_SCOPES = Object.freeze([
  Object.freeze({
    scopeId: "TASK_SHARE_COMPLETED_V1",
    topic: "task.events",
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    handlerId: "task-share-completion-projection-v1",
    sourceName: "myroot-api",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
    workerMode: WORKER_MODES.ENABLED,
    outboxContractIds: Object.freeze([]),
  }),
  Object.freeze({
    scopeId: "ACTIVITY_ENROLLMENT_CONFIRMED_V1",
    topic: "activity.enrollment.events",
    consumerName: "activity-task-source-projection",
    handlerVersion: "activity-task-source-v1",
    handlerId: "activity-enrollment-confirmed-task-v1",
    sourceName: "myroot-api",
    eventType: "activity.enrollment.confirmed.v1",
    schemaVersion: "1",
    aggregateType: "ACTIVITY_ENROLLMENT_TASK_SOURCE",
    workerMode: WORKER_MODES.ENABLED,
    outboxContractIds: Object.freeze([]),
  }),
  Object.freeze({
    scopeId: "ACTIVITY_ENROLLMENT_CANCELED_V1",
    topic: "activity.enrollment.events",
    consumerName: "activity-task-source-projection",
    handlerVersion: "activity-task-source-v1",
    handlerId: "activity-enrollment-canceled-task-v1",
    sourceName: "myroot-api",
    eventType: "activity.enrollment.canceled.v1",
    schemaVersion: "1",
    aggregateType: "ACTIVITY_ENROLLMENT_TASK_SOURCE",
    workerMode: WORKER_MODES.ENABLED,
    outboxContractIds: Object.freeze(["task.source_invalidated.v1"]),
  }),
  Object.freeze({
    scopeId: "TASK_SOURCE_INVALIDATED_SETTLEMENT_V1",
    topic: "task.source.events",
    consumerName: "settlement-source-invalidation-projection",
    handlerVersion: "settlement-source-invalidation-v1",
    handlerId: "task-source-invalidation-settlement-v1",
    sourceName: "myroot-task-projection",
    eventType: "task.source_invalidated.v1",
    schemaVersion: "1",
    aggregateType: "TASK_SOURCE_INVALIDATION",
    workerMode: WORKER_MODES.ENABLED,
    outboxContractIds: Object.freeze([]),
  }),
]);

function catalogError() {
  const error = new Error("runtime event scope is invalid");
  error.code = "RUNTIME_EVENT_SCOPE_INVALID";
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

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function sameList(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function scopeIdentity(scope) {
  return Object.freeze({
    consumerName: scope.consumerName,
    handlerVersion: scope.handlerVersion,
    sourceName: scope.sourceName,
    eventType: scope.eventType,
    schemaVersion: scope.schemaVersion,
    aggregateType: scope.aggregateType,
  });
}

function assertRuntimeEventScopeRegistration(value) {
  let registration;
  try { registration = assertResolvedInboxHandlerRegistration(value); } catch { throw catalogError(); }
  const descriptor = registration.descriptor;
  const scope = RUNTIME_EVENT_SCOPES.find((candidate) => (
    descriptor.consumerName === candidate.consumerName
    && descriptor.handlerVersion === candidate.handlerVersion
    && descriptor.handlerId === candidate.handlerId
    && descriptor.sourceName === candidate.sourceName
    && descriptor.eventType === candidate.eventType
    && descriptor.schemaVersion === candidate.schemaVersion
    && descriptor.aggregateType === candidate.aggregateType
  ));
  if (!scope
    || registration.registryScope !== "PRODUCTION"
    || descriptor.kind !== "DATABASE_ONLY"
    || descriptor.replaySafe !== true
    || !sameList(descriptor.outboxContractIds, scope.outboxContractIds)
    || !/^[a-f0-9]{64}$/.test(descriptor.descriptorDigest)
    || !/^[a-f0-9]{64}$/.test(descriptor.sourceDigest)
    || !/^[a-f0-9]{64}$/.test(registration.registrationDigest)
    || !Number.isSafeInteger(registration.registryVersion)
    || registration.registryVersion < 1) throw catalogError();
  return Object.freeze({ scope, registration });
}

function runtimeEventScopeById(scopeId) {
  const scope = RUNTIME_EVENT_SCOPES.find((candidate) => candidate.scopeId === scopeId);
  if (!scope) throw catalogError();
  return scope;
}

function deterministicActivityAssignmentId(payload) {
  const digest = crypto.createHash("sha256")
    .update(
      `myroot:activity-task-assignment:v1:${payload.activityEnrollmentId}\0${payload.taskDefinitionId}\0${payload.taskDefinitionVersion}`,
      "utf8"
    )
    .digest("hex");
  return `activity_task_${digest.slice(0, 50)}`;
}

function deterministicTaskSourceInvalidationId(payload) {
  const digest = crypto.createHash("sha256")
    .update(
      `myroot:task-source-invalidation:v1:${payload.taskActivityAssignmentId}\0${payload.sourceEventId}`,
      "utf8"
    )
    .digest("hex");
  return `task_invalid_${digest.slice(0, 51)}`;
}

function assertShareEnvelope(envelope) {
  const payload = envelope.payload;
  if (!exactKeys(payload, ["taskEventId", "taskType", "eventType"])
    || envelope.partitionPosition !== 1
    || envelope.aggregateVersion !== 1
    || payload.taskType !== "SHARE"
    || payload.eventType !== "SHARE_COMPLETED"
    || !byteEqual(payload.taskEventId, envelope.aggregateId)
    || !byteEqual(envelope.partitionKey, `task_event:${envelope.aggregateId}`)
    || !byteEqual(envelope.idempotencyKey, `task-event:${envelope.aggregateId}:v1`)
    || !byteEqual(envelope.dedupeKey, envelope.idempotencyKey)) throw catalogError();
}

function assertActivityEnvelope(scope, envelope) {
  const payload = envelope.payload;
  if (!exactKeys(payload, ACTIVITY_PAYLOAD_KEYS)
    || !exactText(payload.activityEnrollmentEventId, 64)
    || !exactText(payload.activityEnrollmentId, 64)
    || !exactText(payload.activitySessionId, 64)
    || !exactText(payload.activityTaskAssignmentId, 64)
    || !exactText(payload.rootUserId, 32)
    || !exactText(payload.taskDefinitionId, 32)
    || !exactText(payload.taskDefinitionVersion, 64)
    || !byteEqual(payload.activityTaskAssignmentId, deterministicActivityAssignmentId(payload))
    || !byteEqual(envelope.aggregateId, payload.activityTaskAssignmentId)
    || !byteEqual(envelope.partitionKey, `activity_task_assignment:${payload.activityTaskAssignmentId}`)
    || !byteEqual(envelope.dedupeKey, envelope.idempotencyKey)) throw catalogError();

  if (scope.scopeId === "ACTIVITY_ENROLLMENT_CONFIRMED_V1") {
    if (envelope.partitionPosition !== 1
      || envelope.aggregateVersion !== 1
      || payload.transition !== "CONFIRMED"
      || payload.reasonCode !== null
      || !byteEqual(
        envelope.idempotencyKey,
        `activity-enrollment:${payload.activityEnrollmentId}:task:${payload.taskDefinitionId}:${payload.taskDefinitionVersion}`
      )) throw catalogError();
    return;
  }
  if (scope.scopeId !== "ACTIVITY_ENROLLMENT_CANCELED_V1"
    || envelope.partitionPosition !== 2
    || envelope.aggregateVersion !== 2
    || payload.transition !== "CANCELED"
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(payload.reasonCode)
    || !byteEqual(
      envelope.idempotencyKey,
      `activity-event:${payload.activityEnrollmentEventId}:task:${payload.activityTaskAssignmentId}`
    )) throw catalogError();
}

function assertTaskSourceInvalidatedEnvelope(envelope) {
  const payload = envelope.payload;
  if (!exactKeys(payload, TASK_SOURCE_INVALIDATED_PAYLOAD_KEYS)
    || !exactText(payload.taskActivityAssignmentId, 64)
    || !exactText(payload.rootUserId, 32)
    || !exactText(payload.taskDefinitionId, 32)
    || !exactText(payload.taskDefinitionVersion, 64)
    || !exactText(payload.activityEnrollmentId, 64)
    || !exactText(payload.activitySessionId, 64)
    || !exactText(payload.taskSourceInvalidationEventId, 64)
    || !exactText(payload.sourceEventId, 64)
    || payload.reasonCode !== "SOURCE_CANCELED"
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(
      payload.sourceCancellationReasonCode
    )
    || payload.taskSourceInvalidationEventId !== deterministicTaskSourceInvalidationId(payload)
    || envelope.partitionPosition !== 1
    || envelope.aggregateVersion !== 1
    || !byteEqual(envelope.aggregateId, payload.taskSourceInvalidationEventId)
    || !byteEqual(
      envelope.partitionKey,
      `task_source_invalidation:${payload.taskSourceInvalidationEventId}`
    )
    || !byteEqual(
      envelope.idempotencyKey,
      `task-source-invalidation:${payload.taskSourceInvalidationEventId}:v1`
    )
    || !byteEqual(envelope.dedupeKey, envelope.idempotencyKey)) throw catalogError();
}

function assertRuntimeEventEnvelope(scope, envelope) {
  if (!RUNTIME_EVENT_SCOPES.includes(scope)
    || !plainRecord(envelope)
    || envelope.topic !== scope.topic
    || envelope.sourceName !== scope.sourceName
    || envelope.eventType !== scope.eventType
    || envelope.schemaVersion !== scope.schemaVersion
    || envelope.aggregateType !== scope.aggregateType
    || !exactText(envelope.aggregateId, 64)
    || !exactText(envelope.partitionKey, 191)
    || !exactText(envelope.idempotencyKey, 191)
    || !exactText(envelope.dedupeKey, 191)) throw catalogError();
  if (scope.scopeId === "TASK_SHARE_COMPLETED_V1") assertShareEnvelope(envelope);
  else if (scope.scopeId === "TASK_SOURCE_INVALIDATED_SETTLEMENT_V1") {
    assertTaskSourceInvalidatedEnvelope(envelope);
  } else assertActivityEnvelope(scope, envelope);
  return envelope;
}

function assertRuntimeEventClaim(scope, claim) {
  if (!plainRecord(claim)
    || !exactText(claim.outboxEventId, 64)
    || !exactText(claim.leaseOwner, 128)
    || !Number.isSafeInteger(claim.leaseGeneration)
    || claim.leaseGeneration < 1
    || !Number.isSafeInteger(claim.attemptCount)
    || claim.attemptCount < 1
    || !Number.isSafeInteger(claim.maxAttempts)
    || claim.maxAttempts < claim.attemptCount
    || !exactText(claim.claimTransitionId, 128)
    || !exactText(claim.payloadDigest, 64)
    || !/^[a-f0-9]{64}$/.test(claim.payloadDigest)
    || !plainRecord(claim.envelope)
    || claim.envelope.payloadDigest !== claim.payloadDigest) throw catalogError();
  assertRuntimeEventEnvelope(scope, claim.envelope);
  return claim;
}

function rowEnvelope(row) {
  return {
    topic: row.topic,
    sourceName: row.source_name,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    partitionKey: row.partition_key,
    partitionPosition: row.partition_position,
    aggregateVersion: row.aggregate_version,
    idempotencyKey: row.idempotency_key,
    dedupeKey: row.dedupe_key,
    payload: row.payload_json,
  };
}

function assertRuntimeEventRow(scope, row) {
  if (!plainRecord(row)) throw catalogError();
  assertRuntimeEventEnvelope(scope, rowEnvelope(row));
  return row;
}

function sqlContract(scope, alias = "candidate") {
  if (!RUNTIME_EVENT_SCOPES.includes(scope) || !/^[a-z][a-z0-9_]*$/.test(alias)) throw catalogError();
  const field = (name) => `${alias}.\`${name}\``;
  const common = [
    `${field("topic")} = ?`,
    `${field("source_name")} = ?`,
    `${field("event_type")} = ?`,
    `${field("schema_version")} = ?`,
    `${field("aggregate_type")} = ?`,
  ];
  const values = [scope.topic, scope.sourceName, scope.eventType, scope.schemaVersion, scope.aggregateType];
  if (scope.scopeId === "TASK_SHARE_COMPLETED_V1") {
    common.push(
      `${field("partition_position")} = 1`,
      `${field("aggregate_version")} = 1`,
      `JSON_TYPE(${field("payload_json")}) = 'OBJECT'`,
      `JSON_LENGTH(${field("payload_json")}) = 3`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.taskType')) = 'SHARE'`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.eventType')) = 'SHARE_COMPLETED'`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.taskEventId')) = ${field("aggregate_id")}`,
      `${field("partition_key")} = CONCAT('task_event:', ${field("aggregate_id")})`,
      `${field("idempotency_key")} = CONCAT('task-event:', ${field("aggregate_id")}, ':v1')`,
      `${field("dedupe_key")} = ${field("idempotency_key")}`
    );
  } else if (scope.scopeId === "TASK_SOURCE_INVALIDATED_SETTLEMENT_V1") {
    common.push(
      `${field("partition_position")} = 1`,
      `${field("aggregate_version")} = 1`,
      `JSON_TYPE(${field("payload_json")}) = 'OBJECT'`,
      `JSON_LENGTH(${field("payload_json")}) = 10`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.taskSourceInvalidationEventId')) = ${field("aggregate_id")}`,
      `${field("partition_key")} = CONCAT('task_source_invalidation:', ${field("aggregate_id")})`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.reasonCode')) = 'SOURCE_CANCELED'`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.sourceCancellationReasonCode')) IN ('USER_CANCELED', 'SESSION_CANCELED')`,
      `${field("idempotency_key")} = CONCAT('task-source-invalidation:', ${field("aggregate_id")}, ':v1')`,
      `${field("dedupe_key")} = ${field("idempotency_key")}`
    );
  } else {
    const confirmed = scope.scopeId === "ACTIVITY_ENROLLMENT_CONFIRMED_V1";
    common.push(
      `${field("partition_position")} = ${confirmed ? 1 : 2}`,
      `${field("aggregate_version")} = ${confirmed ? 1 : 2}`,
      `JSON_TYPE(${field("payload_json")}) = 'OBJECT'`,
      `JSON_LENGTH(${field("payload_json")}) = 9`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.activityTaskAssignmentId')) = ${field("aggregate_id")}`,
      `${field("partition_key")} = CONCAT('activity_task_assignment:', ${field("aggregate_id")})`,
      `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.transition')) = '${confirmed ? "CONFIRMED" : "CANCELED"}'`,
      confirmed
        ? `JSON_TYPE(JSON_EXTRACT(${field("payload_json")}, '$.reasonCode')) = 'NULL'`
        : `JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.reasonCode')) IN ('USER_CANCELED', 'SESSION_CANCELED')`,
      confirmed
        ? `${field("idempotency_key")} = CONCAT('activity-enrollment:', JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.activityEnrollmentId')), ':task:', JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.taskDefinitionId')), ':', JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.taskDefinitionVersion')))`
        : `${field("idempotency_key")} = CONCAT('activity-event:', JSON_UNQUOTE(JSON_EXTRACT(${field("payload_json")}, '$.activityEnrollmentEventId')), ':task:', ${field("aggregate_id")})`,
      `${field("dedupe_key")} = ${field("idempotency_key")}`
    );
  }
  return Object.freeze({ predicate: `(${common.join("\n    AND ")})`, values: Object.freeze(values) });
}

module.exports = Object.freeze({
  WORKER_MODES,
  RUNTIME_EVENT_SCOPES,
  scopeIdentity,
  runtimeEventScopeById,
  assertRuntimeEventScopeRegistration,
  assertRuntimeEventEnvelope,
  assertRuntimeEventClaim,
  assertRuntimeEventRow,
  sqlContract,
});
