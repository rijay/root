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

const ENABLED = process.env.IDENTITY_NOTIFICATION_BINDING_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_id_notif_mig_it_";
const TEMP_DIRECTORY_PREFIX = "myroot-id-notif-mig-it-";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "db", "migrations");
const LAST_MIGRATION = "057_notification_recipient_binding_v1_enforce.sql";
const EXPECTED_MIGRATION_COUNT = 57;
const HISTORICAL_GRANT_STATUSES = Object.freeze([
  "AVAILABLE",
  "RESERVED",
  "CONSUMED",
  "INVALID",
  "REVIEW_REQUIRED",
]);
const RECIPIENT_DIGEST = "a".repeat(64);

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_id_notif_mig_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_PORT_INVALID");
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
  const availableFiles = listMigrationFiles(MIGRATIONS_DIRECTORY);
  assert.ok(availableFiles.length >= EXPECTED_MIGRATION_COUNT);
  assert.equal(availableFiles[0], "001_store_snapshot.sql");
  assert.deepEqual(
    availableFiles.map((fileName) => fileName.slice(0, 3)),
    Array.from(
      { length: availableFiles.length },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );
  const files = availableFiles.filter(
    (fileName) => migrationOrdinal(fileName) <= EXPECTED_MIGRATION_COUNT
  );
  assert.equal(files.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(files.at(-1), LAST_MIGRATION);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX));
  const directories = {};
  for (const through of [48, 49, 50, 51, 52, 53, 54, 55, 56, 57]) {
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
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_TEMP_DIRECTORY_NOT_DISPOSABLE");
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

async function assertMysql8(connection) {
  const [rows] = await connection.query("SELECT VERSION() AS server_version");
  const version = String(rows[0] && rows[0].server_version || "");
  if (!/^8\.0(?:\.|$)/.test(version)) {
    throw integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_MYSQL_8_REQUIRED");
  }
}

async function expectMysqlErrno(operation, errno) {
  await assert.rejects(operation, (error) => Number(error && error.errno) === errno);
}

async function migrationApplied(pool, version) {
  const [rows] = await pool.execute(
    "SELECT version FROM schema_migrations WHERE version = ?",
    [version]
  );
  return rows.length === 1;
}

async function proveMissingMarkerRecovery(pool, database, migrationsDir, version) {
  await pool.execute("DELETE FROM schema_migrations WHERE version = ?", [version]);
  assert.equal(await migrationApplied(pool, version), false);
  const recovered = await applyMysqlMigrations(pool, {
    database,
    migrationsDir,
    migrationLockTimeoutSeconds: 10,
  });
  assert.deepEqual(recovered.applied, []);
  assert.deepEqual(recovered.reconciled.map((item) => item.version), [version]);
  assert.equal(await migrationApplied(pool, version), true);
}

async function seedHistoricalUnionId(pool) {
  await pool.execute(
    `INSERT INTO root_user (
       root_user_id, unionid, lifecycle_status, source_channel, unionid_status,
       created_at, updated_at
     ) VALUES (?, ?, 'ACTIVE', 'MYSQL_INTEGRATION', 'LINKED', ?, ?)`,
    [
      "root_unionid_history_1",
      "unionid_history_1",
      "2026-07-01 00:00:00.000",
      "2026-07-01 00:00:00.000",
    ]
  );
  await pool.execute(
    `INSERT INTO wechat_identity (
       wechat_identity_id, root_user_id, app_code, openid, unionid, unionid_status,
       created_at, updated_at, last_seen_at
     ) VALUES (?, ?, 'MYROOT', ?, ?, 'LINKED', ?, ?, ?)`,
    [
      "wxi_unionid_history_1",
      "root_unionid_history_1",
      "openid_unionid_history_1",
      "unionid_history_1",
      "2026-07-01 00:00:00.000",
      "2026-07-01 00:00:00.000",
      "2026-07-01 00:00:00.000",
    ]
  );
}

async function insertV1Attempt(pool, suffix, options = {}) {
  const rootUserId = options.rootUserId || `root_v1_${suffix}`;
  const taskId = options.taskId || `task_v1_${suffix}`;
  const occurrenceDate = options.occurrenceDate || "2026-08-01";
  const grantRequestId = options.grantRequestId || `grant-request-v1-${suffix}`;
  const attemptId = `nsa_v1_${suffix}`;
  await pool.execute(
    `INSERT INTO notification_subscription_attempt_v1 (
       notification_subscription_attempt_id, root_user_id, task_id,
       task_occurrence_date, template_version, grant_request_id,
       native_decision, reason_code, idempotency_key, decided_at, release_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'tpl-v1', ?, 'ACCEPTED', NULL, ?, ?, ?, ?, ?)`,
    [
      attemptId,
      rootUserId,
      taskId,
      occurrenceDate,
      grantRequestId,
      `decision-idem-v1-${suffix}`,
      "2026-07-18 00:00:00.000",
      "rel_identity_notification_it",
      "2026-07-18 00:00:00.000",
      "2026-07-18 00:00:00.000",
    ]
  );
  return Object.freeze({
    attemptId,
    rootUserId,
    taskId,
    occurrenceDate,
    grantRequestId,
  });
}

async function seedHistoricalRecipientGrants(pool) {
  for (let index = 0; index < HISTORICAL_GRANT_STATUSES.length; index += 1) {
    const status = HISTORICAL_GRANT_STATUSES[index];
    const suffix = `history_${index + 1}`;
    await pool.execute(
      `INSERT INTO notification_subscription_grant (
         notification_subscription_grant_id, notification_subscription_id,
         root_user_id, campaign_id, template_key, template_id, template_version,
         grant_request_id, status, notification_job_id, last_notification_job_id,
         idempotency_key, source_channel, granted_at, reserved_at, consumed_at,
         released_at, invalidated_at, review_required_at, release_reason,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'campaign-it', 'CHECKIN_REMINDER_NEXT_DAY', 'template-it', 'tpl-v1',
         ?, ?, NULL, NULL, ?, 'MYSQL_INTEGRATION', ?, NULL, NULL,
         NULL, NULL, NULL, NULL, ?, ?
       )`,
      [
        `nsg_legacy_${suffix}`,
        `nts_legacy_${suffix}`,
        `root_legacy_${suffix}`,
        `grant-request-legacy-${suffix}`,
        status,
        `grant-idem-legacy-${suffix}`,
        "2026-07-18 00:00:00.000",
        "2026-07-18 00:00:00.000",
        "2026-07-18 00:00:00.000",
      ]
    );

    const v1 = await insertV1Attempt(pool, suffix, {
      occurrenceDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    });
    await pool.execute(
      `INSERT INTO notification_subscription_grant_v1 (
         notification_subscription_grant_id, notification_subscription_attempt_id,
         root_user_id, task_id, task_occurrence_date, template_version,
         grant_request_id, status, reserved_job_id, status_reason_code,
         granted_at, reserved_at, consumed_at, invalidated_at, review_required_at,
         release_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'tpl-v1', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      [
        `nsg_v1_${suffix}`,
        v1.attemptId,
        v1.rootUserId,
        v1.taskId,
        v1.occurrenceDate,
        v1.grantRequestId,
        status,
        "2026-07-18 00:00:00.000",
        "rel_identity_notification_it",
        "2026-07-18 00:00:00.000",
        "2026-07-18 00:00:00.000",
      ]
    );
  }
}

async function insertLegacyGrantAfter052(pool, suffix, options = {}) {
  const status = options.status || "REVIEW_REQUIRED";
  const bindingStatus = Object.prototype.hasOwnProperty.call(options, "bindingStatus")
    ? options.bindingStatus
    : "UNVERIFIED";
  const identityId = Object.prototype.hasOwnProperty.call(options, "identityId")
    ? options.identityId
    : null;
  const appCode = Object.prototype.hasOwnProperty.call(options, "appCode")
    ? options.appCode
    : null;
  const canonicalVersion = Object.prototype.hasOwnProperty.call(options, "canonicalVersion")
    ? options.canonicalVersion
    : null;
  const digest = Object.prototype.hasOwnProperty.call(options, "digest")
    ? options.digest
    : null;
  const digestScheme = Object.prototype.hasOwnProperty.call(options, "digestScheme")
    ? options.digestScheme
    : null;
  const keyId = Object.prototype.hasOwnProperty.call(options, "keyId")
    ? options.keyId
    : null;
  const id = `nsg_legacy_${suffix}`;
  await pool.execute(
    `INSERT INTO notification_subscription_grant (
       notification_subscription_grant_id, notification_subscription_id,
       root_user_id, campaign_id, template_key, template_id, template_version,
       grant_request_id, status, notification_job_id, last_notification_job_id,
       idempotency_key, source_channel, recipient_binding_status,
       recipient_wechat_identity_id, recipient_app_code,
       recipient_binding_canonical_version, recipient_binding_digest,
       recipient_binding_digest_scheme, recipient_binding_key_id,
       granted_at, reserved_at, consumed_at, released_at, invalidated_at,
       review_required_at, release_reason, created_at, updated_at
     ) VALUES (
       ?, ?, ?, 'campaign-it', 'CHECKIN_REMINDER_NEXT_DAY', 'template-it', 'tpl-v1',
       ?, ?, NULL, NULL, ?, 'MYSQL_INTEGRATION', ?, ?, ?, ?, ?, ?, ?,
       ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?
     )`,
    [
      id,
      `nts_legacy_${suffix}`,
      `root_legacy_${suffix}`,
      `grant-request-legacy-${suffix}`,
      status,
      `grant-idem-legacy-${suffix}`,
      bindingStatus,
      identityId,
      appCode,
      canonicalVersion,
      digest,
      digestScheme,
      keyId,
      "2026-07-18 00:00:00.000",
      status === "REVIEW_REQUIRED" ? "2026-07-18 00:00:00.000" : null,
      status === "REVIEW_REQUIRED" ? "RECIPIENT_BINDING_UNVERIFIED" : null,
      "2026-07-18 00:00:00.000",
      "2026-07-18 00:00:00.000",
    ]
  );
  return id;
}

async function insertV1GrantAfter053(pool, suffix, options = {}) {
  const v1 = await insertV1Attempt(pool, suffix, {
    occurrenceDate: options.occurrenceDate || "2026-09-01",
  });
  const status = options.status || "REVIEW_REQUIRED";
  const identityId = Object.prototype.hasOwnProperty.call(options, "identityId")
    ? options.identityId
    : null;
  const appCode = Object.prototype.hasOwnProperty.call(options, "appCode")
    ? options.appCode
    : null;
  const canonicalVersion = Object.prototype.hasOwnProperty.call(options, "canonicalVersion")
    ? options.canonicalVersion
    : null;
  const digest = Object.prototype.hasOwnProperty.call(options, "digest")
    ? options.digest
    : null;
  const digestScheme = Object.prototype.hasOwnProperty.call(options, "digestScheme")
    ? options.digestScheme
    : null;
  const keyId = Object.prototype.hasOwnProperty.call(options, "keyId")
    ? options.keyId
    : null;
  const bindingStatus = Object.prototype.hasOwnProperty.call(options, "bindingStatus")
    ? options.bindingStatus
    : ([identityId, appCode, canonicalVersion, digest, digestScheme, keyId].some(Boolean)
      ? "VERIFIED"
      : "UNVERIFIED");
  const id = `nsg_v1_${suffix}`;
  await pool.execute(
    `INSERT INTO notification_subscription_grant_v1 (
       notification_subscription_grant_id, notification_subscription_attempt_id,
       root_user_id, task_id, task_occurrence_date, template_version,
       grant_request_id, status, reserved_job_id, status_reason_code,
       granted_at, reserved_at, consumed_at, invalidated_at, review_required_at,
       recipient_binding_status, recipient_wechat_identity_id, recipient_app_code,
       recipient_binding_canonical_version, recipient_binding_digest,
       recipient_binding_digest_scheme, recipient_binding_key_id,
       release_id, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'tpl-v1', ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )`,
    [
      id,
      v1.attemptId,
      v1.rootUserId,
      v1.taskId,
      v1.occurrenceDate,
      v1.grantRequestId,
      status,
      status === "REVIEW_REQUIRED" ? "RECIPIENT_BINDING_UNVERIFIED" : null,
      "2026-07-18 00:00:00.000",
      status === "REVIEW_REQUIRED" ? "2026-07-18 00:00:00.000" : null,
      bindingStatus,
      identityId,
      appCode,
      canonicalVersion,
      digest,
      digestScheme,
      keyId,
      "rel_identity_notification_it",
      "2026-07-18 00:00:00.000",
      "2026-07-18 00:00:00.000",
    ]
  );
  return id;
}

async function assertMigration051StillStaged(pool, database) {
  assert.equal(await migrationApplied(pool, "051_wechat_unionid_provenance_enforce.sql"), false);
  const [columns] = await pool.execute(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'wechat_identity'
       AND column_name = 'unionid_trust_status'`,
    [database]
  );
  assert.deepEqual(columns.map((row) => row.is_nullable ?? row.IS_NULLABLE), ["YES"]);
  const [indexes] = await pool.execute(
    `SELECT index_name
     FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'wechat_identity'
       AND index_name = 'uk_wechat_identity_root_app'`,
    [database]
  );
  assert.deepEqual(indexes, []);
}

async function assertMigration056StillStaged(pool, database) {
  assert.equal(await migrationApplied(pool, "056_notification_recipient_binding_legacy_enforce.sql"), false);
  const [legacyColumns] = await pool.execute(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'notification_subscription_grant'
       AND column_name = 'recipient_binding_status'`,
    [database]
  );
  assert.deepEqual(legacyColumns.map((row) => row.is_nullable ?? row.IS_NULLABLE), ["YES"]);
  const [indexes] = await pool.execute(
    `SELECT index_name
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = 'notification_subscription_grant'
       AND index_name = 'idx_notification_recipient_binding_crypto'`,
    [database]
  );
  assert.deepEqual(indexes, []);
}

async function assertMigration057StillStaged(pool, database) {
  assert.equal(await migrationApplied(pool, "056_notification_recipient_binding_legacy_enforce.sql"), true);
  assert.equal(await migrationApplied(pool, LAST_MIGRATION), false);
  const [v1Columns] = await pool.execute(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'notification_subscription_grant_v1'
       AND column_name = 'recipient_binding_status'`,
    [database]
  );
  assert.deepEqual(v1Columns.map((row) => row.is_nullable ?? row.IS_NULLABLE), ["YES"]);
  const [indexes] = await pool.execute(
    `SELECT index_name
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = 'notification_subscription_grant_v1'
       AND index_name = 'idx_notification_recipient_binding_v1_crypto'`,
    [database]
  );
  assert.deepEqual(indexes, []);
}

test("integration guards reject remote hosts and non-disposable database names", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.candidate.internal" }),
    { code: "IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_id_notif_mig_it_candidate_deadbeefdeadbeef",
    "myroot_id_notif_mig_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(createDatabaseName(), /^myroot_id_notif_mig_it_[0-9]+_[0-9a-f]{16}$/);
  const availableFiles = listMigrationFiles(MIGRATIONS_DIRECTORY);
  assert.ok(availableFiles.length >= EXPECTED_MIGRATION_COUNT);
  assert.equal(availableFiles[EXPECTED_MIGRATION_COUNT - 1], LAST_MIGRATION);
  assert.deepEqual(
    availableFiles.map((fileName) => fileName.slice(0, 3)),
    Array.from(
      { length: availableFiles.length },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );
});

test("real MySQL proves UnionID provenance and recipient binding migrations 049 through 057", {
  skip: ENABLED
    ? false
    : "set IDENTITY_NOTIFICATION_BINDING_MYSQL_INTEGRATION_ENABLED=true on an isolated local MySQL 8 server",
  timeout: 120_000,
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
    await assertMysql8(serverConnection);
    await assertDisposableSnapshotServer(serverConnection);
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`
    );
    databaseCreated = true;
    pool = createPool(serverConfig, database);

    const through048 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[48],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through048.latestVersion, "048_task_event_idempotency_scope_enforce.sql");
    await seedHistoricalUnionId(pool);

    const through049 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[49],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through049.latestVersion, "049_wechat_unionid_provenance_stage.sql");
    const through050 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[50],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through050.latestVersion, "050_wechat_unionid_provenance_backfill.sql");

    const [identityBackfill] = await pool.execute(
      `SELECT unionid, unionid_status, unionid_trust_status,
              unionid_provenance_source, unionid_verified_at,
              unionid_provenance_canonical_version, unionid_provenance_digest,
              unionid_provenance_digest_scheme, unionid_provenance_key_id
       FROM wechat_identity WHERE wechat_identity_id = 'wxi_unionid_history_1'`
    );
    assert.equal(identityBackfill.length, 1);
    assert.equal(identityBackfill[0].unionid, "unionid_history_1");
    assert.equal(identityBackfill[0].unionid_status, "PENDING");
    assert.equal(identityBackfill[0].unionid_trust_status, "UNVERIFIED");
    for (const key of [
      "unionid_provenance_source",
      "unionid_verified_at",
      "unionid_provenance_canonical_version",
      "unionid_provenance_digest",
      "unionid_provenance_digest_scheme",
      "unionid_provenance_key_id",
    ]) assert.equal(identityBackfill[0][key], null);
    const [rootBackfill] = await pool.execute(
      "SELECT unionid, unionid_status FROM root_user WHERE root_user_id = 'root_unionid_history_1'"
    );
    assert.deepEqual(rootBackfill.map((row) => ({
      unionid: row.unionid,
      unionid_status: row.unionid_status,
    })), [{ unionid: null, unionid_status: "PENDING" }]);

    // Simulate an old writer racing between backfill and enforce. Migration 051
    // must fail in its temporary-table preflight, before permanent DDL.
    await pool.execute(
      `INSERT INTO wechat_identity (
         wechat_identity_id, root_user_id, app_code, openid, unionid, unionid_status,
         unionid_trust_status, unionid_provenance_source, unionid_verified_at,
         unionid_provenance_canonical_version, unionid_provenance_digest,
         unionid_provenance_digest_scheme, unionid_provenance_key_id,
         created_at, updated_at, last_seen_at
       ) VALUES (
         'wxi_old_writer_null_1', 'root_old_writer_null_1', 'MYROOT',
         'openid_old_writer_null_1', NULL, 'PENDING', NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, ?, ?, ?
       )`,
      Array(3).fill("2026-07-18 00:00:00.000")
    );
    await expectMysqlErrno(
      () => applyMysqlMigrations(pool, {
        database,
        migrationsDir: subsets.directories[51],
        migrationLockTimeoutSeconds: 10,
      }),
      1062
    );
    await assertMigration051StillStaged(pool, database);
    await pool.execute("DELETE FROM wechat_identity WHERE wechat_identity_id = 'wxi_old_writer_null_1'");

    const through051 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[51],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through051.latestVersion, "051_wechat_unionid_provenance_enforce.sql");

    await expectMysqlErrno(
      () => pool.execute(
        `INSERT INTO wechat_identity (
           wechat_identity_id, root_user_id, app_code, openid, unionid, unionid_status,
           unionid_trust_status, created_at, updated_at, last_seen_at
         ) VALUES (
           'wxi_duplicate_root_app_1', 'root_unionid_history_1', 'MYROOT',
           'openid_duplicate_root_app_1', NULL, 'PENDING', 'UNVERIFIED', ?, ?, ?
         )`,
        Array(3).fill("2026-07-18 00:00:00.000")
      ),
      1062
    );
    await expectMysqlErrno(
      () => pool.execute(
        `INSERT INTO wechat_identity (
           wechat_identity_id, root_user_id, app_code, openid, unionid, unionid_status,
           unionid_trust_status, unionid_provenance_source, unionid_verified_at,
           unionid_provenance_canonical_version, unionid_provenance_digest,
           unionid_provenance_digest_scheme, unionid_provenance_key_id,
           created_at, updated_at, last_seen_at
         ) VALUES (
           'wxi_mixed_provenance_1', 'root_mixed_provenance_1', 'MYROOT',
           'openid_mixed_provenance_1', 'unionid_mixed_provenance_1', 'LINKED',
           'VERIFIED', 'CLOUDBASE', ?, 'canonical-json:v1', NULL,
           'hmac-sha256:v1', 'request-digest-it-v1', ?, ?, ?
         )`,
        Array(4).fill("2026-07-18 00:00:00.000")
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `INSERT INTO wechat_identity (
           wechat_identity_id, root_user_id, app_code, openid, unionid, unionid_status,
           unionid_trust_status, unionid_provenance_source,
           created_at, updated_at, last_seen_at
         ) VALUES (
           'wxi_unverified_metadata_1', 'root_unverified_metadata_1', 'MYROOT',
           'openid_unverified_metadata_1', NULL, 'PENDING', 'UNVERIFIED',
           'CLOUDBASE', ?, ?, ?
         )`,
        Array(3).fill("2026-07-18 00:00:00.000")
      ),
      3819
    );

    await seedHistoricalRecipientGrants(pool);
    const through052 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[52],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through052.latestVersion, "052_notification_recipient_binding_legacy_stage.sql");
    assert.equal(through052.versions.length, 52);
    const [stageColumnsAfter052] = await pool.execute(
      `SELECT table_name, COUNT(*) AS column_count
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name IN (
           'notification_subscription_grant',
           'notification_subscription_grant_v1'
         )
         AND column_name LIKE 'recipient_%'
       GROUP BY table_name
       ORDER BY table_name`,
      [database]
    );
    assert.deepEqual(stageColumnsAfter052.map((row) => ({
      table_name: row.table_name ?? row.TABLE_NAME,
      column_count: Number(row.column_count ?? row.COLUMN_COUNT),
    })), [{ table_name: "notification_subscription_grant", column_count: 7 }]);
    await proveMissingMarkerRecovery(
      pool,
      database,
      subsets.directories[52],
      "052_notification_recipient_binding_legacy_stage.sql"
    );

    const through053 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[53],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through053.latestVersion, "053_notification_recipient_binding_v1_stage.sql");
    assert.equal(through053.versions.length, 53);
    await proveMissingMarkerRecovery(
      pool,
      database,
      subsets.directories[53],
      "053_notification_recipient_binding_v1_stage.sql"
    );

    const through054 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[54],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through054.latestVersion, "054_notification_recipient_binding_legacy_backfill.sql");

    const [legacyHistory] = await pool.execute(
      `SELECT status, recipient_binding_status, recipient_wechat_identity_id,
              recipient_app_code, recipient_binding_canonical_version,
              recipient_binding_digest, recipient_binding_digest_scheme,
              recipient_binding_key_id, release_reason, review_required_at
       FROM notification_subscription_grant
       WHERE notification_subscription_grant_id LIKE 'nsg_legacy_history_%'
       ORDER BY notification_subscription_grant_id`
    );
    assert.equal(legacyHistory.length, HISTORICAL_GRANT_STATUSES.length);
    for (const grant of legacyHistory) {
      assert.equal(grant.status, "REVIEW_REQUIRED");
      assert.equal(grant.recipient_binding_status, "UNVERIFIED");
      assert.equal(grant.release_reason, "RECIPIENT_BINDING_UNVERIFIED");
      assert.ok(grant.review_required_at);
      for (const key of [
        "recipient_wechat_identity_id",
        "recipient_app_code",
        "recipient_binding_canonical_version",
        "recipient_binding_digest",
        "recipient_binding_digest_scheme",
        "recipient_binding_key_id",
      ]) assert.equal(grant[key], null);
    }
    const [v1BeforeBackfill] = await pool.execute(
      `SELECT status, recipient_binding_status
       FROM notification_subscription_grant_v1
       WHERE notification_subscription_grant_id LIKE 'nsg_v1_history_%'
       ORDER BY notification_subscription_grant_id`
    );
    assert.deepEqual(v1BeforeBackfill.map((grant) => grant.status), HISTORICAL_GRANT_STATUSES);
    assert.equal(v1BeforeBackfill.every((grant) => grant.recipient_binding_status === null), true);

    const through055 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[55],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through055.latestVersion, "055_notification_recipient_binding_v1_backfill.sql");

    const [v1History] = await pool.execute(
      `SELECT status, recipient_binding_status, recipient_wechat_identity_id, recipient_app_code,
              recipient_binding_canonical_version, recipient_binding_digest,
              recipient_binding_digest_scheme, recipient_binding_key_id,
              status_reason_code, review_required_at
       FROM notification_subscription_grant_v1
       WHERE notification_subscription_grant_id LIKE 'nsg_v1_history_%'
       ORDER BY notification_subscription_grant_id`
    );
    assert.equal(v1History.length, HISTORICAL_GRANT_STATUSES.length);
    for (const grant of v1History) {
      assert.equal(grant.status, "REVIEW_REQUIRED");
      assert.equal(grant.recipient_binding_status, "UNVERIFIED");
      assert.equal(grant.status_reason_code, "RECIPIENT_BINDING_UNVERIFIED");
      assert.ok(grant.review_required_at);
      for (const key of [
        "recipient_wechat_identity_id",
        "recipient_app_code",
        "recipient_binding_canonical_version",
        "recipient_binding_digest",
        "recipient_binding_digest_scheme",
        "recipient_binding_key_id",
      ]) assert.equal(grant[key], null);
    }

    // Simulate a legacy old writer after its backfill. The legacy enforce
    // migration fails before its only permanent ALTER, then converges after the
    // row is quarantined. The v1 table remains independently staged.
    const legacyRaceId = await insertLegacyGrantAfter052(pool, "old_writer_null_1", {
      status: "AVAILABLE",
      bindingStatus: null,
    });
    await expectMysqlErrno(
      () => applyMysqlMigrations(pool, {
        database,
        migrationsDir: subsets.directories[56],
        migrationLockTimeoutSeconds: 10,
      }),
      1062
    );
    await assertMigration056StillStaged(pool, database);
    await pool.execute(
      `UPDATE notification_subscription_grant
       SET status = 'REVIEW_REQUIRED', recipient_binding_status = 'UNVERIFIED',
           review_required_at = UTC_TIMESTAMP(3),
           release_reason = 'RECIPIENT_BINDING_UNVERIFIED'
       WHERE notification_subscription_grant_id = ?`,
      [legacyRaceId]
    );

    const through056 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[56],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through056.latestVersion, "056_notification_recipient_binding_legacy_enforce.sql");
    assert.equal(through056.versions.length, 56);
    await proveMissingMarkerRecovery(
      pool,
      database,
      subsets.directories[56],
      "056_notification_recipient_binding_legacy_enforce.sql"
    );

    // A v1 old writer can independently block only 057. The already-complete
    // legacy enforcement and its ledger marker remain authoritative.
    const v1RaceId = await insertV1GrantAfter053(pool, "old_writer_mixed_1", {
      status: "AVAILABLE",
      identityId: "wxi_old_writer_mixed_1",
      occurrenceDate: "2026-09-02",
    });
    await expectMysqlErrno(
      () => applyMysqlMigrations(pool, {
        database,
        migrationsDir: subsets.directories[57],
        migrationLockTimeoutSeconds: 10,
      }),
      1062
    );
    await assertMigration057StillStaged(pool, database);
    await pool.execute(
      `UPDATE notification_subscription_grant_v1
       SET status = 'REVIEW_REQUIRED', status_reason_code = 'RECIPIENT_BINDING_UNVERIFIED',
           review_required_at = UTC_TIMESTAMP(3), recipient_binding_status = 'UNVERIFIED',
           recipient_wechat_identity_id = NULL,
           recipient_app_code = NULL, recipient_binding_canonical_version = NULL,
           recipient_binding_digest = NULL, recipient_binding_digest_scheme = NULL,
           recipient_binding_key_id = NULL
       WHERE notification_subscription_grant_id = ?`,
      [v1RaceId]
    );

    const through057 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[57],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through057.latestVersion, LAST_MIGRATION);
    assert.equal(through057.versions.length, EXPECTED_MIGRATION_COUNT);
    await proveMissingMarkerRecovery(
      pool,
      database,
      subsets.directories[57],
      LAST_MIGRATION
    );

    await expectMysqlErrno(
      () => insertLegacyGrantAfter052(pool, "send_unv_1", {
        status: "AVAILABLE",
        bindingStatus: "UNVERIFIED",
      }),
      3819
    );
    await expectMysqlErrno(
      () => insertLegacyGrantAfter052(pool, "mixed_1", {
        status: "REVIEW_REQUIRED",
        bindingStatus: "VERIFIED",
        identityId: "wxi_mixed_binding_rejected_1",
      }),
      3819
    );
    await expectMysqlErrno(
      () => insertV1GrantAfter053(pool, "send_unv_1", {
        status: "AVAILABLE",
        occurrenceDate: "2026-09-03",
      }),
      3819
    );
    await expectMysqlErrno(
      () => insertV1GrantAfter053(pool, "mixed_1", {
        status: "REVIEW_REQUIRED",
        identityId: "wxi_mixed_binding_rejected_1",
        occurrenceDate: "2026-09-04",
      }),
      3819
    );

    const fullBinding = Object.freeze({
      identityId: "wxi_verified_terminal_v1",
      appCode: "MYROOT",
      canonicalVersion: "canonical-json:v1",
      digest: RECIPIENT_DIGEST,
      digestScheme: "hmac-sha256:v1",
      keyId: "request-digest-it-v1",
    });
    const verifiedV1Id = await insertV1GrantAfter053(pool, "verified_term_1", {
      status: "AVAILABLE",
      occurrenceDate: "2026-09-05",
      ...fullBinding,
    });
    await pool.execute(
      `UPDATE notification_subscription_grant_v1
       SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(3)
       WHERE notification_subscription_grant_id = ?`,
      [verifiedV1Id]
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_subscription_grant_v1
         SET recipient_wechat_identity_id = NULL, recipient_app_code = NULL,
             recipient_binding_canonical_version = NULL, recipient_binding_digest = NULL,
             recipient_binding_digest_scheme = NULL, recipient_binding_key_id = NULL
         WHERE notification_subscription_grant_id = ?`,
        [verifiedV1Id]
      ),
      3819
    );

    const verifiedLegacyId = await insertLegacyGrantAfter052(pool, "verified_term_1", {
      status: "AVAILABLE",
      bindingStatus: "VERIFIED",
      ...fullBinding,
    });
    await pool.execute(
      `UPDATE notification_subscription_grant
       SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(3)
       WHERE notification_subscription_grant_id = ?`,
      [verifiedLegacyId]
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_subscription_grant
         SET recipient_binding_status = 'UNVERIFIED',
             recipient_wechat_identity_id = NULL, recipient_app_code = NULL,
             recipient_binding_canonical_version = NULL, recipient_binding_digest = NULL,
             recipient_binding_digest_scheme = NULL, recipient_binding_key_id = NULL
         WHERE notification_subscription_grant_id = ?`,
        [verifiedLegacyId]
      ),
      3819
    );

    const [terminalBindings] = await pool.execute(
      `SELECT 'legacy' AS family, recipient_wechat_identity_id, recipient_binding_digest
       FROM notification_subscription_grant WHERE notification_subscription_grant_id = ?
       UNION ALL
       SELECT 'v1' AS family, recipient_wechat_identity_id, recipient_binding_digest
       FROM notification_subscription_grant_v1 WHERE notification_subscription_grant_id = ?
       ORDER BY family`,
      [verifiedLegacyId, verifiedV1Id]
    );
    assert.deepEqual(terminalBindings.map((row) => ({
      family: row.family,
      recipient_wechat_identity_id: row.recipient_wechat_identity_id,
      recipient_binding_digest: row.recipient_binding_digest,
    })), [
      {
        family: "legacy",
        recipient_wechat_identity_id: fullBinding.identityId,
        recipient_binding_digest: RECIPIENT_DIGEST,
      },
      {
        family: "v1",
        recipient_wechat_identity_id: fullBinding.identityId,
        recipient_binding_digest: RECIPIENT_DIGEST,
      },
    ]);

    const replay = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[54],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(replay.applied, []);
    assert.deepEqual(replay.reconciled, []);
  } finally {
    if (pool) {
      try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
    }
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
    try { removeMigrationSubsets(subsets.root); } catch (error) { cleanupErrors.push(error); }
    if (databaseCreated) {
      cleanupErrors.push(integrationError("IDENTITY_NOTIFICATION_MIGRATION_INTEGRATION_DATABASE_CLEANUP_FAILED"));
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Identity/notification migration integration cleanup failed");
    }
  }
});
