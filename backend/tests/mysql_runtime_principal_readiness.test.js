const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMysqlRuntimePrincipalReadiness,
  disabledMysqlRuntimePrincipalReadinessStatus,
} = require("../src/mysqlRuntimePrincipalReadiness");
const { ROUTINES } = require("../src/mysqlRuntimeAlertAuthorityPolicy");

const DATABASE = "myroot_runtime_readiness";

function grantRows(role, currentUser, registrationMode = "CONTROLLED") {
  const account = `'${currentUser.split("@")[0]}'@'${currentUser.split("@")[1]}'`;
  const routines = role === "REGISTRAR"
    ? [ROUTINES.REGISTRAR[registrationMode], ...ROUTINES.CONTROL_LEDGER_REGISTRAR]
    : role === "WORKER" ? ROUTINES.WORKER : ROUTINES.INSPECTOR;
  const tableGrants = role === "WORKER"
    ? [
      `GRANT SELECT ON \`${DATABASE}\`.\`v1_runtime_alert\` TO ${account}`,
      `GRANT SELECT ON \`${DATABASE}\`.\`v1_runtime_alert_delivery\` TO ${account}`,
    ] : [];
  return [
    { Grants: `GRANT USAGE ON *.* TO ${account}` },
    ...routines.map((routine) => ({
      Grants: `GRANT EXECUTE ON PROCEDURE \`${DATABASE}\`.\`${routine}\` TO ${account}`,
    })),
    ...tableGrants.map((Grants) => ({ Grants })),
  ];
}

function fakePool(role, currentUser, options = {}) {
  const state = { acquired: 0, released: 0, destroyed: 0 };
  return {
    state,
    async getConnection() {
      state.acquired += 1;
      return {
        async execute(sql, values = []) {
          if (sql.includes("CURRENT_USER()")) return [[{
            database_name: options.database || DATABASE,
            authenticated_account: options.currentUser || currentUser,
          }], []];
          if (sql.includes("information_schema.ROUTINES")) {
            const rows = values.slice(1).map((routine_name) => ({
              routine_name,
              security_type: options.securityType || "DEFINER",
            }));
            if (options.missingRoutine) rows.pop();
            return [rows, []];
          }
          throw new Error("unexpected execute");
        },
        async query(sql) {
          if (sql !== "SHOW GRANTS") throw new Error("unexpected query");
          const rows = grantRows(role, currentUser, options.registrationMode);
          if (options.unexpectedGrant) {
            rows.push({ Grants: `GRANT INSERT ON \`${DATABASE}\`.\`v1_runtime_alert\` TO 'extra'@'%'` });
          }
          return [rows, []];
        },
        release() { state.released += 1; },
        destroy() { state.destroyed += 1; },
      };
    },
  };
}

function controlledOptions(overrides = {}) {
  return {
    database: DATABASE,
    registrationMode: "CONTROLLED",
    registrarPool: fakePool("REGISTRAR", "runtime_registrar@%"),
    registrarCurrentUser: "runtime_registrar@%",
    workerPool: fakePool("WORKER", "runtime_worker@%"),
    workerCurrentUser: "runtime_worker@%",
    inspectorPool: fakePool("INSPECTOR", "runtime_inspector@%"),
    inspectorCurrentUser: "runtime_inspector@%",
    ...overrides,
  };
}

test("CONTROLLED readiness verifies three identities, exact grants, and DEFINER routines", async () => {
  const options = controlledOptions();
  const module = createMysqlRuntimePrincipalReadiness(options);
  assert.deepEqual(module.getStatus(), {
    enabled: true,
    ready: false,
    requiredRoleCount: 3,
    verifiedRoleCount: 0,
    requiredRoutineCount: 21,
    verifiedRoutineCount: 0,
    issueCount: 3,
  });
  const status = await module.inspect();
  assert.deepEqual(status, {
    enabled: true,
    ready: true,
    requiredRoleCount: 3,
    verifiedRoleCount: 3,
    requiredRoutineCount: 21,
    verifiedRoutineCount: 21,
    issueCount: 0,
  });
  for (const pool of [options.registrarPool, options.workerPool, options.inspectorPool]) {
    assert.deepEqual(pool.state, { acquired: 1, released: 1, destroyed: 0 });
  }
  assert.doesNotMatch(JSON.stringify(status), /runtime_(?:registrar|worker|inspector)|GRANT|PROCEDURE/);
});

test("DRY_RUN requires only Registrar and Inspector", async () => {
  const module = createMysqlRuntimePrincipalReadiness({
    database: DATABASE,
    registrationMode: "DRY_RUN",
    registrarPool: fakePool("REGISTRAR", "runtime_registrar@%", {
      registrationMode: "DRY_RUN",
    }),
    registrarCurrentUser: "runtime_registrar@%",
    inspectorPool: fakePool("INSPECTOR", "runtime_inspector@%"),
    inspectorCurrentUser: "runtime_inspector@%",
  });
  assert.deepEqual(await module.inspect(), {
    enabled: true,
    ready: true,
    requiredRoleCount: 2,
    verifiedRoleCount: 2,
    requiredRoutineCount: 12,
    verifiedRoutineCount: 12,
    issueCount: 0,
  });
});

test("identity, grant, and SECURITY_TYPE drift fail closed without leaking details", async () => {
  for (const registrarPool of [
    fakePool("REGISTRAR", "runtime_registrar@%", { currentUser: "wrong@%" }),
    fakePool("REGISTRAR", "runtime_registrar@%", { unexpectedGrant: true }),
    fakePool("REGISTRAR", "runtime_registrar@%", { securityType: "INVOKER" }),
    fakePool("REGISTRAR", "runtime_registrar@%", { missingRoutine: true }),
  ]) {
    const module = createMysqlRuntimePrincipalReadiness(controlledOptions({ registrarPool }));
    const status = await module.inspect();
    assert.equal(status.ready, false);
    assert.equal(status.verifiedRoleCount, 2);
    assert.equal(status.issueCount, 1);
    assert.equal(registrarPool.state.destroyed, 1);
    assert.doesNotMatch(JSON.stringify(status), /wrong|INSERT|INVOKER|runtime_registrar/);
  }
});

test("shared pools, shared identities, and malformed role sets are rejected", () => {
  const shared = fakePool("REGISTRAR", "runtime_registrar@%");
  assert.throws(
    () => createMysqlRuntimePrincipalReadiness(controlledOptions({
      registrarPool: shared,
      workerPool: shared,
    })),
    { code: "MYSQL_RUNTIME_PRINCIPAL_READINESS_CONFIGURATION_INVALID" }
  );
  assert.throws(
    () => createMysqlRuntimePrincipalReadiness(controlledOptions({
      workerCurrentUser: "runtime_registrar@%",
    })),
    { code: "MYSQL_RUNTIME_PRINCIPAL_READINESS_CONFIGURATION_INVALID" }
  );
  assert.deepEqual(disabledMysqlRuntimePrincipalReadinessStatus(), {
    enabled: false,
    ready: true,
    requiredRoleCount: 0,
    verifiedRoleCount: 0,
    requiredRoutineCount: 0,
    verifiedRoutineCount: 0,
    issueCount: 0,
  });
});
