const crypto = require("node:crypto");

const { payloadSnapshot } = require("./eventTransport");
const { createInboxContentCodec } = require("./inboxContentProtection");
const { getDefaultInboxHandlerRegistry } = require("./inboxHandlerRegistry");
const { getDefaultInboxReplayPolicyRegistry } = require("./inboxReplayPolicyRegistry");
const {
  assertResolvedInboxReplayExecutorRegistration,
  getDefaultInboxReplayExecutorRegistry,
} = require("./inboxReplayExecutorRegistry");

const ENABLE_FLAG = "MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED";
const MYSQL_SESSION_TIME_ZONE = "+08:00";
const POLICY_ID = "TASK_SHARE_SHADOW_REBUILD_V1";
const MODE = "SHADOW_REBUILD";
const SOURCE_HANDLER_VERSION = "task-share-completion-v1";
const EXECUTION_HANDLER_ID = "task-share-completion-shadow-v1";
const EXECUTION_HANDLER_VERSION = "task-share-shadow-v1";
const TARGET_POLICY = "SHADOW_GENERATION_GE_2";
const SELECTION_QUERY_ID = "task_share_succeeded_receipts_by_received_at_v1";
const EXECUTION_CONSUMER_DIGEST_DOMAIN = "myroot-inbox-replay-execution-consumer:v1";
const SELECTION_DIGEST_DOMAIN = "myroot-inbox-replay-selection:v1";
const RESULT_DIGEST_DOMAIN = "myroot-inbox-shadow-replay-result:v1";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_LEASE_SECONDS = 3_600;
const OPTION_KEYS = Object.freeze(["pool", "env"]);
const RUN_KEYS = Object.freeze(["replayRunId", "leaseOwner", "leaseSeconds"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

const RUN_COLUMNS = `
  replay_run_id, replay_mode, status, policy_registry_version,
  policy_registry_digest, policy_id, policy_version, policy_digest,
  consumer_name, source_name, event_type, schema_version, aggregate_type,
  source_receipt_status, source_handler_id, source_handler_version,
  source_handler_registry_version, source_handler_descriptor_digest,
  source_handler_source_digest, source_handler_registration_digest,
  execution_consumer_name, execution_handler_id, execution_handler_version,
  execution_executor_registry_version, execution_executor_registry_digest,
  execution_executor_descriptor_digest, execution_executor_source_digest,
  execution_executor_registration_digest,
  target_projection_policy, shadow_generation, cursor_version,
  selection_query_id, selection_query_digest,
  selection_after_first_received_at, selection_after_receipt_id,
  selection_through_first_received_at, selection_through_receipt_id,
  selection_snapshot_at, selection_digest, maximum_selected_count,
  selected_receipt_count, authorization_expires_at, lease_owner,
  lease_expires_at, lease_generation, replay_transition_id,
  processed_receipt_count, verified_receipt_count, shadow_inserted_count,
  shadow_replayed_count, failed_receipt_count, result_digest,
  last_error_code, started_at, completed_at`;

const READ_RUN_SQL = `/* inbox_shadow_replay:run_read */
SELECT ${RUN_COLUMNS}, CURRENT_TIMESTAMP(3) AS db_now
FROM inbox_replay_run
WHERE replay_run_id = ?`;

const LOCK_RUN_SQL = `${READ_RUN_SQL}
FOR UPDATE`;

const CLAIM_SQL = `/* inbox_shadow_replay:claim */
UPDATE inbox_replay_run
SET status = 'RUNNING',
    lease_owner = ?,
    lease_expires_at = LEAST(
      TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)),
      authorization_expires_at
    ),
    lease_generation = ?,
    replay_transition_id = ?,
    started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3)),
    updated_at = CURRENT_TIMESTAMP(3)
WHERE replay_run_id = ?
  AND lease_generation = ?
  AND authorization_expires_at > CURRENT_TIMESTAMP(3)
  AND (
    (status = 'APPROVED' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (status = 'RUNNING' AND lease_expires_at <= CURRENT_TIMESTAMP(3))
  )`;

const EXPIRE_SQL = `/* inbox_shadow_replay:expire */
UPDATE inbox_replay_run
SET status = 'EXPIRED', last_error_code = 'AUTHORIZATION_EXPIRED',
    completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
WHERE replay_run_id = ? AND status = 'APPROVED' AND lease_generation = 0`;

const SOURCE_REGISTRATION_DRIFT_SQL = `/* inbox_shadow_replay:source_identity_drift */
SELECT COUNT(*) AS registration_drift_count
FROM inbox_receipt
WHERE consumer_name = ? AND source_name = ? AND event_type = ?
  AND schema_version = ? AND aggregate_type = ? AND status = ?
  AND first_received_at <= ? AND completed_at <= ?
  AND (
    ? IS NULL
    OR first_received_at > ?
    OR (first_received_at = ? AND inbox_receipt_id > ?)
  )
  AND (
    first_received_at < ?
    OR (first_received_at = ? AND inbox_receipt_id <= ?)
  )
  AND NOT (
    handler_id = ? AND handler_version = ? AND handler_registry_version = ?
    AND handler_descriptor_digest = ? AND handler_source_digest = ?
    AND handler_registration_digest = ?
  )`;

const SOURCE_SELECTION_SQL = `/* inbox_shadow_replay:source_selection */
SELECT
  inbox_receipt_id, first_received_at, consumer_name, source_name,
  partition_key, partition_position, event_id, event_type, schema_version,
  aggregate_type, aggregate_id, aggregate_version, occurred_at,
  producer_version, correlation_id, causation_id, idempotency_key,
  handler_version, handler_id, handler_registry_version,
  handler_descriptor_digest, handler_source_digest,
  handler_registration_digest, payload_json, payload_codec_version,
  payload_key_id, payload_digest_scheme, payload_digest, status
FROM inbox_receipt
WHERE consumer_name = ? AND source_name = ? AND event_type = ?
  AND schema_version = ? AND aggregate_type = ? AND status = ?
  AND handler_id = ? AND handler_version = ? AND handler_registry_version = ?
  AND handler_descriptor_digest = ? AND handler_source_digest = ?
  AND handler_registration_digest = ?
  AND first_received_at <= ? AND completed_at <= ?
  AND (
    ? IS NULL
    OR first_received_at > ?
    OR (first_received_at = ? AND inbox_receipt_id > ?)
  )
  AND (
    first_received_at < ?
    OR (first_received_at = ? AND inbox_receipt_id <= ?)
  )
ORDER BY first_received_at ASC, inbox_receipt_id ASC
LIMIT ?`;

const SUCCEED_SQL = `/* inbox_shadow_replay:succeed */
UPDATE inbox_replay_run
SET status = 'SUCCEEDED', lease_owner = NULL, lease_expires_at = NULL,
    processed_receipt_count = ?, verified_receipt_count = ?,
    shadow_inserted_count = ?, shadow_replayed_count = ?,
    failed_receipt_count = 0, result_digest = ?, last_error_code = NULL,
    completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
WHERE replay_run_id = ? AND status = 'RUNNING' AND lease_owner = ?
  AND lease_generation = ? AND replay_transition_id = ?
  AND lease_expires_at > CURRENT_TIMESTAMP(3)
  AND authorization_expires_at > CURRENT_TIMESTAMP(3)`;

const FAIL_SQL = `/* inbox_shadow_replay:fail */
UPDATE inbox_replay_run
SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
    result_digest = NULL, last_error_code = ?,
    completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
WHERE replay_run_id = ? AND status = 'RUNNING' AND lease_owner = ?
  AND lease_generation = ? AND replay_transition_id = ?`;

function replayError(code) {
  const error = new Error("governed shadow replay could not be executed");
  error.code = code;
  Object.defineProperty(error, "isInboxShadowReplayError", { value: true });
  return error;
}

function configurationError() { return replayError("INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID"); }
function inputError() { return replayError("INBOX_SHADOW_REPLAY_INPUT_INVALID"); }
function disabledError() { return replayError("INBOX_SHADOW_REPLAY_DISABLED"); }
function persistenceError() { return replayError("INBOX_SHADOW_REPLAY_PERSISTENCE_FAILED"); }
function driftError(code = "INBOX_SHADOW_REPLAY_DRIFT") { return replayError(code); }
function leaseError() { return replayError("INBOX_SHADOW_REPLAY_LEASE_UNAVAILABLE"); }

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw persistenceError();
  }
  return normalized;
}

function selectedRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw persistenceError();
  return result[0];
}

function affectedRows(result) {
  const header = Array.isArray(result) ? result[0] : null;
  if (!header || !Number.isSafeInteger(header.affectedRows)) throw persistenceError();
  return header.affectedRows;
}

function parseJson(value) {
  if (plainRecord(value) || Array.isArray(value)) return JSON.parse(JSON.stringify(value));
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") throw driftError("SOURCE_PAYLOAD_INVALID");
  try { return JSON.parse(value); } catch { throw driftError("SOURCE_PAYLOAD_INVALID"); }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function mysqlTemporal(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw persistenceError();
    return Object.freeze({
      mysql: new Date(value.getTime() + 8 * 60 * 60 * 1_000)
        .toISOString().slice(0, 23).replace("T", " "),
      iso: value.toISOString(),
      epoch: value.getTime(),
    });
  }
  if (typeof value !== "string" || !MYSQL_DATETIME_PATTERN.test(value)) throw persistenceError();
  const instant = new Date(`${value.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(instant.getTime())) throw persistenceError();
  const roundTrip = new Date(instant.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString().slice(0, 23).replace("T", " ");
  if (roundTrip !== value) throw persistenceError();
  return Object.freeze({ mysql: value, iso: instant.toISOString(), epoch: instant.getTime() });
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function payloadBinding(row) {
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

function sourceRegistration() {
  try {
    return getDefaultInboxHandlerRegistry().assertScope({
      consumerName: "task-share-completion-projection",
      handlerVersion: SOURCE_HANDLER_VERSION,
      sourceName: "myroot-api",
      eventType: "task.event.recorded.v1",
      schemaVersion: "1",
      aggregateType: "TASK_EVENT",
    });
  } catch { throw configurationError(); }
}

function staticPolicy() {
  try {
    const registry = getDefaultInboxReplayPolicyRegistry();
    registry.assertReady();
    const description = registry.describe();
    const policy = description.policies.find((entry) => entry.policyId === POLICY_ID);
    if (!policy) throw new Error("policy unavailable");
    return Object.freeze({ registry: description, policy });
  } catch { throw configurationError(); }
}

function normalizeRun(row) {
  if (!plainRecord(row) || !opaqueAscii(row.replay_run_id, 64)
    || !["APPROVED", "RUNNING", "SUCCEEDED", "FAILED", "EXPIRED", "REVIEW_REQUIRED"].includes(row.status)) {
    throw persistenceError();
  }
  const numeric = [
    "policy_registry_version", "policy_version", "source_handler_registry_version",
    "shadow_generation", "maximum_selected_count", "selected_receipt_count",
    "lease_generation", "processed_receipt_count", "verified_receipt_count",
    "shadow_inserted_count", "shadow_replayed_count", "failed_receipt_count",
  ];
  const normalized = { ...row };
  for (const key of numeric) normalized[key] = integer(row[key], key === "shadow_generation" ? 2 : 0);
  normalized.execution_executor_registry_version = integer(
    row.execution_executor_registry_version,
    1
  );
  for (const key of [
    "execution_executor_registry_digest", "execution_executor_descriptor_digest",
    "execution_executor_source_digest", "execution_executor_registration_digest",
  ]) {
    if (!SHA256_PATTERN.test(row[key])) throw persistenceError();
  }
  for (const key of [
    "selection_through_first_received_at", "selection_snapshot_at",
    "authorization_expires_at", "db_now",
  ]) normalized[key] = mysqlTemporal(row[key]).mysql;
  if ((row.selection_after_first_received_at === null) !== (row.selection_after_receipt_id === null)) {
    throw persistenceError();
  }
  if (row.selection_after_first_received_at !== null) {
    normalized.selection_after_first_received_at = mysqlTemporal(row.selection_after_first_received_at).mysql;
  }
  if (row.lease_expires_at !== null) normalized.lease_expires_at = mysqlTemporal(row.lease_expires_at).mysql;
  if (normalized.status === "APPROVED" && (normalized.lease_generation !== 0
    || normalized.lease_owner !== null || normalized.lease_expires_at !== null
    || normalized.processed_receipt_count !== 0 || normalized.result_digest !== null)) {
    throw persistenceError();
  }
  if (normalized.status === "RUNNING" && (!opaqueAscii(normalized.lease_owner, 128)
    || normalized.lease_expires_at === null || normalized.lease_generation < 1
    || !opaqueAscii(normalized.replay_transition_id, 128))) throw persistenceError();
  if (normalized.status === "SUCCEEDED" && (!SHA256_PATTERN.test(normalized.result_digest)
    || normalized.processed_receipt_count !== normalized.selected_receipt_count
    || normalized.verified_receipt_count !== normalized.selected_receipt_count
    || normalized.failed_receipt_count !== 0
    || normalized.shadow_inserted_count + normalized.shadow_replayed_count
      !== normalized.verified_receipt_count
    || normalized.lease_owner !== null || normalized.lease_expires_at !== null)) {
    throw persistenceError();
  }
  return Object.freeze(normalized);
}

function assertIdentity(run, registration, policyState, executorRegistration) {
  const descriptor = registration.descriptor;
  const expected = {
    replay_mode: MODE,
    policy_registry_version: policyState.registry.registryVersion,
    policy_registry_digest: policyState.registry.registryDigest,
    policy_id: policyState.policy.policyId,
    policy_version: policyState.policy.policyVersion,
    policy_digest: policyState.policy.policyDigest,
    consumer_name: descriptor.consumerName,
    source_name: descriptor.sourceName,
    event_type: descriptor.eventType,
    schema_version: descriptor.schemaVersion,
    aggregate_type: descriptor.aggregateType,
    source_receipt_status: "SUCCEEDED",
    source_handler_id: descriptor.handlerId,
    source_handler_version: descriptor.handlerVersion,
    source_handler_registry_version: registration.registryVersion,
    source_handler_descriptor_digest: descriptor.descriptorDigest,
    source_handler_source_digest: descriptor.sourceDigest,
    source_handler_registration_digest: registration.registrationDigest,
    execution_consumer_name: executionConsumerName(run.replay_run_id),
    execution_handler_id: policyState.policy.handlerId,
    execution_handler_version: policyState.policy.handlerVersion,
    execution_executor_registry_version: executorRegistration.registryVersion,
    execution_executor_registry_digest: executorRegistration.registryDigest,
    execution_executor_descriptor_digest: executorRegistration.descriptor.descriptorDigest,
    execution_executor_source_digest: executorRegistration.descriptor.sourceDigest,
    execution_executor_registration_digest: executorRegistration.registrationDigest,
    target_projection_policy: policyState.policy.targetProjectionPolicy,
    cursor_version: policyState.policy.selectionCursorType,
    selection_query_id: SELECTION_QUERY_ID,
    selection_query_digest: policyState.policy.selectionQueryDigest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (run[key] !== value) throw driftError("REPLAY_IDENTITY_DRIFT");
  }
  if (run.execution_handler_id !== EXECUTION_HANDLER_ID
    || run.execution_handler_version !== EXECUTION_HANDLER_VERSION
    || run.target_projection_policy !== TARGET_POLICY
    || run.shadow_generation < 2
    || !SHA256_PATTERN.test(run.selection_digest)
    || run.selected_receipt_count < 1
    || run.selected_receipt_count > run.maximum_selected_count) {
    throw driftError("REPLAY_IDENTITY_DRIFT");
  }
}

function publicResult(run) {
  return Object.freeze({
    replayRunId: run.replay_run_id,
    status: run.status,
    shadowGeneration: run.shadow_generation,
    selectedCount: run.selected_receipt_count,
    processedCount: run.processed_receipt_count,
    verifiedCount: run.verified_receipt_count,
    shadowInsertedCount: run.shadow_inserted_count,
    shadowReplayedCount: run.shadow_replayed_count,
    resultDigest: run.result_digest,
  });
}

function executionConsumerName(replayRunId) {
  const suffix = crypto.createHash("sha256")
    .update(`${EXECUTION_CONSUMER_DIGEST_DOMAIN}\0`, "utf8")
    .update(replayRunId, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `task-share-shadow-rebuild-v1:${suffix}`;
}

async function deriveProductionFact(registration, envelope) {
  let captured = null;
  const calls = [];
  const result = await registration.apply({
    envelope,
    handlerEvidence: {
      handlerId: registration.descriptor.handlerId,
      handlerVersion: registration.descriptor.handlerVersion,
      registryVersion: registration.registryVersion,
      registryDigest: registration.registryDigest,
      assemblySourceDigest: registration.assemblySourceDigest,
      registrationDigest: registration.registrationDigest,
      descriptorDigest: registration.descriptor.descriptorDigest,
      sourceDigest: registration.descriptor.sourceDigest,
    },
    async executeStatement(statementId, parameters) {
      calls.push(statementId);
      if (statementId === "share_projection.select_conflicts_for_update.v1") return [];
      if (statementId === "share_projection.insert.v1" && captured === null) {
        captured = { ...parameters };
        return { affectedRows: 1 };
      }
      throw driftError("SOURCE_HANDLER_EXECUTION_DRIFT");
    },
    async stageOutbox() { throw driftError("SOURCE_HANDLER_OUTBOX_FORBIDDEN"); },
  });
  if (calls.join("\0") !== [
    "share_projection.select_conflicts_for_update.v1",
    "share_projection.insert.v1",
  ].join("\0") || !captured) throw driftError("SOURCE_HANDLER_EXECUTION_DRIFT");
  const productionRow = {
    projection_id: captured.projectionId,
    projection_generation: captured.projectionGeneration,
    task_event_id: captured.taskEventId,
    source_event_id: captured.sourceEventId,
    source_event_type: captured.sourceEventType,
    source_schema_version: captured.sourceSchemaVersion,
    source_name: captured.sourceName,
    source_partition_key: captured.sourcePartitionKey,
    source_partition_position: captured.sourcePartitionPosition,
    source_aggregate_version: captured.sourceAggregateVersion,
    task_type: captured.taskType,
    completion_event_type: captured.completionEventType,
    occurred_at: captured.occurredAt,
    handler_version: captured.handlerVersion,
    handler_registration_digest: captured.handlerRegistrationDigest,
  };
  const verified = await registration.verify({
    envelope,
    handlerEvidence: {
      handlerVersion: registration.descriptor.handlerVersion,
      registrationDigest: registration.registrationDigest,
    },
    result: result.result,
    manifest: result.manifest,
    async executeStatement(statementId) {
      if (statementId !== "share_projection.verify_by_id.v1") {
        throw driftError("SOURCE_HANDLER_EXECUTION_DRIFT");
      }
      return [productionRow];
    },
  });
  if (verified !== true) throw driftError("SOURCE_HANDLER_VERIFY_FAILED");
  return Object.freeze(captured);
}

function statementParameter(rule, value) {
  if (rule.type === "INTEGER") {
    if (!Number.isSafeInteger(value) || value < rule.minimum || value > rule.maximum) {
      throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
    }
    return value;
  }
  if (typeof value !== "string" || value.length === 0
    || (rule.maximumLength !== null && value.length > rule.maximumLength)) {
    throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
  }
  if (rule.type === "SHA256" && !SHA256_PATTERN.test(value)) {
    throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
  }
  if (rule.type === "MYSQL_DATETIME"
    && (!MYSQL_DATETIME_PATTERN.test(value) || mysqlTemporal(value).mysql !== value)) {
    throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
  }
  return value;
}

async function executeRegisteredStatement(connection, registration, phase, calls, statementId, parameters) {
  const statement = registration.statements.find((entry) => entry.statementId === statementId);
  if (!statement || !exactKeys(parameters, statement.parameterNames)
    || (phase === "APPLY" && !statement.phase.startsWith("APPLY_"))
    || (phase === "VERIFY" && statement.phase !== "VERIFY_READ")) {
    throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
  }
  calls.push(statementId);
  const values = statement.parameterRules.map((rule) => statementParameter(rule, parameters[rule.name]));
  let result;
  try { result = await connection.execute(statement.sql, values); } catch {
    throw persistenceError();
  }
  if (statement.resultMode === "ROWS") return selectedRows(result);
  const count = affectedRows(result);
  if (count !== 1) throw persistenceError();
  return Object.freeze({ affectedRows: count });
}

function exactExecutionProfile(actual, profiles) {
  return profiles.some((profile) => profile.join("\0") === actual.join("\0"));
}

async function executeShadowExecutor(connection, executorRegistration, sourceFact, run, row) {
  const executorEvidence = Object.freeze({
    executorId: executorRegistration.descriptor.executorId,
    executorVersion: executorRegistration.descriptor.executorVersion,
    registryVersion: executorRegistration.registryVersion,
    registryDigest: executorRegistration.registryDigest,
    descriptorDigest: executorRegistration.descriptor.descriptorDigest,
    sourceDigest: executorRegistration.descriptor.sourceDigest,
    registrationDigest: executorRegistration.registrationDigest,
  });
  const runEvidence = Object.freeze({
    replayRunId: run.replay_run_id,
    shadowGeneration: run.shadow_generation,
    sourceReceiptId: row.inbox_receipt_id,
    sourceHandlerRegistrationDigest: run.source_handler_registration_digest,
  });
  const applyCalls = [];
  const applied = await executorRegistration.apply({
    sourceFact,
    runEvidence,
    executorEvidence,
    executeStatement: (statementId, parameters) => executeRegisteredStatement(
      connection,
      executorRegistration,
      "APPLY",
      applyCalls,
      statementId,
      parameters
    ),
  });
  if (!exactExecutionProfile(
    applyCalls,
    executorRegistration.descriptor.applyExecutionProfiles
  )) throw driftError("REPLAY_EXECUTOR_STATEMENT_DRIFT");
  const verifyCalls = [];
  const verified = await executorRegistration.verify({
    sourceFact,
    runEvidence,
    executorEvidence,
    result: applied.result,
    manifest: applied.manifest,
    executeStatement: (statementId, parameters) => executeRegisteredStatement(
      connection,
      executorRegistration,
      "VERIFY",
      verifyCalls,
      statementId,
      parameters
    ),
  });
  if (verified !== true
    || verifyCalls.join("\0")
      !== executorRegistration.descriptor.requiredVerifyStatementIds.join("\0")) {
    throw driftError("REPLAY_EXECUTOR_VERIFY_FAILED");
  }
  return Object.freeze({
    inserted: applied.result.disposition === "INSERTED",
    fact: applied.manifest.fact,
  });
}

function createMysqlInboxShadowReplayRunner(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !OPTION_KEYS.includes(key))
    || !options.pool || typeof options.pool.getConnection !== "function"
    || (options.env !== undefined && !plainRecord(options.env))) throw configurationError();
  const pool = options.pool;
  const runtimeEnv = options.env === undefined ? process.env : options.env;
  const enabled = runtimeEnv[ENABLE_FLAG] === "true";
  const registration = sourceRegistration();
  const policyState = staticPolicy();
  let executorRegistration;
  try {
    executorRegistration = assertResolvedInboxReplayExecutorRegistration(
      getDefaultInboxReplayExecutorRegistry().resolve({
        executorId: EXECUTION_HANDLER_ID,
        executorVersion: EXECUTION_HANDLER_VERSION,
        policyId: POLICY_ID,
        mode: MODE,
      })
    );
  } catch { throw configurationError(); }
  const contentCodec = createInboxContentCodec(runtimeEnv);
  if (!contentCodec || typeof contentCodec.open !== "function"
    || typeof contentCodec.assertReady !== "function"
    || typeof contentCodec.getStatus !== "function") throw configurationError();

  async function acquireConnection() {
    let connection;
    try { connection = await pool.getConnection(); } catch { throw persistenceError(); }
    if (!connection || typeof connection.execute !== "function"
      || typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function" || typeof connection.rollback !== "function"
      || typeof connection.release !== "function" || typeof connection.destroy !== "function") {
      try { if (connection && typeof connection.release === "function") connection.release(); } catch {}
      throw configurationError();
    }
    try { await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`); } catch {
      try { connection.destroy(); } catch {}
      throw persistenceError();
    }
    return connection;
  }

  function retire(connection, destroy = false) {
    try { if (destroy) connection.destroy(); else connection.release(); } catch {}
  }

  async function readRun(connection, replayRunId, lock = false) {
    const rows = selectedRows(await connection.execute(lock ? LOCK_RUN_SQL : READ_RUN_SQL, [replayRunId]));
    if (rows.length !== 1) throw persistenceError();
    return normalizeRun(rows[0]);
  }

  async function inspect(replayRunId) {
    const connection = await acquireConnection();
    let destroy = false;
    try { return await readRun(connection, replayRunId, false); } catch (error) {
      destroy = true;
      throw error && error.code ? error : persistenceError();
    } finally { retire(connection, destroy); }
  }

  async function expireRun(connection, run) {
    if (affectedRows(await connection.execute(EXPIRE_SQL, [run.replay_run_id])) !== 1) {
      throw persistenceError();
    }
  }

  async function claim(input) {
    const connection = await acquireConnection();
    let began = false;
    let committed = false;
    let destroy = false;
    let retired = false;
    let expected = null;
    try {
      await connection.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      began = true;
      const run = await readRun(connection, input.replayRunId, true);
      assertIdentity(run, registration, policyState, executorRegistration);
      if (run.status === "SUCCEEDED") {
        await connection.commit();
        committed = true;
        return Object.freeze({ done: true, run });
      }
      if (run.status === "APPROVED"
        && mysqlTemporal(run.db_now).epoch >= mysqlTemporal(run.authorization_expires_at).epoch) {
        await expireRun(connection, run);
        await connection.commit();
        committed = true;
        throw driftError("AUTHORIZATION_EXPIRED");
      }
      const recoverable = run.status === "APPROVED"
        || (run.status === "RUNNING" && run.lease_expires_at !== null
          && mysqlTemporal(run.lease_expires_at).epoch <= mysqlTemporal(run.db_now).epoch);
      if (!recoverable) throw leaseError();
      const generation = run.lease_generation + 1;
      const transitionId = `replay_${crypto.randomUUID().replace(/-/g, "")}`;
      if (affectedRows(await connection.execute(CLAIM_SQL, [
        input.leaseOwner, input.leaseSeconds, generation, transitionId,
        input.replayRunId, run.lease_generation,
      ])) !== 1) throw leaseError();
      expected = Object.freeze({
        replayRunId: input.replayRunId,
        leaseOwner: input.leaseOwner,
        leaseGeneration: generation,
        transitionId,
      });
      await connection.commit();
      committed = true;
      return Object.freeze({ done: false, fence: expected });
    } catch (error) {
      destroy = !committed;
      if (began && !committed) { try { await connection.rollback(); } catch {} }
      if (expected && !committed) {
        retire(connection, true);
        retired = true;
        try {
          const converged = await inspect(expected.replayRunId);
          if (converged.status === "RUNNING" && converged.lease_owner === expected.leaseOwner
            && converged.lease_generation === expected.leaseGeneration
            && converged.replay_transition_id === expected.transitionId) {
            return Object.freeze({ done: false, fence: expected });
          }
        } catch {}
      }
      throw error && error.isInboxShadowReplayError === true ? error : persistenceError();
    } finally { if (!retired) retire(connection, destroy); }
  }

  function sourceValues(run) {
    return [
      run.consumer_name, run.source_name, run.event_type, run.schema_version,
      run.aggregate_type, run.source_receipt_status,
    ];
  }

  function identityValues(run) {
    return [
      run.source_handler_id, run.source_handler_version,
      run.source_handler_registry_version, run.source_handler_descriptor_digest,
      run.source_handler_source_digest, run.source_handler_registration_digest,
    ];
  }

  function normalizeSourceRows(rows, run) {
    if (!Array.isArray(rows) || rows.length !== run.selected_receipt_count
      || rows.length > run.maximum_selected_count) throw driftError("REPLAY_SELECTION_DRIFT");
    let previous = null;
    return rows.map((row) => {
      if (!plainRecord(row) || !opaqueAscii(row.inbox_receipt_id, 64)) {
        throw driftError("REPLAY_SELECTION_DRIFT");
      }
      const expected = {
        consumer_name: run.consumer_name,
        source_name: run.source_name,
        event_type: run.event_type,
        schema_version: run.schema_version,
        aggregate_type: run.aggregate_type,
        status: run.source_receipt_status,
        handler_id: run.source_handler_id,
        handler_version: run.source_handler_version,
        handler_registry_version: run.source_handler_registry_version,
        handler_descriptor_digest: run.source_handler_descriptor_digest,
        handler_source_digest: run.source_handler_source_digest,
        handler_registration_digest: run.source_handler_registration_digest,
      };
      for (const [key, value] of Object.entries(expected)) {
        if (key === "handler_registry_version") {
          if (Number(row[key]) !== value) throw driftError("SOURCE_REGISTRATION_DRIFT");
        } else if (row[key] !== value) throw driftError("SOURCE_REGISTRATION_DRIFT");
      }
      const received = mysqlTemporal(row.first_received_at);
      if (previous && (received.epoch < previous.epoch
        || (received.epoch === previous.epoch
          && byteCompare(row.inbox_receipt_id, previous.receiptId) <= 0))) {
        throw driftError("REPLAY_SELECTION_DRIFT");
      }
      previous = { epoch: received.epoch, receiptId: row.inbox_receipt_id };
      return Object.freeze({ ...row, received });
    });
  }

  function verifySelection(rows, run) {
    const selectionDigest = digest(SELECTION_DIGEST_DOMAIN, {
      registryDigest: run.policy_registry_digest,
      policyDigest: run.policy_digest,
      selectionQueryDigest: run.selection_query_digest,
      snapshotAt: mysqlTemporal(run.selection_snapshot_at).iso,
      lowerCursor: run.selection_after_receipt_id === null ? null : {
        receivedAt: mysqlTemporal(run.selection_after_first_received_at).iso,
        receiptId: run.selection_after_receipt_id,
      },
      receipts: rows.map((row) => ({
        receivedAt: row.received.iso,
        receiptId: row.inbox_receipt_id,
      })),
    });
    const upper = rows[rows.length - 1];
    if (selectionDigest !== run.selection_digest
      || upper.received.mysql !== run.selection_through_first_received_at
      || upper.inbox_receipt_id !== run.selection_through_receipt_id) {
      throw driftError("REPLAY_SELECTION_DRIFT");
    }
  }

  function openEnvelope(row) {
    let opened;
    try {
      opened = contentCodec.open(parseJson(row.payload_json), {
        purpose: "PAYLOAD",
        binding: payloadBinding(row),
      });
    } catch { throw driftError("SOURCE_PAYLOAD_INVALID"); }
    if (opened.protected !== true || opened.codecVersion !== "A256GCM:v1"
      || opened.digestScheme !== "hmac-sha256:v1"
      || opened.codecVersion !== row.payload_codec_version
      || opened.keyId !== row.payload_key_id
      || opened.digestScheme !== row.payload_digest_scheme
      || opened.contentDigest !== row.payload_digest) throw driftError("SOURCE_PAYLOAD_INVALID");
    const snapshot = payloadSnapshot(opened.value);
    if (Buffer.byteLength(JSON.stringify(snapshot.payload), "utf8") > MAX_PAYLOAD_BYTES) {
      throw driftError("SOURCE_PAYLOAD_INVALID");
    }
    return Object.freeze({
      eventId: row.event_id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      sourceName: row.source_name,
      partitionKey: row.partition_key,
      partitionPosition: integer(row.partition_position, 1),
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: integer(row.aggregate_version, 1),
      occurredAt: mysqlTemporal(row.occurred_at).mysql,
      producerVersion: row.producer_version,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      idempotencyKey: row.idempotency_key,
      payload: snapshot.payload,
      payloadDigest: snapshot.digest,
    });
  }

  async function execute(fence) {
    const connection = await acquireConnection();
    let began = false;
    let committed = false;
    let destroy = false;
    let retired = false;
    let expectedDigest = null;
    try {
      await connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.beginTransaction();
      began = true;
      const run = await readRun(connection, fence.replayRunId, true);
      assertIdentity(run, registration, policyState, executorRegistration);
      if (run.status === "SUCCEEDED") {
        await connection.commit();
        committed = true;
        return run;
      }
      if (run.status !== "RUNNING" || run.lease_owner !== fence.leaseOwner
        || run.lease_generation !== fence.leaseGeneration
        || run.replay_transition_id !== fence.transitionId
        || run.lease_expires_at === null
        || mysqlTemporal(run.lease_expires_at).epoch <= mysqlTemporal(run.db_now).epoch) {
        throw leaseError();
      }
      if (mysqlTemporal(run.authorization_expires_at).epoch <= mysqlTemporal(run.db_now).epoch) {
        throw driftError("AUTHORIZATION_EXPIRED_DURING_EXECUTION");
      }
      const driftRows = selectedRows(await connection.execute(
        SOURCE_REGISTRATION_DRIFT_SQL,
        [
          ...sourceValues(run), run.selection_snapshot_at, run.selection_snapshot_at,
          run.selection_after_first_received_at, run.selection_after_first_received_at,
          run.selection_after_first_received_at, run.selection_after_receipt_id,
          run.selection_through_first_received_at, run.selection_through_first_received_at,
          run.selection_through_receipt_id, ...identityValues(run),
        ]
      ));
      if (driftRows.length !== 1
        || integer(driftRows[0].registration_drift_count) !== 0) {
        throw driftError("SOURCE_REGISTRATION_DRIFT");
      }
      const lower = run.selection_after_first_received_at;
      const sourceRows = selectedRows(await connection.execute(SOURCE_SELECTION_SQL, [
        ...sourceValues(run), ...identityValues(run),
        run.selection_snapshot_at, run.selection_snapshot_at,
        lower, lower, lower, run.selection_after_receipt_id,
        run.selection_through_first_received_at,
        run.selection_through_first_received_at,
        run.selection_through_receipt_id,
        run.maximum_selected_count + 1,
      ]));
      const rows = normalizeSourceRows(sourceRows, run);
      verifySelection(rows, run);

      let insertedCount = 0;
      let replayedCount = 0;
      const outcomes = [];
      for (const row of rows) {
        const envelope = openEnvelope(row);
        let fact;
        try { fact = await deriveProductionFact(registration, envelope); } catch (error) {
          if (error && error.isInboxShadowReplayError === true) throw error;
          throw driftError("SOURCE_HANDLER_EXECUTION_DRIFT");
        }
        let written;
        try {
          written = await executeShadowExecutor(
            connection,
            executorRegistration,
            fact,
            run,
            row
          );
        } catch (error) {
          if (error && error.isInboxShadowReplayError === true) throw error;
          throw driftError("REPLAY_EXECUTOR_EXECUTION_DRIFT");
        }
        if (written.inserted) insertedCount += 1;
        else replayedCount += 1;
        outcomes.push({
          sourceReceiptId: row.inbox_receipt_id,
          shadowProjectionId: written.fact.shadowProjectionId,
          taskEventId: written.fact.taskEventId,
          sourceEventId: written.fact.sourceEventId,
          shadowFactDigest: digest(
            "myroot-inbox-shadow-projection-fact:v1",
            written.fact
          ),
        });
      }
      expectedDigest = digest(RESULT_DIGEST_DOMAIN, {
        replayRunId: run.replay_run_id,
        shadowGeneration: run.shadow_generation,
        selectionDigest: run.selection_digest,
        sourceHandlerRegistrationDigest: run.source_handler_registration_digest,
        executionHandlerId: EXECUTION_HANDLER_ID,
        executionHandlerVersion: EXECUTION_HANDLER_VERSION,
        executionExecutorRegistrationDigest:
          run.execution_executor_registration_digest,
        outcomes,
      });
      if (affectedRows(await connection.execute(SUCCEED_SQL, [
        rows.length, rows.length, insertedCount, replayedCount, expectedDigest,
        run.replay_run_id, fence.leaseOwner, fence.leaseGeneration, fence.transitionId,
      ])) !== 1) throw leaseError();
      const completed = await readRun(connection, run.replay_run_id, true);
      if (completed.status !== "SUCCEEDED" || completed.result_digest !== expectedDigest
        || completed.processed_receipt_count !== rows.length
        || completed.verified_receipt_count !== rows.length
        || completed.shadow_inserted_count !== insertedCount
        || completed.shadow_replayed_count !== replayedCount
        || completed.failed_receipt_count !== 0) throw persistenceError();
      await connection.commit();
      committed = true;
      return completed;
    } catch (error) {
      destroy = !committed;
      if (began && !committed) { try { await connection.rollback(); } catch {} }
      if (expectedDigest) {
        retire(connection, true);
        retired = true;
        try {
          const converged = await inspect(fence.replayRunId);
          if (converged.status === "SUCCEEDED" && converged.result_digest === expectedDigest) {
            return converged;
          }
        } catch {}
      }
      throw error && error.isInboxShadowReplayError === true ? error : persistenceError();
    } finally { if (!retired) retire(connection, destroy); }
  }

  async function markFailed(fence, errorCode) {
    const connection = await acquireConnection();
    let began = false;
    let committed = false;
    let destroy = false;
    try {
      await connection.beginTransaction();
      began = true;
      const run = await readRun(connection, fence.replayRunId, true);
      if (run.status === "SUCCEEDED") {
        await connection.commit();
        committed = true;
        return run;
      }
      if (run.status !== "RUNNING" || run.lease_owner !== fence.leaseOwner
        || run.lease_generation !== fence.leaseGeneration
        || run.replay_transition_id !== fence.transitionId) throw leaseError();
      if (affectedRows(await connection.execute(FAIL_SQL, [
        errorCode, fence.replayRunId, fence.leaseOwner,
        fence.leaseGeneration, fence.transitionId,
      ])) !== 1) throw leaseError();
      const failed = await readRun(connection, fence.replayRunId, true);
      if (failed.status !== "FAILED" || failed.last_error_code !== errorCode) {
        throw persistenceError();
      }
      await connection.commit();
      committed = true;
      return failed;
    } catch (error) {
      destroy = !committed;
      if (began && !committed) { try { await connection.rollback(); } catch {} }
      throw error && error.isInboxShadowReplayError === true ? error : persistenceError();
    } finally { retire(connection, destroy); }
  }

  async function run(input = {}) {
    if (!exactKeys(input, RUN_KEYS) || !opaqueAscii(input.replayRunId, 64)
      || !opaqueAscii(input.leaseOwner, 128)
      || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 1
      || input.leaseSeconds > MAX_LEASE_SECONDS) throw inputError();
    if (!enabled) throw disabledError();
    try {
      contentCodec.assertReady();
      const status = contentCodec.getStatus();
      if (!plainRecord(status) || status.ready !== true || status.enabled !== true) {
        throw configurationError();
      }
    } catch (error) {
      if (error && error.code === "INBOX_SHADOW_REPLAY_CONFIGURATION_INVALID") throw error;
      throw configurationError();
    }
    const claimed = await claim(input);
    if (claimed.done) return publicResult(claimed.run);
    try {
      return publicResult(await execute(claimed.fence));
    } catch (error) {
      if (error && [
        "INBOX_SHADOW_REPLAY_DRIFT", "REPLAY_IDENTITY_DRIFT",
        "REPLAY_SELECTION_DRIFT", "SOURCE_REGISTRATION_DRIFT",
        "SOURCE_PAYLOAD_INVALID", "SOURCE_HANDLER_EXECUTION_DRIFT",
        "SOURCE_HANDLER_OUTBOX_FORBIDDEN", "SOURCE_HANDLER_VERIFY_FAILED",
        "REPLAY_EXECUTOR_STATEMENT_DRIFT", "REPLAY_EXECUTOR_VERIFY_FAILED",
        "REPLAY_EXECUTOR_EXECUTION_DRIFT", "REPLAY_EXECUTOR_IDENTITY_DRIFT",
        "AUTHORIZATION_EXPIRED_DURING_EXECUTION",
      ].includes(error.code)) {
        try { await markFailed(claimed.fence, error.code); } catch {}
      }
      throw error;
    }
  }

  return Object.freeze({ run });
}

module.exports = {
  createMysqlInboxShadowReplayRunner,
};
