const test = require("node:test");
const assert = require("node:assert/strict");

const { createEmptyData, createMysqlStore } = require("../src/store");
const { payloadSnapshot } = require("../src/eventTransport");
const { createApp } = require("../src/app");
const { digestCommandRequest } = require("../src/commandIdempotency");

const OUTBOX_COLUMNS = [
  "outbox_event_id", "topic", "event_type", "schema_version", "source_name", "partition_key",
  "partition_position", "aggregate_type", "aggregate_id", "aggregate_version", "occurred_at",
  "producer_version", "correlation_id", "causation_id", "idempotency_key", "dedupe_key",
  "payload_json", "payload_digest", "status", "attempt_count", "max_attempts", "available_at",
  "next_retry_at", "lease_owner", "lease_expires_at", "last_error_json", "release_id",
  "succeeded_at", "dead_lettered_at", "created_at", "updated_at",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mysqlRow(value) {
  const row = clone(value);
  row.payload_json = JSON.stringify(row.payload_json);
  return row;
}

function outboxRowFromValues(values) {
  return Object.fromEntries(OUTBOX_COLUMNS.map((column, index) => [column, values[index]]));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function httpRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { status: response.status, body: await response.json() };
}

function envelope(id) {
  const occurredAt = "2026-07-16T10:00:00.123Z";
  const payload = { taskEventId: id, taskType: "CHECKIN", eventType: "CHECKIN_COMPLETED" };
  return {
    outbox_event_id: `outbox_${id}`,
    topic: "task.events",
    event_type: "task.checkin.completed.v1",
    schema_version: "1",
    source_name: "myroot-api",
    partition_key: `task_event:${id}`,
    partition_position: 1,
    aggregate_type: "TASK_EVENT",
    aggregate_id: id,
    aggregate_version: 1,
    occurred_at: occurredAt,
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: `task-event:${id}:v1`,
    dedupe_key: `task-event:${id}:v1`,
    payload_json: payload,
    payload_digest: payloadSnapshot(payload).digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: 5,
    available_at: occurredAt,
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_json: null,
    release_id: "test-release",
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: occurredAt,
    updated_at: occurredAt,
  };
}

function taskEvent(id) {
  return {
    task_event_id: id,
    root_user_id: "usr_transaction_test",
    campaign_id: "ROOT_7D_RESET",
    task_definition_id: "td_root_7d_checkin",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    task_date: "2026-07-16",
    payload_json: { taskDate: "2026-07-16" },
    idempotency_key: `task-event:${id}`,
    status: "RECORDED",
    source_channel: "TEST",
    occurred_at: "2026-07-16T10:00:00.123Z",
    created_at: "2026-07-16T10:00:00.123Z",
  };
}

function createFakeMysqlRuntime() {
  const initial = createEmptyData();
  const state = {
    committed: {
      payload: clone(initial),
      revision: 0,
      taskEvents: [],
      outbox: [],
      commands: [],
    },
    transaction: null,
    calls: [],
    connectionEvidence: [],
    failOutboxInsert: false,
    failSnapshotUpdate: false,
    failProjection: false,
    failCommit: false,
    loseCommitAcknowledgement: false,
    loseCommitAcknowledgementOnCommit: 0,
    commitCount: 0,
    outboxInsertConflict: "",
  };

  const connection = {
    async beginTransaction() {
      state.calls.push("BEGIN");
      state.connectionEvidence.push({ operation: "BEGIN", connection });
      state.transaction = clone(state.committed);
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (/^INSERT IGNORE INTO root_store_snapshot/i.test(compact)) {
        state.calls.push("SNAPSHOT_SEED");
        return [{ affectedRows: 0 }, []];
      }
      if (/^SELECT payload_json, updated_at, revision FROM root_store_snapshot/i.test(compact)) {
        state.calls.push(compact.includes("FOR UPDATE") ? "SNAPSHOT_LOCK" : "SNAPSHOT_READ");
        state.connectionEvidence.push({
          operation: compact.includes("FOR UPDATE") ? "SNAPSHOT_LOCK" : "SNAPSHOT_READ",
          connection,
        });
        const source = state.transaction || state.committed;
        return [[{
          payload_json: JSON.stringify(source.payload),
          updated_at: "2026-07-16 10:00:00.123",
          revision: source.revision,
        }], []];
      }
      if (/^UPDATE root_store_snapshot/i.test(compact)) {
        state.calls.push("SNAPSHOT_UPDATE");
        state.connectionEvidence.push({ operation: "SNAPSHOT_UPDATE", connection });
        if (state.failSnapshotUpdate) {
          const error = new Error("simulated snapshot update failure");
          error.code = "SNAPSHOT_UPDATE_FAILED";
          throw error;
        }
        state.transaction.revision = Number(values[1]);
        state.transaction.payload = JSON.parse(values[2]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.includes("settlement_source_invalidation_read:hydrate")) {
        return [[], []];
      }
      if (/^INSERT INTO `?outbox_event`?/i.test(compact)) {
        state.calls.push("OUTBOX_INSERT");
        state.connectionEvidence.push({ operation: "OUTBOX_INSERT", connection });
        if (state.outboxInsertConflict) {
          const error = new Error("simulated duplicate outbox record");
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        if (state.failOutboxInsert) {
          const error = new Error("simulated outbox insert failure with bearer-secret");
          error.code = "ER_LOCK_DEADLOCK";
          throw error;
        }
        const duplicate = state.transaction.outbox.find((item) =>
          item.values[1] === values[1] && item.values[15] === values[15]
        );
        if (duplicate) {
          const error = new Error("simulated duplicate outbox record");
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        state.transaction.outbox.push({ sql: compact, values: clone(values) });
        return [{ affectedRows: 1 }, []];
      }
      if (/^SELECT .* FROM `?outbox_event`?/i.test(compact)) {
        state.connectionEvidence.push({ operation: "OUTBOX_CONFLICT_READ", connection });
        if (compact.includes("WHERE `topic` = ? AND `dedupe_key` = ?")) {
          const existing = state.transaction.outbox.find((item) =>
            item.values[1] === values[0] && item.values[15] === values[1]
          );
          if (existing) return [[outboxRowFromValues(existing.values)], []];
          if (state.outboxInsertConflict !== "DEDUPE") return [[], []];
          return [[mysqlRow({
            ...envelope("tev_existing_dedupe"),
            topic: values[0],
            dedupe_key: values[1],
          })], []];
        }
        if (compact.includes("WHERE `source_name` = ? AND `partition_key` = ? AND `partition_position` = ?")) {
          if (state.outboxInsertConflict !== "POSITION") return [[], []];
          return [[mysqlRow({
            ...envelope("tev_existing_position"),
            source_name: values[0],
            partition_key: values[1],
            partition_position: values[2],
          })], []];
        }
        return [[], []];
      }
      throw new Error(`unexpected execute: ${compact}`);
    },
    async query(sql) {
      throw new Error(`unexpected query: ${String(sql)}`);
    },
    async commit() {
      state.calls.push("COMMIT");
      state.connectionEvidence.push({ operation: "COMMIT", connection });
      state.commitCount += 1;
      if (state.failCommit) {
        const error = new Error("simulated commit failure");
        error.code = "COMMIT_FAILED";
        throw error;
      }
      state.committed = state.transaction;
      state.transaction = null;
      if (state.loseCommitAcknowledgement
        || state.loseCommitAcknowledgementOnCommit === state.commitCount) {
        const error = new Error("simulated commit acknowledgement loss");
        error.code = "COMMIT_ACK_LOST";
        throw error;
      }
    },
    async rollback() {
      state.calls.push("ROLLBACK");
      state.connectionEvidence.push({ operation: "ROLLBACK", connection });
      state.transaction = null;
    },
    release() {
      state.calls.push("RELEASE");
      state.connectionEvidence.push({ operation: "RELEASE", connection });
    },
  };
  state.connection = connection;

  const pool = {
    async getConnection() {
      state.calls.push("GET_CONNECTION");
      state.connectionEvidence.push({ operation: "GET_CONNECTION", connection });
      return connection;
    },
    async execute(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (/^SELECT payload_json, updated_at, revision FROM root_store_snapshot/i.test(compact)) {
        return [[{
          payload_json: JSON.stringify(state.committed.payload),
          updated_at: "2026-07-16 10:00:00.123",
          revision: state.committed.revision,
        }], []];
      }
      throw new Error(`unexpected pool execute: ${compact}`);
    },
    async end() {},
  };

  const dependencies = {
    mysql: { createPool: () => pool },
    async applyMysqlMigrations() {
      return {
        versions: [
          "007_command_recovery_lease.sql",
          "008_command_scope_crypto_metadata.sql",
          "009_outbox_dispatcher_fencing.sql",
          "010_durable_inbox_checkpoint.sql",
          "011_durable_consumer_checkpoint.sql",
          "012_durable_inbox_dead_letter.sql",
          "013_inbox_content_protection_metadata.sql",
          "014_inbox_handler_identity.sql",
          "015_task_share_completion_projection.sql",
          "016_inbox_replay_run.sql",
          "017_task_share_completion_shadow_projection.sql",
          "018_notification_subscription_attempt.sql",
          "019_notification_subscription_grant.sql",
          "020_notification_job.sql",
          "021_notification_send_attempt.sql",
          "022_notification_send_attempt_transition.sql",
          "023_inbox_replay_executor_identity.sql",
          "024_notification_native_decision_contract.sql",
          "025_notification_job_request_identity.sql",
          "026_notification_send_attempt_receipt_metadata.sql",
          "027_notification_send_transition_receipt_metadata.sql",
          "028_migration_contract_registry.sql",
          "029_migration_run.sql",
          "030_migration_lineage.sql",
          "031_task_share_migration_projection.sql",
        ],
        latestVersion: "031_task_share_migration_projection.sql",
      };
    },
    async readMysqlPrivilegePolicy() {
      return { ready: true, scope: "SCHEMA", enforced: false };
    },
    async readMysqlPrivilegePolicyFromConnection() {
      return { ready: true, scope: "SCHEMA", enforced: false };
    },
    assertMysqlPrivilegePolicy() {},
    createMysqlCommandIdempotencyAdapter(commandConnection) {
      let active = true;
      function assertActive() {
        if (!active || !state.transaction) {
          const error = new Error("fake command adapter is inactive");
          error.code = "COMMAND_ADAPTER_INACTIVE";
          throw error;
        }
      }
      function commandError(code, message, status) {
        return Object.assign(new Error(message), { code, status, clientSafe: true });
      }
      function findClaim(input) {
        return state.transaction.commands.find((record) => record.commandName === input.commandName
          && record.actorId === input.actorId
          && record.idempotencyKey === input.idempotencyKey);
      }
      return {
        async claim(input) {
          assertActive();
          state.calls.push("COMMAND_CLAIM");
          state.connectionEvidence.push({ operation: "COMMAND_CLAIM", connection: commandConnection });
          const requestDigest = digestCommandRequest(input.request);
          let record = findClaim(input);
          if (record && record.requestDigest !== requestDigest) {
            throw commandError(40901, "相同命令幂等键对应了不同请求", 409);
          }
          if (record && record.status === "SUCCEEDED") {
            return {
              kind: "REPLAY",
              outcome: { result: clone(record.result), replayed: true, record: clone(record) },
            };
          }
          if (record && record.status === "IN_PROGRESS") {
            throw commandError(40902, "相同命令正在执行中", 409);
          }
          if (!record) {
            record = {
              recordId: `cmd_fake_${state.transaction.commands.length + 1}`,
              commandName: input.commandName,
              actorId: input.actorId,
              idempotencyKey: input.idempotencyKey,
              requestDigest,
              status: "FAILED",
              attempts: 0,
              leaseGeneration: 0,
              result: null,
              error: null,
            };
            state.transaction.commands.push(record);
          }
          record.status = "IN_PROGRESS";
          record.attempts += 1;
          record.leaseGeneration += 1;
          record.leaseOwner = `fake-lease-${record.recordId}-${record.leaseGeneration}`;
          record.result = null;
          record.error = null;
          return {
            kind: "CLAIMED",
            claim: {
              recordId: record.recordId,
              leaseOwner: record.leaseOwner,
              leaseGeneration: record.leaseGeneration,
            },
          };
        },
        async lockOwnedAttempt(claim) {
          assertActive();
          state.calls.push("COMMAND_LOCK");
          state.connectionEvidence.push({ operation: "COMMAND_LOCK", connection: commandConnection });
          const record = state.transaction.commands.find((candidate) => candidate.recordId === claim.recordId);
          if (!record || record.status !== "IN_PROGRESS"
            || record.leaseOwner !== claim.leaseOwner
            || record.leaseGeneration !== claim.leaseGeneration) {
            throw new Error("fake command lease lost");
          }
        },
        async completeOwnedAttempt(claim, result) {
          assertActive();
          state.calls.push("COMMAND_COMPLETE");
          state.connectionEvidence.push({ operation: "COMMAND_COMPLETE", connection: commandConnection });
          const record = state.transaction.commands.find((candidate) => candidate.recordId === claim.recordId);
          if (!record || record.leaseOwner !== claim.leaseOwner
            || record.leaseGeneration !== claim.leaseGeneration) {
            throw new Error("fake command lease lost");
          }
          record.status = "SUCCEEDED";
          record.result = clone(result);
          record.leaseOwner = null;
          return { result: clone(result), replayed: false, record: clone(record) };
        },
        async failOwnedAttempt(claim, error) {
          assertActive();
          state.calls.push("COMMAND_FAIL");
          state.connectionEvidence.push({ operation: "COMMAND_FAIL", connection: commandConnection });
          const record = state.transaction.commands.find((candidate) => candidate.recordId === claim.recordId);
          if (!record || record.leaseOwner !== claim.leaseOwner
            || record.leaseGeneration !== claim.leaseGeneration) {
            throw new Error("fake command lease lost");
          }
          record.status = "FAILED";
          record.error = { code: String(error.code || "COMMAND_FAILED"), message: "command failed" };
          record.leaseOwner = null;
        },
        discard() {
          active = false;
        },
      };
    },
    async syncCoreProjections(projectionConnection, data, options = {}) {
      state.calls.push(options.force ? "PROJECTION_FORCE" : "PROJECTION_TASK_EVENT");
      state.connectionEvidence.push({ operation: "PROJECTION_TASK_EVENT", connection: projectionConnection });
      if (state.failProjection) {
        const error = new Error("simulated projection failure");
        error.code = "PROJECTION_FAILED";
        throw error;
      }
      if (state.transaction) state.transaction.taskEvents = clone(data.taskEvents || []);
      return { tables: options.force ? ["task_event"] : ["task_event"], rows: { task_event: (data.taskEvents || []).length } };
    },
  };
  return { state, dependencies };
}

async function createStore(runtime) {
  const store = await createMysqlStore({
    host: "isolated.test",
    port: 3306,
    user: "test_app",
    password: "test-only",
    database: "root_checkin_test_atomic_outbox",
  }, {
    seedSampleData: false,
    env: {
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "transactional-outbox-result-key-with-strong-entropy-2026",
      ROOT_COMMAND_RESULT_KEY_ID: "transactional-outbox-result-v1",
    },
    dependencies: runtime.dependencies,
  });
  await store.readyPromise;
  runtime.state.calls.length = 0;
  runtime.state.connectionEvidence.length = 0;
  return store;
}

test("MySQL Store commits snapshot, task projection and staged outbox on one connection", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    data.taskEvents.push(taskEvent("tev_atomic_success"));
    transactionControl.eventTransport.stageOutbox(envelope("tev_atomic_success"));
  });

  const calls = runtime.state.calls;
  assert.ok(calls.indexOf("SNAPSHOT_UPDATE") < calls.indexOf("PROJECTION_TASK_EVENT"));
  assert.ok(calls.indexOf("PROJECTION_TASK_EVENT") < calls.indexOf("OUTBOX_INSERT"));
  assert.ok(calls.indexOf("OUTBOX_INSERT") < calls.indexOf("COMMIT"));
  assert.equal(calls.filter((call) => call === "COMMIT").length, 1);
  assert.equal(runtime.state.committed.taskEvents.length, 1);
  assert.equal(runtime.state.committed.outbox.length, 1);
  assert.deepEqual(
    runtime.state.connectionEvidence.map((item) => item.operation),
    [
      "GET_CONNECTION",
      "BEGIN",
      "SNAPSHOT_LOCK",
      "SNAPSHOT_UPDATE",
      "PROJECTION_TASK_EVENT",
      "OUTBOX_INSERT",
      "COMMIT",
      "RELEASE",
    ]
  );
  assert.equal(
    new Set(runtime.state.connectionEvidence.map((item) => item.connection)).size,
    1
  );
  assert.equal(runtime.state.connectionEvidence[0].connection, runtime.state.connection);
});

test("outbox insert failure rolls back snapshot, task projection and staged envelope", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  runtime.state.failOutboxInsert = true;

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      data.taskEvents.push(taskEvent("tev_atomic_rollback"));
      transactionControl.eventTransport.stageOutbox(envelope("tev_atomic_rollback"));
    }),
    (error) => {
      assert.equal(error.code, "OUTBOX_PERSISTENCE_FAILED");
      assert.equal(error.message, "outbox event persistence failed");
      assert.equal(error.message.includes("bearer-secret"), false);
      return true;
    }
  );

  assert.equal(runtime.state.calls.includes("ROLLBACK"), true);
  assert.equal(runtime.state.committed.revision, 0);
  assert.equal(runtime.state.committed.taskEvents.length, 0);
  assert.equal(runtime.state.committed.outbox.length, 0);
  assert.equal(store.data.taskEvents.length, 0);
});

test("snapshot, projection and pre-commit failures each roll back the complete write set", async (t) => {
  for (const scenario of [
    { name: "snapshot", flag: "failSnapshotUpdate", absent: "PROJECTION_TASK_EVENT" },
    { name: "projection", flag: "failProjection", absent: "OUTBOX_INSERT" },
    { name: "commit", flag: "failCommit", absent: null },
  ]) {
    await t.test(scenario.name, async () => {
      const runtime = createFakeMysqlRuntime();
      const store = await createStore(runtime);
      runtime.state[scenario.flag] = true;
      await assert.rejects(
        store.runRequest({ write: true }, async (data, transactionControl) => {
          const id = `tev_${scenario.name}_failure`;
          data.taskEvents.push(taskEvent(id));
          transactionControl.eventTransport.stageOutbox(envelope(id));
        })
      );
      assert.equal(runtime.state.calls.includes("ROLLBACK"), true);
      if (scenario.absent) assert.equal(runtime.state.calls.includes(scenario.absent), false);
      assert.equal(runtime.state.committed.revision, 0);
      assert.equal(runtime.state.committed.taskEvents.length, 0);
      assert.equal(runtime.state.committed.outbox.length, 0);
      assert.equal(store.data.taskEvents.length, 0);
      await store.close();
    });
  }
});

test("lost commit acknowledgement is recovered by reading committed facts before any retry decision", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  runtime.state.loseCommitAcknowledgement = true;

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      data.taskEvents.push(taskEvent("tev_commit_ack_lost"));
      transactionControl.eventTransport.stageOutbox(envelope("tev_commit_ack_lost"));
    }),
    (error) => error.code === "COMMIT_ACK_LOST"
  );
  assert.equal(store.data.taskEvents.length, 0);
  assert.equal(runtime.state.committed.taskEvents.length, 1);
  assert.equal(runtime.state.committed.outbox.length, 1);

  runtime.state.loseCommitAcknowledgement = false;
  let observedCommittedFact = false;
  await store.runRequest({ write: false }, async (data) => {
    observedCommittedFact = data.taskEvents.some((item) => item.task_event_id === "tev_commit_ack_lost");
  });
  assert.equal(observedCommittedFact, true);
  assert.equal(runtime.state.committed.outbox.length, 1);
});

test("HTTP retry after lost commit acknowledgement converges task, command and outbox to one row each", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  const server = createApp({ storeAdapter: store, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  await server.readyPromise;
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });

  const login = await httpRequest(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "atomic_ack_retry_user", appCode: "MYROOT" }),
  });
  assert.equal(login.body.code, 0);
  const headers = {
    Authorization: `Bearer ${login.body.data.token}`,
    "X-Request-Id": "atomic-ack-retry-command",
  };
  const body = JSON.stringify({
    taskType: "SHARE",
    taskDate: "2026-07-16",
    idempotencyKey: "atomic-ack-retry-domain",
    payload: { taskDate: "2026-07-16" },
  });

  // The first commit durably records the command claim. Lose the acknowledgement
  // for the second commit, which owns task fact + command success + outbox.
  runtime.state.loseCommitAcknowledgementOnCommit = runtime.state.commitCount + 2;
  const unknown = await httpRequest(baseUrl, "/api/v1/tasks/events", { method: "POST", headers, body });
  runtime.state.loseCommitAcknowledgementOnCommit = 0;
  const replay = await httpRequest(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { ...headers, "X-Request-Id": "atomic-ack-retry-command-second-attempt" },
    body,
  });

  assert.equal(unknown.status, 503);
  assert.equal(unknown.body.code, 50301);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.code, 0);
  assert.equal(runtime.state.committed.payload.taskEvents.length, 1);
  assert.equal(runtime.state.committed.payload.commandIdempotencyRecords.length, 0);
  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "SUCCEEDED");
  assert.equal(runtime.state.committed.outbox.length, 1);
  assert.equal(
    runtime.state.committed.payload.userLifecycleEvents
      .filter((item) => item.event_type === "TASK_EVENT_RECORDED").length,
    1
  );
});

test("direct task command requires a business idempotency key even without an attempt request id", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  const server = createApp({ storeAdapter: store, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  await server.readyPromise;
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });

  const login = await httpRequest(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "missing_business_key_user", appCode: "MYROOT" }),
  });
  const rejected = await httpRequest(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.body.data.token}` },
    body: JSON.stringify({
      taskType: "SHARE",
      taskDate: "2026-07-16",
      payload: { taskDate: "2026-07-16" },
    }),
  });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 40001);
  assert.equal(runtime.state.committed.commands.length, 0);
  assert.equal(runtime.state.committed.payload.taskEvents.length, 0);
  assert.equal(runtime.state.committed.outbox.length, 0);
});

test("same task business key with a changed request conflicts across attempt request ids", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  const server = createApp({ storeAdapter: store, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  await server.readyPromise;
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });

  const login = await httpRequest(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "changed_request_user", appCode: "MYROOT" }),
  });
  const authorization = `Bearer ${login.body.data.token}`;
  const first = await httpRequest(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { Authorization: authorization, "X-Request-Id": "changed-request-attempt-1" },
    body: JSON.stringify({
      taskType: "SHARE",
      taskDate: "2026-07-16",
      idempotencyKey: "changed-request-business-key",
      payload: { taskDate: "2026-07-16", scene: "FIRST" },
    }),
  });
  const conflict = await httpRequest(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { Authorization: authorization, "X-Request-Id": "changed-request-attempt-2" },
    body: JSON.stringify({
      taskType: "SHARE",
      taskDate: "2026-07-16",
      idempotencyKey: "changed-request-business-key",
      payload: { taskDate: "2026-07-16", scene: "CHANGED" },
    }),
  });

  assert.equal(first.body.code, 0);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 40901);
  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.payload.taskEvents.length, 1);
  assert.equal(runtime.state.committed.outbox.length, 1);
});

test("unexpected direct command errors expose only a generic message and correlation id", async (t) => {
  const runtime = createFakeMysqlRuntime();
  runtime.dependencies.createMysqlCommandRecovery = () => ({
    execute() {
      throw new Error("phone=13800000000 bearer-secret");
    },
    isActive() {
      return false;
    },
  });
  const store = await createStore(runtime);
  const server = createApp({ storeAdapter: store, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  await server.readyPromise;
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });

  const login = await httpRequest(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "unexpected_command_error_user", appCode: "MYROOT" }),
  });
  const response = await httpRequest(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${login.body.data.token}`,
      "X-Request-Id": "unexpected-command-error-attempt",
    },
    body: JSON.stringify({
      taskType: "SHARE",
      taskDate: "2026-07-16",
      idempotencyKey: "unexpected-command-error-business-key",
      payload: { taskDate: "2026-07-16" },
    }),
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.code, 500);
  assert.equal(response.body.message, "请求处理失败，请稍后重试");
  assert.match(response.body.data.correlationId, /^request_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(response.body).includes("13800000000"), false);
  assert.equal(JSON.stringify(response.body).includes("bearer-secret"), false);
});

test("Store Command Recovery durably commits claim before the owned business generation", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  const id = "tev_direct_command_success";

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    const outcome = await transactionControl.commandRecovery.execute(data, {
      commandName: "POST:/api/v1/tasks/events",
      actorId: "user:usr_direct_command",
      idempotencyKey: "direct-command-request-1",
      request: { body: { taskEventId: id } },
    }, () => {
      data.taskEvents.push(taskEvent(id));
      return { code: 0, data: { event: taskEvent(id) } };
    });
    assert.equal(outcome.replayed, false);
    transactionControl.eventTransport.stageOutbox(envelope(id));
  });

  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "SUCCEEDED");
  assert.equal(runtime.state.committed.taskEvents.length, 1);
  assert.equal(runtime.state.committed.outbox.length, 1);
  assert.equal(runtime.state.committed.payload.commandIdempotencyRecords.length, 0);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 2);
  const businessOrder = [
    "COMMAND_LOCK",
    "COMMAND_COMPLETE",
    "SNAPSHOT_UPDATE",
    "PROJECTION_TASK_EVENT",
    "OUTBOX_INSERT",
    "COMMIT",
  ].map((call) => runtime.state.calls.lastIndexOf(call));
  assert.deepEqual([...businessOrder].sort((a, b) => a - b), businessOrder);
  assert.ok(runtime.state.calls.indexOf("COMMAND_CLAIM") < runtime.state.calls.indexOf("COMMIT"));
});

test("handled command failure commits only FAILED recovery evidence", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  const businessError = Object.assign(new Error("sensitive validation detail"), {
    code: "TASK_REJECTED",
    status: 409,
  });

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    await assert.rejects(
      transactionControl.commandRecovery.execute(data, {
        commandName: "POST:/api/v1/tasks/events",
        actorId: "user:usr_direct_command",
        idempotencyKey: "direct-command-failed-1",
        request: { body: { invalid: true } },
      }, () => {
        data.taskEvents.push(taskEvent("tev_must_rollback"));
        throw businessError;
      }),
      (error) => error === businessError
    );
  });

  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "FAILED");
  assert.deepEqual(runtime.state.committed.commands[0].error, {
    code: "TASK_REJECTED",
    message: "command failed",
  });
  assert.equal(JSON.stringify(runtime.state.committed.commands).includes("sensitive validation detail"), false);
  assert.equal(runtime.state.committed.taskEvents.length, 0);
  assert.equal(runtime.state.committed.outbox.length, 0);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 2);
});

test("business-generation persistence failure rolls back success and leaves durable claim", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  const id = "tev_direct_outbox_failure";
  runtime.state.failOutboxInsert = true;

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      await transactionControl.commandRecovery.execute(data, {
        commandName: "POST:/api/v1/tasks/events",
        actorId: "user:usr_direct_command",
        idempotencyKey: "direct-command-outbox-failure-1",
        request: { body: { taskEventId: id } },
      }, () => {
        data.taskEvents.push(taskEvent(id));
        return { code: 0 };
      });
      transactionControl.eventTransport.stageOutbox(envelope(id));
    }),
    (error) => error.code === "OUTBOX_PERSISTENCE_FAILED"
  );

  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "IN_PROGRESS");
  assert.equal(runtime.state.committed.taskEvents.length, 0);
  assert.equal(runtime.state.committed.outbox.length, 0);
  assert.equal(store.data.taskEvents.length, 0);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "ROLLBACK").length, 1);
});

test("claim commit acknowledgement loss returns atomic failure and never starts business action", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  runtime.state.loseCommitAcknowledgementOnCommit = runtime.state.commitCount + 1;
  let actionCalls = 0;

  await assert.rejects(
    store.runRequest({ write: true }, (data, transactionControl) => transactionControl.commandRecovery.execute(data, {
      commandName: "POST:/api/v1/tasks/events",
      actorId: "user:usr_direct_command",
      idempotencyKey: "direct-command-claim-ack-loss-1",
      request: { body: { taskType: "CHECKIN" } },
    }, () => {
      actionCalls += 1;
    })),
    (error) => error.code === "ATOMIC_WRITE_FAILED"
  );

  assert.equal(actionCalls, 0);
  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "IN_PROGRESS");
  assert.equal(runtime.state.committed.taskEvents.length, 0);
  assert.equal(runtime.state.committed.outbox.length, 0);
});

test("public checkpoint is forbidden while a command owns its business action", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    await assert.rejects(
      transactionControl.commandRecovery.execute(data, {
        commandName: "POST:/api/v1/tasks/events",
        actorId: "user:usr_direct_command",
        idempotencyKey: "direct-command-public-checkpoint-1",
        request: { body: { taskType: "CHECKIN" } },
      }, () => transactionControl.checkpoint()),
      (error) => error.code === "STORE_COMMAND_CHECKPOINT_FORBIDDEN"
    );
  });

  assert.equal(runtime.state.committed.commands.length, 1);
  assert.equal(runtime.state.committed.commands[0].status, "FAILED");
  assert.equal(runtime.state.committed.taskEvents.length, 0);
});

test("checkpoint closes one Event Transport generation until resume starts the next", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    const firstGeneration = transactionControl.eventTransport;
    data.taskEvents.push(taskEvent("tev_checkpoint_1"));
    firstGeneration.stageOutbox(envelope("tev_checkpoint_1"));
    await transactionControl.checkpoint();
    assert.throws(
      () => transactionControl.eventTransport.stageOutbox(envelope("tev_checkpoint_blocked")),
      (error) => error.code === "STORE_EVENT_TRANSPORT_NOT_ACTIVE"
    );
    await transactionControl.resume();
    assert.throws(
      () => firstGeneration.stageOutbox(envelope("tev_checkpoint_old_generation")),
      (error) => error.code === "STORE_EVENT_TRANSPORT_NOT_ACTIVE"
    );
    data.taskEvents.push(taskEvent("tev_checkpoint_2"));
    transactionControl.eventTransport.stageOutbox(envelope("tev_checkpoint_2"));
  });

  assert.equal(runtime.state.committed.taskEvents.length, 2);
  assert.equal(runtime.state.committed.outbox.length, 2);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 2);
});

test("a failed resumed generation preserves only the successfully checkpointed generation", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      data.taskEvents.push(taskEvent("tev_checkpoint_kept"));
      transactionControl.eventTransport.stageOutbox(envelope("tev_checkpoint_kept"));
      await transactionControl.checkpoint();
      await transactionControl.resume();

      data.taskEvents.push(taskEvent("tev_resumed_rolled_back"));
      transactionControl.eventTransport.stageOutbox(envelope("tev_resumed_rolled_back"));
      runtime.state.failOutboxInsert = true;
    }),
    (error) => error.code === "OUTBOX_PERSISTENCE_FAILED"
  );

  assert.deepEqual(
    runtime.state.committed.taskEvents.map((item) => item.task_event_id),
    ["tev_checkpoint_kept"]
  );
  assert.equal(runtime.state.committed.outbox.length, 1);
  assert.deepEqual(store.data.taskEvents.map((item) => item.task_event_id), ["tev_checkpoint_kept"]);
  assert.equal(runtime.state.committed.revision, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "ROLLBACK").length, 1);
});

test("shouldCommit false rolls back the resumed generation without erasing its checkpoint", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await store.runRequest({ write: true, shouldCommit: () => false }, async (data, transactionControl) => {
    data.taskEvents.push(taskEvent("tev_checkpoint_before_no_commit"));
    transactionControl.eventTransport.stageOutbox(envelope("tev_checkpoint_before_no_commit"));
    await transactionControl.checkpoint();
    await transactionControl.resume();

    data.taskEvents.push(taskEvent("tev_resumed_no_commit"));
    transactionControl.eventTransport.stageOutbox(envelope("tev_resumed_no_commit"));
  });

  assert.deepEqual(
    runtime.state.committed.taskEvents.map((item) => item.task_event_id),
    ["tev_checkpoint_before_no_commit"]
  );
  assert.equal(runtime.state.committed.outbox.length, 1);
  assert.deepEqual(
    runtime.state.committed.payload.taskEvents.map((item) => item.task_event_id),
    ["tev_checkpoint_before_no_commit"]
  );
  assert.deepEqual(store.data.taskEvents.map((item) => item.task_event_id), ["tev_checkpoint_before_no_commit"]);
  assert.equal(runtime.state.committed.revision, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "OUTBOX_INSERT").length, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "COMMIT").length, 1);
  assert.equal(runtime.state.calls.filter((call) => call === "ROLLBACK").length, 1);
});

test("dedupe and partition-position conflicts through the Store Seam roll back every fact", async (t) => {
  for (const scenario of [
    { conflict: "DEDUPE", code: "OUTBOX_DEDUPE_CONFLICT" },
    { conflict: "POSITION", code: "OUTBOX_POSITION_CONFLICT" },
  ]) {
    await t.test(scenario.conflict.toLowerCase(), async () => {
      const runtime = createFakeMysqlRuntime();
      const store = await createStore(runtime);
      runtime.state.outboxInsertConflict = scenario.conflict;
      const id = `tev_${scenario.conflict.toLowerCase()}_store_conflict`;

      await assert.rejects(
        store.runRequest({ write: true }, async (data, transactionControl) => {
          data.taskEvents.push(taskEvent(id));
          transactionControl.eventTransport.stageOutbox(envelope(id));
        }),
        (error) => error.code === scenario.code
      );

      assert.equal(runtime.state.calls.includes("ROLLBACK"), true);
      assert.equal(runtime.state.committed.revision, 0);
      assert.equal(runtime.state.committed.taskEvents.length, 0);
      assert.equal(runtime.state.committed.payload.taskEvents.length, 0);
      assert.equal(runtime.state.committed.outbox.length, 0);
      assert.equal(store.data.taskEvents.length, 0);
      await store.close();
    });
  }
});

test("read-only and rolled-back requests never flush staged outbox facts", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  runtime.state.calls.length = 0;
  await store.runRequest({ write: false }, async (_data, transactionControl) => {
    assert.throws(
      () => transactionControl.eventTransport.stageOutbox(envelope("tev_read_only")),
      (error) => error.code === "STORE_EVENT_TRANSPORT_READ_ONLY"
    );
  });
  assert.equal(runtime.state.calls.includes("SNAPSHOT_READ"), true);
  assert.equal(runtime.state.calls.includes("SNAPSHOT_LOCK"), false);

  await store.runRequest({ write: true, shouldCommit: () => false }, async (_data, transactionControl) => {
    transactionControl.eventTransport.stageOutbox(envelope("tev_should_rollback"));
  });

  assert.equal(runtime.state.committed.outbox.length, 0);
  assert.equal(runtime.state.calls.includes("OUTBOX_INSERT"), false);
});
