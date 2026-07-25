const crypto = require("node:crypto");

const { version: BACKEND_VERSION } = require("../package.json");
const { payloadSnapshot } = require("./eventTransport");

const TOPIC = "activity.enrollment.events";
const SOURCE_NAME = "myroot-api";
const AGGREGATE_TYPE = "ACTIVITY_ENROLLMENT_TASK_SOURCE";
const SCHEMA_VERSION = "1";
const EVENT_TYPES = Object.freeze({
  CONFIRMED: "activity.enrollment.confirmed.v1",
  CANCELED: "activity.enrollment.canceled.v1",
});
const OPTION_KEYS = new Set([
  "producerVersion",
  "correlationId",
  "causationId",
  "releaseId",
  "maxAttempts",
]);

function inputError() {
  const error = new Error("activity task outbox input is invalid");
  error.code = "ACTIVITY_TASK_OUTBOX_INPUT_INVALID";
  return error;
}

function requiredText(value, maximumLength) {
  if (typeof value !== "string") throw inputError();
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > maximumLength) throw inputError();
  return normalized;
}

function optionalText(value, maximumLength) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maximumLength);
}

function positiveInteger(value, fallback) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1) throw inputError();
  return candidate;
}

function datetime3(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw inputError();
    return value.toISOString();
  }
  if (typeof value !== "string" || value !== value.trim()) throw inputError();
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/
  );
  if (!match) throw inputError();
  const normalized = `${match[1]}T${match[2]}.${String(match[3] || "0").padEnd(3, "0")}${match[4] || "Z"}`;
  if (!Number.isFinite(new Date(normalized).getTime())) throw inputError();
  return value;
}

function deterministicId(domain, value, prefix, digestLength) {
  const digest = crypto.createHash("sha256").update(`${domain}:${value}`, "utf8").digest("hex");
  return `${prefix}${digest.slice(0, digestLength)}`;
}

function assignmentId(enrollmentId, taskDefinitionId, taskDefinitionVersion) {
  return deterministicId(
    "myroot:activity-task-assignment:v1",
    `${enrollmentId}\0${taskDefinitionId}\0${taskDefinitionVersion}`,
    "activity_task_",
    50
  );
}

function normalizeTransition(event) {
  const toStatus = requiredText(event.to_status, 16);
  const fromStatus = event.from_status === null ? null : requiredText(event.from_status, 16);
  const operation = requiredText(event.operation, 32);
  const reasonCode = event.reason_code === null ? null : optionalText(event.reason_code, 32);

  if (toStatus === "CONFIRMED"
    && ["ENROLL", "REVIEW"].includes(operation)
    && [null, "PENDING"].includes(fromStatus)
    && reasonCode === null) {
    return Object.freeze({ kind: "CONFIRMED", position: 1, reasonCode: null });
  }
  if (toStatus === "CANCELED"
    && ["CANCEL", "SESSION_CANCEL"].includes(operation)
    && fromStatus === "CONFIRMED"
    && ["USER_CANCELED", "SESSION_CANCELED"].includes(reasonCode)) {
    return Object.freeze({ kind: "CANCELED", position: 2, reasonCode });
  }
  if (["PENDING", "REJECTED"].includes(toStatus)
    || (toStatus === "CANCELED" && fromStatus === "PENDING")) return null;
  throw inputError();
}

function buildActivityTaskOutboxEnvelope(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => !OPTION_KEYS.has(key))) throw inputError();
  const event = input.enrollmentEvent;
  if (!event || typeof event !== "object" || Array.isArray(event)) throw inputError();

  const activityEnrollmentEventId = requiredText(event.activity_enrollment_event_id, 64);
  const activityEnrollmentId = requiredText(event.activity_enrollment_id, 64);
  const activitySessionId = requiredText(event.activity_session_id, 64);
  const rootUserId = requiredText(event.root_user_id, 32);
  positiveInteger(event.event_sequence);
  const occurredAt = datetime3(event.occurred_at);
  const transition = normalizeTransition(event);
  if (!transition) return null;

  const binding = input.binding;
  if (binding === undefined || binding === null) return null;
  if (typeof binding !== "object" || Array.isArray(binding)) throw inputError();
  const taskDefinitionId = requiredText(
    binding.taskDefinitionId || binding.task_definition_id,
    32
  );
  const taskDefinitionVersion = requiredText(
    binding.taskDefinitionVersion || binding.task_definition_version,
    64
  );
  const activityTaskAssignmentId = assignmentId(
    activityEnrollmentId,
    taskDefinitionId,
    taskDefinitionVersion
  );
  const eventType = EVENT_TYPES[transition.kind];
  const producerVersion = requiredText(options.producerVersion || BACKEND_VERSION, 64);
  const correlationId = optionalText(options.correlationId, 128);
  const causationId = optionalText(options.causationId || activityEnrollmentEventId, 128);
  const releaseId = optionalText(options.releaseId, 96);
  const idempotencyKey = transition.kind === "CONFIRMED"
    ? `activity-enrollment:${activityEnrollmentId}:task:${taskDefinitionId}:${taskDefinitionVersion}`
    : `activity-event:${activityEnrollmentEventId}:task:${activityTaskAssignmentId}`;
  const payload = {
    activityEnrollmentEventId,
    activityEnrollmentId,
    activitySessionId,
    activityTaskAssignmentId,
    rootUserId,
    taskDefinitionId,
    taskDefinitionVersion,
    transition: transition.kind,
    reasonCode: transition.reasonCode,
  };
  const snapshot = payloadSnapshot(payload);
  const outboxEventId = deterministicId(
    "myroot:activity-task-outbox:v1",
    `${activityEnrollmentEventId}\0${eventType}`,
    "outbox_",
    48
  );

  return {
    outbox_event_id: outboxEventId,
    topic: TOPIC,
    event_type: eventType,
    schema_version: SCHEMA_VERSION,
    source_name: SOURCE_NAME,
    partition_key: `activity_task_assignment:${activityTaskAssignmentId}`,
    partition_position: transition.position,
    aggregate_type: AGGREGATE_TYPE,
    aggregate_id: activityTaskAssignmentId,
    aggregate_version: transition.position,
    occurred_at: occurredAt,
    producer_version: producerVersion,
    correlation_id: correlationId,
    causation_id: causationId,
    idempotency_key: idempotencyKey,
    dedupe_key: idempotencyKey,
    payload_json: snapshot.payload,
    payload_digest: snapshot.digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: positiveInteger(options.maxAttempts, 5),
    available_at: occurredAt,
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_json: null,
    release_id: releaseId,
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: occurredAt,
    updated_at: occurredAt,
  };
}

module.exports = Object.freeze({
  buildActivityTaskOutboxEnvelope,
});
