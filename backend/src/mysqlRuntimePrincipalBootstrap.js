const {
  MIGRATOR_SCHEMA_PRIVILEGES,
  READ_TABLES,
  ROUTINES,
} = require("./mysqlRuntimeAlertAuthorityPolicy");

const REGISTRATION_MODES = Object.freeze(["DRY_RUN", "CONTROLLED"]);
const PRINCIPAL_ROLES = Object.freeze(["DEFINER", "REGISTRAR", "WORKER", "INSPECTOR"]);
const LOCAL_HOSTS = Object.freeze(["127.0.0.1", "localhost", "::1"]);

function privateDockerBridgeHost(value) {
  if (typeof value !== "string" || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value)) {
    return false;
  }
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function localPrincipalHost(value) {
  return LOCAL_HOSTS.includes(value) || privateDockerBridgeHost(value);
}

function bootstrapError(code) {
  const error = new Error("MySQL runtime principal bootstrap plan rejected");
  error.name = "MysqlRuntimePrincipalBootstrapError";
  error.code = code;
  return error;
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

function identifier(value, maximumLength = 64) {
  return typeof value === "string"
    && value.length <= maximumLength
    && /^[a-z][a-z0-9_]*$/.test(value);
}

function password(value) {
  return typeof value === "string"
    && value.length >= 24
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function quoteIdentifier(value) {
  if (!identifier(value)) throw bootstrapError("MYSQL_RUNTIME_BOOTSTRAP_IDENTIFIER_INVALID");
  return `\`${value}\``;
}

function quoteAccount(principal) {
  if (!plainRecord(principal)
    || !identifier(principal.username, 32)
    || !localPrincipalHost(principal.host)
    || !password(principal.password)) {
    throw bootstrapError("MYSQL_RUNTIME_BOOTSTRAP_PRINCIPAL_INVALID");
  }
  return `'${principal.username}'@'${principal.host}'`;
}

function statement(sql, values = []) {
  return Object.freeze({ sql, values: Object.freeze([...values]) });
}

function routineGrant(database, routine, account) {
  return statement(
    `GRANT EXECUTE ON PROCEDURE ${quoteIdentifier(database)}.${quoteIdentifier(routine)} TO ${account}`
  );
}

function tableGrant(database, privileges, table, account) {
  return statement(
    `GRANT ${privileges.join(", ")} ON ${quoteIdentifier(database)}.${quoteIdentifier(table)} TO ${account}`
  );
}

function schemaGrant(database, privileges, account) {
  return statement(
    `GRANT ${privileges.join(", ")} ON ${quoteIdentifier(database)}.* TO ${account}`
  );
}

function createMysqlRuntimePrincipalBootstrapPlan(input = {}) {
  if (!exactKeys(input, ["database", "registrationMode", "principals"])
    || !identifier(input.database)
    || !/^myroot_runtime_principal_it_[0-9]+_[0-9a-f]{16}$/.test(input.database)
    || !REGISTRATION_MODES.includes(input.registrationMode)
    || !plainRecord(input.principals)
    || !exactKeys(input.principals, PRINCIPAL_ROLES)) {
    throw bootstrapError("MYSQL_RUNTIME_BOOTSTRAP_INPUT_INVALID");
  }

  const accounts = {};
  const usernames = new Set();
  const passwords = new Set();
  for (const role of PRINCIPAL_ROLES) {
    const principal = input.principals[role];
    accounts[role] = quoteAccount(principal);
    if (usernames.has(principal.username) || passwords.has(principal.password)) {
      throw bootstrapError("MYSQL_RUNTIME_BOOTSTRAP_PRINCIPALS_NOT_DISTINCT");
    }
    usernames.add(principal.username);
    passwords.add(principal.password);
  }

  const createStatements = PRINCIPAL_ROLES.map((role) => statement(
    `CREATE USER ${accounts[role]} IDENTIFIED WITH caching_sha2_password BY ?`,
    [input.principals[role].password]
  ));

  const prepareMigrationStatements = [
    schemaGrant(
      input.database,
      MIGRATOR_SCHEMA_PRIVILEGES,
      accounts.DEFINER
    ),
  ];

  const runtimeGrantStatements = [
    routineGrant(input.database, ROUTINES.REGISTRAR[input.registrationMode], accounts.REGISTRAR),
    ...ROUTINES.CONTROL_LEDGER_REGISTRAR.map((routine) => (
      routineGrant(input.database, routine, accounts.REGISTRAR)
    )),
    ...READ_TABLES.REGISTRAR.map((table) => (
      tableGrant(input.database, ["SELECT"], table, accounts.REGISTRAR)
    )),
    ...ROUTINES.WORKER.map((routine) => (
      routineGrant(input.database, routine, accounts.WORKER)
    )),
    ...READ_TABLES.WORKER.map((table) => (
      tableGrant(input.database, ["SELECT"], table, accounts.WORKER)
    )),
    ...ROUTINES.INSPECTOR.map((routine) => (
      routineGrant(input.database, routine, accounts.INSPECTOR)
    )),
  ];

  const allRoutines = Object.freeze([
    ROUTINES.REGISTRAR.DRY_RUN,
    ROUTINES.REGISTRAR.CONTROLLED,
    ...ROUTINES.WORKER,
    ...ROUTINES.INSPECTOR,
    ...ROUTINES.CONTROL_LEDGER_REGISTRAR,
  ]);
  if (new Set(allRoutines).size !== allRoutines.length) {
    throw bootstrapError("MYSQL_RUNTIME_BOOTSTRAP_ROUTINE_SET_INVALID");
  }
  const sealDefinerStatements = [
    statement(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${accounts.DEFINER}`),
    tableGrant(input.database, ["SELECT", "INSERT", "UPDATE"], "v1_runtime_cycle", accounts.DEFINER),
    tableGrant(input.database, ["SELECT", "INSERT"], "v1_runtime_alert", accounts.DEFINER),
    tableGrant(input.database, ["SELECT"], "v1_runtime_alert_registration_authority", accounts.DEFINER),
    tableGrant(input.database, ["SELECT", "INSERT", "UPDATE"], "v1_runtime_alert_delivery", accounts.DEFINER),
    ...allRoutines.map((routine) => routineGrant(input.database, routine, accounts.DEFINER)),
    statement(`ALTER USER ${accounts.DEFINER} ACCOUNT LOCK`),
  ];
  const verificationStatements = Object.freeze(PRINCIPAL_ROLES.map((role) => statement(
    `SHOW GRANTS FOR ${accounts[role]}`
  )));
  const definerVerificationStatements = Object.freeze(allRoutines.map((routine) => statement(
    `SELECT ROUTINE_NAME AS routine_name,
            DEFINER AS routine_definer,
            SECURITY_TYPE AS security_type
     FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ?
       AND ROUTINE_NAME = ?
       AND ROUTINE_TYPE = 'PROCEDURE'`,
    [input.database, routine]
  )));
  const cleanupStatements = Object.freeze([...PRINCIPAL_ROLES].reverse().map((role) => statement(
    `DROP USER IF EXISTS ${accounts[role]}`
  )));

  return Object.freeze({
    format: "myroot-mysql-runtime-principal-bootstrap:v1",
    database: input.database,
    registrationMode: input.registrationMode,
    createStatements: Object.freeze(createStatements),
    prepareMigrationStatements: Object.freeze(prepareMigrationStatements),
    runtimeGrantStatements: Object.freeze(runtimeGrantStatements),
    sealDefinerStatements: Object.freeze(sealDefinerStatements),
    verificationStatements,
    definerVerificationStatements,
    cleanupStatements,
    publicSummary: Object.freeze({
      principalCount: PRINCIPAL_ROLES.length,
      prepareMigrationStatementCount: prepareMigrationStatements.length,
      runtimeGrantStatementCount: runtimeGrantStatements.length,
      sealDefinerStatementCount: sealDefinerStatements.length,
      definerRoutineCount: allRoutines.length,
      lockedDefinerCount: 1,
      cleanupStatementCount: cleanupStatements.length,
      containsCredentialValues: false,
      createsDatabase: false,
      modifiesProduction: false,
      requiresMigrationsExecutedAsDefiner: true,
    }),
  });
}

module.exports = {
  PRINCIPAL_ROLES,
  createMysqlRuntimePrincipalBootstrapPlan,
};
