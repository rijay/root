const ROLES = Object.freeze([
  "REGISTRAR",
  "WORKER",
  "INSPECTOR",
  "DEFINER",
  "MIGRATOR",
]);

const REGISTRATION_MODES = Object.freeze(["DRY_RUN", "CONTROLLED"]);

const ROUTINES = Object.freeze({
  REGISTRAR: Object.freeze({
    DRY_RUN: "v1_runtime_alert_delivery_register_dry_run",
    CONTROLLED: "v1_runtime_alert_delivery_register_controlled",
  }),
  CONTROL_LEDGER_REGISTRAR: Object.freeze([
    "v1_runtime_control_ledger_read_cycle_by_schedule",
    "v1_runtime_control_ledger_read_cycle_by_id",
    "v1_runtime_control_ledger_read_alert",
    "v1_runtime_control_ledger_claim_cycle",
    "v1_runtime_control_ledger_renew_cycle",
    "v1_runtime_control_ledger_finalize_cycle",
    "v1_runtime_control_ledger_prepare_alert",
    "v1_runtime_control_ledger_lock_stale_cycles",
    "v1_runtime_control_ledger_recover_stale_cycle_prepare_alert",
  ]),
  WORKER: Object.freeze([
    "v1_runtime_alert_delivery_claim",
    "v1_runtime_alert_delivery_mark_provider_started",
    "v1_runtime_alert_delivery_complete_delivered",
    "v1_runtime_alert_delivery_fail_before_provider_retry",
    "v1_runtime_alert_delivery_fail_before_provider_dead",
    "v1_runtime_alert_delivery_mark_unknown",
    "v1_runtime_alert_delivery_recover_started_unknown",
    "v1_runtime_alert_delivery_recover_claim_retry",
    "v1_runtime_alert_delivery_recover_claim_dead",
  ]),
  INSPECTOR: Object.freeze([
    "v1_runtime_alert_delivery_inspect",
    "v1_runtime_control_ledger_inspect_snapshot",
  ]),
});

const READ_TABLES = Object.freeze({
  REGISTRAR: Object.freeze([]),
  WORKER: Object.freeze(["v1_runtime_alert", "v1_runtime_alert_delivery"]),
});

const MIGRATOR_SCHEMA_PRIVILEGES = Object.freeze([
  "ALTER",
  "ALTER ROUTINE",
  "CREATE",
  "CREATE ROUTINE",
  "CREATE TEMPORARY TABLES",
  "CREATE VIEW",
  "DELETE",
  "DROP",
  "EXECUTE",
  "INDEX",
  "INSERT",
  "REFERENCES",
  "SELECT",
  "SHOW VIEW",
  "TRIGGER",
  "UPDATE",
]);

function text(value) {
  return String(value || "").trim();
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function databaseName(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/.test(value);
}

function normalizeIdentifier(value) {
  return text(value).replace(/`/g, "").toLowerCase();
}

function grantStatements(rows) {
  if (!Array.isArray(rows)) return null;
  const statements = [];
  for (const row of rows) {
    if (!plainRecord(row)) return null;
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== "string") return null;
    const statement = values[0].trim();
    if (!/^GRANT\s+/i.test(statement) || statement.length > 65535) return null;
    statements.push(statement);
  }
  return statements;
}

function parseScope(rawScope) {
  const normalized = normalizeIdentifier(rawScope).replace(/\s+/g, " ");
  const routine = normalized.match(/^(procedure|function)\s+(.+)$/);
  const kind = routine ? routine[1].toUpperCase() : "TABLE";
  const qualified = routine ? routine[2] : normalized;
  const separator = qualified.lastIndexOf(".");
  if (separator < 1 || separator === qualified.length - 1) return null;
  return {
    kind,
    database: qualified.slice(0, separator),
    object: qualified.slice(separator + 1),
  };
}

function parseGrant(statement) {
  const normalized = text(statement);
  const match = normalized.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?$/i);
  if (!match) return null;
  const privileges = match[1].split(",").map((item) => item.trim().toUpperCase());
  if (!privileges.length || privileges.some((item) => !/^[A-Z ]+$/.test(item))) return null;
  const scope = parseScope(match[2]);
  if (!scope || !text(match[3])) return null;
  return {
    privileges,
    scope,
    grantee: text(match[3]).replace(/\s+/g, " ").toLowerCase(),
    grantOption: /\sWITH\s+GRANT\s+OPTION\s*$/i.test(normalized),
  };
}

function grantKey(privilege, kind, object) {
  return `${privilege}|${kind}|${String(object).toLowerCase()}`;
}

function expectedGrantKeys(role, registrationMode) {
  if (role === "REGISTRAR") {
    if (!REGISTRATION_MODES.includes(registrationMode)) return null;
    return new Set([
      grantKey("EXECUTE", "PROCEDURE", ROUTINES.REGISTRAR[registrationMode]),
      ...ROUTINES.CONTROL_LEDGER_REGISTRAR.map((name) => (
        grantKey("EXECUTE", "PROCEDURE", name)
      )),
      ...READ_TABLES.REGISTRAR.map((name) => grantKey("SELECT", "TABLE", name)),
    ]);
  }
  if (role === "WORKER") {
    return new Set([
      ...ROUTINES.WORKER.map((name) => grantKey("EXECUTE", "PROCEDURE", name)),
      ...READ_TABLES.WORKER.map((name) => grantKey("SELECT", "TABLE", name)),
    ]);
  }
  if (role === "INSPECTOR") {
    return new Set(ROUTINES.INSPECTOR.map((name) => grantKey("EXECUTE", "PROCEDURE", name)));
  }
  if (role === "DEFINER") {
    return new Set([
      grantKey("EXECUTE", "PROCEDURE", ROUTINES.REGISTRAR.DRY_RUN),
      grantKey("EXECUTE", "PROCEDURE", ROUTINES.REGISTRAR.CONTROLLED),
      ...ROUTINES.CONTROL_LEDGER_REGISTRAR.map((name) => (
        grantKey("EXECUTE", "PROCEDURE", name)
      )),
      ...ROUTINES.WORKER.map((name) => grantKey("EXECUTE", "PROCEDURE", name)),
      ...ROUTINES.INSPECTOR.map((name) => grantKey("EXECUTE", "PROCEDURE", name)),
      grantKey("SELECT", "TABLE", "v1_runtime_alert"),
      grantKey("INSERT", "TABLE", "v1_runtime_alert"),
      grantKey("SELECT", "TABLE", "v1_runtime_cycle"),
      grantKey("INSERT", "TABLE", "v1_runtime_cycle"),
      grantKey("UPDATE", "TABLE", "v1_runtime_cycle"),
      grantKey("SELECT", "TABLE", "v1_runtime_alert_registration_authority"),
      grantKey("SELECT", "TABLE", "v1_runtime_alert_delivery"),
      grantKey("INSERT", "TABLE", "v1_runtime_alert_delivery"),
      grantKey("UPDATE", "TABLE", "v1_runtime_alert_delivery"),
    ]);
  }
  if (role === "MIGRATOR") {
    return new Set(MIGRATOR_SCHEMA_PRIVILEGES.map((privilege) => (
      grantKey(privilege, "SCHEMA", "*")
    )));
  }
  return null;
}

function evaluateMysqlRuntimeAlertAuthorityGrantRows(rows = [], options = {}) {
  const role = text(options.role).toUpperCase();
  const registrationMode = text(options.registrationMode).toUpperCase();
  const database = text(options.database);
  const issues = [];
  if (!ROLES.includes(role)) issues.push("ROLE_INVALID");
  if (!databaseName(database)) issues.push("MYSQL_DATABASE_INVALID");
  if (role === "REGISTRAR" && !REGISTRATION_MODES.includes(registrationMode)) {
    issues.push("REGISTRATION_MODE_INVALID");
  }

  const expected = expectedGrantKeys(role, registrationMode) || new Set();
  const statements = grantStatements(rows);
  if (!statements || !statements.length) issues.push("SHOW_GRANTS_INVALID_OR_EMPTY");

  const actual = new Set();
  const grantees = new Set();
  let grantOption = false;
  let globalDataPrivilegeCount = 0;
  let crossSchemaGrantCount = 0;
  let malformedGrantCount = 0;

  for (const statement of statements || []) {
    const parsed = parseGrant(statement);
    if (!parsed) {
      malformedGrantCount += 1;
      continue;
    }
    grantees.add(parsed.grantee);
    grantOption ||= parsed.grantOption;
    const expectedDatabase = normalizeIdentifier(database);
    const global = parsed.scope.database === "*" && parsed.scope.object === "*";
    for (const privilege of parsed.privileges) {
      if (global && privilege === "USAGE") continue;
      if (global) {
        globalDataPrivilegeCount += 1;
        continue;
      }
      if (parsed.scope.database !== expectedDatabase) {
        crossSchemaGrantCount += 1;
        continue;
      }
      const kind = parsed.scope.object === "*" ? "SCHEMA" : parsed.scope.kind;
      actual.add(grantKey(privilege, kind, parsed.scope.object));
    }
  }

  if (malformedGrantCount) issues.push("GRANT_STATEMENT_MALFORMED");
  if (grantees.size > 1) issues.push("MULTIPLE_PRINCIPALS");
  if (grantOption) issues.push("GRANT_OPTION");
  if (globalDataPrivilegeCount) issues.push("GLOBAL_DATA_PRIVILEGES");
  if (crossSchemaGrantCount) issues.push("CROSS_SCHEMA_GRANTS");

  const missing = [...expected].filter((key) => !actual.has(key));
  const unexpected = [...actual].filter((key) => !expected.has(key));
  if (missing.length) issues.push("REQUIRED_GRANTS_MISSING");
  if (unexpected.length) issues.push("UNEXPECTED_GRANTS");

  const runtimeRole = ["REGISTRAR", "WORKER", "INSPECTOR"].includes(role);
  const directBaseTableDmlCount = runtimeRole
    ? [...actual].filter((key) => /^(?:INSERT|UPDATE|DELETE)\|/.test(key)).length
    : 0;
  const ddlPrivileges = new Set([
    "ALTER",
    "ALTER ROUTINE",
    "CREATE",
    "CREATE ROUTINE",
    "CREATE VIEW",
    "DROP",
    "INDEX",
    "REFERENCES",
    "TRIGGER",
  ]);
  const runtimeDdlCount = runtimeRole
    ? [...actual].filter((key) => ddlPrivileges.has(key.split("|", 1)[0])).length
    : 0;
  if (directBaseTableDmlCount) issues.push("RUNTIME_BASE_TABLE_DML");
  if (runtimeDdlCount) issues.push("RUNTIME_DDL");

  return Object.freeze({
    ready: issues.length === 0,
    role: ROLES.includes(role) ? role : "INVALID",
    registrationMode: role === "REGISTRAR" && REGISTRATION_MODES.includes(registrationMode)
      ? registrationMode : null,
    statementCount: statements ? statements.length : 0,
    principalCount: grantees.size,
    requiredGrantCount: expected.size,
    matchedGrantCount: [...expected].filter((key) => actual.has(key)).length,
    missingGrantCount: missing.length,
    unexpectedGrantCount: unexpected.length,
    malformedGrantCount,
    globalDataPrivilegeCount,
    crossSchemaGrantCount,
    directBaseTableDmlCount,
    runtimeDdlCount,
    grantOption,
    externalEvidenceRequiredCount: role === "DEFINER" || role === "MIGRATOR" ? 1 : 0,
    issues: Object.freeze(issues),
  });
}

function assertMysqlRuntimeAlertAuthorityGrantPolicy(status = {}) {
  if (status && status.ready === true) return status;
  const error = new Error("MySQL runtime alert authority grants are not ready");
  error.name = "MysqlRuntimeAlertAuthorityPolicyError";
  error.code = "MYSQL_RUNTIME_ALERT_AUTHORITY_POLICY_BLOCKED";
  error.detail = Object.freeze({
    role: status && ROLES.includes(status.role) ? status.role : "INVALID",
    missingGrantCount: Number(status && status.missingGrantCount || 0),
    unexpectedGrantCount: Number(status && status.unexpectedGrantCount || 0),
    globalDataPrivilegeCount: Number(status && status.globalDataPrivilegeCount || 0),
    crossSchemaGrantCount: Number(status && status.crossSchemaGrantCount || 0),
    grantOption: Boolean(status && status.grantOption),
    issues: Object.freeze(Array.isArray(status && status.issues) ? [...status.issues] : []),
  });
  throw error;
}

module.exports = {
  MIGRATOR_SCHEMA_PRIVILEGES,
  READ_TABLES,
  REGISTRATION_MODES,
  ROLES,
  ROUTINES,
  assertMysqlRuntimeAlertAuthorityGrantPolicy,
  evaluateMysqlRuntimeAlertAuthorityGrantRows,
};
