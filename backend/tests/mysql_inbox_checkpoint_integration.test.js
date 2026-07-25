const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");
const { createMysqlInboxCheckpoint } = require("../src/mysqlInboxCheckpoint");

const NOW = "2026-07-16 20:00:00.000";
const PROTECTED_INBOX_ENV = Object.freeze({
  NODE_ENV: "test",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "integration-inbox-content-key-with-at-least-32-characters",
  ROOT_INBOX_CONTENT_KEY_ID: "integration-inbox-key-v1",
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function afterSeconds(seconds) {
  const date = new Date(`${NOW.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function eventEnvelope(position, overrides = {}) {
  const eventId = overrides.eventId || `event-integration-${position}`;
  const payload = overrides.payload || {
    taskEventId: eventId,
    taskType: "SHARE",
    eventType: "SHARE_COMPLETED",
  };
  return {
    eventId,
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    sourceName: "myroot-api",
    partitionKey: `task_event:${eventId}`,
    partitionPosition: 1,
    aggregateType: "TASK_EVENT",
    aggregateId: eventId,
    aggregateVersion: 1,
    occurredAt: "2026-07-16T20:00:00.000+08:00",
    producerVersion: "0.5.13",
    correlationId: null,
    causationId: null,
    idempotencyKey: `task-event:${eventId}`,
    payload,
    payloadDigest: payloadSnapshot(payload).digest,
    ...overrides,
  };
}

function duplicateError() {
  const error = new Error("duplicate entry");
  error.code = "ER_DUP_ENTRY";
  error.errno = 1062;
  return error;
}

function createRelationalPool() {
  const state = {
    checkpoints: [],
    receipts: [],
    targetFacts: [],
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
  let failTargetEventId = "";

  function replaceCommitted(snapshot) {
    state.checkpoints = snapshot.checkpoints.map(clone);
    state.receipts = snapshot.receipts.map(clone);
    state.targetFacts = snapshot.targetFacts.map(clone);
    state.deadLetters = snapshot.deadLetters.map(clone);
  }

  function currentStore(connection) {
    assert.equal(connection.inTransaction, true, "inbox SQL must execute inside a transaction");
    return connection.transaction;
  }

  function exactCheckpoint(store, consumer, source, partition) {
    return store.checkpoints.find((row) => row.consumer_name === consumer
      && row.source_name === source
      && row.partition_key === partition);
  }

  function exactReceiptByEvent(store, consumer, eventId) {
    return store.receipts.find((row) => row.consumer_name === consumer && row.event_id === eventId);
  }

  function exactReceiptByPosition(store, consumer, source, partition, position) {
    return store.receipts.find((row) => row.consumer_name === consumer
      && row.source_name === source
      && row.partition_key === partition
      && row.partition_position === position);
  }

  function tagOf(sql) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    const inbox = compact.match(/\/\* inbox_checkpoint:([a-z_]+) \*\//);
    if (inbox) return inbox[1];
    if (/^INSERT INTO `task_share_completion_projection`\s/.test(compact)) return "handler_target_insert";
    if (/^SELECT .* FROM `task_share_completion_projection` .* FOR UPDATE$/.test(compact)) {
      return "handler_target_select_conflicts";
    }
    if (/^SELECT .* FROM `task_share_completion_projection` WHERE `projection_id` = \? LIMIT 1$/.test(compact)) {
      return "handler_target_verify";
    }
    return "unknown";
  }

  const pool = {
    state,
    telemetry,
    setNextCommitMode(mode) {
      assert.ok(["normal", "apply-then-throw", "throw-before-apply"].includes(mode));
      nextCommitMode = mode;
    },
    failHandlerAfterWrite(eventId) {
      failTargetEventId = eventId;
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
          assert.equal(this.sessionTimeZone, "+08:00");
          this.transaction = clone(state);
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
          assert.equal(this.retired, null);
          assert.equal(this.inTransaction, false);
          this.retired = "released";
          telemetry.releases += 1;
        },
        destroy() {
          assert.equal(this.retired, null);
          this.retired = "destroyed";
          this.inTransaction = false;
          this.transaction = null;
          telemetry.destroys += 1;
        },
        async execute(sql, values = []) {
          const compact = String(sql).replace(/\s+/g, " ").trim();
          if (compact === "SET SESSION time_zone = '+08:00'") {
            assert.equal(this.inTransaction, false);
            this.sessionTimeZone = "+08:00";
            telemetry.sql.push({ connectionId: id, tag: "session_time_zone" });
            return [{ affectedRows: 0 }, []];
          }
          const tag = tagOf(sql);
          assert.notEqual(tag, "unknown", `unexpected SQL: ${compact}`);
          telemetry.sql.push({ connectionId: id, tag, values: clone(values) });
          const store = currentStore(this);

          if (tag === "checkpoint_insert") {
            const [checkpointId, consumer, source, partition, handlerVersion] = values;
            if (exactCheckpoint(store, consumer, source, partition)
              || store.checkpoints.some((row) => row.consumer_checkpoint_id === checkpointId)) throw duplicateError();
            store.checkpoints.push({
              consumer_checkpoint_id: checkpointId,
              consumer_name: consumer,
              source_name: source,
              partition_key: partition,
              last_contiguous_position: 0,
              high_watermark_position: 0,
              state_generation: 0,
              checkpoint_transition_id: null,
              gap_status: "CLEAR",
              gap_from_position: null,
              gap_to_position: null,
              gap_reason_code: null,
              blocked_receipt_id: null,
              handler_version: handlerVersion,
              last_event_id: null,
              last_receipt_id: null,
              created_at: NOW,
              updated_at: NOW,
            });
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "checkpoint_lock" || tag === "checkpoint_read") {
            const row = exactCheckpoint(store, values[0], values[1], values[2]);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "receipt_by_event_lock" || tag === "receipt_read") {
            let row;
            if (values.length === 2) row = exactReceiptByEvent(store, values[0], values[1]);
            else row = exactReceiptByPosition(store, values[0], values[1], values[2], values[3]);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "receipt_by_position_lock") {
            const row = exactReceiptByPosition(store, values[0], values[1], values[2], values[3]);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "receipt_insert") {
            const [
              receiptId, consumer, source, partition, position, eventId, eventType,
              schemaVersion, aggregateType, aggregateId, aggregateVersion, occurredAt,
              producerVersion, correlationId, causationId, idempotencyKey, handlerVersion,
              handlerId, handlerRegistryVersion, handlerDescriptorDigest, handlerSourceDigest,
              handlerRegistrationDigest,
              payloadJson, payloadCodecVersion, payloadKeyId, payloadDigestScheme,
              payloadDigest, maxAttempts, retryPolicyVersion, transitionId,
            ] = values;
            if (exactReceiptByEvent(store, consumer, eventId)
              || exactReceiptByPosition(store, consumer, source, partition, position)
              || store.receipts.some((row) => row.inbox_receipt_id === receiptId)) throw duplicateError();
            store.receipts.push({
              inbox_receipt_id: receiptId,
              consumer_name: consumer,
              source_name: source,
              partition_key: partition,
              partition_position: position,
              event_id: eventId,
              event_type: eventType,
              schema_version: schemaVersion,
              aggregate_type: aggregateType,
              aggregate_id: aggregateId,
              aggregate_version: aggregateVersion,
              occurred_at: occurredAt,
              producer_version: producerVersion,
              correlation_id: correlationId,
              causation_id: causationId,
              idempotency_key: idempotencyKey,
              handler_version: handlerVersion,
              handler_id: handlerId,
              handler_registry_version: handlerRegistryVersion,
              handler_descriptor_digest: handlerDescriptorDigest,
              handler_source_digest: handlerSourceDigest,
              handler_registration_digest: handlerRegistrationDigest,
              payload_json: payloadJson,
              payload_codec_version: payloadCodecVersion,
              payload_key_id: payloadKeyId,
              payload_digest_scheme: payloadDigestScheme,
              payload_digest: payloadDigest,
              status: "RECEIVED",
              attempt_count: 0,
              max_attempts: maxAttempts,
              retry_policy_version: retryPolicyVersion,
              next_retry_at: null,
              lease_owner: null,
              lease_expires_at: null,
              lease_generation: 0,
              inbox_transition_id: transitionId,
              result_json: null,
              result_codec_version: null,
              result_key_id: null,
              result_digest_scheme: null,
              result_digest: null,
              completion_manifest_digest: null,
              completion_manifest_digest_scheme: null,
              error_json: null,
              first_received_at: NOW,
              last_received_at: NOW,
              started_at: null,
              completed_at: null,
              failed_at: null,
              dead_lettered_at: null,
              updated_at: NOW,
            });
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "receipt_touch") {
            const row = store.receipts.find((candidate) => candidate.inbox_receipt_id === values[0]
              && candidate.consumer_name === values[1]
              && candidate.event_id === values[2]
              && candidate.payload_digest === values[3]
              && candidate.handler_id === values[4]
              && candidate.handler_registry_version === values[5]
              && candidate.handler_descriptor_digest === values[6]
              && candidate.handler_source_digest === values[7]
              && candidate.handler_registration_digest === values[8]);
            if (!row) return [{ affectedRows: 0 }, []];
            row.last_received_at = NOW;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "gap_head_lock") {
            const [consumer, source, partition, minimum] = values;
            const row = store.receipts
              .filter((candidate) => candidate.consumer_name === consumer
                && candidate.source_name === source
                && candidate.partition_key === partition
                && candidate.partition_position >= minimum)
              .sort((left, right) => left.partition_position - right.partition_position)[0];
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "checkpoint_state_update") {
            const [high, transitionId, gapStatus, gapFrom, gapTo, reason, blocked,
              checkpointId, generation, last, previousHigh, handlerVersion] = values;
            const row = store.checkpoints.find((candidate) => candidate.consumer_checkpoint_id === checkpointId
              && candidate.state_generation === generation
              && candidate.last_contiguous_position === last
              && candidate.high_watermark_position === previousHigh
              && candidate.handler_version === handlerVersion);
            if (!row) return [{ affectedRows: 0 }, []];
            row.high_watermark_position = high;
            row.state_generation += 1;
            row.checkpoint_transition_id = transitionId;
            row.gap_status = gapStatus;
            row.gap_from_position = gapFrom;
            row.gap_to_position = gapTo;
            row.gap_reason_code = reason;
            row.blocked_receipt_id = blocked;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "claim_head_lock") {
            const row = exactReceiptByPosition(store, values[0], values[1], values[2], values[3]);
            return [row ? [{ ...clone(row), retry_due: row.status !== "RETRY_PENDING" || row.next_retry_at <= NOW ? 1 : 0 }] : [], []];
          }

          if (tag === "claim_update") {
            const [workerId, leaseSeconds, transitionId, receiptId, previousStatus,
              attemptCount, maxAttempts, generation, retryPolicyVersion,
              consumer, source, partition, position, eventId, payloadDigest,
              handlerId, handlerRegistryVersion, handlerDescriptorDigest, handlerSourceDigest,
              handlerRegistrationDigest] = values;
            const row = store.receipts.find((candidate) => candidate.inbox_receipt_id === receiptId);
            const due = row && (row.status === "RECEIVED"
              || (row.status === "RETRY_PENDING" && row.next_retry_at <= NOW));
            const matches = row
              && due
              && row.status === previousStatus
              && row.attempt_count === attemptCount
              && row.max_attempts === maxAttempts
              && row.attempt_count < row.max_attempts
              && row.lease_generation === generation
              && row.retry_policy_version === retryPolicyVersion
              && row.lease_owner === null
              && row.lease_expires_at === null
              && row.consumer_name === consumer
              && row.source_name === source
              && row.partition_key === partition
              && row.partition_position === position
              && row.event_id === eventId
              && row.payload_digest === payloadDigest
              && row.handler_id === handlerId
              && row.handler_registry_version === handlerRegistryVersion
              && row.handler_descriptor_digest === handlerDescriptorDigest
              && row.handler_source_digest === handlerSourceDigest
              && row.handler_registration_digest === handlerRegistrationDigest;
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "CLAIMED";
            row.attempt_count += 1;
            row.lease_generation += 1;
            row.lease_owner = workerId;
            row.lease_expires_at = afterSeconds(leaseSeconds);
            row.inbox_transition_id = transitionId;
            row.next_retry_at = null;
            row.error_json = null;
            row.started_at = NOW;
            row.failed_at = null;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "claim_read" || tag === "owned_lock") {
            const [receiptId, workerId, generation, transitionId] = values;
            const row = store.receipts.find((candidate) => candidate.inbox_receipt_id === receiptId
              && candidate.status === "CLAIMED"
              && candidate.lease_owner === workerId
              && candidate.lease_generation === generation
              && candidate.inbox_transition_id === transitionId);
            return [row ? [{ ...clone(row), lease_active: row.lease_expires_at > NOW ? 1 : 0 }] : [], []];
          }

          if (tag === "claim_transition_read") {
            const [consumer, worker, transitionId] = values;
            return [store.receipts
              .filter((row) => row.consumer_name === consumer
                && row.status === "CLAIMED"
                && row.lease_owner === worker
                && row.inbox_transition_id === transitionId)
              .map((row) => ({ ...clone(row), lease_active: row.lease_expires_at > NOW ? 1 : 0 })), []];
          }

          if (tag === "handler_target_insert") {
            const [projectionId, projectionGeneration, taskEventId, sourceEventId,
              sourceEventType, sourceSchemaVersion, sourceName, sourcePartitionKey,
              sourcePartitionPosition, sourceAggregateVersion, taskType,
              completionEventType, occurredAt, handlerVersion, handlerRegistrationDigest] = values;
            if (store.targetFacts.some((row) => (row.projection_generation === projectionGeneration
              && row.task_event_id === taskEventId)
              || (row.projection_generation === projectionGeneration
                && row.source_event_id === sourceEventId))) throw duplicateError();
            store.targetFacts.push({
              projection_id: projectionId,
              projection_generation: projectionGeneration,
              task_event_id: taskEventId,
              source_event_id: sourceEventId,
              source_event_type: sourceEventType,
              source_schema_version: sourceSchemaVersion,
              source_name: sourceName,
              source_partition_key: sourcePartitionKey,
              source_partition_position: sourcePartitionPosition,
              source_aggregate_version: sourceAggregateVersion,
              task_type: taskType,
              completion_event_type: completionEventType,
              occurred_at: occurredAt,
              handler_version: handlerVersion,
              handler_registration_digest: handlerRegistrationDigest,
            });
            if (failTargetEventId === sourceEventId) {
              failTargetEventId = "";
              throw new Error("handler failed after target write token=must-not-leak");
            }
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "handler_target_select_conflicts") {
            const [projectionGeneration, taskEventId, sourceEventId] = values;
            const row = store.targetFacts.find((candidate) => (
              candidate.projection_generation === projectionGeneration
              && (candidate.task_event_id === taskEventId || candidate.source_event_id === sourceEventId)
            ));
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "handler_target_verify") {
            const [projectionId] = values;
            const row = store.targetFacts.find((candidate) => candidate.projection_id === projectionId);
            return [row ? [clone(row)] : [], []];
          }

          if (tag === "complete_update") {
            const [transitionId, resultJson, resultCodecVersion, resultKeyId,
              resultDigestScheme, resultDigest, manifestDigest, manifestDigestScheme,
              receiptId, workerId, generation, claimTransitionId, consumer, source,
              partition, position, eventId, payloadDigest, handlerId,
              handlerRegistryVersion, handlerDescriptorDigest, handlerSourceDigest,
              handlerRegistrationDigest] = values;
            const row = store.receipts.find((candidate) => candidate.inbox_receipt_id === receiptId);
            const matches = row
              && row.status === "CLAIMED"
              && row.lease_owner === workerId
              && row.lease_generation === generation
              && row.inbox_transition_id === claimTransitionId
              && row.lease_expires_at > NOW
              && row.consumer_name === consumer
              && row.source_name === source
              && row.partition_key === partition
              && row.partition_position === position
              && row.event_id === eventId
              && row.payload_digest === payloadDigest
              && row.handler_id === handlerId
              && row.handler_registry_version === handlerRegistryVersion
              && row.handler_descriptor_digest === handlerDescriptorDigest
              && row.handler_source_digest === handlerSourceDigest
              && row.handler_registration_digest === handlerRegistrationDigest;
            if (!matches) return [{ affectedRows: 0 }, []];
            row.status = "SUCCEEDED";
            row.inbox_transition_id = transitionId;
            row.result_json = resultJson;
            row.result_codec_version = resultCodecVersion;
            row.result_key_id = resultKeyId;
            row.result_digest_scheme = resultDigestScheme;
            row.result_digest = resultDigest;
            row.completion_manifest_digest = manifestDigest;
            row.completion_manifest_digest_scheme = manifestDigestScheme;
            row.lease_owner = null;
            row.lease_expires_at = null;
            row.next_retry_at = null;
            row.error_json = null;
            row.completed_at = NOW;
            row.failed_at = null;
            row.dead_lettered_at = null;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "checkpoint_complete_update") {
            const [position, high, transitionId, gapStatus, gapFrom, gapTo, reason,
              blocked, eventId, receiptId, checkpointId, generation, previousLast,
              previousHigh, handlerVersion] = values;
            const row = store.checkpoints.find((candidate) => candidate.consumer_checkpoint_id === checkpointId
              && candidate.state_generation === generation
              && candidate.last_contiguous_position === previousLast
              && candidate.high_watermark_position === previousHigh
              && candidate.handler_version === handlerVersion);
            if (!row) return [{ affectedRows: 0 }, []];
            row.last_contiguous_position = position;
            row.high_watermark_position = high;
            row.state_generation += 1;
            row.checkpoint_transition_id = transitionId;
            row.gap_status = gapStatus;
            row.gap_from_position = gapFrom;
            row.gap_to_position = gapTo;
            row.gap_reason_code = reason;
            row.blocked_receipt_id = blocked;
            row.last_event_id = eventId;
            row.last_receipt_id = receiptId;
            row.updated_at = NOW;
            return [{ affectedRows: 1 }, []];
          }

          if (tag === "transition_read") {
            const row = store.receipts.find((candidate) => candidate.inbox_receipt_id === values[0]);
            return [row ? [clone(row)] : [], []];
          }

          throw new Error(`unsupported inbox integration SQL tag ${tag}`);
        },
      };
      telemetry.connections.push(connection);
      return connection;
    },
  };

  return pool;
}

let transitionSequence = 0;
function createCore(pool) {
  return createMysqlInboxCheckpoint({
    pool,
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    sourceName: "myroot-api",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
    workerId: "worker-integration-v1",
    env: PROTECTED_INBOX_ENV,
    transitionIdFactory() {
      transitionSequence += 1;
      return `integration-inbox-transition-${transitionSequence}`;
    },
  });
}

function scopeFor(event) {
  return Object.freeze({
    sourceName: event.sourceName,
    partitionKey: event.partitionKey,
  });
}

test("protected Core persists neither event marker nor completion result plaintext", async () => {
  const pool = createRelationalPool();
  const core = createCore(pool);
  const event = eventEnvelope(1, {
    eventId: "event-sensitive-marker",
  });
  await core.receive(event);
  const persistedPayload = String(pool.state.receipts[0].payload_json);
  assert.doesNotMatch(persistedPayload, /event-sensitive-marker|SHARE_COMPLETED/);
  assert.match(persistedPayload, /A256GCM/);
  assert.notEqual(pool.state.receipts[0].payload_digest, event.payloadDigest);

  const [owned] = await core.claimNext(scopeFor(event));
  const completed = await core.completeOwned(owned);
  assert.equal(completed.result.taskEventId, event.eventId);
  assert.match(completed.result.projectionId, /^share_[a-f0-9]{58}$/);
  const persistedResult = String(pool.state.receipts[0].result_json);
  assert.doesNotMatch(persistedResult, new RegExp(completed.result.projectionId));
  assert.match(persistedResult, /A256GCM/);
});

test("default Core and real Adapter process independent singleton SHARE partitions", async () => {
  const pool = createRelationalPool();
  const core = createCore(pool);

  const eventTwo = eventEnvelope(2);
  const eventOne = eventEnvelope(1);
  const receivedTwo = await core.receive(eventTwo);
  const receivedOne = await core.receive(eventOne);
  assert.equal(receivedTwo.checkpoint.gapStatus, "CLEAR");
  assert.equal(receivedOne.checkpoint.gapStatus, "CLEAR");
  const [claimOne] = await core.claimNext(scopeFor(eventOne));
  assert.equal(claimOne.envelope.partitionPosition, 1);
  const completeOne = await core.completeOwned(claimOne);
  assert.equal(completeOne.status, "SUCCEEDED");
  assert.equal(completeOne.result.taskEventId, eventOne.eventId);

  const afterOne = await core.getCheckpoint(scopeFor(eventOne));
  assert.equal(afterOne.lastContiguousPosition, 1);
  assert.equal(afterOne.highWatermarkPosition, 1);
  const [claimTwo] = await core.claimNext(scopeFor(eventTwo));
  assert.equal(claimTwo.envelope.partitionPosition, 1);
  await core.completeOwned(claimTwo);

  const completed = await core.getCheckpoint(scopeFor(eventTwo));
  assert.equal(completed.lastContiguousPosition, 1);
  assert.equal(completed.highWatermarkPosition, 1);
  assert.equal(pool.state.targetFacts.length, 2);
  assert.deepEqual(pool.state.targetFacts.map((row) => row.source_event_id).sort(), [
    "event-integration-1", "event-integration-2",
  ]);
  assert.equal(pool.state.receipts.every((row) => row.status === "SUCCEEDED"), true);
});

test("target work failure rolls back target fact, receipt success and checkpoint together", async () => {
  const pool = createRelationalPool();
  const core = createCore(pool);
  const event = eventEnvelope(1, { eventId: "event-handler-failure" });
  await core.receive(event);
  const [owned] = await core.claimNext(scopeFor(event));
  pool.failHandlerAfterWrite(event.eventId);

  await assert.rejects(
    () => core.completeOwned(owned),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(pool.state.targetFacts.length, 0);
  assert.equal(pool.state.receipts[0].status, "CLAIMED");
  assert.equal(pool.state.checkpoints[0].last_contiguous_position, 0);
  assert.equal(pool.telemetry.rollbacks >= 1, true);
});

test("complete ACK unknown after commit converges from target, receipt and checkpoint evidence", async () => {
  const pool = createRelationalPool();
  const core = createCore(pool);
  const event = eventEnvelope(1, { eventId: "event-ack-applied" });
  await core.receive(event);
  const [owned] = await core.claimNext(scopeFor(event));
  pool.setNextCommitMode("apply-then-throw");

  const completed = await core.completeOwned(owned);
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.result.taskEventId, event.eventId);
  assert.equal(pool.state.targetFacts.length, 1);
  assert.equal(pool.state.receipts[0].status, "SUCCEEDED");
  assert.equal(pool.state.checkpoints[0].last_contiguous_position, 1);
  assert.equal(pool.telemetry.destroys, 1);
});

test("complete ACK unknown before apply retries the same replay-safe database work without duplicates", async () => {
  const pool = createRelationalPool();
  const core = createCore(pool);
  const event = eventEnvelope(1, { eventId: "event-ack-not-applied" });
  await core.receive(event);
  const [owned] = await core.claimNext(scopeFor(event));
  pool.setNextCommitMode("throw-before-apply");

  const completed = await core.completeOwned(owned);
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(pool.state.targetFacts.length, 1);
  assert.equal(pool.state.receipts[0].status, "SUCCEEDED");
  assert.equal(pool.state.checkpoints[0].last_contiguous_position, 1);
  assert.equal(pool.telemetry.destroys, 1);
  const targetWrites = pool.telemetry.sql.filter((entry) => entry.tag === "handler_target_insert");
  assert.equal(targetWrites.length, 2);
});
