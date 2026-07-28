const crypto = require("node:crypto");

const { payloadSnapshot } = require("./eventTransport");
const {
  assertRuntimeEventRow,
  assertRuntimeEventScopeRegistration,
  sqlContract,
} = require("./runtimeEventScopeCatalog");
const {
  OUTBOX_RETRY_POLICY_V1,
  decideOutboxFailure,
  retryDelayMs,
  validateOutboxRetryPolicy,
} = require("./outboxRetryPolicy");

const MAX_BATCH_LIMIT = 100;
const MAX_LEASE_SECONDS = 3_600;
const ACTIVE_STATUSES = Object.freeze(["PENDING", "RETRY_PENDING"]);
const TERMINAL_STATUSES = Object.freeze(["SUCCEEDED", "RETRY_PENDING", "DEAD_LETTER"]);
const SAFE_REASON_CODES = new Set([
  "OUTBOX_DISPATCH_FAILED",
  "OUTBOX_LEASE_EXPIRED",
  "OUTBOX_PAYLOAD_INVALID",
  "OUTBOX_SCHEMA_UNSUPPORTED",
]);
const IMMUTABLE_TEXT_FIELDS = Object.freeze([
  "topic",
  "event_type",
  "schema_version",
  "source_name",
  "partition_key",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "producer_version",
  "idempotency_key",
  "dedupe_key",
  "payload_digest",
]);
const IMMUTABLE_NULLABLE_TEXT_FIELDS = Object.freeze([
  "correlation_id",
  "causation_id",
  "release_id",
]);

const OUTBOX_SELECT_COLUMNS = Object.freeze([
  "outbox_event_id",
  "topic",
  "event_type",
  "schema_version",
  "source_name",
  "partition_key",
  "partition_position",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "occurred_at",
  "producer_version",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "dedupe_key",
  "payload_json",
  "payload_digest",
  "status",
  "attempt_count",
  "max_attempts",
  "retry_policy_version",
  "available_at",
  "next_retry_at",
  "lease_owner",
  "lease_expires_at",
  "lease_generation",
  "dispatch_transition_id",
  "last_error_json",
  "release_id",
  "succeeded_at",
  "dead_lettered_at",
  "created_at",
  "updated_at",
]);

const OUTBOX_COLUMN_LIST = OUTBOX_SELECT_COLUMNS.map((column) => `candidate.\`${column}\``).join(", ");
const OUTBOX_ROW_COLUMN_LIST = OUTBOX_SELECT_COLUMNS.map((column) => `\`${column}\``).join(", ");

const CLAIM_DUE_SQL = `/* outbox_dispatcher:claim_due_select */
SELECT ${OUTBOX_COLUMN_LIST}
FROM \`outbox_event\` AS candidate
WHERE candidate.\`retry_policy_version\` = ?
  AND candidate.\`attempt_count\` < candidate.\`max_attempts\`
  AND (
    (candidate.\`status\` = 'PENDING' AND candidate.\`available_at\` <= CURRENT_TIMESTAMP(3))
    OR
    (candidate.\`status\` = 'RETRY_PENDING' AND candidate.\`next_retry_at\` <= CURRENT_TIMESTAMP(3))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM \`outbox_event\` AS predecessor
    WHERE predecessor.\`source_name\` = candidate.\`source_name\`
      AND predecessor.\`partition_key\` = candidate.\`partition_key\`
      AND predecessor.\`partition_position\` < candidate.\`partition_position\`
      AND predecessor.\`status\` <> 'SUCCEEDED'
  )
ORDER BY candidate.\`source_name\`, candidate.\`partition_key\`, candidate.\`partition_position\`, candidate.\`outbox_event_id\`
LIMIT ?
FOR UPDATE SKIP LOCKED`;

function claimRegisteredDueSql(scope) {
  const contract = sqlContract(scope, "candidate");
  return Object.freeze({
    sql: `/* outbox_dispatcher:claim_registered_due_select */
SELECT ${OUTBOX_COLUMN_LIST}
FROM \`outbox_event\` AS candidate
WHERE candidate.\`retry_policy_version\` = ?
  AND candidate.\`attempt_count\` < candidate.\`max_attempts\`
  AND ${contract.predicate}
  AND (
    (candidate.\`status\` = 'PENDING' AND candidate.\`available_at\` <= CURRENT_TIMESTAMP(3))
    OR
    (candidate.\`status\` = 'RETRY_PENDING' AND candidate.\`next_retry_at\` <= CURRENT_TIMESTAMP(3))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM \`outbox_event\` AS predecessor
    WHERE predecessor.\`source_name\` = candidate.\`source_name\`
      AND predecessor.\`partition_key\` = candidate.\`partition_key\`
      AND predecessor.\`partition_position\` < candidate.\`partition_position\`
      AND predecessor.\`status\` <> 'SUCCEEDED'
  )
ORDER BY candidate.\`source_name\`, candidate.\`partition_key\`, candidate.\`partition_position\`, candidate.\`outbox_event_id\`
LIMIT ?
FOR UPDATE SKIP LOCKED`,
    values: contract.values,
  });
}

const CLAIM_UPDATE_SQL = `/* outbox_dispatcher:claim_update */
UPDATE \`outbox_event\`
SET \`status\` = 'CLAIMED',
    \`attempt_count\` = \`attempt_count\` + 1,
    \`lease_generation\` = \`lease_generation\` + 1,
    \`lease_owner\` = ?,
    \`lease_expires_at\` = TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)),
    \`dispatch_transition_id\` = ?,
    \`retry_policy_version\` = ?,
    \`next_retry_at\` = NULL,
    \`last_error_json\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = ?
  AND \`attempt_count\` = ?
  AND \`max_attempts\` = ?
  AND \`attempt_count\` < \`max_attempts\`
  AND \`lease_generation\` = ?
  AND \`retry_policy_version\` = ?
  AND \`lease_owner\` IS NULL
  AND \`lease_expires_at\` IS NULL
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?
  AND (
    (\`status\` = 'PENDING' AND \`available_at\` <= CURRENT_TIMESTAMP(3))
    OR
    (\`status\` = 'RETRY_PENDING' AND \`next_retry_at\` <= CURRENT_TIMESTAMP(3))
  )`;

const CLAIM_READ_SQL = `/* outbox_dispatcher:claim_read */
SELECT ${OUTBOX_ROW_COLUMN_LIST}
FROM \`outbox_event\`
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
LIMIT 1
FOR UPDATE`;

const OWNED_LOCK_SQL = `/* outbox_dispatcher:owned_lock */
SELECT ${OUTBOX_ROW_COLUMN_LIST}
FROM \`outbox_event\`
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
LIMIT 1
FOR UPDATE`;

const COMPLETE_UPDATE_SQL = `/* outbox_dispatcher:complete_update */
UPDATE \`outbox_event\`
SET \`status\` = 'SUCCEEDED',
    \`dispatch_transition_id\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`next_retry_at\` = NULL,
    \`last_error_json\` = NULL,
    \`succeeded_at\` = CURRENT_TIMESTAMP(3),
    \`dead_lettered_at\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?`;

const RETRY_UPDATE_SQL = `/* outbox_dispatcher:retry_update */
UPDATE \`outbox_event\`
SET \`status\` = 'RETRY_PENDING',
    \`retry_policy_version\` = ?,
    \`next_retry_at\` = TIMESTAMPADD(MICROSECOND, ?, CURRENT_TIMESTAMP(3)),
    \`last_error_json\` = CAST(? AS JSON),
    \`dispatch_transition_id\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`succeeded_at\` = NULL,
    \`dead_lettered_at\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?`;

const RECOVERY_RETRY_UPDATE_SQL = `/* outbox_dispatcher:recovery_retry_update */
UPDATE \`outbox_event\`
SET \`status\` = 'RETRY_PENDING',
    \`retry_policy_version\` = ?,
    \`next_retry_at\` = TIMESTAMPADD(MICROSECOND, ?, CURRENT_TIMESTAMP(3)),
    \`last_error_json\` = CAST(? AS JSON),
    \`dispatch_transition_id\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`succeeded_at\` = NULL,
    \`dead_lettered_at\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
  AND \`lease_expires_at\` <= CURRENT_TIMESTAMP(3)
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?`;

const RECOVER_EXPIRED_SQL = `/* outbox_dispatcher:recover_expired_select */
SELECT ${OUTBOX_COLUMN_LIST}
FROM \`outbox_event\` AS candidate
WHERE candidate.\`status\` = 'CLAIMED'
  AND candidate.\`retry_policy_version\` = ?
  AND candidate.\`lease_expires_at\` IS NOT NULL
  AND candidate.\`lease_expires_at\` <= CURRENT_TIMESTAMP(3)
ORDER BY candidate.\`lease_expires_at\`, candidate.\`outbox_event_id\`
LIMIT ?
FOR UPDATE SKIP LOCKED`;

function recoverRegisteredExpiredSql(scope) {
  const contract = sqlContract(scope, "candidate");
  return Object.freeze({
    sql: `/* outbox_dispatcher:recover_registered_expired_select */
SELECT ${OUTBOX_COLUMN_LIST}
FROM \`outbox_event\` AS candidate
WHERE candidate.\`status\` = 'CLAIMED'
  AND candidate.\`retry_policy_version\` = ?
  AND candidate.\`lease_expires_at\` IS NOT NULL
  AND candidate.\`lease_expires_at\` <= CURRENT_TIMESTAMP(3)
  AND ${contract.predicate}
ORDER BY candidate.\`lease_expires_at\`, candidate.\`outbox_event_id\`
LIMIT ?
FOR UPDATE SKIP LOCKED`,
    values: contract.values,
  });
}

const DEAD_INSERT_SQL = `/* outbox_dispatcher:dead_insert */
INSERT INTO \`event_dead_letter\` (
  \`event_dead_letter_id\`, \`direction\`, \`source_record_id\`, \`consumer_name\`,
  \`source_name\`, \`partition_key\`, \`partition_position\`, \`event_id\`,
  \`event_type\`, \`payload_json\`, \`payload_digest\`, \`status\`,
  \`attempt_count\`, \`reason_code\`, \`error_json\`, \`next_retry_at\`,
  \`replay_request_id\`, \`release_id\`, \`first_failed_at\`, \`last_failed_at\`,
  \`resolved_at\`, \`resolved_by\`, \`created_at\`, \`updated_at\`
) VALUES (
  ?, 'OUTBOX', ?, NULL,
  ?, ?, ?, ?,
  ?, NULL, ?, 'OPEN',
  ?, ?, CAST(? AS JSON), NULL,
  NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3),
  NULL, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
)`;

const DEAD_READ_SQL = `/* outbox_dispatcher:dead_read */
SELECT *
FROM \`event_dead_letter\`
WHERE \`direction\` = 'OUTBOX'
  AND \`source_record_id\` = ?
LIMIT 1
FOR UPDATE`;

const READ_DEAD_LETTER_SQL = `/* outbox_dispatcher:read_dead_letter */
SELECT *
FROM \`event_dead_letter\`
WHERE \`direction\` = 'OUTBOX'
  AND \`source_record_id\` = ?
LIMIT 1`;

const DEAD_UPDATE_OWNED_SQL = `/* outbox_dispatcher:dead_update_owned */
UPDATE \`outbox_event\`
SET \`status\` = 'DEAD_LETTER',
    \`last_error_json\` = CAST(? AS JSON),
    \`dispatch_transition_id\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`next_retry_at\` = NULL,
    \`succeeded_at\` = NULL,
    \`dead_lettered_at\` = CURRENT_TIMESTAMP(3),
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?`;

const DEAD_UPDATE_RECOVERY_SQL = `/* outbox_dispatcher:dead_update_recovery */
UPDATE \`outbox_event\`
SET \`status\` = 'DEAD_LETTER',
    \`last_error_json\` = CAST(? AS JSON),
    \`dispatch_transition_id\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`next_retry_at\` = NULL,
    \`succeeded_at\` = NULL,
    \`dead_lettered_at\` = CURRENT_TIMESTAMP(3),
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`outbox_event_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`dispatch_transition_id\` = ?
  AND \`lease_expires_at\` <= CURRENT_TIMESTAMP(3)
  AND \`topic\` = ?
  AND \`dedupe_key\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`payload_digest\` = ?`;

const READ_CLAIMS_SQL = `/* outbox_dispatcher:read_claims */
SELECT ${OUTBOX_ROW_COLUMN_LIST},
       (\`lease_expires_at\` > CURRENT_TIMESTAMP(3)) AS \`lease_active\`
FROM \`outbox_event\`
WHERE \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`dispatch_transition_id\` = ?
ORDER BY \`source_name\`, \`partition_key\`, \`partition_position\`, \`outbox_event_id\``;

const READ_TRANSITION_SQL = `/* outbox_dispatcher:read_transition */
SELECT ${OUTBOX_ROW_COLUMN_LIST}
FROM \`outbox_event\`
WHERE \`outbox_event_id\` = ?
LIMIT 1`;

const READ_RECOVERY_SQL = `/* outbox_dispatcher:read_recovery */
SELECT ${OUTBOX_ROW_COLUMN_LIST}
FROM \`outbox_event\`
WHERE \`dispatch_transition_id\` = ?
  AND \`status\` IN ('RETRY_PENDING', 'DEAD_LETTER')
ORDER BY \`outbox_event_id\``;

function dispatcherError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidInput() {
  return dispatcherError("OUTBOX_DISPATCHER_INPUT_INVALID", "outbox dispatcher input is invalid");
}

function invalidRow() {
  return dispatcherError("OUTBOX_ROW_INVALID", "outbox dispatcher row is invalid");
}

function persistenceFailure() {
  return dispatcherError("OUTBOX_PERSISTENCE_FAILED", "outbox dispatcher persistence failed");
}

function leaseLost() {
  return dispatcherError("OUTBOX_LEASE_LOST", "outbox dispatcher lease was lost");
}

function transitionConflict() {
  return dispatcherError("OUTBOX_DEAD_LETTER_CONFLICT", "outbox dead letter conflicts with persisted facts");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function opaqueAscii(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function exactInputText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function rawText(value, maximumLength, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value || value.length > maximumLength || value !== value.trim()) {
    throw invalidRow();
  }
  return value;
}

function safeInteger(value, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) throw invalidRow();
  return number;
}

function inputInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalidInput();
  return value;
}

function assertRegisteredRuntimeScope(value) {
  try { return assertRuntimeEventScopeRegistration(value).scope; } catch { throw invalidInput(); }
}

function assertRegisteredRuntimeRow(row, scope) {
  try { assertRuntimeEventRow(scope, row); } catch { throw invalidRow(); }
}

function parseJson(value) {
  try {
    if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
    if (typeof value === "string") return JSON.parse(value);
    return value;
  } catch {
    throw invalidRow();
  }
}

function byteEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function nullableByteEqual(left, right) {
  return left === null && right === null
    ? true
    : byteEqual(left, right);
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw invalidRow();
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeOutboxRow(input) {
  if (!dataRecord(input)) throw invalidRow();
  const payload = parseJson(input.payload_json);
  let snapshot;
  try {
    snapshot = payloadSnapshot(payload);
  } catch {
    throw invalidRow();
  }
  const payloadDigest = rawText(input.payload_digest, 64);
  if (!/^[a-f0-9]{64}$/.test(payloadDigest) || !byteEqual(snapshot.digest, payloadDigest)) throw invalidRow();

  const row = {
    outbox_event_id: rawText(input.outbox_event_id, 64),
    topic: rawText(input.topic, 128),
    event_type: rawText(input.event_type, 128),
    schema_version: rawText(input.schema_version, 32),
    source_name: rawText(input.source_name, 96),
    partition_key: rawText(input.partition_key, 191),
    partition_position: safeInteger(input.partition_position, { positive: true }),
    aggregate_type: rawText(input.aggregate_type, 96),
    aggregate_id: rawText(input.aggregate_id, 191),
    aggregate_version: safeInteger(input.aggregate_version, { positive: true }),
    occurred_at: rawText(input.occurred_at, 64),
    producer_version: rawText(input.producer_version, 64),
    correlation_id: input.correlation_id === null ? null : rawText(input.correlation_id, 128),
    causation_id: input.causation_id === null ? null : rawText(input.causation_id, 128),
    idempotency_key: rawText(input.idempotency_key, 191),
    dedupe_key: rawText(input.dedupe_key, 191),
    payload_json: cloneJson(payload),
    payload_digest: payloadDigest,
    status: rawText(input.status, 32),
    attempt_count: safeInteger(input.attempt_count),
    max_attempts: safeInteger(input.max_attempts, { positive: true }),
    retry_policy_version: rawText(input.retry_policy_version, 64),
    available_at: rawText(input.available_at, 64),
    next_retry_at: input.next_retry_at === null ? null : rawText(input.next_retry_at, 64),
    lease_owner: input.lease_owner === null ? null : rawText(input.lease_owner, 128),
    lease_expires_at: input.lease_expires_at === null ? null : rawText(input.lease_expires_at, 64),
    lease_generation: safeInteger(input.lease_generation),
    dispatch_transition_id: input.dispatch_transition_id === null
      ? null
      : rawText(input.dispatch_transition_id, 128),
    last_error_json: input.last_error_json === null ? null : parseJson(input.last_error_json),
    release_id: input.release_id === null ? null : rawText(input.release_id, 96),
    succeeded_at: input.succeeded_at === null ? null : rawText(input.succeeded_at, 64),
    dead_lettered_at: input.dead_lettered_at === null ? null : rawText(input.dead_lettered_at, 64),
    created_at: rawText(input.created_at, 64),
    updated_at: rawText(input.updated_at, 64),
  };
  if (row.attempt_count > row.max_attempts) throw invalidRow();
  return row;
}

function identityValues(row) {
  return [
    row.topic,
    row.dedupe_key,
    row.source_name,
    row.partition_key,
    row.partition_position,
    row.payload_digest,
  ];
}

function assertSameIdentity(left, right) {
  if (!byteEqual(left.outbox_event_id, right.outbox_event_id)
    || left.partition_position !== right.partition_position
    || left.aggregate_version !== right.aggregate_version
    || IMMUTABLE_TEXT_FIELDS.some((field) => !byteEqual(left[field], right[field]))
    || IMMUTABLE_NULLABLE_TEXT_FIELDS.some((field) => !nullableByteEqual(left[field], right[field]))) {
    throw invalidRow();
  }
}

function envelopeFromRow(row) {
  return deepFreeze({
    topic: row.topic,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    sourceName: row.source_name,
    partitionKey: row.partition_key,
    partitionPosition: row.partition_position,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    producerVersion: row.producer_version,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    dedupeKey: row.dedupe_key,
    payload: cloneJson(row.payload_json),
    payloadDigest: row.payload_digest,
    releaseId: row.release_id,
  });
}

function claimFromRow(row) {
  if (row.status !== "CLAIMED"
    || !opaqueAscii(row.lease_owner, 128)
    || !opaqueAscii(row.dispatch_transition_id, 128)
    || row.attempt_count < 1
    || row.lease_generation < 1) {
    throw invalidRow();
  }
  return deepFreeze({
    outboxEventId: row.outbox_event_id,
    leaseOwner: row.lease_owner,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicyVersion: row.retry_policy_version,
    claimTransitionId: row.dispatch_transition_id,
    payloadDigest: row.payload_digest,
    envelope: envelopeFromRow(row),
  });
}

const CLAIM_KEYS = Object.freeze([
  "outboxEventId",
  "leaseOwner",
  "leaseGeneration",
  "attemptCount",
  "maxAttempts",
  "retryPolicyVersion",
  "claimTransitionId",
  "payloadDigest",
  "envelope",
]);

const ENVELOPE_KEYS = Object.freeze([
  "topic",
  "eventType",
  "schemaVersion",
  "sourceName",
  "partitionKey",
  "partitionPosition",
  "aggregateType",
  "aggregateId",
  "aggregateVersion",
  "occurredAt",
  "producerVersion",
  "correlationId",
  "causationId",
  "idempotencyKey",
  "dedupeKey",
  "payload",
  "payloadDigest",
  "releaseId",
]);

function normalizeClaim(input) {
  if (!exactKeys(input, CLAIM_KEYS) || !exactKeys(input.envelope, ENVELOPE_KEYS)) throw invalidInput();
  if (!exactInputText(input.outboxEventId, 64)
    || !opaqueAscii(input.leaseOwner, 128)
    || !opaqueAscii(input.claimTransitionId, 128)
    || !opaqueAscii(input.retryPolicyVersion, 64)
    || !Number.isSafeInteger(input.leaseGeneration)
    || input.leaseGeneration < 1
    || !Number.isSafeInteger(input.attemptCount)
    || input.attemptCount < 1
    || !Number.isSafeInteger(input.maxAttempts)
    || input.maxAttempts < input.attemptCount
    || typeof input.payloadDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(input.payloadDigest)) {
    throw invalidInput();
  }
  const envelope = input.envelope;
  if (!exactInputText(envelope.topic, 128)
    || !exactInputText(envelope.eventType, 128)
    || !exactInputText(envelope.schemaVersion, 32)
    || !exactInputText(envelope.sourceName, 96)
    || !exactInputText(envelope.partitionKey, 191)
    || !Number.isSafeInteger(envelope.partitionPosition)
    || envelope.partitionPosition < 1
    || !exactInputText(envelope.aggregateType, 96)
    || !exactInputText(envelope.aggregateId, 191)
    || !Number.isSafeInteger(envelope.aggregateVersion)
    || envelope.aggregateVersion < 1
    || !exactInputText(envelope.occurredAt, 64)
    || !exactInputText(envelope.producerVersion, 64)
    || !(envelope.correlationId === null || exactInputText(envelope.correlationId, 128))
    || !(envelope.causationId === null || exactInputText(envelope.causationId, 128))
    || !exactInputText(envelope.idempotencyKey, 191)
    || !exactInputText(envelope.dedupeKey, 191)
    || !(envelope.releaseId === null || exactInputText(envelope.releaseId, 96))
    || !byteEqual(envelope.payloadDigest, input.payloadDigest)) {
    throw invalidInput();
  }
  let snapshot;
  try {
    snapshot = payloadSnapshot(envelope.payload);
  } catch {
    throw invalidInput();
  }
  if (!byteEqual(snapshot.digest, input.payloadDigest)) throw invalidInput();
  return deepFreeze({
    ...input,
    envelope: {
      ...envelope,
      payload: cloneJson(envelope.payload),
    },
  });
}

function claimEnvelopeMatchesRow(claim, row) {
  const envelope = claim.envelope;
  return byteEqual(envelope.topic, row.topic)
    && byteEqual(envelope.eventType, row.event_type)
    && byteEqual(envelope.schemaVersion, row.schema_version)
    && byteEqual(envelope.sourceName, row.source_name)
    && byteEqual(envelope.partitionKey, row.partition_key)
    && envelope.partitionPosition === row.partition_position
    && byteEqual(envelope.aggregateType, row.aggregate_type)
    && byteEqual(envelope.aggregateId, row.aggregate_id)
    && envelope.aggregateVersion === row.aggregate_version
    && byteEqual(envelope.occurredAt, row.occurred_at)
    && byteEqual(envelope.producerVersion, row.producer_version)
    && nullableByteEqual(envelope.correlationId, row.correlation_id)
    && nullableByteEqual(envelope.causationId, row.causation_id)
    && byteEqual(envelope.idempotencyKey, row.idempotency_key)
    && byteEqual(envelope.dedupeKey, row.dedupe_key)
    && byteEqual(envelope.payloadDigest, row.payload_digest)
    && nullableByteEqual(envelope.releaseId, row.release_id);
}

function assertClaimMatchesRow(claim, row) {
  if (!byteEqual(claim.outboxEventId, row.outbox_event_id)
    || !byteEqual(claim.leaseOwner, row.lease_owner)
    || claim.leaseGeneration !== row.lease_generation
    || claim.attemptCount !== row.attempt_count
    || claim.maxAttempts !== row.max_attempts
    || !byteEqual(claim.retryPolicyVersion, row.retry_policy_version)
    || !byteEqual(claim.claimTransitionId, row.dispatch_transition_id)
    || !byteEqual(claim.payloadDigest, row.payload_digest)
    || !claimEnvelopeMatchesRow(claim, row)) {
    throw leaseLost();
  }
}

function assertTerminalClaimIdentity(claim, row) {
  if (!byteEqual(claim.outboxEventId, row.outbox_event_id)
    || claim.leaseGeneration !== row.lease_generation
    || claim.attemptCount !== row.attempt_count
    || claim.maxAttempts !== row.max_attempts
    || !byteEqual(claim.retryPolicyVersion, row.retry_policy_version)
    || !byteEqual(claim.payloadDigest, row.payload_digest)
    || !claimEnvelopeMatchesRow(claim, row)) {
    throw invalidRow();
  }
}

function assertTerminalShape(row) {
  if (row.lease_owner !== null
    || row.lease_expires_at !== null
    || row.retry_policy_version !== OUTBOX_RETRY_POLICY_V1.policyVersion) {
    throw transitionConflict();
  }
  if (row.status === "SUCCEEDED") {
    if (row.succeeded_at === null
      || row.next_retry_at !== null
      || row.last_error_json !== null
      || row.dead_lettered_at !== null) throw transitionConflict();
    return;
  }
  const error = row.last_error_json;
  if (!exactKeys(error, ["code", "message"])
    || !SAFE_REASON_CODES.has(error.code)
    || error.message !== "outbox dispatch failed"
    || row.succeeded_at !== null) {
    throw transitionConflict();
  }
  if (row.status === "RETRY_PENDING") {
    if (row.next_retry_at === null || row.dead_lettered_at !== null) throw transitionConflict();
    return;
  }
  if (row.status === "DEAD_LETTER") {
    if (row.next_retry_at !== null || row.dead_lettered_at === null) throw transitionConflict();
    return;
  }
  throw transitionConflict();
}

function safeErrorJson(decision) {
  return JSON.stringify({ code: decision.reasonCode, message: decision.safeMessage });
}

function normalizeFailureDecision(decision) {
  if (!plainRecord(decision)
    || !["RETRY", "DEAD_LETTER"].includes(decision.kind)
    || !Number.isSafeInteger(decision.delayMs)
    || decision.delayMs < 0
    || !opaqueAscii(decision.reasonCode, 64)
    || !opaqueAscii(decision.policyVersion, 64)) {
    throw invalidInput();
  }
  return Object.freeze({
    nextStatus: decision.kind === "RETRY" ? "RETRY_PENDING" : "DEAD_LETTER",
    delayMs: decision.delayMs,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    safeMessage: "outbox dispatch failed",
  });
}

function transitionResult(row, transitionId) {
  const base = {
    outboxEventId: row.outbox_event_id,
    status: row.status,
    transitionId,
    leaseGeneration: row.lease_generation,
  };
  if (row.status === "RETRY_PENDING") {
    return Object.freeze({
      ...base,
      retryPolicyVersion: row.retry_policy_version,
      delayMs: retryDelayMs(row.attempt_count, OUTBOX_RETRY_POLICY_V1),
    });
  }
  if (row.status === "DEAD_LETTER") {
    const error = plainRecord(row.last_error_json) ? row.last_error_json : {};
    return Object.freeze({
      ...base,
      reasonCode: typeof error.code === "string" ? error.code : "OUTBOX_DISPATCH_FAILED",
    });
  }
  return Object.freeze(base);
}

function deadLetterId(outboxEventId) {
  const digest = crypto.createHash("sha256").update("myroot-outbox-dead-letter:v1\0").update(outboxEventId).digest("hex");
  return `dead_${digest.slice(0, 59)}`;
}

function duplicateEntry(error) {
  return Boolean(error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062));
}

function normalizeDeadLetter(input) {
  if (!dataRecord(input)) throw transitionConflict();
  let errorJson;
  try {
    errorJson = parseJson(input.error_json);
  } catch {
    throw transitionConflict();
  }
  return {
    direction: input.direction,
    source_record_id: input.source_record_id,
    consumer_name: input.consumer_name,
    source_name: input.source_name,
    partition_key: input.partition_key,
    partition_position: Number(input.partition_position),
    event_id: input.event_id,
    event_type: input.event_type,
    payload_json: input.payload_json,
    payload_digest: input.payload_digest,
    status: input.status,
    attempt_count: Number(input.attempt_count),
    reason_code: input.reason_code,
    error_json: errorJson,
    next_retry_at: input.next_retry_at,
    replay_request_id: input.replay_request_id,
    release_id: input.release_id,
    resolved_at: input.resolved_at,
    resolved_by: input.resolved_by,
  };
}

function exactDeadLetter(existing, row, decision) {
  const error = existing.error_json;
  return existing.direction === "OUTBOX"
    && byteEqual(existing.source_record_id, row.outbox_event_id)
    && existing.consumer_name === null
    && byteEqual(existing.source_name, row.source_name)
    && byteEqual(existing.partition_key, row.partition_key)
    && existing.partition_position === row.partition_position
    && byteEqual(existing.event_id, row.outbox_event_id)
    && byteEqual(existing.event_type, row.event_type)
    && existing.payload_json === null
    && byteEqual(existing.payload_digest, row.payload_digest)
    && existing.status === "OPEN"
    && existing.attempt_count === row.attempt_count
    && existing.reason_code === decision.reasonCode
    && plainRecord(error)
    && error.code === decision.reasonCode
    && error.message === decision.safeMessage
    && existing.next_retry_at === null
    && existing.replay_request_id === null
    && existing.release_id === row.release_id
    && existing.resolved_at === null
    && existing.resolved_by === null;
}

function affectedRows(result) {
  const header = Array.isArray(result) ? result[0] : null;
  if (!header || !Number.isSafeInteger(header.affectedRows)) throw persistenceFailure();
  return header.affectedRows;
}

function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw persistenceFailure();
  return rows;
}

function createMysqlOutboxDispatcherAdapter(connection) {
  if (!connection || typeof connection.execute !== "function") {
    throw dispatcherError(
      "OUTBOX_DISPATCHER_CONFIGURATION_INVALID",
      "outbox dispatcher configuration is invalid"
    );
  }
  let active = true;

  function assertActive() {
    if (!active) throw dispatcherError("OUTBOX_DISPATCHER_INACTIVE", "outbox dispatcher transaction is inactive");
  }

  async function safeExecute(sql, values) {
    try {
      return await connection.execute(sql, values);
    } catch {
      throw persistenceFailure();
    }
  }

  async function lockOwned(claim) {
    const rows = selectedRows(await safeExecute(OWNED_LOCK_SQL, [
      claim.outboxEventId,
      claim.leaseOwner,
      claim.leaseGeneration,
      claim.claimTransitionId,
    ]));
    if (rows.length !== 1) throw leaseLost();
    const row = normalizeOutboxRow(rows[0]);
    assertClaimMatchesRow(claim, row);
    return row;
  }

  async function insertOrVerifyDeadLetter(row, decision) {
    const errorJson = safeErrorJson(decision);
    const values = [
      deadLetterId(row.outbox_event_id),
      row.outbox_event_id,
      row.source_name,
      row.partition_key,
      row.partition_position,
      row.outbox_event_id,
      row.event_type,
      row.payload_digest,
      row.attempt_count,
      decision.reasonCode,
      errorJson,
      row.release_id,
    ];
    try {
      const result = await connection.execute(DEAD_INSERT_SQL, values);
      if (affectedRows(result) !== 1) throw transitionConflict();
      return;
    } catch (error) {
      if (!duplicateEntry(error)) {
        if (error && error.code === "OUTBOX_DEAD_LETTER_CONFLICT") throw error;
        throw persistenceFailure();
      }
    }
    const existingRows = selectedRows(await safeExecute(DEAD_READ_SQL, [row.outbox_event_id]));
    if (existingRows.length !== 1) throw transitionConflict();
    let existing;
    try {
      existing = normalizeDeadLetter(existingRows[0]);
    } catch {
      throw transitionConflict();
    }
    if (!exactDeadLetter(existing, row, decision)) throw transitionConflict();
  }

  async function verifyDeadLetter(row) {
    const rows = selectedRows(await safeExecute(READ_DEAD_LETTER_SQL, [row.outbox_event_id]));
    if (rows.length !== 1) throw transitionConflict();
    const error = plainRecord(row.last_error_json) ? row.last_error_json : {};
    const decision = {
      reasonCode: typeof error.code === "string" ? error.code : "OUTBOX_DISPATCH_FAILED",
      safeMessage: "outbox dispatch failed",
    };
    let existing;
    try {
      existing = normalizeDeadLetter(rows[0]);
    } catch {
      throw transitionConflict();
    }
    if (!exactDeadLetter(existing, row, decision)) throw transitionConflict();
  }

  async function persistRetry(row, claim, transitionId, decision, recovery) {
    const sql = recovery ? RECOVERY_RETRY_UPDATE_SQL : RETRY_UPDATE_SQL;
    const result = await safeExecute(sql, [
      decision.policyVersion,
      decision.delayMs * 1_000,
      safeErrorJson(decision),
      transitionId,
      row.outbox_event_id,
      row.lease_owner,
      row.lease_generation,
      row.dispatch_transition_id,
      ...identityValues(row),
    ]);
    if (affectedRows(result) !== 1) throw leaseLost();
    const persisted = {
      ...row,
      status: "RETRY_PENDING",
      retry_policy_version: decision.policyVersion,
      dispatch_transition_id: transitionId,
      lease_owner: null,
      lease_expires_at: null,
      last_error_json: JSON.parse(safeErrorJson(decision)),
    };
    if (claim) assertClaimMatchesRow(claim, row);
    return transitionResult(persisted, transitionId);
  }

  async function persistDeadLetter(row, claim, transitionId, decision, recovery) {
    if (claim) assertClaimMatchesRow(claim, row);
    await insertOrVerifyDeadLetter(row, decision);
    const sql = recovery ? DEAD_UPDATE_RECOVERY_SQL : DEAD_UPDATE_OWNED_SQL;
    const result = await safeExecute(sql, [
      safeErrorJson(decision),
      transitionId,
      row.outbox_event_id,
      row.lease_owner,
      row.lease_generation,
      row.dispatch_transition_id,
      ...identityValues(row),
    ]);
    if (affectedRows(result) !== 1) throw leaseLost();
    return transitionResult({
      ...row,
      status: "DEAD_LETTER",
      dispatch_transition_id: transitionId,
      lease_owner: null,
      lease_expires_at: null,
      last_error_json: JSON.parse(safeErrorJson(decision)),
    }, transitionId);
  }

  async function persistClaims(input, selected, registeredScope = null) {
    const claims = [];
    for (const selectedValue of selected) {
      const before = normalizeOutboxRow(selectedValue);
      if (!ACTIVE_STATUSES.includes(before.status)) throw invalidRow();
      if (registeredScope) assertRegisteredRuntimeRow(before, registeredScope);
      const update = await safeExecute(CLAIM_UPDATE_SQL, [
        input.workerId,
        input.leaseSeconds,
        input.transitionId,
        input.retryPolicyVersion,
        before.outbox_event_id,
        before.status,
        before.attempt_count,
        before.max_attempts,
        before.lease_generation,
        before.retry_policy_version,
        ...identityValues(before),
      ]);
      if (affectedRows(update) !== 1) throw leaseLost();
      const generation = before.lease_generation + 1;
      const afterRows = selectedRows(await safeExecute(CLAIM_READ_SQL, [
        before.outbox_event_id,
        input.workerId,
        generation,
        input.transitionId,
      ]));
      if (afterRows.length !== 1) throw leaseLost();
      const after = normalizeOutboxRow(afterRows[0]);
      assertSameIdentity(before, after);
      if (registeredScope) assertRegisteredRuntimeRow(after, registeredScope);
      if (after.attempt_count !== before.attempt_count + 1
        || after.lease_generation !== generation
        || after.max_attempts !== before.max_attempts
        || !byteEqual(after.retry_policy_version, input.retryPolicyVersion)) {
        throw invalidRow();
      }
      claims.push(claimFromRow(after));
    }
    return Object.freeze(claims);
  }

  function normalizeClaimRequest(input, keys) {
    if (!exactKeys(input, keys)
      || !opaqueAscii(input.workerId, 128)
      || !opaqueAscii(input.transitionId, 128)
      || input.retryPolicyVersion !== OUTBOX_RETRY_POLICY_V1.policyVersion) {
      throw invalidInput();
    }
    return Object.freeze({
      limit: inputInteger(input.limit, 1, MAX_BATCH_LIMIT),
      leaseSeconds: inputInteger(input.leaseSeconds, 1, MAX_LEASE_SECONDS),
    });
  }

  async function claimDue(input) {
    assertActive();
    const normalized = normalizeClaimRequest(input, [
      "workerId", "transitionId", "limit", "leaseSeconds", "retryPolicyVersion",
    ]);
    const selected = selectedRows(await safeExecute(CLAIM_DUE_SQL, [
      input.retryPolicyVersion,
      normalized.limit,
    ]));
    return persistClaims({ ...input, leaseSeconds: normalized.leaseSeconds }, selected);
  }

  async function claimRegistered(input) {
    assertActive();
    const normalized = normalizeClaimRequest(input, [
      "workerId", "transitionId", "limit", "leaseSeconds", "retryPolicyVersion", "handlerRegistration",
    ]);
    const scope = assertRegisteredRuntimeScope(input.handlerRegistration);
    const query = claimRegisteredDueSql(scope);
    const selected = selectedRows(await safeExecute(query.sql, [
      input.retryPolicyVersion,
      ...query.values,
      normalized.limit,
    ]));
    return persistClaims({ ...input, leaseSeconds: normalized.leaseSeconds }, selected, scope);
  }

  async function completeOwned(claimInput, input) {
    assertActive();
    const claim = normalizeClaim(claimInput);
    if (!exactKeys(input, ["transitionId"]) || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    const row = await lockOwned(claim);
    const result = await safeExecute(COMPLETE_UPDATE_SQL, [
      input.transitionId,
      row.outbox_event_id,
      row.lease_owner,
      row.lease_generation,
      row.dispatch_transition_id,
      ...identityValues(row),
    ]);
    if (affectedRows(result) !== 1) throw leaseLost();
    return transitionResult({
      ...row,
      status: "SUCCEEDED",
      dispatch_transition_id: input.transitionId,
      lease_owner: null,
      lease_expires_at: null,
    }, input.transitionId);
  }

  async function failOwned(claimInput, input) {
    assertActive();
    const claim = normalizeClaim(claimInput);
    if (!exactKeys(input, ["transitionId", "reasonCode", "retryable", "retryPolicy"])
      || !opaqueAscii(input.transitionId, 128)
      || typeof input.retryable !== "boolean") {
      throw invalidInput();
    }
    let policy;
    try {
      policy = validateOutboxRetryPolicy(input.retryPolicy);
    } catch {
      throw invalidInput();
    }
    const row = await lockOwned(claim);
    const decision = normalizeFailureDecision(decideOutboxFailure({
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      retryable: input.retryable,
      reasonCode: input.reasonCode,
    }, policy));
    if (decision.nextStatus === "RETRY_PENDING") {
      return persistRetry(row, claim, input.transitionId, decision, false);
    }
    return persistDeadLetter(row, claim, input.transitionId, decision, false);
  }

  async function persistRecovery(input, policy, selected, registeredScope = null) {
    const results = [];
    for (const value of selected) {
      const row = normalizeOutboxRow(value);
      if (registeredScope) assertRegisteredRuntimeRow(row, registeredScope);
      if (row.status !== "CLAIMED"
        || row.retry_policy_version !== policy.policyVersion
        || !opaqueAscii(row.lease_owner, 128)
        || !opaqueAscii(row.dispatch_transition_id, 128)
        || row.lease_generation < 1
        || row.attempt_count < 1) {
        throw invalidRow();
      }
      const decision = normalizeFailureDecision(decideOutboxFailure({
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        retryable: true,
        reasonCode: "OUTBOX_LEASE_EXPIRED",
      }, policy));
      if (decision.nextStatus === "RETRY_PENDING") {
        results.push(await persistRetry(row, null, input.transitionId, decision, true));
      } else {
        results.push(await persistDeadLetter(row, null, input.transitionId, decision, true));
      }
    }
    return Object.freeze(results);
  }

  function normalizeRecoveryRequest(input, keys) {
    if (!exactKeys(input, keys) || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    const limit = inputInteger(input.limit, 1, MAX_BATCH_LIMIT);
    let policy;
    try {
      policy = validateOutboxRetryPolicy(input.retryPolicy);
    } catch {
      throw invalidInput();
    }
    return Object.freeze({ limit, policy });
  }

  async function recoverExpired(input) {
    assertActive();
    const normalized = normalizeRecoveryRequest(input, ["transitionId", "limit", "retryPolicy"]);
    const selected = selectedRows(await safeExecute(RECOVER_EXPIRED_SQL, [
      normalized.policy.policyVersion,
      normalized.limit,
    ]));
    return persistRecovery(input, normalized.policy, selected);
  }

  async function recoverExpiredRegistered(input) {
    assertActive();
    const normalized = normalizeRecoveryRequest(input, [
      "transitionId", "limit", "retryPolicy", "handlerRegistration",
    ]);
    const scope = assertRegisteredRuntimeScope(input.handlerRegistration);
    const query = recoverRegisteredExpiredSql(scope);
    const selected = selectedRows(await safeExecute(query.sql, [
      normalized.policy.policyVersion,
      ...query.values,
      normalized.limit,
    ]));
    return persistRecovery(input, normalized.policy, selected, scope);
  }

  async function readClaimsByTransition(input) {
    assertActive();
    if (!exactKeys(input, ["workerId", "transitionId"])
      || !opaqueAscii(input.workerId, 128)
      || !opaqueAscii(input.transitionId, 128)) {
      throw invalidInput();
    }
    const rows = selectedRows(await safeExecute(READ_CLAIMS_SQL, [input.workerId, input.transitionId]));
    return Object.freeze(rows.map((value) => {
      if (Number(value.lease_active) !== 1) throw leaseLost();
      return claimFromRow(normalizeOutboxRow(value));
    }));
  }

  async function readTransition(input) {
    assertActive();
    if (!exactKeys(input, ["claim", "transitionId", "expectedStatus"])
      || !opaqueAscii(input.transitionId, 128)
      || !TERMINAL_STATUSES.includes(input.expectedStatus)) {
      throw invalidInput();
    }
    const claim = normalizeClaim(input.claim);
    const rows = selectedRows(await safeExecute(READ_TRANSITION_SQL, [claim.outboxEventId]));
    if (rows.length === 0) return Object.freeze({ state: "ABSENT" });
    if (rows.length !== 1) throw persistenceFailure();
    const raw = rows[0];
    const row = normalizeOutboxRow(raw);
    if (row.status === input.expectedStatus
      && byteEqual(row.dispatch_transition_id, input.transitionId)
      && row.lease_generation === claim.leaseGeneration) {
      assertTerminalClaimIdentity(claim, row);
      assertTerminalShape(row);
      if (row.status === "DEAD_LETTER") await verifyDeadLetter(row);
      return Object.freeze({
        state: "CONVERGED",
        result: transitionResult(row, input.transitionId),
      });
    }
    if (row.status === "CLAIMED"
      && byteEqual(row.lease_owner, claim.leaseOwner)
      && row.lease_generation === claim.leaseGeneration
      && byteEqual(row.dispatch_transition_id, claim.claimTransitionId)) {
      assertClaimMatchesRow(claim, row);
      return Object.freeze({ state: "OWNED" });
    }
    return Object.freeze({ state: "LEASE_LOST" });
  }

  async function readRecoveryByTransition(input) {
    assertActive();
    if (!exactKeys(input, ["transitionId"]) || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    const rows = selectedRows(await safeExecute(READ_RECOVERY_SQL, [input.transitionId]));
    if (rows.length === 0) return Object.freeze({ state: "ABSENT" });
    const results = [];
    for (const value of rows) {
      const row = normalizeOutboxRow(value);
      if (!byteEqual(row.dispatch_transition_id, input.transitionId)
        || !["RETRY_PENDING", "DEAD_LETTER"].includes(row.status)) {
        throw transitionConflict();
      }
      assertTerminalShape(row);
      if (row.status === "DEAD_LETTER") await verifyDeadLetter(row);
      results.push(transitionResult(row, input.transitionId));
    }
    return Object.freeze({ state: "CONVERGED", result: Object.freeze(results) });
  }

  function discard() {
    active = false;
    return Object.freeze({ discarded: true });
  }

  return Object.freeze({
    claimDue,
    claimRegistered,
    recoverExpired,
    recoverExpiredRegistered,
    completeOwned,
    failOwned,
    readClaimsByTransition,
    readTransition,
    readRecoveryByTransition,
    discard,
  });
}

module.exports = {
  createMysqlOutboxDispatcherAdapter,
};
