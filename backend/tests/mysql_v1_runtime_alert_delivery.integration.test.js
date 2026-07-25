const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const mysql = require("mysql2/promise");
const {
  applyMysqlMigrations,
  listMigrationFiles,
} = require("../src/mysqlMigrations");
const {
  assertDisposableSnapshotServer,
} = require("../src/mysqlSchemaSnapshot");
const {
  createMysqlV1RuntimeAlertDeliveryAdapter,
} = require("../src/mysqlV1RuntimeAlertDeliveryAdapter");

const ENABLED = process.env.V1_RUNTIME_ALERT_DELIVERY_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_runtime_alert_delivery_it_";
const FORBIDDEN_DATABASE_TOKENS =
  /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const EXPECTED_LAST_MIGRATION = "066_v1_runtime_alert_delivery_severity_slo_authority.sql";
const EXPECTED_MIGRATION_COUNT = 66;
const DIGEST_SCHEME = "hmac-sha256:v1";
const ENVIRONMENT_ID = "runtime-alert-delivery-integration";
const RECEIVER_BINDING_REF = "runtime-alert-integration-receiver-v1";

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("RUNTIME_ALERT_DELIVERY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("RUNTIME_ALERT_DELIVERY_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_runtime_alert_delivery_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("RUNTIME_ALERT_DELIVERY_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("RUNTIME_ALERT_DELIVERY_INTEGRATION_PORT_INVALID");
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

function createDatabaseName() {
  return assertDisposableDatabaseName(
    `${DATABASE_PREFIX}${process.pid}_${crypto.randomBytes(8).toString("hex")}`
  );
}

function digest(label) {
  return crypto.createHash("sha256").update(String(label), "utf8").digest("hex");
}

function createPool(serverConfig, database) {
  return mysql.createPool({
    ...serverConfig,
    database,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 0,
    namedPlaceholders: false,
    dateStrings: true,
  });
}

function deliveryEnv(database, mode) {
  return Object.freeze({
    NODE_ENV: "test",
    MYSQL_DATABASE: database,
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT_ID,
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: mode,
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MAXIMUM_ATTEMPTS: "3",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_BACKOFF_SECONDS: "1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: RECEIVER_BINDING_REF,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT:
      "https://receiver.example.invalid/runtime-alert-integration",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET:
      "receiver-secret-material-runtime-alert-integration-2026",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-material-runtime-alert-integration-2026",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-it-v1",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-material-runtime-alert-integration-2026",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-it-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY:
      "receipt-digest-material-runtime-alert-integration-2026",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID: "runtime-alert-receipt-it-v1",
  });
}

function alertInput(identity, severity = "BLOCKER") {
  return Object.freeze({
    runtimeAlertId: identity.runtimeAlertId,
    environmentId: ENVIRONMENT_ID,
    alertCode: severity === "BLOCKER"
      ? "V1_RUNTIME_CYCLE_STALE"
      : "V1_RUNTIME_CYCLE_WARNING",
    severity,
    observedAt: "2026-07-19T00:00:00.000Z",
  });
}

async function seedAlert(pool, suffix, severity = "BLOCKER") {
  const runtimeCycleId = digest(`runtime-alert-cycle:${suffix}`);
  const runtimeAlertId = digest(`runtime-alert:${suffix}`);
  const inputDigest = digest(`runtime-alert-input:${suffix}`);
  const scheduleId = `runtime-alert-schedule-${suffix}`;
  await pool.execute(
    `INSERT INTO v1_runtime_cycle (
       runtime_cycle_id, environment_id, schedule_id, scheduled_at, input_digest,
       status, lease_owner, lease_expires_at, lease_generation, claim_digest,
       finalization_digest, result_digest, blocker_count, error_code, claimed_at,
       completed_at, created_at, updated_at
     ) VALUES (
       ?, ?, ?, '2026-07-19 00:00:00.000', ?,
       'SUCCEEDED', NULL, NULL, 1, ?, ?, ?, 0, NULL,
       '2026-07-19 00:00:00.000', '2026-07-19 00:00:01.000',
       '2026-07-19 00:00:00.000', '2026-07-19 00:00:01.000'
     )`,
    [
      runtimeCycleId,
      ENVIRONMENT_ID,
      scheduleId,
      inputDigest,
      digest(`runtime-alert-claim:${suffix}`),
      digest(`runtime-alert-finalization:${suffix}`),
      digest(`runtime-alert-result:${suffix}`),
    ]
  );
  await pool.execute(
    `INSERT INTO v1_runtime_alert (
       runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
       input_digest, alert_code, severity, dedupe_digest, observed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
       '2026-07-19 00:00:00.000', '2026-07-19 00:00:00.000')`,
    [
      runtimeAlertId,
      runtimeCycleId,
      ENVIRONMENT_ID,
      scheduleId,
      inputDigest,
      severity === "BLOCKER" ? "V1_RUNTIME_CYCLE_STALE" : "V1_RUNTIME_CYCLE_WARNING",
      severity,
      digest(`runtime-alert-dedupe:${suffix}`),
    ]
  );
  return Object.freeze({ runtimeCycleId, runtimeAlertId, scheduleId, suffix });
}

async function registerInTransaction(pool, adapter, input) {
  const connection = await pool.getConnection();
  let began = false;
  try {
    // The production orchestration Module enters registration with a UTC
    // session. Keep this direct-Adapter harness on the same Interface so
    // DATETIME availability values are comparable with worker claims.
    await connection.execute("SET time_zone = ?", ["+00:00"]);
    await connection.beginTransaction();
    began = true;
    const result = await adapter.registerAlertInTransaction(connection, input);
    await connection.commit();
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try { await connection.rollback(); } catch {}
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertAuthority(pool, adapter, generation) {
  const binding = adapter.payloadAdapter.binding;
  await pool.execute(
    `INSERT INTO v1_runtime_alert_registration_authority (
       environment_id, authority_generation, registration_mode,
       receiver_binding_authority_version, receiver_binding_ref,
       receiver_binding_digest, receiver_binding_digest_scheme,
       receiver_binding_digest_key_id, status, activated_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       authority_generation = VALUES(authority_generation),
       registration_mode = VALUES(registration_mode),
       receiver_binding_authority_version = VALUES(receiver_binding_authority_version),
       receiver_binding_ref = VALUES(receiver_binding_ref),
       receiver_binding_digest = VALUES(receiver_binding_digest),
       receiver_binding_digest_scheme = VALUES(receiver_binding_digest_scheme),
       receiver_binding_digest_key_id = VALUES(receiver_binding_digest_key_id),
       status = 'ACTIVE',
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      ENVIRONMENT_ID,
      generation,
      adapter.mode,
      binding.authorityVersion,
      binding.ref,
      binding.digest,
      binding.digestScheme,
      binding.keyId,
    ]
  );
}

async function expectMysqlErrno(operation, errno) {
  await assert.rejects(operation, (error) => Number(error && error.errno) === errno);
}

function informationSchemaConstraintName(row) {
  return row.constraint_name ?? row.CONSTRAINT_NAME;
}

async function closePool(pool, cleanupErrors) {
  if (!pool) return;
  try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
}

test("integration guards reject remote hosts and non-disposable database names", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.candidate.internal" }),
    { code: "RUNTIME_ALERT_DELIVERY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_runtime_alert_delivery_it_candidate_deadbeefdeadbeef",
    "myroot_runtime_alert_delivery_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "RUNTIME_ALERT_DELIVERY_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(
    createDatabaseName(),
    /^myroot_runtime_alert_delivery_it_[0-9]+_[0-9a-f]{16}$/
  );
  assert.equal(informationSchemaConstraintName({ CONSTRAINT_NAME: "PRIMARY" }), "PRIMARY");
});

test("real MySQL enforces runtime alert delivery authority and transaction fencing", {
  skip: ENABLED
    ? false
    : "set V1_RUNTIME_ALERT_DELIVERY_MYSQL_INTEGRATION_ENABLED=true on an isolated local disposable MySQL 8 server",
  timeout: 120_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const migrationFiles = listMigrationFiles();
  assert.equal(migrationFiles.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(migrationFiles[0], "001_store_snapshot.sql");
  assert.equal(migrationFiles.at(-1), EXPECTED_LAST_MIGRATION);
  assert.deepEqual(
    migrationFiles.map((file) => file.slice(0, 3)),
    Array.from(
      { length: EXPECTED_MIGRATION_COUNT },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );

  let serverConnection;
  let poolA;
  let poolB;
  let databaseCreated = false;
  const cleanupErrors = [];
  try {
    serverConnection = await mysql.createConnection(serverConfig);
    await assertDisposableSnapshotServer(serverConnection);
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`
    );
    databaseCreated = true;
    poolA = createPool(serverConfig, database);
    poolB = createPool(serverConfig, database);

    const migrationState = await applyMysqlMigrations(poolA, {
      database,
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(migrationState.versions.length, EXPECTED_MIGRATION_COUNT);
    assert.equal(migrationState.latestVersion, EXPECTED_LAST_MIGRATION);

    const [constraintRows] = await poolA.execute(
      `SELECT CONSTRAINT_NAME AS constraint_name,
              CONSTRAINT_TYPE AS constraint_type
       FROM information_schema.table_constraints
       WHERE table_schema = ? AND table_name = 'v1_runtime_alert_delivery'
       ORDER BY constraint_name`,
      [database]
    );
    const constraintNames = new Set(constraintRows.map(informationSchemaConstraintName));
    for (const name of [
      "PRIMARY",
      "uk_v1_runtime_alert_delivery_alert_authority",
      "fk_v1_runtime_alert_delivery_alert",
      "chk_v1_runtime_alert_delivery_status",
      "chk_v1_runtime_alert_delivery_identity",
      "chk_v1_runtime_alert_delivery_authority",
      "chk_v1_runtime_alert_delivery_payload",
      "chk_v1_runtime_alert_delivery_slo",
      "chk_v1_runtime_alert_delivery_attempts",
      "chk_v1_runtime_alert_delivery_receipt",
      "chk_v1_runtime_alert_delivery_error",
      "chk_v1_runtime_alert_delivery_state",
    ]) assert.equal(constraintNames.has(name), true, `missing real MySQL constraint ${name}`);

    const controlledA = createMysqlV1RuntimeAlertDeliveryAdapter({
      pool: poolA,
      env: deliveryEnv(database, "CONTROLLED"),
    });
    const controlledB = createMysqlV1RuntimeAlertDeliveryAdapter({
      pool: poolB,
      env: deliveryEnv(database, "CONTROLLED"),
    });
    const dryRun = createMysqlV1RuntimeAlertDeliveryAdapter({
      pool: poolA,
      env: deliveryEnv(database, "DRY_RUN"),
    });

    await upsertAuthority(poolA, controlledA, 1);
    const missingAlertInput = alertInput({ runtimeAlertId: digest("missing-alert") });
    await expectMysqlErrno(
      () => registerInTransaction(poolA, controlledA, missingAlertInput),
      1644
    );

    await upsertAuthority(poolA, dryRun, 2);
    const dryIdentity = await seedAlert(poolA, "dry-run");
    const dryRegistration = await registerInTransaction(
      poolA,
      dryRun,
      alertInput(dryIdentity)
    );
    assert.equal(dryRegistration.registrationMode, "DRY_RUN");
    await assert.rejects(
      () => dryRun.claimNext({ leaseOwner: "dry-run-owner", leaseSeconds: 30 }),
      { code: "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID" }
    );
    assert.equal(
      await controlledA.claimNext({ leaseOwner: "controlled-owner-before-row", leaseSeconds: 30 }),
      null
    );
    const [dryRows] = await poolA.execute(
      `SELECT registration_mode, status, attempt_count, lease_generation
       FROM v1_runtime_alert_delivery WHERE runtime_alert_id = ?`,
      [dryIdentity.runtimeAlertId]
    );
    assert.deepEqual(dryRows, [{
      registration_mode: "DRY_RUN",
      status: "PENDING",
      attempt_count: 0,
      lease_generation: 0,
    }]);
    await assert.rejects(
      () => registerInTransaction(poolB, controlledB, alertInput(dryIdentity)),
      { code: "V1_RUNTIME_ALERT_DELIVERY_CONFLICT" }
    );

    // Migration 063 moves runtime writes behind procedures, but a privileged
    // migration account can still bypass that Interface. The successful
    // UPDATE below is deliberately rolled back and remains a grants Gate.
    // The successful UPDATE below is deliberately rolled back and remains a
    // grants Gate: production evidence must prove that no runtime principal can
    // bypass the controlled Adapter Interface for authority columns.
    const grantProbe = await poolA.getConnection();
    let grantProbeTransactionOpen = false;
    try {
      await grantProbe.beginTransaction();
      grantProbeTransactionOpen = true;
      const [promotion] = await grantProbe.execute(
        `UPDATE v1_runtime_alert_delivery
         SET registration_mode = 'CONTROLLED', updated_at = CURRENT_TIMESTAMP(3)
         WHERE runtime_alert_id = ? AND registration_mode = 'DRY_RUN'`,
        [dryIdentity.runtimeAlertId]
      );
      assert.equal(promotion.affectedRows, 1);
      await grantProbe.rollback();
      grantProbeTransactionOpen = false;
    } finally {
      if (grantProbeTransactionOpen) {
        try { await grantProbe.rollback(); } catch {}
      }
      grantProbe.release();
    }

    await upsertAuthority(poolA, controlledA, 3);
    const controlledIdentity = await seedAlert(poolA, "controlled-concurrent");
    const controlledInput = alertInput(controlledIdentity);
    const registrationRace = await Promise.allSettled([
      registerInTransaction(poolA, controlledA, controlledInput),
      registerInTransaction(poolB, controlledB, controlledInput),
    ]);
    const registrationSuccesses = registrationRace
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    assert.equal(
      registrationSuccesses.filter((result) => result.outcome === "REGISTERED").length,
      1
    );
    const replay = await registerInTransaction(poolB, controlledB, controlledInput);
    assert.equal(replay.outcome, "REPLAY");
    const [authorityRows] = await poolA.execute(
      `SELECT COUNT(*) AS row_count, COUNT(DISTINCT runtime_alert_delivery_id) AS identity_count
       FROM v1_runtime_alert_delivery WHERE runtime_alert_id = ?`,
      [controlledIdentity.runtimeAlertId]
    );
    assert.equal(Number(authorityRows[0].row_count), 1);
    assert.equal(Number(authorityRows[0].identity_count), 1);

    const claimRace = await Promise.all([
      controlledA.claimNext({ leaseOwner: "runtime-alert-worker-a", leaseSeconds: 30 }),
      controlledB.claimNext({ leaseOwner: "runtime-alert-worker-b", leaseSeconds: 30 }),
    ]);
    const claims = claimRace.filter(Boolean);
    assert.equal(claims.length, 1);
    const claim = claims[0];
    assert.equal(claim.status, "CLAIMED");
    assert.equal(claim.attemptCount, 1);
    assert.equal(claim.leaseGeneration, 1);

    const winner = claim.leaseOwner === "runtime-alert-worker-a" ? controlledA : controlledB;
    const started = await winner.markProviderStarted({
      deliveryId: claim.deliveryId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
    });
    assert.equal(started.status, "STARTED");
    const delivered = await winner.completeDelivered({
      deliveryId: started.deliveryId,
      leaseOwner: started.leaseOwner,
      leaseGeneration: started.leaseGeneration,
      receiptDigest: digest("runtime-alert-integration-receipt"),
      receiptDigestScheme: DIGEST_SCHEME,
      receiptDigestKeyId: "runtime-alert-receipt-it-v1",
    });
    assert.equal(delivered.status, "DELIVERED");
    assert.equal(
      await controlledA.claimNext({ leaseOwner: "terminal-reclaim-owner", leaseSeconds: 30 }),
      null
    );

    await expectMysqlErrno(
      () => poolA.execute(
        `UPDATE v1_runtime_alert_delivery
         SET status = 'PENDING', stable_error_code = 'ILLEGAL_STATE_SHAPE'
         WHERE runtime_alert_delivery_id = ?`,
        [delivered.deliveryId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => poolA.execute(
        `INSERT INTO v1_runtime_alert_delivery (
           runtime_alert_delivery_id, runtime_alert_id, environment_id,
           registration_mode, receiver_binding_authority_version,
           receiver_binding_ref, receiver_binding_digest,
           receiver_binding_digest_scheme, receiver_binding_digest_key_id,
           payload_schema_version, payload_canonical_version, payload_digest,
           payload_digest_scheme, payload_digest_key_id, slo_class,
           slo_target_seconds, retry_policy_version, maximum_attempts,
           status, attempt_count, available_at, lease_generation,
           created_at, updated_at
         ) SELECT
           ?, runtime_alert_id, environment_id, registration_mode,
           receiver_binding_authority_version, receiver_binding_ref,
           receiver_binding_digest, receiver_binding_digest_scheme,
           receiver_binding_digest_key_id, payload_schema_version,
           payload_canonical_version, payload_digest, payload_digest_scheme,
           payload_digest_key_id, slo_class, slo_target_seconds,
           retry_policy_version, maximum_attempts, 'PENDING', 0,
           CURRENT_TIMESTAMP(3), 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
         FROM v1_runtime_alert_delivery WHERE runtime_alert_id = ?`,
        [digest("duplicate-delivery-id"), controlledIdentity.runtimeAlertId]
      ),
      1062
    );
  } finally {
    await closePool(poolB, cleanupErrors);
    await closePool(poolA, cleanupErrors);
    if (serverConnection && databaseCreated) {
      try {
        assertDisposableDatabaseName(database);
        await serverConnection.query(`DROP DATABASE ${quoteIdentifier(database)}`);
        databaseCreated = false;
        await assertDisposableSnapshotServer(serverConnection);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (serverConnection) {
      try { await serverConnection.end(); } catch (error) { cleanupErrors.push(error); }
    }
    if (databaseCreated) {
      cleanupErrors.push(
        integrationError("RUNTIME_ALERT_DELIVERY_INTEGRATION_DATABASE_CLEANUP_FAILED")
      );
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Runtime alert delivery integration cleanup failed");
    }
  }
});
