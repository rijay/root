const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createKeyInventoryReadinessFoundation,
} = require("../src/keyInventoryReadinessFoundation");
const { createCommandResultCodec } = require("../src/commandResultProtection");
const {
  COMMAND_RESULT_PROTECTION_POLICY,
} = require("../src/commandResultProtectionPolicy");
const { createInboxContentCodec } = require("../src/inboxContentProtection");

const ACTIVE_ENV = Object.freeze({
  ROOT_KEY_INVENTORY_READINESS_ENABLED: "true",
  MYSQL_DATABASE: "myroot_inventory_test",
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "command-request-inventory-current-secret-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "request-current-v3",
  ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({
    "request-previous-v2": "command-request-inventory-previous-secret-with-strong-entropy-2025",
  }),
  ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-inventory-secret-with-strong-entropy-2026",
  ROOT_COMMAND_RESULT_KEY_ID: "command-current-v2",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "inbox-content-inventory-secret-with-strong-entropy-2026",
  ROOT_INBOX_CONTENT_KEY_ID: "inbox-current-v3",
  ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: JSON.stringify({
    "inbox-previous-v2": "inbox-previous-inventory-secret-with-strong-entropy-2025",
  }),
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY:
    "notification-receipt-inventory-secret-with-strong-entropy-2026",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "receipt-current-v2",
});

const REQUIRED_COLUMNS = Object.freeze([
  ["command_idempotency", "request_digest_scheme", "varchar(64)", "NO", "ascii", "ascii_bin"],
  ["command_idempotency", "request_digest_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["command_idempotency", "result_codec_version", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["command_idempotency", "result_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["inbox_receipt", "payload_codec_version", "varchar(32)", "NO", "ascii", "ascii_bin"],
  ["inbox_receipt", "payload_key_id", "varchar(64)", "NO", "ascii", "ascii_bin"],
  ["inbox_receipt", "payload_digest_scheme", "varchar(32)", "NO", "ascii", "ascii_bin"],
  ["inbox_receipt", "result_codec_version", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["inbox_receipt", "result_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["inbox_receipt", "result_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["inbox_receipt", "completion_manifest_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["task_event", "request_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["task_event", "request_digest_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_trust_status", "varchar(16)", "NO", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_provenance_source", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_verified_at", "datetime(3)", "YES", null, null],
  ["wechat_identity", "unionid_provenance_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_provenance_digest", "char(64)", "YES", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_provenance_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["wechat_identity", "unionid_provenance_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_binding_status", "varchar(16)", "NO", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_wechat_identity_id", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_app_code", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_binding_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_binding_digest", "char(64)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_binding_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant", "recipient_binding_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_binding_status", "varchar(16)", "NO", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_wechat_identity_id", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_app_code", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_binding_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_binding_digest", "char(64)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_binding_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["notification_subscription_grant_v1", "recipient_binding_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt", "provider_receipt_digest", "char(64)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt", "provider_receipt_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt", "provider_receipt_digest_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt_transition", "provider_receipt_digest", "char(64)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt_transition", "provider_receipt_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"],
  ["notification_send_attempt_transition", "provider_receipt_digest_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"],
]);

const REQUIRED_INDEXES = Object.freeze([
  ["command_idempotency", "idx_command_idempotency_digest_crypto", 1, "request_digest_scheme"],
  ["command_idempotency", "idx_command_idempotency_digest_crypto", 2, "request_digest_key_id"],
  ["command_idempotency", "idx_command_idempotency_digest_crypto", 3, "command_idempotency_id"],
  ["command_idempotency", "idx_command_idempotency_result_crypto", 1, "result_codec_version"],
  ["command_idempotency", "idx_command_idempotency_result_crypto", 2, "result_key_id"],
  ["command_idempotency", "idx_command_idempotency_result_crypto", 3, "command_idempotency_id"],
  ["inbox_receipt", "idx_inbox_payload_key_inventory", 1, "payload_codec_version"],
  ["inbox_receipt", "idx_inbox_payload_key_inventory", 2, "payload_key_id"],
  ["inbox_receipt", "idx_inbox_payload_key_inventory", 3, "status"],
  ["inbox_receipt", "idx_inbox_result_key_inventory", 1, "result_codec_version"],
  ["inbox_receipt", "idx_inbox_result_key_inventory", 2, "result_key_id"],
  ["inbox_receipt", "idx_inbox_result_key_inventory", 3, "status"],
  ["task_event", "idx_task_event_request_digest_crypto", 1, "request_digest_scheme"],
  ["task_event", "idx_task_event_request_digest_crypto", 2, "request_digest_key_id"],
  ["task_event", "idx_task_event_request_digest_crypto", 3, "task_event_id"],
  ["wechat_identity", "idx_wechat_identity_provenance_crypto", 1, "unionid_provenance_digest_scheme"],
  ["wechat_identity", "idx_wechat_identity_provenance_crypto", 2, "unionid_provenance_key_id"],
  ["wechat_identity", "idx_wechat_identity_provenance_crypto", 3, "wechat_identity_id"],
  ["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 1, "recipient_binding_digest_scheme"],
  ["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 2, "recipient_binding_key_id"],
  ["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 3, "notification_subscription_grant_id"],
  ["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 1, "recipient_binding_digest_scheme"],
  ["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 2, "recipient_binding_key_id"],
  ["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 3, "notification_subscription_grant_id"],
]);

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

function checkClauseFromSchema(constraintName) {
  const line = SCHEMA_SQL.split("\n").find(
    (candidate) => candidate.includes(`CONSTRAINT \`${constraintName}\` CHECK (`)
  );
  assert.ok(line, `missing schema CHECK ${constraintName}`);
  const prefix = " CHECK (";
  const suffixLength = line.endsWith(",") ? 2 : 1;
  return line.slice(line.indexOf(prefix) + prefix.length, -suffixLength);
}

const REQUIRED_CHECKS = Object.freeze([
  ["chk_inbox_payload_protection_metadata", checkClauseFromSchema("chk_inbox_payload_protection_metadata")],
  ["chk_inbox_result_protection_metadata", checkClauseFromSchema("chk_inbox_result_protection_metadata")],
  ["chk_notification_recipient_binding", checkClauseFromSchema("chk_notification_recipient_binding")],
  ["chk_notification_recipient_binding_v1", checkClauseFromSchema("chk_notification_recipient_binding_v1")],
  ["chk_notification_send_attempt_accepted_receipt", checkClauseFromSchema("chk_notification_send_attempt_accepted_receipt")],
  ["chk_notification_send_attempt_receipt_digest", checkClauseFromSchema("chk_notification_send_attempt_receipt_digest")],
  ["chk_notification_send_attempt_transition_digest", checkClauseFromSchema("chk_notification_send_attempt_transition_digest")],
  ["chk_notification_send_attempt_transition_receipt", checkClauseFromSchema("chk_notification_send_attempt_transition_receipt")],
  ["chk_wechat_identity_unionid_provenance", checkClauseFromSchema("chk_wechat_identity_unionid_provenance")],
]);

function columnRows(rows = REQUIRED_COLUMNS) {
  return rows.map(([tableName, columnName, columnType, nullable, characterSet, collation]) => ({
    table_name: tableName,
    column_name: columnName,
    column_type: columnType,
    is_nullable: nullable,
    character_set_name: characterSet,
    collation_name: collation,
  }));
}

function indexRows(rows = REQUIRED_INDEXES) {
  return rows.map(([tableName, indexName, sequence, columnName]) => ({
    table_name: tableName,
    index_name: indexName,
    non_unique: 1,
    seq_in_index: sequence,
    column_name: columnName,
  }));
}

function checkRows(rows = REQUIRED_CHECKS) {
  return rows.map(([constraintName, clause]) => ({
    constraint_name: constraintName,
    enforced: "YES",
    check_clause: clause,
  }));
}

function commandBinding(row) {
  return JSON.stringify({
    actorId: row.actor_id,
    commandName: row.command_name,
    idempotencyKey: row.idempotency_key,
    recordId: row.command_idempotency_id,
    requestDigest: row.request_digest,
  });
}

function attestEnvelope(row, prefix, envelope) {
  row[`${prefix}_json_storage_bytes`] = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  row[`${prefix}_ciphertext_base64_bytes`] = Buffer.byteLength(envelope.ciphertext, "utf8");
}

function inboxPayloadBinding(row) {
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

function inboxResultBinding(row) {
  return {
    ...inboxPayloadBinding(row),
    receiptId: row.inbox_receipt_id,
    leaseGeneration: row.lease_generation,
    completionTransitionId: row.inbox_transition_id,
  };
}

function commandWitness(suffix = "one", env = ACTIVE_ENV) {
  const row = {
    command_idempotency_id: `cmdidem_${suffix}_${"a".repeat(16)}`,
    command_name: "inventory.command",
    actor_id: `member_inventory_${suffix}`,
    idempotency_key: `cmdkey_${suffix}_${"b".repeat(48)}`,
    request_digest: "c".repeat(64),
    result_codec_version: "A256GCM:v1",
    result_key_id: env.ROOT_COMMAND_RESULT_KEY_ID,
  };
  row.result_json = createCommandResultCodec(env).encode(
    { code: 0, data: { witness: true } },
    { binding: commandBinding(row) }
  );
  attestEnvelope(row, "result", row.result_json);
  return row;
}

function inboxWitness({
  keyId = ACTIVE_ENV.ROOT_INBOX_CONTENT_KEY_ID,
  secret = ACTIVE_ENV.ROOT_INBOX_CONTENT_ENCRYPTION_KEY,
  suffix = "current",
  includeResult = false,
} = {}) {
  const codecEnv = {
    ROOT_INBOX_CONTENT_ENCRYPTION_KEY: secret,
    ROOT_INBOX_CONTENT_KEY_ID: keyId,
  };
  const codec = createInboxContentCodec(codecEnv);
  const row = {
    inbox_receipt_id: `inbox_${suffix}`,
    consumer_name: "task-share-completion-v1",
    source_name: "myroot-api",
    partition_key: `task_event:${suffix}`,
    partition_position: suffix === "previous" ? 2 : 1,
    event_id: `evt_${suffix}`,
    event_type: "task.event.recorded.v1",
    schema_version: "1",
    aggregate_type: "TASK_EVENT",
    aggregate_id: `task_${suffix}`,
    aggregate_version: 1,
    occurred_at: "2026-07-17 10:00:00.000",
    producer_version: "0.5.13",
    correlation_id: null,
    causation_id: null,
    idempotency_key: `task:${suffix}`,
    handler_version: "task-share-completion-v1",
    handler_id: "task-share-completion-projection-v1",
    handler_registry_version: 1,
    handler_descriptor_digest: "d".repeat(64),
    handler_source_digest: "e".repeat(64),
    handler_registration_digest: "f".repeat(64),
    payload_codec_version: "A256GCM:v1",
    payload_key_id: keyId,
    payload_digest_scheme: "hmac-sha256:v1",
    status: includeResult ? "SUCCEEDED" : "RECEIVED",
    lease_generation: 1,
    inbox_transition_id: includeResult ? `transition_${suffix}` : null,
    result_json: null,
    result_codec_version: null,
    result_key_id: null,
    result_digest_scheme: null,
    result_digest: null,
    completion_manifest_digest: null,
    completion_manifest_digest_scheme: null,
  };
  const payload = codec.seal(
    { taskEventId: `task_${suffix}` },
    { purpose: "PAYLOAD", binding: inboxPayloadBinding(row) }
  );
  row.payload_json = payload.stored;
  attestEnvelope(row, "payload", row.payload_json);
  row.payload_digest = payload.contentDigest;
  if (includeResult) {
    const resultValue = { result: { accepted: true }, completionManifest: { applied: true } };
    const binding = inboxResultBinding(row);
    const result = codec.seal(
      resultValue,
      { purpose: "RESULT", binding }
    );
    row.result_json = result.stored;
    attestEnvelope(row, "result", row.result_json);
    row.result_codec_version = result.codecVersion;
    row.result_key_id = result.keyId;
    row.result_digest_scheme = result.digestScheme;
    row.result_digest = result.contentDigest;
    row.completion_manifest_digest = codec.digest(resultValue.completionManifest, {
      purpose: "MANIFEST",
      binding,
      keyId: result.keyId,
    });
    row.completion_manifest_digest_scheme = result.digestScheme;
  }
  return row;
}

function defaultResults() {
  const currentInbox = inboxWitness({ includeResult: true });
  const currentInboxTwo = inboxWitness({ suffix: "current-two" });
  const currentInboxThree = inboxWitness({ suffix: "current-three" });
  const previousInbox = inboxWitness({
    keyId: "inbox-previous-v2",
    secret: "inbox-previous-inventory-secret-with-strong-entropy-2025",
    suffix: "previous",
  });
  return [
    [{ database_name: ACTIVE_ENV.MYSQL_DATABASE }],
    columnRows(),
    indexRows(),
    checkRows(),
    [{
      status: "SUCCEEDED",
      content_present: 1,
      result_ref_present: 0,
      key_id: "command-current-v2",
      codec_version: "A256GCM:v1",
      envelope_matches: 1,
      reference_count: "2",
    }],
    [
      {
        status: "SUCCEEDED",
        key_id: "inbox-current-v3",
        codec_version: "A256GCM:v1",
        digest_scheme: "hmac-sha256:v1",
        envelope_matches: 1,
        reference_count: "3",
      },
      {
        status: "RECEIVED",
        key_id: "inbox-previous-v2",
        codec_version: "A256GCM:v1",
        digest_scheme: "hmac-sha256:v1",
        envelope_matches: 1,
        reference_count: "1",
      },
    ],
    [{
      status: "SUCCEEDED",
      content_present: 1,
      result_digest_present: 1,
      completion_manifest_digest_present: 1,
      key_id: "inbox-current-v3",
      codec_version: "A256GCM:v1",
      digest_scheme: "hmac-sha256:v1",
      completion_manifest_digest_scheme: "hmac-sha256:v1",
      envelope_matches: 1,
      reference_count: "1",
    }],
    [
      {
        key_id: "request-current-v3",
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: "5",
      },
      {
        key_id: "request-previous-v2",
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: "2",
      },
    ],
    [
      {
        key_id: "request-current-v3",
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: "3",
      },
      {
        key_id: "request-previous-v2",
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: "4",
      },
    ],
    [{
      key_id: "request-current-v3",
      digest_scheme: "hmac-sha256:v1",
      metadata_matches: 1,
      reference_count: "2",
    }],
    [{
      key_id: "request-current-v3",
      digest_scheme: "hmac-sha256:v1",
      metadata_matches: 1,
      reference_count: "3",
    }],
    [{
      key_id: "request-current-v3",
      digest_scheme: "hmac-sha256:v1",
      metadata_matches: 1,
      reference_count: "4",
    }],
    [{
      key_id: "receipt-current-v2",
      digest_scheme: "hmac-sha256:v1",
      metadata_matches: 1,
      reference_count: "2",
    }],
    [{
      key_id: "receipt-current-v2",
      digest_scheme: "hmac-sha256:v1",
      metadata_matches: 1,
      reference_count: "2",
    }],
    [commandWitness("one"), commandWitness("two")],
    [currentInbox, currentInboxTwo, currentInboxThree, previousInbox],
    [currentInbox],
  ];
}

function fakePool(results = defaultResults(), options = {}) {
  const calls = [];
  const state = {
    acquisitions: 0,
    released: 0,
    destroyed: 0,
    deadlineReadbacks: 0,
    deadlineAtRelease: [],
  };
  function createConnection() {
    const queues = results.map((rows) => rows.map((row) => ({ ...row })));
    let sessionStatementDeadlineMs = 0;
    return {
      async query(sql) {
        calls.push(sql);
        if (options.failOnQuery && options.failOnQuery(sql, calls.length)) {
          throw new Error("mysql://inventory-user:do-not-leak@example.invalid/readiness");
        }
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "SET SESSION max_execution_time = 10000") {
          sessionStatementDeadlineMs = 10_000;
        } else if (normalized === "SET SESSION max_execution_time = 0") {
          sessionStatementDeadlineMs = 0;
        } else if (normalized === "SELECT @@SESSION.max_execution_time AS statement_deadline_ms") {
          const readbackIndex = state.deadlineReadbacks;
          state.deadlineReadbacks += 1;
          const readback = Array.isArray(options.deadlineReadbackValues)
            && Object.prototype.hasOwnProperty.call(options.deadlineReadbackValues, readbackIndex)
            ? options.deadlineReadbackValues[readbackIndex]
            : sessionStatementDeadlineMs;
          return [[{ statement_deadline_ms: readback }], []];
        }
        return [[], []];
      },
      async execute(sql) {
        calls.push(sql);
        if (options.failOnExecute && options.failOnExecute(sql, calls.length)) {
          throw new Error("mysql://inventory-user:do-not-leak@example.invalid/readiness");
        }
        if (queues.length === 0) throw new Error("unexpected execute");
        return [queues.shift(), []];
      },
      release() {
        state.released += 1;
        state.deadlineAtRelease.push(sessionStatementDeadlineMs);
      },
      destroy() { state.destroyed += 1; },
    };
  }
  return {
    calls,
    state,
    pool: {
      async getConnection() {
        state.acquisitions += 1;
        return createConnection();
      },
    },
  };
}

test("Foundation is disabled by default and does not touch MySQL", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({ env: {}, mysqlPool: fixture.pool });

  const report = await foundation.inspect();

  assert.deepEqual(report, {
    contractVersion: "KEY_INVENTORY_READINESS:v1",
    enabled: false,
    ready: false,
    status: "KEY_INVENTORY_DISABLED",
    configuration: [],
    schema: { ready: false, status: "NOT_INSPECTED" },
    inventory: [],
    previousKeyRetirement: { ready: false, status: "NOT_INSPECTED", referenceCount: 0 },
    issues: [{ code: "KEY_INVENTORY_DISABLED", severity: "BLOCKER" }],
  });
  assert.equal(fixture.state.acquisitions, 0);
  await assert.rejects(
    foundation.verify(),
    (error) => error && error.code === "KEY_INVENTORY_DISABLED" && error.status === 503
  );
});

test("inspect and verify reconcile current and previous keys without returning secrets", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fixture.pool });

  const report = await foundation.inspect();

  assert.equal(report.ready, true);
  assert.equal(report.status, "KEY_INVENTORY_READY_WITH_PREVIOUS");
  assert.equal(report.schema.ready, true);
  assert.deepEqual(report.configuration, [
    {
      domain: "REQUEST_DIGEST",
      currentKeyId: "request-current-v3",
      previousKeyIds: ["request-previous-v2"],
      retiredKeyIds: [],
    },
    {
      domain: "COMMAND_RESULT",
      currentKeyId: "command-current-v2",
      previousKeyIds: [],
      retiredKeyIds: [],
    },
    {
      domain: "INBOX_CONTENT",
      currentKeyId: "inbox-current-v3",
      previousKeyIds: ["inbox-previous-v2"],
      retiredKeyIds: [],
    },
    {
      domain: "NOTIFICATION_RECEIPT",
      currentKeyId: "receipt-current-v2",
      previousKeyIds: [],
      retiredKeyIds: [],
    },
  ]);
  assert.deepEqual(
    report.inventory.map(({ source, keyId, classification, referenceCount }) => ({
      source, keyId, classification, referenceCount,
    })),
    [
      { source: "command_idempotency.request_digest", keyId: "request-current-v3", classification: "CURRENT", referenceCount: 5 },
      { source: "command_idempotency.request_digest", keyId: "request-previous-v2", classification: "PREVIOUS", referenceCount: 2 },
      { source: "command_idempotency.result", keyId: "command-current-v2", classification: "CURRENT", referenceCount: 2 },
      { source: "inbox_receipt.payload", keyId: "inbox-current-v3", classification: "CURRENT", referenceCount: 3 },
      { source: "inbox_receipt.payload", keyId: "inbox-previous-v2", classification: "PREVIOUS", referenceCount: 1 },
      { source: "inbox_receipt.result", keyId: "inbox-current-v3", classification: "CURRENT", referenceCount: 1 },
      { source: "notification_send_attempt.provider_receipt", keyId: "receipt-current-v2", classification: "CURRENT", referenceCount: 2 },
      { source: "notification_send_attempt_transition.provider_receipt", keyId: "receipt-current-v2", classification: "CURRENT", referenceCount: 2 },
      { source: "notification_subscription_grant.recipient_binding", keyId: "request-current-v3", classification: "CURRENT", referenceCount: 3 },
      { source: "notification_subscription_grant_v1.recipient_binding", keyId: "request-current-v3", classification: "CURRENT", referenceCount: 4 },
      { source: "task_event.request_digest", keyId: "request-current-v3", classification: "CURRENT", referenceCount: 3 },
      { source: "task_event.request_digest", keyId: "request-previous-v2", classification: "PREVIOUS", referenceCount: 4 },
      { source: "wechat_identity.unionid_provenance", keyId: "request-current-v3", classification: "CURRENT", referenceCount: 2 },
    ]
  );
  assert.deepEqual(report.previousKeyRetirement, {
    ready: false,
    status: "KEY_RETIREMENT_BLOCKED_PREVIOUS_REFERENCES",
    referenceCount: 7,
  });
  assert.equal(JSON.stringify(report).includes(ACTIVE_ENV.ROOT_COMMAND_RESULT_ENCRYPTION_KEY), false);
  assert.equal(JSON.stringify(report).includes(ACTIVE_ENV.ROOT_COMMAND_REQUEST_DIGEST_KEY), false);
  assert.equal(JSON.stringify(report).includes("command-request-inventory-previous-secret"), false);
  assert.equal(JSON.stringify(report).includes("inbox-previous-inventory-secret"), false);
  assert.equal(JSON.stringify(report).includes(ACTIVE_ENV.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY), false);
  assert.equal(
    report.issues.some((entry) => entry.code === "KEY_INVENTORY_NOTIFICATION_RECEIPT_METADATA_ONLY"),
    true
  );
  assert.equal(
    report.inventory
      .filter((entry) => entry.domain === "NOTIFICATION_RECEIPT")
      .every((entry) => entry.authenticationStatus === "NOT_AVAILABLE_NO_RAW_RECEIPT"),
    true
  );
  assert.deepEqual(await foundation.verify(), report);
  assert.equal(fixture.state.released, 2);
  assert.equal(fixture.state.destroyed, 0);
});

test("concurrent inspections share one read snapshot while a later readiness call refreshes", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fixture.pool });

  const [left, right] = await Promise.all([foundation.inspect(), foundation.inspect()]);
  assert.deepEqual(left, right);
  assert.equal(fixture.state.acquisitions, 1);

  await foundation.inspect();
  assert.equal(fixture.state.acquisitions, 2);
});

test("fixed MySQL Adapter uses one read-only snapshot and selects every protected record with an overflow sentinel", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fixture.pool });
  await foundation.verify();

  const normalizedCalls = fixture.calls.map((sql) => sql.replace(/\s+/g, " ").trim());
  assert.deepEqual(normalizedCalls.slice(0, 4), [
    "SET SESSION max_execution_time = 10000",
    "SELECT @@SESSION.max_execution_time AS statement_deadline_ms",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
  ]);
  assert.deepEqual(normalizedCalls.slice(-3), [
    "COMMIT",
    "SET SESSION max_execution_time = 0",
    "SELECT @@SESSION.max_execution_time AS statement_deadline_ms",
  ]);
  assert.deepEqual(fixture.state.deadlineAtRelease, [0]);
  const allSql = fixture.calls.join("\n");
  assert.equal(fixture.calls.every((sql) => /^(?:SET|START|SELECT|WITH|COMMIT)$/i.test(
    sql.replace(/^\s+/, "").split(/\s+/, 1)[0]
  )), true);
  assert.match(allSql, /SELECT DATABASE\(\) AS database_name/);
  assert.doesNotMatch(allSql, /ROW_NUMBER\(\) OVER/);
  assert.equal((allSql.match(/LIMIT 1001/g) || []).length, 3);
  assert.equal((allSql.match(/LIMIT 65/g) || []).length, 10);
  assert.equal((allSql.match(/LEFT\(DATE_FORMAT\(occurred_at, '%Y-%m-%d %H:%i:%s\.%f'\), 23\)/g) || []).length, 2);
  assert.doesNotMatch(allSql, /\b(?:request_json|error_json)\b/i);
  assert.doesNotMatch(allSql, /\bSELECT\s+result_ref\b/i);
  assert.match(allSql, /idx_inbox_payload_key_inventory/);
  assert.match(allSql, /idx_command_idempotency_result_crypto/);
  assert.match(allSql, /idx_wechat_identity_provenance_crypto/);
  assert.match(allSql, /idx_notification_recipient_binding_crypto/);
  assert.match(allSql, /idx_notification_recipient_binding_v1_crypto/);
  assert.match(allSql, /FROM wechat_identity/);
  assert.match(allSql, /FROM notification_subscription_grant\n/);
  assert.match(allSql, /FROM notification_subscription_grant_v1/);
  assert.match(allSql, /FROM notification_send_attempt\n/);
  assert.match(allSql, /FROM notification_send_attempt_transition/);
  assert.doesNotMatch(allSql, /SELECT\s+provider_receipt_digest(?:\s|,)/i);
  assert.match(allSql, /JSON_STORAGE_SIZE\(result_json\) <= 184320/);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumPlaintextBytes, 131072);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBase64Characters, 174764);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumEnvelopeBytes, 184320);
  assert.equal((allSql.match(/JSON_STORAGE_SIZE\(result_json\) <= 184320/g) || []).length, 2);
  assert.equal((allSql.match(/<= 174764/g) || []).length, 2);
  assert.match(allSql, /JSON_STORAGE_SIZE\(payload_json\) <= 92160/);
  assert.match(
    allSql,
    /OCTET_LENGTH\(JSON_UNQUOTE\(JSON_EXTRACT\(result_json, '\$\.ciphertext'\)\)\) <= 131072/
  );
});

test("callers cannot override the fixed statement deadline through environment input", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({
    env: {
      ...ACTIVE_ENV,
      ROOT_KEY_INVENTORY_STATEMENT_DEADLINE_MS: "1",
      MYSQL_MAX_EXECUTION_TIME: "0",
    },
    mysqlPool: fixture.pool,
  });

  await foundation.verify();

  assert.equal(
    fixture.calls[0].replace(/\s+/g, " ").trim(),
    "SET SESSION max_execution_time = 10000"
  );
});

test("statement deadline establishment failures fail closed before opening the snapshot", async (t) => {
  const cases = [
    {
      name: "SET fails",
      options: {
        failOnQuery: (sql) => /SET SESSION max_execution_time = 10000/.test(sql),
      },
    },
    {
      name: "readback query fails",
      options: {
        failOnQuery: (sql) => /SELECT @@SESSION\.max_execution_time/.test(sql),
      },
    },
    {
      name: "readback does not exactly attest the fixed deadline",
      options: { deadlineReadbackValues: [9_999] },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = fakePool(defaultResults(), scenario.options);
      const report = await createKeyInventoryReadinessFoundation({
        env: ACTIVE_ENV,
        mysqlPool: fixture.pool,
      }).inspect();

      assert.equal(report.status, "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
      assert.equal(JSON.stringify(report).includes("inventory-user"), false);
      assert.equal(fixture.state.released, 0);
      assert.equal(fixture.state.destroyed, 1);
      assert.equal(fixture.calls.some((sql) => /START TRANSACTION/.test(sql)), false);
    });
  }
});

test("statement deadline restoration failures destroy the committed connection instead of returning it", async (t) => {
  let restoreReadbacks = 0;
  const cases = [
    {
      name: "reset SET fails",
      options: {
        failOnQuery: (sql) => /SET SESSION max_execution_time = 0/.test(sql),
      },
    },
    {
      name: "reset readback query fails",
      options: {
        failOnQuery: (sql) => {
          if (!/SELECT @@SESSION\.max_execution_time/.test(sql)) return false;
          restoreReadbacks += 1;
          return restoreReadbacks === 2;
        },
      },
    },
    {
      name: "reset readback is not exactly zero",
      options: { deadlineReadbackValues: [10_000, 1] },
    },
  ];

  for (const scenario of cases) {
    restoreReadbacks = 0;
    await t.test(scenario.name, async () => {
      const fixture = fakePool(defaultResults(), scenario.options);
      const report = await createKeyInventoryReadinessFoundation({
        env: ACTIVE_ENV,
        mysqlPool: fixture.pool,
      }).inspect();

      assert.equal(report.status, "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
      assert.equal(JSON.stringify(report).includes("inventory-user"), false);
      assert.equal(fixture.state.released, 0);
      assert.equal(fixture.state.destroyed, 1);
      assert.equal(fixture.calls.some((sql) => /^\s*COMMIT\s*$/.test(sql)), true);
      assert.equal(fixture.calls.some((sql) => /^\s*ROLLBACK\s*$/.test(sql)), false);
    });
  }
});

test("unknown persisted keys fail closed", async () => {
  const results = defaultResults();
  results[4] = [{
    status: "SUCCEEDED",
    content_present: 1,
    result_ref_present: 0,
    key_id: "command-unknown-v9",
    codec_version: "A256GCM:v1",
    envelope_matches: 1,
    reference_count: 4,
  }];
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fakePool(results).pool });
  const report = await foundation.inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_UNKNOWN_KEY");
  const unknown = report.inventory.find((entry) => entry.source === "command_idempotency.result");
  assert.equal(unknown.classification, "UNKNOWN");
  assert.equal(unknown.keyId, null);
  assert.match(unknown.keyIdFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(report).includes("command-unknown-v9"), false);
  await assert.rejects(foundation.verify(), (error) => error && error.code === "KEY_INVENTORY_UNKNOWN_KEY");
});

test("missing key or codec metadata fails closed", async () => {
  const results = defaultResults();
  results[6] = [{
    status: "SUCCEEDED",
    content_present: 1,
    result_digest_present: 0,
    completion_manifest_digest_present: 0,
    key_id: null,
    codec_version: null,
    digest_scheme: null,
    completion_manifest_digest_scheme: null,
    envelope_matches: 0,
    reference_count: 1,
  }];
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fakePool(results).pool });
  const report = await foundation.inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_MISSING_KEY");
  const missing = report.inventory.find((entry) => entry.source === "inbox_receipt.result");
  assert.equal(missing.classification, "MISSING");
  assert.equal(missing.metadataStatus, "MISSING");
});

test("retired key references fail closed", async () => {
  const results = defaultResults();
  results[5] = [{
    status: "RECEIVED",
    key_id: "inbox-retired-v1",
    codec_version: "A256GCM:v1",
    digest_scheme: "hmac-sha256:v1",
    envelope_matches: 1,
    reference_count: 6,
  }];
  const env = {
    ...ACTIVE_ENV,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: ["inbox-retired-v1"],
      NOTIFICATION_RECEIPT: [],
    }),
  };
  const report = await createKeyInventoryReadinessFoundation({ env, mysqlPool: fakePool(results).pool }).inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_RETIRED_KEY_REFERENCED");
  assert.equal(
    report.inventory.find((entry) => entry.keyId === "inbox-retired-v1").classification,
    "RETIRED"
  );
});

test("request-digest retired and unknown key references fail closed without echoing unknown ids", async () => {
  const retiredResults = defaultResults();
  retiredResults[7] = [{
    key_id: "request-retired-v1",
    digest_scheme: "hmac-sha256:v1",
    metadata_matches: 1,
    reference_count: 3,
  }];
  const retiredEnv = {
    ...ACTIVE_ENV,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: ["request-retired-v1"],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  };
  const retiredReport = await createKeyInventoryReadinessFoundation({
    env: retiredEnv,
    mysqlPool: fakePool(retiredResults).pool,
  }).inspect();
  assert.equal(retiredReport.status, "KEY_INVENTORY_RETIRED_KEY_REFERENCED");
  assert.equal(
    retiredReport.inventory.find((entry) => entry.source === "command_idempotency.request_digest").classification,
    "RETIRED"
  );

  const unknownKeyId = "request-unknown-v9";
  const unknownResults = defaultResults();
  unknownResults[7] = [{
    key_id: unknownKeyId,
    digest_scheme: "hmac-sha256:v1",
    metadata_matches: 1,
    reference_count: 4,
  }];
  const unknownReport = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(unknownResults).pool,
  }).inspect();
  const unknown = unknownReport.inventory.find(
    (entry) => entry.source === "command_idempotency.request_digest"
  );
  assert.equal(unknownReport.status, "KEY_INVENTORY_UNKNOWN_KEY");
  assert.equal(unknown.classification, "UNKNOWN");
  assert.equal(unknown.keyId, null);
  assert.match(unknown.keyIdFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(unknownReport).includes(unknownKeyId), false);
});

test("unionid provenance and both recipient binding sources enforce request-digest key policy", async (t) => {
  const sources = [
    [9, "wechat_identity.unionid_provenance"],
    [10, "notification_subscription_grant.recipient_binding"],
    [11, "notification_subscription_grant_v1.recipient_binding"],
  ];
  for (const [resultIndex, source] of sources) {
    await t.test(source, async () => {
      const retiredKeyId = "request-retired-binding-v1";
      const retiredResults = defaultResults();
      retiredResults[resultIndex] = [{
        key_id: retiredKeyId,
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: 2,
      }];
      const retiredReport = await createKeyInventoryReadinessFoundation({
        env: {
          ...ACTIVE_ENV,
          ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
            REQUEST_DIGEST: [retiredKeyId],
            COMMAND_RESULT: [],
            INBOX_CONTENT: [],
            NOTIFICATION_RECEIPT: [],
          }),
        },
        mysqlPool: fakePool(retiredResults).pool,
      }).inspect();
      const retired = retiredReport.inventory.find((entry) => entry.source === source);
      assert.equal(retiredReport.status, "KEY_INVENTORY_RETIRED_KEY_REFERENCED");
      assert.equal(retired.classification, "RETIRED");

      const unknownKeyId = `unknown-${resultIndex}-request-key`;
      const unknownResults = defaultResults();
      unknownResults[resultIndex] = [{
        key_id: unknownKeyId,
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: 3,
      }];
      const unknownReport = await createKeyInventoryReadinessFoundation({
        env: ACTIVE_ENV,
        mysqlPool: fakePool(unknownResults).pool,
      }).inspect();
      const unknown = unknownReport.inventory.find((entry) => entry.source === source);
      assert.equal(unknownReport.status, "KEY_INVENTORY_UNKNOWN_KEY");
      assert.equal(unknown.classification, "UNKNOWN");
      assert.equal(unknown.keyId, null);
      assert.match(unknown.keyIdFingerprint, /^[a-f0-9]{16}$/);
      assert.equal(JSON.stringify(unknownReport).includes(unknownKeyId), false);
    });
  }
});

test("provider receipt attempt and transition references form an independent metadata-only key domain", async (t) => {
  const sources = [
    [12, "notification_send_attempt.provider_receipt"],
    [13, "notification_send_attempt_transition.provider_receipt"],
  ];
  for (const [resultIndex, source] of sources) {
    await t.test(source, async () => {
      const retiredKeyId = "receipt-retired-v1";
      const retiredResults = defaultResults();
      retiredResults[5] = retiredResults[5].filter((row) => row.key_id !== "inbox-previous-v2");
      retiredResults[7] = retiredResults[7].filter((row) => row.key_id !== "request-previous-v2");
      retiredResults[8] = retiredResults[8].filter((row) => row.key_id !== "request-previous-v2");
      retiredResults[resultIndex] = [{
        key_id: retiredKeyId,
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: 2,
      }];
      const retiredReport = await createKeyInventoryReadinessFoundation({
        env: {
          ...ACTIVE_ENV,
          ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
            REQUEST_DIGEST: [],
            COMMAND_RESULT: [],
            INBOX_CONTENT: [],
            NOTIFICATION_RECEIPT: [retiredKeyId],
          }),
        },
        mysqlPool: fakePool(retiredResults).pool,
      }).inspect();
      const retired = retiredReport.inventory.find((entry) => entry.source === source);
      assert.equal(retiredReport.status, "KEY_INVENTORY_RETIRED_KEY_REFERENCED");
      assert.equal(retired.classification, "RETIRED");
      assert.equal(retired.authenticationStatus, "NOT_AVAILABLE_NO_RAW_RECEIPT");
      assert.deepEqual(retiredReport.previousKeyRetirement, {
        ready: false,
        status: "KEY_RETIREMENT_BLOCKED_UNSAFE_REFERENCES",
        referenceCount: 2,
      });

      const unknownKeyId = `receipt-unknown-v${resultIndex}`;
      const unknownResults = defaultResults();
      unknownResults[5] = unknownResults[5].filter((row) => row.key_id !== "inbox-previous-v2");
      unknownResults[7] = unknownResults[7].filter((row) => row.key_id !== "request-previous-v2");
      unknownResults[8] = unknownResults[8].filter((row) => row.key_id !== "request-previous-v2");
      unknownResults[resultIndex] = [{
        key_id: unknownKeyId,
        digest_scheme: "hmac-sha256:v1",
        metadata_matches: 1,
        reference_count: 4,
      }];
      const unknownReport = await createKeyInventoryReadinessFoundation({
        env: ACTIVE_ENV,
        mysqlPool: fakePool(unknownResults).pool,
      }).inspect();
      const unknown = unknownReport.inventory.find((entry) => entry.source === source);
      assert.equal(unknownReport.status, "KEY_INVENTORY_UNKNOWN_KEY");
      assert.equal(unknown.classification, "UNKNOWN");
      assert.equal(unknown.keyId, null);
      assert.equal(unknown.authenticationStatus, "NOT_AVAILABLE_NO_RAW_RECEIPT");
      assert.deepEqual(unknownReport.previousKeyRetirement, {
        ready: false,
        status: "KEY_RETIREMENT_BLOCKED_UNSAFE_REFERENCES",
        referenceCount: 4,
      });
      assert.equal(JSON.stringify(unknownReport).includes(unknownKeyId), false);
    });
  }
});

test("each newly inventoried source has an independent overflow and metadata fail-close sentinel", async () => {
  for (const resultIndex of [9, 10, 11, 12, 13]) {
    const overflowResults = defaultResults();
    overflowResults[resultIndex] = Array.from({ length: 65 }, (_, index) => ({
      ...overflowResults[resultIndex][0],
      key_id: `overflow-key-${resultIndex}-${index}`,
    }));
    const overflowReport = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(overflowResults).pool,
    }).inspect();
    assert.equal(overflowReport.status, "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");

    const driftResults = defaultResults();
    driftResults[resultIndex][0] = {
      ...driftResults[resultIndex][0],
      metadata_matches: 0,
    };
    const driftReport = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(driftResults).pool,
    }).inspect();
    assert.equal(driftReport.status, "KEY_INVENTORY_METADATA_DRIFT");
  }
});

test("enabled inventory requires the independent notification receipt current key id", async () => {
  const fixture = fakePool();
  const env = { ...ACTIVE_ENV };
  delete env.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID;
  const report = await createKeyInventoryReadinessFoundation({
    env,
    mysqlPool: fixture.pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
  assert.equal(fixture.state.acquisitions, 0);
});

test("legacy request digests remain visible as a ready warning until normal replay upgrades them", async () => {
  const results = defaultResults();
  results[7].push({
    key_id: null,
    digest_scheme: "sha256:v0",
    metadata_matches: 1,
    reference_count: 2,
  });
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  const legacy = report.inventory.find((entry) => entry.classification === "LEGACY");
  assert.equal(report.ready, true);
  assert.equal(legacy.source, "command_idempotency.request_digest");
  assert.equal(legacy.digestScheme, "sha256:v0");
  assert.equal(
    report.issues.some((entry) => entry.code === "KEY_INVENTORY_LEGACY_REQUEST_DIGEST_REFERENCES_PRESENT"),
    true
  );
});

test("retired inventory cannot overlap current or previous configuration", async () => {
  for (const keyId of ["command-current-v2", "inbox-previous-v2", "receipt-current-v2"]) {
    const fixture = fakePool();
    const env = {
      ...ACTIVE_ENV,
      ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
        REQUEST_DIGEST: [],
        COMMAND_RESULT: keyId.startsWith("command") ? [keyId] : [],
        INBOX_CONTENT: keyId.startsWith("inbox") ? [keyId] : [],
        NOTIFICATION_RECEIPT: keyId.startsWith("receipt") ? [keyId] : [],
      }),
    };
    const report = await createKeyInventoryReadinessFoundation({ env, mysqlPool: fixture.pool }).inspect();
    assert.equal(report.ready, false);
    assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
    assert.equal(fixture.state.acquisitions, 0);
  }
});

test("configured retired-key inventory requires the exact four-domain shape", async () => {
  const invalidShapes = [
    {
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
    },
    {
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
      EXTRA_DOMAIN: [],
    },
  ];
  for (const shape of invalidShapes) {
    const fixture = fakePool();
    const report = await createKeyInventoryReadinessFoundation({
      env: {
        ...ACTIVE_ENV,
        ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify(shape),
      },
      mysqlPool: fixture.pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
    assert.equal(fixture.state.acquisitions, 0);
  }
});

test("malformed key configuration is sanitized and never reaches MySQL", async () => {
  const fixture = fakePool();
  const secret = "should-never-appear-in-report-or-errors-2026";
  const env = {
    ...ACTIVE_ENV,
    ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: `{"inbox-previous-v2":"${secret}"`,
  };
  const foundation = createKeyInventoryReadinessFoundation({ env, mysqlPool: fixture.pool });
  const report = await foundation.inspect();

  assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
  assert.equal(JSON.stringify(report).includes(secret), false);
  await assert.rejects(foundation.verify(), (error) => {
    assert.equal(error.code, "KEY_INVENTORY_CONFIGURATION_INVALID");
    assert.equal(String(error.message).includes(secret), false);
    return true;
  });
  assert.equal(fixture.state.acquisitions, 0);
});

test("enabled Foundation requires an exact target MYSQL_DATABASE before touching MySQL", async () => {
  const fixture = fakePool();
  const env = { ...ACTIVE_ENV };
  delete env.MYSQL_DATABASE;
  const report = await createKeyInventoryReadinessFoundation({ env, mysqlPool: fixture.pool }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
  assert.equal(fixture.state.acquisitions, 0);
});

test("selected MySQL database must equal the configured target", async () => {
  const results = defaultResults();
  results[0] = [{ database_name: "wrong_inventory_database" }];
  const fixture = fakePool(results);
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fixture.pool,
  }).inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_DATABASE_MISMATCH");
  assert.equal(report.schema.status, "NOT_INSPECTED");
  assert.equal(fixture.calls.some((sql) => /information_schema\.COLUMNS/i.test(sql)), false);
});

test("schema metadata drift blocks inventory before reading facts", async () => {
  const results = defaultResults();
  results[1] = columnRows(REQUIRED_COLUMNS.filter((row) => row[1] !== "payload_key_id"));
  const fixture = fakePool(results);
  const report = await createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fixture.pool }).inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_SCHEMA_DRIFT");
  assert.equal(report.schema.status, "KEY_INVENTORY_SCHEMA_DRIFT");
  assert.equal(report.inventory.length, 0);
  assert.equal(fixture.calls.filter((sql) => /GROUP BY/i.test(sql)).length, 0);
});

test("index order drift blocks inventory", async () => {
  const results = defaultResults();
  results[2] = indexRows(REQUIRED_INDEXES.map((row) => (
    row[1] === "idx_inbox_result_key_inventory" && row[2] === 2
      ? [row[0], row[1], row[2], "status"]
      : row
  )));
  const report = await createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fakePool(results).pool }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_SCHEMA_DRIFT");
  assert.equal(report.schema.ready, false);
});

test("missing or non-enforced protection CHECK attestation blocks before inventory", async () => {
  for (const rows of [
    checkRows(REQUIRED_CHECKS.slice(0, 1)),
    checkRows().map((row, index) => index === 0 ? { ...row, enforced: "NO" } : row),
    checkRows().map((row, index) => index === 1
      ? { ...row, check_clause: row.check_clause.replace("'SUCCEEDED'", "'succeeded'") }
      : row),
  ]) {
    const results = defaultResults();
    results[3] = rows;
    const fixture = fakePool(results);
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fixture.pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_SCHEMA_DRIFT");
    assert.equal(report.schema.ready, false);
    assert.equal(fixture.calls.some((sql) => /FROM command_idempotency\s+GROUP BY/i.test(sql)), false);
  }
});

test("CHECK attestation preserves literal case, regex case, and charset introducer semantics", async () => {
  const mutations = [
    (clause) => clause.replace("_ascii'A256GCM:v1'", "_ascii'a256gcm:v1'"),
    (clause) => clause.replace("_ascii'^[A-Za-z0-9]", "_ascii'^[a-z0-9]"),
    (clause) => clause.replace("_utf8mb4'OBJECT'", "_ascii'OBJECT'"),
    (clause) => clause.replace("`payload_json`", "`payload``_json`"),
  ];
  for (const mutate of mutations) {
    const results = defaultResults();
    results[3] = checkRows().map((row, index) => index === 0
      ? { ...row, check_clause: mutate(row.check_clause) }
      : row);
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(results).pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_SCHEMA_DRIFT");
  }
});

test("CHECK attestation tolerates formatting and identifier quote differences outside literals", async () => {
  const results = defaultResults();
  results[3] = checkRows().map((row) => ({
    ...row,
    check_clause: ` \n ${row.check_clause.replaceAll("`", "")} \n `,
  }));
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_READY_WITH_PREVIOUS");
});

test("CHECK attestation accepts MySQL 8 escaped metadata delimiters without weakening literals", async () => {
  const results = defaultResults();
  results[3] = checkRows().map((row) => ({
    ...row,
    check_clause: row.check_clause.replaceAll("'", "\\'"),
  }));
  let report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_READY_WITH_PREVIOUS");

  results[3] = results[3].map((row, index) => index === 0
    ? { ...row, check_clause: row.check_clause.replace("A256GCM:v1", "a256gcm:v1") }
    : row);
  report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_SCHEMA_DRIFT");
});

test("non-success command result residue is scanned and blocks metadata readiness", async () => {
  const results = defaultResults();
  results[4].push({
    status: "FAILED",
    content_present: 1,
    result_ref_present: 0,
    key_id: "command-current-v2",
    codec_version: "A256GCM:v1",
    envelope_matches: 1,
    reference_count: 1,
  });
  const fixture = fakePool(results);
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fixture.pool,
  }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_METADATA_DRIFT");
  assert.equal(report.ready, false);
  const commandFactSql = fixture.calls.find((sql) => /FROM command_idempotency\s+GROUP BY/i.test(sql));
  assert.ok(commandFactSql);
  assert.doesNotMatch(commandFactSql, /WHERE\s+status\s*=\s*'SUCCEEDED'/i);
});

test("legitimate non-success command rows with no result do not create key references", async () => {
  const results = defaultResults();
  results[4].push({
    status: "IN_PROGRESS",
    content_present: 0,
    result_ref_present: 0,
    key_id: null,
    codec_version: null,
    envelope_matches: 1,
    reference_count: 8,
  });
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_READY_WITH_PREVIOUS");
  assert.equal(report.inventory.filter((entry) => entry.source === "command_idempotency.result").length, 1);
});

test("legacy command result_ref and non-success Inbox digest residue are not invisible", async () => {
  const cases = [
    () => {
      const results = defaultResults();
      results[4].push({
        status: "IN_PROGRESS",
        content_present: 0,
        result_ref_present: 1,
        key_id: null,
        codec_version: null,
        envelope_matches: 1,
        reference_count: 1,
      });
      return results;
    },
    () => {
      const results = defaultResults();
      results[6].push({
        status: "FAILED",
        content_present: 0,
        result_digest_present: 1,
        completion_manifest_digest_present: 0,
        key_id: null,
        codec_version: null,
        digest_scheme: null,
        completion_manifest_digest_scheme: null,
        envelope_matches: 1,
        reference_count: 1,
      });
      return results;
    },
  ];
  for (const build of cases) {
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(build()).pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_METADATA_DRIFT");
    assert.equal(report.ready, false);
  }
});

test("relationship metadata and JSON envelope drift fail closed before witness authentication", async () => {
  for (const factIndex of [4, 5, 6]) {
    const results = defaultResults();
    results[factIndex][0] = { ...results[factIndex][0], envelope_matches: 0 };
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(results).pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_METADATA_DRIFT");
    assert.equal(report.ready, false);
  }
});

test("wrong configured command secret fails deterministic witness authentication without leakage", async () => {
  const results = defaultResults();
  const ciphertext = results[14][0].result_json.ciphertext;
  const wrongSecret = "wrong-command-result-secret-with-strong-entropy-2026";
  const env = { ...ACTIVE_ENV, ROOT_COMMAND_RESULT_ENCRYPTION_KEY: wrongSecret };
  const report = await createKeyInventoryReadinessFoundation({ env, mysqlPool: fakePool(results).pool }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(report.ready, false);
  assert.equal(JSON.stringify(report).includes(wrongSecret), false);
  assert.equal(JSON.stringify(report).includes(ciphertext), false);
});

test("every protected record is authenticated so a valid first row cannot hide later corruption", async () => {
  const results = defaultResults();
  const corrupted = results[14][1];
  results[14][1] = {
    ...corrupted,
    result_json: {
      ...corrupted.result_json,
      tag: `${corrupted.result_json.tag[0] === "A" ? "B" : "A"}${corrupted.result_json.tag.slice(1)}`,
    },
  };
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(report.ready, false);
});

test("witness envelope size attestation and parse bounds fail closed before oversized content work", async () => {
  const cases = [
    (row) => ({ ...row, result_json_storage_bytes: 184321 }),
    (row) => ({ ...row, result_ciphertext_base64_bytes: 174765 }),
    (row) => ({
      ...row,
      result_json: { ...row.result_json, ciphertext: "A".repeat(174765) },
    }),
    (row) => ({ ...row, result_json: "x".repeat(184321) }),
    (row) => ({ ...row, result_json: Buffer.alloc(184321, 0x78) }),
  ];
  for (const mutate of cases) {
    const results = defaultResults();
    results[14][1] = mutate(results[14][1]);
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(results).pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    assert.equal(report.ready, false);
  }
});

test("authentication row bound fails closed instead of sampling an oversized inventory", async () => {
  const results = defaultResults();
  results[4][0] = { ...results[4][0], reference_count: "1001" };
  results[14] = Array.from({ length: 1001 }, () => results[14][0]);
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(report.ready, false);
});

test("Inbox completion manifest digest is authenticated with its persisted key and binding", async () => {
  const results = defaultResults();
  results[16][0] = { ...results[16][0], completion_manifest_digest: "0".repeat(64) };
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();
  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(report.ready, false);
});

test("Inbox payload and result witnesses enforce purpose-specific envelope bounds", async () => {
  const cases = [
    () => {
      const results = defaultResults();
      results[15][1] = {
        ...results[15][1],
        payload_json: {
          ...results[15][1].payload_json,
          ciphertext: "A".repeat(87385),
        },
      };
      return results;
    },
    () => {
      const results = defaultResults();
      results[16][0] = {
        ...results[16][0],
        result_json_storage_bytes: 147457,
      };
      return results;
    },
  ];
  for (const build of cases) {
    const report = await createKeyInventoryReadinessFoundation({
      env: ACTIVE_ENV,
      mysqlPool: fakePool(build()).pool,
    }).inspect();
    assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    assert.equal(report.ready, false);
  }
});

test("wrong previous Inbox secret fails the witness for that referenced key", async () => {
  const results = defaultResults();
  const wrongPreviousSecret = "wrong-previous-inbox-secret-with-strong-entropy-2025";
  const env = {
    ...ACTIVE_ENV,
    ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: JSON.stringify({
      "inbox-previous-v2": wrongPreviousSecret,
    }),
  };
  const report = await createKeyInventoryReadinessFoundation({ env, mysqlPool: fakePool(results).pool }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(JSON.stringify(report).includes(wrongPreviousSecret), false);
});

test("witness relation metadata must agree with its authenticated envelope", async () => {
  const results = defaultResults();
  results[16][0] = { ...results[16][0], result_codec_version: "A256GCM:v2" };
  const report = await createKeyInventoryReadinessFoundation({
    env: ACTIVE_ENV,
    mysqlPool: fakePool(results).pool,
  }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  assert.equal(report.ready, false);
});

test("codec drift is distinguished from key classification and blocks readiness", async () => {
  const results = defaultResults();
  results[4] = [{
    status: "SUCCEEDED",
    content_present: 1,
    result_ref_present: 0,
    key_id: "command-current-v2",
    codec_version: "PLAINTEXT:v0",
    envelope_matches: 0,
    reference_count: 1,
  }];
  const report = await createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fakePool(results).pool }).inspect();

  const drifted = report.inventory.find((entry) => entry.source === "command_idempotency.result");
  assert.equal(drifted.classification, "CURRENT");
  assert.equal(drifted.metadataStatus, "DRIFTED");
  assert.equal(drifted.codecVersion, "UNSUPPORTED");
  assert.equal(JSON.stringify(report).includes("PLAINTEXT:v0"), false);
  assert.equal(report.status, "KEY_INVENTORY_METADATA_DRIFT");
  assert.equal(report.ready, false);
});

test("invalid persisted key ids are fingerprinted instead of echoed", async () => {
  const results = defaultResults();
  const invalid = "bad key id with spaces and untrusted-content";
  results[4] = [{
    status: "SUCCEEDED",
    content_present: 1,
    result_ref_present: 0,
    key_id: invalid,
    codec_version: "A256GCM:v1",
    envelope_matches: 1,
    reference_count: 1,
  }];
  const report = await createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fakePool(results).pool }).inspect();

  assert.equal(report.status, "KEY_INVENTORY_UNKNOWN_KEY");
  const unknown = report.inventory.find((entry) => entry.source === "command_idempotency.result");
  assert.equal(unknown.keyId, null);
  assert.match(unknown.keyIdFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(report).includes(invalid), false);
});

test("persistence failures destroy the connection and expose only a stable code", async () => {
  const fixture = fakePool(defaultResults(), {
    failOnExecute: (sql) => /SELECT DATABASE\(\) AS database_name/.test(sql),
  });
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: fixture.pool });
  const report = await foundation.inspect();

  assert.equal(report.ready, false);
  assert.equal(report.status, "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  assert.equal(JSON.stringify(report).includes("inventory-user"), false);
  assert.equal(fixture.state.released, 0);
  assert.equal(fixture.state.destroyed, 1);
});

test("constructor rejects caller SQL, Adapter, factory, and unknown options", () => {
  for (const extra of [
    { sql: "SELECT 1" },
    { queries: {} },
    { adapter: {} },
    { connectionFactory() {} },
    { poolFactory() {} },
    { commandResultProtectionPolicy: { maximumPlaintextBytes: 1 } },
    { statementDeadlineMs: 1 },
    { maxExecutionTime: 1 },
    { enabled: true },
  ]) {
    assert.throws(
      () => createKeyInventoryReadinessFoundation({ env: {}, mysqlPool: fakePool().pool, ...extra }),
      (error) => error && error.code === "KEY_INVENTORY_CONSTRUCTION_INVALID"
    );
  }
});

test("enabled Foundation requires the fixed MySQL pool Interface", async () => {
  const foundation = createKeyInventoryReadinessFoundation({ env: ACTIVE_ENV, mysqlPool: {} });
  const report = await foundation.inspect();

  assert.equal(report.status, "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  await assert.rejects(foundation.verify(), (error) => error && error.code === "KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
});

test("invalid enable flags fail closed without touching MySQL", async () => {
  const fixture = fakePool();
  const foundation = createKeyInventoryReadinessFoundation({
    env: { ...ACTIVE_ENV, ROOT_KEY_INVENTORY_READINESS_ENABLED: "TRUE" },
    mysqlPool: fixture.pool,
  });
  const report = await foundation.inspect();

  assert.equal(report.status, "KEY_INVENTORY_CONFIGURATION_INVALID");
  assert.equal(fixture.state.acquisitions, 0);
});
