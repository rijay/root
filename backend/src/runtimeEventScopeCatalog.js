const { assertResolvedInboxHandlerRegistration } = require("./inboxHandlerRegistry");

const WORKER_MODES = Object.freeze({
  ENABLED: "ENABLED",
  BLOCKED_SUCCESSOR_UNAVAILABLE: "BLOCKED_SUCCESSOR_UNAVAILABLE",
});

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
  assertShareEnvelope(envelope);
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
