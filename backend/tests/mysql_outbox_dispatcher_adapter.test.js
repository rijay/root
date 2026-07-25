const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");
const {
  createMysqlOutboxDispatcherAdapter,
} = require("../src/mysqlOutboxDispatcherAdapter");

const NOW = "2026-07-16 10:00:00.000";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function timestampAfter(seconds) {
  const instant = new Date(`${NOW.replace(" ", "T")}Z`);
  instant.setUTCSeconds(instant.getUTCSeconds() + seconds);
  return instant.toISOString().slice(0, 23).replace("T", " ");
}

function eventRow(overrides = {}) {
  const id = overrides.outbox_event_id || "outbox-a-1";
  const payload = overrides.payload_json || { outboxEventId: id, safe: true };
  return {
    outbox_event_id: id,
    topic: "task.events",
    event_type: "task.checkin.completed.v1",
    schema_version: "1",
    source_name: "myroot-api",
    partition_key: "member-a",
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
    release_id: "local-test",
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-16 09:59:00.000",
    updated_at: "2026-07-16 09:59:00.000",
    ...overrides,
  };
}

function createDispatcherConnection(initialRows = []) {
  const state = {
    rows: initialRows.map(clone),
    deadLetters: [],
    calls: [],
    failTag: "",
    zeroClaimUpdate: false,
    zeroOwnedUpdate: false,
    mutatePostClaimIdentity: null,
    mutateReadTransitionIdentity: null,
    rowDataPacketPrototype: false,
  };

  const rowDataPacketPrototype = { mysqlRowDataPacket: true };
  function databaseRow(row) {
    const value = clone(row);
    if (state.rowDataPacketPrototype) Object.setPrototypeOf(value, rowDataPacketPrototype);
    return value;
  }

  function due(row) {
    return (row.status === "PENDING" && row.available_at <= NOW)
      || (row.status === "RETRY_PENDING" && row.next_retry_at <= NOW);
  }

  function blockedByEarlier(row) {
    return state.rows.some((candidate) =>
      candidate.source_name === row.source_name
      && candidate.partition_key === row.partition_key
      && candidate.partition_position < row.partition_position
      && candidate.status !== "SUCCEEDED");
  }

  const connection = {
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      const tagMatch = compact.match(/\/\* outbox_dispatcher:([a-z_]+) \*\//);
      const tag = tagMatch && tagMatch[1];
      state.calls.push({ tag, sql: compact, values: clone(values) });
      if (state.failTag === tag) {
        const error = new Error("database password=must-not-leak payload=private-phone");
        error.code = "ER_LOCK_DEADLOCK";
        throw error;
      }

      if (tag === "claim_due_select") {
        const [policyVersion, limit] = values;
        const selected = state.rows
          .filter((row) => row.retry_policy_version === policyVersion
            && row.attempt_count < row.max_attempts
            && due(row)
            && !blockedByEarlier(row))
          .sort((left, right) => `${left.source_name}\0${left.partition_key}\0${String(left.partition_position).padStart(20, "0")}`
            .localeCompare(`${right.source_name}\0${right.partition_key}\0${String(right.partition_position).padStart(20, "0")}`))
          .slice(0, limit);
        return [selected.map(databaseRow), []];
      }

      if (tag === "claim_update") {
        const [
          workerId, leaseSeconds, transitionId, retryPolicyVersion,
          outboxEventId, previousStatus, previousAttemptCount, maxAttempts,
          previousGeneration, previousPolicyVersion, topic, dedupeKey,
          sourceName, partitionKey, partitionPosition, payloadDigest,
        ] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
        const matches = row
          && row.status === previousStatus
          && row.attempt_count === previousAttemptCount
          && row.max_attempts === maxAttempts
          && row.lease_generation === previousGeneration
          && row.retry_policy_version === previousPolicyVersion
          && row.lease_owner === null
          && row.lease_expires_at === null
          && row.topic === topic
          && row.dedupe_key === dedupeKey
          && row.source_name === sourceName
          && row.partition_key === partitionKey
          && row.partition_position === partitionPosition
          && row.payload_digest === payloadDigest
          && due(row);
        if (!matches || state.zeroClaimUpdate) return [{ affectedRows: 0 }, []];
        row.status = "CLAIMED";
        row.attempt_count += 1;
        row.lease_generation += 1;
        row.lease_owner = workerId;
        row.lease_expires_at = timestampAfter(leaseSeconds);
        row.dispatch_transition_id = transitionId;
        row.retry_policy_version = retryPolicyVersion;
        row.next_retry_at = null;
        row.last_error_json = null;
        row.updated_at = NOW;
        return [{ affectedRows: 1 }, []];
      }

      if (tag === "claim_read") {
        const [outboxEventId, workerId, generation, transitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId
          && candidate.status === "CLAIMED"
          && candidate.lease_owner === workerId
          && candidate.lease_generation === generation
          && candidate.dispatch_transition_id === transitionId);
        if (!row) return [[], []];
        const answer = databaseRow(row);
        if (state.mutatePostClaimIdentity) {
          answer[state.mutatePostClaimIdentity.field] = state.mutatePostClaimIdentity.value;
        }
        return [[answer], []];
      }

      if (tag === "owned_lock") {
        const [outboxEventId, owner, generation, claimTransitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId
          && candidate.status === "CLAIMED"
          && candidate.lease_owner === owner
          && candidate.lease_generation === generation
          && candidate.dispatch_transition_id === claimTransitionId);
        return [row ? [databaseRow(row)] : [], []];
      }

      if (tag === "complete_update") {
        const [
          transitionId, outboxEventId, owner, generation, claimTransitionId,
          topic, dedupeKey, sourceName, partitionKey, partitionPosition, payloadDigest,
        ] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
        const matches = row
          && row.status === "CLAIMED"
          && row.lease_owner === owner
          && row.lease_generation === generation
          && row.dispatch_transition_id === claimTransitionId
          && row.topic === topic
          && row.dedupe_key === dedupeKey
          && row.source_name === sourceName
          && row.partition_key === partitionKey
          && row.partition_position === partitionPosition
          && row.payload_digest === payloadDigest;
        if (!matches || state.zeroOwnedUpdate) return [{ affectedRows: 0 }, []];
        row.status = "SUCCEEDED";
        row.dispatch_transition_id = transitionId;
        row.lease_owner = null;
        row.lease_expires_at = null;
        row.last_error_json = null;
        row.succeeded_at = NOW;
        row.updated_at = NOW;
        return [{ affectedRows: 1 }, []];
      }

      if (tag === "read_claims") {
        const [workerId, transitionId] = values;
        return [state.rows
          .filter((row) => row.status === "CLAIMED"
            && row.lease_owner === workerId
            && row.dispatch_transition_id === transitionId)
          .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
          .map((row) => ({
            ...databaseRow(row),
            lease_active: row.lease_expires_at > NOW ? 1 : 0,
          })), []];
      }

      if (tag === "read_transition") {
        const [outboxEventId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === outboxEventId);
        if (!row) return [[], []];
        const answer = databaseRow(row);
        if (state.mutateReadTransitionIdentity) {
          answer[state.mutateReadTransitionIdentity.field] = state.mutateReadTransitionIdentity.value;
        }
        return [[answer], []];
      }

      if (tag === "read_dead_letter") return [[], []];
      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
  return { connection, state };
}

function claimInput(overrides = {}) {
  return {
    workerId: "worker-a",
    transitionId: "claim-transition-a",
    limit: 20,
    leaseSeconds: 30,
    retryPolicyVersion: "outbox-retry-v1",
    ...overrides,
  };
}

test("claims only database-due strict partition heads while unrelated partitions progress", async () => {
  const first = eventRow();
  const second = eventRow({
    outbox_event_id: "outbox-a-2",
    partition_position: 2,
    aggregate_id: "outbox-a-2",
    idempotency_key: "task:outbox-a-2",
    dedupe_key: "task:outbox-a-2",
    payload_json: { outboxEventId: "outbox-a-2", safe: true },
  });
  second.payload_digest = payloadSnapshot(second.payload_json).digest;
  const unrelated = eventRow({
    outbox_event_id: "outbox-b-1",
    partition_key: "member-b",
    aggregate_id: "outbox-b-1",
    idempotency_key: "task:outbox-b-1",
    dedupe_key: "task:outbox-b-1",
    payload_json: { outboxEventId: "outbox-b-1", safe: true },
  });
  unrelated.payload_digest = payloadSnapshot(unrelated.payload_json).digest;
  const future = eventRow({
    outbox_event_id: "outbox-c-1",
    partition_key: "member-c",
    available_at: "2026-07-16 10:00:00.001",
  });
  const { connection, state } = createDispatcherConnection([first, second, unrelated, future]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);

  const claims = await adapter.claimDue(claimInput());

  assert.deepEqual(claims.map((claim) => claim.outboxEventId).sort(), ["outbox-a-1", "outbox-b-1"]);
  assert.equal(state.rows.find((row) => row.outbox_event_id === "outbox-a-2").status, "PENDING");
  assert.equal(state.rows.find((row) => row.outbox_event_id === "outbox-c-1").status, "PENDING");
  assert.ok(Object.isFrozen(claims[0]));
  assert.ok(Object.isFrozen(claims[0].envelope));

  const select = state.calls.find((call) => call.tag === "claim_due_select");
  assert.match(select.sql, /CURRENT_TIMESTAMP\(3\)/);
  assert.match(select.sql, /NOT EXISTS/i);
  assert.match(select.sql, /FOR UPDATE SKIP LOCKED/i);
  assert.doesNotMatch(select.sql, /NOW\(\)|Date\.now|new Date/i);
});

test("increments attempt and generation exactly once and prevents a second worker from owning the same row", async () => {
  const { connection, state } = createDispatcherConnection([eventRow()]);
  const first = createMysqlOutboxDispatcherAdapter(connection);
  const second = createMysqlOutboxDispatcherAdapter(connection);

  const [claim] = await first.claimDue(claimInput());
  const later = await second.claimDue(claimInput({ workerId: "worker-b", transitionId: "claim-transition-b" }));

  assert.equal(claim.attemptCount, 1);
  assert.equal(claim.leaseGeneration, 1);
  assert.equal(claim.leaseOwner, "worker-a");
  assert.equal(later.length, 0);
  assert.equal(state.rows[0].attempt_count, 1);
  assert.equal(state.rows[0].lease_generation, 1);
});

test("accepts mysql2 RowDataPacket-shaped records instead of requiring a plain Object prototype", async () => {
  const { connection, state } = createDispatcherConnection([eventRow()]);
  state.rowDataPacketPrototype = true;
  const adapter = createMysqlOutboxDispatcherAdapter(connection);

  const [claim] = await adapter.claimDue(claimInput());
  assert.equal(claim.outboxEventId, "outbox-a-1");
  assert.equal((await adapter.readClaimsByTransition({
    workerId: "worker-a",
    transitionId: "claim-transition-a",
  }))[0].outboxEventId, "outbox-a-1");
});

test("claims retry rows at database-time equality but never overwrites expired claims", async () => {
  const retry = eventRow({
    outbox_event_id: "outbox-retry",
    status: "RETRY_PENDING",
    attempt_count: 1,
    next_retry_at: NOW,
  });
  const expired = eventRow({
    outbox_event_id: "outbox-expired",
    partition_key: "member-expired",
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "old-worker",
    lease_expires_at: NOW,
    lease_generation: 1,
    dispatch_transition_id: "old-claim",
  });
  const { connection, state } = createDispatcherConnection([retry, expired]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);

  const claims = await adapter.claimDue(claimInput());

  assert.deepEqual(claims.map((claim) => claim.outboxEventId), ["outbox-retry"]);
  assert.equal(state.rows.find((row) => row.outbox_event_id === "outbox-expired").lease_owner, "old-worker");
});

test("dead-letter heads and exhausted retry rows block later partition positions without blocking unrelated partitions", async () => {
  const deadHead = eventRow({
    outbox_event_id: "outbox-dead-head",
    status: "DEAD_LETTER",
    attempt_count: 5,
    max_attempts: 5,
    dead_lettered_at: NOW,
  });
  const blockedLater = eventRow({
    outbox_event_id: "outbox-blocked-later",
    partition_position: 2,
    aggregate_id: "outbox-blocked-later",
    idempotency_key: "task:outbox-blocked-later",
    dedupe_key: "task:outbox-blocked-later",
    payload_json: { outboxEventId: "outbox-blocked-later", safe: true },
  });
  blockedLater.payload_digest = payloadSnapshot(blockedLater.payload_json).digest;
  const exhausted = eventRow({
    outbox_event_id: "outbox-exhausted",
    partition_key: "member-exhausted",
    status: "RETRY_PENDING",
    attempt_count: 5,
    max_attempts: 5,
    next_retry_at: NOW,
  });
  const unknownHead = eventRow({
    outbox_event_id: "outbox-unknown-head",
    partition_key: "member-unknown",
    status: "CORRUPT_STATUS",
  });
  const blockedAfterUnknown = eventRow({
    outbox_event_id: "outbox-blocked-after-unknown",
    partition_key: "member-unknown",
    partition_position: 2,
    aggregate_id: "outbox-blocked-after-unknown",
    idempotency_key: "task:outbox-blocked-after-unknown",
    dedupe_key: "task:outbox-blocked-after-unknown",
    payload_json: { outboxEventId: "outbox-blocked-after-unknown", safe: true },
  });
  blockedAfterUnknown.payload_digest = payloadSnapshot(blockedAfterUnknown.payload_json).digest;
  const unrelated = eventRow({
    outbox_event_id: "outbox-unrelated",
    partition_key: "member-unrelated",
    aggregate_id: "outbox-unrelated",
    idempotency_key: "task:outbox-unrelated",
    dedupe_key: "task:outbox-unrelated",
    payload_json: { outboxEventId: "outbox-unrelated", safe: true },
  });
  unrelated.payload_digest = payloadSnapshot(unrelated.payload_json).digest;
  const { connection, state } = createDispatcherConnection([
    deadHead,
    blockedLater,
    exhausted,
    unknownHead,
    blockedAfterUnknown,
    unrelated,
  ]);

  const claims = await createMysqlOutboxDispatcherAdapter(connection).claimDue(claimInput());
  assert.deepEqual(claims.map((claim) => claim.outboxEventId), ["outbox-unrelated"]);
  assert.match(state.calls.find((call) => call.tag === "claim_due_select").sql, /attempt_count`? < candidate\.`max_attempts/i);
  assert.match(state.calls.find((call) => call.tag === "claim_due_select").sql, /predecessor\.`status`? <> 'SUCCEEDED'/i);
});

test("validates payload digest and byte-exact identity before returning a claim", async () => {
  const badDigest = eventRow({ payload_digest: "0".repeat(64) });
  const badDigestHarness = createDispatcherConnection([badDigest]);
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(badDigestHarness.connection).claimDue(claimInput()),
    (error) => error.code === "OUTBOX_ROW_INVALID" && !JSON.stringify(error).includes("outbox-a-1")
  );
  assert.equal(badDigestHarness.state.rows[0].status, "PENDING");

  for (const mutation of [
    { field: "topic", value: "Task.events" },
    { field: "event_type", value: "task.checkin.changed.v1" },
    { field: "schema_version", value: "2" },
    { field: "source_name", value: "myroot-api " },
    { field: "partition_key", value: "me\u0301mber-a" },
    { field: "aggregate_type", value: "OTHER_EVENT" },
    { field: "aggregate_id", value: "outbox-a-other" },
    { field: "aggregate_version", value: 2 },
    { field: "occurred_at", value: "2026-07-16 09:58:59.999" },
    { field: "producer_version", value: "0.5.14" },
    { field: "correlation_id", value: "correlation-other" },
    { field: "causation_id", value: "causation-other" },
    { field: "idempotency_key", value: "task:other" },
    { field: "dedupe_key", value: "TASK:outbox-a-1" },
    { field: "release_id", value: "other-release" },
  ]) {
    const harness = createDispatcherConnection([eventRow({ partition_key: "m\u00e9mber-a" })]);
    harness.state.mutatePostClaimIdentity = mutation;
    await assert.rejects(
      () => createMysqlOutboxDispatcherAdapter(harness.connection).claimDue(claimInput()),
      (error) => error.code === "OUTBOX_ROW_INVALID"
    );
  }
});

test("fences completion on exact owner, generation and immutable identity while expiry alone does not revoke ownership", async () => {
  const { connection, state } = createDispatcherConnection([eventRow()]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  const [claim] = await adapter.claimDue(claimInput());

  await assert.rejects(
    () => adapter.completeOwned({ ...claim, leaseOwner: "stale-worker" }, { transitionId: "complete-stale-owner" }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  await assert.rejects(
    () => adapter.completeOwned({ ...claim, leaseGeneration: claim.leaseGeneration + 1 }, { transitionId: "complete-stale-generation" }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  state.rows[0].lease_expires_at = NOW;
  const completed = await adapter.completeOwned(claim, { transitionId: "complete-at-expiry" });
  assert.deepEqual(completed, {
    outboxEventId: "outbox-a-1",
    status: "SUCCEEDED",
    transitionId: "complete-at-expiry",
    leaseGeneration: 1,
  });
  assert.equal(state.rows[0].lease_owner, null);
  assert.equal(state.rows[0].dispatch_transition_id, "complete-at-expiry");
});

test("zero-row claim and terminal races fail closed and persistence errors are sanitized", async () => {
  const zeroClaim = createDispatcherConnection([eventRow()]);
  zeroClaim.state.zeroClaimUpdate = true;
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(zeroClaim.connection).claimDue(claimInput()),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );

  const zeroComplete = createDispatcherConnection([eventRow()]);
  const adapter = createMysqlOutboxDispatcherAdapter(zeroComplete.connection);
  const [claim] = await adapter.claimDue(claimInput());
  zeroComplete.state.zeroOwnedUpdate = true;
  await assert.rejects(
    () => adapter.completeOwned(claim, { transitionId: "complete-race" }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );

  const failed = createDispatcherConnection([eventRow()]);
  failed.state.failTag = "claim_due_select";
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(failed.connection).claimDue(claimInput()),
    (error) => error.code === "OUTBOX_PERSISTENCE_FAILED"
      && !JSON.stringify(error).includes("must-not-leak")
      && !JSON.stringify(error).includes("private-phone")
  );
});

test("reads claim and terminal transition ACK-unknown state without repeating a write", async () => {
  const { connection, state } = createDispatcherConnection([eventRow()]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  const [claim] = await adapter.claimDue(claimInput());

  const persistedClaims = await adapter.readClaimsByTransition({
    workerId: "worker-a",
    transitionId: "claim-transition-a",
  });
  assert.deepEqual(persistedClaims.map((item) => item.outboxEventId), [claim.outboxEventId]);

  state.rows[0].lease_expires_at = NOW;
  await assert.rejects(
    () => adapter.readClaimsByTransition({
      workerId: "worker-a",
      transitionId: "claim-transition-a",
    }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );

  assert.deepEqual(
    await adapter.readTransition({ claim, transitionId: "complete-a", expectedStatus: "SUCCEEDED" }),
    { state: "OWNED" }
  );
  await adapter.completeOwned(claim, { transitionId: "complete-a" });
  assert.deepEqual(
    await adapter.readTransition({ claim, transitionId: "complete-a", expectedStatus: "SUCCEEDED" }),
    {
      state: "CONVERGED",
      result: {
        outboxEventId: "outbox-a-1",
        status: "SUCCEEDED",
        transitionId: "complete-a",
        leaseGeneration: 1,
      },
    }
  );

  state.rows[0].lease_generation = 2;
  state.rows[0].status = "CLAIMED";
  state.rows[0].lease_owner = "worker-b";
  state.rows[0].lease_expires_at = timestampAfter(30);
  state.rows[0].dispatch_transition_id = "claim-b";
  assert.deepEqual(
    await adapter.readTransition({ claim, transitionId: "complete-a", expectedStatus: "SUCCEEDED" }),
    { state: "LEASE_LOST" }
  );
});

test("terminal readback fails closed when byte-exact persisted identity differs from the claim", async () => {
  for (const mutation of [
    { field: "partition_key", value: "member-A" },
    { field: "event_type", value: "task.checkin.changed.v1" },
    { field: "schema_version", value: "2" },
    { field: "aggregate_type", value: "OTHER_EVENT" },
    { field: "aggregate_id", value: "other-id" },
    { field: "aggregate_version", value: 2 },
    { field: "occurred_at", value: "2026-07-16 09:58:59.999" },
    { field: "producer_version", value: "0.5.14" },
    { field: "correlation_id", value: "other-correlation" },
    { field: "causation_id", value: "other-causation" },
    { field: "idempotency_key", value: "task:other" },
    { field: "release_id", value: "other-release" },
  ]) {
    const { connection, state } = createDispatcherConnection([eventRow()]);
    const adapter = createMysqlOutboxDispatcherAdapter(connection);
    const [claim] = await adapter.claimDue(claimInput());
    await adapter.completeOwned(claim, { transitionId: "complete-identity-check" });
    state.mutateReadTransitionIdentity = mutation;

    await assert.rejects(
      () => adapter.readTransition({
        claim,
        transitionId: "complete-identity-check",
        expectedStatus: "SUCCEEDED",
      }),
      (error) => error.code === "OUTBOX_ROW_INVALID"
    );
  }
});

test("owned transition rejects a claim whose payload no longer matches its digest", async () => {
  const { connection } = createDispatcherConnection([eventRow()]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  const [claim] = await adapter.claimDue(claimInput());
  const changed = {
    ...claim,
    envelope: {
      ...claim.envelope,
      payload: { changed: true },
    },
  };
  await assert.rejects(
    () => adapter.completeOwned(changed, { transitionId: "complete-payload-tamper" }),
    (error) => error.code === "OUTBOX_DISPATCHER_INPUT_INVALID"
  );
});

test("success ACK readback rejects malformed mutually-exclusive terminal facts", async () => {
  for (const mutation of [
    { field: "succeeded_at", value: null },
    { field: "next_retry_at", value: NOW },
    { field: "last_error_json", value: { code: "OUTBOX_DISPATCH_FAILED", message: "outbox dispatch failed" } },
    { field: "dead_lettered_at", value: NOW },
  ]) {
    const { connection, state } = createDispatcherConnection([eventRow()]);
    const adapter = createMysqlOutboxDispatcherAdapter(connection);
    const [claim] = await adapter.claimDue(claimInput());
    await adapter.completeOwned(claim, { transitionId: "complete-terminal-shape" });
    state.rows[0][mutation.field] = mutation.value;
    await assert.rejects(
      () => adapter.readTransition({
        claim,
        transitionId: "complete-terminal-shape",
        expectedStatus: "SUCCEEDED",
      }),
      (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
    );
  }
});

test("rejects malformed Interface input before SQL and fails closed after discard", async () => {
  const { connection, state } = createDispatcherConnection([eventRow()]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  await assert.rejects(
    () => adapter.claimDue(claimInput({ workerId: " worker-a" })),
    (error) => error.code === "OUTBOX_DISPATCHER_INPUT_INVALID"
  );
  await assert.rejects(
    () => adapter.claimDue(claimInput({ limit: 0 })),
    (error) => error.code === "OUTBOX_DISPATCHER_INPUT_INVALID"
  );
  assert.equal(state.calls.length, 0);

  assert.deepEqual(adapter.discard(), { discarded: true });
  assert.deepEqual(adapter.discard(), { discarded: true });
  await assert.rejects(
    () => adapter.claimDue(claimInput()),
    (error) => error.code === "OUTBOX_DISPATCHER_INACTIVE"
  );
});
