const crypto = require("node:crypto");
const { version: BACKEND_VERSION } = require("../package.json");
const { payloadSnapshot } = require("./eventTransport");

const TOPIC = "task.events";
const EVENT_TYPE = "task.event.recorded.v1";
const SCHEMA_VERSION = "1";
const DEFAULT_SOURCE_NAME = "myroot-api";
const AGGREGATE_TYPE = "TASK_EVENT";
const OPTION_KEYS = new Set([
  "producerVersion",
  "correlationId",
  "causationId",
  "releaseId",
  "maxAttempts",
]);

function inputError() {
  const error = new Error("task event outbox input is invalid");
  error.code = "TASK_EVENT_OUTBOX_INPUT_INVALID";
  return error;
}

function requiredText(value, maximumLength) {
  if (typeof value !== "string") throw inputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw inputError();
  return normalized;
}

function optionalText(value, maximumLength) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maximumLength);
}

function positiveInteger(value, fallback) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw inputError();
  return candidate;
}

function datetime3(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw inputError();
    return value.toISOString();
  }
  if (typeof value !== "string") throw inputError();
  const normalized = value.trim();
  const match = normalized.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/
  );
  if (!match) throw inputError();
  const [year, month, day] = match[1].split("-").map(Number);
  const [hour, minute, second] = match[2].split(":").map(Number);
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 || month > 12 ||
    day < 1 || day > maximumDay ||
    hour > 23 || minute > 59 || second > 59
  ) {
    throw inputError();
  }
  const validationValue = `${match[1]}T${match[2]}.${String(match[3] || "0").padEnd(3, "0")}${match[4] || "Z"}`;
  if (!Number.isFinite(new Date(validationValue).getTime())) throw inputError();
  return normalized;
}

function deterministicOutboxId(taskEventId) {
  const digest = crypto
    .createHash("sha256")
    .update(`myroot:task-event-outbox:v1:${taskEventId}`)
    .digest("hex");
  return `outbox_${digest.slice(0, 48)}`;
}

function buildTaskEventOutboxEnvelope(taskEvent, options = {}) {
  if (!taskEvent || typeof taskEvent !== "object" || Array.isArray(taskEvent)) throw inputError();
  if (!options || typeof options !== "object" || Array.isArray(options)) throw inputError();
  if (Object.keys(options).some((key) => !OPTION_KEYS.has(key))) throw inputError();

  const taskEventId = requiredText(taskEvent.task_event_id, 64);
  const taskType = requiredText(taskEvent.task_type, 64);
  const sourceEventType = requiredText(taskEvent.event_type, 96);
  const canonicalEventType = `${taskType}_COMPLETED`;
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(taskType) || sourceEventType !== canonicalEventType) {
    throw inputError();
  }
  const occurredAt = datetime3(taskEvent.occurred_at);
  const createdAt = datetime3(taskEvent.created_at || taskEvent.occurred_at);
  const producerVersion = requiredText(options.producerVersion || BACKEND_VERSION, 64);
  const correlationId = optionalText(options.correlationId, 128);
  const causationId = optionalText(options.causationId, 128);
  const releaseId = optionalText(options.releaseId, 96);
  const eventIdentity = `task-event:${taskEventId}:v1`;
  const payload = {
    taskEventId,
    taskType,
    eventType: canonicalEventType,
  };
  const snapshot = payloadSnapshot(payload);

  return {
    outbox_event_id: deterministicOutboxId(taskEventId),
    topic: TOPIC,
    event_type: EVENT_TYPE,
    schema_version: SCHEMA_VERSION,
    // v1 task events own a singleton partition: this namespace always has
    // exactly one positive position and cannot be extended by caller input.
    source_name: DEFAULT_SOURCE_NAME,
    partition_key: `task_event:${taskEventId}`,
    partition_position: 1,
    aggregate_type: AGGREGATE_TYPE,
    aggregate_id: taskEventId,
    aggregate_version: 1,
    occurred_at: occurredAt,
    producer_version: producerVersion,
    correlation_id: correlationId,
    causation_id: causationId,
    idempotency_key: eventIdentity,
    dedupe_key: eventIdentity,
    payload_json: snapshot.payload,
    payload_digest: snapshot.digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: positiveInteger(options.maxAttempts, 5),
    available_at: createdAt,
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_json: null,
    release_id: releaseId,
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

module.exports = {
  buildTaskEventOutboxEnvelope,
};
