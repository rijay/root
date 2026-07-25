const crypto = require("node:crypto");

const {
  assertResolvedInboxHandlerRegistration,
  getDefaultInboxHandlerRegistry,
} = require("./inboxHandlerRegistry");
const {
  assertResolvedInboxReplayExecutorRegistration,
  getDefaultInboxReplayExecutorRegistry,
} = require("./inboxReplayExecutorRegistry");
const { getDefaultInboxReplayPolicyRegistry } = require("./inboxReplayPolicyRegistry");

const ENABLE_FLAG = "MYROOT_INBOX_REPLAY_CONTROL_ENABLED";
const MYSQL_SESSION_TIME_ZONE = "+08:00";
const SELECTION_DIGEST_DOMAIN = "myroot-inbox-replay-selection:v1";
const EXECUTION_CONSUMER_DIGEST_DOMAIN = "myroot-inbox-replay-execution-consumer:v1";
const OPTION_KEYS = Object.freeze(["pool", "env"]);
const PREPARE_KEYS = Object.freeze(["authorization"]);
const INSPECT_KEYS = Object.freeze(["replayRunId"]);
const AUTHORIZATION_KEYS = Object.freeze([
  "policyId",
  "replayRunId",
  "requestedByActorId",
  "authorizedByActorId",
  "reasonCode",
  "authorizationTicketDigest",
  "requestedAt",
  "authorizedAt",
  "authorizationExpiresAt",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
const ALLOWED_STATUSES = Object.freeze([
  "APPROVED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "REVIEW_REQUIRED",
]);

const SNAPSHOT_SQL = `
SELECT CURRENT_TIMESTAMP(3) AS selection_snapshot_at`;

const EXISTING_RUN_SQL = `
SELECT
  replay_run_id,
  replay_mode,
  status,
  reason_code,
  policy_registry_version,
  policy_registry_digest,
  policy_id,
  policy_version,
  policy_digest,
  consumer_name,
  source_name,
  event_type,
  schema_version,
  aggregate_type,
  source_receipt_status,
  source_handler_id,
  source_handler_version,
  source_handler_registry_version,
  source_handler_descriptor_digest,
  source_handler_source_digest,
  source_handler_registration_digest,
  execution_consumer_name,
  execution_handler_id,
  execution_handler_version,
  execution_executor_registry_version,
  execution_executor_registry_digest,
  execution_executor_descriptor_digest,
  execution_executor_source_digest,
  execution_executor_registration_digest,
  target_projection_policy,
  shadow_generation,
  cursor_version,
  selection_query_id,
  selection_query_digest,
  selection_after_first_received_at,
  selection_after_receipt_id,
  selection_through_first_received_at,
  selection_through_receipt_id,
  selection_snapshot_at,
  selection_digest,
  maximum_selected_count,
  selected_receipt_count,
  requested_by_actor_id,
  requested_at,
  authorized_by_actor_id,
  authorized_at,
  authorization_ticket_digest,
  maximum_authorization_ttl_seconds,
  authorization_expires_at,
  lease_generation,
  processed_receipt_count,
  verified_receipt_count,
  shadow_inserted_count,
  shadow_replayed_count,
  failed_receipt_count,
  created_at,
  updated_at
FROM inbox_replay_run
WHERE replay_run_id = ?`;

const EXISTING_RUN_FOR_UPDATE_SQL = `${EXISTING_RUN_SQL}
FOR UPDATE`;

const SOURCE_SELECTION_SQL = `
SELECT
  first_received_at,
  inbox_receipt_id
FROM inbox_receipt
WHERE consumer_name = ?
  AND source_name = ?
  AND event_type = ?
  AND schema_version = ?
  AND aggregate_type = ?
  AND status = ?
  AND handler_id = ?
  AND handler_version = ?
  AND handler_registry_version = ?
  AND handler_descriptor_digest = ?
  AND handler_source_digest = ?
  AND handler_registration_digest = ?
  AND first_received_at <= ?
  AND completed_at <= ?
  AND (
    ? IS NULL
    OR first_received_at > ?
    OR (
      first_received_at = ?
      AND inbox_receipt_id > ?
    )
  )
ORDER BY first_received_at ASC, inbox_receipt_id ASC
LIMIT ?`;

const SOURCE_REGISTRATION_DRIFT_SQL = `
SELECT COUNT(*) AS registration_drift_count
FROM inbox_receipt
WHERE consumer_name = ?
  AND source_name = ?
  AND event_type = ?
  AND schema_version = ?
  AND aggregate_type = ?
  AND status = ?
  AND first_received_at <= ?
  AND completed_at <= ?
  AND NOT (
    handler_id = ?
    AND handler_version = ?
    AND handler_registry_version = ?
    AND handler_descriptor_digest = ?
    AND handler_source_digest = ?
    AND handler_registration_digest = ?
  )`;

const NEXT_SHADOW_GENERATION_SQL = `
SELECT COALESCE(MAX(shadow_generation), 1) + 1 AS shadow_generation
FROM inbox_replay_run
WHERE consumer_name = ?
  AND source_name = ?
  AND source_handler_id = ?
  AND shadow_generation IS NOT NULL
FOR UPDATE`;

const INSERT_RUN_SQL = `
INSERT INTO inbox_replay_run (
  replay_run_id,
  replay_mode,
  status,
  reason_code,
  policy_registry_version,
  policy_registry_digest,
  policy_id,
  policy_version,
  policy_digest,
  consumer_name,
  source_name,
  event_type,
  schema_version,
  aggregate_type,
  source_receipt_status,
  source_handler_id,
  source_handler_version,
  source_handler_registry_version,
  source_handler_descriptor_digest,
  source_handler_source_digest,
  source_handler_registration_digest,
  execution_consumer_name,
  execution_handler_id,
  execution_handler_version,
  execution_executor_registry_version,
  execution_executor_registry_digest,
  execution_executor_descriptor_digest,
  execution_executor_source_digest,
  execution_executor_registration_digest,
  target_projection_policy,
  shadow_generation,
  cursor_version,
  selection_query_id,
  selection_query_digest,
  selection_after_first_received_at,
  selection_after_receipt_id,
  selection_through_first_received_at,
  selection_through_receipt_id,
  selection_snapshot_at,
  selection_digest,
  maximum_selected_count,
  selected_receipt_count,
  requested_by_actor_id,
  requested_at,
  authorized_by_actor_id,
  authorized_at,
  authorization_ticket_digest,
  maximum_authorization_ttl_seconds,
  authorization_expires_at,
  created_at,
  updated_at
) VALUES (${["?", "?", "'APPROVED'", ...Array(48).fill("?")].join(", ")})`;

function controlError(code) {
  const error = new Error("inbox replay control operation failed");
  error.code = code;
  return error;
}

function configurationError() {
  return controlError("INBOX_REPLAY_CONTROL_CONFIGURATION_INVALID");
}

function inputError() {
  return controlError("INBOX_REPLAY_CONTROL_INPUT_INVALID");
}

function disabledError() {
  return controlError("INBOX_REPLAY_CONTROL_DISABLED");
}

function persistenceError() {
  return controlError("INBOX_REPLAY_CONTROL_PERSISTENCE_FAILED");
}

function driftError() {
  return controlError("INBOX_REPLAY_CONTROL_DRIFT");
}

function selectionError() {
  return controlError("INBOX_REPLAY_CONTROL_SELECTION_INVALID");
}

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
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
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

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw persistenceError();
  }
  return normalized;
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

function selectionDigest(input) {
  return crypto.createHash("sha256")
    .update(`${SELECTION_DIGEST_DOMAIN}\0`, "utf8")
    .update(canonicalJson(input), "utf8")
    .digest("hex");
}

function executionConsumerName(prefix, replayRunId) {
  const suffix = crypto.createHash("sha256")
    .update(`${EXECUTION_CONSUMER_DIGEST_DOMAIN}\0`, "utf8")
    .update(replayRunId, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${suffix}`;
}

function rfc3339ToMysql(value, failure = inputError) {
  if (!RFC3339_MILLIS_PATTERN.test(value)) throw failure();
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) throw failure();
  return new Date(instant.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

function mysqlTemporal(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw persistenceError();
    return Object.freeze({
      iso: value.toISOString(),
      mysql: new Date(value.getTime() + 8 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 23)
        .replace("T", " "),
    });
  }
  if (typeof value !== "string" || !MYSQL_DATETIME_PATTERN.test(value)) {
    throw persistenceError();
  }
  const instant = new Date(`${value.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(instant.getTime())) throw persistenceError();
  const mysql = new Date(instant.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
  if (mysql !== value) throw persistenceError();
  return Object.freeze({ iso: instant.toISOString(), mysql });
}

function normalizeAuthorization(input) {
  if (!exactKeys(input, AUTHORIZATION_KEYS)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeSourceRows(rows, maximumSelectedCount) {
  if (!Array.isArray(rows) || rows.length === 0) throw selectionError();
  if (rows.length > maximumSelectedCount) throw selectionError();
  const normalized = [];
  let previous = null;
  for (const row of rows) {
    if (!exactKeys(row, ["first_received_at", "inbox_receipt_id"])
      || !exactText(row.inbox_receipt_id, 64)
      || !opaqueAscii(row.inbox_receipt_id, 64)) throw driftError();
    const receivedAt = mysqlTemporal(row.first_received_at);
    const cursor = Object.freeze({
      receivedAt: receivedAt.iso,
      receiptId: row.inbox_receipt_id,
      mysqlReceivedAt: receivedAt.mysql,
    });
    if (previous) {
      const ordered = previous.receivedAt < cursor.receivedAt
        || (previous.receivedAt === cursor.receivedAt
          && Buffer.compare(
            Buffer.from(previous.receiptId, "utf8"),
            Buffer.from(cursor.receiptId, "utf8")
          ) < 0);
      if (!ordered) throw driftError();
    }
    previous = cursor;
    normalized.push(cursor);
  }
  return Object.freeze(normalized);
}

function normalizeRunRow(row) {
  if (!plainRecord(row)
    || !opaqueAscii(row.replay_run_id, 64)
    || !ALLOWED_STATUSES.includes(row.status)
    || !SHA256_PATTERN.test(row.policy_registry_digest)
    || !SHA256_PATTERN.test(row.policy_digest)
    || !SHA256_PATTERN.test(row.source_handler_descriptor_digest)
    || !SHA256_PATTERN.test(row.source_handler_source_digest)
    || !SHA256_PATTERN.test(row.source_handler_registration_digest)
    || !SHA256_PATTERN.test(row.selection_query_digest)
    || !SHA256_PATTERN.test(row.selection_digest)
    || !SHA256_PATTERN.test(row.authorization_ticket_digest)
    || !opaqueAscii(row.execution_consumer_name, 128)
    || !opaqueAscii(row.execution_handler_id, 96)
    || !opaqueAscii(row.execution_handler_version, 64)
    || !opaqueAscii(row.cursor_version, 64)
    || !opaqueAscii(row.selection_query_id, 128)
    || !opaqueAscii(row.selection_through_receipt_id, 64)
    || (row.selection_after_first_received_at === null)
      !== (row.selection_after_receipt_id === null)
    || (row.selection_after_receipt_id !== null
      && !opaqueAscii(row.selection_after_receipt_id, 64))) throw persistenceError();

  const normalized = {
    ...row,
    policy_registry_version: integer(row.policy_registry_version, 1),
    policy_version: integer(row.policy_version, 1),
    source_handler_registry_version: integer(row.source_handler_registry_version, 1),
    execution_executor_registry_version: row.execution_executor_registry_version === null
      ? null
      : integer(row.execution_executor_registry_version, 1),
    shadow_generation: row.shadow_generation === null
      ? null
      : integer(row.shadow_generation, 2),
    maximum_selected_count: integer(row.maximum_selected_count, 1),
    selected_receipt_count: integer(row.selected_receipt_count, 1),
    maximum_authorization_ttl_seconds: integer(row.maximum_authorization_ttl_seconds, 60),
    lease_generation: integer(row.lease_generation),
    processed_receipt_count: integer(row.processed_receipt_count),
    verified_receipt_count: integer(row.verified_receipt_count),
    shadow_inserted_count: integer(row.shadow_inserted_count),
    shadow_replayed_count: integer(row.shadow_replayed_count),
    failed_receipt_count: integer(row.failed_receipt_count),
  };
  for (const key of [
    "selection_through_first_received_at",
    "selection_snapshot_at",
    "requested_at",
    "authorized_at",
    "authorization_expires_at",
    "created_at",
    "updated_at",
  ]) normalized[key] = mysqlTemporal(row[key]).mysql;
  if (row.selection_after_first_received_at !== null) {
    normalized.selection_after_first_received_at = mysqlTemporal(
      row.selection_after_first_received_at
    ).mysql;
  }
  if (normalized.selected_receipt_count > normalized.maximum_selected_count) {
    throw persistenceError();
  }
  if (normalized.replay_mode === "VERIFY_ONLY" && normalized.shadow_generation !== null) {
    throw persistenceError();
  }
  if (normalized.replay_mode === "SHADOW_REBUILD" && normalized.shadow_generation === null) {
    throw persistenceError();
  }
  const executorDigests = [
    normalized.execution_executor_registry_digest,
    normalized.execution_executor_descriptor_digest,
    normalized.execution_executor_source_digest,
    normalized.execution_executor_registration_digest,
  ];
  if (normalized.replay_mode === "VERIFY_ONLY" && (
    normalized.execution_executor_registry_version !== null
    || executorDigests.some((value) => value !== null)
  )) throw persistenceError();
  if (normalized.replay_mode === "SHADOW_REBUILD" && (
    normalized.execution_executor_registry_version === null
    || executorDigests.some((value) => !SHA256_PATTERN.test(value))
  )) throw persistenceError();
  if (normalized.requested_by_actor_id === normalized.authorized_by_actor_id) {
    throw persistenceError();
  }
  if (normalized.selection_after_first_received_at !== null) {
    const lowerTime = mysqlTemporal(normalized.selection_after_first_received_at).iso;
    const upperTime = mysqlTemporal(normalized.selection_through_first_received_at).iso;
    const cursorOrdered = lowerTime < upperTime
      || (lowerTime === upperTime
        && Buffer.compare(
          Buffer.from(normalized.selection_after_receipt_id, "utf8"),
          Buffer.from(normalized.selection_through_receipt_id, "utf8")
        ) < 0);
    if (!cursorOrdered) throw persistenceError();
  }
  return Object.freeze(normalized);
}

function publicRun(row) {
  return Object.freeze({
    replayRunId: row.replay_run_id,
    status: row.status,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    mode: row.replay_mode,
    identityStatus: "CURRENT",
    executionConsumerName: row.execution_consumer_name,
    targetProjectionPolicy: row.target_projection_policy,
    shadowGeneration: row.shadow_generation,
    selection: Object.freeze({
      cursorType: row.cursor_version,
      lowerCursor: row.selection_after_receipt_id === null
        ? null
        : Object.freeze({
          receivedAt: mysqlTemporal(row.selection_after_first_received_at).iso,
          receiptId: row.selection_after_receipt_id,
        }),
      upperCursor: Object.freeze({
        receivedAt: mysqlTemporal(row.selection_through_first_received_at).iso,
        receiptId: row.selection_through_receipt_id,
      }),
      snapshotAt: mysqlTemporal(row.selection_snapshot_at).iso,
      selectedCount: row.selected_receipt_count,
      selectionDigest: row.selection_digest,
    }),
  });
}

function assertRunMatchesAuthorization(row, authorized) {
  const scope = authorized.sourceScope;
  const execution = authorized.execution;
  const expected = {
    replay_run_id: authorized.replayRunId,
    replay_mode: authorized.mode,
    reason_code: authorized.reasonCode,
    policy_registry_version: authorized.registryVersion,
    policy_registry_digest: authorized.registryDigest,
    policy_id: authorized.policyId,
    policy_version: authorized.policyVersion,
    policy_digest: authorized.policyDigest,
    consumer_name: scope.consumerName,
    source_name: scope.sourceName,
    event_type: scope.eventType,
    schema_version: scope.schemaVersion,
    aggregate_type: scope.aggregateType,
    source_receipt_status: scope.receiptStatus,
    source_handler_id: scope.handlerId,
    source_handler_version: scope.handlerVersion,
    source_handler_registry_version: scope.handlerRegistryVersion,
    source_handler_descriptor_digest: scope.handlerDescriptorDigest,
    source_handler_source_digest: scope.handlerSourceDigest,
    source_handler_registration_digest: scope.handlerRegistrationDigest,
    execution_consumer_name: authorized.executionConsumerName,
    execution_handler_id: execution.handlerId,
    execution_handler_version: execution.handlerVersion,
    execution_executor_registry_version: execution.executorRegistryVersion,
    execution_executor_registry_digest: execution.executorRegistryDigest,
    execution_executor_descriptor_digest: execution.executorDescriptorDigest,
    execution_executor_source_digest: execution.executorSourceDigest,
    execution_executor_registration_digest: execution.executorRegistrationDigest,
    target_projection_policy: execution.targetProjectionPolicy,
    cursor_version: authorized.selectionCursorType,
    selection_query_id: authorized.selectionQueryId,
    selection_query_digest: authorized.selectionQueryDigest,
    maximum_selected_count: authorized.maximumSelectedCount,
    requested_by_actor_id: authorized.requestedByActorId,
    requested_at: rfc3339ToMysql(authorized.requestedAt, driftError),
    authorized_by_actor_id: authorized.authorizedByActorId,
    authorized_at: rfc3339ToMysql(authorized.authorizedAt, driftError),
    authorization_ticket_digest: authorized.authorizationTicketDigest,
    maximum_authorization_ttl_seconds: 3600,
    authorization_expires_at: rfc3339ToMysql(
      authorized.authorizationExpiresAt,
      driftError
    ),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) throw driftError();
  }
  if (authorized.mode === "VERIFY_ONLY" && row.shadow_generation !== null) throw driftError();
  if (authorized.mode === "SHADOW_REBUILD" && row.shadow_generation < 2) throw driftError();
  return row;
}

function buildExpectedRun({ authorized, execution, sealed, snapshot, upper, shadowGeneration }) {
  const scope = authorized.sourceScope;
  return Object.freeze({
    replay_run_id: authorized.replayRunId,
    replay_mode: authorized.mode,
    status: "APPROVED",
    reason_code: authorized.reasonCode,
    policy_registry_version: authorized.registryVersion,
    policy_registry_digest: authorized.registryDigest,
    policy_id: authorized.policyId,
    policy_version: authorized.policyVersion,
    policy_digest: authorized.policyDigest,
    consumer_name: scope.consumerName,
    source_name: scope.sourceName,
    event_type: scope.eventType,
    schema_version: scope.schemaVersion,
    aggregate_type: scope.aggregateType,
    source_receipt_status: scope.receiptStatus,
    source_handler_id: scope.handlerId,
    source_handler_version: scope.handlerVersion,
    source_handler_registry_version: scope.handlerRegistryVersion,
    source_handler_descriptor_digest: scope.handlerDescriptorDigest,
    source_handler_source_digest: scope.handlerSourceDigest,
    source_handler_registration_digest: scope.handlerRegistrationDigest,
    execution_consumer_name: execution.executionConsumerName,
    execution_handler_id: execution.handlerId,
    execution_handler_version: execution.handlerVersion,
    execution_executor_registry_version: execution.executorRegistryVersion,
    execution_executor_registry_digest: execution.executorRegistryDigest,
    execution_executor_descriptor_digest: execution.executorDescriptorDigest,
    execution_executor_source_digest: execution.executorSourceDigest,
    execution_executor_registration_digest: execution.executorRegistrationDigest,
    target_projection_policy: execution.targetProjectionPolicy,
    shadow_generation: shadowGeneration,
    cursor_version: execution.selection.cursorType,
    selection_query_id: execution.selection.queryId,
    selection_query_digest: execution.selection.queryDigest,
    selection_after_first_received_at: null,
    selection_after_receipt_id: null,
    selection_through_first_received_at: upper.mysqlReceivedAt,
    selection_through_receipt_id: upper.receiptId,
    selection_snapshot_at: snapshot.mysql,
    selection_digest: sealed.selectionDigest,
    maximum_selected_count: authorized.maximumSelectedCount,
    selected_receipt_count: sealed.selectedCount,
    requested_by_actor_id: authorized.requestedByActorId,
    requested_at: rfc3339ToMysql(authorized.requestedAt, driftError),
    authorized_by_actor_id: authorized.authorizedByActorId,
    authorized_at: rfc3339ToMysql(authorized.authorizedAt, driftError),
    authorization_ticket_digest: authorized.authorizationTicketDigest,
    maximum_authorization_ttl_seconds: 3600,
    authorization_expires_at: rfc3339ToMysql(
      authorized.authorizationExpiresAt,
      driftError
    ),
    lease_generation: 0,
    processed_receipt_count: 0,
    verified_receipt_count: 0,
    shadow_inserted_count: 0,
    shadow_replayed_count: 0,
    failed_receipt_count: 0,
    created_at: snapshot.mysql,
    updated_at: snapshot.mysql,
  });
}

function assertExactExpected(row, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) throw driftError();
  }
  return row;
}

function insertValues(row) {
  return [
    row.replay_run_id,
    row.replay_mode,
    row.reason_code,
    row.policy_registry_version,
    row.policy_registry_digest,
    row.policy_id,
    row.policy_version,
    row.policy_digest,
    row.consumer_name,
    row.source_name,
    row.event_type,
    row.schema_version,
    row.aggregate_type,
    row.source_receipt_status,
    row.source_handler_id,
    row.source_handler_version,
    row.source_handler_registry_version,
    row.source_handler_descriptor_digest,
    row.source_handler_source_digest,
    row.source_handler_registration_digest,
    row.execution_consumer_name,
    row.execution_handler_id,
    row.execution_handler_version,
    row.execution_executor_registry_version,
    row.execution_executor_registry_digest,
    row.execution_executor_descriptor_digest,
    row.execution_executor_source_digest,
    row.execution_executor_registration_digest,
    row.target_projection_policy,
    row.shadow_generation,
    row.cursor_version,
    row.selection_query_id,
    row.selection_query_digest,
    row.selection_after_first_received_at,
    row.selection_after_receipt_id,
    row.selection_through_first_received_at,
    row.selection_through_receipt_id,
    row.selection_snapshot_at,
    row.selection_digest,
    row.maximum_selected_count,
    row.selected_receipt_count,
    row.requested_by_actor_id,
    row.requested_at,
    row.authorized_by_actor_id,
    row.authorized_at,
    row.authorization_ticket_digest,
    row.maximum_authorization_ttl_seconds,
    row.authorization_expires_at,
    row.created_at,
    row.updated_at,
  ];
}

function createMysqlInboxReplayControl(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !OPTION_KEYS.includes(key))) throw configurationError();
  const pool = options.pool;
  const runtimeEnv = options.env === undefined ? process.env : options.env;
  if (!pool
    || typeof pool.getConnection !== "function"
    || (options.env !== undefined && !plainRecord(options.env))) throw configurationError();

  let registry;
  let policyState;
  let sourceRegistration;
  let executorRegistration;
  try {
    registry = getDefaultInboxReplayPolicyRegistry();
    registry.assertReady();
    policyState = registry.describe();
    sourceRegistration = assertResolvedInboxHandlerRegistration(
      getDefaultInboxHandlerRegistry().assertScope({
        consumerName: "task-share-completion-projection",
        handlerVersion: "task-share-completion-v1",
        sourceName: "myroot-api",
        eventType: "task.event.recorded.v1",
        schemaVersion: "1",
        aggregateType: "TASK_EVENT",
      })
    );
    executorRegistration = assertResolvedInboxReplayExecutorRegistration(
      getDefaultInboxReplayExecutorRegistry().resolve({
        executorId: "task-share-completion-shadow-v1",
        executorVersion: "task-share-shadow-v1",
        policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
        mode: "SHADOW_REBUILD",
      })
    );
  } catch {
    throw configurationError();
  }
  const enabled = runtimeEnv[ENABLE_FLAG] === "true";

  async function acquireConnection() {
    let connection;
    try { connection = await pool.getConnection(); } catch { throw persistenceError(); }
    if (!connection
      || typeof connection.execute !== "function"
      || typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function"
      || typeof connection.rollback !== "function"
      || typeof connection.release !== "function"
      || typeof connection.destroy !== "function") {
      try { if (connection && typeof connection.release === "function") connection.release(); } catch {}
      throw configurationError();
    }
    try {
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
    } catch {
      try { connection.destroy(); } catch {}
      throw persistenceError();
    }
    return connection;
  }

  function retire(connection, destroy) {
    try {
      if (destroy) connection.destroy();
      else connection.release();
      return true;
    } catch { return false; }
  }

  async function readRun(connection, replayRunId, lock = false) {
    const rows = selectedRows(await connection.execute(
      lock ? EXISTING_RUN_FOR_UPDATE_SQL : EXISTING_RUN_SQL,
      [replayRunId]
    ));
    if (rows.length > 1) throw persistenceError();
    return rows.length === 0 ? null : normalizeRunRow(rows[0]);
  }

  async function inspectRaw(replayRunId) {
    const connection = await acquireConnection();
    let destroy = false;
    try {
      return await readRun(connection, replayRunId, false);
    } catch (error) {
      destroy = true;
      if (error && error.code === "INBOX_REPLAY_CONTROL_PERSISTENCE_FAILED") throw error;
      throw persistenceError();
    } finally {
      retire(connection, destroy);
    }
  }

  function assertCurrentIdentity(row) {
    const policy = policyState.policies.find((entry) => entry.policyId === row.policy_id);
    const source = sourceRegistration.descriptor;
    if (!policy) throw driftError();
    const expected = {
      policy_registry_version: policyState.registryVersion,
      policy_registry_digest: policyState.registryDigest,
      policy_id: policy.policyId,
      policy_version: policy.policyVersion,
      policy_digest: policy.policyDigest,
      replay_mode: policy.mode,
      maximum_selected_count: policy.maximumSelectedCount,
      cursor_version: policy.selectionCursorType,
      selection_query_id: policy.selectionQueryId,
      selection_query_digest: policy.selectionQueryDigest,
      execution_consumer_name: executionConsumerName(
        policy.executionConsumerPrefix,
        row.replay_run_id
      ),
      execution_handler_id: policy.handlerId,
      execution_handler_version: policy.handlerVersion,
      execution_executor_registry_version: policy.executorRegistryVersion,
      execution_executor_registry_digest: policy.executorRegistryDigest,
      execution_executor_descriptor_digest: policy.executorDescriptorDigest,
      execution_executor_source_digest: policy.executorSourceDigest,
      execution_executor_registration_digest: policy.executorRegistrationDigest,
      target_projection_policy: policy.targetProjectionPolicy,
      consumer_name: source.consumerName,
      source_name: source.sourceName,
      event_type: source.eventType,
      schema_version: source.schemaVersion,
      aggregate_type: source.aggregateType,
      source_receipt_status: "SUCCEEDED",
      source_handler_id: source.handlerId,
      source_handler_version: source.handlerVersion,
      source_handler_registry_version: sourceRegistration.registryVersion,
      source_handler_descriptor_digest: source.descriptorDigest,
      source_handler_source_digest: source.sourceDigest,
      source_handler_registration_digest: sourceRegistration.registrationDigest,
    };
    if (row.replay_mode === "SHADOW_REBUILD") {
      expected.execution_executor_registry_version = executorRegistration.registryVersion;
      expected.execution_executor_registry_digest = executorRegistration.registryDigest;
      expected.execution_executor_descriptor_digest = executorRegistration.descriptor.descriptorDigest;
      expected.execution_executor_source_digest = executorRegistration.descriptor.sourceDigest;
      expected.execution_executor_registration_digest = executorRegistration.registrationDigest;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value) throw driftError();
    }
    return row;
  }

  async function inspect(input = {}) {
    if (!exactKeys(input, INSPECT_KEYS) || !opaqueAscii(input.replayRunId, 64)) {
      throw inputError();
    }
    const row = await inspectRaw(input.replayRunId);
    return row === null ? null : publicRun(assertCurrentIdentity(row));
  }

  async function verifyPersistedSelection(connection, row, authorized) {
    if (row.selection_after_first_received_at !== null
      || row.selection_after_receipt_id !== null) throw driftError();
    const snapshot = mysqlTemporal(row.selection_snapshot_at);
    const scope = authorized.sourceScope;
    const driftRows = selectedRows(await connection.execute(
      SOURCE_REGISTRATION_DRIFT_SQL,
      [
        scope.consumerName,
        scope.sourceName,
        scope.eventType,
        scope.schemaVersion,
        scope.aggregateType,
        scope.receiptStatus,
        snapshot.mysql,
        snapshot.mysql,
        scope.handlerId,
        scope.handlerVersion,
        scope.handlerRegistryVersion,
        scope.handlerDescriptorDigest,
        scope.handlerSourceDigest,
        scope.handlerRegistrationDigest,
      ]
    ));
    if (driftRows.length !== 1
      || !exactKeys(driftRows[0], ["registration_drift_count"])
      || integer(driftRows[0].registration_drift_count) !== 0) throw driftError();
    const sourceRows = selectedRows(await connection.execute(SOURCE_SELECTION_SQL, [
      scope.consumerName,
      scope.sourceName,
      scope.eventType,
      scope.schemaVersion,
      scope.aggregateType,
      scope.receiptStatus,
      scope.handlerId,
      scope.handlerVersion,
      scope.handlerRegistryVersion,
      scope.handlerDescriptorDigest,
      scope.handlerSourceDigest,
      scope.handlerRegistrationDigest,
      snapshot.mysql,
      snapshot.mysql,
      null,
      null,
      null,
      null,
      authorized.maximumSelectedCount + 1,
    ]));
    const selected = normalizeSourceRows(sourceRows, authorized.maximumSelectedCount);
    const upper = selected[selected.length - 1];
    const digest = selectionDigest({
      registryDigest: authorized.registryDigest,
      policyDigest: authorized.policyDigest,
      selectionQueryDigest: authorized.selectionQueryDigest,
      snapshotAt: snapshot.iso,
      lowerCursor: null,
      receipts: selected.map((cursor) => ({
        receivedAt: cursor.receivedAt,
        receiptId: cursor.receiptId,
      })),
    });
    if (row.selected_receipt_count !== selected.length
      || row.selection_digest !== digest
      || row.selection_through_first_received_at !== upper.mysqlReceivedAt
      || row.selection_through_receipt_id !== upper.receiptId) throw driftError();
  }

  async function prepare(input = {}) {
    if (!exactKeys(input, PREPARE_KEYS)) throw inputError();
    if (!enabled) throw disabledError();
    const authorization = normalizeAuthorization(input.authorization);
    let authorized;
    try { authorized = registry.authorize(authorization); } catch { throw inputError(); }

    const connection = await acquireConnection();
    let began = false;
    let destroy = false;
    let expected = null;
    let result = null;
    let committed = false;
    let retired = false;
    try {
      await connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.beginTransaction();
      began = true;

      const existing = await readRun(connection, authorized.replayRunId, true);
      if (existing) {
        assertRunMatchesAuthorization(existing, authorized);
        await verifyPersistedSelection(connection, existing, authorized);
        await connection.commit();
        committed = true;
        result = publicRun(existing);
        return result;
      }

      const snapshotRows = selectedRows(await connection.execute(SNAPSHOT_SQL));
      if (snapshotRows.length !== 1
        || !exactKeys(snapshotRows[0], ["selection_snapshot_at"])) throw persistenceError();
      const snapshot = mysqlTemporal(snapshotRows[0].selection_snapshot_at);
      const scope = authorized.sourceScope;
      const lowerCursor = null;
      const lowerMysql = null;
      const driftRows = selectedRows(await connection.execute(
        SOURCE_REGISTRATION_DRIFT_SQL,
        [
          scope.consumerName,
          scope.sourceName,
          scope.eventType,
          scope.schemaVersion,
          scope.aggregateType,
          scope.receiptStatus,
          snapshot.mysql,
          snapshot.mysql,
          scope.handlerId,
          scope.handlerVersion,
          scope.handlerRegistryVersion,
          scope.handlerDescriptorDigest,
          scope.handlerSourceDigest,
          scope.handlerRegistrationDigest,
        ]
      ));
      if (driftRows.length !== 1
        || !exactKeys(driftRows[0], ["registration_drift_count"])) throw persistenceError();
      if (integer(driftRows[0].registration_drift_count) !== 0) throw driftError();
      const sourceRows = selectedRows(await connection.execute(SOURCE_SELECTION_SQL, [
        scope.consumerName,
        scope.sourceName,
        scope.eventType,
        scope.schemaVersion,
        scope.aggregateType,
        scope.receiptStatus,
        scope.handlerId,
        scope.handlerVersion,
        scope.handlerRegistryVersion,
        scope.handlerDescriptorDigest,
        scope.handlerSourceDigest,
        scope.handlerRegistrationDigest,
        snapshot.mysql,
        snapshot.mysql,
        lowerMysql,
        lowerMysql,
        lowerMysql,
        null,
        authorized.maximumSelectedCount + 1,
      ]));
      const selected = normalizeSourceRows(sourceRows, authorized.maximumSelectedCount);
      const upper = selected[selected.length - 1];
      const digest = selectionDigest({
        registryDigest: authorized.registryDigest,
        policyDigest: authorized.policyDigest,
        selectionQueryDigest: authorized.selectionQueryDigest,
        snapshotAt: snapshot.iso,
        lowerCursor,
        receipts: selected.map((cursor) => ({
          receivedAt: cursor.receivedAt,
          receiptId: cursor.receiptId,
        })),
      });
      let sealed;
      let execution;
      try {
        sealed = registry.sealSelection({
          authorizedPolicy: authorized,
          selectionSnapshotAt: snapshot.iso,
          lowerCursor,
          upperCursor: {
            receivedAt: upper.receivedAt,
            receiptId: upper.receiptId,
          },
          selectedCount: selected.length,
          selectionDigest: digest,
          selectionQueryDigest: authorized.selectionQueryDigest,
        });
        execution = registry.resolveExecution({ sealedSelection: sealed });
      } catch {
        throw selectionError();
      }
      if (execution.allowsOutbox !== false || execution.allowsNetwork !== false) {
        throw driftError();
      }

      let shadowGeneration = null;
      if (execution.mode === "SHADOW_REBUILD") {
        const generationRows = selectedRows(await connection.execute(
          NEXT_SHADOW_GENERATION_SQL,
          [scope.consumerName, scope.sourceName, scope.handlerId]
        ));
        if (generationRows.length !== 1
          || !exactKeys(generationRows[0], ["shadow_generation"])) {
          throw persistenceError();
        }
        shadowGeneration = integer(generationRows[0].shadow_generation, 2);
      }

      expected = buildExpectedRun({
        authorized,
        execution,
        sealed,
        snapshot,
        upper,
        shadowGeneration,
      });
      if (affectedRows(await connection.execute(INSERT_RUN_SQL, insertValues(expected))) !== 1) {
        throw persistenceError();
      }
      const inserted = await readRun(connection, authorized.replayRunId, true);
      if (!inserted) throw persistenceError();
      assertExactExpected(inserted, expected);
      result = publicRun(inserted);
      await connection.commit();
      committed = true;
      return result;
    } catch (error) {
      destroy = true;
      if (began && !committed) {
        try { await connection.rollback(); } catch {}
      }
      const retiredBeforeReadback = retire(connection, true);
      retired = true;
      if (!retiredBeforeReadback) throw persistenceError();
      if (expected) {
        try {
          const converged = await inspectRaw(expected.replay_run_id);
          if (converged) {
            assertExactExpected(converged, expected);
            return publicRun(converged);
          }
        } catch {}
      }
      if (error && [
        "INBOX_REPLAY_CONTROL_INPUT_INVALID",
        "INBOX_REPLAY_CONTROL_DISABLED",
        "INBOX_REPLAY_CONTROL_SELECTION_INVALID",
        "INBOX_REPLAY_CONTROL_DRIFT",
      ].includes(error.code)) throw error;
      throw persistenceError();
    } finally {
      if (!retired) retire(connection, destroy && !committed);
    }
  }

  return Object.freeze({ prepare, inspect });
}

module.exports = {
  createMysqlInboxReplayControl,
};
