const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMysqlRuntimePrincipalBootstrapPlan,
} = require("../src/mysqlRuntimePrincipalBootstrap");

function input(overrides = {}) {
  return {
    database: "myroot_runtime_principal_it_123_0123456789abcdef",
    registrationMode: "CONTROLLED",
    principals: {
      DEFINER: {
        username: "myroot_it_definer",
        host: "127.0.0.1",
        password: "definer-local-only-0123456789abcdef",
      },
      REGISTRAR: {
        username: "myroot_it_registrar",
        host: "127.0.0.1",
        password: "registrar-local-only-0123456789abcdef",
      },
      WORKER: {
        username: "myroot_it_worker",
        host: "127.0.0.1",
        password: "worker-local-only-0123456789abcdef",
      },
      INSPECTOR: {
        username: "myroot_it_inspector",
        host: "127.0.0.1",
        password: "inspector-local-only-0123456789abcdef",
      },
    },
    ...overrides,
  };
}

test("bootstrap freezes an executable prepare, migrate, seal, verify, and cleanup contract", () => {
  const plan = createMysqlRuntimePrincipalBootstrapPlan(input());
  assert.equal(plan.format, "myroot-mysql-runtime-principal-bootstrap:v1");
  assert.equal(plan.createStatements.length, 4);
  assert.equal(plan.prepareMigrationStatements.length, 1);
  assert.equal(plan.runtimeGrantStatements.length, 23);
  assert.equal(plan.sealDefinerStatements.length, 28);
  assert.equal(plan.verificationStatements.length, 4);
  assert.equal(plan.definerVerificationStatements.length, 22);
  assert.equal(plan.cleanupStatements.length, 4);
  assert.deepEqual(plan.publicSummary, {
    principalCount: 4,
    prepareMigrationStatementCount: 1,
    runtimeGrantStatementCount: 23,
    sealDefinerStatementCount: 28,
    definerRoutineCount: 22,
    lockedDefinerCount: 1,
    cleanupStatementCount: 4,
    containsCredentialValues: false,
    createsDatabase: false,
    modifiesProduction: false,
    requiresMigrationsExecutedAsDefiner: true,
  });
});

test("credential values are parameterized and absent from the public contract", () => {
  const source = input();
  const plan = createMysqlRuntimePrincipalBootstrapPlan(source);
  for (const statement of plan.createStatements) {
    assert.match(statement.sql, /IDENTIFIED WITH caching_sha2_password BY \?$/);
    assert.equal(statement.values.length, 1);
  }
  const publicMaterial = JSON.stringify({
    summary: plan.publicSummary,
    sql: [
      ...plan.createStatements,
      ...plan.prepareMigrationStatements,
      ...plan.runtimeGrantStatements,
      ...plan.sealDefinerStatements,
      ...plan.verificationStatements,
      ...plan.definerVerificationStatements,
      ...plan.cleanupStatements,
    ].map((item) => item.sql),
  });
  for (const principal of Object.values(source.principals)) {
    assert.equal(publicMaterial.includes(principal.password), false);
  }
});

test("the migration creator is sealed in place instead of using an invalid definer rebind", () => {
  const plan = createMysqlRuntimePrincipalBootstrapPlan(input());
  assert.match(plan.prepareMigrationStatements[0].sql, /^GRANT .*CREATE ROUTINE.* ON `[^`]+`\.\*/);
  assert.match(plan.prepareMigrationStatements[0].sql, /CREATE TEMPORARY TABLES/);
  assert.match(plan.sealDefinerStatements[0].sql, /^REVOKE ALL PRIVILEGES, GRANT OPTION FROM/);
  assert.match(plan.sealDefinerStatements.at(-1).sql, /ALTER USER .* ACCOUNT LOCK$/);
  const allSql = [
    ...plan.prepareMigrationStatements,
    ...plan.runtimeGrantStatements,
    ...plan.sealDefinerStatements,
  ].map((item) => item.sql).join("\n");
  assert.doesNotMatch(allSql, /ALTER\s+DEFINER/i);
  assert.doesNotMatch(allSql, /GRANT OPTION TO/i);
  assert.doesNotMatch(allSql, / ON \*\.\*/);
  assert.equal(plan.definerVerificationStatements.every((item) => (
    /FROM information_schema\.ROUTINES/.test(item.sql)
      && /DEFINER AS routine_definer/.test(item.sql)
      && /SECURITY_TYPE AS security_type/.test(item.sql)
      && /ROUTINE_SCHEMA = \?/.test(item.sql)
      && /ROUTINE_NAME = \?/.test(item.sql)
      && item.values.length === 2
      && item.values[0] === input().database
      && /^[a-z][a-z0-9_]{0,63}$/.test(item.values[1])
  )), true);
  assert.equal(
    new Set(plan.definerVerificationStatements.map((item) => item.values[1])).size,
    22
  );
});

test("runtime principals receive no direct table writes or schema privileges", () => {
  const plan = createMysqlRuntimePrincipalBootstrapPlan(input());
  const runtimeSql = plan.runtimeGrantStatements.map((item) => item.sql).join("\n");
  assert.doesNotMatch(runtimeSql, /GRANT (?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)/);
  assert.doesNotMatch(runtimeSql, / ON `[^`]+`\.\*/);
  assert.match(runtimeSql, /GRANT EXECUTE ON PROCEDURE/);
  assert.doesNotMatch(runtimeSql, /GRANT SELECT ON .* TO 'myroot_it_registrar'/);
});

test("private Docker bridge hosts are accepted without widening principal matching", () => {
  const dockerBridge = input();
  for (const principal of Object.values(dockerBridge.principals)) {
    principal.host = "172.17.0.1";
  }
  const plan = createMysqlRuntimePrincipalBootstrapPlan(dockerBridge);
  assert.match(plan.createStatements[0].sql, /@'172\.17\.0\.1'/);

  for (const unsafeHost of ["%", "0.0.0.0", "8.8.8.8", "host.docker.internal"] ) {
    const unsafe = input();
    for (const principal of Object.values(unsafe.principals)) principal.host = unsafeHost;
    assert.throws(
      () => createMysqlRuntimePrincipalBootstrapPlan(unsafe),
      (error) => error.code === "MYSQL_RUNTIME_BOOTSTRAP_PRINCIPAL_INVALID"
    );
  }
});

test("non-disposable targets, malformed modes, and shared identities fail closed", () => {
  for (const bad of [
    { database: "myroot_production" },
    { registrationMode: "BOTH" },
    { extra: true },
  ]) {
    assert.throws(
      () => createMysqlRuntimePrincipalBootstrapPlan(input(bad)),
      (error) => error.code === "MYSQL_RUNTIME_BOOTSTRAP_INPUT_INVALID"
    );
  }
  const sharedUser = input();
  sharedUser.principals.WORKER.username = sharedUser.principals.REGISTRAR.username;
  assert.throws(
    () => createMysqlRuntimePrincipalBootstrapPlan(sharedUser),
    (error) => error.code === "MYSQL_RUNTIME_BOOTSTRAP_PRINCIPALS_NOT_DISTINCT"
  );
  const sharedPassword = input();
  sharedPassword.principals.INSPECTOR.password = sharedPassword.principals.WORKER.password;
  assert.throws(
    () => createMysqlRuntimePrincipalBootstrapPlan(sharedPassword),
    (error) => error.code === "MYSQL_RUNTIME_BOOTSTRAP_PRINCIPALS_NOT_DISTINCT"
  );
});
