const crypto = require("node:crypto");

const { payloadSnapshot } = require("./eventTransport");
const {
  createMysqlEventTransportAdapter,
  snapshotOutboxImmutableIdentity,
} = require("./mysqlEventTransportAdapter");
const {
  INBOX_RETRY_POLICY_V1,
  decideInboxFailure,
  validateInboxRetryPolicy,
} = require("./inboxRetryPolicy");
const {
  assertResolvedInboxHandlerRegistration,
} = require("./inboxHandlerRegistry");

const MAX_LEASE_SECONDS = 3_600;
const MAX_INBOX_PAYLOAD_BYTES = 64 * 1024;
const MAX_HANDLER_RESULT_BYTES = 32 * 1024;
const MAX_HANDLER_MANIFEST_BYTES = 32 * 1024;
const MAX_PERSISTED_RESULT_BYTES = 96 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_048;
const INBOX_CONTENT_CODEC_VERSION = "A256GCM:v1";
const INBOX_CONTENT_DIGEST_SCHEME = "hmac-sha256:v1";
const SUPPORTED_STATUSES = Object.freeze([
  "RECEIVED",
  "CLAIMED",
  "RETRY_PENDING",
  "SUCCEEDED",
  "DEAD_LETTER",
  "REVIEW_REQUIRED",
]);
const TERMINAL_STATUSES = Object.freeze(["SUCCEEDED", "RETRY_PENDING", "DEAD_LETTER"]);

const RECEIPT_COLUMNS = Object.freeze([
  "inbox_receipt_id",
  "consumer_name",
  "source_name",
  "partition_key",
  "partition_position",
  "event_id",
  "event_type",
  "schema_version",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "occurred_at",
  "producer_version",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "handler_version",
  "handler_id",
  "handler_registry_version",
  "handler_descriptor_digest",
  "handler_source_digest",
  "handler_registration_digest",
  "payload_json",
  "payload_codec_version",
  "payload_key_id",
  "payload_digest_scheme",
  "payload_digest",
  "status",
  "attempt_count",
  "max_attempts",
  "retry_policy_version",
  "next_retry_at",
  "lease_owner",
  "lease_expires_at",
  "lease_generation",
  "inbox_transition_id",
  "result_json",
  "result_codec_version",
  "result_key_id",
  "result_digest_scheme",
  "result_digest",
  "completion_manifest_digest",
  "completion_manifest_digest_scheme",
  "error_json",
  "first_received_at",
  "last_received_at",
  "started_at",
  "completed_at",
  "failed_at",
  "dead_lettered_at",
  "updated_at",
]);

const CHECKPOINT_COLUMNS = Object.freeze([
  "consumer_checkpoint_id",
  "consumer_name",
  "source_name",
  "partition_key",
  "last_contiguous_position",
  "high_watermark_position",
  "state_generation",
  "checkpoint_transition_id",
  "gap_status",
  "gap_from_position",
  "gap_to_position",
  "gap_reason_code",
  "blocked_receipt_id",
  "handler_version",
  "last_event_id",
  "last_receipt_id",
  "created_at",
  "updated_at",
]);

const RECEIPT_COLUMN_LIST = RECEIPT_COLUMNS.map((column) => `\`${column}\``).join(", ");
const CHECKPOINT_COLUMN_LIST = CHECKPOINT_COLUMNS.map((column) => `\`${column}\``).join(", ");

const CHECKPOINT_INSERT_SQL = `/* inbox_checkpoint:checkpoint_insert */
INSERT INTO \`consumer_checkpoint\` (
  \`consumer_checkpoint_id\`, \`consumer_name\`, \`source_name\`, \`partition_key\`,
  \`last_contiguous_position\`, \`high_watermark_position\`, \`state_generation\`,
  \`checkpoint_transition_id\`, \`gap_status\`, \`gap_from_position\`,
  \`gap_to_position\`, \`gap_reason_code\`, \`blocked_receipt_id\`,
  \`handler_version\`, \`last_event_id\`, \`last_receipt_id\`,
  \`created_at\`, \`updated_at\`
) VALUES (?, ?, ?, ?, 0, 0, 0, NULL, 'CLEAR', NULL, NULL, NULL, NULL, ?, NULL, NULL,
          CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

const CHECKPOINT_LOCK_SQL = `/* inbox_checkpoint:checkpoint_lock */
SELECT ${CHECKPOINT_COLUMN_LIST}
FROM \`consumer_checkpoint\`
WHERE \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
LIMIT 1
FOR UPDATE`;

const CHECKPOINT_READ_SQL = `/* inbox_checkpoint:checkpoint_read */
SELECT ${CHECKPOINT_COLUMN_LIST}
FROM \`consumer_checkpoint\`
WHERE \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
LIMIT 1`;

const RECEIPT_BY_EVENT_LOCK_SQL = `/* inbox_checkpoint:receipt_by_event_lock */
SELECT ${RECEIPT_COLUMN_LIST}
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ? AND \`event_id\` = ?
LIMIT 1
FOR UPDATE`;

const RECEIPT_BY_POSITION_LOCK_SQL = `/* inbox_checkpoint:receipt_by_position_lock */
SELECT ${RECEIPT_COLUMN_LIST}
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
LIMIT 1
FOR UPDATE`;

const RECEIPT_READ_SQL = `/* inbox_checkpoint:receipt_read */
SELECT ${RECEIPT_COLUMN_LIST}
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ? AND \`event_id\` = ?
LIMIT 1`;

const RECEIPT_INSERT_SQL = `/* inbox_checkpoint:receipt_insert */
INSERT INTO \`inbox_receipt\` (
  \`inbox_receipt_id\`, \`consumer_name\`, \`source_name\`, \`partition_key\`,
  \`partition_position\`, \`event_id\`, \`event_type\`, \`schema_version\`,
  \`aggregate_type\`, \`aggregate_id\`, \`aggregate_version\`, \`occurred_at\`,
  \`producer_version\`, \`correlation_id\`, \`causation_id\`, \`idempotency_key\`,
  \`handler_version\`, \`handler_id\`, \`handler_registry_version\`,
  \`handler_descriptor_digest\`, \`handler_source_digest\`, \`handler_registration_digest\`,
  \`payload_json\`, \`payload_codec_version\`, \`payload_key_id\`,
  \`payload_digest_scheme\`, \`payload_digest\`, \`status\`,
  \`attempt_count\`, \`max_attempts\`, \`retry_policy_version\`, \`next_retry_at\`,
  \`lease_owner\`, \`lease_expires_at\`, \`lease_generation\`,
  \`inbox_transition_id\`, \`result_json\`, \`result_codec_version\`, \`result_key_id\`,
  \`result_digest_scheme\`, \`result_digest\`, \`completion_manifest_digest\`,
  \`completion_manifest_digest_scheme\`, \`error_json\`, \`first_received_at\`,
  \`last_received_at\`, \`started_at\`, \`completed_at\`, \`failed_at\`,
  \`dead_lettered_at\`, \`updated_at\`
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, 'RECEIVED',
  0, ?, ?, NULL, NULL, NULL, 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP(3)
)`;

const RECEIPT_TOUCH_SQL = `/* inbox_checkpoint:receipt_touch */
UPDATE \`inbox_receipt\`
SET \`last_received_at\` = CURRENT_TIMESTAMP(3), \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`inbox_receipt_id\` = ?
  AND \`consumer_name\` = ?
  AND \`event_id\` = ?
  AND \`payload_digest\` = ?
  AND \`handler_id\` = ?
  AND \`handler_registry_version\` = ?
  AND \`handler_descriptor_digest\` = ?
  AND \`handler_source_digest\` = ?
  AND \`handler_registration_digest\` = ?`;

const GAP_HEAD_LOCK_SQL = `/* inbox_checkpoint:gap_head_lock */
SELECT ${RECEIPT_COLUMN_LIST}
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` >= ?
ORDER BY \`partition_position\`, \`inbox_receipt_id\`
LIMIT 1
FOR UPDATE`;

const CHECKPOINT_STATE_UPDATE_SQL = `/* inbox_checkpoint:checkpoint_state_update */
UPDATE \`consumer_checkpoint\`
SET \`high_watermark_position\` = ?,
    \`state_generation\` = \`state_generation\` + 1,
    \`checkpoint_transition_id\` = ?,
    \`gap_status\` = ?,
    \`gap_from_position\` = ?,
    \`gap_to_position\` = ?,
    \`gap_reason_code\` = ?,
    \`blocked_receipt_id\` = ?,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`consumer_checkpoint_id\` = ?
  AND \`state_generation\` = ?
  AND \`last_contiguous_position\` = ?
  AND \`high_watermark_position\` = ?
  AND \`handler_version\` = ?`;

const CLAIM_HEAD_LOCK_SQL = `/* inbox_checkpoint:claim_head_lock */
SELECT ${RECEIPT_COLUMN_LIST},
       (\`status\` <> 'RETRY_PENDING' OR \`next_retry_at\` <= CURRENT_TIMESTAMP(3)) AS \`retry_due\`
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
LIMIT 1
FOR UPDATE`;

const CLAIM_UPDATE_SQL = `/* inbox_checkpoint:claim_update */
UPDATE \`inbox_receipt\`
SET \`status\` = 'CLAIMED',
    \`attempt_count\` = \`attempt_count\` + 1,
    \`lease_generation\` = \`lease_generation\` + 1,
    \`lease_owner\` = ?,
    \`lease_expires_at\` = TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)),
    \`inbox_transition_id\` = ?,
    \`next_retry_at\` = NULL,
    \`error_json\` = NULL,
    \`started_at\` = CURRENT_TIMESTAMP(3),
    \`failed_at\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = ?
  AND \`attempt_count\` = ?
  AND \`max_attempts\` = ?
  AND \`attempt_count\` < \`max_attempts\`
  AND \`lease_generation\` = ?
  AND \`retry_policy_version\` = ?
  AND \`lease_owner\` IS NULL
  AND \`lease_expires_at\` IS NULL
  AND \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`event_id\` = ?
  AND \`payload_digest\` = ?
  AND \`handler_id\` = ?
  AND \`handler_registry_version\` = ?
  AND \`handler_descriptor_digest\` = ?
  AND \`handler_source_digest\` = ?
  AND \`handler_registration_digest\` = ?
  AND (
    \`status\` = 'RECEIVED'
    OR (\`status\` = 'RETRY_PENDING' AND \`next_retry_at\` <= CURRENT_TIMESTAMP(3))
  )`;

const CLAIM_READ_SQL = `/* inbox_checkpoint:claim_read */
SELECT ${RECEIPT_COLUMN_LIST},
       (\`lease_expires_at\` > CURRENT_TIMESTAMP(3)) AS \`lease_active\`
FROM \`inbox_receipt\`
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`inbox_transition_id\` = ?
LIMIT 1
FOR UPDATE`;

const CLAIM_TRANSITION_READ_SQL = `/* inbox_checkpoint:claim_transition_read */
SELECT ${RECEIPT_COLUMN_LIST},
       (\`lease_expires_at\` > CURRENT_TIMESTAMP(3)) AS \`lease_active\`
FROM \`inbox_receipt\`
WHERE \`consumer_name\` = ?
  AND \`lease_owner\` = ?
  AND \`inbox_transition_id\` = ?
  AND \`status\` = 'CLAIMED'
ORDER BY \`inbox_receipt_id\``;

const OWNED_LOCK_SQL = `/* inbox_checkpoint:owned_lock */
SELECT ${RECEIPT_COLUMN_LIST},
       (\`lease_expires_at\` > CURRENT_TIMESTAMP(3)) AS \`lease_active\`
FROM \`inbox_receipt\`
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`inbox_transition_id\` = ?
LIMIT 1
FOR UPDATE`;

const COMPLETE_UPDATE_SQL = `/* inbox_checkpoint:complete_update */
UPDATE \`inbox_receipt\`
SET \`status\` = 'SUCCEEDED',
    \`inbox_transition_id\` = ?,
    \`result_json\` = CAST(? AS JSON),
    \`result_codec_version\` = ?,
    \`result_key_id\` = ?,
    \`result_digest_scheme\` = ?,
    \`result_digest\` = ?,
    \`completion_manifest_digest\` = ?,
    \`completion_manifest_digest_scheme\` = ?,
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`next_retry_at\` = NULL,
    \`error_json\` = NULL,
    \`completed_at\` = CURRENT_TIMESTAMP(3),
    \`failed_at\` = NULL,
    \`dead_lettered_at\` = NULL,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`inbox_transition_id\` = ?
  AND \`lease_expires_at\` > CURRENT_TIMESTAMP(3)
  AND \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`event_id\` = ?
  AND \`payload_digest\` = ?
  AND \`handler_id\` = ?
  AND \`handler_registry_version\` = ?
  AND \`handler_descriptor_digest\` = ?
  AND \`handler_source_digest\` = ?
  AND \`handler_registration_digest\` = ?`;

const CHECKPOINT_COMPLETE_UPDATE_SQL = `/* inbox_checkpoint:checkpoint_complete_update */
UPDATE \`consumer_checkpoint\`
SET \`last_contiguous_position\` = ?,
    \`high_watermark_position\` = ?,
    \`state_generation\` = \`state_generation\` + 1,
    \`checkpoint_transition_id\` = ?,
    \`gap_status\` = ?,
    \`gap_from_position\` = ?,
    \`gap_to_position\` = ?,
    \`gap_reason_code\` = ?,
    \`blocked_receipt_id\` = ?,
    \`last_event_id\` = ?,
    \`last_receipt_id\` = ?,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`consumer_checkpoint_id\` = ?
  AND \`state_generation\` = ?
  AND \`last_contiguous_position\` = ?
  AND \`high_watermark_position\` = ?
  AND \`handler_version\` = ?`;

const RETRY_UPDATE_SQL = `/* inbox_checkpoint:retry_update */
UPDATE \`inbox_receipt\`
SET \`status\` = 'RETRY_PENDING',
    \`retry_policy_version\` = ?,
    \`next_retry_at\` = TIMESTAMPADD(MICROSECOND, ?, CURRENT_TIMESTAMP(3)),
    \`inbox_transition_id\` = ?,
    \`error_json\` = CAST(? AS JSON),
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`failed_at\` = CURRENT_TIMESTAMP(3),
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`inbox_transition_id\` = ?
  AND \`lease_expires_at\` > CURRENT_TIMESTAMP(3)
  AND \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`event_id\` = ?
  AND \`payload_digest\` = ?
  AND \`handler_id\` = ?
  AND \`handler_registry_version\` = ?
  AND \`handler_descriptor_digest\` = ?
  AND \`handler_source_digest\` = ?
  AND \`handler_registration_digest\` = ?`;

const RECOVERY_RETRY_UPDATE_SQL = RETRY_UPDATE_SQL.replace(
  "/* inbox_checkpoint:retry_update */",
  "/* inbox_checkpoint:recovery_retry_update */"
).replace(
  "AND `lease_expires_at` > CURRENT_TIMESTAMP(3)",
  "AND `lease_expires_at` <= CURRENT_TIMESTAMP(3)"
);

const DEAD_INSERT_SQL = `/* inbox_checkpoint:dead_insert */
INSERT INTO \`event_dead_letter\` (
  \`event_dead_letter_id\`, \`direction\`, \`source_record_id\`,
  \`source_lease_generation\`, \`source_transition_id\`, \`consumer_name\`,
  \`source_name\`, \`partition_key\`, \`partition_position\`, \`event_id\`,
  \`event_type\`, \`payload_json\`, \`payload_digest\`, \`status\`,
  \`attempt_count\`, \`reason_code\`, \`error_json\`, \`next_retry_at\`,
  \`replay_request_id\`, \`release_id\`, \`first_failed_at\`, \`last_failed_at\`,
  \`resolved_at\`, \`resolved_by\`, \`created_at\`, \`updated_at\`
) VALUES (
  ?, 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'OPEN', ?, ?, CAST(? AS JSON),
  NULL, NULL, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL, NULL,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
)`;

const DEAD_READ_SQL = `/* inbox_checkpoint:dead_read */
SELECT * FROM \`event_dead_letter\`
WHERE \`direction\` = 'INBOX' AND \`source_record_id\` = ?
LIMIT 1
FOR UPDATE`;

const DEAD_VERIFY_SQL = `/* inbox_checkpoint:dead_verify */
SELECT * FROM \`event_dead_letter\`
WHERE \`direction\` = 'INBOX' AND \`source_record_id\` = ?
LIMIT 1`;

const DEAD_UPDATE_SQL = `/* inbox_checkpoint:dead_update */
UPDATE \`inbox_receipt\`
SET \`status\` = 'DEAD_LETTER',
    \`inbox_transition_id\` = ?,
    \`error_json\` = CAST(? AS JSON),
    \`lease_owner\` = NULL,
    \`lease_expires_at\` = NULL,
    \`next_retry_at\` = NULL,
    \`failed_at\` = CURRENT_TIMESTAMP(3),
    \`dead_lettered_at\` = CURRENT_TIMESTAMP(3),
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`inbox_receipt_id\` = ?
  AND \`status\` = 'CLAIMED'
  AND \`lease_owner\` = ?
  AND \`lease_generation\` = ?
  AND \`inbox_transition_id\` = ?
  AND \`lease_expires_at\` > CURRENT_TIMESTAMP(3)
  AND \`consumer_name\` = ?
  AND \`source_name\` = ?
  AND \`partition_key\` = ?
  AND \`partition_position\` = ?
  AND \`event_id\` = ?
  AND \`payload_digest\` = ?
  AND \`handler_id\` = ?
  AND \`handler_registry_version\` = ?
  AND \`handler_descriptor_digest\` = ?
  AND \`handler_source_digest\` = ?
  AND \`handler_registration_digest\` = ?`;

const RECOVERY_DEAD_UPDATE_SQL = DEAD_UPDATE_SQL.replace(
  "/* inbox_checkpoint:dead_update */",
  "/* inbox_checkpoint:recovery_dead_update */"
).replace(
  "AND `lease_expires_at` > CURRENT_TIMESTAMP(3)",
  "AND `lease_expires_at` <= CURRENT_TIMESTAMP(3)"
);

const CHECKPOINT_DEAD_UPDATE_SQL = `/* inbox_checkpoint:checkpoint_dead_update */
UPDATE \`consumer_checkpoint\`
SET \`state_generation\` = \`state_generation\` + 1,
    \`checkpoint_transition_id\` = ?,
    \`gap_status\` = 'BLOCKED_DEAD_LETTER',
    \`gap_from_position\` = ?,
    \`gap_to_position\` = ?,
    \`gap_reason_code\` = 'INBOX_DEAD_LETTER',
    \`blocked_receipt_id\` = ?,
    \`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE \`consumer_checkpoint_id\` = ?
  AND \`state_generation\` = ?
  AND \`last_contiguous_position\` = ?
  AND \`high_watermark_position\` = ?
  AND \`handler_version\` = ?`;

const TRANSITION_READ_SQL = `/* inbox_checkpoint:transition_read */
SELECT ${RECEIPT_COLUMN_LIST}
FROM \`inbox_receipt\`
WHERE \`inbox_receipt_id\` = ?
LIMIT 1`;

const COMPLETION_OUTBOX_READ_SQL = `/* inbox_checkpoint:completion_outbox_read */
SELECT *
FROM \`outbox_event\`
WHERE \`outbox_event_id\` = ?
LIMIT 1`;

function inboxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidInput() {
  return inboxError("INBOX_CHECKPOINT_INPUT_INVALID", "inbox checkpoint input is invalid");
}

function invalidRow() {
  return inboxError("INBOX_CHECKPOINT_ROW_INVALID", "inbox checkpoint row is invalid");
}

function configurationError() {
  return inboxError("INBOX_CHECKPOINT_CONFIGURATION_INVALID", "inbox checkpoint configuration is invalid");
}

function persistenceFailure() {
  return inboxError("INBOX_CHECKPOINT_PERSISTENCE_FAILED", "inbox checkpoint persistence failed");
}

function leaseLost() {
  return inboxError("INBOX_CHECKPOINT_LEASE_LOST", "inbox checkpoint lease was lost");
}

function envelopeConflict() {
  return inboxError("INBOX_CHECKPOINT_ENVELOPE_CONFLICT", "inbox checkpoint envelope conflicts with persisted facts");
}

function deadLetterConflict() {
  return inboxError("INBOX_CHECKPOINT_DEAD_LETTER_CONFLICT", "inbox dead letter conflicts with persisted facts");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function nullableByteEqual(left, right) {
  return left === null && right === null ? true : byteEqual(left, right);
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function integer(value, { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0) || number > maximum) throw invalidRow();
  return number;
}

function inputInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalidInput();
  return value;
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

function jsonSnapshot(value, failure = invalidInput) {
  try {
    return payloadSnapshot(value);
  } catch {
    throw failure();
  }
}

function boundedJsonSnapshot(value, maximumBytes, failure = invalidInput) {
  const snapshot = jsonSnapshot(value, failure);
  let serialized;
  try { serialized = JSON.stringify(snapshot.payload); } catch { throw failure(); }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) throw failure();
  const pending = [{ value: snapshot.payload, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw failure();
    if (!current.value || typeof current.value !== "object") continue;
    for (const child of Object.values(current.value)) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return snapshot;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw invalidRow();
  }
}

function mysqlDateTime(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw invalidInput();
    return new Date(value.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 23).replace("T", " ");
  }
  if (typeof value !== "string" || value !== value.trim()) throw invalidInput();
  const normalized = value.replace(" ", "T");
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
  const wallClockMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  const validWallClock = (match) => {
    if (!match) return false;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    if (year < 1000 || year > 9999) return false;
    const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return candidate.getUTCFullYear() === year
      && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day
      && candidate.getUTCHours() === hour
      && candidate.getUTCMinutes() === minute
      && candidate.getUTCSeconds() === second;
  };
  if (!hasOffset && validWallClock(wallClockMatch)) {
    const candidate = normalized.replace("T", " ");
    return candidate.includes(".") ? candidate.padEnd(23, "0") : `${candidate}.000`;
  }
  const date = new Date(normalized);
  const offsetWallClock = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!hasOffset || !validWallClock(offsetWallClock) || !Number.isFinite(date.getTime())) throw invalidInput();
  return new Date(date.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 23).replace("T", " ");
}

function validStatementParameter(rule, value) {
  if (!plainRecord(rule)) return false;
  if (value === null) return rule.nullable === true;
  if (rule.type === "INTEGER") {
    return Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum;
  }
  if (typeof value !== "string"
    || value.length === 0
    || value.length > rule.maximumLength
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (rule.type === "SHA256") return /^[a-f0-9]{64}$/.test(value);
  if (rule.type === "MYSQL_DATETIME") {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) return false;
    try { return mysqlDateTime(value) === value; } catch { return false; }
  }
  return rule.type === "TEXT";
}

function matchesStatementExecutionProfile(statementIds, profiles) {
  if (!Array.isArray(statementIds) || !Array.isArray(profiles)) return false;
  const key = statementIds.join("\0");
  return profiles.some((profile) => profile.join("\0") === key);
}

function deterministicId(prefix, ...parts) {
  const hash = crypto.createHash("sha256");
  hash.update(`myroot-${prefix}:v1\0`);
  for (const part of parts) hash.update(String(part)).update("\0");
  return `${prefix}_${hash.digest("hex").slice(0, 63 - prefix.length)}`;
}

function duplicateEntry(error) {
  return Boolean(error && (error.code === "ER_DUP_ENTRY" || Number(error.errno) === 1062));
}

function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw persistenceFailure();
  return rows;
}

function affectedRows(result) {
  const header = Array.isArray(result) ? result[0] : null;
  if (!header || !Number.isSafeInteger(header.affectedRows)) throw persistenceFailure();
  return header.affectedRows;
}

const ENVELOPE_KEYS = Object.freeze([
  "eventId",
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
  "payload",
  "payloadDigest",
]);

function normalizeEnvelope(input) {
  if (!exactKeys(input, ENVELOPE_KEYS)) throw invalidInput();
  const payloadSnapshotValue = boundedJsonSnapshot(input.payload, MAX_INBOX_PAYLOAD_BYTES);
  const payload = payloadSnapshotValue.payload;
  const digest = payloadSnapshotValue.digest;
  if (!exactText(input.eventId, 64)
    || !exactText(input.eventType, 128)
    || !opaqueAscii(input.schemaVersion, 32)
    || !exactText(input.sourceName, 96)
    || !exactText(input.partitionKey, 191)
    || !exactText(input.aggregateType, 96)
    || !exactText(input.aggregateId, 191)
    || !opaqueAscii(input.producerVersion, 64)
    || !exactText(input.idempotencyKey, 191)
    || !/^[a-f0-9]{64}$/.test(input.payloadDigest)
    || !byteEqual(digest, input.payloadDigest)
    || !(input.correlationId === null || exactText(input.correlationId, 128))
    || !(input.causationId === null || exactText(input.causationId, 128))) {
    throw invalidInput();
  }
  const envelope = {
    eventId: input.eventId,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion,
    sourceName: input.sourceName,
    partitionKey: input.partitionKey,
    partitionPosition: inputInteger(input.partitionPosition, 1, Number.MAX_SAFE_INTEGER),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: inputInteger(input.aggregateVersion, 1, Number.MAX_SAFE_INTEGER),
    occurredAt: mysqlDateTime(input.occurredAt),
    producerVersion: input.producerVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey,
    payload,
    payloadDigest: input.payloadDigest,
  };
  return deepFreeze(envelope);
}

function assertRegistrationEnvelope(registration, envelope, failure = invalidInput) {
  const descriptor = registration.descriptor;
  if (!byteEqual(envelope.sourceName, descriptor.sourceName)
    || !byteEqual(envelope.eventType, descriptor.eventType)
    || !byteEqual(envelope.schemaVersion, descriptor.schemaVersion)
    || !byteEqual(envelope.aggregateType, descriptor.aggregateType)) throw failure();
}

function payloadContentBinding(input) {
  return {
    consumerName: input.consumer_name,
    handlerVersion: input.handler_version,
    handlerId: input.handler_id,
    handlerRegistryVersion: input.handler_registry_version,
    handlerDescriptorDigest: input.handler_descriptor_digest,
    handlerSourceDigest: input.handler_source_digest,
    handlerRegistrationDigest: input.handler_registration_digest,
    sourceName: input.source_name,
    partitionKey: input.partition_key,
    partitionPosition: input.partition_position,
    eventId: input.event_id,
    eventType: input.event_type,
    schemaVersion: input.schema_version,
    aggregateType: input.aggregate_type,
    aggregateId: input.aggregate_id,
    aggregateVersion: input.aggregate_version,
    occurredAt: input.occurred_at,
    producerVersion: input.producer_version,
    correlationId: input.correlation_id,
    causationId: input.causation_id,
    idempotencyKey: input.idempotency_key,
  };
}

function resultContentBinding(input) {
  return {
    ...payloadContentBinding(input),
    receiptId: input.inbox_receipt_id,
    leaseGeneration: input.lease_generation,
    completionTransitionId: input.inbox_transition_id,
  };
}

function envelopePersistenceRow(envelope, registration) {
  const descriptor = registration.descriptor;
  return {
    consumer_name: descriptor.consumerName,
    handler_version: descriptor.handlerVersion,
    handler_id: descriptor.handlerId,
    handler_registry_version: registration.registryVersion,
    handler_descriptor_digest: descriptor.descriptorDigest,
    handler_source_digest: descriptor.sourceDigest,
    handler_registration_digest: registration.registrationDigest,
    source_name: envelope.sourceName,
    partition_key: envelope.partitionKey,
    partition_position: envelope.partitionPosition,
    event_id: envelope.eventId,
    event_type: envelope.eventType,
    schema_version: envelope.schemaVersion,
    aggregate_type: envelope.aggregateType,
    aggregate_id: envelope.aggregateId,
    aggregate_version: envelope.aggregateVersion,
    occurred_at: envelope.occurredAt,
    producer_version: envelope.producerVersion,
    correlation_id: envelope.correlationId,
    causation_id: envelope.causationId,
    idempotency_key: envelope.idempotencyKey,
  };
}

function normalizeReceiptRow(input, contentCodec, registration) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidRow();
  const storedPayload = parseJson(input.payload_json);
  const storedResult = input.result_json === null ? null : parseJson(input.result_json);
  const error = input.error_json === null ? null : parseJson(input.error_json);
  const row = {
    inbox_receipt_id: exactText(input.inbox_receipt_id, 64) ? input.inbox_receipt_id : (() => { throw invalidRow(); })(),
    consumer_name: exactText(input.consumer_name, 128) ? input.consumer_name : (() => { throw invalidRow(); })(),
    source_name: exactText(input.source_name, 96) ? input.source_name : (() => { throw invalidRow(); })(),
    partition_key: exactText(input.partition_key, 191) ? input.partition_key : (() => { throw invalidRow(); })(),
    partition_position: integer(input.partition_position, { positive: true }),
    event_id: exactText(input.event_id, 64) ? input.event_id : (() => { throw invalidRow(); })(),
    event_type: exactText(input.event_type, 128) ? input.event_type : (() => { throw invalidRow(); })(),
    schema_version: exactText(input.schema_version, 32) ? input.schema_version : (() => { throw invalidRow(); })(),
    aggregate_type: exactText(input.aggregate_type, 96) ? input.aggregate_type : (() => { throw invalidRow(); })(),
    aggregate_id: exactText(input.aggregate_id, 191) ? input.aggregate_id : (() => { throw invalidRow(); })(),
    aggregate_version: integer(input.aggregate_version, { positive: true }),
    occurred_at: exactText(input.occurred_at, 64) ? input.occurred_at : (() => { throw invalidRow(); })(),
    producer_version: exactText(input.producer_version, 64) ? input.producer_version : (() => { throw invalidRow(); })(),
    correlation_id: input.correlation_id === null ? null : (exactText(input.correlation_id, 128) ? input.correlation_id : (() => { throw invalidRow(); })()),
    causation_id: input.causation_id === null ? null : (exactText(input.causation_id, 128) ? input.causation_id : (() => { throw invalidRow(); })()),
    idempotency_key: exactText(input.idempotency_key, 191) ? input.idempotency_key : (() => { throw invalidRow(); })(),
    handler_version: exactText(input.handler_version, 64) ? input.handler_version : (() => { throw invalidRow(); })(),
    handler_id: exactText(input.handler_id, 96) ? input.handler_id : (() => { throw invalidRow(); })(),
    handler_registry_version: integer(input.handler_registry_version, { positive: true, maximum: 0xFFFFFFFF }),
    handler_descriptor_digest: exactText(input.handler_descriptor_digest, 64) ? input.handler_descriptor_digest : (() => { throw invalidRow(); })(),
    handler_source_digest: exactText(input.handler_source_digest, 64) ? input.handler_source_digest : (() => { throw invalidRow(); })(),
    handler_registration_digest: exactText(input.handler_registration_digest, 64) ? input.handler_registration_digest : (() => { throw invalidRow(); })(),
    payload_json: null,
    payload_codec_version: exactText(input.payload_codec_version, 32) ? input.payload_codec_version : (() => { throw invalidRow(); })(),
    payload_key_id: exactText(input.payload_key_id, 64) ? input.payload_key_id : (() => { throw invalidRow(); })(),
    payload_digest_scheme: exactText(input.payload_digest_scheme, 32) ? input.payload_digest_scheme : (() => { throw invalidRow(); })(),
    payload_digest: exactText(input.payload_digest, 64) ? input.payload_digest : (() => { throw invalidRow(); })(),
    status: SUPPORTED_STATUSES.includes(input.status) ? input.status : (() => { throw invalidRow(); })(),
    attempt_count: integer(input.attempt_count),
    max_attempts: integer(input.max_attempts, { positive: true }),
    retry_policy_version: exactText(input.retry_policy_version, 64) ? input.retry_policy_version : (() => { throw invalidRow(); })(),
    next_retry_at: input.next_retry_at === null ? null : (exactText(input.next_retry_at, 64) ? input.next_retry_at : (() => { throw invalidRow(); })()),
    lease_owner: input.lease_owner === null ? null : (exactText(input.lease_owner, 128) ? input.lease_owner : (() => { throw invalidRow(); })()),
    lease_expires_at: input.lease_expires_at === null ? null : (exactText(input.lease_expires_at, 64) ? input.lease_expires_at : (() => { throw invalidRow(); })()),
    lease_generation: integer(input.lease_generation),
    inbox_transition_id: input.inbox_transition_id === null ? null : (exactText(input.inbox_transition_id, 128) ? input.inbox_transition_id : (() => { throw invalidRow(); })()),
    result_json: null,
    result_codec_version: input.result_codec_version === null ? null : (exactText(input.result_codec_version, 32) ? input.result_codec_version : (() => { throw invalidRow(); })()),
    result_key_id: input.result_key_id === null ? null : (exactText(input.result_key_id, 64) ? input.result_key_id : (() => { throw invalidRow(); })()),
    result_digest_scheme: input.result_digest_scheme === null ? null : (exactText(input.result_digest_scheme, 32) ? input.result_digest_scheme : (() => { throw invalidRow(); })()),
    result_digest: input.result_digest === null ? null : (exactText(input.result_digest, 64) ? input.result_digest : (() => { throw invalidRow(); })()),
    completion_manifest_digest: input.completion_manifest_digest === null ? null : (exactText(input.completion_manifest_digest, 64) ? input.completion_manifest_digest : (() => { throw invalidRow(); })()),
    completion_manifest_digest_scheme: input.completion_manifest_digest_scheme === null ? null : (exactText(input.completion_manifest_digest_scheme, 32) ? input.completion_manifest_digest_scheme : (() => { throw invalidRow(); })()),
    error_json: error === null ? null : clone(error),
    first_received_at: exactText(input.first_received_at, 64) ? input.first_received_at : (() => { throw invalidRow(); })(),
    last_received_at: exactText(input.last_received_at, 64) ? input.last_received_at : (() => { throw invalidRow(); })(),
    started_at: input.started_at === null ? null : (exactText(input.started_at, 64) ? input.started_at : (() => { throw invalidRow(); })()),
    completed_at: input.completed_at === null ? null : (exactText(input.completed_at, 64) ? input.completed_at : (() => { throw invalidRow(); })()),
    failed_at: input.failed_at === null ? null : (exactText(input.failed_at, 64) ? input.failed_at : (() => { throw invalidRow(); })()),
    dead_lettered_at: input.dead_lettered_at === null ? null : (exactText(input.dead_lettered_at, 64) ? input.dead_lettered_at : (() => { throw invalidRow(); })()),
    updated_at: exactText(input.updated_at, 64) ? input.updated_at : (() => { throw invalidRow(); })(),
  };
  const descriptor = registration.descriptor;
  if (!byteEqual(row.consumer_name, descriptor.consumerName)
    || !byteEqual(row.handler_version, descriptor.handlerVersion)
    || !byteEqual(row.handler_id, descriptor.handlerId)
    || row.handler_registry_version !== registration.registryVersion
    || !byteEqual(row.handler_descriptor_digest, descriptor.descriptorDigest)
    || !byteEqual(row.handler_source_digest, descriptor.sourceDigest)
    || !byteEqual(row.handler_registration_digest, registration.registrationDigest)
    || !byteEqual(row.source_name, descriptor.sourceName)
    || !byteEqual(row.event_type, descriptor.eventType)
    || !byteEqual(row.schema_version, descriptor.schemaVersion)
    || !byteEqual(row.aggregate_type, descriptor.aggregateType)
    || !/^[a-f0-9]{64}$/.test(row.handler_descriptor_digest)
    || !/^[a-f0-9]{64}$/.test(row.handler_source_digest)
    || !/^[a-f0-9]{64}$/.test(row.handler_registration_digest)) throw invalidRow();
  let openedPayload;
  try {
    openedPayload = contentCodec.open(storedPayload, {
      purpose: "PAYLOAD",
      binding: payloadContentBinding(row),
    });
  } catch {
    throw invalidRow();
  }
  const payloadSnapshotValue = boundedJsonSnapshot(openedPayload.value, MAX_INBOX_PAYLOAD_BYTES, invalidRow);
  row.payload_json = clone(payloadSnapshotValue.payload);
  row.payload_transport_digest = payloadSnapshotValue.digest;
  row.payload_protection_key_id = openedPayload.keyId;
  row.payload_protected = openedPayload.protected;
  if (openedPayload.protected !== true
    || openedPayload.codecVersion !== INBOX_CONTENT_CODEC_VERSION
    || openedPayload.codecVersion !== row.payload_codec_version
    || openedPayload.keyId !== row.payload_key_id
    || openedPayload.digestScheme !== INBOX_CONTENT_DIGEST_SCHEME
    || openedPayload.digestScheme !== row.payload_digest_scheme) throw invalidRow();
  if ((row.status === "SUCCEEDED") !== (storedResult !== null)) throw invalidRow();
  if (storedResult !== null) {
    let openedResult;
    try {
      openedResult = contentCodec.open(storedResult, {
        purpose: "RESULT",
        binding: resultContentBinding(row),
      });
    } catch {
      throw invalidRow();
    }
    const resultSnapshotValue = boundedJsonSnapshot(openedResult.value, MAX_PERSISTED_RESULT_BYTES, invalidRow);
    row.result_json = clone(resultSnapshotValue.payload);
    row.result_protection_key_id = openedResult.keyId;
    row.result_protected = openedResult.protected;
    row.result_content_digest = openedResult.contentDigest;
    if (openedResult.protected !== true
      || openedResult.codecVersion !== INBOX_CONTENT_CODEC_VERSION
      || openedResult.codecVersion !== row.result_codec_version
      || openedResult.keyId !== row.result_key_id
      || openedResult.digestScheme !== INBOX_CONTENT_DIGEST_SCHEME
      || openedResult.digestScheme !== row.result_digest_scheme
      || row.completion_manifest_digest_scheme !== INBOX_CONTENT_DIGEST_SCHEME) throw invalidRow();
  } else {
    row.result_protection_key_id = null;
    row.result_protected = false;
    row.result_content_digest = null;
    if (row.result_codec_version !== null
      || row.result_key_id !== null
      || row.result_digest_scheme !== null
      || row.result_digest !== null
      || row.completion_manifest_digest !== null
      || row.completion_manifest_digest_scheme !== null) throw invalidRow();
  }
  if (row.attempt_count > row.max_attempts
    || !/^[a-f0-9]{64}$/.test(row.payload_digest)
    || !byteEqual(openedPayload.contentDigest, row.payload_digest)
    || (row.result_json !== null && (!/^[a-f0-9]{64}$/.test(row.result_digest)
      || !/^[a-f0-9]{64}$/.test(row.completion_manifest_digest)
      || !byteEqual(row.result_content_digest, row.result_digest)))) throw invalidRow();
  return row;
}

function normalizeCheckpointRow(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidRow();
  const checkpoint = {
    checkpointId: exactText(input.consumer_checkpoint_id, 64) ? input.consumer_checkpoint_id : (() => { throw invalidRow(); })(),
    consumerName: exactText(input.consumer_name, 128) ? input.consumer_name : (() => { throw invalidRow(); })(),
    sourceName: exactText(input.source_name, 96) ? input.source_name : (() => { throw invalidRow(); })(),
    partitionKey: exactText(input.partition_key, 191) ? input.partition_key : (() => { throw invalidRow(); })(),
    lastContiguousPosition: integer(input.last_contiguous_position),
    highWatermarkPosition: integer(input.high_watermark_position),
    stateGeneration: integer(input.state_generation),
    checkpointTransitionId: input.checkpoint_transition_id === null ? null : (exactText(input.checkpoint_transition_id, 128) ? input.checkpoint_transition_id : (() => { throw invalidRow(); })()),
    gapStatus: ["CLEAR", "MISSING", "BLOCKED_DEAD_LETTER", "REVIEW_REQUIRED"].includes(input.gap_status) ? input.gap_status : (() => { throw invalidRow(); })(),
    gapFromPosition: input.gap_from_position === null ? null : integer(input.gap_from_position, { positive: true }),
    gapToPosition: input.gap_to_position === null ? null : integer(input.gap_to_position, { positive: true }),
    gapReasonCode: input.gap_reason_code === null ? null : (exactText(input.gap_reason_code, 64) ? input.gap_reason_code : (() => { throw invalidRow(); })()),
    blockedReceiptId: input.blocked_receipt_id === null ? null : (exactText(input.blocked_receipt_id, 64) ? input.blocked_receipt_id : (() => { throw invalidRow(); })()),
    handlerVersion: exactText(input.handler_version, 64) ? input.handler_version : (() => { throw invalidRow(); })(),
    lastEventId: input.last_event_id === null ? null : (exactText(input.last_event_id, 64) ? input.last_event_id : (() => { throw invalidRow(); })()),
    lastReceiptId: input.last_receipt_id === null ? null : (exactText(input.last_receipt_id, 64) ? input.last_receipt_id : (() => { throw invalidRow(); })()),
    createdAt: exactText(input.created_at, 64) ? input.created_at : (() => { throw invalidRow(); })(),
    updatedAt: exactText(input.updated_at, 64) ? input.updated_at : (() => { throw invalidRow(); })(),
  };
  if (checkpoint.lastContiguousPosition > checkpoint.highWatermarkPosition) throw invalidRow();
  return deepFreeze(checkpoint);
}

function envelopeFromRow(row) {
  return deepFreeze({
    eventId: row.event_id,
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
    payload: clone(row.payload_json),
    payloadDigest: row.payload_transport_digest,
  });
}

function assertEnvelopeMatchesRow(envelope, row) {
  if (!byteEqual(envelope.eventId, row.event_id)
    || !byteEqual(envelope.eventType, row.event_type)
    || !byteEqual(envelope.schemaVersion, row.schema_version)
    || !byteEqual(envelope.sourceName, row.source_name)
    || !byteEqual(envelope.partitionKey, row.partition_key)
    || envelope.partitionPosition !== row.partition_position
    || !byteEqual(envelope.aggregateType, row.aggregate_type)
    || !byteEqual(envelope.aggregateId, row.aggregate_id)
    || envelope.aggregateVersion !== row.aggregate_version
    || !byteEqual(envelope.occurredAt, row.occurred_at)
    || !byteEqual(envelope.producerVersion, row.producer_version)
    || !nullableByteEqual(envelope.correlationId, row.correlation_id)
    || !nullableByteEqual(envelope.causationId, row.causation_id)
    || !byteEqual(envelope.idempotencyKey, row.idempotency_key)
    || !byteEqual(envelope.payloadDigest, row.payload_transport_digest)) {
    throw envelopeConflict();
  }
}

function identityValues(row) {
  return [
    row.consumer_name,
    row.source_name,
    row.partition_key,
    row.partition_position,
    row.event_id,
    row.payload_digest,
    row.handler_id,
    row.handler_registry_version,
    row.handler_descriptor_digest,
    row.handler_source_digest,
    row.handler_registration_digest,
  ];
}

function claimFromRow(row) {
  if (row.status !== "CLAIMED"
    || !opaqueAscii(row.lease_owner, 128)
    || !opaqueAscii(row.inbox_transition_id, 128)
    || row.attempt_count < 1
    || row.lease_generation < 1) throw invalidRow();
  return deepFreeze({
    receiptId: row.inbox_receipt_id,
    consumerName: row.consumer_name,
    handlerVersion: row.handler_version,
    leaseOwner: row.lease_owner,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicyVersion: row.retry_policy_version,
    claimTransitionId: row.inbox_transition_id,
    payloadDigest: row.payload_transport_digest,
    envelope: envelopeFromRow(row),
  });
}

const CLAIM_KEYS = Object.freeze([
  "receiptId",
  "consumerName",
  "handlerVersion",
  "leaseOwner",
  "leaseGeneration",
  "attemptCount",
  "maxAttempts",
  "retryPolicyVersion",
  "claimTransitionId",
  "payloadDigest",
  "envelope",
]);

function normalizeClaim(input) {
  if (!exactKeys(input, CLAIM_KEYS)) throw invalidInput();
  const envelope = normalizeEnvelope(input.envelope);
  if (!exactText(input.receiptId, 64)
    || !exactText(input.consumerName, 128)
    || !opaqueAscii(input.handlerVersion, 64)
    || !opaqueAscii(input.leaseOwner, 128)
    || !opaqueAscii(input.claimTransitionId, 128)
    || !opaqueAscii(input.retryPolicyVersion, 64)
    || !/^[a-f0-9]{64}$/.test(input.payloadDigest)
    || !byteEqual(input.payloadDigest, envelope.payloadDigest)) throw invalidInput();
  return deepFreeze({
    receiptId: input.receiptId,
    consumerName: input.consumerName,
    handlerVersion: input.handlerVersion,
    leaseOwner: input.leaseOwner,
    leaseGeneration: inputInteger(input.leaseGeneration, 1, Number.MAX_SAFE_INTEGER),
    attemptCount: inputInteger(input.attemptCount, 1, 0xFFFFFFFF),
    maxAttempts: inputInteger(input.maxAttempts, input.attemptCount, 0xFFFFFFFF),
    retryPolicyVersion: input.retryPolicyVersion,
    claimTransitionId: input.claimTransitionId,
    payloadDigest: input.payloadDigest,
    envelope,
  });
}

function assertClaimMatchesRow(claim, row) {
  assertEnvelopeMatchesRow(claim.envelope, row);
  if (!byteEqual(claim.receiptId, row.inbox_receipt_id)
    || !byteEqual(claim.consumerName, row.consumer_name)
    || !byteEqual(claim.handlerVersion, row.handler_version)
    || !byteEqual(claim.leaseOwner, row.lease_owner)
    || claim.leaseGeneration !== row.lease_generation
    || claim.attemptCount !== row.attempt_count
    || claim.maxAttempts !== row.max_attempts
    || !byteEqual(claim.retryPolicyVersion, row.retry_policy_version)
    || !byteEqual(claim.claimTransitionId, row.inbox_transition_id)
    || !byteEqual(claim.payloadDigest, row.payload_transport_digest)) throw leaseLost();
}

function assertTerminalClaimIdentity(claim, row) {
  assertEnvelopeMatchesRow(claim.envelope, row);
  if (!byteEqual(claim.receiptId, row.inbox_receipt_id)
    || !byteEqual(claim.consumerName, row.consumer_name)
    || !byteEqual(claim.handlerVersion, row.handler_version)
    || claim.leaseGeneration !== row.lease_generation
    || claim.attemptCount !== row.attempt_count
    || claim.maxAttempts !== row.max_attempts
    || !byteEqual(claim.retryPolicyVersion, row.retry_policy_version)
    || !byteEqual(claim.payloadDigest, row.payload_transport_digest)) throw invalidRow();
}

function assertTerminalShape(row) {
  if (row.lease_owner !== null || row.lease_expires_at !== null) throw invalidRow();
  if (row.status === "SUCCEEDED") {
    if (row.completed_at === null
      || row.result_json === null
      || row.result_digest === null
      || row.completion_manifest_digest === null
      || row.next_retry_at !== null
      || row.error_json !== null
      || row.dead_lettered_at !== null) throw invalidRow();
    return;
  }
  if (row.status === "RETRY_PENDING") {
    if (row.next_retry_at === null
      || row.failed_at === null
      || row.error_json === null
      || row.completed_at !== null
      || row.result_json !== null
      || row.result_digest !== null
      || row.completion_manifest_digest !== null
      || row.dead_lettered_at !== null) throw invalidRow();
    return;
  }
  if (row.status === "DEAD_LETTER") {
    if (row.dead_lettered_at === null
      || row.failed_at === null
      || row.error_json === null
      || row.next_retry_at !== null
      || row.completed_at !== null
      || row.result_json !== null
      || row.result_digest !== null
      || row.completion_manifest_digest !== null) throw invalidRow();
    return;
  }
  throw invalidRow();
}

function exactScope(checkpoint, consumerName, sourceName, partitionKey, handlerVersion) {
  return byteEqual(checkpoint.consumerName, consumerName)
    && byteEqual(checkpoint.sourceName, sourceName)
    && byteEqual(checkpoint.partitionKey, partitionKey)
    && byteEqual(checkpoint.handlerVersion, handlerVersion);
}

function gapState(checkpoint, head, nextPosition, highWatermark) {
  if (nextPosition > highWatermark) {
    return Object.freeze({ status: "CLEAR", from: null, to: null, reason: null, blockedReceiptId: null });
  }
  if (!head || head.partition_position > nextPosition) {
    const upper = head ? head.partition_position - 1 : highWatermark;
    return Object.freeze({
      status: "MISSING",
      from: nextPosition,
      to: upper,
      reason: "INBOX_POSITION_MISSING",
      blockedReceiptId: null,
    });
  }
  if (head.status === "DEAD_LETTER") {
    return Object.freeze({
      status: "BLOCKED_DEAD_LETTER",
      from: nextPosition,
      to: nextPosition,
      reason: "INBOX_DEAD_LETTER",
      blockedReceiptId: head.inbox_receipt_id,
    });
  }
  if (head.status === "REVIEW_REQUIRED") {
    return Object.freeze({
      status: "REVIEW_REQUIRED",
      from: nextPosition,
      to: nextPosition,
      reason: "INBOX_REVIEW_REQUIRED",
      blockedReceiptId: head.inbox_receipt_id,
    });
  }
  return Object.freeze({ status: "CLEAR", from: null, to: null, reason: null, blockedReceiptId: null });
}

function sameGap(checkpoint, gap, highWatermark) {
  return checkpoint.highWatermarkPosition === highWatermark
    && checkpoint.gapStatus === gap.status
    && checkpoint.gapFromPosition === gap.from
    && checkpoint.gapToPosition === gap.to
    && checkpoint.gapReasonCode === gap.reason
    && checkpoint.blockedReceiptId === gap.blockedReceiptId;
}

function failureDecisionFacts(decision, row) {
  const facts = {
    kind: decision.kind,
    delayMs: decision.delayMs,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseGeneration: row.lease_generation,
  };
  const snapshot = boundedJsonSnapshot(facts, 4 * 1024, persistenceFailure);
  return deepFreeze({ facts: snapshot.payload, digest: snapshot.digest });
}

function safeErrorValue(decision, row) {
  const failure = failureDecisionFacts(decision, row);
  return deepFreeze({
    code: decision.reasonCode,
    message: "inbox processing failed",
    decision: failure.facts,
    decisionDigest: failure.digest,
  });
}

function safeErrorJson(decision, row) {
  return JSON.stringify(safeErrorValue(decision, row));
}

function mysqlInstant(value) {
  const normalized = mysqlDateTime(value);
  const instant = Date.parse(`${normalized.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(instant)) throw invalidRow();
  return instant;
}

function normalizeExpectedFailure(input) {
  if (!exactKeys(input, ["kind", "delayMs", "reasonCode", "policyVersion"])
    || !["RETRY", "DEAD_LETTER"].includes(input.kind)
    || !Number.isSafeInteger(input.delayMs)
    || input.delayMs < 0
    || !opaqueAscii(input.reasonCode, 64)
    || !opaqueAscii(input.policyVersion, 64)) throw invalidInput();
  return Object.freeze({
    kind: input.kind,
    delayMs: input.delayMs,
    reasonCode: input.reasonCode,
    policyVersion: input.policyVersion,
  });
}

function verifyFailureDecision(row, expectedInput = null) {
  if (!plainRecord(row.error_json)
    || !exactKeys(row.error_json, ["code", "message", "decision", "decisionDigest"])
    || row.error_json.message !== "inbox processing failed"
    || !plainRecord(row.error_json.decision)
    || !/^[a-f0-9]{64}$/.test(row.error_json.decisionDigest)) throw invalidRow();
  const persisted = row.error_json.decision;
  if (!exactKeys(persisted, [
    "kind", "delayMs", "reasonCode", "policyVersion",
    "attemptCount", "maxAttempts", "leaseGeneration",
  ])) throw invalidRow();
  const persistedSnapshot = boundedJsonSnapshot(persisted, 4 * 1024, invalidRow);
  if (!byteEqual(persistedSnapshot.digest, row.error_json.decisionDigest)
    || !byteEqual(row.error_json.code, persisted.reasonCode)
    || persisted.attemptCount !== row.attempt_count
    || persisted.maxAttempts !== row.max_attempts
    || persisted.leaseGeneration !== row.lease_generation
    || !byteEqual(persisted.policyVersion, row.retry_policy_version)) throw invalidRow();
  const expected = expectedInput === null ? null : normalizeExpectedFailure(expectedInput);
  if (expected && (persisted.kind !== expected.kind
    || persisted.delayMs !== expected.delayMs
    || !byteEqual(persisted.reasonCode, expected.reasonCode)
    || !byteEqual(persisted.policyVersion, expected.policyVersion))) throw invalidRow();
  if (row.status === "RETRY_PENDING") {
    if (persisted.kind !== "RETRY" || persisted.delayMs <= 0
      || mysqlInstant(row.next_retry_at) - mysqlInstant(row.failed_at) !== persisted.delayMs) throw invalidRow();
  } else if (row.status === "DEAD_LETTER") {
    if (persisted.kind !== "DEAD_LETTER" || persisted.delayMs !== 0) throw invalidRow();
  } else {
    throw invalidRow();
  }
  return deepFreeze({ facts: clone(persisted), digest: row.error_json.decisionDigest });
}

function transitionResult(row, transitionId, failure = null) {
  const result = {
    receiptId: row.inbox_receipt_id,
    status: row.status,
    transitionId,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    payloadDigest: row.payload_transport_digest,
  };
  if (failure) {
    result.failureDecision = clone(failure.facts);
    result.failureDecisionDigest = failure.digest;
  }
  return deepFreeze(result);
}

function deadLetterId(receiptId) {
  return deterministicId("dead", "inbox", receiptId);
}

function normalizeDeadLetter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw deadLetterConflict();
  return {
    direction: input.direction,
    source_record_id: input.source_record_id,
    source_lease_generation: Number(input.source_lease_generation),
    source_transition_id: input.source_transition_id,
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
    error_json: parseJson(input.error_json),
    next_retry_at: input.next_retry_at,
    replay_request_id: input.replay_request_id,
    release_id: input.release_id,
    resolved_at: input.resolved_at,
    resolved_by: input.resolved_by,
  };
}

function exactDeadLetter(existing, row, transitionId, expectedError) {
  const error = existing.error_json;
  return existing.direction === "INBOX"
    && byteEqual(existing.source_record_id, row.inbox_receipt_id)
    && existing.source_lease_generation === row.lease_generation
    && byteEqual(existing.source_transition_id, transitionId)
    && byteEqual(existing.consumer_name, row.consumer_name)
    && byteEqual(existing.source_name, row.source_name)
    && byteEqual(existing.partition_key, row.partition_key)
    && existing.partition_position === row.partition_position
    && byteEqual(existing.event_id, row.event_id)
    && byteEqual(existing.event_type, row.event_type)
    && existing.payload_json === null
    && byteEqual(existing.payload_digest, row.payload_digest)
    && existing.status === "OPEN"
    && existing.attempt_count === row.attempt_count
    && existing.reason_code === expectedError.code
    && plainRecord(error)
    && jsonSnapshot(error, invalidRow).digest === jsonSnapshot(expectedError, invalidRow).digest
    && existing.next_retry_at === null
    && existing.replay_request_id === null
    && existing.release_id === null
    && existing.resolved_at === null
    && existing.resolved_by === null;
}

function createMysqlInboxCheckpointAdapter(connection, options = {}) {
  if (!connection || typeof connection.execute !== "function") throw configurationError();
  if (!exactKeys(options, ["contentCodec", "handlerRegistration"])) throw configurationError();
  const contentCodec = options.contentCodec;
  let handlerRegistration;
  try { handlerRegistration = assertResolvedInboxHandlerRegistration(options.handlerRegistration); } catch {
    throw configurationError();
  }
  if (!contentCodec
    || typeof contentCodec.seal !== "function"
    || typeof contentCodec.open !== "function"
    || typeof contentCodec.digest !== "function"
    || typeof contentCodec.verifyDigest !== "function"
    || typeof contentCodec.assertReady !== "function"
    || typeof contentCodec.getStatus !== "function") throw configurationError();
  try {
    contentCodec.assertReady();
    const status = contentCodec.getStatus();
    if (!plainRecord(status) || status.ready !== true || status.enabled !== true) throw configurationError();
  } catch { throw configurationError(); }
  const normalizeStoredReceiptRow = (row) => normalizeReceiptRow(row, contentCodec, handlerRegistration);
  const statementById = new Map(handlerRegistration.statements.map((statement) => [statement.statementId, statement]));
  const outboxContractById = new Map(handlerRegistration.outboxContracts.map((contract) => [contract.contractId, contract]));
  const handlerEvidence = deepFreeze({
    handlerId: handlerRegistration.descriptor.handlerId,
    handlerVersion: handlerRegistration.descriptor.handlerVersion,
    registryVersion: handlerRegistration.registryVersion,
    registryDigest: handlerRegistration.registryDigest,
    assemblySourceDigest: handlerRegistration.assemblySourceDigest,
    registrationDigest: handlerRegistration.registrationDigest,
    descriptorDigest: handlerRegistration.descriptor.descriptorDigest,
    sourceDigest: handlerRegistration.descriptor.sourceDigest,
  });
  let active = true;
  const nestedOutboxAdapters = new Set();

  function assertActive() {
    if (!active) throw inboxError("INBOX_CHECKPOINT_INACTIVE", "inbox checkpoint transaction is inactive");
  }

  function assertRegisteredScope(input) {
    const descriptor = handlerRegistration.descriptor;
    if (!byteEqual(input.consumerName, descriptor.consumerName)
      || !byteEqual(input.handlerVersion, descriptor.handlerVersion)
      || (input.sourceName !== undefined && !byteEqual(input.sourceName, descriptor.sourceName))) throw invalidInput();
  }

  async function safeExecute(sql, values = []) {
    try {
      return await connection.execute(sql, values);
    } catch {
      throw persistenceFailure();
    }
  }

  async function ensureCheckpoint(input) {
    const checkpointId = deterministicId("checkpoint", input.consumerName, input.sourceName, input.partitionKey);
    try {
      const inserted = await connection.execute(CHECKPOINT_INSERT_SQL, [
        checkpointId,
        input.consumerName,
        input.sourceName,
        input.partitionKey,
        input.handlerVersion,
      ]);
      if (affectedRows(inserted) !== 1) throw persistenceFailure();
    } catch (error) {
      if (!duplicateEntry(error)) {
        if (error && error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED") throw error;
        throw persistenceFailure();
      }
    }
    const rows = selectedRows(await safeExecute(CHECKPOINT_LOCK_SQL, [
      input.consumerName,
      input.sourceName,
      input.partitionKey,
    ]));
    if (rows.length !== 1) throw persistenceFailure();
    const checkpoint = normalizeCheckpointRow(rows[0]);
    if (!byteEqual(checkpoint.checkpointId, checkpointId)
      || !exactScope(checkpoint, input.consumerName, input.sourceName, input.partitionKey, input.handlerVersion)) {
      throw envelopeConflict();
    }
    return checkpoint;
  }

  async function lockCheckpoint(scope) {
    const rows = selectedRows(await safeExecute(CHECKPOINT_LOCK_SQL, [
      scope.consumerName,
      scope.sourceName,
      scope.partitionKey,
    ]));
    if (rows.length !== 1) throw persistenceFailure();
    const checkpoint = normalizeCheckpointRow(rows[0]);
    if (!exactScope(checkpoint, scope.consumerName, scope.sourceName, scope.partitionKey, scope.handlerVersion)) {
      throw envelopeConflict();
    }
    return checkpoint;
  }

  async function readGapHead(scope, nextPosition) {
    const rows = selectedRows(await safeExecute(GAP_HEAD_LOCK_SQL, [
      scope.consumerName,
      scope.sourceName,
      scope.partitionKey,
      nextPosition,
    ]));
    if (rows.length > 1) throw persistenceFailure();
    return rows.length === 0 ? null : normalizeStoredReceiptRow(rows[0]);
  }

  async function updateCheckpointState(checkpoint, transitionId, highWatermark) {
    const nextPosition = checkpoint.lastContiguousPosition + 1;
    const head = await readGapHead(checkpoint, nextPosition);
    const gap = gapState(checkpoint, head, nextPosition, highWatermark);
    if (sameGap(checkpoint, gap, highWatermark)) return checkpoint;
    const result = await safeExecute(CHECKPOINT_STATE_UPDATE_SQL, [
      highWatermark,
      transitionId,
      gap.status,
      gap.from,
      gap.to,
      gap.reason,
      gap.blockedReceiptId,
      checkpoint.checkpointId,
      checkpoint.stateGeneration,
      checkpoint.lastContiguousPosition,
      checkpoint.highWatermarkPosition,
      checkpoint.handlerVersion,
    ]);
    if (affectedRows(result) !== 1) throw persistenceFailure();
    return deepFreeze({
      ...checkpoint,
      highWatermarkPosition: highWatermark,
      stateGeneration: checkpoint.stateGeneration + 1,
      checkpointTransitionId: transitionId,
      gapStatus: gap.status,
      gapFromPosition: gap.from,
      gapToPosition: gap.to,
      gapReasonCode: gap.reason,
      blockedReceiptId: gap.blockedReceiptId,
    });
  }

  async function receive(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "handlerVersion", "transitionId", "maxAttempts", "retryPolicyVersion", "envelope"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.handlerVersion, 64)
      || !opaqueAscii(input.transitionId, 128)
      || input.retryPolicyVersion !== INBOX_RETRY_POLICY_V1.policyVersion) throw invalidInput();
    const maxAttempts = inputInteger(input.maxAttempts, 1, 0xFFFFFFFF);
    const envelope = normalizeEnvelope(input.envelope);
    assertRegisteredScope({
      consumerName: input.consumerName,
      handlerVersion: input.handlerVersion,
      sourceName: envelope.sourceName,
    });
    assertRegistrationEnvelope(handlerRegistration, envelope);
    const checkpoint = await ensureCheckpoint({
      consumerName: input.consumerName,
      sourceName: envelope.sourceName,
      partitionKey: envelope.partitionKey,
      handlerVersion: input.handlerVersion,
    });

    const eventRows = selectedRows(await safeExecute(RECEIPT_BY_EVENT_LOCK_SQL, [
      input.consumerName,
      envelope.eventId,
    ]));
    if (eventRows.length > 1) throw persistenceFailure();
    const eventRow = eventRows[0] ? normalizeStoredReceiptRow(eventRows[0]) : null;
    if (eventRow) {
      assertEnvelopeMatchesRow(envelope, eventRow);
      if (!byteEqual(eventRow.consumer_name, input.consumerName)
        || !byteEqual(eventRow.handler_version, input.handlerVersion)
        || eventRow.max_attempts !== maxAttempts
        || !byteEqual(eventRow.retry_policy_version, input.retryPolicyVersion)) throw envelopeConflict();
      const touched = await safeExecute(RECEIPT_TOUCH_SQL, [
        eventRow.inbox_receipt_id,
        input.consumerName,
        envelope.eventId,
        eventRow.payload_digest,
        eventRow.handler_id,
        eventRow.handler_registry_version,
        eventRow.handler_descriptor_digest,
        eventRow.handler_source_digest,
        eventRow.handler_registration_digest,
      ]);
      if (affectedRows(touched) !== 1) throw persistenceFailure();
      const updatedCheckpoint = await updateCheckpointState(
        checkpoint,
        input.transitionId,
        Math.max(checkpoint.highWatermarkPosition, envelope.partitionPosition)
      );
      return deepFreeze({
        created: false,
        receiptId: eventRow.inbox_receipt_id,
        receiptStatus: eventRow.status,
        envelope,
        checkpoint: updatedCheckpoint,
      });
    }

    const positionRows = selectedRows(await safeExecute(RECEIPT_BY_POSITION_LOCK_SQL, [
      input.consumerName,
      envelope.sourceName,
      envelope.partitionKey,
      envelope.partitionPosition,
    ]));
    if (positionRows.length > 1) throw persistenceFailure();
    if (positionRows.length === 1) throw envelopeConflict();

    const receiptId = deterministicId("inbox", input.consumerName, envelope.eventId);
    let sealedPayload;
    try {
      sealedPayload = contentCodec.seal(envelope.payload, {
        purpose: "PAYLOAD",
        binding: payloadContentBinding(envelopePersistenceRow(envelope, handlerRegistration)),
      });
    } catch {
      throw persistenceFailure();
    }
    try {
      const inserted = await connection.execute(RECEIPT_INSERT_SQL, [
        receiptId,
        input.consumerName,
        envelope.sourceName,
        envelope.partitionKey,
        envelope.partitionPosition,
        envelope.eventId,
        envelope.eventType,
        envelope.schemaVersion,
        envelope.aggregateType,
        envelope.aggregateId,
        envelope.aggregateVersion,
        envelope.occurredAt,
        envelope.producerVersion,
        envelope.correlationId,
        envelope.causationId,
        envelope.idempotencyKey,
        input.handlerVersion,
        handlerRegistration.descriptor.handlerId,
        handlerRegistration.registryVersion,
        handlerRegistration.descriptor.descriptorDigest,
        handlerRegistration.descriptor.sourceDigest,
        handlerRegistration.registrationDigest,
        JSON.stringify(sealedPayload.stored),
        sealedPayload.codecVersion,
        sealedPayload.keyId,
        sealedPayload.digestScheme,
        sealedPayload.contentDigest,
        maxAttempts,
        input.retryPolicyVersion,
        input.transitionId,
      ]);
      if (affectedRows(inserted) !== 1) throw persistenceFailure();
    } catch (error) {
      if (duplicateEntry(error)) throw envelopeConflict();
      if (error && error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED") throw error;
      throw persistenceFailure();
    }
    const updatedCheckpoint = await updateCheckpointState(
      checkpoint,
      input.transitionId,
      Math.max(checkpoint.highWatermarkPosition, envelope.partitionPosition)
    );
    return deepFreeze({
      created: true,
      receiptId,
      receiptStatus: "RECEIVED",
      envelope,
      checkpoint: updatedCheckpoint,
    });
  }

  async function claimNext(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "handlerVersion", "workerId", "transitionId", "sourceName", "partitionKey", "leaseSeconds", "retryPolicyVersion"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.handlerVersion, 64)
      || !opaqueAscii(input.workerId, 128)
      || !opaqueAscii(input.transitionId, 128)
      || !exactText(input.sourceName, 96)
      || !exactText(input.partitionKey, 191)
      || input.retryPolicyVersion !== INBOX_RETRY_POLICY_V1.policyVersion) throw invalidInput();
    assertRegisteredScope(input);
    const leaseSeconds = inputInteger(input.leaseSeconds, 1, MAX_LEASE_SECONDS);
    const checkpoint = await lockCheckpoint(input);
    if (["BLOCKED_DEAD_LETTER", "REVIEW_REQUIRED"].includes(checkpoint.gapStatus)) return Object.freeze([]);
    const nextPosition = checkpoint.lastContiguousPosition + 1;
    const rows = selectedRows(await safeExecute(CLAIM_HEAD_LOCK_SQL, [
      input.consumerName,
      input.sourceName,
      input.partitionKey,
      nextPosition,
    ]));
    if (rows.length > 1) throw persistenceFailure();
    if (rows.length === 0) {
      await updateCheckpointState(checkpoint, input.transitionId, checkpoint.highWatermarkPosition);
      return Object.freeze([]);
    }
    const before = normalizeStoredReceiptRow(rows[0]);
    if (!byteEqual(before.handler_version, input.handlerVersion)
      || !byteEqual(before.retry_policy_version, input.retryPolicyVersion)) throw envelopeConflict();
    if (!["RECEIVED", "RETRY_PENDING"].includes(before.status)) return Object.freeze([]);
    if (before.status === "RETRY_PENDING" && Number(rows[0].retry_due) !== 1) return Object.freeze([]);
    const update = await safeExecute(CLAIM_UPDATE_SQL, [
      input.workerId,
      leaseSeconds,
      input.transitionId,
      before.inbox_receipt_id,
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
      before.inbox_receipt_id,
      input.workerId,
      generation,
      input.transitionId,
    ]));
    if (afterRows.length !== 1 || Number(afterRows[0].lease_active) !== 1) throw leaseLost();
    const after = normalizeStoredReceiptRow(afterRows[0]);
    assertEnvelopeMatchesRow(envelopeFromRow(before), after);
    if (after.attempt_count !== before.attempt_count + 1
      || after.lease_generation !== generation
      || after.partition_position !== nextPosition) throw invalidRow();
    return Object.freeze([claimFromRow(after)]);
  }

  async function lockOwned(claim) {
    assertRegisteredScope({
      consumerName: claim.consumerName,
      handlerVersion: claim.handlerVersion,
      sourceName: claim.envelope.sourceName,
    });
    const checkpoint = await lockCheckpoint({
      consumerName: claim.consumerName,
      sourceName: claim.envelope.sourceName,
      partitionKey: claim.envelope.partitionKey,
      handlerVersion: claim.handlerVersion,
    });
    if (checkpoint.lastContiguousPosition + 1 !== claim.envelope.partitionPosition) throw leaseLost();
    const rows = selectedRows(await safeExecute(OWNED_LOCK_SQL, [
      claim.receiptId,
      claim.leaseOwner,
      claim.leaseGeneration,
      claim.claimTransitionId,
    ]));
    if (rows.length !== 1 || Number(rows[0].lease_active) !== 1) throw leaseLost();
    const row = normalizeStoredReceiptRow(rows[0]);
    assertClaimMatchesRow(claim, row);
    return { checkpoint, row };
  }

  async function executeRegisteredStatement(phase, statementId, parameters, executedStatementIds) {
    if (!opaqueAscii(statementId, 128) || !plainRecord(parameters)) throw invalidInput();
    const statement = statementById.get(statementId);
    const allowedIds = phase === "VERIFY"
      ? handlerRegistration.descriptor.verifyStatementIds
      : handlerRegistration.descriptor.applyStatementIds;
    if (!statement
      || !allowedIds.includes(statementId)
      || (phase === "VERIFY" && statement.phase !== "VERIFY_READ")
      || (phase === "APPLY" && !["APPLY_READ", "APPLY_WRITE"].includes(statement.phase))
      || !exactKeys(parameters, statement.parameterNames)
      || !Array.isArray(statement.parameterRules)
      || statement.parameterRules.length !== statement.parameterNames.length) throw invalidInput();
    const values = statement.parameterNames.map((name) => parameters[name]);
    if (values.some((value, index) => (
      value === undefined || !validStatementParameter(statement.parameterRules[index], value)
    ))) throw invalidInput();
    const result = await safeExecute(statement.sql, values);
    executedStatementIds.push(statementId);
    if (statement.resultMode === "ROWS") return selectedRows(result).map(clone);
    if (statement.resultMode === "AFFECTED_ONE") {
      if (affectedRows(result) !== 1) throw persistenceFailure();
      return Object.freeze({ affectedRows: 1 });
    }
    if (statement.resultMode === "AFFECTED_ZERO_OR_ONE") {
      const count = affectedRows(result);
      if (count < 0 || count > 1) throw persistenceFailure();
      return Object.freeze({ affectedRows: count });
    }
    throw configurationError();
  }

  function createApplyExecution(envelope) {
    const outbox = createMysqlEventTransportAdapter(connection);
    nestedOutboxAdapters.add(outbox);
    const stagedFacts = new Map();
    const executedStatementIds = [];
    const contractCounts = new Map();
    const context = Object.freeze({
      envelope,
      handlerEvidence,
      executeStatement(statementId, parameters) {
        return executeRegisteredStatement("APPLY", statementId, parameters, executedStatementIds);
      },
      stageOutbox(contractId, input) {
        if (!opaqueAscii(contractId, 128)) throw invalidInput();
        const contract = outboxContractById.get(contractId);
        const count = (contractCounts.get(contractId) || 0) + 1;
        if (!contract
          || !handlerRegistration.descriptor.outboxContractIds.includes(contractId)
          || count > contract.maximumPerInvocation) throw invalidInput();
        let successor;
        try { successor = contract.build(input, Object.freeze({ envelope, handlerEvidence })); } catch {
          throw invalidInput();
        }
        if (!plainRecord(successor)
          || successor.topic !== contract.topic
          || successor.event_type !== contract.eventType
          || successor.schema_version !== contract.schemaVersion
          || successor.source_name !== contract.sourceName) throw invalidInput();
        const staged = outbox.stageOutbox(successor);
        const identity = snapshotOutboxImmutableIdentity(successor);
        const identitySnapshot = boundedJsonSnapshot(identity, MAX_HANDLER_MANIFEST_BYTES, persistenceFailure);
        if (!byteEqual(staged.outboxEventId, identity.outbox_event_id)
          || stagedFacts.has(staged.outboxEventId)) throw persistenceFailure();
        stagedFacts.set(staged.outboxEventId, deepFreeze({
          contractId,
          outboxEventId: staged.outboxEventId,
          immutableIdentity: identitySnapshot.payload,
          immutableIdentityDigest: identitySnapshot.digest,
        }));
        contractCounts.set(contractId, count);
        return staged;
      },
    });
    return { context, outbox, stagedFacts, executedStatementIds };
  }

  function createVerifyContext({ envelope, result, manifest }) {
    const executedStatementIds = [];
    return {
      context: Object.freeze({
        envelope,
        result,
        manifest,
        handlerEvidence,
        executeStatement(statementId, parameters) {
          return executeRegisteredStatement("VERIFY", statementId, parameters, executedStatementIds);
        },
      }),
      executedStatementIds,
    };
  }

  async function computeGapAfterCompletion(checkpoint, position) {
    const nextPosition = position + 1;
    const head = await readGapHead(checkpoint, nextPosition);
    return gapState(checkpoint, head, nextPosition, checkpoint.highWatermarkPosition);
  }

  async function completeOwned(claimInput, input) {
    assertActive();
    const claim = normalizeClaim(claimInput);
    if (!exactKeys(input, ["transitionId"]) || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    const { checkpoint, row } = await lockOwned(claim);
    const transactional = createApplyExecution(claim.envelope);
    let work;
    try {
      work = await handlerRegistration.apply(transactional.context);
    } catch {
      throw persistenceFailure();
    }
    if (!exactKeys(work, ["result", "manifest"]) || !plainRecord(work.result) || !plainRecord(work.manifest)) {
      throw persistenceFailure();
    }
    const executedApplyStatementIds = [...transactional.executedStatementIds];
    if (!matchesStatementExecutionProfile(
      executedApplyStatementIds,
      handlerRegistration.descriptor.applyExecutionProfiles
    )) throw persistenceFailure();
    const handlerResult = boundedJsonSnapshot(work.result, MAX_HANDLER_RESULT_BYTES, persistenceFailure).payload;
    const handlerManifest = boundedJsonSnapshot(work.manifest, MAX_HANDLER_MANIFEST_BYTES, persistenceFailure).payload;
    const outboxFlush = await transactional.outbox.flushBeforeCommit();
    const successorOutboxFacts = [...transactional.stagedFacts.values()]
      .sort((left, right) => compareUtf8(left.outboxEventId, right.outboxEventId));
    if (!plainRecord(outboxFlush)
      || !Number.isSafeInteger(outboxFlush.inserted)
      || !Number.isSafeInteger(outboxFlush.replayed)
      || outboxFlush.inserted < 0
      || outboxFlush.replayed < 0
      || outboxFlush.inserted + outboxFlush.replayed !== successorOutboxFacts.length) throw persistenceFailure();
    const completionManifest = {
      handlerEvidence: {
        ...handlerEvidence,
        executedApplyStatementIds,
      },
      handler: handlerManifest,
      successorOutboxFacts,
      outboxFlush,
    };
    const manifestSnapshot = boundedJsonSnapshot(
      completionManifest,
      MAX_HANDLER_MANIFEST_BYTES,
      persistenceFailure
    );
    const persistedResult = {
      result: handlerResult,
      completionManifest: manifestSnapshot.payload,
    };
    const resultSnapshot = boundedJsonSnapshot(
      persistedResult,
      MAX_PERSISTED_RESULT_BYTES,
      persistenceFailure
    );
    const resultBinding = resultContentBinding({
      ...row,
      inbox_transition_id: input.transitionId,
    });
    let sealedResult;
    let protectedManifestDigest;
    try {
      sealedResult = contentCodec.seal(resultSnapshot.payload, {
        purpose: "RESULT",
        binding: resultBinding,
      });
      protectedManifestDigest = contentCodec.digest(manifestSnapshot.payload, {
        purpose: "MANIFEST",
        binding: resultBinding,
        keyId: sealedResult.keyId === null ? undefined : sealedResult.keyId,
      });
    } catch {
      throw persistenceFailure();
    }
    const update = await safeExecute(COMPLETE_UPDATE_SQL, [
      input.transitionId,
      JSON.stringify(sealedResult.stored),
      sealedResult.codecVersion,
      sealedResult.keyId,
      sealedResult.digestScheme,
      sealedResult.contentDigest,
      protectedManifestDigest,
      sealedResult.digestScheme,
      row.inbox_receipt_id,
      row.lease_owner,
      row.lease_generation,
      row.inbox_transition_id,
      ...identityValues(row),
    ]);
    if (affectedRows(update) !== 1) throw leaseLost();
    const gap = await computeGapAfterCompletion(checkpoint, row.partition_position);
    const checkpointUpdate = await safeExecute(CHECKPOINT_COMPLETE_UPDATE_SQL, [
      row.partition_position,
      checkpoint.highWatermarkPosition,
      input.transitionId,
      gap.status,
      gap.from,
      gap.to,
      gap.reason,
      gap.blockedReceiptId,
      row.event_id,
      row.inbox_receipt_id,
      checkpoint.checkpointId,
      checkpoint.stateGeneration,
      checkpoint.lastContiguousPosition,
      checkpoint.highWatermarkPosition,
      checkpoint.handlerVersion,
    ]);
    if (affectedRows(checkpointUpdate) !== 1) throw persistenceFailure();
    return deepFreeze({
      ...transitionResult({ ...row, status: "SUCCEEDED" }, input.transitionId),
      result: handlerResult,
      completionManifest: manifestSnapshot.payload,
      resultDigest: sealedResult.contentDigest,
      completionManifestDigest: protectedManifestDigest,
    });
  }

  async function insertOrVerifyDeadLetter(row, transitionId, decision) {
    const errorValue = safeErrorValue(decision, row);
    const errorJson = JSON.stringify(errorValue);
    try {
      const inserted = await connection.execute(DEAD_INSERT_SQL, [
        deadLetterId(row.inbox_receipt_id),
        row.inbox_receipt_id,
        row.lease_generation,
        transitionId,
        row.consumer_name,
        row.source_name,
        row.partition_key,
        row.partition_position,
        row.event_id,
        row.event_type,
        row.payload_digest,
        row.attempt_count,
        decision.reasonCode,
        errorJson,
      ]);
      if (affectedRows(inserted) !== 1) throw deadLetterConflict();
      return;
    } catch (error) {
      if (!duplicateEntry(error)) {
        if (error && error.code === "INBOX_CHECKPOINT_DEAD_LETTER_CONFLICT") throw error;
        throw persistenceFailure();
      }
    }
    const rows = selectedRows(await safeExecute(DEAD_READ_SQL, [row.inbox_receipt_id]));
    if (rows.length !== 1) throw deadLetterConflict();
    let existing;
    try { existing = normalizeDeadLetter(rows[0]); } catch { throw deadLetterConflict(); }
    if (!exactDeadLetter(existing, row, transitionId, errorValue)) throw deadLetterConflict();
  }

  async function persistFailure(checkpoint, row, claim, input, recovery) {
    let policy;
    try { policy = validateInboxRetryPolicy(input.retryPolicy); } catch { throw invalidInput(); }
    const decision = decideInboxFailure({
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      retryable: input.retryable,
      reasonCode: input.reasonCode,
    }, policy);
    const failure = failureDecisionFacts(decision, row);
    if (decision.kind === "RETRY") {
      const sql = recovery ? RECOVERY_RETRY_UPDATE_SQL : RETRY_UPDATE_SQL;
      const updated = await safeExecute(sql, [
        decision.policyVersion,
        decision.delayMs * 1_000,
        input.transitionId,
        safeErrorJson(decision, row),
        row.inbox_receipt_id,
        row.lease_owner,
        row.lease_generation,
        row.inbox_transition_id,
        ...identityValues(row),
      ]);
      if (affectedRows(updated) !== 1) throw leaseLost();
      return transitionResult({ ...row, status: "RETRY_PENDING" }, input.transitionId, failure);
    }
    await insertOrVerifyDeadLetter(row, input.transitionId, decision);
    const sql = recovery ? RECOVERY_DEAD_UPDATE_SQL : DEAD_UPDATE_SQL;
    const updated = await safeExecute(sql, [
      input.transitionId,
      safeErrorJson(decision, row),
      row.inbox_receipt_id,
      row.lease_owner,
      row.lease_generation,
      row.inbox_transition_id,
      ...identityValues(row),
    ]);
    if (affectedRows(updated) !== 1) throw leaseLost();
    const checkpointUpdate = await safeExecute(CHECKPOINT_DEAD_UPDATE_SQL, [
      input.transitionId,
      row.partition_position,
      row.partition_position,
      row.inbox_receipt_id,
      checkpoint.checkpointId,
      checkpoint.stateGeneration,
      checkpoint.lastContiguousPosition,
      checkpoint.highWatermarkPosition,
      checkpoint.handlerVersion,
    ]);
    if (affectedRows(checkpointUpdate) !== 1) throw persistenceFailure();
    if (claim) assertClaimMatchesRow(claim, row);
    return transitionResult({ ...row, status: "DEAD_LETTER" }, input.transitionId, failure);
  }

  async function failOwned(claimInput, input) {
    assertActive();
    const claim = normalizeClaim(claimInput);
    if (!exactKeys(input, ["transitionId", "reasonCode", "retryable", "retryPolicy"])
      || !opaqueAscii(input.transitionId, 128)
      || typeof input.retryable !== "boolean") throw invalidInput();
    const { checkpoint, row } = await lockOwned(claim);
    return persistFailure(checkpoint, row, claim, input, false);
  }

  async function recoverExpired(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "handlerVersion", "sourceName", "partitionKey", "transitionId", "retryPolicy"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.handlerVersion, 64)
      || !exactText(input.sourceName, 96)
      || !exactText(input.partitionKey, 191)
      || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    assertRegisteredScope(input);
    let policy;
    try { policy = validateInboxRetryPolicy(input.retryPolicy); } catch { throw invalidInput(); }
    const checkpoint = await lockCheckpoint(input);
    const nextPosition = checkpoint.lastContiguousPosition + 1;
    const rows = selectedRows(await safeExecute(CLAIM_HEAD_LOCK_SQL, [
      input.consumerName,
      input.sourceName,
      input.partitionKey,
      nextPosition,
    ]));
    if (rows.length > 1) throw persistenceFailure();
    if (rows.length === 0) return Object.freeze([]);
    const row = normalizeStoredReceiptRow(rows[0]);
    if (row.status !== "CLAIMED") return Object.freeze([]);
    if (!byteEqual(row.handler_version, input.handlerVersion)
      || !byteEqual(row.retry_policy_version, policy.policyVersion)) throw envelopeConflict();
    const result = await persistFailure(checkpoint, row, null, {
      transitionId: input.transitionId,
      retryable: true,
      reasonCode: "INBOX_LEASE_EXPIRED",
      retryPolicy: policy,
    }, true);
    return Object.freeze([result]);
  }

  async function readReceiptConvergence(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "handlerVersion", "maxAttempts", "retryPolicyVersion", "envelope"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.handlerVersion, 64)
      || input.retryPolicyVersion !== INBOX_RETRY_POLICY_V1.policyVersion) throw invalidInput();
    const maxAttempts = inputInteger(input.maxAttempts, 1, 0xFFFFFFFF);
    const envelope = normalizeEnvelope(input.envelope);
    assertRegisteredScope({
      consumerName: input.consumerName,
      handlerVersion: input.handlerVersion,
      sourceName: envelope.sourceName,
    });
    assertRegistrationEnvelope(handlerRegistration, envelope);
    const receiptRows = selectedRows(await safeExecute(RECEIPT_READ_SQL, [input.consumerName, envelope.eventId]));
    const checkpointRows = selectedRows(await safeExecute(CHECKPOINT_READ_SQL, [
      input.consumerName,
      envelope.sourceName,
      envelope.partitionKey,
    ]));
    if (receiptRows.length !== 1 || checkpointRows.length !== 1) return Object.freeze({ state: "ABSENT" });
    const row = normalizeStoredReceiptRow(receiptRows[0]);
    const checkpoint = normalizeCheckpointRow(checkpointRows[0]);
    assertEnvelopeMatchesRow(envelope, row);
    if (!byteEqual(row.consumer_name, input.consumerName)
      || !byteEqual(row.handler_version, input.handlerVersion)
      || row.max_attempts !== maxAttempts
      || !byteEqual(row.retry_policy_version, input.retryPolicyVersion)
      || !exactScope(checkpoint, input.consumerName, envelope.sourceName, envelope.partitionKey, input.handlerVersion)
      || checkpoint.highWatermarkPosition < envelope.partitionPosition) throw envelopeConflict();
    return deepFreeze({
      state: "CONVERGED",
      result: {
        created: false,
        receiptId: row.inbox_receipt_id,
        receiptStatus: row.status,
        envelope,
        checkpoint,
      },
    });
  }

  async function readClaimByTransition(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "workerId", "transitionId"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.workerId, 128)
      || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    if (!byteEqual(input.consumerName, handlerRegistration.descriptor.consumerName)) throw invalidInput();
    const rows = selectedRows(await safeExecute(CLAIM_TRANSITION_READ_SQL, [
      input.consumerName,
      input.workerId,
      input.transitionId,
    ]));
    if (rows.length === 0) return Object.freeze([]);
    if (rows.length !== 1 || Number(rows[0].lease_active) !== 1) throw leaseLost();
    return Object.freeze([claimFromRow(normalizeStoredReceiptRow(rows[0]))]);
  }

  async function verifyDeadLetter(row) {
    const rows = selectedRows(await safeExecute(DEAD_VERIFY_SQL, [row.inbox_receipt_id]));
    if (rows.length !== 1) throw deadLetterConflict();
    let existing;
    try { existing = normalizeDeadLetter(rows[0]); } catch { throw deadLetterConflict(); }
    if (!plainRecord(row.error_json)
      || !exactDeadLetter(existing, row, row.inbox_transition_id, row.error_json)) throw deadLetterConflict();
  }

  async function verifyCompletion(row, claim) {
    if (!plainRecord(row.result_json)
      || !plainRecord(row.result_json.result)
      || !plainRecord(row.result_json.completionManifest)) throw invalidRow();
    boundedJsonSnapshot(row.result_json, MAX_PERSISTED_RESULT_BYTES, invalidRow);
    boundedJsonSnapshot(row.result_json.result, MAX_HANDLER_RESULT_BYTES, invalidRow);
    boundedJsonSnapshot(row.result_json.completionManifest, MAX_HANDLER_MANIFEST_BYTES, invalidRow);
    const resultBinding = resultContentBinding(row);
    if (row.result_codec_version !== INBOX_CONTENT_CODEC_VERSION
      || row.result_digest_scheme !== INBOX_CONTENT_DIGEST_SCHEME
      || row.completion_manifest_digest_scheme !== INBOX_CONTENT_DIGEST_SCHEME
      || !/^[a-f0-9]{64}$/.test(row.result_digest)
      || !/^[a-f0-9]{64}$/.test(row.completion_manifest_digest)
      || !contentCodec.verifyDigest(row.result_json, row.result_digest, {
        purpose: "RESULT",
        binding: resultBinding,
        keyId: row.result_protection_key_id === null ? undefined : row.result_protection_key_id,
      })
      || !contentCodec.verifyDigest(row.result_json.completionManifest, row.completion_manifest_digest, {
        purpose: "MANIFEST",
        binding: resultBinding,
        keyId: row.result_protection_key_id === null ? undefined : row.result_protection_key_id,
      })) throw invalidRow();
    const manifest = row.result_json.completionManifest;
    if (!exactKeys(manifest, ["handlerEvidence", "handler", "successorOutboxFacts", "outboxFlush"])
      || !exactKeys(manifest.handlerEvidence, [
        "handlerId",
        "handlerVersion",
        "registryVersion",
        "registryDigest",
        "assemblySourceDigest",
        "registrationDigest",
        "descriptorDigest",
        "sourceDigest",
        "executedApplyStatementIds",
      ])
      || !byteEqual(manifest.handlerEvidence.handlerId, handlerEvidence.handlerId)
      || !byteEqual(manifest.handlerEvidence.handlerVersion, handlerEvidence.handlerVersion)
      || manifest.handlerEvidence.registryVersion !== handlerEvidence.registryVersion
      || !byteEqual(manifest.handlerEvidence.registryDigest, handlerEvidence.registryDigest)
      || !byteEqual(manifest.handlerEvidence.assemblySourceDigest, handlerEvidence.assemblySourceDigest)
      || !byteEqual(manifest.handlerEvidence.registrationDigest, handlerEvidence.registrationDigest)
      || !byteEqual(manifest.handlerEvidence.descriptorDigest, handlerEvidence.descriptorDigest)
      || !byteEqual(manifest.handlerEvidence.sourceDigest, handlerEvidence.sourceDigest)
      || !Array.isArray(manifest.handlerEvidence.executedApplyStatementIds)
      || manifest.handlerEvidence.executedApplyStatementIds.length
        !== new Set(manifest.handlerEvidence.executedApplyStatementIds).size
      || manifest.handlerEvidence.executedApplyStatementIds.some((statementId, index, values) => (
        !opaqueAscii(statementId, 128)
        || !handlerRegistration.descriptor.applyStatementIds.includes(statementId)
      ))
      || !matchesStatementExecutionProfile(
        manifest.handlerEvidence.executedApplyStatementIds,
        handlerRegistration.descriptor.applyExecutionProfiles
      )
      || !plainRecord(manifest.handler)
      || !Array.isArray(manifest.successorOutboxFacts)
      || !exactKeys(manifest.outboxFlush, ["inserted", "replayed"])
      || !Number.isSafeInteger(manifest.outboxFlush.inserted)
      || !Number.isSafeInteger(manifest.outboxFlush.replayed)
      || manifest.outboxFlush.inserted < 0
      || manifest.outboxFlush.replayed < 0
      || manifest.outboxFlush.inserted + manifest.outboxFlush.replayed !== manifest.successorOutboxFacts.length) throw invalidRow();
    const seenOutboxIds = new Set();
    const outboxContractCounts = new Map();
    for (const fact of manifest.successorOutboxFacts) {
      if (!exactKeys(fact, ["contractId", "outboxEventId", "immutableIdentity", "immutableIdentityDigest"])
        || !opaqueAscii(fact.contractId, 128)
        || !exactText(fact.outboxEventId, 64)
        || !plainRecord(fact.immutableIdentity)
        || !/^[a-f0-9]{64}$/.test(fact.immutableIdentityDigest)
        || seenOutboxIds.has(fact.outboxEventId)) throw invalidRow();
      const contract = outboxContractById.get(fact.contractId);
      const contractCount = (outboxContractCounts.get(fact.contractId) || 0) + 1;
      if (!contract
        || !handlerRegistration.descriptor.outboxContractIds.includes(fact.contractId)
        || contractCount > contract.maximumPerInvocation
        || !byteEqual(fact.immutableIdentity.topic, contract.topic)
        || !byteEqual(fact.immutableIdentity.event_type, contract.eventType)
        || !byteEqual(fact.immutableIdentity.schema_version, contract.schemaVersion)
        || !byteEqual(fact.immutableIdentity.source_name, contract.sourceName)) throw invalidRow();
      seenOutboxIds.add(fact.outboxEventId);
      outboxContractCounts.set(fact.contractId, contractCount);
      const expectedIdentity = boundedJsonSnapshot(fact.immutableIdentity, MAX_HANDLER_MANIFEST_BYTES, invalidRow);
      if (!byteEqual(expectedIdentity.digest, fact.immutableIdentityDigest)
        || !byteEqual(fact.outboxEventId, fact.immutableIdentity.outbox_event_id)) throw invalidRow();
      const outboxRows = selectedRows(await safeExecute(COMPLETION_OUTBOX_READ_SQL, [fact.outboxEventId]));
      if (outboxRows.length !== 1) throw persistenceFailure();
      let actualIdentity;
      try { actualIdentity = snapshotOutboxImmutableIdentity(outboxRows[0]); } catch { throw persistenceFailure(); }
      const actualSnapshot = boundedJsonSnapshot(actualIdentity, MAX_HANDLER_MANIFEST_BYTES, persistenceFailure);
      if (!byteEqual(actualSnapshot.digest, fact.immutableIdentityDigest)) throw persistenceFailure();
    }
    const verification = createVerifyContext({
      envelope: claim.envelope,
      result: clone(row.result_json.result),
      manifest: clone(manifest.handler),
    });
    let verified = false;
    try {
      verified = await handlerRegistration.verify(verification.context);
    } catch {
      throw persistenceFailure();
    }
    const executedVerifyStatementIds = [...verification.executedStatementIds];
    if (verified !== true
      || executedVerifyStatementIds.length !== new Set(executedVerifyStatementIds).size
      || executedVerifyStatementIds.some((statementId) => (
        !handlerRegistration.descriptor.verifyStatementIds.includes(statementId)
      ))
      || handlerRegistration.descriptor.requiredVerifyStatementIds.some((statementId) => (
        !executedVerifyStatementIds.includes(statementId)
      ))) throw persistenceFailure();
    return row.result_json;
  }

  async function readTransition(input) {
    assertActive();
    if (!exactKeys(input, ["claim", "transitionId", "expectedStatus", "expectedFailure"])
      || !opaqueAscii(input.transitionId, 128)
      || !TERMINAL_STATUSES.includes(input.expectedStatus)) throw invalidInput();
    const claim = normalizeClaim(input.claim);
    assertRegisteredScope({
      consumerName: claim.consumerName,
      handlerVersion: claim.handlerVersion,
      sourceName: claim.envelope.sourceName,
    });
    assertRegistrationEnvelope(handlerRegistration, claim.envelope);
    if ((input.expectedStatus === "SUCCEEDED" && input.expectedFailure !== null)
      || (input.expectedStatus !== "SUCCEEDED" && input.expectedFailure === null)) throw invalidInput();
    const expectedFailure = input.expectedFailure === null ? null : normalizeExpectedFailure(input.expectedFailure);
    const receiptRows = selectedRows(await safeExecute(TRANSITION_READ_SQL, [claim.receiptId]));
    if (receiptRows.length === 0) return Object.freeze({ state: "ABSENT" });
    if (receiptRows.length !== 1) throw persistenceFailure();
    const row = normalizeStoredReceiptRow(receiptRows[0]);
    assertEnvelopeMatchesRow(claim.envelope, row);
    if (row.status === input.expectedStatus
      && byteEqual(row.inbox_transition_id, input.transitionId)
      && row.lease_generation === claim.leaseGeneration) {
      assertTerminalClaimIdentity(claim, row);
      assertTerminalShape(row);
      if (row.status === "SUCCEEDED") {
        const checkpointRows = selectedRows(await safeExecute(CHECKPOINT_READ_SQL, [
          claim.consumerName,
          claim.envelope.sourceName,
          claim.envelope.partitionKey,
        ]));
        if (checkpointRows.length !== 1) throw persistenceFailure();
        const checkpoint = normalizeCheckpointRow(checkpointRows[0]);
        if (checkpoint.lastContiguousPosition < claim.envelope.partitionPosition) throw persistenceFailure();
        if (checkpoint.lastContiguousPosition === claim.envelope.partitionPosition
          && (!byteEqual(checkpoint.lastEventId, claim.envelope.eventId)
            || !byteEqual(checkpoint.lastReceiptId, claim.receiptId))) throw persistenceFailure();
        const persisted = await verifyCompletion(row, claim);
        return deepFreeze({
          state: "CONVERGED",
          result: {
            ...transitionResult(row, input.transitionId),
            result: persisted.result,
            completionManifest: persisted.completionManifest,
            resultDigest: row.result_digest,
            completionManifestDigest: row.completion_manifest_digest,
          },
        });
      }
      const failure = verifyFailureDecision(row, expectedFailure);
      if (row.status === "DEAD_LETTER") await verifyDeadLetter(row);
      return deepFreeze({ state: "CONVERGED", result: transitionResult(row, input.transitionId, failure) });
    }
    if (row.status === "CLAIMED"
      && byteEqual(row.lease_owner, claim.leaseOwner)
      && row.lease_generation === claim.leaseGeneration
      && byteEqual(row.inbox_transition_id, claim.claimTransitionId)) {
      assertClaimMatchesRow(claim, row);
      return Object.freeze({ state: "OWNED" });
    }
    return Object.freeze({ state: "LEASE_LOST" });
  }

  async function readRecoveryByTransition(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "sourceName", "partitionKey", "transitionId"])
      || !exactText(input.consumerName, 128)
      || !exactText(input.sourceName, 96)
      || !exactText(input.partitionKey, 191)
      || !opaqueAscii(input.transitionId, 128)) throw invalidInput();
    if (!byteEqual(input.consumerName, handlerRegistration.descriptor.consumerName)
      || !byteEqual(input.sourceName, handlerRegistration.descriptor.sourceName)) throw invalidInput();
    const checkpointRows = selectedRows(await safeExecute(CHECKPOINT_READ_SQL, [
      input.consumerName,
      input.sourceName,
      input.partitionKey,
    ]));
    if (checkpointRows.length !== 1) return Object.freeze({ state: "ABSENT" });
    const checkpoint = normalizeCheckpointRow(checkpointRows[0]);
    if (!byteEqual(checkpoint.handlerVersion, handlerRegistration.descriptor.handlerVersion)) throw envelopeConflict();
    const next = checkpoint.lastContiguousPosition + 1;
    const rows = selectedRows(await safeExecute(RECEIPT_READ_SQL.replace(
      "WHERE `consumer_name` = ? AND `event_id` = ?",
      "WHERE `consumer_name` = ? AND `source_name` = ? AND `partition_key` = ? AND `partition_position` = ?"
    ), [input.consumerName, input.sourceName, input.partitionKey, next]));
    if (rows.length === 0) return Object.freeze({ state: "ABSENT" });
    if (rows.length !== 1) throw persistenceFailure();
    const row = normalizeStoredReceiptRow(rows[0]);
    if (!byteEqual(row.inbox_transition_id, input.transitionId)
      || !["RETRY_PENDING", "DEAD_LETTER"].includes(row.status)) return Object.freeze({ state: "ABSENT" });
    const failure = verifyFailureDecision(row);
    if (row.status === "DEAD_LETTER") await verifyDeadLetter(row);
    return deepFreeze({ state: "CONVERGED", result: [transitionResult(row, input.transitionId, failure)] });
  }

  async function getCheckpoint(input) {
    assertActive();
    if (!exactKeys(input, ["consumerName", "handlerVersion", "sourceName", "partitionKey"])
      || !exactText(input.consumerName, 128)
      || !opaqueAscii(input.handlerVersion, 64)
      || !exactText(input.sourceName, 96)
      || !exactText(input.partitionKey, 191)) throw invalidInput();
    assertRegisteredScope(input);
    const rows = selectedRows(await safeExecute(CHECKPOINT_READ_SQL, [
      input.consumerName,
      input.sourceName,
      input.partitionKey,
    ]));
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw persistenceFailure();
    const checkpoint = normalizeCheckpointRow(rows[0]);
    if (!exactScope(checkpoint, input.consumerName, input.sourceName, input.partitionKey, input.handlerVersion)) {
      throw envelopeConflict();
    }
    return checkpoint;
  }

  function afterCommit() {
    assertActive();
    for (const outbox of nestedOutboxAdapters) {
      try { outbox.afterCommit(); } catch { outbox.discard(); }
    }
    nestedOutboxAdapters.clear();
    active = false;
    return Object.freeze({ committed: true });
  }

  function discard() {
    for (const outbox of nestedOutboxAdapters) {
      try { outbox.discard(); } catch {}
    }
    nestedOutboxAdapters.clear();
    active = false;
    return Object.freeze({ discarded: true });
  }

  return Object.freeze({
    receive,
    claimNext,
    completeOwned,
    failOwned,
    recoverExpired,
    readReceiptConvergence,
    readClaimByTransition,
    readTransition,
    readRecoveryByTransition,
    getCheckpoint,
    afterCommit,
    discard,
  });
}

module.exports = {
  createMysqlInboxCheckpointAdapter,
};
