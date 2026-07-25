const crypto = require("node:crypto");

const {
  assertProductionMigrationContractRegistry,
  getDefaultMigrationContractRegistry,
} = require("./migrationContractRegistry");
const taskShareContract = require("./migrationContracts/taskShareSyntheticV1");

const ENABLE_FLAG = "MYROOT_MIGRATION_EXECUTION_FOUNDATION_ENABLED";
const ENVIRONMENT_FLAG = "MYROOT_MIGRATION_EXECUTION_ENVIRONMENT";
const MYSQL_SESSION_TIME_ZONE = "+08:00";
const MAX_LEASE_SECONDS = 300;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
const OPTION_KEYS = Object.freeze(["env", "pool"]);
const OPEN_KEYS = Object.freeze([
  "migrationRunId", "contractId", "mode", "requestId", "snapshotId",
  "snapshotRevision", "snapshotAt", "targetSchemaVersion", "replaySourceRunId",
  "replaySourceResultDigest", "replayThroughCursorValue", "replayThroughTieBreaker",
]);
const BATCH_KEYS = Object.freeze([
  "migrationRunId", "leaseOwner", "leaseSeconds", "batchId", "requestId",
]);
const VERIFY_KEYS = Object.freeze([
  "migrationRunId", "leaseOwner", "leaseSeconds", "requestId",
]);
const INSPECT_KEYS = Object.freeze(["migrationRunId"]);

const CONTRACT_COLUMNS = `
  contract_id, contract_version, registry_version, registry_digest, fact_type,
  authoritative_source, source_type, source_query_id, source_query_digest,
  source_adapter_id, source_adapter_digest, target_type,
  target_schema_version, target_adapter_id, target_adapter_digest,
  parity_adapter_id, parity_adapter_digest, cursor_type, inclusive,
  maximum_batch_size, allows_network, allows_outbox, contract_digest, status`;
const RUN_COLUMNS = `
  migration_run_id, registry_version, registry_digest, contract_id,
  contract_version, contract_digest, migration_mode, status, request_id,
  snapshot_id, snapshot_revision,
  LEFT(DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS snapshot_at_wall_time,
  source_query_id, source_query_digest, source_adapter_digest,
  target_adapter_digest, parity_adapter_digest, target_schema_version,
  replay_source_run_id, replay_source_result_digest,
  replay_through_cursor_value, replay_through_tie_breaker,
  cursor_type, cursor_value, cursor_tie_breaker, inclusive,
  last_contiguous_cursor_value, last_contiguous_tie_breaker,
  lease_owner,
  LEFT(DATE_FORMAT(lease_expires_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS lease_expires_at_wall_time,
  lease_generation, transition_id, processed_count, migrated_count,
  idempotent_count, conflict_count, quarantined_count, review_required_count,
  batch_count, result_digest, last_error_code,
  LEFT(DATE_FORMAT(opened_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS opened_at_wall_time,
  LEFT(DATE_FORMAT(verified_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS verified_at_wall_time,
  LEFT(DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS completed_at_wall_time`;

const SELECT_CONTRACT_SQL = `/* migration-execution:contract-read */
SELECT ${CONTRACT_COLUMNS}
FROM migration_contract_registry
WHERE contract_id = ? AND contract_version = ?
LIMIT 1 FOR UPDATE`;
const INSERT_CONTRACT_SQL = `/* migration-execution:contract-insert */
INSERT INTO migration_contract_registry (
  contract_id, contract_version, registry_version, registry_digest, fact_type,
  authoritative_source, source_type, source_query_id, source_query_digest,
  source_adapter_id, source_adapter_digest, target_type,
  target_schema_version, target_adapter_id, target_adapter_digest,
  parity_adapter_id, parity_adapter_digest, cursor_type, inclusive,
  maximum_batch_size, allows_network, allows_outbox, contract_digest, status,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
const READ_RUN_SQL = `/* migration-execution:run-read */
SELECT ${RUN_COLUMNS},
  LEFT(DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f'), 23) AS db_now
FROM migration_run WHERE migration_run_id = ? LIMIT 1`;
const LOCK_RUN_SQL = `${READ_RUN_SQL} FOR UPDATE`;
const FIND_RUN_SQL = `/* migration-execution:run-find */
SELECT ${RUN_COLUMNS},
  LEFT(DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f'), 23) AS db_now
FROM migration_run
WHERE migration_run_id = ? OR (contract_id = ? AND request_id = ?)
ORDER BY migration_run_id LIMIT 2 FOR UPDATE`;
const INSERT_RUN_SQL = `/* migration-execution:run-insert */
INSERT INTO migration_run (
  migration_run_id, registry_version, registry_digest, contract_id,
  contract_version, contract_digest, migration_mode, status, request_id,
  snapshot_id, snapshot_revision, snapshot_at, source_query_id,
  source_query_digest, source_adapter_digest, target_adapter_digest,
  parity_adapter_digest, target_schema_version, cursor_type, cursor_value,
  cursor_tie_breaker, inclusive, last_contiguous_cursor_value,
  last_contiguous_tie_breaker, lease_owner, lease_expires_at,
  lease_generation, transition_id, processed_count, migrated_count,
  idempotent_count, conflict_count, quarantined_count, review_required_count,
  batch_count, result_digest, last_error_code, opened_at, verified_at,
  completed_at, replay_source_run_id, replay_source_result_digest,
  replay_through_cursor_value, replay_through_tie_breaker, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, NULL, NULL, 0, ?, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, CURRENT_TIMESTAMP(3), NULL, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
const CLAIM_RUN_SQL = `/* migration-execution:run-claim */
UPDATE migration_run
SET status = 'RUNNING', lease_owner = ?,
    lease_expires_at = TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)),
    lease_generation = lease_generation + 1,
    transition_id = ?, updated_at = CURRENT_TIMESTAMP(3)
WHERE migration_run_id = ?
  AND (
    status IN ('OPEN', 'PARITY_PENDING')
    OR (status = 'RUNNING' AND lease_expires_at <= CURRENT_TIMESTAMP(3))
  )`;
const READ_LINEAGE_SQL = `/* migration-execution:lineage-read */
SELECT * FROM migration_lineage
WHERE lineage_identity = ?
ORDER BY event_sequence ASC, migration_lineage_id ASC
FOR UPDATE`;
const INSERT_LINEAGE_SQL = `/* migration-execution:lineage-insert */
INSERT INTO migration_lineage (
  migration_lineage_id, base_lineage_identity, lineage_identity,
  lineage_event_type, event_sequence, migration_run_id, contract_id,
  contract_version, fact_type, source_type, source_id, target_type,
  target_id, source_checksum, target_checksum, snapshot_id,
  snapshot_revision, batch_id, request_id, cursor_type, cursor_value,
  tie_breaker, inclusive, target_schema_version, status, error_code,
  replayed_at, reversed_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP(3))`;
const FINISH_BATCH_SQL = `/* migration-execution:batch-finish */
UPDATE migration_run
SET status = ?, cursor_value = ?, cursor_tie_breaker = ?,
    last_contiguous_cursor_value = ?, last_contiguous_tie_breaker = ?,
    lease_owner = NULL, lease_expires_at = NULL,
    processed_count = processed_count + ?, migrated_count = migrated_count + ?,
    idempotent_count = idempotent_count + ?, conflict_count = conflict_count + ?,
    quarantined_count = quarantined_count + ?,
    review_required_count = review_required_count + ?,
    batch_count = batch_count + 1, result_digest = ?, last_error_code = ?,
    transition_id = ?, completed_at = CASE WHEN ? = 'REVIEW_REQUIRED' THEN CURRENT_TIMESTAMP(3) ELSE completed_at END,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE migration_run_id = ? AND status = 'RUNNING' AND lease_owner = ?
  AND lease_generation = ? AND transition_id = ?
  AND lease_expires_at > CURRENT_TIMESTAMP(3)`;
const VERIFY_FINISH_SQL = `/* migration-execution:verify-finish */
UPDATE migration_run
SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
    result_digest = ?, last_error_code = ?, transition_id = ?,
    verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,
    completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
WHERE migration_run_id = ? AND status = 'RUNNING' AND lease_owner = ?
  AND lease_generation = ? AND transition_id = ?
  AND lease_expires_at > CURRENT_TIMESTAMP(3)`;
const DRY_RUN_PARITY_SQL = `/* migration-execution:dry-run-parity-read */
SELECT
  COUNT(*) AS lineage_count,
  SUM(CASE WHEN status = 'DRY_RUN_VERIFIED' THEN 0 ELSE 1 END) AS mismatch_count
FROM migration_lineage
WHERE migration_run_id = ?
  AND status = 'DRY_RUN_VERIFIED'`;

function foundationError(code) {
  const error = new Error("migration execution foundation could not complete the operation");
  error.code = code;
  Object.defineProperty(error, "isMigrationExecutionFoundationError", { value: true });
  return error;
}
function configurationError() { return foundationError("MIGRATION_EXECUTION_CONFIGURATION_INVALID"); }
function inputError() { return foundationError("MIGRATION_EXECUTION_INPUT_INVALID"); }
function disabledError() { return foundationError("MIGRATION_EXECUTION_DISABLED"); }
function persistenceError() { return foundationError("MIGRATION_EXECUTION_PERSISTENCE_FAILED"); }
function identityError() { return foundationError("MIGRATION_EXECUTION_IDENTITY_DRIFT"); }
function leaseError() { return foundationError("MIGRATION_EXECUTION_LEASE_UNAVAILABLE"); }
function ackUnknownError() { return foundationError("MIGRATION_EXECUTION_ACK_UNKNOWN"); }

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function opaque(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
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
function integer(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw persistenceError();
  return normalized;
}
function bool(value) {
  if (value === false || value === 0 || value === "0") return false;
  if (value === true || value === 1 || value === "1") return true;
  throw persistenceError();
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
    .update(`${domain}\0`, "utf8").update(canonicalJson(value), "utf8").digest("hex");
}
function transitionId(kind, runId) {
  return `${kind}_${crypto.createHash("sha256")
    .update("myroot-migration-transition:v1\0", "utf8")
    .update(`${runId}\0${crypto.randomBytes(32).toString("hex")}`, "utf8")
    .digest("hex").slice(0, 48)}`;
}
function mysqlFromIso(value) {
  if (typeof value !== "string" || !RFC3339_MILLIS_PATTERN.test(value)
    || new Date(value).toISOString() !== value) throw inputError();
  return new Date(Date.parse(value) + 8 * 60 * 60 * 1_000)
    .toISOString().slice(0, 23).replace("T", " ");
}
function assertMysqlDatetime(value) {
  if (typeof value !== "string" || !MYSQL_DATETIME_PATTERN.test(value)) throw persistenceError();
  return value;
}
function contractValues(registration) {
  const d = registration.descriptor;
  return [
    d.contractId, d.contractVersion, registration.registryVersion,
    registration.registryDigest, d.factType, d.authoritativeSource, d.sourceType,
    d.sourceQueryId, d.sourceQueryDigest, d.sourceAdapterId,
    d.sourceAdapterDigest, d.targetType, d.targetSchemaVersion,
    d.targetAdapterId, d.targetAdapterDigest, d.parityAdapterId,
    d.parityAdapterDigest, d.cursorType, d.inclusive, d.maximumBatchSize,
    d.allowsNetwork, d.allowsOutbox, d.contractDigest,
  ];
}
function assertContractRow(row, registration) {
  const d = registration.descriptor;
  const expected = {
    contract_id: d.contractId,
    contract_version: d.contractVersion,
    registry_version: registration.registryVersion,
    registry_digest: registration.registryDigest,
    fact_type: d.factType,
    authoritative_source: d.authoritativeSource,
    source_type: d.sourceType,
    source_query_id: d.sourceQueryId,
    source_query_digest: d.sourceQueryDigest,
    source_adapter_id: d.sourceAdapterId,
    source_adapter_digest: d.sourceAdapterDigest,
    target_type: d.targetType,
    target_schema_version: d.targetSchemaVersion,
    target_adapter_id: d.targetAdapterId,
    target_adapter_digest: d.targetAdapterDigest,
    parity_adapter_id: d.parityAdapterId,
    parity_adapter_digest: d.parityAdapterDigest,
    cursor_type: d.cursorType,
    maximum_batch_size: d.maximumBatchSize,
    contract_digest: d.contractDigest,
    status: "ACTIVE",
  };
  if (!plainRecord(row) || Object.entries(expected).some(([key, value]) => (
    typeof value === "number" ? Number(row[key]) !== value : row[key] !== value
  )) || bool(row.inclusive) !== false || bool(row.allows_network) !== false
    || bool(row.allows_outbox) !== false) throw identityError();
}
function assertRunIdentity(row, registration) {
  const d = registration.descriptor;
  if (!plainRecord(row)
    || Number(row.registry_version) !== registration.registryVersion
    || row.registry_digest !== registration.registryDigest
    || row.contract_id !== d.contractId
    || Number(row.contract_version) !== d.contractVersion
    || row.contract_digest !== d.contractDigest
    || row.source_query_id !== d.sourceQueryId
    || row.source_query_digest !== d.sourceQueryDigest
    || row.source_adapter_digest !== d.sourceAdapterDigest
    || row.target_adapter_digest !== d.targetAdapterDigest
    || row.parity_adapter_digest !== d.parityAdapterDigest
    || row.target_schema_version !== d.targetSchemaVersion
    || row.cursor_type !== d.cursorType
    || bool(row.inclusive) !== false) throw identityError();
}
function normalizeRun(row, registration) {
  assertRunIdentity(row, registration);
  if (!opaque(row.migration_run_id, 64)
    || !["DRY_RUN", "APPLY", "FORWARD_REPLAY"].includes(row.migration_mode)
    || !["OPEN", "RUNNING", "PARITY_PENDING", "VERIFIED", "REVIEW_REQUIRED", "FAILED", "ACK_UNKNOWN"].includes(row.status)
    || !opaque(row.request_id, 128) || !opaque(row.snapshot_id, 128)
    || !opaque(row.snapshot_revision, 128)
    || !assertMysqlDatetime(row.snapshot_at_wall_time)) throw persistenceError();
  const replayFields = [
    row.replay_source_run_id, row.replay_source_result_digest,
    row.replay_through_cursor_value, row.replay_through_tie_breaker,
  ];
  if ((row.migration_mode === "FORWARD_REPLAY" && (
    !opaque(row.replay_source_run_id, 64)
    || !SHA256_PATTERN.test(row.replay_source_result_digest)
    || !MYSQL_DATETIME_PATTERN.test(row.replay_through_cursor_value)
    || !opaque(row.replay_through_tie_breaker, 128)
  )) || (row.migration_mode !== "FORWARD_REPLAY"
    && replayFields.some((value) => value !== null))) throw identityError();
  ["processed_count", "migrated_count", "idempotent_count", "conflict_count",
    "quarantined_count", "review_required_count", "batch_count", "lease_generation"]
    .forEach((field) => integer(row[field]));
  if (row.result_digest !== null && !SHA256_PATTERN.test(row.result_digest)) throw persistenceError();
  return row;
}
function publicRun(row, registration) {
  const run = normalizeRun(row, registration);
  return Object.freeze({
    migrationRunId: run.migration_run_id,
    contractId: run.contract_id,
    mode: run.migration_mode,
    status: run.status,
    snapshotId: run.snapshot_id,
    snapshotRevision: run.snapshot_revision,
    targetSchemaVersion: run.target_schema_version,
    replaySource: run.replay_source_run_id === null ? null : Object.freeze({
      migrationRunId: run.replay_source_run_id,
      resultDigest: run.replay_source_result_digest,
      throughCursor: Object.freeze({
        cursorType: run.cursor_type,
        cursorValue: run.replay_through_cursor_value,
        tieBreaker: run.replay_through_tie_breaker,
        inclusive: true,
      }),
    }),
    cursor: run.cursor_value === null ? null : Object.freeze({
      cursorType: run.cursor_type,
      cursorValue: run.cursor_value,
      tieBreaker: run.cursor_tie_breaker,
      inclusive: false,
    }),
    counts: Object.freeze({
      processed: integer(run.processed_count),
      migrated: integer(run.migrated_count),
      idempotent: integer(run.idempotent_count),
      conflict: integer(run.conflict_count),
      quarantined: integer(run.quarantined_count),
      reviewRequired: integer(run.review_required_count),
      batches: integer(run.batch_count),
    }),
    resultDigest: run.result_digest,
    lastErrorCode: run.last_error_code,
    identityStatus: "CURRENT",
  });
}
function exactOpenInput(input) {
  if (!exactKeys(input, OPEN_KEYS) || !opaque(input.migrationRunId, 64)
    || input.contractId !== taskShareContract.descriptor.contractId
    || !["DRY_RUN", "APPLY", "FORWARD_REPLAY"].includes(input.mode)
    || !opaque(input.requestId, 128) || !opaque(input.snapshotId, 128)
    || !opaque(input.snapshotRevision, 128)
    || input.targetSchemaVersion !== taskShareContract.descriptor.targetSchemaVersion) throw inputError();
  const snapshot = mysqlFromIso(input.snapshotAt);
  if ((input.mode === "FORWARD_REPLAY" && (
    !opaque(input.replaySourceRunId, 64)
    || input.replaySourceRunId === input.migrationRunId
    || !SHA256_PATTERN.test(input.replaySourceResultDigest)
    || !MYSQL_DATETIME_PATTERN.test(input.replayThroughCursorValue)
    || !opaque(input.replayThroughTieBreaker, 128)
    || input.replayThroughCursorValue !== snapshot
  )) || (input.mode !== "FORWARD_REPLAY" && [
    input.replaySourceRunId, input.replaySourceResultDigest,
    input.replayThroughCursorValue, input.replayThroughTieBreaker,
  ].some((value) => value !== null))) throw inputError();
}
function exactLeaseInput(input, keys) {
  if (!exactKeys(input, keys) || !opaque(input.migrationRunId, 64)
    || !opaque(input.leaseOwner, 128)
    || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 1
    || input.leaseSeconds > MAX_LEASE_SECONDS || !opaque(input.requestId, 128)) throw inputError();
  if (keys === BATCH_KEYS && !opaque(input.batchId, 128)) throw inputError();
}
function exactExistingOpen(run, input) {
  return run.migration_run_id === input.migrationRunId
    && run.contract_id === input.contractId && run.migration_mode === input.mode
    && run.request_id === input.requestId && run.snapshot_id === input.snapshotId
    && run.snapshot_revision === input.snapshotRevision
    && run.snapshot_at_wall_time === mysqlFromIso(input.snapshotAt)
    && run.target_schema_version === input.targetSchemaVersion
    && run.replay_source_run_id === input.replaySourceRunId
    && run.replay_source_result_digest === input.replaySourceResultDigest
    && run.replay_through_cursor_value === input.replayThroughCursorValue
    && run.replay_through_tie_breaker === input.replayThroughTieBreaker;
}

function cursorAfter(leftValue, leftTie, rightValue, rightTie) {
  return leftValue > rightValue || (leftValue === rightValue && leftTie > rightTie);
}
function lineageIdentity(descriptor, source) {
  return digest("myroot-migration-lineage-identity:v1", {
    contractId: descriptor.contractId,
    sourceType: source.fact.sourceType,
    sourceId: source.fact.sourceId,
    targetType: descriptor.targetType,
    targetSchemaVersion: descriptor.targetSchemaVersion,
  });
}
function exactBaseLineage(row, run, descriptor, source, target) {
  return plainRecord(row) && row.lineage_event_type === "MIGRATION"
    && row.base_lineage_identity === row.lineage_identity
    && row.contract_id === descriptor.contractId
    && Number(row.contract_version) === descriptor.contractVersion
    && row.fact_type === descriptor.factType && row.source_type === source.fact.sourceType
    && row.source_id === source.fact.sourceId && row.target_type === descriptor.targetType
    && row.target_id === target.targetRecordId
    && row.source_checksum === source.sourceChecksum
    && row.target_checksum === target.targetChecksum
    && row.target_schema_version === descriptor.targetSchemaVersion;
}
function lineageId(identity, sequence, eventType, requestId) {
  return `mln_${digest("myroot-migration-lineage-event-id:v1", {
    identity, sequence, eventType, requestId,
  }).slice(0, 60)}`;
}

function createMysqlMigrationExecutionFoundation(options = {}) {
  if (!exactKeys(options, OPTION_KEYS) || !options.pool
    || typeof options.pool.getConnection !== "function" || !plainRecord(options.env)) {
    throw configurationError();
  }
  const { pool, env } = options;
  const enabled = env[ENABLE_FLAG] === "true";
  if (enabled && (env[ENVIRONMENT_FLAG] !== "LOCAL_ISOLATED" || env.NODE_ENV === "production")) {
    throw configurationError();
  }
  const registry = assertProductionMigrationContractRegistry(
    getDefaultMigrationContractRegistry()
  );
  const registration = registry.assertScope({
    contractId: taskShareContract.descriptor.contractId,
    targetSchemaVersion: taskShareContract.descriptor.targetSchemaVersion,
  });
  if (canonicalJson(registration.descriptor) !== canonicalJson(taskShareContract.descriptor)) {
    throw configurationError();
  }

  async function acquire() {
    let connection;
    try {
      connection = await pool.getConnection();
      if (!connection || typeof connection.execute !== "function"
        || typeof connection.beginTransaction !== "function"
        || typeof connection.commit !== "function"
        || typeof connection.rollback !== "function") throw persistenceError();
      await connection.execute("SET time_zone = ?", [MYSQL_SESSION_TIME_ZONE]);
      return connection;
    } catch (error) {
      if (connection) retire(connection, true);
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    }
  }
  function retire(connection, destroy) {
    try {
      if (destroy && typeof connection.destroy === "function") connection.destroy();
      else if (typeof connection.release === "function") connection.release();
    } catch {}
  }
  async function readRun(connection, migrationRunId, lock = false) {
    const rows = selectedRows(await connection.execute(lock ? LOCK_RUN_SQL : READ_RUN_SQL, [migrationRunId]));
    if (rows.length !== 1) throw persistenceError();
    return normalizeRun(rows[0], registration);
  }
  async function ensureContract(connection) {
    let rows = selectedRows(await connection.execute(SELECT_CONTRACT_SQL, [
      registration.descriptor.contractId, registration.descriptor.contractVersion,
    ]));
    if (rows.length > 1) throw identityError();
    if (rows.length === 0) {
      if (affectedRows(await connection.execute(INSERT_CONTRACT_SQL, contractValues(registration))) !== 1) {
        throw persistenceError();
      }
      rows = selectedRows(await connection.execute(SELECT_CONTRACT_SQL, [
        registration.descriptor.contractId, registration.descriptor.contractVersion,
      ]));
    }
    if (rows.length !== 1) throw persistenceError();
    assertContractRow(rows[0], registration);
  }

  async function assertReplaySourceRun(connection, binding) {
    const sourceRun = await readRun(connection, binding.sourceRunId, true);
    if (sourceRun.migration_mode !== "APPLY" || sourceRun.status !== "VERIFIED"
      || sourceRun.result_digest !== binding.sourceResultDigest
      || sourceRun.cursor_value === null || sourceRun.cursor_tie_breaker === null
      || !cursorAfter(
        binding.throughCursorValue,
        binding.throughTieBreaker,
        sourceRun.cursor_value,
        sourceRun.cursor_tie_breaker
      )) throw identityError();
    return sourceRun;
  }
  function assertEnabled() { if (!enabled) throw disabledError(); }

  async function inspect(input = {}) {
    if (!exactKeys(input, INSPECT_KEYS) || !opaque(input.migrationRunId, 64)) throw inputError();
    assertEnabled();
    const connection = await acquire();
    let destroy = false;
    try {
      const contractRows = selectedRows(await connection.execute(SELECT_CONTRACT_SQL, [
        registration.descriptor.contractId, registration.descriptor.contractVersion,
      ]));
      if (contractRows.length !== 1) throw identityError();
      assertContractRow(contractRows[0], registration);
      return publicRun(await readRun(connection, input.migrationRunId), registration);
    } catch (error) {
      destroy = true;
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    } finally { retire(connection, destroy); }
  }

  async function inspectFreshRun(migrationRunId) {
    const connection = await acquire();
    let destroy = false;
    try {
      const contractRows = selectedRows(await connection.execute(SELECT_CONTRACT_SQL, [
        registration.descriptor.contractId, registration.descriptor.contractVersion,
      ]));
      if (contractRows.length !== 1) throw identityError();
      assertContractRow(contractRows[0], registration);
      return await readRun(connection, migrationRunId);
    } catch (error) {
      destroy = true;
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    } finally { retire(connection, destroy); }
  }

  async function openRun(input = {}) {
    exactOpenInput(input);
    assertEnabled();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let retired = false;
    const openTransition = transitionId("open", input.migrationRunId);
    try {
      await connection.beginTransaction();
      began = true;
      await ensureContract(connection);
      let rows = selectedRows(await connection.execute(FIND_RUN_SQL, [
        input.migrationRunId, input.contractId, input.requestId,
      ]));
      if (rows.length > 1) throw identityError();
      if (rows.length === 0) {
        const d = registration.descriptor;
        let initialCursorValue = null;
        let initialTieBreaker = null;
        if (input.mode === "FORWARD_REPLAY") {
          const sourceRun = await assertReplaySourceRun(connection, {
            sourceRunId: input.replaySourceRunId,
            sourceResultDigest: input.replaySourceResultDigest,
            throughCursorValue: input.replayThroughCursorValue,
            throughTieBreaker: input.replayThroughTieBreaker,
          });
          initialCursorValue = sourceRun.cursor_value;
          initialTieBreaker = sourceRun.cursor_tie_breaker;
        }
        const values = [
          input.migrationRunId, registration.registryVersion, registration.registryDigest,
          d.contractId, d.contractVersion, d.contractDigest, input.mode, input.requestId,
          input.snapshotId, input.snapshotRevision, mysqlFromIso(input.snapshotAt),
          d.sourceQueryId, d.sourceQueryDigest, d.sourceAdapterDigest,
          d.targetAdapterDigest, d.parityAdapterDigest, d.targetSchemaVersion,
          d.cursorType, initialCursorValue, initialTieBreaker,
          initialCursorValue, initialTieBreaker, openTransition,
          input.replaySourceRunId, input.replaySourceResultDigest,
          input.replayThroughCursorValue, input.replayThroughTieBreaker,
        ];
        if (affectedRows(await connection.execute(INSERT_RUN_SQL, values)) !== 1) {
          throw persistenceError();
        }
        rows = [await readRun(connection, input.migrationRunId, true)];
      }
      const run = normalizeRun(rows[0], registration);
      if (!exactExistingOpen(run, input)) throw identityError();
      if (run.migration_mode === "FORWARD_REPLAY") {
        await assertReplaySourceRun(connection, {
          sourceRunId: run.replay_source_run_id,
          sourceResultDigest: run.replay_source_result_digest,
          throughCursorValue: run.replay_through_cursor_value,
          throughTieBreaker: run.replay_through_tie_breaker,
        });
      }
      commitAttempted = true;
      await connection.commit();
      retire(connection, false);
      retired = true;
      return publicRun(run, registration);
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      retire(connection, true);
      retired = true;
      if (commitAttempted) {
        try {
          const converged = await inspectFreshRun(input.migrationRunId);
          if (exactExistingOpen(converged, input)
            && converged.transition_id === openTransition) {
            return publicRun(converged, registration);
          }
        } catch {}
        throw ackUnknownError();
      }
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    } finally { if (!retired) retire(connection, !commitAttempted); }
  }

  async function claim(connection, input, expectedModes, allowedStatuses) {
    const current = await readRun(connection, input.migrationRunId, true);
    if (!expectedModes.includes(current.migration_mode)) throw inputError();
    if (["VERIFIED", "REVIEW_REQUIRED", "FAILED", "ACK_UNKNOWN"].includes(current.status)) {
      return Object.freeze({ done: true, run: current });
    }
    if (!allowedStatuses.includes(current.status)
      && !(current.status === "RUNNING" && current.lease_expires_at_wall_time <= current.db_now)) {
      throw leaseError();
    }
    const claimTransition = transitionId("claim", input.migrationRunId);
    if (affectedRows(await connection.execute(CLAIM_RUN_SQL, [
      input.leaseOwner, input.leaseSeconds, claimTransition, input.migrationRunId,
    ])) !== 1) throw leaseError();
    const claimed = await readRun(connection, input.migrationRunId, true);
    if (claimed.status !== "RUNNING" || claimed.lease_owner !== input.leaseOwner
      || claimed.transition_id !== claimTransition) throw leaseError();
    return Object.freeze({ done: false, run: claimed, claimTransition });
  }

  async function insertLineage(connection, context) {
    const replayedAt = context.replayed ? context.dbNow : null;
    const values = [
      lineageId(context.identity, context.sequence, context.eventType, context.requestId),
      context.eventType === "MIGRATION" ? context.identity : null,
      context.identity, context.eventType, context.sequence,
      context.run.migration_run_id, registration.descriptor.contractId,
      registration.descriptor.contractVersion, registration.descriptor.factType,
      context.source.fact.sourceType, context.source.fact.sourceId,
      registration.descriptor.targetType, context.target.targetRecordId,
      context.source.sourceChecksum, context.target.targetChecksum,
      context.run.snapshot_id, context.run.snapshot_revision, context.batchId,
      context.requestId, context.source.cursor.cursorType,
      context.source.cursor.cursorValue, context.source.cursor.tieBreaker,
      registration.descriptor.targetSchemaVersion, context.status,
      context.errorCode, replayedAt,
    ];
    if (affectedRows(await connection.execute(INSERT_LINEAGE_SQL, values)) !== 1) {
      throw persistenceError();
    }
  }

  async function runBatch(input, expectedMode) {
    exactLeaseInput(input, BATCH_KEYS);
    assertEnabled();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let retired = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      await ensureContract(connection);
      const claimState = await claim(
        connection,
        input,
        expectedMode === "FORWARD_REPLAY" ? ["FORWARD_REPLAY"] : ["DRY_RUN", "APPLY"],
        ["OPEN"]
      );
      if (claimState.done) {
        commitAttempted = true;
        await connection.commit();
        retire(connection, false);
        retired = true;
        return publicRun(claimState.run, registration);
      }
      const run = claimState.run;
      const d = registration.descriptor;
      if (run.migration_mode === "FORWARD_REPLAY") {
        await assertReplaySourceRun(connection, {
          sourceRunId: run.replay_source_run_id,
          sourceResultDigest: run.replay_source_result_digest,
          throughCursorValue: run.replay_through_cursor_value,
          throughTieBreaker: run.replay_through_tie_breaker,
        });
      }
      const lower = run.cursor_value;
      const rows = selectedRows(await connection.execute(taskShareContract.statements.sourceRead, [
        run.snapshot_at_wall_time, lower, lower, lower, run.cursor_tie_breaker,
        run.replay_through_cursor_value, run.replay_through_cursor_value,
        run.replay_through_cursor_value, run.replay_through_tie_breaker,
        d.maximumBatchSize,
      ]));
      if (rows.length > d.maximumBatchSize) throw persistenceError();
      const counts = { processed: 0, migrated: 0, idempotent: 0, conflict: 0, quarantined: 0, reviewRequired: 0 };
      const outcomes = [];
      let lastGood = lower === null ? null : {
        cursorValue: run.cursor_value,
        tieBreaker: run.cursor_tie_breaker,
      };
      let blockedError = null;
      let priorCursor = lastGood;
      for (const row of rows) {
        let source;
        try { source = taskShareContract.normalizeSource(row); } catch {
          blockedError = "SOURCE_DRIFT";
          counts.processed += 1;
          counts.reviewRequired += 1;
          break;
        }
        if ((priorCursor && (
          source.cursor.cursorValue < priorCursor.cursorValue
          || (source.cursor.cursorValue === priorCursor.cursorValue
            && source.cursor.tieBreaker <= priorCursor.tieBreaker)
        )) || source.cursor.cursorValue > run.snapshot_at_wall_time
          || (run.migration_mode === "FORWARD_REPLAY" && cursorAfter(
            source.cursor.cursorValue,
            source.cursor.tieBreaker,
            run.replay_through_cursor_value,
            run.replay_through_tie_breaker
          ))) {
          blockedError = "SOURCE_DRIFT";
          counts.processed += 1;
          counts.reviewRequired += 1;
          break;
        }
        priorCursor = source.cursor;
        const target = taskShareContract.targetRecord(source);
        const identity = lineageIdentity(d, source);
        const lineageRows = selectedRows(await connection.execute(READ_LINEAGE_SQL, [identity]));
        const base = lineageRows.find((item) => item.lineage_event_type === "MIGRATION") || null;
        const sequence = lineageRows.reduce((maximum, item) => Math.max(maximum, integer(item.event_sequence)), 0) + 1;
        const targetRows = selectedRows(await connection.execute(taskShareContract.statements.targetRead, [
          d.contractId, source.fact.sourceId, d.targetSchemaVersion,
        ]));
        let status;
        let eventType = "MIGRATION";
        if (base) {
          if (run.migration_mode === "FORWARD_REPLAY") eventType = "FORWARD_REPLAY";
          else if (run.migration_mode === "APPLY" && base.status === "DRY_RUN_VERIFIED") {
            eventType = "APPLY_AFTER_DRY_RUN";
          } else eventType = "IDEMPOTENT_RETRY";
        }
        let errorCode = null;
        if (base && !exactBaseLineage(base, run, d, source, target)) {
          status = "CONFLICT";
          eventType = "CONFLICT";
          errorCode = "TARGET_CONFLICT";
        } else if (targetRows.length > 1) {
          status = "QUARANTINED";
          eventType = base ? "QUARANTINE" : "MIGRATION";
          errorCode = "TARGET_QUARANTINED";
        } else if (targetRows.length === 1
          && !taskShareContract.exactTargetRow(targetRows[0], target)) {
          status = "CONFLICT";
          eventType = base ? "CONFLICT" : "MIGRATION";
          errorCode = "TARGET_CONFLICT";
        } else if (base && targetRows.length === 0
          && base.status !== "DRY_RUN_VERIFIED"
          && run.migration_mode !== "FORWARD_REPLAY") {
          status = "REVIEW_REQUIRED";
          eventType = "CONFLICT";
          errorCode = "IDENTITY_DRIFT";
        } else if (run.migration_mode === "DRY_RUN") {
          status = "DRY_RUN_VERIFIED";
        } else if (targetRows.length === 1) {
          status = run.migration_mode === "FORWARD_REPLAY" ? "FORWARD_REPLAYED" : "IDEMPOTENT";
        } else {
          if (affectedRows(await connection.execute(taskShareContract.statements.targetInsert, [
            target.targetRecordId, target.contractId, target.sourceTaskEventId,
            target.targetSchemaVersion, target.taskType, target.completionEventType,
            target.occurredAt, target.sourceChecksum, target.targetChecksum,
          ])) !== 1) throw persistenceError();
          status = run.migration_mode === "FORWARD_REPLAY" ? "FORWARD_REPLAYED" : "MIGRATED";
        }
        await insertLineage(connection, {
          identity, sequence: base ? sequence : 1, eventType, status, errorCode,
          source, target, run, batchId: input.batchId, requestId: input.requestId,
          replayed: run.migration_mode === "FORWARD_REPLAY",
          dbNow: run.db_now,
        });
        counts.processed += 1;
        if (status === "MIGRATED" || status === "FORWARD_REPLAYED" || status === "DRY_RUN_VERIFIED") counts.migrated += 1;
        else if (status === "IDEMPOTENT") counts.idempotent += 1;
        else if (status === "CONFLICT") counts.conflict += 1;
        else if (status === "QUARANTINED") counts.quarantined += 1;
        else counts.reviewRequired += 1;
        outcomes.push({ sourceId: source.fact.sourceId, sourceChecksum: source.sourceChecksum, targetChecksum: target.targetChecksum, status });
        if (["CONFLICT", "QUARANTINED", "REVIEW_REQUIRED"].includes(status)) {
          blockedError = errorCode || "IDENTITY_DRIFT";
          break;
        }
        lastGood = { cursorValue: source.cursor.cursorValue, tieBreaker: source.cursor.tieBreaker };
      }
      const status = blockedError ? "REVIEW_REQUIRED"
        : (rows.length < d.maximumBatchSize ? "PARITY_PENDING" : "OPEN");
      const resultDigest = digest("myroot-migration-batch-result:v1", {
        migrationRunId: run.migration_run_id, batchId: input.batchId,
        requestId: input.requestId, previousCursor: lower === null ? null : {
          cursorValue: run.cursor_value, tieBreaker: run.cursor_tie_breaker,
        }, nextCursor: lastGood, outcomes, status,
      });
      const finishTransition = transitionId("batch", run.migration_run_id);
      if (affectedRows(await connection.execute(FINISH_BATCH_SQL, [
        status,
        lastGood ? lastGood.cursorValue : null,
        lastGood ? lastGood.tieBreaker : null,
        lastGood ? lastGood.cursorValue : null,
        lastGood ? lastGood.tieBreaker : null,
        counts.processed, counts.migrated, counts.idempotent, counts.conflict,
        counts.quarantined, counts.reviewRequired, resultDigest, blockedError,
        finishTransition, status, run.migration_run_id, input.leaseOwner,
        integer(run.lease_generation), claimState.claimTransition,
      ])) !== 1) throw leaseError();
      const finished = await readRun(connection, run.migration_run_id, true);
      if (finished.status !== status || finished.transition_id !== finishTransition
        || finished.result_digest !== resultDigest) throw persistenceError();
      expectedResult = { status, transitionId: finishTransition, resultDigest };
      commitAttempted = true;
      await connection.commit();
      retire(connection, false);
      retired = true;
      return publicRun(finished, registration);
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      retire(connection, true);
      retired = true;
      if (commitAttempted && expectedResult) {
        try {
          const converged = await inspectFreshRun(input.migrationRunId);
          if (converged.status === expectedResult.status
            && converged.result_digest === expectedResult.resultDigest
            && converged.transition_id === expectedResult.transitionId) {
            return publicRun(converged, registration);
          }
        } catch {}
        throw ackUnknownError();
      }
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    } finally { if (!retired) retire(connection, true); }
  }

  async function runNextBatch(input = {}) { return runBatch(input, "STANDARD"); }
  async function forwardReplay(input = {}) { return runBatch(input, "FORWARD_REPLAY"); }

  async function verifyRun(input = {}) {
    exactLeaseInput(input, VERIFY_KEYS);
    assertEnabled();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let retired = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      await ensureContract(connection);
      const claimState = await claim(
        connection, input, ["DRY_RUN", "APPLY", "FORWARD_REPLAY"], ["PARITY_PENDING"]
      );
      if (claimState.done) {
        commitAttempted = true;
        await connection.commit();
        retire(connection, false);
        retired = true;
        return publicRun(claimState.run, registration);
      }
      const run = claimState.run;
      const paritySql = run.migration_mode === "DRY_RUN"
        ? DRY_RUN_PARITY_SQL : taskShareContract.statements.parityRead;
      const parityRows = selectedRows(await connection.execute(paritySql, [run.migration_run_id]));
      if (parityRows.length !== 1) throw persistenceError();
      const lineageCount = integer(parityRows[0].lineage_count || 0);
      const mismatchCount = integer(parityRows[0].mismatch_count || 0);
      const expectedCount = integer(run.migrated_count) + integer(run.idempotent_count);
      const verified = mismatchCount === 0 && lineageCount === expectedCount
        && integer(run.conflict_count) === 0 && integer(run.quarantined_count) === 0
        && integer(run.review_required_count) === 0;
      const status = verified ? "VERIFIED" : "REVIEW_REQUIRED";
      const errorCode = verified ? null : "PARITY_MISMATCH";
      const resultDigest = digest("myroot-migration-verification-result:v1", {
        migrationRunId: run.migration_run_id, mode: run.migration_mode,
        lineageCount, expectedCount, mismatchCount, status,
        parityAdapterDigest: registration.descriptor.parityAdapterDigest,
      });
      const finishTransition = transitionId("verify", run.migration_run_id);
      if (affectedRows(await connection.execute(VERIFY_FINISH_SQL, [
        status, resultDigest, errorCode, finishTransition, status,
        run.migration_run_id, input.leaseOwner, integer(run.lease_generation),
        claimState.claimTransition,
      ])) !== 1) throw leaseError();
      const finished = await readRun(connection, run.migration_run_id, true);
      if (finished.status !== status || finished.transition_id !== finishTransition
        || finished.result_digest !== resultDigest) throw persistenceError();
      expectedResult = { status, resultDigest, transitionId: finishTransition };
      commitAttempted = true;
      await connection.commit();
      retire(connection, false);
      retired = true;
      return publicRun(finished, registration);
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      retire(connection, true);
      retired = true;
      if (commitAttempted && expectedResult) {
        try {
          const converged = await inspectFreshRun(input.migrationRunId);
          if (converged.status === expectedResult.status
            && converged.result_digest === expectedResult.resultDigest
            && converged.transition_id === expectedResult.transitionId) {
            return publicRun(converged, registration);
          }
        } catch {}
        throw ackUnknownError();
      }
      throw error && error.isMigrationExecutionFoundationError ? error : persistenceError();
    } finally { if (!retired) retire(connection, true); }
  }

  return Object.freeze({ openRun, runNextBatch, verifyRun, forwardReplay, inspect });
}

module.exports = Object.freeze({ createMysqlMigrationExecutionFoundation });
