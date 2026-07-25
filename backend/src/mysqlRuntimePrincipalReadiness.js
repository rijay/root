const {
  ROUTINES,
  evaluateMysqlRuntimeAlertAuthorityGrantRows,
} = require("./mysqlRuntimeAlertAuthorityPolicy");

const REGISTRATION_MODES = Object.freeze(["DRY_RUN", "CONTROLLED"]);
const IDENTITY_SQL = `
  SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account
`;

function readinessError() {
  const error = new Error("MySQL runtime principal readiness configuration is invalid");
  error.code = "MYSQL_RUNTIME_PRINCIPAL_READINESS_CONFIGURATION_INVALID";
  return error;
}

function databaseName(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/.test(value);
}

function currentUser(value) {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 288
    && value.includes("@")
    && /^[\x21-\x7e]+$/.test(value);
}

function poolLike(value) {
  return Boolean(value && typeof value.getConnection === "function");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resultRows(packet) {
  const rows = Array.isArray(packet) ? packet[0] : null;
  if (!Array.isArray(rows)) throw readinessError();
  return rows;
}

function singleRow(packet) {
  const rows = resultRows(packet);
  if (rows.length !== 1 || !plainRecord(rows[0])) throw readinessError();
  return rows[0];
}

function roleSpec(role, pool, expectedCurrentUser, routines, registrationMode = "") {
  if (!poolLike(pool) || !currentUser(expectedCurrentUser)
    || !Array.isArray(routines) || routines.length < 1
    || routines.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name))
    || new Set(routines).size !== routines.length) throw readinessError();
  return Object.freeze({
    role,
    pool,
    expectedCurrentUser,
    registrationMode,
    routines: Object.freeze([...routines]),
  });
}

function publicStatus(input) {
  return Object.freeze({
    enabled: input.enabled === true,
    ready: input.ready === true,
    requiredRoleCount: Number(input.requiredRoleCount || 0),
    verifiedRoleCount: Number(input.verifiedRoleCount || 0),
    requiredRoutineCount: Number(input.requiredRoutineCount || 0),
    verifiedRoutineCount: Number(input.verifiedRoutineCount || 0),
    issueCount: Number(input.issueCount || 0),
  });
}

function assertMysqlRuntimePrincipalReadinessStatus(value, expectedEnabled) {
  if (!plainRecord(value)
    || typeof value.enabled !== "boolean"
    || value.enabled !== expectedEnabled
    || typeof value.ready !== "boolean"
    || !Number.isSafeInteger(value.requiredRoleCount)
    || !Number.isSafeInteger(value.verifiedRoleCount)
    || !Number.isSafeInteger(value.requiredRoutineCount)
    || !Number.isSafeInteger(value.verifiedRoutineCount)
    || !Number.isSafeInteger(value.issueCount)
    || Object.values(value).some((item) => typeof item === "number" && item < 0)) {
    throw readinessError();
  }
  const disabledValid = !value.enabled
    && value.ready
    && value.requiredRoleCount === 0
    && value.verifiedRoleCount === 0
    && value.requiredRoutineCount === 0
    && value.verifiedRoutineCount === 0
    && value.issueCount === 0;
  const enabledValid = value.enabled
    && [2, 3].includes(value.requiredRoleCount)
    && value.requiredRoutineCount > 0
    && value.verifiedRoleCount <= value.requiredRoleCount
    && value.verifiedRoutineCount <= value.requiredRoutineCount
    && value.issueCount === value.requiredRoleCount - value.verifiedRoleCount
    && value.ready === (
      value.verifiedRoleCount === value.requiredRoleCount
      && value.verifiedRoutineCount === value.requiredRoutineCount
      && value.issueCount === 0
    );
  if (!disabledValid && !enabledValid) throw readinessError();
  return value;
}

function disabledMysqlRuntimePrincipalReadinessStatus() {
  return publicStatus({ enabled: false, ready: true });
}

async function retire(connection, destroy) {
  if (!connection) return;
  if (destroy) {
    if (typeof connection.destroy === "function") await connection.destroy();
    return;
  }
  if (typeof connection.release !== "function") throw readinessError();
  await connection.release();
}

function routineInspectionSql(routineCount) {
  if (!Number.isSafeInteger(routineCount) || routineCount < 1) throw readinessError();
  return `
    SELECT ROUTINE_NAME AS routine_name, SECURITY_TYPE AS security_type
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = ?
      AND ROUTINE_TYPE = 'PROCEDURE'
      AND ROUTINE_NAME IN (${Array(routineCount).fill("?").join(", ")})
    ORDER BY ROUTINE_NAME
  `;
}

async function inspectRole(spec, database) {
  let connection;
  let destroy = false;
  try {
    connection = await spec.pool.getConnection();
    const identity = singleRow(await connection.execute(IDENTITY_SQL));
    if (identity.database_name !== database
      || identity.authenticated_account !== spec.expectedCurrentUser) throw readinessError();

    const grants = resultRows(await connection.query("SHOW GRANTS"));
    const grantStatus = evaluateMysqlRuntimeAlertAuthorityGrantRows(grants, {
      role: spec.role,
      database,
      ...(spec.role === "REGISTRAR"
        ? { registrationMode: spec.registrationMode }
        : {}),
    });
    if (grantStatus.ready !== true) throw readinessError();

    const routineRows = resultRows(await connection.execute(
      routineInspectionSql(spec.routines.length),
      [database, ...spec.routines]
    ));
    if (routineRows.length !== spec.routines.length) throw readinessError();
    const observed = new Set();
    for (const row of routineRows) {
      if (!plainRecord(row)
        || typeof row.routine_name !== "string"
        || row.security_type !== "DEFINER"
        || observed.has(row.routine_name)) throw readinessError();
      observed.add(row.routine_name);
    }
    if (spec.routines.some((name) => !observed.has(name))) throw readinessError();
    await retire(connection, false);
    connection = null;
    return Object.freeze({ ready: true, verifiedRoutineCount: observed.size });
  } catch {
    destroy = true;
    return Object.freeze({ ready: false, verifiedRoutineCount: 0 });
  } finally {
    if (connection) {
      try { await retire(connection, destroy); } catch {}
    }
  }
}

function createMysqlRuntimePrincipalReadiness(options = {}) {
  if (!plainRecord(options)
    || !databaseName(options.database)
    || !REGISTRATION_MODES.includes(options.registrationMode)) throw readinessError();
  const specs = [
    roleSpec(
      "REGISTRAR",
      options.registrarPool,
      options.registrarCurrentUser,
      [
        ROUTINES.REGISTRAR[options.registrationMode],
        ...ROUTINES.CONTROL_LEDGER_REGISTRAR,
      ],
      options.registrationMode
    ),
    roleSpec(
      "INSPECTOR",
      options.inspectorPool,
      options.inspectorCurrentUser,
      ROUTINES.INSPECTOR
    ),
  ];
  if (options.registrationMode === "CONTROLLED") {
    specs.splice(1, 0, roleSpec(
      "WORKER",
      options.workerPool,
      options.workerCurrentUser,
      ROUTINES.WORKER
    ));
  } else if (options.workerPool || options.workerCurrentUser) {
    throw readinessError();
  }
  if (new Set(specs.map((spec) => spec.pool)).size !== specs.length
    || new Set(specs.map((spec) => spec.expectedCurrentUser)).size !== specs.length) {
    throw readinessError();
  }
  const requiredRoutineCount = specs.reduce(
    (total, spec) => total + spec.routines.length,
    0
  );
  let status = publicStatus({
    enabled: true,
    ready: false,
    requiredRoleCount: specs.length,
    requiredRoutineCount,
    issueCount: specs.length,
  });

  async function inspect() {
    const results = await Promise.all(specs.map((spec) => inspectRole(spec, options.database)));
    const verifiedRoleCount = results.filter((result) => result.ready).length;
    const verifiedRoutineCount = results.reduce(
      (total, result) => total + result.verifiedRoutineCount,
      0
    );
    status = publicStatus({
      enabled: true,
      ready: verifiedRoleCount === specs.length
        && verifiedRoutineCount === requiredRoutineCount,
      requiredRoleCount: specs.length,
      verifiedRoleCount,
      requiredRoutineCount,
      verifiedRoutineCount,
      issueCount: specs.length - verifiedRoleCount,
    });
    return status;
  }

  return Object.freeze({
    getStatus: () => status,
    inspect,
  });
}

module.exports = {
  assertMysqlRuntimePrincipalReadinessStatus,
  createMysqlRuntimePrincipalReadiness,
  disabledMysqlRuntimePrincipalReadinessStatus,
};
