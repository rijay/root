const test = require("node:test");
const assert = require("node:assert/strict");

const { createMysqlStore } = require("../src/store");
const { buildTaskEventOutboxEnvelope } = require("../src/taskEventOutbox");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function changedCollectionKeys(before, after) {
  const changed = new Set();
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (JSON.stringify(before && before[key]) !== JSON.stringify(after && after[key])) changed.add(key);
  }
  return changed;
}

function createFakeMysqlRuntime() {
  const state = {
    snapshot: null,
    revision: 0,
    transaction: null,
    committedCommand: null,
    calls: [],
  };

  const connection = {
    async beginTransaction() {
      assert.equal(state.transaction, null);
      state.calls.push("BEGIN");
      state.transaction = {
        snapshot: clone(state.snapshot),
        revision: state.revision,
        command: null,
      };
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (/^INSERT IGNORE INTO root_store_snapshot/i.test(compact)) {
        if (!state.snapshot) state.snapshot = JSON.parse(values[2]);
        return [{ affectedRows: 1 }, []];
      }
      if (/^SELECT payload_json, updated_at, revision FROM root_store_snapshot/i.test(compact)) {
        const source = state.transaction || state;
        return [[{
          payload_json: JSON.stringify(source.snapshot),
          updated_at: "2026-07-16 12:00:00.000",
          revision: source.revision,
        }], []];
      }
      if (/^UPDATE root_store_snapshot SET/i.test(compact)) {
        state.calls.push("SNAPSHOT_UPDATE");
        assert.ok(state.transaction);
        state.transaction.revision = Number(values[1]);
        state.transaction.snapshot = JSON.parse(values[2]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.includes("settlement_source_invalidation_read:hydrate")) {
        return [[], []];
      }
      if (/^INSERT INTO `outbox_event`/i.test(compact)) {
        state.calls.push("OUTBOX_INSERT");
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected SQL in claim checkpoint guard test: ${compact}`);
    },
    async commit() {
      assert.ok(state.transaction);
      state.calls.push("COMMIT");
      state.snapshot = clone(state.transaction.snapshot);
      state.revision = state.transaction.revision;
      if (state.transaction.command) state.committedCommand = clone(state.transaction.command);
      state.transaction = null;
    },
    async rollback() {
      assert.ok(state.transaction);
      state.calls.push("ROLLBACK");
      state.transaction = null;
    },
    release() {},
  };

  const pool = {
    async getConnection() {
      return connection;
    },
    async execute(sql, values) {
      return connection.execute(sql, values);
    },
    async end() {},
  };

  return {
    state,
    dependencies: {
      mysql: { createPool: () => pool },
      async applyMysqlMigrations() {
        return { latestVersion: "007", versions: ["006", "007"] };
      },
      async readMysqlPrivilegePolicy() {
        return { ready: true, enforced: true, scope: "test" };
      },
      async readMysqlPrivilegePolicyFromConnection() {
        return { ready: true, enforced: true, scope: "test" };
      },
      assertMysqlPrivilegePolicy() {},
      changedCollectionKeys,
      async syncCoreProjections() {
        return { tables: [], rows: {} };
      },
      createMysqlCommandIdempotencyAdapter() {
        return Object.freeze({
          async claim() {
            assert.ok(state.transaction);
            state.calls.push("COMMAND_CLAIM");
            const claim = {
              recordId: "cmd_claim_checkpoint_guard",
              leaseOwner: "claim-checkpoint-test",
              leaseGeneration: 1,
            };
            state.transaction.command = { ...claim, status: "IN_PROGRESS" };
            return { kind: "CLAIMED", claim };
          },
          async lockOwnedAttempt(claim) {
            state.calls.push("COMMAND_LOCK");
            return claim;
          },
          async completeOwnedAttempt(claim, result) {
            state.calls.push("COMMAND_COMPLETE");
            state.transaction.command = { ...claim, status: "SUCCEEDED" };
            return { result, replayed: false, record: state.transaction.command };
          },
          async failOwnedAttempt() {
            assert.fail("dirty claim checkpoint must fail before business failure handling");
          },
          discard() {},
        });
      },
    },
  };
}

async function createStore(runtime) {
  const store = await createMysqlStore({
    host: "127.0.0.1",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_checkin_test_claim_checkpoint",
  }, {
    seedSampleData: false,
    env: {
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "claim-checkpoint-result-key-with-strong-entropy-2026",
      ROOT_COMMAND_RESULT_KEY_ID: "claim-checkpoint-result-v1",
    },
    dependencies: runtime.dependencies,
  });
  runtime.state.calls.length = 0;
  return store;
}

function descriptor(idempotencyKey) {
  return {
    commandName: "POST:/api/v1/tasks/events",
    actorId: "user:usr_claim_checkpoint",
    idempotencyKey,
    request: { body: { taskType: "CHECKIN" } },
  };
}

function taskEvent(id) {
  return {
    task_event_id: id,
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T12:00:00.000Z",
    created_at: "2026-07-16T12:00:00.000Z",
  };
}

test("command claim checkpoint rejects pre-existing snapshot changes and rolls back the relation", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  let actionCalls = 0;

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      data.taskEvents.push(taskEvent("tev_dirty_snapshot_before_claim"));
      return transactionControl.commandRecovery.execute(
        data,
        descriptor("dirty-snapshot-before-claim"),
        () => {
          actionCalls += 1;
        }
      );
    }),
    (error) => error.code === "ATOMIC_WRITE_FAILED"
      && error.cause
      && error.cause.code === "STORE_COMMAND_CLAIM_CHECKPOINT_DIRTY"
  );

  assert.equal(actionCalls, 0);
  assert.equal(runtime.state.committedCommand, null);
  assert.deepEqual(runtime.state.calls, ["BEGIN", "COMMAND_CLAIM", "ROLLBACK"]);
  assert.equal(store.data.taskEvents.length, 0);
});

test("command claim checkpoint rejects a previously staged outbox fact and rolls back the relation", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());
  let actionCalls = 0;

  await assert.rejects(
    store.runRequest({ write: true }, async (data, transactionControl) => {
      transactionControl.eventTransport.stageOutbox(
        buildTaskEventOutboxEnvelope(taskEvent("tev_dirty_outbox_before_claim"))
      );
      return transactionControl.commandRecovery.execute(
        data,
        descriptor("dirty-outbox-before-claim"),
        () => {
          actionCalls += 1;
        }
      );
    }),
    (error) => error.code === "ATOMIC_WRITE_FAILED"
      && error.cause
      && error.cause.code === "STORE_COMMAND_CLAIM_CHECKPOINT_DIRTY"
  );

  assert.equal(actionCalls, 0);
  assert.equal(runtime.state.committedCommand, null);
  assert.deepEqual(runtime.state.calls, ["BEGIN", "COMMAND_CLAIM", "ROLLBACK"]);
  assert.equal(runtime.state.calls.includes("OUTBOX_INSERT"), false);
});

test("a clean command claim checkpoint commits only the relation before business work", async (t) => {
  const runtime = createFakeMysqlRuntime();
  const store = await createStore(runtime);
  t.after(() => store.close());

  await store.runRequest({ write: true }, async (data, transactionControl) => {
    return transactionControl.commandRecovery.execute(
      data,
      descriptor("clean-claim-checkpoint"),
      () => {
        runtime.state.calls.push("ACTION");
        return { code: 0 };
      }
    );
  });

  const firstCommit = runtime.state.calls.indexOf("COMMIT");
  assert.ok(firstCommit > runtime.state.calls.indexOf("COMMAND_CLAIM"));
  assert.ok(firstCommit < runtime.state.calls.indexOf("ACTION"));
  assert.equal(runtime.state.calls.slice(0, firstCommit).includes("SNAPSHOT_UPDATE"), false);
  assert.equal(runtime.state.calls.slice(0, firstCommit).includes("OUTBOX_INSERT"), false);
  assert.equal(runtime.state.committedCommand.status, "SUCCEEDED");
});
