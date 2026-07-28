const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MIGRATOR_SCHEMA_PRIVILEGES,
  READ_TABLES,
  ROUTINES,
  assertMysqlRuntimeAlertAuthorityGrantPolicy,
  evaluateMysqlRuntimeAlertAuthorityGrantRows,
} = require("../src/mysqlRuntimeAlertAuthorityPolicy");

const DATABASE = "myroot_candidate";
const PRIVATE_PRINCIPAL = "runtime-alert-secret-principal";

function row(statement) {
  return { [`Grants for ${PRIVATE_PRINCIPAL}@%`]: statement };
}

function grant(privileges, scope, principal = PRIVATE_PRINCIPAL) {
  return row(`GRANT ${privileges} ON ${scope} TO \`${principal}\`@\`%\``);
}

function usage() {
  return grant("USAGE", "*.*");
}

function executeGrants(names) {
  return names.map((name) => (
    grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${name}\``)
  ));
}

function evaluate(role, rows, overrides = {}) {
  return evaluateMysqlRuntimeAlertAuthorityGrantRows(rows, {
    database: DATABASE,
    role,
    ...overrides,
  });
}

test("REGISTRAR accepts exactly one fixed-mode registration procedure", () => {
  for (const mode of ["DRY_RUN", "CONTROLLED"]) {
    const status = evaluate("REGISTRAR", [
      usage(),
      grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${ROUTINES.REGISTRAR[mode]}\``),
      ...executeGrants(ROUTINES.CONTROL_LEDGER_REGISTRAR),
      ...READ_TABLES.REGISTRAR.map((name) => (
        grant("SELECT", `\`${DATABASE}\`.\`${name}\``)
      )),
    ], { registrationMode: mode });
    assert.equal(status.ready, true);
    assert.equal(status.requiredGrantCount, 10);
    assert.equal(status.matchedGrantCount, 10);
    assert.deepEqual(status.issues, []);
  }
});

test("REGISTRAR cannot receive both modes or direct table writes", () => {
  const status = evaluate("REGISTRAR", [
    usage(),
    grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${ROUTINES.REGISTRAR.DRY_RUN}\``),
    grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${ROUTINES.REGISTRAR.CONTROLLED}\``),
    grant("INSERT, UPDATE", `\`${DATABASE}\`.\`v1_runtime_alert_delivery\``),
  ], { registrationMode: "DRY_RUN" });
  assert.equal(status.ready, false);
  assert.equal(status.directBaseTableDmlCount, 2);
  assert.ok(status.issues.includes("RUNTIME_BASE_TABLE_DML"));
  assert.ok(status.issues.includes("UNEXPECTED_GRANTS"));
});

test("WORKER accepts only the complete narrow procedure and read set", () => {
  const rows = [usage(), ...ROUTINES.WORKER.map((name) => (
    grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${name}\``)
  )), ...READ_TABLES.WORKER.map((name) => (
    grant("SELECT", `\`${DATABASE}\`.\`${name}\``)
  ))];
  const status = evaluate("WORKER", rows);
  assert.equal(status.ready, true);
  assert.equal(
    status.requiredGrantCount,
    ROUTINES.WORKER.length + READ_TABLES.WORKER.length
  );
  assert.equal(status.missingGrantCount, 0);
});

test("WORKER fails closed for a missing procedure and schema privileges", () => {
  const status = evaluate("WORKER", [
    usage(),
    ...ROUTINES.WORKER.slice(0, -1).map((name) => (
      grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${name}\``)
    )),
    ...READ_TABLES.WORKER.map((name) => (
      grant("SELECT", `\`${DATABASE}\`.\`${name}\``)
    )),
    grant("UPDATE, ALTER", `\`${DATABASE}\`.*`),
  ]);
  assert.equal(status.ready, false);
  assert.equal(status.missingGrantCount, 1);
  assert.equal(status.directBaseTableDmlCount, 1);
  assert.equal(status.runtimeDdlCount, 1);
  assert.ok(status.issues.includes("REQUIRED_GRANTS_MISSING"));
  assert.ok(status.issues.includes("RUNTIME_BASE_TABLE_DML"));
  assert.ok(status.issues.includes("RUNTIME_DDL"));
  assert.ok(status.issues.includes("UNEXPECTED_GRANTS"));
});

test("INSPECTOR accepts only the aggregate inspection procedure", () => {
  const status = evaluate("INSPECTOR", [
    usage(),
    ...executeGrants(ROUTINES.INSPECTOR),
  ]);
  assert.equal(status.ready, true);
  assert.equal(status.requiredGrantCount, 2);
});

test("INSPECTOR rejects base table reads and all writes", () => {
  const status = evaluate("INSPECTOR", [
    usage(),
    grant("SELECT, DELETE", `\`${DATABASE}\`.\`v1_runtime_alert_delivery\``),
  ]);
  assert.equal(status.ready, false);
  assert.equal(status.directBaseTableDmlCount, 1);
  assert.ok(status.issues.includes("RUNTIME_BASE_TABLE_DML"));
  assert.ok(status.issues.includes("REQUIRED_GRANTS_MISSING"));
});

test("DEFINER accepts only the alert delivery and Control Ledger implementation grants", () => {
  const definerRoutines = [
    ROUTINES.REGISTRAR.DRY_RUN,
    ROUTINES.REGISTRAR.CONTROLLED,
    ...ROUTINES.CONTROL_LEDGER_REGISTRAR,
    ...ROUTINES.WORKER,
    ...ROUTINES.INSPECTOR,
  ];
  const status = evaluate("DEFINER", [
    usage(),
    ...executeGrants(definerRoutines),
    grant("SELECT, INSERT", `\`${DATABASE}\`.\`v1_runtime_alert\``),
    grant("SELECT, INSERT, UPDATE", `\`${DATABASE}\`.\`v1_runtime_cycle\``),
    grant("SELECT", `\`${DATABASE}\`.\`v1_runtime_alert_registration_authority\``),
    grant("SELECT, INSERT, UPDATE", `\`${DATABASE}\`.\`v1_runtime_alert_delivery\``),
  ]);
  assert.equal(status.ready, true);
  assert.equal(status.requiredGrantCount, 31);
  assert.equal(status.externalEvidenceRequiredCount, 1, "account lock is not proved by SHOW GRANTS");
});

test("MIGRATOR accepts the exact release-window schema matrix", () => {
  const status = evaluate("MIGRATOR", [
    usage(),
    grant(MIGRATOR_SCHEMA_PRIVILEGES.join(", "), `\`${DATABASE}\`.*`),
  ]);
  assert.equal(status.ready, true);
  assert.equal(status.requiredGrantCount, MIGRATOR_SCHEMA_PRIVILEGES.length);
  assert.equal(status.externalEvidenceRequiredCount, 1, "ephemeral release use is external evidence");
});

test("all roles reject global data privileges, cross-schema grants, and GRANT OPTION", () => {
  const status = evaluate("INSPECTOR", [
    usage(),
    ...executeGrants(ROUTINES.INSPECTOR),
    grant("SELECT", "*.*"),
    grant("SELECT", "`analytics`.`runtime_alert_delivery_inspection`"),
    row(`GRANT EXECUTE ON PROCEDURE \`${DATABASE}\`.\`${ROUTINES.INSPECTOR[0]}\` TO \`${PRIVATE_PRINCIPAL}\`@\`%\` WITH GRANT OPTION`),
  ]);
  assert.equal(status.ready, false);
  assert.ok(status.globalDataPrivilegeCount > 0);
  assert.ok(status.crossSchemaGrantCount > 0);
  assert.equal(status.grantOption, true);
  assert.ok(status.issues.includes("GLOBAL_DATA_PRIVILEGES"));
  assert.ok(status.issues.includes("CROSS_SCHEMA_GRANTS"));
  assert.ok(status.issues.includes("GRANT_OPTION"));
});

test("malformed, empty, unknown-role, and mixed-principal evidence fail closed", () => {
  assert.equal(evaluate("WORKER", []).ready, false);
  assert.equal(evaluate("UNKNOWN", [usage()]).ready, false);
  assert.equal(evaluate("REGISTRAR", [usage()], { registrationMode: "BOTH" }).ready, false);
  const mixed = evaluate("INSPECTOR", [
    usage(),
    grant("EXECUTE", `PROCEDURE \`${DATABASE}\`.\`${ROUTINES.INSPECTOR[0]}\``, "another-principal"),
  ]);
  assert.equal(mixed.ready, false);
  assert.ok(mixed.issues.includes("MULTIPLE_PRINCIPALS"));
  const malformed = evaluate("INSPECTOR", [{ unexpected: 17 }]);
  assert.equal(malformed.ready, false);
  assert.ok(malformed.issues.includes("SHOW_GRANTS_INVALID_OR_EMPTY"));
});

test("status and assertion errors never expose principal, database, objects, or grant text", () => {
  const status = evaluate("WORKER", [
    grant("ALL PRIVILEGES", "*.*"),
    grant("SELECT", "`private_other_schema`.`private_table`"),
  ]);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_PRINCIPAL));
  assert.doesNotMatch(serialized, new RegExp(DATABASE));
  assert.doesNotMatch(serialized, /private_other_schema|private_table|ALL PRIVILEGES/);
  assert.throws(
    () => assertMysqlRuntimeAlertAuthorityGrantPolicy(status),
    (error) => {
      const publicError = JSON.stringify({
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
      return error.code === "MYSQL_RUNTIME_ALERT_AUTHORITY_POLICY_BLOCKED"
        && !publicError.includes(PRIVATE_PRINCIPAL)
        && !publicError.includes(DATABASE)
        && !publicError.includes("private_other_schema")
        && !publicError.includes("private_table");
    }
  );
});
