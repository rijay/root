const crypto = require("node:crypto");

const CONTRACT_ID = "TASK_SHARE_SYNTHETIC_V1";
const CONTRACT_VERSION = 1;
const TARGET_SCHEMA_VERSION = "TASK_SHARE_MIGRATION_V1";
const CURSOR_TYPE = "OCCURRED_AT_TASK_EVENT_ID_V1";
const BATCH_SIZE = 100;
const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

const SOURCE_READ_SQL = `/* migration-execution:task-share-source-read-v1 */
SELECT
  task_event_id, task_type, event_type, status,
  LEFT(DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS occurred_at_wall_time
FROM task_event
WHERE task_type = 'SHARE'
  AND event_type = 'SHARE_COMPLETED'
  AND status = 'SUCCEEDED'
  AND occurred_at <= ?
  AND (
    ? IS NULL
    OR occurred_at > ?
    OR (occurred_at = ? AND BINARY task_event_id > BINARY ?)
  )
  AND (
    ? IS NULL
    OR occurred_at < ?
    OR (occurred_at = ? AND BINARY task_event_id <= BINARY ?)
  )
ORDER BY occurred_at ASC, BINARY task_event_id ASC
LIMIT ?
FOR SHARE`;

const TARGET_READ_SQL = `/* migration-execution:task-share-target-read-v1 */
SELECT
  target_record_id, contract_id, source_task_event_id,
  target_schema_version, task_type, completion_event_type,
  LEFT(DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS occurred_at_wall_time,
  source_checksum, target_checksum
FROM task_share_migration_projection
WHERE contract_id = ?
  AND source_task_event_id = ?
  AND target_schema_version = ?
ORDER BY target_record_id
LIMIT 2
FOR UPDATE`;

const TARGET_INSERT_SQL = `/* migration-execution:task-share-target-insert-v1 */
INSERT INTO task_share_migration_projection (
  target_record_id, contract_id, source_task_event_id,
  target_schema_version, task_type, completion_event_type,
  occurred_at, source_checksum, target_checksum, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`;

const PARITY_READ_SQL = `/* migration-execution:task-share-parity-read-v1 */
SELECT
  COUNT(*) AS lineage_count,
  SUM(CASE WHEN target.target_record_id IS NOT NULL THEN 1 ELSE 0 END) AS target_count,
  SUM(CASE
    WHEN target.target_record_id IS NULL
      OR target.source_checksum <> lineage.source_checksum
      OR target.target_checksum <> lineage.target_checksum
    THEN 1 ELSE 0 END
  ) AS mismatch_count
FROM migration_lineage AS lineage
LEFT JOIN task_share_migration_projection AS target
  ON target.target_record_id = lineage.target_id
 AND target.contract_id = lineage.contract_id
 AND target.source_task_event_id = lineage.source_id
 AND target.target_schema_version = lineage.target_schema_version
WHERE lineage.migration_run_id = ?
  AND lineage.status IN ('MIGRATED', 'IDEMPOTENT', 'FORWARD_REPLAYED')`;

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
    .update(typeof value === "string" ? value : canonicalJson(value), "utf8")
    .digest("hex");
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function exactText(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactId(value, maximumLength) {
  return exactText(value, maximumLength)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function mysqlDatetime(value) {
  if (typeof value !== "string" || !MYSQL_DATETIME_PATTERN.test(value)) return false;
  const instant = new Date(`${value.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(instant.getTime())) return false;
  return new Date(instant.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString().slice(0, 23).replace("T", " ") === value;
}

function sourceError() {
  const error = new Error("migration source fact is outside the registered contract");
  error.code = "MIGRATION_EXECUTION_SOURCE_DRIFT";
  return error;
}

function normalizeSource(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || !exactId(row.task_event_id, 32)
    || row.task_type !== "SHARE"
    || row.event_type !== "SHARE_COMPLETED"
    || row.status !== "SUCCEEDED"
    || !mysqlDatetime(row.occurred_at_wall_time)) throw sourceError();
  const fact = Object.freeze({
    sourceType: "LEGACY_TASK_EVENT",
    sourceId: row.task_event_id,
    taskType: row.task_type,
    completionEventType: row.event_type,
    occurredAt: row.occurred_at_wall_time,
  });
  return Object.freeze({
    fact,
    sourceChecksum: digest("myroot-migration-source-task-share:v1", fact),
    cursor: Object.freeze({
      cursorType: CURSOR_TYPE,
      cursorValue: fact.occurredAt,
      tieBreaker: fact.sourceId,
      inclusive: false,
    }),
  });
}

function targetRecord(source) {
  if (!source || typeof source !== "object" || !source.fact
    || !/^[a-f0-9]{64}$/.test(source.sourceChecksum)) throw sourceError();
  const targetRecordId = `mtp_${digest("myroot-migration-target-id:v1", {
    contractId: CONTRACT_ID,
    sourceId: source.fact.sourceId,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
  }).slice(0, 60)}`;
  const record = {
    targetRecordId,
    contractId: CONTRACT_ID,
    sourceTaskEventId: source.fact.sourceId,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    taskType: source.fact.taskType,
    completionEventType: source.fact.completionEventType,
    occurredAt: source.fact.occurredAt,
    sourceChecksum: source.sourceChecksum,
  };
  return Object.freeze({
    ...record,
    targetChecksum: digest("myroot-migration-target-task-share:v1", record),
  });
}

function exactTargetRow(row, target) {
  return Boolean(row && typeof row === "object" && !Array.isArray(row)
    && row.target_record_id === target.targetRecordId
    && row.contract_id === target.contractId
    && row.source_task_event_id === target.sourceTaskEventId
    && row.target_schema_version === target.targetSchemaVersion
    && row.task_type === target.taskType
    && row.completion_event_type === target.completionEventType
    && row.occurred_at_wall_time === target.occurredAt
    && row.source_checksum === target.sourceChecksum
    && row.target_checksum === target.targetChecksum);
}

const SOURCE_QUERY_DIGEST = digest(
  "myroot-migration-source-query:v1",
  normalizeSql(SOURCE_READ_SQL)
);
const SOURCE_ADAPTER_DIGEST = digest("myroot-migration-source-adapter:v1", {
  adapterId: "task-share-legacy-source-reader-v1",
  queryDigest: SOURCE_QUERY_DIGEST,
  cursorType: CURSOR_TYPE,
  inclusive: false,
  transformVersion: "task-share-source-normalizer-v1",
});
const TARGET_READ_DIGEST = digest(
  "myroot-migration-target-statement:v1",
  normalizeSql(TARGET_READ_SQL)
);
const TARGET_INSERT_DIGEST = digest(
  "myroot-migration-target-statement:v1",
  normalizeSql(TARGET_INSERT_SQL)
);
const TARGET_ADAPTER_DIGEST = digest("myroot-migration-target-adapter:v1", {
  adapterId: "task-share-migration-target-writer-v1",
  readDigest: TARGET_READ_DIGEST,
  insertDigest: TARGET_INSERT_DIGEST,
  transformVersion: "task-share-target-transform-v1",
  updateAllowed: false,
});
const PARITY_QUERY_DIGEST = digest(
  "myroot-migration-parity-query:v1",
  normalizeSql(PARITY_READ_SQL)
);
const PARITY_ADAPTER_DIGEST = digest("myroot-migration-parity-adapter:v1", {
  adapterId: "task-share-migration-parity-v1",
  queryDigest: PARITY_QUERY_DIGEST,
});

const descriptorWithoutDigest = Object.freeze({
  contractId: CONTRACT_ID,
  contractVersion: CONTRACT_VERSION,
  factType: "TASK_SHARE",
  authoritativeSource: "LEGACY_TASK_EVENT",
  sourceType: "LEGACY_TASK_EVENT",
  sourceQueryId: "task_share_legacy_succeeded_by_occurred_at_v1",
  sourceQueryDigest: SOURCE_QUERY_DIGEST,
  sourceAdapterId: "task-share-legacy-source-reader-v1",
  sourceAdapterDigest: SOURCE_ADAPTER_DIGEST,
  targetType: "TASK_SHARE_MIGRATION_PROJECTION",
  targetSchemaVersion: TARGET_SCHEMA_VERSION,
  targetAdapterId: "task-share-migration-target-writer-v1",
  targetAdapterDigest: TARGET_ADAPTER_DIGEST,
  parityAdapterId: "task-share-migration-parity-v1",
  parityAdapterDigest: PARITY_ADAPTER_DIGEST,
  cursorType: CURSOR_TYPE,
  inclusive: false,
  maximumBatchSize: BATCH_SIZE,
  allowsNetwork: false,
  allowsOutbox: false,
});

const descriptor = Object.freeze({
  ...descriptorWithoutDigest,
  contractDigest: digest("myroot-migration-contract:v1", descriptorWithoutDigest),
});

module.exports = Object.freeze({
  descriptor,
  statements: Object.freeze({
    sourceRead: SOURCE_READ_SQL,
    targetRead: TARGET_READ_SQL,
    targetInsert: TARGET_INSERT_SQL,
    parityRead: PARITY_READ_SQL,
    targetReadDigest: TARGET_READ_DIGEST,
    targetInsertDigest: TARGET_INSERT_DIGEST,
    parityQueryDigest: PARITY_QUERY_DIGEST,
  }),
  normalizeSource,
  targetRecord,
  exactTargetRow,
});
