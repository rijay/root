const assert = require("node:assert/strict");
const test = require("node:test");

const { createMysqlInboxReplayControl } = require("../src/mysqlInboxReplayControl");
const {
  getDefaultInboxReplayExecutorRegistry,
} = require("../src/inboxReplayExecutorRegistry");

const ENABLED_ENV = Object.freeze({ MYROOT_INBOX_REPLAY_CONTROL_ENABLED: "true" });
const DISABLED_ENV = Object.freeze({});
const DIGEST = "a".repeat(64);
const SNAPSHOT_MYSQL = "2026-07-16 18:02:00.000";

function authorization(policyId = "TASK_SHARE_VERIFY_V1", overrides = {}) {
  return {
    policyId,
    replayRunId: "replay-control-run-001",
    requestedByActorId: "root-replay-requester",
    authorizedByActorId: "root-replay-authorizer",
    reasonCode: policyId === "TASK_SHARE_VERIFY_V1"
      ? "INCIDENT_VERIFICATION"
      : "HANDLER_UPGRADE_VALIDATION",
    authorizationTicketDigest: DIGEST,
    requestedAt: "2026-07-16T10:00:00.000Z",
    authorizedAt: "2026-07-16T10:01:00.000Z",
    authorizationExpiresAt: "2026-07-16T11:01:00.000Z",
    ...overrides,
  };
}

function sourceRow(id = "replay-source-001", time = "2026-07-16 18:00:00.000") {
  return { first_received_at: time, inbox_receipt_id: id };
}

function materializeInsert(sql, values) {
  const columnsText = sql.match(/INSERT INTO inbox_replay_run \(([\s\S]*?)\) VALUES/i)?.[1];
  const valuesText = sql.match(/\) VALUES \(([\s\S]*?)\)$/i)?.[1];
  assert.ok(columnsText);
  assert.ok(valuesText);
  const columns = columnsText.split(",").map((entry) => entry.trim());
  const expressions = valuesText.split(",").map((entry) => entry.trim());
  assert.equal(columns.length, expressions.length);
  const row = {};
  let parameterIndex = 0;
  for (let index = 0; index < columns.length; index += 1) {
    if (expressions[index] === "?") row[columns[index]] = values[parameterIndex++];
    else if (expressions[index] === "'APPROVED'") row[columns[index]] = "APPROVED";
    else assert.fail(`unexpected insert expression: ${expressions[index]}`);
  }
  assert.equal(parameterIndex, values.length);
  return {
    ...row,
    lease_generation: 0,
    processed_receipt_count: 0,
    verified_receipt_count: 0,
    shadow_inserted_count: 0,
    shadow_replayed_count: 0,
    failed_receipt_count: 0,
  };
}

function createPool(options = {}) {
  const telemetry = {
    connections: 0,
    activeConnections: 0,
    maximumActiveConnections: 0,
    events: [],
    executes: [],
    begins: 0,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    destroys: 0,
  };
  let storedRow = options.existingRow || null;
  let commitCalls = 0;
  return {
    telemetry,
    get storedRow() { return storedRow; },
    async getConnection() {
      const maximumConnections = options.maximumConnections || Number.MAX_SAFE_INTEGER;
      if (telemetry.activeConnections >= maximumConnections) {
        throw Object.assign(new Error("pool exhausted"), { code: "POOL_EXHAUSTED" });
      }
      telemetry.connections += 1;
      telemetry.activeConnections += 1;
      telemetry.maximumActiveConnections = Math.max(
        telemetry.maximumActiveConnections,
        telemetry.activeConnections
      );
      telemetry.events.push("ACQUIRE");
      let pendingRow = null;
      let retired = false;
      function retire(kind) {
        if (retired) return;
        retired = true;
        telemetry.activeConnections -= 1;
        telemetry.events.push(kind);
      }
      return {
        async execute(sql, values = []) {
          telemetry.executes.push({ sql, values });
          if (/^SET SESSION time_zone/.test(sql)) return [[], []];
          if (/^SET TRANSACTION ISOLATION LEVEL/.test(sql)) return [[], []];
          if (/SELECT CURRENT_TIMESTAMP\(3\)/.test(sql)) {
            return [[{ selection_snapshot_at: options.snapshot || SNAPSHOT_MYSQL }], []];
          }
          if (/registration_drift_count/.test(sql)) {
            return [[{ registration_drift_count: options.registrationDriftCount || 0 }], []];
          }
          if (/FROM inbox_receipt/.test(sql)) {
            return [options.sourceRows === undefined
              ? [sourceRow()]
              : options.sourceRows, []];
          }
          if (/MAX\(shadow_generation\)/.test(sql)) {
            return [[{ shadow_generation: options.shadowGeneration || 2 }], []];
          }
          if (/^\s*INSERT INTO inbox_replay_run/.test(sql)) {
            if (options.insertError) throw options.insertError;
            pendingRow = materializeInsert(sql, values);
            return [{ affectedRows: options.insertAffectedRows === undefined
              ? 1
              : options.insertAffectedRows }, []];
          }
          if (/FROM inbox_replay_run/.test(sql)) {
            const row = pendingRow || storedRow;
            if (!row) return [[], []];
            const selected = options.readbackMutator
              ? options.readbackMutator({ ...row })
              : { ...row };
            return [[selected], []];
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
        async beginTransaction() { telemetry.begins += 1; },
        async commit() {
          telemetry.commits += 1;
          commitCalls += 1;
          if (pendingRow && (!options.commitError || options.commitStoresBeforeError !== false)) {
            storedRow = pendingRow;
          }
          if (options.commitError && commitCalls === 1) throw options.commitError;
        },
        async rollback() {
          telemetry.rollbacks += 1;
          if (!options.preserveCommittedOnRollback) pendingRow = null;
        },
        release() { telemetry.releases += 1; retire("RELEASE"); },
        destroy() {
          telemetry.destroys += 1;
          if (options.destroyError) throw options.destroyError;
          retire("DESTROY");
        },
      };
    },
  };
}

test("Replay Control Adapter exposes exactly the deep prepare/inspect Interface", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  assert.deepEqual(Object.keys(control), ["prepare", "inspect"]);
  assert.equal(Object.isFrozen(control), true);
  assert.equal(await control.inspect({ replayRunId: "missing-run" }), null);
  assert.equal(pool.telemetry.begins, 0);
  assert.equal(pool.telemetry.executes.some((call) => (
    /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(call.sql)
  )), false);
});

test("prepare is disabled unless the exact runtime flag is true while inspect stays read-only", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: DISABLED_ENV });
  await assert.rejects(
    () => control.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_DISABLED"
  );
  assert.equal(pool.telemetry.connections, 0);
  assert.equal(await control.inspect({ replayRunId: "missing-run" }), null);
  assert.equal(pool.telemetry.begins, 0);
});

test("VERIFY prepare seals a DB-snapshot selection and inserts an exact APPROVED readback", async () => {
  const pool = createPool({
    sourceRows: [
      sourceRow("replay-source-001", "2026-07-16 17:59:59.999"),
      sourceRow("replay-source-002", "2026-07-16 18:00:00.000"),
    ],
  });
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const result = await control.prepare({ authorization: authorization() });
  assert.equal(result.status, "APPROVED");
  assert.equal(result.identityStatus, "CURRENT");
  assert.equal(result.mode, "VERIFY_ONLY");
  assert.equal(result.shadowGeneration, null);
  assert.equal(result.selection.snapshotAt, "2026-07-16T10:02:00.000Z");
  assert.deepEqual(result.selection.upperCursor, {
    receivedAt: "2026-07-16T10:00:00.000Z",
    receiptId: "replay-source-002",
  });
  assert.equal(result.selection.selectedCount, 2);
  assert.match(result.selection.selectionDigest, /^[a-f0-9]{64}$/);

  const selectionCall = pool.telemetry.executes.find((call) => (
    /FROM inbox_receipt/.test(call.sql) && /ORDER BY first_received_at/.test(call.sql)
  ));
  assert.ok(selectionCall);
  assert.match(selectionCall.sql, /status = \?/);
  assert.match(selectionCall.sql, /handler_descriptor_digest = \?/);
  assert.match(selectionCall.sql, /handler_source_digest = \?/);
  assert.match(selectionCall.sql, /handler_registration_digest = \?/);
  assert.match(selectionCall.sql, /first_received_at <= \?/);
  assert.match(selectionCall.sql, /completed_at <= \?/);
  assert.match(selectionCall.sql, /first_received_at > \?/);
  assert.match(selectionCall.sql, /inbox_receipt_id > \?/);
  assert.match(selectionCall.sql, /ORDER BY first_received_at ASC, inbox_receipt_id ASC/);
  assert.equal(selectionCall.values.at(-1), 10_001);
  assert.equal(selectionCall.values.includes("SUCCEEDED"), true);
  assert.doesNotMatch(selectionCall.sql, /payload_json|result_json|error_json|aggregate_id/i);

  const insertCall = pool.telemetry.executes.find((call) => /INSERT INTO inbox_replay_run/.test(call.sql));
  assert.ok(insertCall);
  assert.doesNotMatch(insertCall.sql, /payload|health|member|free.form|error.detail/i);
  assert.equal(pool.storedRow.status, "APPROVED");
  assert.equal(pool.storedRow.selected_receipt_count, 2);
  assert.equal(pool.telemetry.commits, 1);
  assert.equal(pool.telemetry.rollbacks, 0);
});

test("selection accepts byte-ordered receipt IDs at the same millisecond", async () => {
  const pool = createPool({
    sourceRows: [
      sourceRow("replay-source-001", "2026-07-16 18:00:00.000"),
      sourceRow("replay-source-002", "2026-07-16 18:00:00.000"),
    ],
  });
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const result = await control.prepare({ authorization: authorization() });
  assert.equal(result.selection.selectedCount, 2);
  assert.equal(result.selection.upperCursor.receiptId, "replay-source-002");
});

test("source registration drift is detected independently instead of being silently filtered", async () => {
  const pool = createPool({ registrationDriftCount: 1 });
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  await assert.rejects(
    () => control.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_DRIFT"
  );
  const driftCall = pool.telemetry.executes.find((call) => /registration_drift_count/.test(call.sql));
  assert.ok(driftCall);
  assert.match(driftCall.sql, /completed_at <= \?/);
  assert.match(driftCall.sql, /NOT \(/);
  assert.match(driftCall.sql, /handler_registration_digest = \?/);
  assert.equal(pool.telemetry.executes.some((call) => /INSERT INTO inbox_replay_run/.test(call.sql)), false);
});

test("database snapshot time, not caller time, fences expired authorization", async () => {
  const pool = createPool({ snapshot: "2026-07-16 19:01:00.000" });
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  await assert.rejects(
    () => control.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_SELECTION_INVALID"
  );
  assert.equal(pool.telemetry.executes.some((call) => /INSERT INTO inbox_replay_run/.test(call.sql)), false);
});

test("SHADOW prepare allocates generation in the database and never accepts caller generation", async () => {
  const pool = createPool({ shadowGeneration: 7 });
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const result = await control.prepare({
    authorization: authorization("TASK_SHARE_SHADOW_REBUILD_V1"),
  });
  assert.equal(result.mode, "SHADOW_REBUILD");
  assert.equal(result.shadowGeneration, 7);
  assert.equal(result.targetProjectionPolicy, "SHADOW_GENERATION_GE_2");
  const executor = getDefaultInboxReplayExecutorRegistry().describe().executors[0];
  assert.equal(pool.storedRow.execution_executor_registry_version, 1);
  assert.equal(
    pool.storedRow.execution_executor_registry_digest,
    getDefaultInboxReplayExecutorRegistry().describe().registryDigest
  );
  assert.equal(pool.storedRow.execution_executor_descriptor_digest, executor.descriptorDigest);
  assert.equal(pool.storedRow.execution_executor_source_digest, executor.sourceDigest);
  assert.equal(pool.storedRow.execution_executor_registration_digest, executor.registrationDigest);
  const allocation = pool.telemetry.executes.find((call) => /MAX\(shadow_generation\)/.test(call.sql));
  assert.ok(allocation);
  assert.match(allocation.sql, /FOR UPDATE/);
  assert.deepEqual(allocation.values.slice(0, 2), [
    "task-share-completion-projection",
    "myroot-api",
  ]);

  await assert.rejects(
    () => control.prepare({
      authorization: authorization("TASK_SHARE_SHADOW_REBUILD_V1"),
      shadowGeneration: 999,
    }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_INPUT_INVALID"
  );
});

test("two-person authorization and exact input keys fail closed before database access", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const invalid = [
    { authorization: authorization(undefined, { authorizedByActorId: "root-replay-requester" }) },
    { authorization: { ...authorization(), sql: "SELECT * FROM inbox_receipt" } },
    { authorization: { ...authorization(), mode: "SHADOW_REBUILD" } },
    { authorization: { ...authorization(), handlerId: "caller-handler" } },
    { authorization: { ...authorization(), executionConsumerName: "caller-consumer" } },
    { authorization: { ...authorization(), selectionDigest: DIGEST } },
    { authorization: { ...authorization(), selectedCount: 1 } },
    { authorization: { ...authorization(), generation: 9 } },
  ];
  for (const input of invalid) {
    await assert.rejects(
      () => control.prepare(input),
      (error) => error.code === "INBOX_REPLAY_CONTROL_INPUT_INVALID"
    );
  }
  assert.equal(pool.telemetry.connections, 0);
});

test("empty, oversized and non-monotonic source selections never create a run", async () => {
  const cases = [
    { rows: [], code: "INBOX_REPLAY_CONTROL_SELECTION_INVALID" },
    {
      rows: Array.from({ length: 10_001 }, (_, index) => sourceRow(
        `r${String(index).padStart(5, "0")}`,
        "2026-07-16 18:00:00.000"
      )),
      code: "INBOX_REPLAY_CONTROL_SELECTION_INVALID",
    },
    {
      rows: [sourceRow("replay-source-002"), sourceRow("replay-source-001")],
      code: "INBOX_REPLAY_CONTROL_DRIFT",
    },
  ];
  for (const entry of cases) {
    const pool = createPool({ sourceRows: entry.rows });
    const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
    await assert.rejects(
      () => control.prepare({ authorization: authorization() }),
      (error) => error.code === entry.code
    );
    assert.equal(pool.telemetry.executes.some((call) => /INSERT INTO/.test(call.sql)), false);
    assert.equal(pool.telemetry.rollbacks, 1);
  }
});

test("same replayRunId converges only when its immutable authority is exact", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const first = await control.prepare({ authorization: authorization() });
  const sourceQueryCount = pool.telemetry.executes.filter((call) => /FROM inbox_receipt/.test(call.sql)).length;
  const second = await control.prepare({ authorization: authorization() });
  assert.deepEqual(second, first);
  assert.equal(
    pool.telemetry.executes.filter((call) => /FROM inbox_receipt/.test(call.sql)).length,
    sourceQueryCount + 2
  );

  await assert.rejects(
    () => control.prepare({
      authorization: authorization("TASK_SHARE_VERIFY_V1", {
        authorizationTicketDigest: "b".repeat(64),
      }),
    }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_DRIFT"
  );
});

test("same replayRunId revalidates the persisted selection against source receipts", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  await control.prepare({ authorization: authorization() });
  pool.storedRow.selection_digest = "f".repeat(64);
  await assert.rejects(
    () => control.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_DRIFT"
  );
});

test("persisted SHADOW executor identity mismatch fails closed on replayRunId convergence", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  const request = {
    authorization: authorization("TASK_SHARE_SHADOW_REBUILD_V1"),
  };
  await control.prepare(request);
  pool.storedRow.execution_executor_registration_digest = "f".repeat(64);
  await assert.rejects(
    () => control.prepare(request),
    (error) => error.code === "INBOX_REPLAY_CONTROL_DRIFT"
  );
});

test("commit ACK-unknown reports success only after an exact independent readback", async () => {
  const exactPool = createPool({
    commitError: Object.assign(new Error("ack unknown secret"), { code: "ECONNRESET" }),
    preserveCommittedOnRollback: true,
    maximumConnections: 1,
  });
  const exactControl = createMysqlInboxReplayControl({ pool: exactPool, env: ENABLED_ENV });
  const converged = await exactControl.prepare({ authorization: authorization() });
  assert.equal(converged.status, "APPROVED");
  assert.ok(exactPool.telemetry.connections >= 2);
  assert.equal(exactPool.telemetry.maximumActiveConnections, 1);
  assert.deepEqual(exactPool.telemetry.events.slice(0, 3), [
    "ACQUIRE",
    "DESTROY",
    "ACQUIRE",
  ]);

  const missingPool = createPool({
    commitError: Object.assign(new Error("ack unknown"), { code: "ECONNRESET" }),
    commitStoresBeforeError: false,
  });
  const missingControl = createMysqlInboxReplayControl({ pool: missingPool, env: ENABLED_ENV });
  await assert.rejects(
    () => missingControl.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_PERSISTENCE_FAILED"
  );

  const failedRetirePool = createPool({
    commitError: Object.assign(new Error("ack unknown"), { code: "ECONNRESET" }),
    preserveCommittedOnRollback: true,
    maximumConnections: 1,
    destroyError: new Error("destroy failed"),
  });
  const failedRetireControl = createMysqlInboxReplayControl({
    pool: failedRetirePool,
    env: ENABLED_ENV,
  });
  await assert.rejects(
    () => failedRetireControl.prepare({ authorization: authorization() }),
    (error) => error.code === "INBOX_REPLAY_CONTROL_PERSISTENCE_FAILED"
  );
  assert.equal(failedRetirePool.telemetry.connections, 1);
});

test("inspect returns a minimized frozen view and never starts a transaction", async () => {
  const pool = createPool();
  const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
  await control.prepare({ authorization: authorization() });
  const beginCount = pool.telemetry.begins;
  const result = await control.inspect({ replayRunId: "replay-control-run-001" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.selection), true);
  assert.deepEqual(Object.keys(result).sort(), [
    "executionConsumerName",
    "identityStatus",
    "mode",
    "policyId",
    "policyVersion",
    "replayRunId",
    "selection",
    "shadowGeneration",
    "status",
    "targetProjectionPolicy",
  ].sort());
  assert.equal("requestedByActorId" in result, false);
  assert.equal("authorizationTicketDigest" in result, false);
  assert.equal(result.identityStatus, "CURRENT");
  assert.equal(JSON.stringify(result).includes("payload"), false);
  assert.equal(pool.telemetry.begins, beginCount);
});

test("inspect fails closed when persisted policy, source or executor identity is not current", async () => {
  const cases = [
    [authorization(), "policy_digest"],
    [authorization(), "selection_query_id"],
    [authorization(), "execution_consumer_name"],
    [authorization(), "source_receipt_status"],
    [authorization(), "source_handler_registration_digest"],
    [authorization("TASK_SHARE_SHADOW_REBUILD_V1"), "execution_executor_registration_digest"],
  ];
  for (const [request, field] of cases) {
    const pool = createPool();
    const control = createMysqlInboxReplayControl({ pool, env: ENABLED_ENV });
    await control.prepare({ authorization: request });
    pool.storedRow[field] = "f".repeat(64);
    await assert.rejects(
      () => control.inspect({ replayRunId: request.replayRunId }),
      (error) => error.code === "INBOX_REPLAY_CONTROL_DRIFT",
      field
    );
  }
});
