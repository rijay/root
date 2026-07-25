const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");

// Keep createMysqlOutboxDispatcher on its default Adapter path while adding a
// lifecycle probe around the real Adapter. The Core captures this factory at
// require time; callers never receive or inject an adapterFactory.
const adapterPath = require.resolve("../src/mysqlOutboxDispatcherAdapter");
const adapterModule = require(adapterPath);
const realAdapterFactory = adapterModule.createMysqlOutboxDispatcherAdapter;
const adapterLifecycle = { created: 0, discarded: 0 };
adapterModule.createMysqlOutboxDispatcherAdapter = (connection) => {
  const adapter = realAdapterFactory(connection);
  adapterLifecycle.created += 1;
  return Object.freeze({
    ...adapter,
    discard() {
      adapterLifecycle.discarded += 1;
      return adapter.discard();
    },
  });
};
const corePath = require.resolve("../src/mysqlOutboxDispatcher");
delete require.cache[corePath];
const { createMysqlOutboxDispatcher } = require(corePath);
adapterModule.createMysqlOutboxDispatcherAdapter = realAdapterFactory;

const NOW = "2026-07-16 10:00:00.000";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function timestampAfterMilliseconds(milliseconds) {
  const instant = new Date(`${NOW.replace(" ", "T")}Z`);
  instant.setUTCMilliseconds(instant.getUTCMilliseconds() + milliseconds);
  return instant.toISOString().slice(0, 23).replace("T", " ");
}

function eventRow(overrides = {}) {
  const id = overrides.outbox_event_id || "outbox-integration-1";
  const payload = overrides.payload_json || { outboxEventId: id, safe: true };
  return {
    outbox_event_id: id,
    topic: "task.events",
    event_type: "task.checkin.completed.v1",
    schema_version: "1",
    source_name: "myroot-api",
    partition_key: `member:${id}`,
    partition_position: 1,
    aggregate_type: "TASK_EVENT",
    aggregate_id: id,
    aggregate_version: 1,
    occurred_at: "2026-07-16 09:59:00.000",
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: `task:${id}`,
    dedupe_key: `task:${id}`,
    payload_json: payload,
    payload_digest: payloadSnapshot(payload).digest,
    status: "PENDING",
    attempt_count: 0,
    max_attempts: 5,
    retry_policy_version: "outbox-retry-v1",
    available_at: "2026-07-16 09:59:30.000",
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    lease_generation: 0,
    dispatch_transition_id: null,
    last_error_json: null,
    release_id: "local-integration",
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-16 09:59:00.000",
    updated_at: "2026-07-16 09:59:00.000",
    ...overrides,
  };
}

function claimedExpiredRow(overrides = {}) {
  return eventRow({
    outbox_event_id: "outbox-expired-integration",
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "worker-expired",
    lease_expires_at: NOW,
    lease_generation: 1,
    dispatch_transition_id: "claim-expired-integration",
    ...overrides,
  });
}

function exactIdentity(row, values, start) {
  return row.topic === values[start]
    && row.dedupe_key === values[start + 1]
    && row.source_name === values[start + 2]
    && row.partition_key === values[start + 3]
    && row.partition_position === values[start + 4]
    && row.payload_digest === values[start + 5];
}

function due(row) {
  return (row.status === "PENDING" && row.available_at <= NOW)
    || (row.status === "RETRY_PENDING" && row.next_retry_at <= NOW);
}

function blockedByEarlier(rows, row) {
  return rows.some((candidate) => candidate.source_name === row.source_name
    && candidate.partition_key === row.partition_key
    && candidate.partition_position < row.partition_position
    && ["PENDING", "CLAIMED", "RETRY_PENDING", "DEAD_LETTER"].includes(candidate.status));
}

function deadLetterId(outboxEventId) {
  // The value itself is opaque to these integration assertions. It only needs
  // to satisfy the relational Adapter's persisted-row shape on readback.
  return `dead:${outboxEventId}`.slice(0, 64);
}

function createRelationalPool(initialRows = []) {
  const state = {
    rows: initialRows.map(clone),
    deadLetters: [],
  };
  const telemetry = {
    connections: [],
    sql: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
    destroys: 0,
  };
  let nextCommitMode = "normal";
  let failTag = "";

  function replaceCommitted(snapshot) {
    state.rows = snapshot.rows.map(clone);
    state.deadLetters = snapshot.deadLetters.map(clone);
  }

  function committedStore(connection) {
    assert.equal(connection.inTransaction, true, "dispatcher SQL must run inside a transaction");
    return connection.transaction;
  }

  const pool = {
    state,
    telemetry,
    failNext(tag) {
      failTag = tag;
    },
    setNextCommitMode(mode) {
      assert.ok(["normal", "apply-then-throw", "throw-before-apply"].includes(mode));
      nextCommitMode = mode;
    },
    async getConnection() {
      const id = telemetry.connections.length;
      const commitMode = nextCommitMode;
      nextCommitMode = "normal";
      const connection = {
        id,
        inTransaction: false,
        transaction: null,
        retired: null,
        sessionTimeZone: null,
        async beginTransaction() {
          assert.equal(this.retired, null);
          assert.equal(this.inTransaction, false);
          assert.equal(this.sessionTimeZone, "+08:00", "session timezone must be set before BEGIN");
          this.transaction = clone({ rows: state.rows, deadLetters: state.deadLetters });
          this.inTransaction = true;
          telemetry.sql.push({ connectionId: id, tag: "begin" });
        },
        async commit() {
          assert.equal(this.inTransaction, true);
          telemetry.commits += 1;
          telemetry.sql.push({ connectionId: id, tag: "commit", mode: commitMode });
          if (commitMode !== "throw-before-apply") replaceCommitted(this.transaction);
          this.inTransaction = false;
          this.transaction = null;
          if (commitMode !== "normal") {
            const error = new Error("commit acknowledgement unknown secret=must-not-leak");
            error.code = "COMMIT_ACK_UNKNOWN";
            throw error;
          }
        },
        async rollback() {
          assert.equal(this.inTransaction, true);
          telemetry.rollbacks += 1;
          telemetry.sql.push({ connectionId: id, tag: "rollback" });
          this.inTransaction = false;
          this.transaction = null;
        },
        release() {
          assert.equal(this.retired, null, "connection may retire only once");
          assert.equal(this.inTransaction, false, "an active transaction must never be released");
          this.retired = "released";
          telemetry.releases += 1;
        },
        destroy() {
          assert.equal(this.retired, null, "connection may retire only once");
          this.retired = "destroyed";
          this.inTransaction = false;
          this.transaction = null;
          telemetry.destroys += 1;
        },
        async execute(sql, values = []) {
          assert.equal(this.retired, null);
          const compact = String(sql).replace(/\s+/g, " ").trim();
          if (compact === "SET SESSION time_zone = '+08:00'") {
            assert.equal(this.inTransaction, false);
            this.sessionTimeZone = "+08:00";
            telemetry.sql.push({ connectionId: id, tag: "session_time_zone", sql: compact });
            return [{ affectedRows: 0 }, []];
          }

          const tagMatch = compact.match(/\/\* outbox_dispatcher:([a-z_]+) \*\//);
          const tag = tagMatch && tagMatch[1];
          assert.ok(tag, `unexpected SQL without dispatcher tag: ${compact}`);
          telemetry.sql.push({ connectionId: id, tag, values: clone(values) });
          if (failTag === tag) {
            failTag = "";
            const error = new Error("relational failure bearer=must-not-leak");
            error.code = "ER_LOCK_DEADLOCK";
            throw error;
          }
          const store = committedStore(this);

          if (tag === "claim_due_select") {
            const [policyVersion, limit] = values;
            return [store.rows
              .filter((row) => row.retry_policy_version === policyVersion
                && row.attempt_count < row.max_attempts
                && due(row)
                && !blockedByEarlier(store.rows, row))
              .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
              .slice(0, limit)
              .map(clone), []];
          }

          if (tag === "claim_update") {
            const [
              workerId, leaseSeconds, transitionId, policyVersion,
              outboxEventId, previousStatus, previousAttemptCount, maxAttempts,
              previousGeneration, previousPolicyVersion,
            ] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
            const matches = row
              && row.status === previousStatus
              && row.attempt_count === previousAttemptCount
              && row.max_attempts === maxAttempts
              && row.lease_generation === previousGeneration
              && row.retry_policy_version === previousPolicyVersion
              && row.lease_owner === null
              && row.lease_expires_at === null
              && exactIdentity(row, values, 10)
              && due(row);
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "CLAIMED";
            row.attempt_count += 1;
            row.lease_generation += 1;
            row.lease_owner = workerId;
            row.lease_expires_at = timestampAfterMilliseconds(leaseSeconds * 1_000);
            row.dispatch_transition_id = transitionId;
            row.retry_policy_version = policyVersion;
            row.next_retry_at = null;
            row.last_error_json = null;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "claim_read") {
            const [outboxEventId, workerId, generation, transitionId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId
              && candidate.status === "CLAIMED"
              && candidate.lease_owner === workerId
              && candidate.lease_generation === generation
              && candidate.dispatch_transition_id === transitionId);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "owned_lock") {
            const [outboxEventId, workerId, generation, transitionId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId
              && candidate.status === "CLAIMED"
              && candidate.lease_owner === workerId
              && candidate.lease_generation === generation
              && candidate.dispatch_transition_id === transitionId);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "complete_update") {
            const [transitionId, outboxEventId, workerId, generation, claimTransitionId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
            const matches = row
              && row.status === "CLAIMED"
              && row.lease_owner === workerId
              && row.lease_generation === generation
              && row.dispatch_transition_id === claimTransitionId
              && exactIdentity(row, values, 5);
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "SUCCEEDED";
            row.dispatch_transition_id = transitionId;
            row.lease_owner = null;
            row.lease_expires_at = null;
            row.last_error_json = null;
            row.succeeded_at = NOW;
            row.dead_lettered_at = null;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "retry_update" || tag === "recovery_retry_update") {
            const [policyVersion, delayMicros, errorJson, transitionId, outboxEventId, workerId, generation, claimTransitionId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
            const recoveryDue = tag === "retry_update" || (row && row.lease_expires_at <= NOW);
            const matches = recoveryDue
              && row
              && row.status === "CLAIMED"
              && row.lease_owner === workerId
              && row.lease_generation === generation
              && row.dispatch_transition_id === claimTransitionId
              && exactIdentity(row, values, 8);
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "RETRY_PENDING";
            row.retry_policy_version = policyVersion;
            row.next_retry_at = timestampAfterMilliseconds(delayMicros / 1_000);
            row.last_error_json = errorJson;
            row.dispatch_transition_id = transitionId;
            row.lease_owner = null;
            row.lease_expires_at = null;
            row.succeeded_at = null;
            row.dead_lettered_at = null;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "recover_expired_select") {
            const [policyVersion, limit] = values;
            return [store.rows
              .filter((row) => row.status === "CLAIMED"
                && row.retry_policy_version === policyVersion
                && row.lease_expires_at !== null
                && row.lease_expires_at <= NOW)
              .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
              .slice(0, limit)
              .map(clone), []];
          }

          if (tag === "dead_insert") {
            const [
              eventDeadLetterId, sourceRecordId, sourceName, partitionKey,
              partitionPosition, eventId, eventType, payloadDigest,
              attemptCount, reasonCode, errorJson, releaseId,
            ] = values;
            if (store.deadLetters.some((row) => row.direction === "OUTBOX" && row.source_record_id === sourceRecordId)) {
              const error = new Error("duplicate dead letter");
              error.code = "ER_DUP_ENTRY";
              error.errno = 1062;
              throw error;
            }
            store.deadLetters.push({
              event_dead_letter_id: eventDeadLetterId || deadLetterId(sourceRecordId),
              direction: "OUTBOX",
              source_record_id: sourceRecordId,
              consumer_name: null,
              source_name: sourceName,
              partition_key: partitionKey,
              partition_position: partitionPosition,
              event_id: eventId,
              event_type: eventType,
              payload_json: null,
              payload_digest: payloadDigest,
              status: "OPEN",
              attempt_count: attemptCount,
              reason_code: reasonCode,
              error_json: errorJson,
              next_retry_at: null,
              replay_request_id: null,
              release_id: releaseId,
              first_failed_at: NOW,
              last_failed_at: NOW,
              resolved_at: null,
              resolved_by: null,
              created_at: NOW,
              updated_at: NOW,
            });
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "dead_update_owned" || tag === "dead_update_recovery") {
            const [errorJson, transitionId, outboxEventId, workerId, generation, claimTransitionId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
            const recoveryDue = tag === "dead_update_owned" || (row && row.lease_expires_at <= NOW);
            const matches = recoveryDue
              && row
              && row.status === "CLAIMED"
              && row.lease_owner === workerId
              && row.lease_generation === generation
              && row.dispatch_transition_id === claimTransitionId
              && exactIdentity(row, values, 6);
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "DEAD_LETTER";
            row.last_error_json = errorJson;
            row.dispatch_transition_id = transitionId;
            row.lease_owner = null;
            row.lease_expires_at = null;
            row.next_retry_at = null;
            row.succeeded_at = null;
            row.dead_lettered_at = NOW;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "read_transition") {
            const [outboxEventId] = values;
            const row = store.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "read_dead_letter" || tag === "dead_read") {
            const [sourceRecordId] = values;
            const row = store.deadLetters.find((candidate) => candidate.direction === "OUTBOX"
              && candidate.source_record_id === sourceRecordId);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "read_claims") {
            const [workerId, transitionId] = values;
            return [store.rows
              .filter((row) => row.status === "CLAIMED"
                && row.lease_owner === workerId
                && row.dispatch_transition_id === transitionId)
              .map((row) => ({ ...clone(row), lease_active: row.lease_expires_at > NOW ? 1 : 0 })), []];
          }

          if (tag === "read_recovery") {
            const [transitionId] = values;
            return [store.rows
              .filter((row) => row.dispatch_transition_id === transitionId
                && ["RETRY_PENDING", "DEAD_LETTER"].includes(row.status))
              .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
              .map(clone), []];
          }

          throw new Error(`unsupported dispatcher SQL tag: ${tag}`);
        },
      };
      telemetry.connections.push(connection);
      return connection;
    },
  };
  return pool;
}

let transitionSequence = 0;
function createDispatcher(pool) {
  return createMysqlOutboxDispatcher({
    pool,
    workerId: "worker-integration",
    transitionIdFactory() {
      transitionSequence += 1;
      return `integration-transition-${transitionSequence}`;
    },
  });
}

function lifecycleSnapshot() {
  return { ...adapterLifecycle };
}

function assertLifecycleDelta(before, expected) {
  assert.equal(adapterLifecycle.created - before.created, expected);
  assert.equal(adapterLifecycle.discarded - before.discarded, expected);
}

function assertEveryConnectionSetsTimezoneBeforeBegin(pool) {
  for (const connection of pool.telemetry.connections) {
    const calls = pool.telemetry.sql.filter((entry) => entry.connectionId === connection.id);
    assert.equal(calls[0].tag, "session_time_zone");
    const beginIndex = calls.findIndex((entry) => entry.tag === "begin");
    if (beginIndex >= 0) assert.ok(beginIndex > 0);
  }
}

test("default Core and real Adapter claim then complete with full immutable claim facts", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([eventRow()]);
  const dispatcher = createDispatcher(pool);

  const [claim] = await dispatcher.claimDue({ limit: 1 });
  assert.deepEqual(Object.keys(claim).sort(), [
    "attemptCount", "claimTransitionId", "envelope", "leaseGeneration",
    "leaseOwner", "maxAttempts", "outboxEventId", "payloadDigest",
    "retryPolicyVersion",
  ].sort());
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(Object.isFrozen(claim.envelope), true);
  assert.equal(Object.isFrozen(claim.envelope.payload), true);
  const completed = await dispatcher.completeOwned(claim);

  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.outboxEventId, claim.outboxEventId);
  assert.equal(pool.state.rows[0].status, "SUCCEEDED");
  assert.equal(pool.telemetry.commits, 2);
  assert.equal(pool.telemetry.rollbacks, 0);
  assert.equal(pool.telemetry.releases, 2);
  assert.equal(pool.telemetry.destroys, 0);
  assertLifecycleDelta(before, 2);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("default Core and real Adapter claim then schedule deterministic retry", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([eventRow({ outbox_event_id: "outbox-integration-retry" })]);
  const dispatcher = createDispatcher(pool);

  const [claim] = await dispatcher.claimDue({ limit: 1 });
  const result = await dispatcher.failOwned(claim, {
    reasonCode: "OUTBOX_DISPATCH_FAILED",
    retryable: true,
  });

  assert.equal(result.status, "RETRY_PENDING");
  assert.equal(result.delayMs, 5_000);
  assert.equal(pool.state.rows[0].status, "RETRY_PENDING");
  assert.equal(pool.state.rows[0].next_retry_at, "2026-07-16 10:00:05.000");
  assert.equal(pool.telemetry.commits, 2);
  assert.equal(pool.telemetry.releases, 2);
  assertLifecycleDelta(before, 2);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("default Core and real Adapter claim then atomically dead-letter", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([eventRow({ outbox_event_id: "outbox-integration-dead" })]);
  const dispatcher = createDispatcher(pool);

  const [claim] = await dispatcher.claimDue({ limit: 1 });
  const result = await dispatcher.failOwned(claim, {
    reasonCode: "OUTBOX_PAYLOAD_INVALID",
    retryable: false,
  });

  assert.equal(result.status, "DEAD_LETTER");
  assert.equal(pool.state.rows[0].status, "DEAD_LETTER");
  assert.equal(pool.state.deadLetters.length, 1);
  assert.equal(pool.state.deadLetters[0].source_record_id, claim.outboxEventId);
  assert.equal(pool.state.deadLetters[0].payload_json, null);
  assert.equal(pool.telemetry.commits, 2);
  assert.equal(pool.telemetry.releases, 2);
  assertLifecycleDelta(before, 2);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("default Core and real Adapter recover an expired lease into retry pending", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([claimedExpiredRow()]);
  const dispatcher = createDispatcher(pool);

  const result = await dispatcher.recoverExpired({ limit: 1 });

  assert.equal(result.length, 1);
  assert.equal(result[0].status, "RETRY_PENDING");
  assert.equal(pool.state.rows[0].status, "RETRY_PENDING");
  assert.equal(pool.state.rows[0].next_retry_at, "2026-07-16 10:00:05.000");
  assert.equal(pool.telemetry.commits, 1);
  assert.equal(pool.telemetry.releases, 1);
  assertLifecycleDelta(before, 1);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("work failure rolls back the relational snapshot, discards Adapter and releases a clean connection", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([eventRow({ outbox_event_id: "outbox-integration-rollback" })]);
  const dispatcher = createDispatcher(pool);
  const [claim] = await dispatcher.claimDue({ limit: 1 });
  const committedClaim = clone(pool.state.rows[0]);
  pool.failNext("complete_update");

  await assert.rejects(
    () => dispatcher.completeOwned(claim),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.message === "outbox dispatcher persistence failed"
      && !JSON.stringify(error).includes("must-not-leak")
  );

  assert.deepEqual(pool.state.rows[0], committedClaim);
  assert.equal(pool.telemetry.commits, 1);
  assert.equal(pool.telemetry.rollbacks, 1);
  assert.equal(pool.telemetry.releases, 2);
  assert.equal(pool.telemetry.destroys, 0);
  assertLifecycleDelta(before, 2);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("commit ACK unknown uses real Adapter readback, destroys uncertain connection and never repeats finalize", async () => {
  const before = lifecycleSnapshot();
  const pool = createRelationalPool([eventRow({ outbox_event_id: "outbox-integration-ack" })]);
  const dispatcher = createDispatcher(pool);
  const [claim] = await dispatcher.claimDue({ limit: 1 });
  pool.setNextCommitMode("apply-then-throw");

  const result = await dispatcher.completeOwned(claim);

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(pool.state.rows[0].status, "SUCCEEDED");
  assert.equal(pool.telemetry.sql.filter((entry) => entry.tag === "complete_update").length, 1);
  assert.equal(pool.telemetry.commits, 2);
  assert.equal(pool.telemetry.rollbacks, 1, "authoritative readback is rolled back");
  assert.equal(pool.telemetry.destroys, 1, "commit-unknown connection is never returned to pool");
  assert.equal(pool.telemetry.releases, 2, "claim and readback connections are released");
  assertLifecycleDelta(before, 3);
  assertEveryConnectionSetsTimezoneBeforeBegin(pool);
});

test("claim commit ACK unknown converges only when the exact persisted batch exists", async () => {
  const appliedPool = createRelationalPool([eventRow({ outbox_event_id: "outbox-claim-ack-applied" })]);
  appliedPool.setNextCommitMode("apply-then-throw");
  const [claim] = await createDispatcher(appliedPool).claimDue({ limit: 1 });
  assert.equal(claim.outboxEventId, "outbox-claim-ack-applied");
  assert.equal(appliedPool.telemetry.sql.filter((entry) => entry.tag === "claim_update").length, 1);
  assert.equal(appliedPool.telemetry.destroys, 1);
  assert.equal(appliedPool.telemetry.rollbacks, 1);

  const absentPool = createRelationalPool([eventRow({ outbox_event_id: "outbox-claim-ack-absent" })]);
  absentPool.setNextCommitMode("throw-before-apply");
  await assert.rejects(
    () => createDispatcher(absentPool).claimDue({ limit: 1 }),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
  );
  assert.equal(absentPool.state.rows[0].status, "PENDING");
  assert.equal(absentPool.telemetry.sql.filter((entry) => entry.tag === "claim_update").length, 1);
  assert.equal(absentPool.telemetry.destroys, 1);
  assert.equal(absentPool.telemetry.rollbacks, 1);
});
