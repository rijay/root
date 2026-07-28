const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const mysql = require("mysql2/promise");
const {
  applyMysqlMigrations,
  listMigrationFiles,
} = require("../src/mysqlMigrations");
const {
  assertDisposableSnapshotServer,
} = require("../src/mysqlSchemaSnapshot");

const ENABLED = process.env.ACTIVITY_GENERATION_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_activity_generation_it_";
const TEMP_DIRECTORY_PREFIX = "myroot-activity-generation-it-";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "db", "migrations");
const STAGED_MIGRATION = "036_activity_enrollment_event_generation_stage.sql";
const BACKFILL_MIGRATION = "037_activity_enrollment_event_generation_backfill.sql";
const ENFORCE_MIGRATION = "038_activity_enrollment_event_generation_enforce.sql";

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("ACTIVITY_GENERATION_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("ACTIVITY_GENERATION_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_activity_generation_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("ACTIVITY_GENERATION_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("ACTIVITY_GENERATION_INTEGRATION_PORT_INVALID");
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

function migrationOrdinal(fileName) {
  const match = String(fileName || "").match(/^(\d{3})_/);
  return match ? Number(match[1]) : -1;
}

function createMigrationSubsetDirectories() {
  const files = listMigrationFiles(MIGRATIONS_DIRECTORY);
  assert.equal(files[35], STAGED_MIGRATION);
  assert.equal(files[36], BACKFILL_MIGRATION);
  assert.equal(files[37], ENFORCE_MIGRATION);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX));
  const directories = {};
  for (const through of [36, 37, 38]) {
    const directory = path.join(root, `through-${String(through).padStart(3, "0")}`);
    fs.mkdirSync(directory);
    for (const fileName of files.filter((candidate) => migrationOrdinal(candidate) <= through)) {
      fs.copyFileSync(
        path.join(MIGRATIONS_DIRECTORY, fileName),
        path.join(directory, fileName)
      );
    }
    directories[through] = directory;
  }
  return Object.freeze({ root, directories: Object.freeze(directories) });
}

function removeMigrationSubsetDirectories(root) {
  const expectedPrefix = path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX);
  if (!String(root || "").startsWith(expectedPrefix)) {
    throw integrationError("ACTIVITY_GENERATION_INTEGRATION_TEMP_DIRECTORY_NOT_DISPOSABLE");
  }
  fs.rmSync(root, { recursive: true, force: true });
}

async function seedActivityFoundation(pool, suffix) {
  const rootUserId = `root-user-${suffix}`;
  const decoyRootUserId = `root-user-decoy-${suffix}`;
  const activityVersionId = `activity-version-${suffix}`;
  const sessionId = `activity-session-${suffix}`;
  await pool.execute(
    `INSERT INTO root_user (
       root_user_id, unionid, lifecycle_status, source_channel, unionid_status,
       created_at, updated_at
     ) VALUES (?, NULL, 'ACTIVE', 'MYSQL_INTEGRATION', 'MISSING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [rootUserId]
  );
  await pool.execute(
    `INSERT INTO root_user (
       root_user_id, unionid, lifecycle_status, source_channel, unionid_status,
       created_at, updated_at
     ) VALUES (?, NULL, 'ACTIVE', 'MYSQL_INTEGRATION', 'MISSING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [decoyRootUserId]
  );
  await pool.execute(
    `INSERT INTO activity_definition_version (
       activity_version_id, activity_id, version, status, title, summary,
       detail_version, city, venue_summary, activity_type, hero_asset_ref,
       privacy_notice_ref, photography_notice_ref, content_approval_ref,
       contact_owner_signer_ref, source, visibility, created_at, updated_at
     ) VALUES (
       ?, ?, 1, 'DRAFT', 'Integration activity', 'Disposable MySQL integration fact',
       'detail-v1', 'Shanghai', 'Disposable venue', 'HEALTH', 'asset:integration',
       'privacy:integration', 'photography:integration', 'content:integration',
       'signer:integration', 'OPS_BACKEND', 'MEMBER', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     )`,
    [activityVersionId, `activity-${suffix}`]
  );
  await pool.execute(
    `INSERT INTO activity_session (
       activity_session_id, activity_version_id, status, approval_mode, capacity,
       registration_open_at, registration_close_at, review_deadline,
       session_start_at, session_end_at, allow_reapply, cancel_reason,
       cancel_reason_detail, created_at, updated_at
     ) VALUES (
       ?, ?, 'OPEN', 'AUTO', 10,
       '2026-07-01 00:00:00.000', '2026-07-20 00:00:00.000', NULL,
       '2026-07-21 00:00:00.000', '2026-07-21 02:00:00.000', 1, NULL,
       NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     )`,
    [sessionId, activityVersionId]
  );
  return Object.freeze({ rootUserId, decoyRootUserId, sessionId });
}

async function seedInvalidHistory(pool, identity) {
  const enrollmentId = "activity-enrollment-invalid";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'REJECTED', 'APPROVAL_REJECTED', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  await pool.query(
    `INSERT INTO activity_enrollment_event (
       activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
       root_user_id, event_sequence, operation, from_status, to_status,
       reason_code, request_id, occurred_at
     ) VALUES
       ('invalid-event-1', ?, ?, ?, 1, 'ENROLL', NULL, 'PENDING', NULL, 'invalid-request-1', '2026-07-02 00:00:00.000'),
       ('invalid-event-2', ?, ?, ?, 2, 'REVIEW', 'CONFIRMED', 'REJECTED', 'APPROVAL_REJECTED', 'invalid-request-2', '2026-07-02 00:01:00.000')`,
    [
      enrollmentId, identity.sessionId, identity.rootUserId,
      enrollmentId, identity.sessionId, identity.rootUserId,
    ]
  );
  return enrollmentId;
}

async function seedSequenceGapHistory(pool, identity) {
  const enrollmentId = "activity-enrollment-sequence-gap";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'CANCELED', 'USER_CANCELED', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  await pool.query(
    `INSERT INTO activity_enrollment_event (
       activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
       root_user_id, event_sequence, operation, from_status, to_status,
       reason_code, request_id, occurred_at
     ) VALUES
       ('sequence-gap-event-1', ?, ?, ?, 1, 'ENROLL', NULL, 'PENDING', NULL, 'sequence-gap-request-1', '2026-07-02 00:00:00.000'),
       ('sequence-gap-event-3', ?, ?, ?, 3, 'CANCEL', 'PENDING', 'CANCELED', 'USER_CANCELED', 'sequence-gap-request-3', '2026-07-02 00:02:00.000')`,
    [
      enrollmentId, identity.sessionId, identity.rootUserId,
      enrollmentId, identity.sessionId, identity.rootUserId,
    ]
  );
  return enrollmentId;
}

async function seedRootUserMismatchHistory(pool, identity) {
  const enrollmentId = "activity-enrollment-root-mismatch";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'PENDING', NULL, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  await pool.execute(
    `INSERT INTO activity_enrollment_event (
       activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
       root_user_id, event_sequence, operation, from_status, to_status,
       reason_code, request_id, occurred_at
     ) VALUES (
       'root-mismatch-event-1', ?, ?, ?, 1, 'ENROLL', NULL, 'PENDING',
       NULL, 'root-mismatch-request-1', '2026-07-02 00:00:00.000'
     )`,
    [enrollmentId, identity.sessionId, identity.decoyRootUserId]
  );
  return enrollmentId;
}

async function seedEnrollmentWithoutEvents(pool, identity) {
  const enrollmentId = "activity-enrollment-no-events";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'PENDING', NULL, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  return enrollmentId;
}

async function seedStoredGenerationConflictHistory(pool, identity) {
  const enrollmentId = "activity-enrollment-generation-conflict";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'PENDING', NULL, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  await pool.execute(
    `INSERT INTO activity_enrollment_event (
       activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
       root_user_id, attempt_generation, event_sequence, operation, from_status,
       to_status, reason_code, request_id, occurred_at
     ) VALUES (
       'generation-conflict-event-1', ?, ?, ?, 2, 1, 'ENROLL', NULL,
       'PENDING', NULL, 'generation-conflict-request-1', '2026-07-02 00:00:00.000'
     )`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  return enrollmentId;
}

async function seedValidReapplicationHistory(pool, identity) {
  const enrollmentId = "activity-enrollment-valid";
  await pool.execute(
    `INSERT INTO activity_enrollment (
       activity_enrollment_id, activity_session_id, root_user_id, status,
       reason_code, attempt_generation, created_at, updated_at
     ) VALUES (?, ?, ?, 'CONFIRMED', NULL, 2, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [enrollmentId, identity.sessionId, identity.rootUserId]
  );
  await pool.query(
    `INSERT INTO activity_enrollment_event (
       activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
       root_user_id, event_sequence, operation, from_status, to_status,
       reason_code, request_id, occurred_at
     ) VALUES
       ('valid-event-1', ?, ?, ?, 1, 'ENROLL', NULL, 'PENDING', NULL, 'valid-request-1', '2026-07-03 00:00:00.000'),
       ('valid-event-2', ?, ?, ?, 2, 'CANCEL', 'PENDING', 'CANCELED', 'USER_CANCELED', 'valid-request-2', '2026-07-03 00:01:00.000'),
       ('valid-event-3', ?, ?, ?, 3, 'ENROLL', 'CANCELED', 'PENDING', NULL, 'valid-request-3', '2026-07-03 00:02:00.000'),
       ('valid-event-4', ?, ?, ?, 4, 'REVIEW', 'PENDING', 'CONFIRMED', NULL, 'valid-request-4', '2026-07-03 00:03:00.000')`,
    [
      enrollmentId, identity.sessionId, identity.rootUserId,
      enrollmentId, identity.sessionId, identity.rootUserId,
      enrollmentId, identity.sessionId, identity.rootUserId,
      enrollmentId, identity.sessionId, identity.rootUserId,
    ]
  );
  return enrollmentId;
}

async function generations(pool, enrollmentId) {
  const [rows] = await pool.execute(
    `SELECT event_sequence, attempt_generation
     FROM activity_enrollment_event
     WHERE activity_enrollment_id = ?
     ORDER BY event_sequence`,
    [enrollmentId]
  );
  return rows.map((row) => ({
    eventSequence: Number(row.event_sequence),
    attemptGeneration: row.attempt_generation === null ? null : Number(row.attempt_generation),
  }));
}

async function enrollmentEventRows(pool, enrollmentId) {
  const [rows] = await pool.execute(
    `SELECT
       activity_enrollment_event_id,
       activity_enrollment_id,
       activity_session_id,
       root_user_id,
       attempt_generation,
       event_sequence,
       operation,
       from_status,
       to_status,
       reason_code,
       request_id,
       occurred_at
     FROM activity_enrollment_event
     WHERE activity_enrollment_id = ?
     ORDER BY event_sequence`,
    [enrollmentId]
  );
  return rows.map((row) => ({ ...row }));
}

async function durableEnrollmentState(pool, enrollmentId) {
  const [enrollmentRows] = await pool.execute(
    `SELECT
       activity_enrollment_id,
       activity_session_id,
       root_user_id,
       status,
       reason_code,
       attempt_generation,
       created_at,
       updated_at
     FROM activity_enrollment
     WHERE activity_enrollment_id = ?`,
    [enrollmentId]
  );
  assert.equal(enrollmentRows.length, 1);
  return Object.freeze({
    enrollment: Object.freeze({ ...enrollmentRows[0] }),
    events: Object.freeze(await enrollmentEventRows(pool, enrollmentId)),
  });
}

async function assertBackfillFixtureRejected(pool, options) {
  assert.equal(await ledgerCount(pool, BACKFILL_MIGRATION), 0);
  const before = await durableEnrollmentState(pool, options.enrollmentId);
  await assert.rejects(
    () => applyMysqlMigrations(pool, {
      database: options.database,
      migrationsDir: options.migrationsDir,
      migrationLockTimeoutSeconds: 10,
    }),
    (error) => error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062),
    `${options.scenario} must fail closed before the permanent 037 UPDATE`
  );
  assert.equal(await ledgerCount(pool, BACKFILL_MIGRATION), 0);
  assert.deepEqual(
    await durableEnrollmentState(pool, options.enrollmentId),
    before,
    `${options.scenario} must leave the enrollment and all durable event fields unchanged`
  );
}

async function removeEnrollmentFixture(pool, enrollmentId) {
  await pool.execute(
    "DELETE FROM activity_enrollment_event WHERE activity_enrollment_id = ?",
    [enrollmentId]
  );
  const [enrollmentDelete] = await pool.execute(
    "DELETE FROM activity_enrollment WHERE activity_enrollment_id = ?",
    [enrollmentId]
  );
  assert.equal(enrollmentDelete.affectedRows, 1);
}

async function ledgerCount(pool, migration) {
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS ledger_count FROM schema_migrations WHERE version = ?",
    [migration]
  );
  return Number(rows[0].ledger_count);
}

async function closePool(pool, cleanupErrors) {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
}

test("activity generation integration guards reject remote hosts and production-style databases", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.production.internal" }),
    { code: "ACTIVITY_GENERATION_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_activity_generation_it_prod_deadbeefdeadbeef",
    "myroot_activity_generation_it_candidate_deadbeefdeadbeef",
    "myroot_activity_generation_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "ACTIVITY_GENERATION_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(createDatabaseName(), /^myroot_activity_generation_it_[0-9]+_[0-9a-f]{16}$/);
});

test("real MySQL 8 validates Activity generation fail-close backfill, replay, and enforced constraints", {
  skip: ENABLED
    ? false
    : "set ACTIVITY_GENERATION_MYSQL_INTEGRATION_ENABLED=true on the isolated MySQL 8 CI server",
  timeout: 120_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const migrationSubsets = createMigrationSubsetDirectories();
  let serverConnection;
  let pool;
  let databaseCreated = false;
  const cleanupErrors = [];
  try {
    serverConnection = await mysql.createConnection(serverConfig);
    await assertDisposableSnapshotServer(serverConnection);
    const [versionRows] = await serverConnection.query("SELECT VERSION() AS server_version");
    assert.match(String(versionRows[0].server_version || ""), /^8\.0\./);
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`
    );
    databaseCreated = true;
    pool = createPool(serverConfig, database);

    const staged = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: migrationSubsets.directories[36],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(staged.latestVersion, STAGED_MIGRATION);
    assert.equal(staged.versions.length, 36);

    const identity = await seedActivityFoundation(pool, crypto.randomBytes(4).toString("hex"));
    const invalidFixtures = [
      {
        scenario: "state-chain mismatch",
        seed: seedInvalidHistory,
      },
      {
        scenario: "event_sequence gap",
        seed: seedSequenceGapHistory,
      },
      {
        scenario: "event root_user/enrollment mismatch",
        seed: seedRootUserMismatchHistory,
      },
      {
        scenario: "durable enrollment without an initial ENROLL event",
        seed: seedEnrollmentWithoutEvents,
      },
      {
        scenario: "stored/derived attempt_generation conflict",
        seed: seedStoredGenerationConflictHistory,
      },
    ];
    for (const fixture of invalidFixtures) {
      const enrollmentId = await fixture.seed(pool, identity);
      await assertBackfillFixtureRejected(pool, {
        database,
        migrationsDir: migrationSubsets.directories[37],
        enrollmentId,
        scenario: fixture.scenario,
      });
      await removeEnrollmentFixture(pool, enrollmentId);
    }

    const validEnrollmentId = await seedValidReapplicationHistory(pool, identity);
    const backfilled = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: migrationSubsets.directories[37],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(backfilled.latestVersion, BACKFILL_MIGRATION);
    assert.deepEqual(await generations(pool, validEnrollmentId), [
      { eventSequence: 1, attemptGeneration: 1 },
      { eventSequence: 2, attemptGeneration: 1 },
      { eventSequence: 3, attemptGeneration: 2 },
      { eventSequence: 4, attemptGeneration: 2 },
    ]);

    const beforeReplay = await enrollmentEventRows(pool, validEnrollmentId);
    const [ledgerDelete] = await pool.execute(
      "DELETE FROM schema_migrations WHERE version = ?",
      [BACKFILL_MIGRATION]
    );
    assert.equal(ledgerDelete.affectedRows, 1);
    const replayed = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: migrationSubsets.directories[37],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(replayed.latestVersion, BACKFILL_MIGRATION);
    assert.equal(await ledgerCount(pool, BACKFILL_MIGRATION), 1);
    assert.deepEqual(
      await enrollmentEventRows(pool, validEnrollmentId),
      beforeReplay,
      "a missing 037 ledger row must replay without changing already-derived durable rows"
    );

    const enforced = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: migrationSubsets.directories[38],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(enforced.latestVersion, ENFORCE_MIGRATION);
    const [columnRows] = await pool.execute(
      `SELECT
         IS_NULLABLE AS is_nullable,
         COLUMN_TYPE AS column_type
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name = 'activity_enrollment_event'
         AND column_name = 'attempt_generation'`,
      [database]
    );
    assert.equal(columnRows.length, 1);
    assert.equal(columnRows[0].is_nullable, "NO");
    assert.equal(columnRows[0].column_type, "int unsigned");
    const [constraintRows] = await pool.execute(
      `SELECT
         CONSTRAINT_NAME AS constraint_name,
         ENFORCED AS enforced
       FROM information_schema.table_constraints
       WHERE table_schema = ?
         AND table_name = 'activity_enrollment_event'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'chk_activity_enrollment_event_generation'`,
      [database]
    );
    assert.deepEqual(constraintRows.map((row) => ({
      constraintName: row.constraint_name,
      enforced: row.enforced,
    })), [{
      constraintName: "chk_activity_enrollment_event_generation",
      enforced: "YES",
    }]);

    const insertGeneration = (eventId, requestId, generation) => pool.execute(
      `INSERT INTO activity_enrollment_event (
         activity_enrollment_event_id, activity_enrollment_id, activity_session_id,
         root_user_id, attempt_generation, event_sequence, operation, from_status,
         to_status, reason_code, request_id, occurred_at
       ) VALUES (?, ?, ?, ?, ?, 5, 'CANCEL', 'CONFIRMED', 'CANCELED',
         'USER_CANCELED', ?, '2026-07-03 00:04:00.000')`,
      [eventId, validEnrollmentId, identity.sessionId, identity.rootUserId, generation, requestId]
    );
    await assert.rejects(
      () => insertGeneration("constraint-null-event", "constraint-null-request", null),
      (error) => error && (error.code === "ER_BAD_NULL_ERROR" || error.errno === 1048)
    );
    await assert.rejects(
      () => insertGeneration("constraint-zero-event", "constraint-zero-request", 0),
      (error) => error && (error.code === "ER_CHECK_CONSTRAINT_VIOLATED" || error.errno === 3819)
    );
    const [rejectedRows] = await pool.query(
      `SELECT COUNT(*) AS rejected_count
       FROM activity_enrollment_event
       WHERE activity_enrollment_event_id IN ('constraint-null-event', 'constraint-zero-event')`
    );
    assert.equal(Number(rejectedRows[0].rejected_count), 0);
  } finally {
    await closePool(pool, cleanupErrors);
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
    try {
      removeMigrationSubsetDirectories(migrationSubsets.root);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (databaseCreated) {
      cleanupErrors.push(integrationError("ACTIVITY_GENERATION_INTEGRATION_DATABASE_CLEANUP_FAILED"));
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Activity generation integration cleanup failed");
    }
  }
});
