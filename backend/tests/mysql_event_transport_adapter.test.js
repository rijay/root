const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMysqlEventTransportAdapter,
} = require("../src/mysqlEventTransportAdapter");
const { payloadSnapshot } = require("../src/eventTransport");
const { buildTaskEventOutboxEnvelope } = require("../src/taskEventOutbox");

function completeEnvelope(overrides = {}) {
  const payload = overrides.payload_json === undefined
    ? { task_event_id: "task-event-1", event_type: "CHECKIN_COMPLETED" }
    : overrides.payload_json;
  const digest = payloadSnapshot(payload).digest;
  return {
    outbox_event_id: "outbox-task-event-1",
    topic: "task_event",
    event_type: "task.event.created.v1",
    schema_version: "1",
    source_name: "myroot-backend",
    partition_key: "task_event:task-event-1",
    partition_position: 1,
    aggregate_type: "TASK_EVENT",
    aggregate_id: "task-event-1",
    aggregate_version: 1,
    occurred_at: "2026-07-16T18:11:12.123+08:00",
    producer_version: "1.0.0",
    correlation_id: null,
    causation_id: null,
    idempotency_key: "task-event:task-event-1",
    dedupe_key: "task-event:task-event-1",
    payload_json: payload,
    payload_digest: digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: 5,
    available_at: "2026-07-16T10:11:12.123Z",
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_json: null,
    release_id: null,
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-16T10:11:12.123Z",
    updated_at: "2026-07-16T10:11:12.123Z",
    ...overrides,
    payload_digest: overrides.payload_digest || digest,
  };
}

function mysqlRow(envelope = completeEnvelope(), overrides = {}) {
  const row = { ...envelope, ...overrides };
  for (const field of ["occurred_at", "available_at", "next_retry_at", "lease_expires_at", "succeeded_at", "dead_lettered_at", "created_at", "updated_at"]) {
    if (typeof row[field] === "string") {
      const instant = new Date(row[field]);
      row[field] = Number.isFinite(instant.getTime())
        ? new Date(instant.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 23).replace("T", " ")
        : row[field];
    }
  }
  row.payload_json = JSON.stringify(row.payload_json);
  return row;
}

function duplicateError() {
  const error = new Error("Duplicate entry");
  error.code = "ER_DUP_ENTRY";
  error.errno = 1062;
  return error;
}

test("validates and buffers synchronously before a parameterized insert", async () => {
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);

  assert.deepEqual(Object.keys(adapter).sort(), ["afterCommit", "discard", "flushBeforeCommit", "stageOutbox"]);
  const staged = adapter.stageOutbox(completeEnvelope());
  assert.deepEqual(staged, { staged: true, outboxEventId: "outbox-task-event-1" });
  assert.equal(calls.length, 0);

  const result = await adapter.flushBeforeCommit();
  assert.deepEqual(result, { inserted: 1, replayed: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^INSERT INTO `outbox_event`/);
  assert.match(calls[0].sql, /VALUES \(\?, \?,/);
  assert.doesNotMatch(calls[0].sql, /task-event-1/);
  assert.equal(calls[0].values.length, 31);
  assert.equal(calls[0].values[0], "outbox-task-event-1");
  assert.equal(calls[0].values[12], null);
  assert.equal(calls[0].values[13], null);
  assert.equal(calls[0].values[16], JSON.stringify({ task_event_id: "task-event-1", event_type: "CHECKIN_COMPLETED" }));
  assert.equal(calls[0].values[22], null);
  assert.equal(calls[0].values[23], null);
  assert.equal(calls[0].values[24], null);
  assert.equal(calls[0].values[25], null);
  assert.equal(calls[0].values[26], null);
  assert.equal(calls[0].values[27], null);
  assert.equal(calls[0].values[28], null);
  assert.equal(calls[0].values[10], "2026-07-16 18:11:12.123");
  assert.equal(calls[0].values[21], "2026-07-16 18:11:12.123");
});

test("normalizes offset and Z instants to the MySQL +08:00 DATETIME(3) contract", async () => {
  const calls = [];
  const adapter = createMysqlEventTransportAdapter({
    async execute(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  });
  const envelope = buildTaskEventOutboxEnvelope({
    task_event_id: "tev-real-builder",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T18:11:12.123+08:00",
    created_at: "2026-07-16T10:11:12.789Z",
  });

  adapter.stageOutbox(envelope);
  await adapter.flushBeforeCommit();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[10], "2026-07-16 18:11:12.123");
  assert.equal(calls[0].values[21], "2026-07-16 18:11:12.789");
  assert.equal(calls[0].values[29], "2026-07-16 18:11:12.789");
  assert.deepEqual(JSON.parse(calls[0].values[16]), {
    taskEventId: "tev-real-builder",
    taskType: "CHECKIN",
    eventType: "CHECKIN_COMPLETED",
  });
});

test("rejects invalid envelopes before issuing SQL and snapshots staged payloads", async () => {
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);
  const invalid = completeEnvelope({ partition_position: 0 });

  assert.throws(
    () => adapter.stageOutbox(invalid),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID" && !JSON.stringify(error).includes("task-event-1")
  );
  assert.throws(
    () => adapter.stageOutbox(completeEnvelope({ payload_digest: "0".repeat(64) })),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  const incomplete = completeEnvelope();
  delete incomplete.aggregate_version;
  assert.throws(
    () => adapter.stageOutbox(incomplete),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.throws(
    () => adapter.stageOutbox(completeEnvelope({ release_id: undefined })),
    (error) => error.code === "OUTBOX_ENVELOPE_INVALID"
  );
  assert.equal(calls.length, 0);

  const payload = { task_event_id: "task-event-2", event_type: "CHECKIN_COMPLETED" };
  adapter.stageOutbox(completeEnvelope({
    outbox_event_id: "outbox-task-event-2",
    partition_key: "task_event:task-event-2",
    aggregate_id: "task-event-2",
    idempotency_key: "task-event:task-event-2",
    dedupe_key: "task-event:task-event-2",
    payload_json: payload,
  }));
  payload.task_event_id = "mutated-after-stage";
  await adapter.flushBeforeCommit();
  assert.match(calls[0].values[16], /task-event-2/);
  assert.doesNotMatch(calls[0].values[16], /mutated-after-stage/);
});

test("treats an exact immutable duplicate as replay even after runtime fields changed", async () => {
  const original = completeEnvelope();
  const envelope = completeEnvelope({
    producer_version: "1.0.1",
    correlation_id: "request-from-later-replay",
    causation_id: "command-from-later-replay",
    release_id: "later-release",
  });
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT")) throw duplicateError();
      if (sql.includes("WHERE `topic` = ? AND `dedupe_key` = ?")) {
        return [[mysqlRow(original, {
          payload_json: { event_type: "CHECKIN_COMPLETED", task_event_id: "task-event-1" },
          status: "SUCCEEDED",
          attempt_count: 2,
          lease_owner: "old-worker",
          updated_at: "2026-07-16T12:00:00.000Z",
          succeeded_at: "2026-07-16T12:00:00.000Z",
        })]];
      }
      throw new Error("unexpected SQL");
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);
  adapter.stageOutbox(envelope);

  assert.deepEqual(await adapter.flushBeforeCommit(), { inserted: 0, replayed: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, ["task_event", "task-event:task-event-1"]);
});

test("stores the same instant identically for Z and +08:00 inputs", async () => {
  const calls = [];
  const adapter = createMysqlEventTransportAdapter({
    async execute(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  });
  adapter.stageOutbox(completeEnvelope({
    occurred_at: "2026-07-16T10:11:12.123Z",
    available_at: "2026-07-16T18:11:12.123+08:00",
    created_at: "2026-07-16T18:11:12.123+08:00",
    updated_at: "2026-07-16T18:11:12.123+08:00",
  }));
  await adapter.flushBeforeCommit();
  assert.equal(calls[0].values[10], "2026-07-16 18:11:12.123");
  assert.equal(calls[0].values[21], "2026-07-16 18:11:12.123");
});

test("rejects a duplicate dedupe key with different immutable content", async () => {
  const envelope = completeEnvelope({ payload_json: { safe: true, token: "must-not-leak" } });
  const connection = {
    async execute(sql) {
      if (sql.startsWith("INSERT")) throw duplicateError();
      if (sql.includes("WHERE `topic` = ? AND `dedupe_key` = ?")) {
        return [[mysqlRow(envelope, { aggregate_id: "other-task-event" })]];
      }
      throw new Error("unexpected SQL");
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);
  adapter.stageOutbox(envelope);

  await assert.rejects(
    () => adapter.flushBeforeCommit(),
    (error) => {
      assert.equal(error.code, "OUTBOX_DEDUPE_CONFLICT");
      assert.equal(error.message, "outbox event conflicts with an existing dedupe key");
      assert.equal(JSON.stringify(error).includes("must-not-leak"), false);
      return true;
    }
  );
});

test("distinguishes partition-position conflicts from generic insert conflicts", async () => {
  const envelope = completeEnvelope();
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT")) throw duplicateError();
      if (sql.includes("WHERE `topic` = ? AND `dedupe_key` = ?")) return [[]];
      if (sql.includes("WHERE `source_name` = ? AND `partition_key` = ? AND `partition_position` = ?")) {
        return [[mysqlRow(completeEnvelope({
          outbox_event_id: "outbox-other",
          dedupe_key: "task-event:other",
        }))]];
      }
      throw new Error("unexpected SQL");
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);
  adapter.stageOutbox(envelope);

  await assert.rejects(
    () => adapter.flushBeforeCommit(),
    (error) => error.code === "OUTBOX_POSITION_CONFLICT" && error.message === "outbox event conflicts with an existing partition position"
  );
  assert.deepEqual(calls[2].values, ["myroot-backend", "task_event:task-event-1", 1]);
});

test("fails closed outside the active transaction generation", async () => {
  const connection = { async execute() { return [{ affectedRows: 1 }]; } };
  const committed = createMysqlEventTransportAdapter(connection);
  committed.stageOutbox(completeEnvelope());
  await committed.flushBeforeCommit();
  assert.throws(
    () => committed.stageOutbox(completeEnvelope()),
    (error) => error.code === "OUTBOX_TRANSACTION_INACTIVE"
  );
  committed.afterCommit();

  assert.throws(
    () => committed.stageOutbox(completeEnvelope()),
    (error) => error.code === "OUTBOX_TRANSACTION_INACTIVE"
  );
  await assert.rejects(
    () => committed.flushBeforeCommit(),
    (error) => error.code === "OUTBOX_TRANSACTION_INACTIVE"
  );

  const discarded = createMysqlEventTransportAdapter(connection);
  discarded.discard();
  assert.throws(
    () => discarded.stageOutbox(completeEnvelope()),
    (error) => error.code === "OUTBOX_TRANSACTION_INACTIVE"
  );
  await assert.rejects(
    () => discarded.flushBeforeCommit(),
    (error) => error.code === "OUTBOX_TRANSACTION_INACTIVE"
  );
});

test("sanitizes non-conflict persistence failures", async () => {
  const connection = {
    async execute() {
      throw new Error("SQL failed payload token=must-not-leak");
    },
  };
  const adapter = createMysqlEventTransportAdapter(connection);
  adapter.stageOutbox(completeEnvelope());

  await assert.rejects(
    () => adapter.flushBeforeCommit(),
    (error) => {
      assert.equal(error.code, "OUTBOX_PERSISTENCE_FAILED");
      assert.equal(error.message, "outbox event persistence failed");
      assert.equal(JSON.stringify(error).includes("must-not-leak"), false);
      return true;
    }
  );
});
