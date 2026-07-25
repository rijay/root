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
  createMysqlV1RuntimeControlLedger,
} = require("../src/mysqlV1RuntimeControlLedger");

const ENABLED = process.env.V1_RUNTIME_LEDGER_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_v1_runtime_ledger_it_";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const EXPECTED_LAST_MIGRATION = "066_v1_runtime_alert_delivery_severity_slo_authority.sql";
const EXPECTED_MIGRATION_COUNT = 66;
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const RESULT_A = "c".repeat(64);

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("V1_RUNTIME_LEDGER_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("V1_RUNTIME_LEDGER_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_v1_runtime_ledger_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("V1_RUNTIME_LEDGER_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("V1_RUNTIME_LEDGER_INTEGRATION_PORT_INVALID");
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

function createRuntimePool(serverConfig, database) {
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

function createLedger(pool, database, environmentId) {
  return createMysqlV1RuntimeControlLedger({
    pool,
    env: {
      MYSQL_DATABASE: database,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: environmentId,
    },
  });
}

function claimInput(scheduleId, overrides = {}) {
  return Object.freeze({
    scheduleId,
    scheduledAt: "2026-07-17T08:00:00.000Z",
    inputDigest: DIGEST_A,
    leaseOwner: "runtime-integration-owner",
    leaseSeconds: 30,
    ...overrides,
  });
}

async function closePool(pool, cleanupErrors) {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
}

test("integration database guards reject remote hosts and production-style names", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.production.internal" }),
    { code: "V1_RUNTIME_LEDGER_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_production",
    "myroot_live",
    "myroot_candidate",
    "myroot_staging",
    "myroot_v1_runtime_ledger_it_prod_deadbeefdeadbeef",
    "myroot_v1_runtime_ledger_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "V1_RUNTIME_LEDGER_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(createDatabaseName(), /^myroot_v1_runtime_ledger_it_[0-9]+_[0-9a-f]{16}$/);
});

test("real MySQL ledger preserves cross-pool claim uniqueness, lifecycle inspection, and stale recovery", {
  skip: ENABLED ? false : "set V1_RUNTIME_LEDGER_INTEGRATION_ENABLED=true on the isolated MySQL 8 CI server",
  timeout: 60_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const environmentId = `ledger-it-${crypto.randomBytes(8).toString("hex")}`;
  const migrationFiles = listMigrationFiles();
  assert.equal(migrationFiles.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(migrationFiles[0], "001_store_snapshot.sql");
  assert.equal(migrationFiles.at(-1), EXPECTED_LAST_MIGRATION);
  assert.deepEqual(
    migrationFiles.map((file) => file.slice(0, 3)),
    Array.from({ length: EXPECTED_MIGRATION_COUNT }, (_, index) => String(index + 1).padStart(3, "0"))
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

    poolA = createRuntimePool(serverConfig, database);
    poolB = createRuntimePool(serverConfig, database);
    const migrationState = await applyMysqlMigrations(poolA, {
      database,
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(migrationState.versions.length, EXPECTED_MIGRATION_COUNT);
    assert.equal(migrationState.latestVersion, EXPECTED_LAST_MIGRATION);

    const ledgerA = createLedger(poolA, database, environmentId);
    const ledgerB = createLedger(poolB, database, environmentId);
    const sameScheduleInput = claimInput("ledger-it-concurrent-schedule");
    const competingClaims = await Promise.allSettled([
      ledgerA.claimCycle(sameScheduleInput),
      ledgerB.claimCycle(sameScheduleInput),
    ]);
    const fulfilledClaims = competingClaims
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const rejectedClaims = competingClaims.filter((result) => result.status === "rejected");
    const firstClaim = fulfilledClaims[0];
    assert.ok(firstClaim, "at least one competing claimant must acquire the durable cycle");
    assert.equal(fulfilledClaims.filter((claim) => claim.outcome === "CLAIMED").length, 1);
    for (const rejected of rejectedClaims) {
      assert.equal(rejected.reason && rejected.reason.code, "V1_RUNTIME_LEDGER_PERSISTENCE_FAILED");
    }
    assert.equal(firstClaim.cycleId.length, 64);
    assert.equal(firstClaim.environmentId, environmentId);
    assert.equal(firstClaim.scheduleId, sameScheduleInput.scheduleId);

    // InnoDB may resolve an absent-row gap-lock race by choosing one transaction
    // as a deadlock victim. A fresh cross-pool retry must still converge to the
    // same persisted identity and never create a second schedule occurrence.
    const replay = await ledgerB.claimCycle(sameScheduleInput);
    assert.equal(replay.outcome, "REPLAY");
    assert.equal(replay.cycleId, firstClaim.cycleId);
    const [claimCountRows] = await poolA.execute(
      `SELECT COUNT(*) AS cycle_count, COUNT(DISTINCT runtime_cycle_id) AS identity_count
       FROM v1_runtime_cycle WHERE environment_id = ? AND schedule_id = ?`,
      [environmentId, sameScheduleInput.scheduleId]
    );
    assert.equal(Number(claimCountRows[0].cycle_count), 1);
    assert.equal(Number(claimCountRows[0].identity_count), 1);

    const running = replay.status === "RUNNING" ? replay : firstClaim;
    const renewed = await ledgerB.renewCycle({
      cycleId: running.cycleId,
      leaseOwner: running.leaseOwner,
      leaseGeneration: running.leaseGeneration,
      leaseSeconds: 30,
    });
    assert.equal(renewed.leaseGeneration, running.leaseGeneration + 1);
    const finalized = await ledgerA.finalizeCycle({
      cycleId: renewed.cycleId,
      leaseOwner: renewed.leaseOwner,
      leaseGeneration: renewed.leaseGeneration,
      status: "SUCCEEDED",
      resultDigest: RESULT_A,
      blockerCount: 0,
      errorCode: null,
    });
    assert.equal(finalized.status, "SUCCEEDED");
    const safeInspection = await ledgerB.inspect({ maximumAgeSeconds: 86400 });
    assert.equal(safeInspection.databaseName, database);
    assert.equal(safeInspection.environmentId, environmentId);
    assert.equal(safeInspection.attestation.state, "SAFE");
    assert.equal(safeInspection.attestation.cycleId, finalized.cycleId);
    assert.equal(safeInspection.openAlerts.totalCount, 0);
    assert.equal(safeInspection.reviewRequiredCount, 0);

    const staleClaim = await ledgerA.claimCycle(claimInput("ledger-it-stale-schedule", {
      scheduledAt: "2026-07-17T08:01:00.000Z",
      inputDigest: DIGEST_B,
      leaseOwner: "runtime-integration-stale-owner",
      leaseSeconds: 30,
    }));
    const [expireResult] = await poolB.execute(
      `UPDATE v1_runtime_cycle
       SET lease_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3))
       WHERE environment_id = ? AND runtime_cycle_id = ? AND status = 'RUNNING'`,
      [environmentId, staleClaim.cycleId]
    );
    assert.equal(expireResult.affectedRows, 1);
    const recovery = await ledgerB.recoverStale({ limit: 10 });
    assert.deepEqual(recovery.cycleIds, [staleClaim.cycleId]);
    assert.equal(recovery.reviewRequiredCount, 1);
    assert.equal(recovery.alertCount, 1);

    const blockedInspection = await ledgerA.inspect({ maximumAgeSeconds: 86400 });
    assert.equal(blockedInspection.attestation.state, "BLOCKED");
    assert.equal(blockedInspection.attestation.latestTerminalCycleId, staleClaim.cycleId);
    assert.equal(blockedInspection.attestation.latestTerminalStatus, "REVIEW_REQUIRED");
    assert.equal(blockedInspection.openAlerts.blockerCount, 1);
    assert.equal(blockedInspection.reviewRequiredCount, 1);
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
      try {
        await serverConnection.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (databaseCreated) {
      cleanupErrors.push(integrationError("V1_RUNTIME_LEDGER_INTEGRATION_DATABASE_CLEANUP_FAILED"));
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "V1 runtime ledger integration cleanup failed");
    }
  }
});
