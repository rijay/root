const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { payloadSnapshot } = require("../src/eventTransport");
const { createInboxContentCodec } = require("../src/inboxContentProtection");
const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");
const { getDefaultInboxReplayPolicyRegistry } = require("../src/inboxReplayPolicyRegistry");
const {
  getDefaultInboxReplayExecutorRegistry,
} = require("../src/inboxReplayExecutorRegistry");
const {
  createMysqlInboxShadowReplayRunner,
} = require("../src/mysqlInboxShadowReplayRunner");

const NOW = "2026-07-17 10:00:00.000";
const SNAPSHOT = "2026-07-17 09:30:00.000";
const RECEIVED = "2026-07-17 09:00:00.000";
const CONTENT_ENV = Object.freeze({
  NODE_ENV: "test",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "shadow-replay-runner-test-secret-v1-2026-07-17",
  ROOT_INBOX_CONTENT_KEY_ID: "shadow-replay-runner-test-key-v1",
});
const ENABLED_ENV = Object.freeze({
  ...CONTENT_ENV,
  MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED: "true",
});
const DISABLED_ENV = Object.freeze({ ...CONTENT_ENV });
const CODEC = createInboxContentCodec(CONTENT_ENV);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function executionConsumerName(replayRunId) {
  return `task-share-shadow-rebuild-v1:${crypto.createHash("sha256")
    .update("myroot-inbox-replay-execution-consumer:v1\0", "utf8")
    .update(replayRunId, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function toIso(mysql) {
  return new Date(`${mysql.replace(" ", "T")}+08:00`).toISOString();
}

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

function policy() {
  const registry = getDefaultInboxReplayPolicyRegistry().describe();
  return {
    registry,
    policy: registry.policies.find((entry) => (
      entry.policyId === "TASK_SHARE_SHADOW_REBUILD_V1"
    )),
  };
}

function executor() {
  return getDefaultInboxReplayExecutorRegistry().resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
}

function baseReceipt(overrides = {}) {
  const source = registration();
  const payload = { taskEventId: "task-event-shadow-001", taskType: "SHARE", eventType: "SHARE_COMPLETED" };
  const row = {
    inbox_receipt_id: "receipt-shadow-001",
    first_received_at: RECEIVED,
    consumer_name: source.descriptor.consumerName,
    source_name: source.descriptor.sourceName,
    partition_key: "task_event:task-event-shadow-001",
    partition_position: 1,
    event_id: "event-shadow-001",
    event_type: source.descriptor.eventType,
    schema_version: source.descriptor.schemaVersion,
    aggregate_type: source.descriptor.aggregateType,
    aggregate_id: "task-event-shadow-001",
    aggregate_version: 1,
    occurred_at: "2026-07-17 08:59:00.000",
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: "task-event:task-event-shadow-001",
    handler_version: source.descriptor.handlerVersion,
    handler_id: source.descriptor.handlerId,
    handler_registry_version: source.registryVersion,
    handler_descriptor_digest: source.descriptor.descriptorDigest,
    handler_source_digest: source.descriptor.sourceDigest,
    handler_registration_digest: source.registrationDigest,
    payload_json: null,
    payload_codec_version: "A256GCM:v1",
    payload_key_id: CONTENT_ENV.ROOT_INBOX_CONTENT_KEY_ID,
    payload_digest_scheme: "hmac-sha256:v1",
    payload_digest: null,
    status: "SUCCEEDED",
    ...overrides,
  };
  const sealed = CODEC.seal(payload, { purpose: "PAYLOAD", binding: payloadBinding(row) });
  row.payload_json = sealed.stored;
  row.payload_digest = sealed.contentDigest;
  return row;
}

function payloadBinding(row) {
  return {
    consumerName: row.consumer_name,
    handlerVersion: row.handler_version,
    handlerId: row.handler_id,
    handlerRegistryVersion: row.handler_registry_version,
    handlerDescriptorDigest: row.handler_descriptor_digest,
    handlerSourceDigest: row.handler_source_digest,
    handlerRegistrationDigest: row.handler_registration_digest,
    sourceName: row.source_name,
    partitionKey: row.partition_key,
    partitionPosition: row.partition_position,
    eventId: row.event_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    producerVersion: row.producer_version,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
  };
}

function baseRun(receipts, overrides = {}) {
  const source = registration();
  const state = policy();
  const execution = executor();
  const selectionDigest = digest("myroot-inbox-replay-selection:v1", {
    registryDigest: state.registry.registryDigest,
    policyDigest: state.policy.policyDigest,
    selectionQueryDigest: state.policy.selectionQueryDigest,
    snapshotAt: toIso(SNAPSHOT),
    lowerCursor: null,
    receipts: receipts.map((row) => ({
      receivedAt: toIso(row.first_received_at),
      receiptId: row.inbox_receipt_id,
    })),
  });
  const upper = receipts.at(-1);
  return {
    replay_run_id: "replay-shadow-run-001",
    replay_mode: "SHADOW_REBUILD",
    status: "APPROVED",
    policy_registry_version: state.registry.registryVersion,
    policy_registry_digest: state.registry.registryDigest,
    policy_id: state.policy.policyId,
    policy_version: state.policy.policyVersion,
    policy_digest: state.policy.policyDigest,
    consumer_name: source.descriptor.consumerName,
    source_name: source.descriptor.sourceName,
    event_type: source.descriptor.eventType,
    schema_version: source.descriptor.schemaVersion,
    aggregate_type: source.descriptor.aggregateType,
    source_receipt_status: "SUCCEEDED",
    source_handler_id: source.descriptor.handlerId,
    source_handler_version: source.descriptor.handlerVersion,
    source_handler_registry_version: source.registryVersion,
    source_handler_descriptor_digest: source.descriptor.descriptorDigest,
    source_handler_source_digest: source.descriptor.sourceDigest,
    source_handler_registration_digest: source.registrationDigest,
    execution_consumer_name: executionConsumerName("replay-shadow-run-001"),
    execution_handler_id: state.policy.handlerId,
    execution_handler_version: state.policy.handlerVersion,
    execution_executor_registry_version: execution.registryVersion,
    execution_executor_registry_digest: execution.registryDigest,
    execution_executor_descriptor_digest: execution.descriptor.descriptorDigest,
    execution_executor_source_digest: execution.descriptor.sourceDigest,
    execution_executor_registration_digest: execution.registrationDigest,
    target_projection_policy: state.policy.targetProjectionPolicy,
    shadow_generation: 2,
    cursor_version: state.policy.selectionCursorType,
    selection_query_id: "task_share_succeeded_receipts_by_received_at_v1",
    selection_query_digest: state.policy.selectionQueryDigest,
    selection_after_first_received_at: null,
    selection_after_receipt_id: null,
    selection_through_first_received_at: upper.first_received_at,
    selection_through_receipt_id: upper.inbox_receipt_id,
    selection_snapshot_at: SNAPSHOT,
    selection_digest: selectionDigest,
    maximum_selected_count: 10000,
    selected_receipt_count: receipts.length,
    authorization_expires_at: "2026-07-17 11:00:00.000",
    lease_owner: null,
    lease_expires_at: null,
    lease_generation: 0,
    replay_transition_id: null,
    processed_receipt_count: 0,
    verified_receipt_count: 0,
    shadow_inserted_count: 0,
    shadow_replayed_count: 0,
    failed_receipt_count: 0,
    result_digest: null,
    last_error_code: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function materializeShadow(values) {
  const keys = [
    "shadow_projection_id", "replay_run_id", "projection_generation",
    "source_receipt_id", "task_event_id", "source_event_id", "source_event_type",
    "source_schema_version", "source_name", "source_partition_key",
    "source_partition_position", "source_aggregate_version", "task_type",
    "completion_event_type", "occurred_at", "source_handler_registration_digest",
    "execution_handler_id", "execution_handler_version",
  ];
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function createPool(options = {}) {
  const receipts = options.receipts || [baseReceipt()];
  const state = {
    run: options.run || baseRun(receipts),
    shadows: clone(options.shadows || []),
  };
  const telemetry = {
    executes: [],
    begins: 0,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    destroys: 0,
    claimLeaseExpiresAt: null,
  };
  let commitCalls = 0;
  return {
    state,
    telemetry,
    async getConnection() {
      let backup = null;
      return {
        async execute(sql, values = []) {
          telemetry.executes.push({ sql, values: clone(values) });
          if (/^SET SESSION time_zone/.test(sql) || /^SET TRANSACTION ISOLATION LEVEL/.test(sql)) return [[], []];
          if (/inbox_shadow_replay:run_read/.test(sql)) {
            return [[{ ...clone(state.run), db_now: options.now || NOW }], []];
          }
          if (/inbox_shadow_replay:claim/.test(sql)) {
            if (state.run.lease_generation !== values[5]) return [{ affectedRows: 0 }, []];
            const nowEpoch = new Date(`${(options.now || NOW).replace(" ", "T")}+08:00`).getTime();
            const authorizationEpoch = new Date(
              `${state.run.authorization_expires_at.replace(" ", "T")}+08:00`
            ).getTime();
            if (authorizationEpoch <= nowEpoch) return [{ affectedRows: 0 }, []];
            const leaseEpoch = Math.min(nowEpoch + values[1] * 1_000, authorizationEpoch);
            const leaseExpiresAt = new Date(leaseEpoch + 8 * 60 * 60 * 1_000)
              .toISOString().slice(0, 23).replace("T", " ");
            state.run.status = "RUNNING";
            state.run.lease_owner = values[0];
            state.run.lease_expires_at = leaseExpiresAt;
            telemetry.claimLeaseExpiresAt = leaseExpiresAt;
            state.run.lease_generation = values[2];
            state.run.replay_transition_id = values[3];
            state.run.started_at = state.run.started_at || NOW;
            return [{ affectedRows: 1 }, []];
          }
          if (/inbox_shadow_replay:expire/.test(sql)) {
            state.run.status = "EXPIRED";
            state.run.last_error_code = "AUTHORIZATION_EXPIRED";
            state.run.completed_at = NOW;
            return [{ affectedRows: 1 }, []];
          }
          if (/inbox_shadow_replay:source_identity_drift/.test(sql)) {
            return [[{ registration_drift_count: options.registrationDriftCount || 0 }], []];
          }
          if (/inbox_shadow_replay:source_selection/.test(sql)) {
            return [[...clone(options.selectedRows || receipts)], []];
          }
          if (/FROM task_share_completion_shadow_projection/.test(sql)) {
            const matches = state.shadows.filter((row) => (
              (row.replay_run_id === values[0] && row.source_receipt_id === values[1])
              || (row.projection_generation === values[2]
                && (row.task_event_id === values[3] || row.source_event_id === values[4]))
            ));
            return [clone(matches), []];
          }
          if (/^INSERT INTO task_share_completion_shadow_projection/.test(sql)) {
            state.shadows.push(materializeShadow(values));
            return [{ affectedRows: 1 }, []];
          }
          if (/inbox_shadow_replay:succeed/.test(sql)) {
            if (state.run.lease_owner !== values[6] || state.run.lease_generation !== values[7]
              || state.run.replay_transition_id !== values[8]) return [{ affectedRows: 0 }, []];
            const succeedEpoch = new Date(
              `${(options.succeedNow || options.now || NOW).replace(" ", "T")}+08:00`
            ).getTime();
            const authorizationEpoch = new Date(
              `${state.run.authorization_expires_at.replace(" ", "T")}+08:00`
            ).getTime();
            if (authorizationEpoch <= succeedEpoch) return [{ affectedRows: 0 }, []];
            state.run.status = "SUCCEEDED";
            state.run.lease_owner = null;
            state.run.lease_expires_at = null;
            state.run.processed_receipt_count = values[0];
            state.run.verified_receipt_count = values[1];
            state.run.shadow_inserted_count = values[2];
            state.run.shadow_replayed_count = values[3];
            state.run.failed_receipt_count = 0;
            state.run.result_digest = values[4];
            state.run.completed_at = NOW;
            return [{ affectedRows: 1 }, []];
          }
          if (/inbox_shadow_replay:fail/.test(sql)) {
            state.run.status = "FAILED";
            state.run.lease_owner = null;
            state.run.lease_expires_at = null;
            state.run.last_error_code = values[0];
            state.run.completed_at = NOW;
            return [{ affectedRows: 1 }, []];
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
        async beginTransaction() { backup = clone(state); telemetry.begins += 1; },
        async commit() {
          telemetry.commits += 1;
          commitCalls += 1;
          backup = null;
          if (options.commitErrorAt === commitCalls) throw Object.assign(new Error("ack unknown"), { code: "ECONNRESET" });
        },
        async rollback() {
          telemetry.rollbacks += 1;
          if (backup && !options.preserveCommitOnRollback) {
            state.run = backup.run;
            state.shadows = backup.shadows;
          }
          backup = null;
        },
        release() { telemetry.releases += 1; },
        destroy() { telemetry.destroys += 1; },
      };
    },
  };
}

function runner(pool, env = ENABLED_ENV) {
  return createMysqlInboxShadowReplayRunner({ pool, env });
}

function runInput(overrides = {}) {
  return { replayRunId: "replay-shadow-run-001", leaseOwner: "runner-worker-001", leaseSeconds: 300, ...overrides };
}

test("Runner exposes only the small run Interface and is disabled by default", async () => {
  const pool = createPool();
  const module = runner(pool, DISABLED_ENV);
  assert.deepEqual(Object.keys(module), ["run"]);
  assert.equal(Object.isFrozen(module), true);
  await assert.rejects(() => module.run(runInput()), (error) => error.code === "INBOX_SHADOW_REPLAY_DISABLED");
  assert.equal(pool.telemetry.executes.length, 0);
  for (const extra of [{ contentCodec: CODEC }, { executorRegistry: {} }]) {
    assert.throws(
      () => createMysqlInboxShadowReplayRunner({ pool, env: ENABLED_ENV, ...extra }),
      (error) => error.code === "INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID"
    );
  }
  const insecure = createMysqlInboxShadowReplayRunner({
    pool,
    env: {
      NODE_ENV: "production",
      MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED: "true",
    },
  });
  await assert.rejects(
    () => insecure.run(runInput()),
    (error) => error.code === "INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID"
  );
  assert.equal(pool.telemetry.executes.length, 0);
});

test("Runner claims a generation fence, replays to shadow only and persists exact counts", async () => {
  const pool = createPool();
  const result = await runner(pool).run(runInput());
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.processedCount, 1);
  assert.equal(result.verifiedCount, 1);
  assert.equal(result.shadowInsertedCount, 1);
  assert.equal(result.shadowReplayedCount, 0);
  assert.match(result.resultDigest, /^[a-f0-9]{64}$/);
  assert.equal(pool.state.run.lease_generation, 1);
  assert.equal(pool.state.shadows.length, 1);
  assert.equal(pool.state.shadows[0].projection_generation, 2);
  assert.equal(pool.state.shadows[0].execution_handler_id, "task-share-completion-shadow-v1");

  const writes = pool.telemetry.executes.filter((call) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(call.sql));
  assert.ok(writes.some((call) => /UPDATE inbox_replay_run/.test(call.sql)));
  assert.ok(writes.some((call) => /INSERT INTO task_share_completion_shadow_projection/.test(call.sql)));
  for (const call of writes) {
    assert.doesNotMatch(call.sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+`?inbox_receipt/i);
    assert.doesNotMatch(call.sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+`?outbox_event/i);
    assert.doesNotMatch(call.sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+`?task_share_completion_projection(?:\s|\()/i);
  }
});

test("claim lease is capped by authorization TTL and success has an independent TTL fence", async () => {
  const receipt = baseReceipt();
  const authorizationExpiresAt = "2026-07-17 10:02:00.000";
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], { authorization_expires_at: authorizationExpiresAt }),
    succeedNow: "2026-07-17 10:01:00.000",
  });
  const result = await runner(pool).run(runInput({ leaseSeconds: 300 }));
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(pool.telemetry.claimLeaseExpiresAt, authorizationExpiresAt);
  const claimCall = pool.telemetry.executes.find((call) => (
    /inbox_shadow_replay:claim/.test(call.sql)
  ));
  const succeedCall = pool.telemetry.executes.find((call) => (
    /inbox_shadow_replay:succeed/.test(call.sql)
  ));
  assert.match(
    claimCall.sql,
    /lease_expires_at = LEAST\([\s\S]*TIMESTAMPADD\(SECOND, \?, CURRENT_TIMESTAMP\(3\)\)[\s\S]*authorization_expires_at[\s\S]*\)/
  );
  assert.match(claimCall.sql, /authorization_expires_at > CURRENT_TIMESTAMP\(3\)/);
  assert.match(succeedCall.sql, /authorization_expires_at > CURRENT_TIMESTAMP\(3\)/);
});

test("authorization expiry during a long batch rolls back shadow writes and cannot commit success", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], {
      authorization_expires_at: "2026-07-17 10:00:30.000",
    }),
    succeedNow: "2026-07-17 10:00:30.000",
  });
  await assert.rejects(
    () => runner(pool).run(runInput({ leaseSeconds: 300 })),
    (error) => error.code === "INBOX_SHADOW_REPLAY_LEASE_UNAVAILABLE"
  );
  assert.equal(pool.telemetry.claimLeaseExpiresAt, "2026-07-17 10:00:30.000");
  assert.equal(pool.state.run.status, "RUNNING");
  assert.equal(pool.state.run.result_digest, null);
  assert.equal(pool.state.shadows.length, 0);
  assert.ok(pool.telemetry.rollbacks >= 1);
});

test("expired authorization is terminally expired before a lease or shadow write", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], { authorization_expires_at: "2026-07-17 09:59:59.999" }),
  });
  await assert.rejects(() => runner(pool).run(runInput()), (error) => error.code === "AUTHORIZATION_EXPIRED");
  assert.equal(pool.state.run.status, "EXPIRED");
  assert.equal(pool.state.shadows.length, 0);
  assert.equal(pool.telemetry.executes.some((call) => /inbox_shadow_replay:claim/.test(call.sql)), false);
});

test("static policy or handler identity drift fails closed before execution", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], { policy_digest: "f".repeat(64) }),
  });
  await assert.rejects(() => runner(pool).run(runInput()), (error) => error.code === "REPLAY_IDENTITY_DRIFT");
  assert.equal(pool.state.run.status, "APPROVED");
  assert.equal(pool.state.shadows.length, 0);
});

test("persisted executor Registry identity drift fails closed before claim or shadow execution", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], {
      execution_executor_registration_digest: "f".repeat(64),
    }),
  });
  await assert.rejects(
    () => runner(pool).run(runInput()),
    (error) => error.code === "REPLAY_IDENTITY_DRIFT"
  );
  assert.equal(pool.state.run.status, "APPROVED");
  assert.equal(pool.state.run.lease_generation, 0);
  assert.equal(pool.state.shadows.length, 0);
});

test("selection digest drift rolls back shadow work and records a fenced FAILED code", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], { selection_digest: "e".repeat(64) }),
  });
  await assert.rejects(() => runner(pool).run(runInput()), (error) => error.code === "REPLAY_SELECTION_DRIFT");
  assert.equal(pool.state.run.status, "FAILED");
  assert.equal(pool.state.run.last_error_code, "REPLAY_SELECTION_DRIFT");
  assert.equal(pool.state.shadows.length, 0);
});

test("an exact pre-existing shadow row converges as replayed without another insert", async () => {
  const firstPool = createPool();
  await runner(firstPool).run(runInput());
  const receipt = baseReceipt();
  const replayRun = baseRun([receipt]);
  const secondPool = createPool({ receipts: [receipt], run: replayRun, shadows: firstPool.state.shadows });
  const result = await runner(secondPool).run(runInput());
  assert.equal(result.shadowInsertedCount, 0);
  assert.equal(result.shadowReplayedCount, 1);
  assert.equal(secondPool.state.shadows.length, 1);
});

test("an active lease with another owner is fenced out", async () => {
  const receipt = baseReceipt();
  const pool = createPool({
    receipts: [receipt],
    run: baseRun([receipt], {
      status: "RUNNING",
      lease_owner: "other-worker",
      lease_expires_at: "2026-07-17 10:05:00.000",
      lease_generation: 7,
      replay_transition_id: "replay_existing",
      started_at: "2026-07-17 09:59:00.000",
    }),
  });
  await assert.rejects(() => runner(pool).run(runInput()), (error) => error.code === "INBOX_SHADOW_REPLAY_LEASE_UNAVAILABLE");
  assert.equal(pool.state.run.lease_owner, "other-worker");
  assert.equal(pool.state.shadows.length, 0);
});

test("execution commit ACK-unknown converges from the durable SUCCEEDED readback", async () => {
  const pool = createPool({ commitErrorAt: 2, preserveCommitOnRollback: true });
  const result = await runner(pool).run(runInput());
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.shadowInsertedCount, 1);
  assert.match(result.resultDigest, /^[a-f0-9]{64}$/);
  assert.ok(pool.telemetry.commits >= 2);
});

test("claim commit ACK-unknown converges only through its exact persisted fence", async () => {
  const pool = createPool({ commitErrorAt: 1, preserveCommitOnRollback: true });
  const result = await runner(pool).run(runInput());
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(pool.state.run.lease_generation, 1);
  assert.match(pool.state.run.replay_transition_id, /^replay_[a-f0-9]{32}$/);
  assert.ok(pool.telemetry.releases + pool.telemetry.destroys >= 3);
});

test("input is exact and protected Inbox content is mandatory", async () => {
  const pool = createPool();
  const module = runner(pool);
  await assert.rejects(
    () => module.run({ ...runInput(), generation: 99 }),
    (error) => error.code === "INBOX_SHADOW_REPLAY_INPUT_INVALID"
  );
  const insecure = createInboxContentCodec({ NODE_ENV: "test" });
  assert.throws(
    () => createMysqlInboxShadowReplayRunner({
      pool,
      env: ENABLED_ENV,
      contentCodec: insecure,
    }),
    (error) => error.code === "INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID"
  );
  const insecureModule = createMysqlInboxShadowReplayRunner({
    pool,
    env: {
      NODE_ENV: "test",
      MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED: "true",
    },
  });
  await assert.rejects(
    () => insecureModule.run(runInput()),
    (error) => error.code === "INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID"
  );
  assert.equal(pool.telemetry.executes.length, 0);
});
