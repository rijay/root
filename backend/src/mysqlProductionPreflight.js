const crypto = require("node:crypto");
const { calculateV1MysqlConnectionCapacity } = require("./mysqlConnectionCapacity");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_CHECKSUMS_PATH = path.resolve(
  __dirname,
  "..",
  "db",
  "migrations",
  "checksums.json"
);

const QUERY = Object.freeze({
  metadata: [
    "SELECT VERSION() AS mysql_version,",
    "@@session.time_zone AS session_time_zone,",
    "@@global.time_zone AS global_time_zone,",
    "@@max_connections AS max_connections,",
    "DATABASE() AS database_name,",
    "CURRENT_USER() AS authenticated_account",
  ].join(" "),
  status: [
    "SHOW GLOBAL STATUS WHERE Variable_name IN",
    "('Threads_connected', 'Threads_running', 'Max_used_connections',",
    "'Connection_errors_max_connections', 'Uptime')",
  ].join(" "),
  migrations: "SELECT version, checksum FROM schema_migrations ORDER BY version",
  columns: [
    "SELECT table_name, column_name, column_type, is_nullable,",
    "COALESCE(column_default, '<NULL>') AS column_default,",
    "COALESCE(extra, '') AS extra, COALESCE(collation_name, '') AS collation_name",
    "FROM information_schema.columns",
    "WHERE table_schema = DATABASE()",
    "ORDER BY table_name, ordinal_position",
  ].join(" "),
  grants: "SHOW GRANTS FOR CURRENT_USER",
});

function preflightError(code) {
  const error = new Error("MySQL production preflight rejected the input");
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw preflightError("MYSQL_PREFLIGHT_QUERY_RESULT_INVALID");
  return rows;
}

function singleRow(result) {
  const rows = selectedRows(result);
  if (rows.length !== 1 || !plainRecord(rows[0])) {
    throw preflightError("MYSQL_PREFLIGHT_QUERY_RESULT_INVALID");
  }
  return rows[0];
}

function valueOf(row, name) {
  if (!plainRecord(row)) return undefined;
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : row[key];
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && /^[\x21-\x7e]+$/.test(value);
}

function printableText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && /^[\x20-\x7e]+$/.test(value);
}

function boundedInteger(value, minimum, maximum, code) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw preflightError(code);
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw preflightError(code);
  }
  return number;
}

function requiredEnv(env, name, maximumLength = 256) {
  const value = env[name];
  if (!exactText(value, maximumLength)) {
    throw preflightError(`MYSQL_PREFLIGHT_${name}_INVALID`);
  }
  return value;
}

function evidenceKey(env) {
  const key = requiredEnv(env, "ROOT_EVIDENCE_REFERENCE_HMAC_KEY", 4096);
  if (Buffer.byteLength(key, "utf8") < 32) {
    throw preflightError("MYSQL_PREFLIGHT_EVIDENCE_KEY_TOO_SHORT");
  }
  return key;
}

function hmacHex(key, namespace, value) {
  return crypto.createHmac("sha256", key)
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(String(value), "utf8")
    .digest("hex");
}

function opaqueRef(key, namespace, value) {
  return `${namespace}:sha256:${hmacHex(key, `myroot:evidence-ref:${namespace}:v1`, value)}`;
}

function canonicalDigest(namespace, value) {
  return crypto.createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function expectedMigrations(checksumsPath = MIGRATION_CHECKSUMS_PATH) {
  const payload = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
  if (!plainRecord(payload) || !plainRecord(payload.files)) {
    throw preflightError("MYSQL_PREFLIGHT_MIGRATION_MANIFEST_INVALID");
  }
  return Object.entries(payload.files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, checksum]) => {
      if (!exactText(version, 96) || !/^[a-f0-9]{64}$/.test(checksum)) {
        throw preflightError("MYSQL_PREFLIGHT_MIGRATION_MANIFEST_INVALID");
      }
      return Object.freeze({ version, checksum });
    });
}

function normalizeMigrations(rows) {
  return rows.map((row) => {
    const version = valueOf(row, "version");
    const checksum = valueOf(row, "checksum");
    if (!exactText(version, 96) || !/^[a-f0-9]{64}$/.test(String(checksum || ""))) {
      throw preflightError("MYSQL_PREFLIGHT_MIGRATION_ROWS_INVALID");
    }
    return Object.freeze({ version, checksum: String(checksum) });
  });
}

function normalizeColumns(rows) {
  if (!rows.length) throw preflightError("MYSQL_PREFLIGHT_SCHEMA_EMPTY");
  return rows.map((row) => {
    const normalized = {};
    for (const name of [
      "table_name",
      "column_name",
      "column_type",
      "is_nullable",
      "column_default",
      "extra",
      "collation_name",
    ]) {
      const value = valueOf(row, name);
      if (value === undefined || value === null) {
        throw preflightError("MYSQL_PREFLIGHT_SCHEMA_ROWS_INVALID");
      }
      normalized[name] = String(value);
    }
    return Object.freeze(normalized);
  });
}

function grantStatements(rows) {
  return rows.map((row) => {
    if (!plainRecord(row)) throw preflightError("MYSQL_PREFLIGHT_GRANTS_INVALID");
    const values = Object.values(row);
    if (values.length !== 1 || !printableText(values[0], 65535)) {
      throw preflightError("MYSQL_PREFLIGHT_GRANTS_INVALID");
    }
    return values[0];
  });
}

function normalizeScope(value) {
  return String(value || "").replace(/\`/g, "").trim().toLowerCase();
}

function analyzeGrants(statements, databaseName, key) {
  const databaseScope = `${String(databaseName).toLowerCase()}.*`;
  const privileges = new Set();
  let grantOptionPresent = false;
  let globalScopePresent = false;
  let crossSchemaScopePresent = false;
  let unrestrictedAllPrivileges = false;
  for (const statement of statements) {
    grantOptionPresent ||= /\bWITH\s+GRANT\s+OPTION\b/i.test(statement);
    const match = statement.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
    if (!match) throw preflightError("MYSQL_PREFLIGHT_GRANTS_INVALID");
    const names = match[1].split(",").map((item) => item.trim().toUpperCase());
    names.forEach((name) => privileges.add(name));
    const meaningful = names.some((name) => name !== "USAGE");
    const scope = normalizeScope(match[2]);
    globalScopePresent ||= meaningful && scope === "*.*";
    const currentDatabaseScope = scope === databaseScope
      || scope.startsWith(`${String(databaseName).toLowerCase()}.`)
      || scope.startsWith(`procedure ${String(databaseName).toLowerCase()}.`)
      || scope.startsWith(`function ${String(databaseName).toLowerCase()}.`);
    crossSchemaScopePresent ||= meaningful && scope !== "*.*" && !currentDatabaseScope;
    unrestrictedAllPrivileges ||= names.some((name) => name === "ALL PRIVILEGES");
  }
  const normalizedPrivileges = [...privileges].sort();
  return Object.freeze({
    grantCount: statements.length,
    privilegeNames: normalizedPrivileges,
    grantOptionPresent,
    globalScopePresent,
    crossSchemaScopePresent,
    unrestrictedAllPrivileges,
    grantsDigest: hmacHex(key, "myroot:mysql-grants:v1", statements.slice().sort().join("\n")),
  });
}

function statusMetrics(rows) {
  const values = new Map();
  for (const row of rows) {
    const name = String(valueOf(row, "Variable_name") || "");
    const value = boundedInteger(
      valueOf(row, "Value"),
      0,
      1_000_000_000,
      "MYSQL_PREFLIGHT_STATUS_VALUE_INVALID"
    );
    values.set(name.toLowerCase(), value);
  }
  const required = [
    "threads_connected",
    "threads_running",
    "max_used_connections",
    "connection_errors_max_connections",
    "uptime",
  ];
  if (!required.every((name) => values.has(name))) {
    throw preflightError("MYSQL_PREFLIGHT_STATUS_INCOMPLETE");
  }
  return Object.freeze({
    currentConnections: values.get("threads_connected"),
    runningConnections: values.get("threads_running"),
    peakConnectionsSinceRestart: values.get("max_used_connections"),
    maxConnectionErrorsSinceRestart: values.get("connection_errors_max_connections"),
    serverUptimeSeconds: values.get("uptime"),
  });
}

function capacityEvidence(env, serverMaximumConnections) {
  const mainPool = boundedInteger(
    env.MYROOT_V1_MAIN_CONNECTION_LIMIT,
    1,
    1024,
    "MYSQL_PREFLIGHT_MAIN_POOL_INVALID"
  );
  const orchestrationPool = boundedInteger(
    env.MYROOT_V1_RUNTIME_CONNECTION_LIMIT,
    3,
    64,
    "MYSQL_PREFLIGHT_RUNTIME_POOL_INVALID"
  );
  const heartbeatPool = boundedInteger(
    env.MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT,
    1,
    1,
    "MYSQL_PREFLIGHT_HEARTBEAT_POOL_INVALID"
  );
  const registrarPool = boundedInteger(
    env.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT,
    1,
    64,
    "MYSQL_PREFLIGHT_REGISTRAR_POOL_INVALID"
  );
  const workerPool = boundedInteger(
    env.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT,
    1,
    64,
    "MYSQL_PREFLIGHT_WORKER_POOL_INVALID"
  );
  const inspectorPool = boundedInteger(
    env.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT,
    1,
    64,
    "MYSQL_PREFLIGHT_INSPECTOR_POOL_INVALID"
  );
  const maximumInstances = boundedInteger(
    env.MYROOT_CLOUDRUN_MAX_INSTANCES,
    1,
    10_000,
    "MYSQL_PREFLIGHT_MAX_INSTANCES_INVALID"
  );
  const observedOtherConnectionConsumers = boundedInteger(
    env.MYROOT_MYSQL_OTHER_CONNECTION_CONSUMERS,
    0,
    1_000_000_000,
    "MYSQL_PREFLIGHT_OTHER_CONSUMERS_INVALID"
  );
  const reservedContingencyHeadroom = boundedInteger(
    env.MYROOT_MYSQL_RESERVED_CONTINGENCY_HEADROOM,
    0,
    1_000_000_000,
    "MYSQL_PREFLIGHT_RESERVED_HEADROOM_INVALID"
  );
  const runtimeConfiguredHeadroom = boundedInteger(
    env.MYROOT_MYSQL_CONNECTION_HEADROOM,
    0,
    1_000_000_000,
    "MYSQL_PREFLIGHT_RUNTIME_HEADROOM_INVALID"
  );
  const expectedRuntimeHeadroom = observedOtherConnectionConsumers
    + reservedContingencyHeadroom;
  const capacity = calculateV1MysqlConnectionCapacity({
    mainPool,
    orchestrationPool,
    registrarPool,
    registrarHeartbeatPool: heartbeatPool,
    workerPool,
    inspectorPool,
    maximumInstances,
    headroom: expectedRuntimeHeadroom,
  });
  return Object.freeze({
    mainPool,
    orchestrationPool,
    registrarPool,
    heartbeatPool,
    workerPool,
    inspectorPool,
    maximumInstances,
    observedOtherConnectionConsumers,
    reservedContingencyHeadroom,
    runtimeConfiguredHeadroom,
    expectedRuntimeHeadroom,
    serverMaximumConnections,
    perInstance: capacity.perInstance,
    calculatedRequirement: capacity.calculatedRequirement,
    runtimeHeadroomMatches: runtimeConfiguredHeadroom === expectedRuntimeHeadroom,
    withinServerMaximum: capacity.calculatedRequirement <= serverMaximumConnections,
  });
}

function exactIso(value) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw preflightError("MYSQL_PREFLIGHT_CAPTURE_TIME_INVALID");
  }
  return value;
}

async function collectMysqlProductionPreflight(options = {}) {
  const connection = options.connection;
  const env = options.env || process.env;
  if (!connection || typeof connection.query !== "function") {
    throw preflightError("MYSQL_PREFLIGHT_CONNECTION_INVALID");
  }
  const environmentKind = requiredEnv(env, "MYROOT_EVIDENCE_ENVIRONMENT_KIND", 16);
  if (!["CANDIDATE", "PRODUCTION"].includes(environmentKind)) {
    throw preflightError("MYSQL_PREFLIGHT_ENVIRONMENT_KIND_INVALID");
  }
  const releaseId = requiredEnv(env, "ROOT_RELEASE_ID", 128);
  const platformEnvironmentId = env.ROOT_CLOUDBASE_ENV_ID
    || env.CLOUDBASE_ENV_ID
    || env.TCB_ENV_ID;
  if (!exactText(platformEnvironmentId, 256)) {
    throw preflightError("MYSQL_PREFLIGHT_PLATFORM_ENVIRONMENT_INVALID");
  }
  const capturedBySignerRef = requiredEnv(env, "MYROOT_EVIDENCE_CAPTURED_BY_SIGNER_REF", 96);
  if (!/^actor:sha256:[a-f0-9]{64}$/.test(capturedBySignerRef)) {
    throw preflightError("MYSQL_PREFLIGHT_CAPTURED_BY_INVALID");
  }
  const key = evidenceKey(env);
  const metadata = singleRow(await connection.query(QUERY.metadata));
  const databaseName = valueOf(metadata, "database_name");
  const currentUser = valueOf(metadata, "authenticated_account");
  const mysqlVersion = valueOf(metadata, "mysql_version");
  const databaseTimeZone = valueOf(metadata, "session_time_zone");
  const globalTimeZone = valueOf(metadata, "global_time_zone");
  if (!exactText(databaseName, 64)
    || !exactText(currentUser, 255)
    || !exactText(mysqlVersion, 128)
    || !exactText(databaseTimeZone, 32)
    || !exactText(globalTimeZone, 32)) {
    throw preflightError("MYSQL_PREFLIGHT_METADATA_INVALID");
  }
  const serverMaximumConnections = boundedInteger(
    valueOf(metadata, "max_connections"),
    1,
    1_000_000_000,
    "MYSQL_PREFLIGHT_SERVER_MAX_CONNECTIONS_INVALID"
  );
  const metrics = statusMetrics(selectedRows(await connection.query(QUERY.status)));
  const migrations = normalizeMigrations(selectedRows(await connection.query(QUERY.migrations)));
  const expected = expectedMigrations(options.checksumsPath || MIGRATION_CHECKSUMS_PATH);
  const columns = normalizeColumns(selectedRows(await connection.query(QUERY.columns)));
  const grants = grantStatements(selectedRows(await connection.query(QUERY.grants)));
  const grantSummary = analyzeGrants(grants, databaseName, key);
  const capacity = capacityEvidence(env, serverMaximumConnections);
  const blockers = [];
  const revisionIdentity = env.K_REVISION || env.ROOT_RELEASE_ARTIFACT_DIGEST || "";
  if (!exactText(revisionIdentity, 128)) blockers.push("REVISION_IDENTITY_MISSING");
  if (JSON.stringify(migrations) !== JSON.stringify(expected)) {
    blockers.push("MIGRATION_SET_MISMATCH");
  }
  if (grantSummary.grantOptionPresent) blockers.push("GRANT_OPTION_PRESENT");
  if (grantSummary.globalScopePresent) blockers.push("GLOBAL_SCOPE_PRIVILEGE_PRESENT");
  if (grantSummary.crossSchemaScopePresent) blockers.push("CROSS_SCHEMA_PRIVILEGE_PRESENT");
  if (grantSummary.unrestrictedAllPrivileges) blockers.push("ALL_PRIVILEGES_PRESENT");
  if (!capacity.runtimeHeadroomMatches) blockers.push("RUNTIME_HEADROOM_MISMATCH");
  if (!capacity.withinServerMaximum) blockers.push("CAPACITY_EXCEEDS_SERVER_MAXIMUM");
  const capturedAt = exactIso(
    typeof options.now === "function" ? options.now() : new Date().toISOString()
  );
  const report = {
    reportFormatVersion: 1,
    readOnly: true,
    status: blockers.length ? "BLOCKED" : "PASS",
    blockers,
    releaseId,
    environmentKind,
    targetEnvironmentRef: opaqueRef(key, "environment", platformEnvironmentId),
    databaseRef: opaqueRef(key, "database", databaseName),
    databasePrincipalRef: opaqueRef(key, "principal", currentUser),
    candidateRevisionRef: revisionIdentity
      ? opaqueRef(key, "revision", revisionIdentity)
      : null,
    mysqlVersion,
    databaseTimeZone,
    globalTimeZone,
    migrationCount: migrations.length,
    migrationSetDigest: canonicalDigest("myroot:mysql-migration-set:v1", migrations),
    relationalSchemaDigest: canonicalDigest("myroot:mysql-relational-schema:v1", columns),
    relationalColumnCount: columns.length,
    grantSummary,
    capacity,
    metrics,
    capacityEvidenceRef: requiredEnv(env, "MYROOT_MYSQL_CAPACITY_EVIDENCE_REF", 256),
    capturedBySignerRef,
    capturedAt,
  };
  if (!/^evidence:sha256:[a-f0-9]{64}$/.test(report.capacityEvidenceRef)) {
    throw preflightError("MYSQL_PREFLIGHT_CAPACITY_EVIDENCE_REF_INVALID");
  }
  return Object.freeze(report);
}

module.exports = {
  QUERY,
  analyzeGrants,
  capacityEvidence,
  collectMysqlProductionPreflight,
  expectedMigrations,
};
