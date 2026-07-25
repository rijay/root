const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const mysql = require("mysql2/promise");
const { applyMysqlMigrations } = require("../src/mysqlMigrations");
const {
  evaluateMysqlRuntimeAlertAuthorityGrantRows,
} = require("../src/mysqlRuntimeAlertAuthorityPolicy");
const {
  createMysqlRuntimePrincipalBootstrapPlan,
} = require("../src/mysqlRuntimePrincipalBootstrap");
const {
  RECEIVER_BINDING_AUTHORITY_VERSION,
} = require("../src/v1RuntimeAlertPayloadAdapter");
const {
  runtimeAlertDeliverySloForSeverity,
} = require("../src/v1RuntimeAlertDeliveryPolicy");

const ENABLED = process.env.MYSQL_RUNTIME_PRINCIPAL_BOOTSTRAP_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_runtime_principal_it_";
const FORBIDDEN_DATABASE_TOKENS =
  /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;

function harnessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw harnessError("MYSQL_RUNTIME_PRINCIPAL_HARNESS_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(String(value || ""))) {
    throw harnessError("MYSQL_RUNTIME_PRINCIPAL_HARNESS_IDENTIFIER_INVALID");
  }
  return `\`${value}\``;
}

function assertDisposableDatabase(database) {
  if (!database.startsWith(DATABASE_PREFIX)
    || !/^myroot_runtime_principal_it_[0-9]+_[0-9a-f]{16}$/.test(database)
    || FORBIDDEN_DATABASE_TOKENS.test(database)) {
    throw harnessError("MYSQL_RUNTIME_PRINCIPAL_HARNESS_DATABASE_NOT_DISPOSABLE");
  }
  return database;
}

function serverConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw harnessError("MYSQL_RUNTIME_PRINCIPAL_HARNESS_PORT_INVALID");
  }
  return Object.freeze({
    host,
    port,
    user: String(env.SCHEMA_SNAPSHOT_MYSQL_USER || "root"),
    password: String(env.SCHEMA_SNAPSHOT_MYSQL_PASSWORD || ""),
    charset: "utf8mb4",
    timezone: "+08:00",
  });
}

function secret(role) {
  return `${role}-${crypto.randomBytes(24).toString("base64url")}`;
}

function digest(label) {
  return crypto.createHash("sha256").update(String(label), "utf8").digest("hex");
}

function principals(suffix, host = "127.0.0.1") {
  return Object.freeze({
    DEFINER: Object.freeze({ username: `it_def_${suffix}`, host, password: secret("def") }),
    REGISTRAR: Object.freeze({ username: `it_reg_${suffix}`, host, password: secret("reg") }),
    WORKER: Object.freeze({ username: `it_wrk_${suffix}`, host, password: secret("wrk") }),
    INSPECTOR: Object.freeze({ username: `it_ins_${suffix}`, host, password: secret("ins") }),
  });
}

async function executeStatements(connection, statements) {
  for (const item of statements) await connection.query(item.sql, item.values);
}

function pool(config, database, principal) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: principal.username,
    password: principal.password,
    database,
    connectionLimit: 2,
    waitForConnections: true,
    queueLimit: 0,
    dateStrings: true,
  });
}

test("principal harness guards reject remote and non-disposable targets", () => {
  assert.throws(
    () => serverConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.example.com" }),
    (error) => error.code === "MYSQL_RUNTIME_PRINCIPAL_HARNESS_NON_LOCAL_HOST_FORBIDDEN"
  );
  for (const database of ["myroot_prod", "myroot_runtime_principal_it_manual"] ) {
    assert.throws(
      () => assertDisposableDatabase(database),
      (error) => error.code === "MYSQL_RUNTIME_PRINCIPAL_HARNESS_DATABASE_NOT_DISPOSABLE"
    );
  }
});

test("real MySQL seals the migration creator and enforces cross-role procedure authority", {
  skip: !ENABLED && "set MYSQL_RUNTIME_PRINCIPAL_BOOTSTRAP_INTEGRATION_ENABLED=true on isolated localhost MySQL 8",
}, async () => {
  const config = serverConfig();
  const suffix = crypto.randomBytes(4).toString("hex");
  const database = assertDisposableDatabase(
    `${DATABASE_PREFIX}${process.pid}_${crypto.randomBytes(8).toString("hex")}`
  );
  const admin = await mysql.createConnection(config);
  let roles;
  let plan;
  let migrationPool;
  const runtimePools = [];
  try {
    const [sessionRows] = await admin.query(
      "SELECT SUBSTRING_INDEX(USER(), '@', -1) AS client_host"
    );
    const accountHost = String(sessionRows[0] && sessionRows[0].client_host || "");
    roles = principals(suffix, accountHost);
    plan = createMysqlRuntimePrincipalBootstrapPlan({
      database,
      registrationMode: "CONTROLLED",
      principals: roles,
    });
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
    await executeStatements(admin, plan.createStatements);
    await executeStatements(admin, plan.prepareMigrationStatements);

    migrationPool = pool(config, database, roles.DEFINER);
    const migration = await applyMysqlMigrations(migrationPool);
    assert.equal(migration.latestVersion,
      "066_v1_runtime_alert_delivery_severity_slo_authority.sql");
    await migrationPool.end();
    migrationPool = null;

    await executeStatements(admin, plan.runtimeGrantStatements);
    await executeStatements(admin, plan.sealDefinerStatements);

    const roleOptions = {
      REGISTRAR: { registrationMode: "CONTROLLED" },
      WORKER: {},
      INSPECTOR: {},
      DEFINER: {},
    };
    for (const role of ["REGISTRAR", "WORKER", "INSPECTOR", "DEFINER"]) {
      const [rows] = await admin.query(plan.verificationStatements[
        ["DEFINER", "REGISTRAR", "WORKER", "INSPECTOR"].indexOf(role)
      ].sql);
      const status = evaluateMysqlRuntimeAlertAuthorityGrantRows(rows, {
        role,
        database,
        ...roleOptions[role],
      });
      assert.equal(status.ready, true, `${role}:${status.issues.join(",")}`);
    }

    const [locked] = await admin.query(
      "SELECT account_locked FROM mysql.user WHERE user = ? AND host = ?",
      [roles.DEFINER.username, roles.DEFINER.host]
    );
    assert.deepEqual(locked, [{ account_locked: "Y" }]);

    for (const item of plan.definerVerificationStatements) {
      const [rows] = await admin.query(item.sql, item.values);
      assert.deepEqual(rows, [{
        routine_name: item.values[1],
        routine_definer: `${roles.DEFINER.username}@${roles.DEFINER.host}`,
        security_type: "DEFINER",
      }]);
    }

    const environmentId = "runtime-principal-harness";
    const runtimeCycleId = digest(`principal-cycle:${suffix}`);
    const runtimeAlertId = digest(`principal-alert:${suffix}`);
    const runtimeAlertDeliveryId = digest(`principal-delivery:${suffix}`);
    const inputDigest = digest(`principal-input:${suffix}`);
    await admin.query(
      `INSERT INTO ${quoteIdentifier(database)}.v1_runtime_cycle (
         runtime_cycle_id, environment_id, schedule_id, scheduled_at, input_digest,
         status, lease_generation, claim_digest, finalization_digest, result_digest,
         blocker_count, claimed_at, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, CURRENT_TIMESTAMP(3), ?, 'SUCCEEDED', 1, ?, ?, ?, 0,
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        runtimeCycleId,
        environmentId,
        `principal-schedule-${suffix}`,
        inputDigest,
        digest(`principal-claim:${suffix}`),
        digest(`principal-finalization:${suffix}`),
        digest(`principal-result:${suffix}`),
      ]
    );
    await admin.query(
      `INSERT INTO ${quoteIdentifier(database)}.v1_runtime_alert (
         runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
         input_digest, alert_code, severity, dedupe_digest, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'V1_RUNTIME_CYCLE_STALE', 'BLOCKER', ?,
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        runtimeAlertId,
        runtimeCycleId,
        environmentId,
        `principal-schedule-${suffix}`,
        inputDigest,
        digest(`principal-dedupe:${suffix}`),
      ]
    );
    await admin.query(
      `INSERT INTO ${quoteIdentifier(database)}.v1_runtime_alert_registration_authority (
         environment_id, authority_generation, registration_mode,
         receiver_binding_authority_version, receiver_binding_ref,
         receiver_binding_digest, receiver_binding_digest_scheme,
         receiver_binding_digest_key_id, status, activated_at, updated_at
       ) VALUES (?, 1, 'CONTROLLED', ?, ?, ?,
         'hmac-sha256:v1', 'principal-binding-key-v1', 'ACTIVE',
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        environmentId,
        RECEIVER_BINDING_AUTHORITY_VERSION,
        `principal-receiver-${suffix}`,
        digest(`principal-binding:${suffix}`),
      ]
    );

    const registrarPool = pool(config, database, roles.REGISTRAR);
    const workerPool = pool(config, database, roles.WORKER);
    const inspectorPool = pool(config, database, roles.INSPECTOR);
    runtimePools.push(registrarPool, workerPool, inspectorPool);
    const registrar = await registrarPool.getConnection();
    const worker = await workerPool.getConnection();
    const inspector = await inspectorPool.getConnection();
    try {
      for (const [connection, expected] of [
        [registrar, roles.REGISTRAR],
        [worker, roles.WORKER],
        [inspector, roles.INSPECTOR],
      ]) {
        const [rows] = await connection.query(
          "SELECT CURRENT_USER() AS authenticated_account"
        );
        assert.equal(rows[0].authenticated_account, `${expected.username}@${expected.host}`);
      }
      await assert.rejects(
        () => registrar.query("INSERT INTO v1_runtime_alert (runtime_alert_id) VALUES ('forbidden')"),
        (error) => error && [1142, 1143].includes(error.errno)
      );
      await assert.rejects(
        () => registrar.query("SELECT * FROM v1_runtime_alert_delivery LIMIT 1"),
        (error) => error && [1142, 1143].includes(error.errno)
      );

      const blockerSlo = runtimeAlertDeliverySloForSeverity("BLOCKER");
      const warningSlo = runtimeAlertDeliverySloForSeverity("WARNING");
      const registrationArguments = [
        runtimeAlertDeliveryId,
        runtimeAlertId,
        environmentId,
        digest(`principal-payload:${suffix}`),
        "principal-payload-key-v1",
        blockerSlo.sloClass,
        blockerSlo.sloTargetSeconds,
        3,
      ];
      await assert.rejects(
        () => registrar.query(
          "CALL v1_runtime_alert_delivery_register_controlled(?, ?, ?, ?, ?, ?, ?, ?)",
          [
            ...registrationArguments.slice(0, 5),
            warningSlo.sloClass,
            warningSlo.sloTargetSeconds,
            registrationArguments[7],
          ]
        ),
        (error) => error && error.errno === 1644
          && error.sqlMessage === "V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED"
      );
      const [registration] = await registrar.query(
        "CALL v1_runtime_alert_delivery_register_controlled(?, ?, ?, ?, ?, ?, ?, ?)",
        registrationArguments
      );
      assert.equal(registration[0][0].operation_outcome, "REGISTERED");
      assert.equal(registration[0][0].runtime_alert_delivery_id, runtimeAlertDeliveryId);
      assert.equal(registration[0][0].runtime_alert_id, runtimeAlertId);
      assert.equal(registration[0][0].registration_mode, "CONTROLLED");

      for (const unauthorized of [worker, inspector]) {
        await assert.rejects(
          () => unauthorized.query(
            "CALL v1_runtime_alert_delivery_register_controlled(?, ?, ?, ?, ?, ?, ?, ?)",
            registrationArguments
          ),
          (error) => error && error.errno === 1370
        );
      }
      await assert.rejects(
        () => registrar.query(
          "CALL v1_runtime_alert_delivery_register_dry_run(?, ?, ?, ?, ?, ?, ?, ?)",
          registrationArguments
        ),
        (error) => error && error.errno === 1370
      );
      await assert.rejects(
        () => registrar.query(
          "CALL v1_runtime_alert_delivery_mark_provider_started(?, ?, ?, ?)",
          [runtimeAlertDeliveryId, "forbidden-worker", 1, digest(`principal-start:${suffix}`)]
        ),
        (error) => error && error.errno === 1370
      );
      const [inspection] = await inspector.query(
        "CALL v1_runtime_control_ledger_inspect_snapshot(?)",
        ["principal-harness"]
      );
      assert.equal(Array.isArray(inspection[0]), true);
      await assert.rejects(
        () => inspector.query("CALL v1_runtime_control_ledger_claim_cycle(?, ?, ?, ?, ?, ?, ?, ?)", [
          "principal-harness", "0".repeat(64), "forbidden", new Date(), "1".repeat(64),
          "forbidden", 30, "2".repeat(64),
        ]),
        (error) => error && error.errno === 1370
      );
    } finally {
      registrar.release();
      worker.release();
      inspector.release();
    }
  } finally {
    if (migrationPool) await migrationPool.end().catch(() => {});
    await Promise.all(runtimePools.map((item) => item.end().catch(() => {})));
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`).catch(() => {});
    if (plan) await executeStatements(admin, plan.cleanupStatements).catch(() => {});
    await admin.end();
  }
});
