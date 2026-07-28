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
const { assertDisposableSnapshotServer } = require("../src/mysqlSchemaSnapshot");

const ENABLED = process.env.ACTIVITY_P0_POLICY_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_activity_p0_policy_it_";
const TEMP_DIRECTORY_PREFIX = "myroot-activity-p0-policy-it-";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "db", "migrations");
const LAST_MIGRATION = "045_activity_session_policy_enforce.sql";

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("ACTIVITY_P0_POLICY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("ACTIVITY_P0_POLICY_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_activity_p0_policy_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("ACTIVITY_P0_POLICY_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("ACTIVITY_P0_POLICY_INTEGRATION_PORT_INVALID");
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

function migrationOrdinal(fileName) {
  const match = String(fileName || "").match(/^(\d{3})_/);
  return match ? Number(match[1]) : -1;
}

function createMigrationSubsets() {
  const files = listMigrationFiles(MIGRATIONS_DIRECTORY);
  assert.equal(files[44], LAST_MIGRATION);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX));
  const directories = {};
  for (const through of [39, 40, 45]) {
    const directory = path.join(root, `through-${through}`);
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

function removeMigrationSubsets(root) {
  const expectedPrefix = path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX);
  if (!String(root || "").startsWith(expectedPrefix)) {
    throw integrationError("ACTIVITY_P0_POLICY_INTEGRATION_TEMP_DIRECTORY_NOT_DISPOSABLE");
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function createPool(serverConfig, database) {
  return mysql.createPool({
    ...serverConfig,
    database,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 0,
    dateStrings: true,
  });
}

async function seedDuplicateSessionHistory(pool, suffix) {
  const activityVersionId = `activity-version-${suffix}`;
  await pool.execute(
    `INSERT INTO activity_definition_version (
       activity_version_id, activity_id, version, status, title, summary,
       detail_version, city, venue_summary, activity_type, hero_asset_ref,
       privacy_notice_ref, photography_notice_ref, content_approval_ref,
       contact_owner_signer_ref, source, visibility, created_at, updated_at
     ) VALUES (
       ?, ?, 1, 'DRAFT', 'P0 policy integration', 'Disposable historical row',
       'detail-v1', 'Shanghai', 'Disposable venue', 'HEALTH', 'asset:integration',
       'privacy:integration', 'photography:integration', 'content:integration',
       'signer:integration', 'OPS_BACKEND', 'MEMBER', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     )`,
    [activityVersionId, `activity-${suffix}`]
  );
  for (const index of [1, 2]) {
    await pool.execute(
      `INSERT INTO activity_session (
         activity_session_id, activity_version_id, status, approval_mode, capacity,
         registration_open_at, registration_close_at, review_deadline,
         session_start_at, session_end_at, allow_reapply, created_at, updated_at
       ) VALUES (
         ?, ?, 'OPEN', 'AUTO', 10,
         '2026-07-01 00:00:00.000', '2026-07-20 00:00:00.000', NULL,
         '2026-07-21 00:00:00.000', '2026-07-21 02:00:00.000', 1,
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       )`,
      [`activity-session-${suffix}-${index}`, activityVersionId]
    );
  }
  return Object.freeze({
    activityVersionId,
    retainedSessionId: `activity-session-${suffix}-1`,
    duplicateSessionId: `activity-session-${suffix}-2`,
  });
}

async function expectMysqlError(operation, errno) {
  await assert.rejects(operation, (error) => Number(error && error.errno) === errno);
}

test("integration guards reject remote hosts and non-disposable database names", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.candidate.internal" }),
    { code: "ACTIVITY_P0_POLICY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_activity_p0_policy_it_candidate_deadbeefdeadbeef",
    "myroot_activity_p0_policy_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "ACTIVITY_P0_POLICY_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(createDatabaseName(), /^myroot_activity_p0_policy_it_[0-9]+_[0-9a-f]{16}$/);
});

test("real MySQL safely upgrades 039 through 045 and enforces Activity/Task contracts", {
  skip: ENABLED ? false : "set ACTIVITY_P0_POLICY_MYSQL_INTEGRATION_ENABLED=true on an isolated local MySQL 8 server",
  timeout: 90_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const subsets = createMigrationSubsets();
  let serverConnection;
  let pool;
  let databaseCreated = false;
  const cleanupErrors = [];
  try {
    serverConnection = await mysql.createConnection(serverConfig);
    await assertDisposableSnapshotServer(serverConnection);
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`
    );
    databaseCreated = true;
    pool = createPool(serverConfig, database);

    const through039 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[39],
    });
    assert.equal(through039.latestVersion, "039_activity_session_event.sql");
    const identity = await seedDuplicateSessionHistory(pool, crypto.randomBytes(4).toString("hex"));

    await expectMysqlError(
      () => applyMysqlMigrations(pool, { database, migrationsDir: subsets.directories[40] }),
      1062
    );
    const [partialColumns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'activity_definition_version'
         AND column_name IN ('objective', 'prebound_task_definition_version')`,
      [database]
    );
    assert.deepEqual(partialColumns, [], "duplicate history must fail before the first permanent 040 DDL");
    const [failedLedger] = await pool.execute(
      "SELECT version FROM schema_migrations WHERE version = '040_activity_p0_content_and_session_policy.sql'"
    );
    assert.deepEqual(failedLedger, []);

    await pool.execute(
      "DELETE FROM activity_session WHERE activity_session_id = ?",
      [identity.duplicateSessionId]
    );
    const through040 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[40],
    });
    assert.equal(through040.latestVersion, "040_activity_p0_content_and_session_policy.sql");
    const [contentColumns] = await pool.execute(
      `SELECT
         COLUMN_NAME AS column_name,
         IS_NULLABLE AS is_nullable,
         CHARACTER_SET_NAME AS character_set_name,
         COLLATION_NAME AS collation_name
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'activity_definition_version'
         AND column_name IN ('objective', 'prebound_task_definition_version')
       ORDER BY column_name`,
      [database]
    );
    assert.deepEqual(contentColumns, [
      {
        column_name: "objective",
        is_nullable: "NO",
        character_set_name: "utf8mb4",
        collation_name: "utf8mb4_unicode_ci",
      },
      {
        column_name: "prebound_task_definition_version",
        is_nullable: "YES",
        character_set_name: "ascii",
        collation_name: "ascii_bin",
      },
    ]);

    const full = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[45],
    });
    assert.equal(full.latestVersion, LAST_MIGRATION);
    const [sessionRows] = await pool.execute(
      `SELECT registration_close_at, cancel_close_at
       FROM activity_session WHERE activity_session_id = ?`,
      [identity.retainedSessionId]
    );
    assert.equal(sessionRows[0].cancel_close_at, sessionRows[0].registration_close_at);

    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO activity_session (
           activity_session_id, activity_version_id, status, approval_mode, capacity,
           registration_open_at, registration_close_at, cancel_close_at, review_deadline,
           session_start_at, session_end_at, allow_reapply, created_at, updated_at
         ) VALUES (
           'duplicate-business-time', ?, 'OPEN', 'AUTO', 5,
           '2026-07-01 00:00:00.000', '2026-07-20 00:00:00.000',
           '2026-07-20 00:00:00.000', NULL, '2026-07-21 00:00:00.000',
           '2026-07-21 03:00:00.000', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
         )`,
        [identity.activityVersionId]
      ),
      1062
    );
    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO activity_session (
           activity_session_id, activity_version_id, status, approval_mode, capacity,
           registration_open_at, registration_close_at, cancel_close_at, review_deadline,
           session_start_at, session_end_at, allow_reapply, created_at, updated_at
         ) VALUES (
           'invalid-cancel-window', ?, 'OPEN', 'AUTO', 5,
           '2026-07-20 00:00:00.000', '2026-07-20 12:00:00.000',
           '2026-07-19 00:00:00.000', NULL, '2026-07-22 00:00:00.000',
           '2026-07-22 03:00:00.000', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
         )`,
        [identity.activityVersionId]
      ),
      3819
    );

    const rootUserId = `root-user-${crypto.randomBytes(4).toString("hex")}`;
    const taskDefinitionId = `task-${crypto.randomBytes(4).toString("hex")}`;
    const enrollmentId = `enrollment-${crypto.randomBytes(4).toString("hex")}`;
    await pool.execute(
      `INSERT INTO root_user (
         root_user_id, lifecycle_status, source_channel, unionid_status, created_at, updated_at
       ) VALUES (?, 'ACTIVE', 'MYSQL_INTEGRATION', 'MISSING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [rootUserId]
    );
    await pool.execute(
      `INSERT INTO task_definition (
         task_definition_id, campaign_id, task_type, title, required, display_order,
         status, created_at, updated_at
       ) VALUES (?, 'campaign-integration', 'ACTIVITY', 'Activity task', 1, 10,
         'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [taskDefinitionId]
    );
    await pool.execute(
      `INSERT INTO activity_enrollment (
         activity_enrollment_id, activity_session_id, root_user_id, status,
         attempt_generation, created_at, updated_at
       ) VALUES (?, ?, ?, 'CONFIRMED', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [enrollmentId, identity.retainedSessionId, rootUserId]
    );
    const assignmentId = `assignment-${crypto.randomBytes(4).toString("hex")}`;
    await pool.execute(
      `INSERT INTO task_activity_assignment (
         task_activity_assignment_id, root_user_id, task_definition_id,
         task_definition_version, activity_enrollment_id, activity_session_id,
         initial_status, source_confirmed_event_id, source_confirmed_event_type,
         source_confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'task-v1', ?, ?, 'AVAILABLE', 'confirmed-event-1',
         'activity.enrollment.confirmed.v1', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [assignmentId, rootUserId, taskDefinitionId, enrollmentId, identity.retainedSessionId]
    );
    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO task_activity_assignment (
           task_activity_assignment_id, root_user_id, task_definition_id,
           task_definition_version, activity_enrollment_id, activity_session_id,
           initial_status, source_confirmed_event_id, source_confirmed_event_type,
           source_confirmed_at, created_at, updated_at
         ) VALUES ('assignment-invalid-status', ?, ?, 'task-v2', ?, ?, 'DONE',
           'confirmed-event-2', 'activity.enrollment.confirmed.v1', UTC_TIMESTAMP(3),
           UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [rootUserId, taskDefinitionId, enrollmentId, identity.retainedSessionId]
      ),
      3819
    );
    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO task_activity_assignment (
           task_activity_assignment_id, root_user_id, task_definition_id,
           task_definition_version, activity_enrollment_id, activity_session_id,
           initial_status, source_confirmed_event_id, source_confirmed_event_type,
           source_confirmed_at, created_at, updated_at
         ) VALUES ('assignment-missing-definition', ?, 'missing-definition', 'task-v1',
           ?, ?, 'AVAILABLE', 'confirmed-event-3', 'activity.enrollment.confirmed.v1',
           UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [rootUserId, enrollmentId, identity.retainedSessionId]
      ),
      1452
    );

    await pool.execute(
      `INSERT INTO task_source_invalidation_event (
         task_source_invalidation_event_id, task_activity_assignment_id,
         source_event_id, source_event_type, reason_code, occurred_at, created_at
       ) VALUES ('invalidation-1', ?, 'canceled-event-1',
         'activity.enrollment.canceled.v1', 'USER_CANCELED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [assignmentId]
    );
    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO task_source_invalidation_event (
           task_source_invalidation_event_id, task_activity_assignment_id,
           source_event_id, source_event_type, reason_code, occurred_at, created_at
         ) VALUES ('invalidation-duplicate', ?, 'canceled-event-1',
           'activity.enrollment.canceled.v1', 'SESSION_CANCELED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [assignmentId]
      ),
      1062
    );
    await expectMysqlError(
      () => pool.execute(
        `INSERT INTO task_source_invalidation_event (
           task_source_invalidation_event_id, task_activity_assignment_id,
           source_event_id, source_event_type, reason_code, occurred_at, created_at
         ) VALUES ('invalidation-bad-reason', ?, 'canceled-event-2',
           'activity.enrollment.canceled.v1', 'OTHER', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [assignmentId]
      ),
      3819
    );

    await pool.execute("DELETE FROM schema_migrations WHERE version = ?", [LAST_MIGRATION]);
    const reconciled = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[45],
    });
    assert.deepEqual(reconciled.applied, []);
    assert.deepEqual(reconciled.reconciled.map((item) => item.version), [LAST_MIGRATION]);
    const replay = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[45],
    });
    assert.deepEqual(replay.applied, []);
    assert.deepEqual(replay.reconciled, []);
  } finally {
    if (pool) {
      try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
    }
    if (serverConnection && databaseCreated) {
      try {
        await serverConnection.query(`DROP DATABASE ${quoteIdentifier(database)}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (serverConnection) {
      try { await serverConnection.end(); } catch (error) { cleanupErrors.push(error); }
    }
    try { removeMigrationSubsets(subsets.root); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Activity P0 integration cleanup failed");
  }
});
