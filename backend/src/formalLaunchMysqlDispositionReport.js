const {
  FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
  CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES,
} = require("./formalLaunchDataDisposition");

const TABLE_PROFILES = Object.freeze([
  { tableName: "campaign_definition", snapshotKey: "campaignDefinitions", userColumn: null, campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "campaign_participant", snapshotKey: "campaignParticipants", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "campaign_rule_version", snapshotKey: "campaignRuleVersions", userColumn: null, campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "notification_delivery", snapshotKey: "notificationDeliveries", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(delivered_at, created_at)" },
  { tableName: "notification_job", snapshotKey: "notificationJobs", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, sent_at, skipped_at, created_at)" },
  { tableName: "notification_subscription", snapshotKey: "notificationSubscriptions", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "notification_subscription_grant", snapshotKey: "notificationSubscriptionGrants", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, invalidated_at, released_at, consumed_at, reserved_at, granted_at, created_at)" },
  { tableName: "notification_template", snapshotKey: "notificationTemplates", userColumn: null, campaignColumn: null, firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "task_definition", snapshotKey: "taskDefinitions", userColumn: null, campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, created_at)" },
  { tableName: "task_event", snapshotKey: "taskEvents", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(occurred_at, created_at)" },
  { tableName: "task_progress_snapshot", snapshotKey: "taskProgressSnapshots", userColumn: "root_user_id", campaignColumn: "campaign_id", firstColumn: "created_at", lastExpression: "COALESCE(updated_at, computed_at, created_at)" },
].map((profile) => Object.freeze(profile)));

function quoteIdentifier(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw dispositionError("FORMAL_DISPOSITION_IDENTIFIER_INVALID");
  }
  return `\`${value}\``;
}

function dispositionError(code) {
  const error = new Error("Formal launch MySQL disposition report rejected the input");
  error.code = code;
  return error;
}

function assertRegistryCoverage() {
  const configured = TABLE_PROFILES.map(({ tableName }) => tableName).sort();
  const registered = [...CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES].sort();
  if (JSON.stringify(configured) !== JSON.stringify(registered)) {
    throw dispositionError("FORMAL_DISPOSITION_REGISTRY_DRIFT");
  }
}

assertRegistryCoverage();

function aggregateSelect(profile) {
  const table = quoteIdentifier(profile.tableName);
  const userCount = profile.userColumn
    ? `COUNT(DISTINCT ${quoteIdentifier(profile.userColumn)})`
    : "NULL";
  const campaignCount = profile.campaignColumn
    ? `COUNT(DISTINCT ${quoteIdentifier(profile.campaignColumn)})`
    : "NULL";
  return [
    `SELECT '${profile.tableName}' AS table_name, COUNT(*) AS row_count,`,
    `${userCount} AS linked_user_count,`,
    `${campaignCount} AS linked_campaign_count,`,
    `MIN(${quoteIdentifier(profile.firstColumn)}) AS first_record_at,`,
    `MAX(${profile.lastExpression}) AS last_record_at FROM ${table}`,
  ].join(" ");
}

const TABLE_AGGREGATE_QUERY = `${TABLE_PROFILES.map(aggregateSelect).join(" UNION ALL ")} ORDER BY table_name`;

const SNAPSHOT_AGGREGATE_QUERY = [
  "SELECT",
  TABLE_PROFILES.map(({ snapshotKey }) => [
    `MAX(JSON_LENGTH(JSON_EXTRACT(payload_json, '$.${snapshotKey}')))`,
    `AS ${quoteIdentifier(snapshotKey)}`,
  ].join(" ")).join(", "),
  "FROM root_store_snapshot",
].join(" ");

const tableList = TABLE_PROFILES.map(({ tableName }) => `'${tableName}'`).join(",");
const DEPENDENCY_QUERY = [
  "SELECT table_name, referenced_table_name, constraint_name",
  "FROM information_schema.key_column_usage",
  "WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL",
  `AND (table_name IN (${tableList}) OR referenced_table_name IN (${tableList}))`,
  "ORDER BY table_name, referenced_table_name, constraint_name",
].join(" ");

const MIGRATION_QUERY = "SELECT COUNT(*) AS migration_count, MAX(version) AS latest_migration FROM schema_migrations";
const SCHEMA_SUMMARY_QUERY = [
  "SELECT COUNT(*) AS table_count,",
  "SUM(CASE WHEN table_rows > 0 THEN 1 ELSE 0 END) AS estimated_nonempty_table_count",
  "FROM information_schema.tables",
  "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
].join(" ");

function valueOf(row, name) {
  const key = Object.keys(row || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : row[key];
}

function nonnegativeInteger(value, code) {
  const text = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw dispositionError(code);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw dispositionError(code);
  return parsed;
}

function nullableNonnegativeInteger(value, code) {
  return value === null || value === undefined ? null : nonnegativeInteger(value, code);
}

function nullableTimestamp(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)) {
    throw dispositionError("FORMAL_DISPOSITION_TIMESTAMP_INVALID");
  }
  return text;
}

function exactRows(value, expectedLength, code) {
  if (!Array.isArray(value) || value.length !== expectedLength) throw dispositionError(code);
  return value;
}

function normalizeTableRows(rows, snapshotRow, dependencies) {
  const byName = new Map();
  for (const row of exactRows(rows, TABLE_PROFILES.length, "FORMAL_DISPOSITION_TABLE_ROWS_INVALID")) {
    const tableName = String(valueOf(row, "table_name") || "");
    if (!CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES.includes(tableName) || byName.has(tableName)) {
      throw dispositionError("FORMAL_DISPOSITION_TABLE_ROWS_INVALID");
    }
    byName.set(tableName, row);
  }
  return TABLE_PROFILES.map((profile) => {
    const row = byName.get(profile.tableName);
    if (!row) throw dispositionError("FORMAL_DISPOSITION_TABLE_ROWS_INVALID");
    const rowCount = nonnegativeInteger(valueOf(row, "row_count"), "FORMAL_DISPOSITION_ROW_COUNT_INVALID");
    const snapshotCount = nonnegativeInteger(
      valueOf(snapshotRow, profile.snapshotKey),
      "FORMAL_DISPOSITION_SNAPSHOT_COUNT_INVALID"
    );
    const inboundDependencies = dependencies
      .filter((dependency) => valueOf(dependency, "referenced_table_name") === profile.tableName)
      .map((dependency) => String(valueOf(dependency, "table_name")))
      .sort();
    const outboundDependencies = dependencies
      .filter((dependency) => valueOf(dependency, "table_name") === profile.tableName)
      .map((dependency) => String(valueOf(dependency, "referenced_table_name")))
      .sort();
    return Object.freeze({
      tableName: profile.tableName,
      snapshotKey: profile.snapshotKey,
      rowCount,
      snapshotCount,
      snapshotCountMatches: rowCount === snapshotCount,
      linkedUserCount: nullableNonnegativeInteger(valueOf(row, "linked_user_count"), "FORMAL_DISPOSITION_LINKED_USER_COUNT_INVALID"),
      linkedCampaignCount: nullableNonnegativeInteger(valueOf(row, "linked_campaign_count"), "FORMAL_DISPOSITION_LINKED_CAMPAIGN_COUNT_INVALID"),
      firstRecordAt: nullableTimestamp(valueOf(row, "first_record_at")),
      lastRecordAt: nullableTimestamp(valueOf(row, "last_record_at")),
      inboundDependencies,
      outboundDependencies,
      disposition: rowCount === 0 ? "EMPTY_CONFIRMED_RETIREMENT_CANDIDATE" : "CONFIRMED_PRELAUNCH_RETIREMENT",
    });
  });
}

async function collectFormalLaunchMysqlDispositionReport(options = {}) {
  const execute = options.execute;
  if (typeof execute !== "function") throw dispositionError("FORMAL_DISPOSITION_EXECUTOR_INVALID");
  const appId = String(options.appId || "");
  const environmentId = String(options.environmentId || "");
  if (!/^wx[a-f0-9]{16}$/.test(appId)) throw dispositionError("FORMAL_DISPOSITION_APP_ID_INVALID");
  if (!/^[a-z0-9][a-z0-9-]{5,127}$/.test(environmentId)) {
    throw dispositionError("FORMAL_DISPOSITION_ENVIRONMENT_ID_INVALID");
  }
  const [rows, snapshotRows, dependencies, migrationRows, schemaRows] = await Promise.all([
    execute(TABLE_AGGREGATE_QUERY),
    execute(SNAPSHOT_AGGREGATE_QUERY),
    execute(DEPENDENCY_QUERY),
    execute(MIGRATION_QUERY),
    execute(SCHEMA_SUMMARY_QUERY),
  ]);
  const snapshotRow = exactRows(snapshotRows, 1, "FORMAL_DISPOSITION_SNAPSHOT_ROWS_INVALID")[0];
  const migrationRow = exactRows(migrationRows, 1, "FORMAL_DISPOSITION_MIGRATION_ROWS_INVALID")[0];
  const schemaRow = exactRows(schemaRows, 1, "FORMAL_DISPOSITION_SCHEMA_ROWS_INVALID")[0];
  const tables = normalizeTableRows(rows, snapshotRow, Array.isArray(dependencies) ? dependencies : []);
  const capturedAt = typeof options.now === "function" ? options.now() : new Date().toISOString();
  if (new Date(capturedAt).toISOString() !== capturedAt) {
    throw dispositionError("FORMAL_DISPOSITION_CAPTURE_TIME_INVALID");
  }
  return Object.freeze({
    reportFormatVersion: 1,
    dispositionRegistryVersion: FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
    readOnly: true,
    appId,
    environmentId,
    capturedAt,
    migration: Object.freeze({
      count: nonnegativeInteger(valueOf(migrationRow, "migration_count"), "FORMAL_DISPOSITION_MIGRATION_COUNT_INVALID"),
      latest: String(valueOf(migrationRow, "latest_migration") || ""),
    }),
    schema: Object.freeze({
      tableCount: nonnegativeInteger(valueOf(schemaRow, "table_count"), "FORMAL_DISPOSITION_SCHEMA_COUNT_INVALID"),
      estimatedNonemptyTableCount: nonnegativeInteger(valueOf(schemaRow, "estimated_nonempty_table_count"), "FORMAL_DISPOSITION_SCHEMA_COUNT_INVALID"),
    }),
    summary: Object.freeze({
      confirmedRetirementTableCount: tables.length,
      tablesWithRows: tables.filter(({ rowCount }) => rowCount > 0).length,
      totalRows: tables.reduce((sum, { rowCount }) => sum + rowCount, 0),
      snapshotMismatchCount: tables.filter(({ snapshotCountMatches }) => !snapshotCountMatches).length,
    }),
    tables: Object.freeze(tables),
  });
}

module.exports = {
  DEPENDENCY_QUERY,
  MIGRATION_QUERY,
  SCHEMA_SUMMARY_QUERY,
  SNAPSHOT_AGGREGATE_QUERY,
  TABLE_AGGREGATE_QUERY,
  TABLE_PROFILES,
  collectFormalLaunchMysqlDispositionReport,
};
