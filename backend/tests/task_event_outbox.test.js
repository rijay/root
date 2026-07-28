const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTaskEventOutboxEnvelope,
} = require("../src/taskEventOutbox");
const {
  payloadSnapshot,
  stageOutboxEnvelope,
} = require("../src/eventTransport");

const OUTBOX_FIELDS = [
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
  "available_at",
  "next_retry_at",
  "lease_owner",
  "lease_expires_at",
  "last_error_json",
  "release_id",
  "succeeded_at",
  "dead_lettered_at",
  "created_at",
  "updated_at",
];

function taskEvent(overrides = {}) {
  return {
    task_event_id: "tev_task_envelope_1",
    root_user_id: "usr_sensitive_internal_identity",
    campaign_id: "ROOT_7D_RESET",
    task_definition_id: "td_root_7d_checkin",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    task_date: "2026-07-16",
    payload_json: {
      taskDate: "2026-07-16",
      stoolType: "type4",
      phone: "13800138000",
      openid: "oSensitiveOpenId",
      unionid: "uSensitiveUnionId",
      token: "sensitive-token",
      authorization: "Bearer sensitive-authorization",
      answers: { digestiveCondition: "sensitive-health-answer" },
      rawRequest: { secret: "raw-request-secret" },
    },
    idempotency_key: "sensitive-client-command-key",
    status: "RECORDED",
    source_channel: "MINIPROGRAM",
    occurred_at: "2026-07-16T18:11:12.123+08:00",
    created_at: "2026-07-16T10:11:12.789Z",
    ...overrides,
  };
}

test("builds the complete migration-006 envelope deterministically", () => {
  const options = {
    correlationId: "request-correlation-1",
    causationId: "command-causation-1",
    releaseId: "release-20260716",
  };
  const first = buildTaskEventOutboxEnvelope(taskEvent(), options);
  const replay = buildTaskEventOutboxEnvelope(taskEvent({
    payload_json: { changedSensitiveBody: true },
    root_user_id: "another-internal-user",
  }), options);

  assert.deepEqual(Object.keys(first), OUTBOX_FIELDS);
  assert.deepEqual(replay, first);
  assert.match(first.outbox_event_id, /^outbox_[a-f0-9]{48}$/);
  assert.ok(first.outbox_event_id.length <= 64);
  assert.equal(first.topic, "task.events");
  assert.equal(first.event_type, "task.event.recorded.v1");
  assert.equal(first.schema_version, "1");
  assert.equal(first.source_name, "myroot-api");
  assert.equal(first.partition_key, "task_event:tev_task_envelope_1");
  assert.equal(first.partition_position, 1);
  assert.equal(first.aggregate_type, "TASK_EVENT");
  assert.equal(first.aggregate_id, "tev_task_envelope_1");
  assert.equal(first.aggregate_version, 1);
  assert.equal(first.occurred_at, "2026-07-16T18:11:12.123+08:00");
  assert.equal(first.producer_version, "0.5.13");
  assert.equal(first.correlation_id, "request-correlation-1");
  assert.equal(first.causation_id, "command-causation-1");
  assert.equal(first.idempotency_key, "task-event:tev_task_envelope_1:v1");
  assert.equal(first.dedupe_key, "task-event:tev_task_envelope_1:v1");
  assert.equal(first.payload_digest, payloadSnapshot(first.payload_json).digest);
  assert.equal(first.status, "PENDING");
  assert.equal(first.attempt_count, 0);
  assert.equal(first.max_attempts, 5);
  assert.equal(first.available_at, "2026-07-16T10:11:12.789Z");
  assert.equal(first.created_at, "2026-07-16T10:11:12.789Z");
  assert.equal(first.updated_at, "2026-07-16T10:11:12.789Z");
  assert.equal(first.release_id, "release-20260716");
  [
    "next_retry_at",
    "lease_owner",
    "lease_expires_at",
    "last_error_json",
    "succeeded_at",
    "dead_lettered_at",
  ].forEach((field) => assert.equal(first[field], null, field));
});

test("uses an allowlisted payload that excludes identity, health and request secrets", () => {
  const envelope = buildTaskEventOutboxEnvelope(taskEvent());

  assert.deepEqual(envelope.payload_json, {
    taskEventId: "tev_task_envelope_1",
    taskType: "CHECKIN",
    eventType: "CHECKIN_COMPLETED",
  });
  ["campaignId", "taskDefinitionId", "taskDate", "status", "sourceChannel"].forEach((field) => {
    assert.equal(Object.prototype.hasOwnProperty.call(envelope.payload_json, field), false, field);
  });
  const persisted = JSON.stringify(envelope);
  [
    "usr_sensitive_internal_identity",
    "root_user_id",
    "stoolType",
    "13800138000",
    "oSensitiveOpenId",
    "uSensitiveUnionId",
    "sensitive-token",
    "sensitive-authorization",
    "sensitive-health-answer",
    "raw-request-secret",
    "sensitive-client-command-key",
  ].forEach((secret) => assert.equal(persisted.includes(secret), false, secret));
});

test("rejects incomplete identities and timestamps beyond DATETIME(3) precision", () => {
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent({ task_event_id: "" })),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent({ task_event_id: "x".repeat(65) })),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent({ occurred_at: "2026-07-16T10:11:12.1234Z" })),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent({ occurred_at: "2026-02-30T10:11:12.123Z" })),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent({ event_type: "13800138000-Bearer-secret" })),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent(), { sourceName: "request-controlled-source" }),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
  assert.throws(
    () => buildTaskEventOutboxEnvelope(taskEvent(), { partitionPosition: 2 }),
    (error) => error.code === "TASK_EVENT_OUTBOX_INPUT_INVALID"
  );
});

test("snapshot staging preserves the complete envelope and exact replay is a no-op", () => {
  const data = {};
  const envelope = buildTaskEventOutboxEnvelope(taskEvent());
  const first = stageOutboxEnvelope(data, envelope);
  envelope.payload_json.taskType = "MUTATED_AFTER_STAGE";
  const replay = stageOutboxEnvelope(data, buildTaskEventOutboxEnvelope(taskEvent()));

  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(data.eventOutbox.length, 1);
  assert.deepEqual(Object.keys(data.eventOutbox[0]), OUTBOX_FIELDS);
  assert.equal(data.eventOutbox[0].payload_json.taskType, "CHECKIN");
  assert.deepEqual(replay.event, data.eventOutbox[0]);
});

test("snapshot replay ignores dispatcher-owned runtime fields but not immutable fields", () => {
  const data = {};
  const envelope = buildTaskEventOutboxEnvelope(taskEvent());
  stageOutboxEnvelope(data, envelope);
  Object.assign(data.eventOutbox[0], {
    status: "SUCCEEDED",
    attempt_count: 2,
    next_retry_at: null,
    lease_owner: "worker-that-finished",
    lease_expires_at: "2026-07-16T10:12:12.789Z",
    last_error_json: { code: "SAFE_RETRY" },
    succeeded_at: "2026-07-16T10:13:12.789Z",
    updated_at: "2026-07-16T10:13:12.789Z",
  });

  const replay = stageOutboxEnvelope(data, buildTaskEventOutboxEnvelope(taskEvent()));
  assert.equal(replay.created, false);
  assert.equal(data.eventOutbox.length, 1);
  assert.equal(replay.event.status, "SUCCEEDED");
  assert.equal(replay.event.attempt_count, 2);
});

test("snapshot staging rejects incomplete envelopes and complete-envelope dedupe conflicts", () => {
  const data = {};
  const envelope = buildTaskEventOutboxEnvelope(taskEvent());
  stageOutboxEnvelope(data, envelope);

  const incomplete = { ...envelope };
  delete incomplete.aggregate_version;
  assert.throws(
    () => stageOutboxEnvelope({}, incomplete),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => stageOutboxEnvelope({}, { ...envelope, release_id: undefined }),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => stageOutboxEnvelope({}, { ...envelope, topic: "" }),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => stageOutboxEnvelope({}, { ...envelope, payload_digest: "0".repeat(64) }),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => stageOutboxEnvelope({}, { ...envelope, unexpected_field: "not-migration-006" }),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => stageOutboxEnvelope({}, { ...envelope, status: "CLAIMED", attempt_count: 1, lease_owner: "worker" }),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );

  const metadataReplay = stageOutboxEnvelope(data, {
    ...buildTaskEventOutboxEnvelope(taskEvent()),
    producer_version: "1.0.0",
    correlation_id: "different-correlation",
    causation_id: "different-causation",
    release_id: "different-release-containing-secret-token",
  });
  assert.equal(metadataReplay.created, false);
  assert.equal(metadataReplay.event.release_id, null);

  assert.throws(
    () => stageOutboxEnvelope(data, {
      ...buildTaskEventOutboxEnvelope(taskEvent()),
      aggregate_version: 2,
    }),
    (error) => error.code === "OUTBOX_DEDUPE_CONFLICT"
  );
  assert.equal(data.eventOutbox.length, 1);
});
