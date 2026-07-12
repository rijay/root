const REQUIRED_SCHEMA_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER"];
const ALLOWED_SCHEMA_PRIVILEGES = new Set(REQUIRED_SCHEMA_PRIVILEGES);

function text(value) {
  return String(value || "").trim();
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function shouldEnforceMysqlPrivilegePolicy(env = {}) {
  return text(env.NODE_ENV || process.env.NODE_ENV).toLowerCase() === "production" ||
    enabled(env.ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE);
}

function grantStatements(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .flatMap((row) => row && typeof row === "object" ? Object.values(row) : [])
    .filter((value) => typeof value === "string" && /^GRANT\s+/i.test(value.trim()));
}

function parseGrantStatement(statement) {
  const normalized = text(statement);
  const match = normalized.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
  if (!match) return null;
  return {
    privileges: match[1].split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
    scope: match[2].replace(/`/g, "").trim(),
    grantOption: /\bWITH\s+GRANT\s+OPTION\b/i.test(normalized),
  };
}

function evaluateMysqlGrantRows(rows = [], options = {}) {
  const database = text(options.database);
  const expectedScope = `${database}.*`.toLowerCase();
  const statements = grantStatements(rows);
  const parsed = statements.map(parseGrantStatement).filter(Boolean);
  const schemaPrivileges = new Set();
  const globalPrivileges = new Set();
  const unexpectedScopes = new Set();
  let grantOption = false;

  parsed.forEach((grant) => {
    grantOption = grantOption || grant.grantOption;
    const privileges = grant.privileges.includes("ALL PRIVILEGES") ? ["ALL PRIVILEGES"] : grant.privileges;
    const scope = grant.scope.toLowerCase();
    if (scope === expectedScope) privileges.forEach((item) => schemaPrivileges.add(item));
    if (scope === "*.*") privileges.filter((item) => item !== "USAGE").forEach((item) => globalPrivileges.add(item));
    if (scope !== expectedScope && scope !== "*.*" && privileges.some((item) => item !== "USAGE")) {
      unexpectedScopes.add(scope);
    }
  });

  const allSchemaPrivileges = schemaPrivileges.has("ALL PRIVILEGES");
  const missingPrivileges = allSchemaPrivileges
    ? []
    : REQUIRED_SCHEMA_PRIVILEGES.filter((item) => !schemaPrivileges.has(item));
  const unexpectedSchemaPrivileges = allSchemaPrivileges
    ? ["ALL PRIVILEGES"]
    : Array.from(schemaPrivileges).filter((item) => !ALLOWED_SCHEMA_PRIVILEGES.has(item)).sort();
  const issues = [];
  if (!database) issues.push("MYSQL_DATABASE");
  if (!statements.length) issues.push("SHOW_GRANTS_EMPTY");
  if (missingPrivileges.length) issues.push(`MISSING_SCHEMA_PRIVILEGES:${missingPrivileges.join(",")}`);
  if (globalPrivileges.size) issues.push(`GLOBAL_DATA_PRIVILEGES:${Array.from(globalPrivileges).sort().join(",")}`);
  if (unexpectedScopes.size) issues.push(`UNEXPECTED_SCHEMA_SCOPES:${unexpectedScopes.size}`);
  if (unexpectedSchemaPrivileges.length) issues.push(`UNEXPECTED_SCHEMA_PRIVILEGES:${unexpectedSchemaPrivileges.join(",")}`);
  if (grantOption) issues.push("GRANT_OPTION");

  return {
    ready: issues.length === 0,
    scope: globalPrivileges.size ? "GLOBAL" : schemaPrivileges.size ? "SCHEMA" : "UNKNOWN",
    statementCount: statements.length,
    requiredPrivileges: REQUIRED_SCHEMA_PRIVILEGES.slice(),
    missingPrivileges,
    globalPrivilegeCount: globalPrivileges.size,
    unexpectedScopeCount: unexpectedScopes.size,
    unexpectedSchemaPrivileges,
    grantOption,
    issues,
  };
}

async function readMysqlPrivilegePolicyFromConnection(connection, options = {}) {
  const [rows] = await connection.query("SHOW GRANTS FOR CURRENT_USER()");
  return {
    enforced: shouldEnforceMysqlPrivilegePolicy(options.env || {}),
    ...evaluateMysqlGrantRows(rows, options),
  };
}

async function readMysqlPrivilegePolicy(pool, options = {}) {
  const connection = await pool.getConnection();
  try {
    return await readMysqlPrivilegePolicyFromConnection(connection, options);
  } finally {
    connection.release();
  }
}

function assertMysqlPrivilegePolicy(status = {}) {
  if (!status.enforced || status.ready) return status;
  const error = new Error(`MySQL 应用账号最小权限未就绪：${(status.issues || []).join("; ")}`);
  error.code = "MYSQL_PRIVILEGE_POLICY_BLOCKED";
  error.detail = {
    scope: status.scope || "UNKNOWN",
    missingPrivileges: status.missingPrivileges || [],
    globalPrivilegeCount: Number(status.globalPrivilegeCount || 0),
    unexpectedScopeCount: Number(status.unexpectedScopeCount || 0),
    unexpectedSchemaPrivileges: status.unexpectedSchemaPrivileges || [],
    grantOption: status.grantOption === true,
    issues: status.issues || [],
  };
  throw error;
}

module.exports = {
  REQUIRED_SCHEMA_PRIVILEGES,
  assertMysqlPrivilegePolicy,
  evaluateMysqlGrantRows,
  readMysqlPrivilegePolicy,
  readMysqlPrivilegePolicyFromConnection,
  shouldEnforceMysqlPrivilegePolicy,
};
