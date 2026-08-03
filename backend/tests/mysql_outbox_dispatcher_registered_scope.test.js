const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");
const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");
const { createMysqlOutboxDispatcher } = require("../src/mysqlOutboxDispatcher");
const { createMysqlOutboxDispatcherAdapter } = require("../src/mysqlOutboxDispatcherAdapter");
const { OUTBOX_RETRY_POLICY_V1 } = require("../src/outboxRetryPolicy");

const NOW = "2026-07-17 10:00:00.000";

function registration() {
  return getDefaultInboxHandlerRegistry().assertScope({
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    sourceName: "myroot-api",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outboxRow(overrides = {}) {
  const taskEventId = overrides.aggregate_id || "task-event-registered-1";
  const payload = overrides.payload_json || {
    taskEventId,
    taskType: "SHARE",
    eventType: "SHARE_COMPLETED",
  };
  return {
    outbox_event_id: overrides.outbox_event_id || "outbox-registered-1",
    topic: "task.events",
    event_type: "task.event.recorded.v1",
    schema_version: "1",
    source_name: "myroot-api",
    partition_key: `task_event:${taskEventId}`,
    partition_position: 1,
    aggregate_type: "TASK_EVENT",
    aggregate_id: taskEventId,
    aggregate_version: 1,
    occurred_at: "2026-07-17 09:59:00.000",
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: `task-event:${taskEventId}:v1`,
    dedupe_key: `task-event:${taskEventId}:v1`,
    payload_json: payload,
    payload_digest: payloadSnapshot(payload).digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: 5,
    retry_policy_version: "outbox-retry-v1",
    available_at: "2026-07-17 09:59:30.000",
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    lease_generation: 0,
    dispatch_transition_id: null,
    last_error_json: null,
    release_id: null,
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-17 09:59:00.000",
    updated_at: "2026-07-17 09:59:00.000",
    ...overrides,
  };
}

function isRegisteredShare(row) {
  return row.topic === "task.events"
    && row.source_name === "myroot-api"
    && row.event_type === "task.event.recorded.v1"
    && row.schema_version === "1"
    && row.aggregate_type === "TASK_EVENT"
    && row.partition_position === 1
    && row.aggregate_version === 1
    && row.payload_json
    && Object.keys(row.payload_json).length === 3
    && row.payload_json.taskType === "SHARE"
    && row.payload_json.eventType === "SHARE_COMPLETED"
    && row.payload_json.taskEventId === row.aggregate_id
    && row.partition_key === `task_event:${row.aggregate_id}`
    && row.idempotency_key === `task-event:${row.aggregate_id}:v1`
    && row.dedupe_key === row.idempotency_key;
}

function createRegisteredConnection(initialRows) {
  const state = { rows: initialRows.map(clone), calls: [] };
  const due = (row) => (row.status === "PENDING" && row.available_at <= NOW)
    || (row.status === "RETRY_PENDING" && row.next_retry_at <= NOW);
  const connection = {
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      const match = compact.match(/\/\* outbox_dispatcher:([a-z_]+) \*\//);
      const tag = match && match[1];
      state.calls.push({ tag, sql: compact, values: clone(values) });
      if (tag === "claim_registered_due_select") {
        assert.match(compact, /candidate\.`topic` = \?/);
        assert.match(compact, /JSON_UNQUOTE\(JSON_EXTRACT\(candidate\.`payload_json`, '\$\.taskType'\)\) = 'SHARE'/);
        assert.match(compact, /candidate\.`partition_position` = 1/);
        assert.deepEqual(values.slice(0, 6), [
          "outbox-retry-v1", "task.events", "myroot-api", "task.event.recorded.v1",
          "1", "TASK_EVENT",
        ]);
        return [state.rows.filter((row) => due(row) && isRegisteredShare(row)).slice(0, values[6]).map(clone), []];
      }
      if (tag === "claim_update") {
        const [workerId, , transitionId, , outboxEventId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
        if (!row || !isRegisteredShare(row) || !due(row)) return [{ affectedRows: 0 }, []];
        row.status = "CLAIMED";
        row.attempt_count += 1;
        row.lease_generation += 1;
        row.lease_owner = workerId;
        row.lease_expires_at = "2026-07-17 10:00:30.000";
        row.dispatch_transition_id = transitionId;
        row.next_retry_at = null;
        return [{ affectedRows: 1 }, []];
      }
      if (tag === "claim_read") {
        const [outboxEventId, workerId, generation, transitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId
          && candidate.status === "CLAIMED"
          && candidate.lease_owner === workerId
          && candidate.lease_generation === generation
          && candidate.dispatch_transition_id === transitionId);
        return [row ? [clone(row)] : [], []];
      }
      if (tag === "recover_registered_expired_select") {
        assert.match(compact, /candidate\.`topic` = \?/);
        assert.match(compact, /JSON_UNQUOTE\(JSON_EXTRACT\(candidate\.`payload_json`, '\$\.taskType'\)\) = 'SHARE'/);
        assert.deepEqual(values.slice(0, 6), [
          "outbox-retry-v1", "task.events", "myroot-api", "task.event.recorded.v1",
          "1", "TASK_EVENT",
        ]);
        return [state.rows.filter((row) => row.status === "CLAIMED"
          && row.lease_expires_at <= NOW
          && isRegisteredShare(row)).slice(0, values[6]).map(clone), []];
      }
      if (tag === "recovery_retry_update") {
        const outboxEventId = values[4];
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
        if (!row || !isRegisteredShare(row)) return [{ affectedRows: 0 }, []];
        row.status = "RETRY_PENDING";
        row.retry_policy_version = values[0];
        row.next_retry_at = "2026-07-17 10:00:01.000";
        row.last_error_json = JSON.parse(values[2]);
        row.dispatch_transition_id = values[3];
        row.lease_owner = null;
        row.lease_expires_at = null;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected statement ${tag}`);
    },
  };
  return { connection, state };
}

function dispatcherClaim() {
  const row = outboxRow({
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "registered-worker-1",
    lease_expires_at: "2026-07-17 10:00:30.000",
    lease_generation: 1,
    dispatch_transition_id: "registered-transition-1",
  });
  return {
    outboxEventId: row.outbox_event_id,
    leaseOwner: row.lease_owner,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicyVersion: row.retry_policy_version,
    claimTransitionId: row.dispatch_transition_id,
    payloadDigest: row.payload_digest,
    envelope: {
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
      payload: row.payload_json,
      payloadDigest: row.payload_digest,
      releaseId: row.release_id,
    },
  };
}

test("Dispatcher registered claim accepts only a branded Registration and exposes no caller-selected scope", async () => {
  const calls = [];
  const expected = dispatcherClaim();
  const adapter = {
    async claimRegistered(input) { calls.push(input); return [expected]; },
    discard() {},
  };
  const connection = {
    adapter,
    async execute() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    destroy() {},
  };
  let connections = 0;
  const dispatcher = createMysqlOutboxDispatcher({
    pool: { async getConnection() { connections += 1; return connection; } },
    workerId: "registered-worker-1",
    transitionIdFactory: () => "registered-transition-1",
    adapterFactory: (value) => value.adapter,
  });
  const resolved = registration();
  assert.deepEqual(await dispatcher.claimRegistered(resolved, { limit: 1 }), [expected]);
  assert.equal(calls[0].handlerRegistration, resolved);
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    "handlerRegistration", "leaseSeconds", "limit", "retryPolicyVersion", "transitionId", "workerId",
  ]);
  assert.equal(calls[0].workerId, expected.leaseOwner);
  const forged = clone(resolved);
  await assert.rejects(
    () => dispatcher.claimRegistered(forged, { limit: 1 }),
    (error) => error.code === "OUTBOX_DISPATCH_INPUT_INVALID"
  );
  await assert.rejects(
    () => dispatcher.claimRegistered(resolved, { limit: 1, topic: "task.events" }),
    (error) => error.code === "OUTBOX_DISPATCH_INPUT_INVALID"
  );
  assert.equal(connections, 1);
});

test("registered Adapter claim leaves CHECKIN and other topics untouched while incrementing owner/generation/transition fencing", async () => {
  const share = outboxRow();
  const checkinPayload = {
    taskEventId: "task-event-checkin-1",
    taskType: "CHECKIN",
    eventType: "CHECKIN_COMPLETED",
  };
  const checkin = outboxRow({
    outbox_event_id: "outbox-checkin-1",
    aggregate_id: "task-event-checkin-1",
    partition_key: "task_event:task-event-checkin-1",
    idempotency_key: "task-event:task-event-checkin-1:v1",
    dedupe_key: "task-event:task-event-checkin-1:v1",
    payload_json: checkinPayload,
    payload_digest: payloadSnapshot(checkinPayload).digest,
  });
  const other = outboxRow({
    outbox_event_id: "outbox-other-1",
    aggregate_id: "task-event-other-1",
    partition_key: "task_event:task-event-other-1",
    idempotency_key: "task-event:task-event-other-1:v1",
    dedupe_key: "task-event:task-event-other-1:v1",
    topic: "notification.events",
  });
  const harness = createRegisteredConnection([share, checkin, other]);
  const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
  const claims = await adapter.claimRegistered({
    workerId: "registered-worker-1",
    transitionId: "registered-transition-1",
    limit: 10,
    leaseSeconds: 30,
    retryPolicyVersion: "outbox-retry-v1",
    handlerRegistration: registration(),
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].outboxEventId, share.outbox_event_id);
  assert.equal(claims[0].leaseOwner, "registered-worker-1");
  assert.equal(claims[0].leaseGeneration, 1);
  assert.equal(claims[0].claimTransitionId, "registered-transition-1");
  assert.equal(harness.state.rows.find((row) => row.outbox_event_id === checkin.outbox_event_id).status, "PENDING");
  assert.equal(harness.state.rows.find((row) => row.outbox_event_id === checkin.outbox_event_id).attempt_count, 0);
  assert.equal(harness.state.rows.find((row) => row.outbox_event_id === other.outbox_event_id).status, "PENDING");
  assert.equal(harness.state.calls.some((call) => call.tag === "claim_due_select"), false);
});

test("registered recovery applies the existing policy only to expired SHARE claims and never fails unsupported facts", async () => {
  const share = outboxRow({
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "old-share-owner",
    lease_expires_at: "2026-07-17 09:59:59.000",
    lease_generation: 1,
    dispatch_transition_id: "old-share-transition",
  });
  const checkinPayload = {
    taskEventId: "task-event-checkin-1",
    taskType: "CHECKIN",
    eventType: "CHECKIN_COMPLETED",
  };
  const checkin = outboxRow({
    outbox_event_id: "outbox-checkin-1",
    aggregate_id: "task-event-checkin-1",
    partition_key: "task_event:task-event-checkin-1",
    idempotency_key: "task-event:task-event-checkin-1:v1",
    dedupe_key: "task-event:task-event-checkin-1:v1",
    payload_json: checkinPayload,
    payload_digest: payloadSnapshot(checkinPayload).digest,
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "old-checkin-owner",
    lease_expires_at: "2026-07-17 09:59:59.000",
    lease_generation: 1,
    dispatch_transition_id: "old-checkin-transition",
  });
  const harness = createRegisteredConnection([share, checkin]);
  const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
  const result = await adapter.recoverExpiredRegistered({
    transitionId: "registered-recovery-transition-1",
    limit: 10,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
    handlerRegistration: registration(),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].outboxEventId, share.outbox_event_id);
  assert.equal(result[0].status, "RETRY_PENDING");
  assert.equal(harness.state.rows.find((row) => row.outbox_event_id === checkin.outbox_event_id).status, "CLAIMED");
  assert.equal(harness.state.rows.find((row) => row.outbox_event_id === checkin.outbox_event_id).dispatch_transition_id, "old-checkin-transition");
  assert.equal(harness.state.calls.filter((call) => call.tag === "recovery_retry_update").length, 1);
  assert.equal(harness.state.calls.some((call) => call.tag === "recover_expired_select"), false);
});
