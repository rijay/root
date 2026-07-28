const test = require("node:test");
const assert = require("node:assert/strict");

const { payloadSnapshot } = require("../src/eventTransport");
const { createInboxContentCodec } = require("../src/inboxContentProtection");
const { INBOX_RETRY_POLICY_V1 } = require("../src/inboxRetryPolicy");
const { buildTaskEventOutboxEnvelope } = require("../src/taskEventOutbox");
const {
  createMysqlInboxCheckpointAdapter,
} = require("../src/mysqlInboxCheckpointAdapter");
const {
  snapshotOutboxImmutableIdentity,
} = require("../src/mysqlEventTransportAdapter");
const {
  computeInboxHandlerAssemblyDigest,
  computeInboxHandlerDescriptorDigest,
  computeInboxHandlerSourceDigest,
  createInboxHandlerRegistry,
} = require("../src/inboxHandlerRegistry");

const NOW = "2026-07-16 20:00:00.000";
const TEST_CONTENT_KEY_ID = "mysql-inbox-adapter-test-key-v1";
const TEST_CONTENT_CODEC = createInboxContentCodec(Object.freeze({
  NODE_ENV: "test",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "mysql-inbox-adapter-test-secret-2026-07-16-v1",
  ROOT_INBOX_CONTENT_KEY_ID: TEST_CONTENT_KEY_ID,
}));
const TEST_HANDLER_ID = "mysql-inbox-adapter-test-handler-v1";
const TEST_APPLY_STATEMENT_ID = "test_projection.insert.v1";
const TEST_VERIFY_STATEMENT_ID = "test_projection.verify.v1";
const TEST_OUTBOX_CONTRACT_ID = "test_projection.successor.v1";
const TEST_SOURCE_PATH = "backend/tests/fixtures/mysqlInboxCheckpointAdapterHandlerFixture.js";
const TEST_SOURCE_BYTES = Buffer.from("module.exports = Object.freeze({ fixture: true });\n", "utf8");
const TEST_ASSEMBLY_SOURCE_PATH = "backend/src/inboxHandlerRegistry.js";
const TEST_ASSEMBLY_SOURCE_BYTES = Buffer.from(
  "module.exports = Object.freeze({ testAssembly: true });\n",
  "utf8"
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function envelope(overrides = {}) {
  const payload = overrides.payload === undefined
    ? { taskEventId: "task-event-inbox-1", eventType: "CHECKIN_COMPLETED" }
    : overrides.payload;
  return {
    eventId: "outbox-task-event-inbox-1",
    eventType: "task.event.created.v1",
    schemaVersion: "1",
    sourceName: "myroot-api",
    partitionKey: "task_event:task-event-inbox-1",
    partitionPosition: 1,
    aggregateType: "TASK_EVENT",
    aggregateId: "task-event-inbox-1",
    aggregateVersion: 1,
    occurredAt: "2026-07-16T20:00:00.000+08:00",
    producerVersion: "0.5.13",
    correlationId: null,
    causationId: null,
    idempotencyKey: "task-event:task-event-inbox-1",
    payload,
    payloadDigest: payloadSnapshot(payload).digest,
    ...overrides,
    payloadDigest: overrides.payloadDigest || payloadSnapshot(payload).digest,
  };
}

function checkpointRow(overrides = {}) {
  return {
    consumer_checkpoint_id: "checkpoint_12345678901234567890123456789012345678901234567890123",
    consumer_name: "task-projection-v1",
    source_name: "myroot-api",
    partition_key: "task_event:task-event-inbox-1",
    last_contiguous_position: 0,
    high_watermark_position: 0,
    state_generation: 0,
    checkpoint_transition_id: null,
    gap_status: "CLEAR",
    gap_from_position: null,
    gap_to_position: null,
    gap_reason_code: null,
    blocked_receipt_id: null,
    handler_version: "task-projection-v1",
    last_event_id: null,
    last_receipt_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function payloadContentBinding(row) {
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

function resultContentBinding(row) {
  return {
    ...payloadContentBinding(row),
    receiptId: row.inbox_receipt_id,
    leaseGeneration: row.lease_generation,
    completionTransitionId: row.inbox_transition_id,
  };
}

function receiptRow(overrides = {}) {
  const event = overrides.envelope || envelope();
  const payload = Object.prototype.hasOwnProperty.call(overrides, "payload_json")
    ? overrides.payload_json
    : event.payload;
  const result = Object.prototype.hasOwnProperty.call(overrides, "result_json")
    ? overrides.result_json
    : null;
  const {
    envelope: _envelope,
    payload_json: _payloadJson,
    payload_codec_version: _payloadCodecVersion,
    payload_key_id: _payloadKeyId,
    payload_digest_scheme: _payloadDigestScheme,
    payload_digest: _payloadDigest,
    result_json: _resultJson,
    result_codec_version: _resultCodecVersion,
    result_key_id: _resultKeyId,
    result_digest_scheme: _resultDigestScheme,
    result_digest: _resultDigest,
    completion_manifest_digest: _completionManifestDigest,
    completion_manifest_digest_scheme: _completionManifestDigestScheme,
    ...rowOverrides
  } = overrides;
  const row = {
    inbox_receipt_id: "inbox_1234567890123456789012345678901234567890123456789012345",
    consumer_name: "task-projection-v1",
    source_name: event.sourceName,
    partition_key: event.partitionKey,
    partition_position: event.partitionPosition,
    event_id: event.eventId,
    event_type: event.eventType,
    schema_version: event.schemaVersion,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    aggregate_version: event.aggregateVersion,
    occurred_at: "2026-07-16 20:00:00.000",
    producer_version: event.producerVersion,
    correlation_id: event.correlationId,
    causation_id: event.causationId,
    idempotency_key: event.idempotencyKey,
    handler_version: "task-projection-v1",
    handler_id: DEFAULT_HANDLER_REGISTRATION.descriptor.handlerId,
    handler_registry_version: DEFAULT_HANDLER_REGISTRATION.registryVersion,
    handler_descriptor_digest: DEFAULT_HANDLER_REGISTRATION.descriptor.descriptorDigest,
    handler_source_digest: DEFAULT_HANDLER_REGISTRATION.descriptor.sourceDigest,
    handler_registration_digest: DEFAULT_HANDLER_REGISTRATION.registrationDigest,
    payload_json: null,
    payload_codec_version: null,
    payload_key_id: null,
    payload_digest_scheme: null,
    payload_digest: null,
    status: "RECEIVED",
    attempt_count: 0,
    max_attempts: 5,
    retry_policy_version: "inbox-retry-v1",
    next_retry_at: null,
    lease_owner: null,
    lease_expires_at: null,
    lease_generation: 0,
    inbox_transition_id: "receive-transition-1",
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
    ...rowOverrides,
  };
  const sealedPayload = TEST_CONTENT_CODEC.seal(payload, {
    purpose: "PAYLOAD",
    binding: payloadContentBinding(row),
  });
  row.payload_json = clone(sealedPayload.stored);
  row.payload_codec_version = sealedPayload.codecVersion;
  row.payload_key_id = sealedPayload.keyId;
  row.payload_digest_scheme = sealedPayload.digestScheme;
  row.payload_digest = sealedPayload.contentDigest;
  if (result !== null) {
    const binding = resultContentBinding(row);
    const sealedResult = TEST_CONTENT_CODEC.seal(result, {
      purpose: "RESULT",
      binding,
    });
    row.result_json = clone(sealedResult.stored);
    row.result_codec_version = sealedResult.codecVersion;
    row.result_key_id = sealedResult.keyId;
    row.result_digest_scheme = sealedResult.digestScheme;
    row.result_digest = sealedResult.contentDigest;
    row.completion_manifest_digest = TEST_CONTENT_CODEC.digest(result.completionManifest, {
      purpose: "MANIFEST",
      binding,
      keyId: sealedResult.keyId,
    });
    row.completion_manifest_digest_scheme = sealedResult.digestScheme;
  }
  return row;
}

function claimedRow(overrides = {}) {
  return receiptRow({
    status: "CLAIMED",
    attempt_count: 1,
    lease_owner: "worker-inbox-1",
    lease_expires_at: "2026-07-16 20:00:30.000",
    lease_generation: 1,
    inbox_transition_id: "claim-transition-1",
    started_at: NOW,
    ...overrides,
  });
}

function claim(overrides = {}) {
  const { row: rowOverrides = {}, ...claimOverrides } = overrides;
  const row = claimedRow(rowOverrides);
  const openedPayload = TEST_CONTENT_CODEC.open(row.payload_json, {
    purpose: "PAYLOAD",
    binding: payloadContentBinding(row),
  }).value;
  const transportDigest = payloadSnapshot(openedPayload).digest;
  return {
    receiptId: row.inbox_receipt_id,
    consumerName: row.consumer_name,
    handlerVersion: row.handler_version,
    leaseOwner: row.lease_owner,
    leaseGeneration: row.lease_generation,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicyVersion: row.retry_policy_version,
    claimTransitionId: row.inbox_transition_id,
    payloadDigest: transportDigest,
    envelope: {
      eventId: row.event_id,
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
      payload: clone(openedPayload),
      payloadDigest: transportDigest,
    },
    ...claimOverrides,
  };
}

function handlerFactory(overrides = {}) {
  const sourceDigest = computeInboxHandlerSourceDigest(
    [TEST_SOURCE_PATH],
    () => TEST_SOURCE_BYTES,
    "TEST_ONLY"
  );
  const descriptor = {
    descriptorVersion: 1,
    handlerId: TEST_HANDLER_ID,
    ownerModule: "MysqlInboxCheckpointAdapterTest",
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    sourceName: "myroot-api",
    eventType: "task.event.created.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
    kind: "DATABASE_ONLY",
    replaySafe: true,
    applyStatementIds: [TEST_APPLY_STATEMENT_ID],
    applyExecutionProfiles: [[TEST_APPLY_STATEMENT_ID]],
    verifyStatementIds: [TEST_VERIFY_STATEMENT_ID],
    requiredVerifyStatementIds: [TEST_VERIFY_STATEMENT_ID],
    outboxContractIds: [TEST_OUTBOX_CONTRACT_ID],
    sourcePaths: [TEST_SOURCE_PATH],
    sourceDigest,
    descriptorDigest: "0".repeat(64),
  };
  descriptor.descriptorDigest = computeInboxHandlerDescriptorDigest(descriptor);
  const manifest = {
    registryVersion: 1,
    scope: "TEST_ONLY",
    assemblySourcePaths: [TEST_ASSEMBLY_SOURCE_PATH],
    assemblySourceDigest: computeInboxHandlerAssemblyDigest(
      [TEST_ASSEMBLY_SOURCE_PATH],
      () => TEST_ASSEMBLY_SOURCE_BYTES
    ),
    handlers: [{
      descriptor,
      statements: [
        {
          statementId: TEST_APPLY_STATEMENT_ID,
          phase: "APPLY_WRITE",
          sql: "INSERT INTO `projection_fact` (`event_id`) VALUES (?)",
          parameterNames: ["eventId"],
          parameterRules: [{
            name: "eventId",
            type: "TEXT",
            nullable: false,
            maximumLength: 64,
            minimum: null,
            maximum: null,
          }],
          resultMode: "AFFECTED_ONE",
        },
        {
          statementId: TEST_VERIFY_STATEMENT_ID,
          phase: "VERIFY_READ",
          sql: "SELECT `projection_id` FROM `projection_fact` WHERE `projection_id` = ?",
          parameterNames: ["projectionId"],
          parameterRules: [{
            name: "projectionId",
            type: "TEXT",
            nullable: false,
            maximumLength: 64,
            minimum: null,
            maximum: null,
          }],
          resultMode: "ROWS",
        },
      ],
      outboxContracts: [{
        contractId: TEST_OUTBOX_CONTRACT_ID,
        topic: "task.events",
        eventType: "task.event.recorded.v1",
        schemaVersion: "1",
        sourceName: "myroot-api",
        maximumPerInvocation: 1,
      }],
    }],
  };
  const implementation = Object.freeze({
    async apply(context) {
      const toolbox = Object.freeze({
        execute(sql, parameters) {
          if (sql === "INSERT INTO `projection_fact` (`event_id`) VALUES (?)"
            && Array.isArray(parameters) && parameters.length === 1) {
            return context.executeStatement(TEST_APPLY_STATEMENT_ID, { eventId: parameters[0] })
              .then((result) => [result, []]);
          }
          return context.executeStatement(String(sql), {});
        },
        stageOutbox(successor) {
          return context.stageOutbox(TEST_OUTBOX_CONTRACT_ID, successor);
        },
      });
      if (overrides.apply) return overrides.apply(toolbox, context.envelope);
      await context.executeStatement(TEST_APPLY_STATEMENT_ID, { eventId: context.envelope.eventId });
      return { result: { applied: true }, manifest: { targetFactIds: ["fact-1"] } };
    },
    async verify(context) {
      const toolbox = Object.freeze({
        execute(sql, parameters) {
          if (sql === "SELECT `projection_id` FROM `projection_fact` WHERE `projection_id` = ?"
            && Array.isArray(parameters) && parameters.length === 1) {
            return context.executeStatement(TEST_VERIFY_STATEMENT_ID, { projectionId: parameters[0] })
              .then((rows) => [rows, []]);
          }
          return context.executeStatement(String(sql), {});
        },
      });
      if (overrides.verify) return overrides.verify(toolbox, context);
      const projectionId = context.result.projectionId || "projection-1";
      const rows = await context.executeStatement(TEST_VERIFY_STATEMENT_ID, { projectionId });
      return Array.isArray(rows);
    },
    outboxBuilders: Object.freeze({
      [TEST_OUTBOX_CONTRACT_ID](successor) { return successor; },
    }),
  });
  const registry = createInboxHandlerRegistry({
    manifest,
    implementations: { [TEST_HANDLER_ID]: implementation },
    sourceReader(sourcePath) {
      if (sourcePath === TEST_SOURCE_PATH) return TEST_SOURCE_BYTES;
      if (sourcePath === TEST_ASSEMBLY_SOURCE_PATH) return TEST_ASSEMBLY_SOURCE_BYTES;
      throw new Error("unknown test source");
    },
  });
  return registry.assertScope({
    consumerName: descriptor.consumerName,
    handlerVersion: descriptor.handlerVersion,
    sourceName: descriptor.sourceName,
    eventType: descriptor.eventType,
    schemaVersion: descriptor.schemaVersion,
    aggregateType: descriptor.aggregateType,
  });
}

const DEFAULT_HANDLER_REGISTRATION = handlerFactory();

function completionHandlerEvidence(executedApplyStatementIds = [TEST_APPLY_STATEMENT_ID]) {
  return {
    handlerId: DEFAULT_HANDLER_REGISTRATION.descriptor.handlerId,
    handlerVersion: DEFAULT_HANDLER_REGISTRATION.descriptor.handlerVersion,
    registryVersion: DEFAULT_HANDLER_REGISTRATION.registryVersion,
    registryDigest: DEFAULT_HANDLER_REGISTRATION.registryDigest,
    assemblySourceDigest: DEFAULT_HANDLER_REGISTRATION.assemblySourceDigest,
    registrationDigest: DEFAULT_HANDLER_REGISTRATION.registrationDigest,
    descriptorDigest: DEFAULT_HANDLER_REGISTRATION.descriptor.descriptorDigest,
    sourceDigest: DEFAULT_HANDLER_REGISTRATION.descriptor.sourceDigest,
    executedApplyStatementIds,
  };
}

function sqlTag(sql) {
  const compact = String(sql).replace(/\s+/g, " ").trim();
  const match = compact.match(/\/\* inbox_checkpoint:([a-z_]+) \*\//);
  return match && match[1];
}

function connectionWith(handler) {
  const calls = [];
  const connection = {
    async execute(sql, values = []) {
      const tag = sqlTag(sql);
      calls.push({ tag: tag || "handler_sql", sql: String(sql), values: clone(values) });
      return handler({ tag, sql: String(sql), values, calls });
    },
  };
  return { connection, calls };
}

function adapter(connection, handlerRegistration = DEFAULT_HANDLER_REGISTRATION) {
  return createMysqlInboxCheckpointAdapter(connection, {
    contentCodec: TEST_CONTENT_CODEC,
    handlerRegistration,
  });
}

test("exposes only the transaction-bound Inbox Adapter Interface", () => {
  const instance = adapter({ async execute() { return [{ affectedRows: 1 }, []]; } });
  assert.deepEqual(Object.keys(instance).sort(), [
    "afterCommit",
    "claimNext",
    "completeOwned",
    "discard",
    "failOwned",
    "getCheckpoint",
    "readClaimByTransition",
    "readReceiptConvergence",
    "readRecoveryByTransition",
    "readTransition",
    "receive",
    "recoverExpired",
  ].sort());
  assert.throws(
    () => createMysqlInboxCheckpointAdapter({}, { handlerRegistration: DEFAULT_HANDLER_REGISTRATION }),
    (error) => error.code === "INBOX_CHECKPOINT_CONFIGURATION_INVALID"
  );
});

test("durable Inbox Adapter rejects a plaintext codec before issuing SQL", () => {
  const calls = [];
  const connection = { async execute(...args) { calls.push(args); return [{ affectedRows: 1 }, []]; } };
  assert.throws(
    () => createMysqlInboxCheckpointAdapter(connection, {
      contentCodec: createInboxContentCodec({ NODE_ENV: "test" }),
      handlerRegistration: DEFAULT_HANDLER_REGISTRATION,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_CONFIGURATION_INVALID"
  );
  assert.equal(calls.length, 0);
});

test("rejects malformed or non-canonical envelopes before issuing SQL", async () => {
  const calls = [];
  const instance = adapter({ async execute(...args) { calls.push(args); return [{ affectedRows: 1 }, []]; } });
  const invalid = envelope({ partitionPosition: 0 });
  await assert.rejects(
    () => instance.receive({
      consumerName: "task-projection-v1",
      handlerVersion: "task-projection-v1",
      transitionId: "receive-transition-1",
      maxAttempts: 5,
      retryPolicyVersion: "inbox-retry-v1",
      envelope: invalid,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_INPUT_INVALID"
  );
  await assert.rejects(
    () => instance.receive({
      consumerName: "task-projection-v1",
      handlerVersion: "task-projection-v1",
      transitionId: "receive-transition-1",
      maxAttempts: 5,
      retryPolicyVersion: "inbox-retry-v1",
      envelope: envelope({ occurredAt: "2026-99-99 20:00:00" }),
    }),
    (error) => error.code === "INBOX_CHECKPOINT_INPUT_INVALID"
  );
  assert.equal(calls.length, 0);
});

test("receives a complete envelope under checkpoint-first locking and records the leading gap", async () => {
  let insertedReceiptId = "";
  let insertedCheckpointId = "";
  const { connection, calls } = connectionWith(({ tag, values }) => {
    if (tag === "checkpoint_insert") {
      insertedCheckpointId = values[0];
      return [{ affectedRows: 1 }, []];
    }
    if (tag === "checkpoint_lock") return [[checkpointRow({ consumer_checkpoint_id: insertedCheckpointId })], []];
    if (tag === "receipt_by_event_lock" || tag === "receipt_by_position_lock") return [[], []];
    if (tag === "receipt_insert") {
      insertedReceiptId = values[0];
      return [{ affectedRows: 1 }, []];
    }
    if (tag === "gap_head_lock") return [[receiptRow({ inbox_receipt_id: insertedReceiptId })], []];
    if (tag === "checkpoint_state_update") return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection);
  const result = await instance.receive({
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    transitionId: "receive-transition-1",
    maxAttempts: 5,
    retryPolicyVersion: "inbox-retry-v1",
    envelope: envelope(),
  });

  assert.equal(result.created, true);
  assert.equal(result.receiptStatus, "RECEIVED");
  assert.equal(result.checkpoint.highWatermarkPosition, 1);
  assert.equal(result.checkpoint.lastContiguousPosition, 0);
  assert.equal(result.checkpoint.gapStatus, "CLEAR");
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(calls.map((call) => call.tag), [
    "checkpoint_insert",
    "checkpoint_lock",
    "receipt_by_event_lock",
    "receipt_by_position_lock",
    "receipt_insert",
    "gap_head_lock",
    "checkpoint_state_update",
  ]);
  assert.equal(calls[4].values[21], DEFAULT_HANDLER_REGISTRATION.registrationDigest);
  const storedPayload = JSON.parse(calls[4].values[22]);
  assert.equal(storedPayload.protection, "A256GCM");
  assert.equal(storedPayload.purpose, "PAYLOAD");
  assert.deepEqual(calls[4].values.slice(23, 27), [
    storedPayload.codecVersion,
    storedPayload.keyId,
    storedPayload.digestScheme,
    storedPayload.contentDigest,
  ]);
  assert.equal(storedPayload.keyId, TEST_CONTENT_KEY_ID);
  assert.doesNotMatch(calls[4].values[22], /task-event-inbox-1|CHECKIN_COMPLETED/);
  assert.equal(calls[4].values.includes(JSON.stringify(envelope().payload)), false);
  assert.equal(calls[4].sql.includes(envelope().eventId), false);
});

test("exact duplicate receive is replay-only while a changed position owner fails closed", async () => {
  const existing = receiptRow();
  const duplicate = new Error("duplicate checkpoint");
  duplicate.code = "ER_DUP_ENTRY";
  duplicate.errno = 1062;
  let checkpointId = "";
  const { connection, calls } = connectionWith(({ tag, values }) => {
    if (tag === "checkpoint_insert") {
      checkpointId = values[0];
      throw duplicate;
    }
    if (tag === "checkpoint_lock") return [[checkpointRow({
      consumer_checkpoint_id: checkpointId,
      high_watermark_position: 1,
    })], []];
    if (tag === "receipt_by_event_lock" || tag === "receipt_by_position_lock") return [[existing], []];
    if (tag === "receipt_touch") return [{ affectedRows: 1 }, []];
    if (tag === "gap_head_lock") return [[existing], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection);
  const replay = await instance.receive({
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    transitionId: "receive-transition-2",
    maxAttempts: 5,
    retryPolicyVersion: "inbox-retry-v1",
    envelope: envelope(),
  });
  assert.equal(replay.created, false);
  assert.equal(replay.receiptId, existing.inbox_receipt_id);
  assert.equal(calls.some((call) => call.tag === "receipt_by_position_lock"), false);
  assert.equal(calls.some((call) => call.tag === "checkpoint_state_update"), false);

  let conflictCheckpointId = "";
  const { connection: conflictConnection, calls: conflictCalls } = connectionWith(({ tag, values }) => {
    if (tag === "checkpoint_insert") {
      conflictCheckpointId = values[0];
      return [{ affectedRows: 1 }, []];
    }
    if (tag === "checkpoint_lock") return [[checkpointRow({ consumer_checkpoint_id: conflictCheckpointId })], []];
    if (tag === "receipt_by_event_lock") return [[], []];
    if (tag === "receipt_by_position_lock") return [[receiptRow({ event_id: "other-event" })], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const conflictAdapter = adapter(conflictConnection);
  await assert.rejects(
    () => conflictAdapter.receive({
      consumerName: "task-projection-v1",
      handlerVersion: "task-projection-v1",
      transitionId: "receive-transition-3",
      maxAttempts: 5,
      retryPolicyVersion: "inbox-retry-v1",
      envelope: envelope(),
    }),
    (error) => error.code === "INBOX_CHECKPOINT_ENVELOPE_CONFLICT"
  );
  assert.deepEqual(conflictCalls.map((call) => call.tag), [
    "checkpoint_insert", "checkpoint_lock", "receipt_by_event_lock", "receipt_by_position_lock",
  ]);
});

test("claims only the checkpoint head and fences it with owner, generation and transition", async () => {
  const before = receiptRow();
  const after = claimedRow();
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "claim_head_lock") return [[{ ...before, retry_due: 1 }], []];
    if (tag === "claim_update") return [{ affectedRows: 1 }, []];
    if (tag === "claim_read") return [[{ ...after, lease_active: 1 }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const [owned] = await adapter(connection).claimNext({
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    workerId: "worker-inbox-1",
    transitionId: "claim-transition-1",
    sourceName: "myroot-api",
    partitionKey: "task_event:task-event-inbox-1",
    leaseSeconds: 30,
    retryPolicyVersion: "inbox-retry-v1",
  });
  assert.equal(owned.receiptId, before.inbox_receipt_id);
  assert.equal(owned.leaseGeneration, 1);
  assert.equal(owned.attemptCount, 1);
  assert.deepEqual(owned.envelope.payload, envelope().payload);
  assert.equal(owned.payloadDigest, envelope().payloadDigest);
  assert.equal(owned.envelope.payloadDigest, envelope().payloadDigest);
  assert.notEqual(owned.payloadDigest, before.payload_digest);
  assert.equal(Object.isFrozen(owned), true);
  assert.equal(Object.isFrozen(owned.envelope.payload), true);
  assert.deepEqual(calls.map((call) => call.tag), [
    "checkpoint_lock", "claim_head_lock", "claim_update", "claim_read",
  ]);
});

test("durable payload rows reject plaintext and metadata/envelope mismatches before claim mutation", async () => {
  const cases = [
    ["plaintext payload", (row) => ({ ...row, payload_json: clone(envelope().payload) })],
    ["payload codec version", (row) => ({ ...row, payload_codec_version: "A256GCM:v2" })],
    ["payload key id", (row) => ({ ...row, payload_key_id: "other-inbox-key-v1" })],
    ["payload digest scheme", (row) => ({ ...row, payload_digest_scheme: "hmac-sha512:v1" })],
    ["handler registration digest", (row) => ({
      ...row,
      handler_registration_digest: "f".repeat(64),
    })],
  ];
  for (const [name, mutate] of cases) {
    const invalidRow = mutate(receiptRow());
    const { connection, calls } = connectionWith(({ tag }) => {
      if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
      if (tag === "claim_head_lock") return [[{ ...invalidRow, retry_due: 1 }], []];
      throw new Error(`unexpected tag ${tag}`);
    });
    await assert.rejects(
      () => adapter(connection).claimNext({
        consumerName: "task-projection-v1",
        handlerVersion: "task-projection-v1",
        workerId: "worker-inbox-1",
        transitionId: "claim-transition-protection-mismatch",
        sourceName: "myroot-api",
        partitionKey: "task_event:task-event-inbox-1",
        leaseSeconds: 30,
        retryPolicyVersion: "inbox-retry-v1",
      }),
      (error) => error.code === "INBOX_CHECKPOINT_ROW_INVALID",
      name
    );
    assert.deepEqual(calls.map((call) => call.tag), ["checkpoint_lock", "claim_head_lock"], name);
  }
});

test("durable result rows reject plaintext and metadata/envelope mismatches during ACK readback", async () => {
  const completionManifest = {
    handler: {},
    successorOutboxFacts: [],
    outboxFlush: { inserted: 0, replayed: 0 },
  };
  const valid = receiptRow({
    status: "SUCCEEDED",
    attempt_count: 1,
    lease_generation: 1,
    inbox_transition_id: "complete-transition-protection-mismatch",
    result_json: { result: {}, completionManifest },
    completed_at: NOW,
    started_at: NOW,
  });
  const cases = [
    ["plaintext result", (row) => ({ ...row, result_json: { result: {}, completionManifest } })],
    ["result codec version", (row) => ({ ...row, result_codec_version: "A256GCM:v2" })],
    ["result key id", (row) => ({ ...row, result_key_id: "other-inbox-key-v1" })],
    ["result digest scheme", (row) => ({ ...row, result_digest_scheme: "hmac-sha512:v1" })],
    ["manifest digest scheme", (row) => ({ ...row, completion_manifest_digest_scheme: "hmac-sha512:v1" })],
    ["result on a non-success status", (row) => ({ ...row, status: "REVIEW_REQUIRED" })],
    ["success without protected result", (row) => ({
      ...row,
      result_json: null,
      result_codec_version: null,
      result_key_id: null,
      result_digest_scheme: null,
      result_digest: null,
      completion_manifest_digest: null,
      completion_manifest_digest_scheme: null,
    })],
  ];
  for (const [name, mutate] of cases) {
    const invalidRow = mutate(valid);
    const { connection, calls } = connectionWith(({ tag }) => {
      if (tag === "transition_read") return [[invalidRow], []];
      throw new Error(`unexpected tag ${tag}`);
    });
    await assert.rejects(
      () => adapter(connection).readTransition({
        claim: claim(),
        transitionId: "complete-transition-protection-mismatch",
        expectedStatus: "SUCCEEDED",
        expectedFailure: null,
      }),
      (error) => error.code === "INBOX_CHECKPOINT_ROW_INVALID",
      name
    );
    assert.deepEqual(calls.map((call) => call.tag), ["transition_read"], name);
  }
});

test("a retry-pending head that is not due remains unclaimed", async () => {
  const row = receiptRow({
    status: "RETRY_PENDING",
    attempt_count: 1,
    next_retry_at: "2026-07-16 20:05:00.000",
    failed_at: NOW,
    error_json: { code: "INBOX_HANDLER_FAILED", message: "inbox processing failed" },
  });
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "claim_head_lock") return [[{ ...row, retry_due: 0 }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  assert.deepEqual(await adapter(connection).claimNext({
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    workerId: "worker-inbox-1",
    transitionId: "claim-transition-2",
    sourceName: "myroot-api",
    partitionKey: "task_event:task-event-inbox-1",
    leaseSeconds: 30,
    retryPolicyVersion: "inbox-retry-v1",
  }), []);
  assert.deepEqual(calls.map((call) => call.tag), ["checkpoint_lock", "claim_head_lock"]);
});

test("completeOwned commits target facts, successor outbox, receipt and checkpoint through one transaction Adapter", async () => {
  const owned = claim();
  const persisted = claimedRow();
  const successor = buildTaskEventOutboxEnvelope({
    task_event_id: "successor-event-1",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T20:00:00.000+08:00",
    created_at: "2026-07-16T20:00:00.000+08:00",
  });
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...persisted, lease_active: 1 }], []];
    if (tag === null) return [{ affectedRows: 1 }, []];
    if (tag === "complete_update") return [{ affectedRows: 1 }, []];
    if (tag === "gap_head_lock") return [[], []];
    if (tag === "checkpoint_complete_update") return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection, handlerFactory({
    async apply(toolbox, inputEnvelope) {
      await toolbox.execute("INSERT INTO `projection_fact` (`event_id`) VALUES (?)", [inputEnvelope.eventId]);
      toolbox.stageOutbox(successor);
      return {
        result: { projectionId: "projection-1" },
        manifest: { targetFactIds: ["projection-1"] },
      };
    },
  }));
  const completed = await instance.completeOwned(owned, { transitionId: "complete-transition-1" });
  assert.equal(completed.status, "SUCCEEDED");
  assert.deepEqual(completed.result, { projectionId: "projection-1" });
  const successorIdentity = snapshotOutboxImmutableIdentity(successor);
  assert.deepEqual(completed.completionManifest, {
    handlerEvidence: completionHandlerEvidence(),
    handler: { targetFactIds: ["projection-1"] },
    successorOutboxFacts: [{
      contractId: TEST_OUTBOX_CONTRACT_ID,
      outboxEventId: successor.outbox_event_id,
      immutableIdentity: successorIdentity,
      immutableIdentityDigest: payloadSnapshot(successorIdentity).digest,
    }],
    outboxFlush: { inserted: 1, replayed: 0 },
  });
  assert.match(completed.resultDigest, /^[a-f0-9]{64}$/);
  assert.match(completed.completionManifestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.map((call) => call.tag || "handler_sql"), [
    "checkpoint_lock",
    "owned_lock",
    "handler_sql",
    "handler_sql",
    "complete_update",
    "gap_head_lock",
    "checkpoint_complete_update",
  ]);
  const completeCall = calls.find((call) => call.tag === "complete_update");
  const storedResult = JSON.parse(completeCall.values[1]);
  assert.equal(storedResult.protection, "A256GCM");
  assert.equal(storedResult.purpose, "RESULT");
  assert.equal(storedResult.keyId, TEST_CONTENT_KEY_ID);
  assert.deepEqual(completeCall.values.slice(2, 6), [
    storedResult.codecVersion,
    storedResult.keyId,
    storedResult.digestScheme,
    storedResult.contentDigest,
  ]);
  assert.equal(completeCall.values[7], storedResult.digestScheme);
  assert.doesNotMatch(completeCall.values[1], /projection-1|targetFactIds/);
  assert.deepEqual(instance.afterCommit(), { committed: true });
});

test("completeOwned rolls target work failure into a generic persistence error without terminal SQL", async () => {
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection, handlerFactory({
    async apply() { throw new Error("health payload token=must-not-leak"); },
  }));
  await assert.rejects(
    () => instance.completeOwned(claim(), { transitionId: "complete-transition-2" }),
    (error) => {
      assert.equal(error.code, "INBOX_CHECKPOINT_PERSISTENCE_FAILED");
      assert.equal(JSON.stringify(error).includes("must-not-leak"), false);
      return true;
    }
  );
  assert.equal(calls.some((call) => call.tag === "complete_update"), false);
});

test("completeOwned rejects repeated registered statements even when the unique ID set matches", async () => {
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    if (tag === null) return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection, handlerFactory({
    async apply(toolbox, inputEnvelope) {
      await toolbox.execute("INSERT INTO `projection_fact` (`event_id`) VALUES (?)", [inputEnvelope.eventId]);
      await toolbox.execute("INSERT INTO `projection_fact` (`event_id`) VALUES (?)", [inputEnvelope.eventId]);
      return { result: { applied: true }, manifest: { targetFactIds: ["fact-1"] } };
    },
  }));
  await assert.rejects(
    () => instance.completeOwned(claim(), { transitionId: "complete-transition-repeat" }),
    (error) => error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED"
  );
  assert.equal(calls.filter((call) => call.tag === "handler_sql").length, 2);
  assert.equal(calls.some((call) => call.tag === "complete_update"), false);
});

test("transactional handler SQL rejects transaction control, DDL and multi-statements", async () => {
  for (const unsafeSql of [
    "COMMIT",
    "ALTER TABLE projection_fact ADD COLUMN unsafe INT",
    "INSERT INTO projection_fact (event_id) VALUES (?); DELETE FROM projection_fact",
    "SELECT SLEEP(1)",
  ]) {
    const { connection, calls } = connectionWith(({ tag }) => {
      if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
      if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
      throw new Error(`unexpected tag ${tag}`);
    });
    const instance = adapter(connection, handlerFactory({
      async apply(toolbox) {
        await toolbox.execute(unsafeSql, []);
        return { result: {}, manifest: {} };
      },
    }));
    await assert.rejects(
      () => instance.completeOwned(claim(), { transitionId: "complete-transition-unsafe" }),
      (error) => error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED"
    );
    assert.equal(calls.some((call) => call.tag === null), false);
  }
});

test("payload, result and manifest limits fail closed before terminal persistence", async () => {
  const oversizedPayload = envelope({ payload: { text: "x".repeat(64 * 1024) } });
  const receiveCalls = [];
  const receiveInstance = adapter({
    async execute(...args) {
      receiveCalls.push(args);
      return [{ affectedRows: 1 }, []];
    },
  });
  await assert.rejects(
    () => receiveInstance.receive({
      consumerName: "task-projection-v1",
      handlerVersion: "task-projection-v1",
      transitionId: "receive-transition-oversized",
      maxAttempts: 5,
      retryPolicyVersion: "inbox-retry-v1",
      envelope: oversizedPayload,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_INPUT_INVALID"
  );
  assert.equal(receiveCalls.length, 0);

  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const completion = adapter(connection, handlerFactory({
    async apply() {
      return { result: { text: "x".repeat(32 * 1024) }, manifest: {} };
    },
  }));
  await assert.rejects(
    () => completion.completeOwned(claim(), { transitionId: "complete-transition-oversized" }),
    (error) => error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED"
  );
  assert.equal(calls.some((call) => call.tag === "complete_update"), false);
});

test("success ACK readback re-enforces the 32 KiB handler result limit", async () => {
  const completionManifest = {
    handlerEvidence: completionHandlerEvidence(),
    handler: {},
    successorOutboxFacts: [],
    outboxFlush: { inserted: 0, replayed: 0 },
  };
  const succeeded = receiptRow({
    status: "SUCCEEDED",
    attempt_count: 1,
    lease_generation: 1,
    inbox_transition_id: "complete-transition-large-readback",
    result_json: {
      result: { text: "x".repeat(32 * 1024) },
      completionManifest,
    },
    completed_at: NOW,
    started_at: NOW,
  });
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "transition_read") return [[succeeded], []];
    if (tag === "checkpoint_read") return [[checkpointRow({
      last_contiguous_position: 1,
      high_watermark_position: 1,
      state_generation: 2,
      checkpoint_transition_id: "complete-transition-large-readback",
      last_event_id: succeeded.event_id,
      last_receipt_id: succeeded.inbox_receipt_id,
    })], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  await assert.rejects(
    () => adapter(connection).readTransition({
      claim: claim(),
      transitionId: "complete-transition-large-readback",
      expectedStatus: "SUCCEEDED",
      expectedFailure: null,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_ROW_INVALID"
  );
  assert.deepEqual(calls.map((call) => call.tag), ["transition_read", "checkpoint_read"]);
});

test("retryable failure clears the lease and schedules deterministic database-time retry", async () => {
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    if (tag === "retry_update") return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const result = await adapter(connection).failOwned(claim(), {
    transitionId: "failure-transition-1",
    reasonCode: "INBOX_HANDLER_FAILED",
    retryable: true,
    retryPolicy: INBOX_RETRY_POLICY_V1,
  });
  assert.equal(result.status, "RETRY_PENDING");
  const retryCall = calls.find((call) => call.tag === "retry_update");
  assert.equal(retryCall.values[0], "inbox-retry-v1");
  assert.equal(retryCall.values[1], 5_000_000);
  assert.equal(retryCall.values[3].includes("INBOX_HANDLER_FAILED"), true);
  assert.equal(retryCall.sql.includes("`lease_expires_at` > CURRENT_TIMESTAMP(3)"), true);
});

test("non-retryable failure writes payload-free dead letter, terminal receipt and blocking checkpoint", async () => {
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    if (tag === "dead_insert") return [{ affectedRows: 1 }, []];
    if (tag === "dead_update") return [{ affectedRows: 1 }, []];
    if (tag === "checkpoint_dead_update") return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const result = await adapter(connection).failOwned(claim(), {
    transitionId: "failure-transition-2",
    reasonCode: "INBOX_SCHEMA_UNSUPPORTED",
    retryable: false,
    retryPolicy: INBOX_RETRY_POLICY_V1,
  });
  assert.equal(result.status, "DEAD_LETTER");
  assert.deepEqual(calls.map((call) => call.tag), [
    "checkpoint_lock", "owned_lock", "dead_insert", "dead_update", "checkpoint_dead_update",
  ]);
  const deadCall = calls.find((call) => call.tag === "dead_insert");
  assert.equal(deadCall.sql.includes("NULL, ?, 'OPEN'"), true);
  assert.equal(deadCall.values.some((value) => typeof value === "string" && value.includes("CHECKIN_COMPLETED")), false);
  assert.equal(calls.find((call) => call.tag === "dead_update").sql.includes("`lease_expires_at` > CURRENT_TIMESTAMP(3)"), true);
});

test("expired head recovery applies the fixed policy without incrementing attempts", async () => {
  const expired = claimedRow({ lease_expires_at: "2026-07-16 19:59:00.000" });
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "claim_head_lock") return [[{ ...expired, retry_due: 1 }], []];
    if (tag === "recovery_retry_update") return [{ affectedRows: 1 }, []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const [result] = await adapter(connection).recoverExpired({
    consumerName: "task-projection-v1",
    handlerVersion: "task-projection-v1",
    sourceName: "myroot-api",
    partitionKey: "task_event:task-event-inbox-1",
    transitionId: "recovery-transition-1",
    retryPolicy: INBOX_RETRY_POLICY_V1,
  });
  assert.equal(result.status, "RETRY_PENDING");
  assert.equal(result.attemptCount, 1);
  const recoveryCall = calls.find((call) => call.tag === "recovery_retry_update");
  assert.equal(recoveryCall.values.includes(2), false);
  assert.equal(recoveryCall.sql.includes("`lease_expires_at` <= CURRENT_TIMESTAMP(3)"), true);
  assert.equal(recoveryCall.sql.includes("`lease_expires_at` > CURRENT_TIMESTAMP(3)"), false);
});

test("success ACK readback verifies receipt digest, checkpoint, target manifest and successor outbox", async () => {
  const owned = claim();
  const successor = buildTaskEventOutboxEnvelope({
    task_event_id: "successor-event-readback",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T20:00:00.000+08:00",
    created_at: "2026-07-16T20:00:00.000+08:00",
  });
  const successorIdentity = snapshotOutboxImmutableIdentity(successor);
  const completionManifest = {
    handlerEvidence: completionHandlerEvidence(),
    handler: { targetFactIds: ["projection-1"] },
    successorOutboxFacts: [{
      contractId: TEST_OUTBOX_CONTRACT_ID,
      outboxEventId: successor.outbox_event_id,
      immutableIdentity: successorIdentity,
      immutableIdentityDigest: payloadSnapshot(successorIdentity).digest,
    }],
    outboxFlush: { inserted: 1, replayed: 0 },
  };
  const resultJson = { result: { projectionId: "projection-1" }, completionManifest };
  const succeeded = receiptRow({
    status: "SUCCEEDED",
    attempt_count: 1,
    lease_generation: 1,
    inbox_transition_id: "complete-transition-3",
    result_json: resultJson,
    completed_at: NOW,
    started_at: NOW,
  });
  const { connection, calls } = connectionWith(({ tag }) => {
    if (tag === "transition_read") return [[succeeded], []];
    if (tag === "checkpoint_read") return [[checkpointRow({
      last_contiguous_position: 1,
      high_watermark_position: 1,
      state_generation: 2,
      checkpoint_transition_id: "complete-transition-3",
      last_event_id: succeeded.event_id,
      last_receipt_id: succeeded.inbox_receipt_id,
    })], []];
    if (tag === "completion_outbox_read") return [[successor], []];
    if (tag === null) return [[{ projection_id: "projection-1" }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  const instance = adapter(connection, handlerFactory({
    async verify(toolbox, input) {
      const [rows] = await toolbox.execute("SELECT `projection_id` FROM `projection_fact` WHERE `projection_id` = ?", [input.result.projectionId]);
      return rows.length === 1 && rows[0].projection_id === input.result.projectionId;
    },
  }));
  const readback = await instance.readTransition({
    claim: owned,
    transitionId: "complete-transition-3",
    expectedStatus: "SUCCEEDED",
    expectedFailure: null,
  });
  assert.equal(readback.state, "CONVERGED");
  assert.deepEqual(readback.result.result, { projectionId: "projection-1" });
  assert.deepEqual(calls.map((call) => call.tag || "handler_sql"), [
    "transition_read", "checkpoint_read", "completion_outbox_read", "handler_sql",
  ]);
});

test("success ACK readback rejects an outbox id whose immutable identity changed", async () => {
  const owned = claim();
  const successor = buildTaskEventOutboxEnvelope({
    task_event_id: "successor-event-conflict",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T20:00:00.000+08:00",
    created_at: "2026-07-16T20:00:00.000+08:00",
  });
  const identity = snapshotOutboxImmutableIdentity(successor);
  const completionManifest = {
    handlerEvidence: completionHandlerEvidence(),
    handler: {},
    successorOutboxFacts: [{
      contractId: TEST_OUTBOX_CONTRACT_ID,
      outboxEventId: successor.outbox_event_id,
      immutableIdentity: identity,
      immutableIdentityDigest: payloadSnapshot(identity).digest,
    }],
    outboxFlush: { inserted: 1, replayed: 0 },
  };
  const resultJson = { result: {}, completionManifest };
  const succeeded = receiptRow({
    status: "SUCCEEDED",
    attempt_count: 1,
    lease_generation: 1,
    inbox_transition_id: "complete-transition-conflict",
    result_json: resultJson,
    completed_at: NOW,
    started_at: NOW,
  });
  const { connection: conflictConnection, calls } = connectionWith(({ tag }) => {
    if (tag === "transition_read") return [[succeeded], []];
    if (tag === "checkpoint_read") return [[checkpointRow({
      last_contiguous_position: 1,
      high_watermark_position: 1,
      state_generation: 2,
      checkpoint_transition_id: "complete-transition-conflict",
      last_event_id: succeeded.event_id,
      last_receipt_id: succeeded.inbox_receipt_id,
    })], []];
    if (tag === "completion_outbox_read") return [[{ ...successor, topic: "wrong-topic" }], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  await assert.rejects(
    () => adapter(conflictConnection).readTransition({
      claim: owned,
      transitionId: "complete-transition-conflict",
      expectedStatus: "SUCCEEDED",
      expectedFailure: null,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_PERSISTENCE_FAILED"
  );
  assert.deepEqual(calls.map((call) => call.tag), [
    "transition_read", "checkpoint_read", "completion_outbox_read",
  ]);
});

test("failure ACK readback binds reason, retry policy, delay and lease generation", async () => {
  const owned = claim();
  const expectedFailure = {
    kind: "RETRY",
    delayMs: 5_000,
    reasonCode: "INBOX_HANDLER_FAILED",
    policyVersion: "inbox-retry-v1",
  };
  const decision = {
    ...expectedFailure,
    attemptCount: 1,
    maxAttempts: 5,
    leaseGeneration: 1,
  };
  const decisionDigest = payloadSnapshot(decision).digest;
  const retry = receiptRow({
    status: "RETRY_PENDING",
    attempt_count: 1,
    lease_generation: 1,
    inbox_transition_id: "failure-transition-readback",
    next_retry_at: "2026-07-16 20:00:05.000",
    failed_at: NOW,
    started_at: NOW,
    error_json: {
      code: "INBOX_HANDLER_FAILED",
      message: "inbox processing failed",
      decision,
      decisionDigest,
    },
  });
  const successConnection = connectionWith(({ tag }) => {
    if (tag === "transition_read") return [[retry], []];
    throw new Error(`unexpected tag ${tag}`);
  }).connection;
  const converged = await adapter(successConnection).readTransition({
    claim: owned,
    transitionId: "failure-transition-readback",
    expectedStatus: "RETRY_PENDING",
    expectedFailure,
  });
  assert.equal(converged.state, "CONVERGED");
  assert.equal(converged.result.failureDecisionDigest, decisionDigest);

  const wrongDelay = {
    ...retry,
    next_retry_at: "2026-07-16 20:00:06.000",
  };
  const wrongConnection = connectionWith(({ tag }) => {
    if (tag === "transition_read") return [[wrongDelay], []];
    throw new Error(`unexpected tag ${tag}`);
  }).connection;
  await assert.rejects(
    () => adapter(wrongConnection).readTransition({
      claim: owned,
      transitionId: "failure-transition-readback",
      expectedStatus: "RETRY_PENDING",
      expectedFailure,
    }),
    (error) => error.code === "INBOX_CHECKPOINT_ROW_INVALID"
  );
});

test("invalid handler shape and stale generation fail closed without leaking caller data", async () => {
  const { connection } = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[], []];
    throw new Error(`unexpected tag ${tag}`);
  });
  await assert.rejects(
    () => adapter(connection).completeOwned(claim(), { transitionId: "complete-transition-stale" }),
    (error) => error.code === "INBOX_CHECKPOINT_LEASE_LOST"
  );

  const invalidHandler = () => ({
    kind: "NETWORK_ALLOWED",
    replaySafe: false,
    apply() {},
    verify() {},
  });
  const invalidConnection = connectionWith(({ tag }) => {
    if (tag === "checkpoint_lock") return [[checkpointRow({ high_watermark_position: 1 })], []];
    if (tag === "owned_lock") return [[{ ...claimedRow(), lease_active: 1 }], []];
    throw new Error(`unexpected tag ${tag}`);
  }).connection;
  assert.throws(
    () => adapter(invalidConnection, invalidHandler).completeOwned(claim(), { transitionId: "complete-transition-invalid" }),
    (error) => error.code === "INBOX_CHECKPOINT_CONFIGURATION_INVALID"
  );
});
