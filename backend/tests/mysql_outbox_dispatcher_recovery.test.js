const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");
const { OUTBOX_RETRY_POLICY_V1 } = require("../src/outboxRetryPolicy");
const {
  createMysqlOutboxDispatcherAdapter,
} = require("../src/mysqlOutboxDispatcherAdapter");

const NOW = "2026-07-16 10:00:00.000";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function timestampAfterMilliseconds(milliseconds) {
  const instant = new Date(`${NOW.replace(" ", "T")}Z`);
  instant.setUTCMilliseconds(instant.getUTCMilliseconds() + milliseconds);
  return instant.toISOString().slice(0, 23).replace("T", " ");
}

function claimedRow(overrides = {}) {
  const id = overrides.outbox_event_id || "outbox-recovery-1";
  const payload = overrides.payload_json || { outboxEventId: id, privatePhone: "never-persist-this" };
  return {
    outbox_event_id: id,
    topic: "task.events",
    event_type: "task.checkin.completed.v1",
    schema_version: "1",
    source_name: "myroot-api",
    partition_key: "member-recovery",
    partition_position: 1,
    aggregate_type: "TASK_EVENT",
    aggregate_id: id,
    aggregate_version: 1,
    occurred_at: "2026-07-16 09:55:00.000",
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: `task:${id}`,
    dedupe_key: `task:${id}`,
    payload_json: payload,
    payload_digest: payloadSnapshot(payload).digest,
    status: "CLAIMED",
    attempt_count: 1,
    max_attempts: 5,
    retry_policy_version: "outbox-retry-v1",
    available_at: "2026-07-16 09:55:00.000",
    next_retry_at: null,
    lease_owner: "worker-recovery",
    lease_expires_at: "2026-07-16 10:00:30.000",
    lease_generation: 1,
    dispatch_transition_id: "claim-recovery-1",
    last_error_json: null,
    release_id: "local-test",
    succeeded_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-16 09:55:00.000",
    updated_at: "2026-07-16 09:55:00.000",
    ...overrides,
  };
}

function claimFor(row) {
  return Object.freeze({
    outboxEventId: row.outbox_event_id,
    leaseOwner: row.lease_owner,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicyVersion: row.retry_policy_version,
    claimTransitionId: row.dispatch_transition_id,
    payloadDigest: row.payload_digest,
    envelope: Object.freeze({
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
      payload: clone(row.payload_json),
      payloadDigest: row.payload_digest,
      releaseId: row.release_id,
    }),
  });
}

function expectedDeadLetter(row, reasonCode = "OUTBOX_DISPATCH_FAILED") {
  return {
    direction: "OUTBOX",
    source_record_id: row.outbox_event_id,
    consumer_name: null,
    source_name: row.source_name,
    partition_key: row.partition_key,
    partition_position: row.partition_position,
    event_id: row.outbox_event_id,
    event_type: row.event_type,
    payload_json: null,
    payload_digest: row.payload_digest,
    status: "OPEN",
    attempt_count: row.attempt_count,
    reason_code: reasonCode,
    error_json: JSON.stringify({ code: reasonCode, message: "outbox dispatch failed" }),
    next_retry_at: null,
    replay_request_id: null,
    release_id: row.release_id,
    resolved_at: null,
    resolved_by: null,
  };
}

function createRecoveryConnection(initialRows = [], initialDeadLetters = []) {
  const state = {
    rows: initialRows.map(clone),
    deadLetters: initialDeadLetters.map(clone),
    calls: [],
    failTag: "",
    zeroRetryUpdate: false,
    zeroDeadUpdate: false,
    forceDuplicateDeadLetter: false,
  };

  function exactIdentity(row, values, start) {
    return row.topic === values[start]
      && row.dedupe_key === values[start + 1]
      && row.source_name === values[start + 2]
      && row.partition_key === values[start + 3]
      && row.partition_position === values[start + 4]
      && row.payload_digest === values[start + 5];
  }

  function safeRow(row) {
    return clone(row);
  }

  const connection = {
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      const tagMatch = compact.match(/\/\* outbox_dispatcher:([a-z_]+) \*\//);
      const tag = tagMatch && tagMatch[1];
      state.calls.push({ tag, sql: compact, values: clone(values) });
      if (state.failTag === tag) {
        const error = new Error("mysql bearer secret and privatePhone must-not-leak");
        error.code = "ER_LOCK_DEADLOCK";
        throw error;
      }

      if (tag === "owned_lock") {
        const [id, owner, generation, claimTransitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === id
          && candidate.status === "CLAIMED"
          && candidate.lease_owner === owner
          && candidate.lease_generation === generation
          && candidate.dispatch_transition_id === claimTransitionId);
        return [row ? [safeRow(row)] : [], []];
      }

      if (tag === "retry_update" || tag === "recovery_retry_update") {
        const [policyVersion, delayMicros, errorJson, transitionId, id, owner, generation, claimTransitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === id);
        const leaseMatches = tag === "retry_update" ? Boolean(row) : row && row.lease_expires_at <= NOW;
        const matches = leaseMatches
          && row.status === "CLAIMED"
          && row.lease_owner === owner
          && row.lease_generation === generation
          && row.dispatch_transition_id === claimTransitionId
          && exactIdentity(row, values, 8);
        if (!matches || state.zeroRetryUpdate) return [{ affectedRows: 0 }, []];
        row.status = "RETRY_PENDING";
        row.retry_policy_version = policyVersion;
        row.next_retry_at = timestampAfterMilliseconds(delayMicros / 1000);
        row.last_error_json = errorJson;
        row.dispatch_transition_id = transitionId;
        row.lease_owner = null;
        row.lease_expires_at = null;
        row.updated_at = NOW;
        return [{ affectedRows: 1 }, []];
      }

      if (tag === "recover_expired_select") {
        const [policyVersion, limit] = values;
        return [state.rows
          .filter((row) => row.status === "CLAIMED"
            && row.retry_policy_version === policyVersion
            && row.lease_expires_at !== null
            && row.lease_expires_at <= NOW)
          .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
          .slice(0, limit)
          .map(safeRow), []];
      }

      if (tag === "dead_insert") {
        if (state.forceDuplicateDeadLetter || state.deadLetters.some((row) => row.direction === "OUTBOX" && row.source_record_id === values[1])) {
          const error = new Error("duplicate source record secret=must-not-leak");
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        const [
          eventDeadLetterId, sourceRecordId, sourceName, partitionKey, partitionPosition,
          eventId, eventType, payloadDigest, attemptCount, reasonCode, errorJson, releaseId,
        ] = values;
        state.deadLetters.push({
          event_dead_letter_id: eventDeadLetterId,
          ...expectedDeadLetter({
            outbox_event_id: sourceRecordId,
            source_name: sourceName,
            partition_key: partitionKey,
            partition_position: partitionPosition,
            event_type: eventType,
            payload_digest: payloadDigest,
            attempt_count: attemptCount,
            release_id: releaseId,
          }, reasonCode),
          event_id: eventId,
          error_json: errorJson,
          first_failed_at: NOW,
          last_failed_at: NOW,
          created_at: NOW,
          updated_at: NOW,
        });
        return [{ affectedRows: 1 }, []];
      }

      if (tag === "dead_read" || tag === "read_dead_letter") {
        const [sourceRecordId] = values;
        const row = state.deadLetters.find((candidate) => candidate.direction === "OUTBOX"
          && candidate.source_record_id === sourceRecordId);
        return [row ? [safeRow(row)] : [], []];
      }

      if (tag === "dead_update_owned" || tag === "dead_update_recovery") {
        const [errorJson, transitionId, id, owner, generation, claimTransitionId] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === id);
        const leaseMatches = tag === "dead_update_owned" ? Boolean(row) : row && row.lease_expires_at <= NOW;
        const matches = leaseMatches
          && row.status === "CLAIMED"
          && row.lease_owner === owner
          && row.lease_generation === generation
          && row.dispatch_transition_id === claimTransitionId
          && exactIdentity(row, values, 6);
        if (!matches || state.zeroDeadUpdate) return [{ affectedRows: 0 }, []];
        row.status = "DEAD_LETTER";
        row.last_error_json = errorJson;
        row.dispatch_transition_id = transitionId;
        row.lease_owner = null;
        row.lease_expires_at = null;
        row.dead_lettered_at = NOW;
        row.updated_at = NOW;
        return [{ affectedRows: 1 }, []];
      }

      if (tag === "read_transition") {
        const [id] = values;
        const row = state.rows.find((candidate) => candidate.outbox_event_id === id);
        return [row ? [safeRow(row)] : [], []];
      }

      if (tag === "read_recovery") {
        const [transitionId] = values;
        return [state.rows
          .filter((row) => row.dispatch_transition_id === transitionId
            && ["RETRY_PENDING", "DEAD_LETTER"].includes(row.status))
          .sort((left, right) => left.outbox_event_id.localeCompare(right.outbox_event_id))
          .map(safeRow), []];
      }

      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
  return { connection, state };
}

test("retryable owned failure schedules deterministic backoff from database time and stores only safe error facts", async () => {
  const row = claimedRow();
  const { connection, state } = createRecoveryConnection([row]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);

  const result = await adapter.failOwned(claimFor(row), {
    transitionId: "retry-transition-1",
    reasonCode: "provider said bearer secret with phone 13800000000",
    retryable: true,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });

  assert.deepEqual(result, {
    outboxEventId: row.outbox_event_id,
    status: "RETRY_PENDING",
    transitionId: "retry-transition-1",
    leaseGeneration: 1,
    retryPolicyVersion: "outbox-retry-v1",
    delayMs: 5_000,
  });
  assert.equal(state.rows[0].next_retry_at, "2026-07-16 10:00:05.000");
  assert.equal(state.rows[0].lease_owner, null);
  assert.deepEqual(JSON.parse(state.rows[0].last_error_json), {
    code: "OUTBOX_DISPATCH_FAILED",
    message: "outbox dispatch failed",
  });
  assert.equal(JSON.stringify(state.rows).includes("13800000000"), false);
  const update = state.calls.find((call) => call.tag === "retry_update");
  assert.match(update.sql, /TIMESTAMPADD\(MICROSECOND, \?, CURRENT_TIMESTAMP\(3\)\)/i);
  assert.doesNotMatch(update.sql, /Date\.now|new Date/i);
});

test("failure transition rejects stale owner and generation while expiry equality alone does not revoke ownership", async () => {
  const row = claimedRow();
  const { connection, state } = createRecoveryConnection([row]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  const options = {
    transitionId: "retry-stale-fence",
    reasonCode: "OUTBOX_DISPATCH_FAILED",
    retryable: true,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  };
  await assert.rejects(
    () => adapter.failOwned({ ...claimFor(row), leaseOwner: "other-worker" }, options),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  await assert.rejects(
    () => adapter.failOwned({ ...claimFor(row), leaseGeneration: 2 }, options),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  state.rows[0].lease_expires_at = NOW;
  const result = await adapter.failOwned(claimFor({ ...row, lease_expires_at: NOW }), options);
  assert.equal(result.status, "RETRY_PENDING");
});

test("non-retryable and final-attempt failures create one payload-free dead letter atomically", async () => {
  for (const row of [
    claimedRow({ outbox_event_id: "outbox-nonretryable" }),
    claimedRow({ outbox_event_id: "outbox-final", attempt_count: 5, max_attempts: 5 }),
  ]) {
    const { connection, state } = createRecoveryConnection([row]);
    const adapter = createMysqlOutboxDispatcherAdapter(connection);
    const result = await adapter.failOwned(claimFor(row), {
      transitionId: `dead-${row.outbox_event_id}`,
      reasonCode: "OUTBOX_PAYLOAD_INVALID",
      retryable: row.outbox_event_id === "outbox-final",
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    });

    assert.equal(result.status, "DEAD_LETTER");
    assert.equal(state.rows[0].status, "DEAD_LETTER");
    assert.equal(state.rows[0].dispatch_transition_id, `dead-${row.outbox_event_id}`);
    assert.equal(state.deadLetters.length, 1);
    assert.equal(state.deadLetters[0].payload_json, null);
    assert.equal(state.deadLetters[0].reason_code, "OUTBOX_PAYLOAD_INVALID");
    assert.equal(JSON.stringify(state.deadLetters).includes("never-persist-this"), false);
    assert.ok(state.calls.findIndex((call) => call.tag === "dead_insert")
      < state.calls.findIndex((call) => call.tag.startsWith("dead_update")));
  }
});

test("expired lease recovery retries below max, dead-letters at max and never immediately reclaims", async () => {
  const retry = claimedRow({
    outbox_event_id: "outbox-expired-retry",
    lease_expires_at: NOW,
    attempt_count: 2,
  });
  const terminal = claimedRow({
    outbox_event_id: "outbox-expired-terminal",
    partition_key: "member-terminal",
    lease_expires_at: NOW,
    attempt_count: 5,
    max_attempts: 5,
  });
  const { connection, state } = createRecoveryConnection([retry, terminal]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);

  const recovered = await adapter.recoverExpired({
    transitionId: "recovery-transition-1",
    limit: 20,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });

  assert.deepEqual(recovered.map((item) => item.status).sort(), ["DEAD_LETTER", "RETRY_PENDING"]);
  assert.equal(state.rows.find((row) => row.outbox_event_id === "outbox-expired-retry").next_retry_at, "2026-07-16 10:00:10.000");
  assert.equal(state.rows.find((row) => row.outbox_event_id === "outbox-expired-terminal").status, "DEAD_LETTER");
  assert.equal(state.deadLetters.length, 1);
  assert.deepEqual(await adapter.recoverExpired({
    transitionId: "recovery-transition-2",
    limit: 20,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  }), []);
  assert.match(state.calls.find((call) => call.tag === "recover_expired_select").sql, /lease_expires_at`? <= CURRENT_TIMESTAMP\(3\)/i);
});

test("v1 recovery leaves expired rows owned by an unknown retry policy untouched", async () => {
  const future = claimedRow({
    outbox_event_id: "outbox-future-policy",
    retry_policy_version: "outbox-retry-v2",
    lease_expires_at: NOW,
  });
  const { connection, state } = createRecoveryConnection([future]);
  const adapter = createMysqlOutboxDispatcherAdapter(connection);
  assert.deepEqual(await adapter.recoverExpired({
    transitionId: "recovery-v1-only",
    limit: 20,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  }), []);
  assert.equal(state.rows[0].status, "CLAIMED");
  assert.equal(state.rows[0].retry_policy_version, "outbox-retry-v2");
  const select = state.calls.find((call) => call.tag === "recover_expired_select");
  assert.deepEqual(select.values, ["outbox-retry-v1", 20]);
  assert.match(select.sql, /retry_policy_version`? = \?/i);
});

test("two recovery workers cannot schedule different transitions for one expired generation", async () => {
  const row = claimedRow({ lease_expires_at: NOW });
  const { connection, state } = createRecoveryConnection([row]);
  const first = createMysqlOutboxDispatcherAdapter(connection);
  const second = createMysqlOutboxDispatcherAdapter(connection);

  const firstResult = await first.recoverExpired({
    transitionId: "recovery-first",
    limit: 1,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  const secondResult = await second.recoverExpired({
    transitionId: "recovery-second",
    limit: 1,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });

  assert.equal(firstResult.length, 1);
  assert.deepEqual(secondResult, []);
  assert.equal(state.rows[0].dispatch_transition_id, "recovery-first");
});

test("dead-letter insert and source update failures remain rollback-safe and errors do not leak", async () => {
  const insertFailure = createRecoveryConnection([claimedRow()]);
  insertFailure.state.failTag = "dead_insert";
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(insertFailure.connection).failOwned(claimFor(insertFailure.state.rows[0]), {
      transitionId: "dead-insert-failure",
      reasonCode: "OUTBOX_PAYLOAD_INVALID",
      retryable: false,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    }),
    (error) => error.code === "OUTBOX_PERSISTENCE_FAILED"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(insertFailure.state.rows[0].status, "CLAIMED");
  assert.equal(insertFailure.state.deadLetters.length, 0);

  const updateFailure = createRecoveryConnection([claimedRow()]);
  const before = clone({ rows: updateFailure.state.rows, deadLetters: updateFailure.state.deadLetters });
  updateFailure.state.zeroDeadUpdate = true;
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(updateFailure.connection).failOwned(claimFor(updateFailure.state.rows[0]), {
      transitionId: "dead-update-race",
      reasonCode: "OUTBOX_PAYLOAD_INVALID",
      retryable: false,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  assert.equal(updateFailure.state.deadLetters.length, 1);
  // The transaction owner, not this Adapter, performs rollback. Simulate that
  // caller rollback and prove neither fact survives.
  updateFailure.state.rows = before.rows;
  updateFailure.state.deadLetters = before.deadLetters;
  assert.equal(updateFailure.state.rows[0].status, "CLAIMED");
  assert.equal(updateFailure.state.deadLetters.length, 0);
});

test("exact duplicate dead letter is replay-safe while conflicting immutable facts fail closed", async () => {
  const exactRow = claimedRow();
  const exactDead = {
    event_dead_letter_id: "dead-existing",
    ...expectedDeadLetter(exactRow, "OUTBOX_PAYLOAD_INVALID"),
    first_failed_at: NOW,
    last_failed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
  const exact = createRecoveryConnection([exactRow], [exactDead]);
  exact.state.forceDuplicateDeadLetter = true;
  const exactResult = await createMysqlOutboxDispatcherAdapter(exact.connection).failOwned(claimFor(exactRow), {
    transitionId: "dead-exact-replay",
    reasonCode: "OUTBOX_PAYLOAD_INVALID",
    retryable: false,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  assert.equal(exactResult.status, "DEAD_LETTER");
  assert.equal(exact.state.deadLetters.length, 1);

  const conflictRow = claimedRow();
  const conflictingDead = { ...exactDead, payload_digest: "0".repeat(64) };
  const conflict = createRecoveryConnection([conflictRow], [conflictingDead]);
  conflict.state.forceDuplicateDeadLetter = true;
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(conflict.connection).failOwned(claimFor(conflictRow), {
      transitionId: "dead-conflict",
      reasonCode: "OUTBOX_PAYLOAD_INVALID",
      retryable: false,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    }),
    (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
  );
  assert.equal(conflict.state.rows[0].status, "CLAIMED");
});

test("retry and dead-letter ACK-unknown readback converges by transition id", async () => {
  const retryRow = claimedRow();
  const retryHarness = createRecoveryConnection([retryRow]);
  const retryAdapter = createMysqlOutboxDispatcherAdapter(retryHarness.connection);
  const retryResult = await retryAdapter.failOwned(claimFor(retryRow), {
    transitionId: "retry-ack-unknown",
    reasonCode: "OUTBOX_DISPATCH_FAILED",
    retryable: true,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  const retryReadback = createMysqlOutboxDispatcherAdapter(retryHarness.connection);
  assert.deepEqual(
    await retryReadback.readTransition({
      claim: claimFor(retryRow),
      transitionId: "retry-ack-unknown",
      expectedStatus: "RETRY_PENDING",
    }),
    { state: "CONVERGED", result: retryResult }
  );

  const deadRow = claimedRow({ outbox_event_id: "outbox-dead-ack" });
  const deadHarness = createRecoveryConnection([deadRow]);
  const deadAdapter = createMysqlOutboxDispatcherAdapter(deadHarness.connection);
  const deadResult = await deadAdapter.failOwned(claimFor(deadRow), {
    transitionId: "dead-ack-unknown",
    reasonCode: "OUTBOX_SCHEMA_UNSUPPORTED",
    retryable: false,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  const deadReadback = createMysqlOutboxDispatcherAdapter(deadHarness.connection);
  assert.deepEqual(
    await deadReadback.readTransition({
      claim: claimFor(deadRow),
      transitionId: "dead-ack-unknown",
      expectedStatus: "DEAD_LETTER",
    }),
    { state: "CONVERGED", result: deadResult }
  );

  assert.deepEqual(
    await retryReadback.readRecoveryByTransition({ transitionId: "retry-ack-unknown" }),
    { state: "CONVERGED", result: [retryResult] }
  );
  assert.deepEqual(
    await retryReadback.readRecoveryByTransition({ transitionId: "missing-recovery" }),
    { state: "ABSENT" }
  );
});

test("dead-letter readback refuses to converge without the matching companion fact", async () => {
  const row = claimedRow();
  const harness = createRecoveryConnection([row]);
  const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
  await adapter.failOwned(claimFor(row), {
    transitionId: "dead-missing-companion",
    reasonCode: "OUTBOX_SCHEMA_UNSUPPORTED",
    retryable: false,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  harness.state.deadLetters = [];

  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(harness.connection).readTransition({
      claim: claimFor(row),
      transitionId: "dead-missing-companion",
      expectedStatus: "DEAD_LETTER",
    }),
    (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
  );
});

test("retry ACK readback rejects malformed scheduling and safe-error facts", async () => {
  for (const mutation of [
    { field: "next_retry_at", value: null },
    { field: "last_error_json", value: JSON.stringify({ code: "PRIVATE_PROVIDER_MESSAGE", message: "secret" }) },
    { field: "succeeded_at", value: NOW },
    { field: "dead_lettered_at", value: NOW },
  ]) {
    const row = claimedRow();
    const harness = createRecoveryConnection([row]);
    const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
    await adapter.failOwned(claimFor(row), {
      transitionId: "retry-malformed-readback",
      reasonCode: "OUTBOX_DISPATCH_FAILED",
      retryable: true,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    });
    harness.state.rows[0][mutation.field] = mutation.value;
    await assert.rejects(
      () => createMysqlOutboxDispatcherAdapter(harness.connection).readTransition({
        claim: claimFor(row),
        transitionId: "retry-malformed-readback",
        expectedStatus: "RETRY_PENDING",
      }),
      (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
    );
  }
});

test("dead-letter ACK readback rejects malformed terminal timestamp and safe-error facts", async () => {
  for (const mutation of [
    { field: "dead_lettered_at", value: null },
    { field: "next_retry_at", value: NOW },
    { field: "succeeded_at", value: NOW },
    { field: "last_error_json", value: JSON.stringify({ code: "OUTBOX_SCHEMA_UNSUPPORTED", message: "unsafe detail" }) },
  ]) {
    const row = claimedRow();
    const harness = createRecoveryConnection([row]);
    const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
    await adapter.failOwned(claimFor(row), {
      transitionId: "dead-malformed-readback",
      reasonCode: "OUTBOX_SCHEMA_UNSUPPORTED",
      retryable: false,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    });
    harness.state.rows[0][mutation.field] = mutation.value;
    await assert.rejects(
      () => createMysqlOutboxDispatcherAdapter(harness.connection).readTransition({
        claim: claimFor(row),
        transitionId: "dead-malformed-readback",
        expectedStatus: "DEAD_LETTER",
      }),
      (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
    );
  }
});

test("recovery transition readback applies the same terminal-shape validation", async () => {
  const row = claimedRow({ lease_expires_at: NOW });
  const harness = createRecoveryConnection([row]);
  const adapter = createMysqlOutboxDispatcherAdapter(harness.connection);
  await adapter.recoverExpired({
    transitionId: "recovery-shape-check",
    limit: 1,
    retryPolicy: OUTBOX_RETRY_POLICY_V1,
  });
  harness.state.rows[0].next_retry_at = null;
  await assert.rejects(
    () => createMysqlOutboxDispatcherAdapter(harness.connection).readRecoveryByTransition({
      transitionId: "recovery-shape-check",
    }),
    (error) => error.code === "OUTBOX_DEAD_LETTER_CONFLICT"
  );
});
