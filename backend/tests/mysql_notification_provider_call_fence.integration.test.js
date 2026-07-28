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
const {
  createMysqlNotificationDeliveryCore,
} = require("../src/mysqlNotificationDeliveryCore");

const ENABLED = process.env.NOTIFICATION_PROVIDER_FENCE_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_notif_fence_it_";
const TEMP_DIRECTORY_PREFIX = "myroot-notif-fence-it-";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "db", "migrations");
const STAGE_MIGRATION = "058_notification_provider_call_fence_stage.sql";
const BACKFILL_MIGRATION = "059_notification_provider_call_fence_backfill.sql";
const ENFORCE_MIGRATION = "060_notification_provider_call_fence_enforce.sql";
const MAX_MIGRATION_ORDINAL = 60;
const CORE_ENV = Object.freeze({
  MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "true",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY:
    "test-only-real-mysql-provider-receipt-key-2026-07",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "notification-provider-fence-it-v1",
  ROOT_NOTIFICATION_PROVIDER_CALL_LEASE_MS: "5000",
});
const CORE_RELEASE_ID = "rel-notif-fence-core-it-v1";

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_notif_fence_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_PORT_INVALID");
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
  assert.ok(availableFiles.length >= MAX_MIGRATION_ORDINAL);
  assert.equal(availableFiles[0], "001_store_snapshot.sql");
  assert.deepEqual(
    availableFiles.map((fileName) => fileName.slice(0, 3)),
    Array.from(
      { length: availableFiles.length },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );
  const providerFenceFiles = availableFiles.filter(
    (fileName) => migrationOrdinal(fileName) <= MAX_MIGRATION_ORDINAL
  );
  assert.equal(providerFenceFiles.length, MAX_MIGRATION_ORDINAL);
  assert.equal(providerFenceFiles.at(-1), ENFORCE_MIGRATION);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX));
  const directories = {};
  for (const through of [57, 58, 59, 60]) {
    const directory = path.join(root, `through-${through}`);
    fs.mkdirSync(directory);
    for (const fileName of providerFenceFiles.filter(
      (candidate) => migrationOrdinal(candidate) <= through
    )) {
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
  const resolved = path.resolve(String(root || ""));
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX)) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_TEMP_DIRECTORY_NOT_DISPOSABLE");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
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

function createCommitAckAfterSuccessPool(realPool) {
  let injectOnce = true;
  return Object.freeze({
    async getConnection() {
      const connection = await realPool.getConnection();
      if (!injectOnce) return connection;
      injectOnce = false;
      // Every database operation delegates to a real mysql2 connection. The
      // only injected fault is loss of the acknowledgement after COMMIT has
      // durably succeeded; authoritative readback then uses a fresh real
      // connection from the same pool.
      return Object.freeze({
        query(...args) { return connection.query(...args); },
        execute(...args) { return connection.execute(...args); },
        beginTransaction(...args) { return connection.beginTransaction(...args); },
        async commit(...args) {
          await connection.commit(...args);
          const error = new Error("injected commit acknowledgement loss after durable COMMIT");
          error.code = "PROTOCOL_CONNECTION_LOST";
          throw error;
        },
        rollback(...args) { return connection.rollback(...args); },
        release(...args) { return connection.release(...args); },
        destroy(...args) { return connection.destroy(...args); },
      });
    },
  });
}

function createNotificationCore(pool) {
  return createMysqlNotificationDeliveryCore(pool, { env: CORE_ENV });
}

async function assertMysql8(connection) {
  const [rows] = await connection.query("SELECT VERSION() AS server_version");
  const version = String(rows[0] && rows[0].server_version || "");
  if (!/^8\.0(?:\.|$)/.test(version)) {
    throw integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_MYSQL_8_REQUIRED");
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

function digest(...parts) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function informationSchemaValue(row, key) {
  return row[key] ?? row[key.toUpperCase()];
}

function normalizeProviderColumn(row) {
  return Object.freeze({
    column_name: informationSchemaValue(row, "column_name"),
    ordinal_position: informationSchemaValue(row, "ordinal_position"),
    is_nullable: informationSchemaValue(row, "is_nullable"),
    column_default: informationSchemaValue(row, "column_default"),
    column_type: informationSchemaValue(row, "column_type"),
    character_set_name: informationSchemaValue(row, "character_set_name"),
    collation_name: informationSchemaValue(row, "collation_name"),
  });
}

async function insertAttemptChain(pool, suffix, attemptStatus) {
  const subscriptionAttemptId = `nsa_${suffix}`;
  const grantId = `nsg_${suffix}`;
  const jobId = `nj_${suffix}`;
  const sendAttemptId = `send_${suffix}`;
  const transitionId = `nst_${suffix}`;
  const rootUserId = `root_${suffix}`;
  const taskId = `task_${suffix}`;
  const grantRequestId = `grant-request-${suffix}`;
  const releaseId = "rel-notif-fence-it-v1";
  const timestamp = "2026-07-18 00:00:00.000";
  const terminal = attemptStatus !== "REQUESTED";
  const accepted = attemptStatus === "ACCEPTED";
  const receiptDigest = accepted ? digest("receipt", suffix) : null;
  const transitionFenceDigest = digest("transition", suffix, attemptStatus);
  const requestDigest = digest("request", suffix);
  const grantStatus = terminal ? "CONSUMED" : "RESERVED";
  const jobStatus = terminal ? "PROVIDER_ACCEPTED" : "SENDING";
  const transitionVersion = terminal ? 2 : 1;

  await pool.execute(
    `INSERT INTO notification_subscription_attempt_v1 (
       notification_subscription_attempt_id, root_user_id, task_id,
       task_occurrence_date, template_version, grant_request_id,
       native_decision, reason_code, idempotency_key, decided_at, release_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, '2026-08-01', 'tpl-v1', ?, 'ACCEPTED', NULL, ?, ?, ?, ?, ?)`,
    [
      subscriptionAttemptId,
      rootUserId,
      taskId,
      grantRequestId,
      `decision-idem-${suffix}`,
      timestamp,
      releaseId,
      timestamp,
      timestamp,
    ]
  );
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
       ?, ?, ?, ?, '2026-08-01', 'tpl-v1', ?, ?, ?, NULL,
       ?, ?, ?, NULL, NULL, 'VERIFIED', ?, 'MYROOT', 'canonical-json:v1', ?,
       'hmac-sha256:v1', 'notification-provider-fence-it-v1', ?, ?, ?
     )`,
    [
      grantId,
      subscriptionAttemptId,
      rootUserId,
      taskId,
      grantRequestId,
      grantStatus,
      jobId,
      timestamp,
      timestamp,
      terminal ? timestamp : null,
      `wxi_${suffix}`,
      digest("binding", suffix),
      releaseId,
      timestamp,
      timestamp,
    ]
  );
  await pool.execute(
    `INSERT INTO notification_job_v1 (
       notification_job_id, notification_subscription_grant_id, root_user_id,
       task_id, task_occurrence_date, template_version, status, due_at,
       idempotency_key, request_digest, send_attempt_id, stable_error_code,
       release_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, '2026-08-01', 'tpl-v1', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      jobId,
      grantId,
      rootUserId,
      taskId,
      jobStatus,
      timestamp,
      `job-idem-${suffix}`,
      digest("job-request", suffix),
      sendAttemptId,
      releaseId,
      timestamp,
      timestamp,
    ]
  );
  await pool.execute(
    `INSERT INTO notification_send_attempt (
       notification_send_attempt_id, notification_job_id, attempt_number,
       provider, status, transition_version, transition_fence_digest,
       request_digest, provider_receipt_digest, provider_receipt_digest_scheme,
       provider_receipt_digest_key_id, stable_error_code, started_at,
       completed_at, release_id, created_at, updated_at
     ) VALUES (?, ?, 1, 'WECHAT', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      sendAttemptId,
      jobId,
      attemptStatus,
      transitionVersion,
      transitionFenceDigest,
      requestDigest,
      receiptDigest,
      accepted ? "hmac-sha256:v1" : null,
      accepted ? "notification-receipt-it-v1" : null,
      timestamp,
      terminal ? timestamp : null,
      releaseId,
      timestamp,
      timestamp,
    ]
  );
  await pool.execute(
    `INSERT INTO notification_send_attempt_transition (
       notification_send_attempt_transition_id, notification_send_attempt_id,
       transition_number, from_status, to_status, transition_fence_digest,
       provider_receipt_digest, provider_receipt_digest_scheme,
       provider_receipt_digest_key_id, stable_error_code, release_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      transitionId,
      sendAttemptId,
      transitionVersion,
      terminal ? "REQUESTED" : null,
      attemptStatus,
      transitionFenceDigest,
      receiptDigest,
      accepted ? "hmac-sha256:v1" : null,
      accepted ? "notification-receipt-it-v1" : null,
      releaseId,
      timestamp,
    ]
  );
  return Object.freeze({ sendAttemptId, attemptStatus });
}

async function seedCoreRecipient(pool, suffix) {
  const rootUserId = `root_core_${suffix}`;
  const recipientWechatIdentityId = `wxi_core_${suffix}`;
  const recipientOpenid = `openid_core_${suffix}`;
  const timestamp = "2026-07-18 00:00:00.000";
  await pool.execute(
    `INSERT INTO root_user (
       root_user_id, unionid, lifecycle_status, source_channel, unionid_status,
       created_at, updated_at
     ) VALUES (?, NULL, 'ACTIVE', 'MYSQL_INTEGRATION', 'PENDING', ?, ?)`,
    [rootUserId, timestamp, timestamp]
  );
  await pool.execute(
    `INSERT INTO wechat_identity (
       wechat_identity_id, root_user_id, app_code, openid, unionid,
       unionid_status, unionid_trust_status, unionid_provenance_source,
       unionid_verified_at, unionid_provenance_canonical_version,
       unionid_provenance_digest, unionid_provenance_digest_scheme,
       unionid_provenance_key_id, created_at, updated_at, last_seen_at
     ) VALUES (
       ?, ?, 'MYROOT', ?, NULL, 'PENDING', 'UNVERIFIED', NULL, NULL,
       NULL, NULL, NULL, NULL, ?, ?, ?
     )`,
    [
      recipientWechatIdentityId,
      rootUserId,
      recipientOpenid,
      timestamp,
      timestamp,
      timestamp,
    ]
  );
  return Object.freeze({
    rootUserId,
    recipientWechatIdentityId,
    recipientRootUserId: rootUserId,
    recipientAppCode: "MYROOT",
    recipientOpenid,
  });
}

async function prepareCoreAttempt(core, pool, suffix) {
  const recipient = await seedCoreRecipient(pool, suffix);
  const taskId = `task_core_${suffix}`;
  const taskOccurrenceDate = "2026-09-01";
  const templateVersion = "tpl-v1";
  const recipientBindingDigest = digest("core-binding", suffix);
  const decision = await core.recordDecision({
    rootUserId: recipient.rootUserId,
    taskId,
    taskOccurrenceDate,
    templateVersion,
    grantRequestId: `grant-core-${suffix}`,
    nativeDecision: "ACCEPTED",
    reasonCode: null,
    idempotencyKey: `decision-core-${suffix}`,
    decidedAt: "2026-07-18T00:00:00.000Z",
    releaseId: CORE_RELEASE_ID,
    recipientWechatIdentityId: recipient.recipientWechatIdentityId,
    recipientAppCode: recipient.recipientAppCode,
    recipientBindingCanonicalVersion: "canonical-json:v1",
    recipientBindingDigest,
    recipientBindingDigestScheme: "hmac-sha256:v1",
    recipientBindingKeyId: "recipient-binding-core-it-v1",
  });
  const job = await core.schedule({
    grantId: decision.grantId,
    rootUserId: recipient.rootUserId,
    taskId,
    taskOccurrenceDate,
    templateVersion,
    dueAt: "2026-09-01T01:00:00.000Z",
    idempotencyKey: `schedule-core-${suffix}`,
    releaseId: CORE_RELEASE_ID,
  });
  const attempt = await core.beginSendAttempt({
    jobId: job.jobId,
    requestDigest: digest("core-request", suffix),
    transitionFenceDigest: digest("core-transition", suffix, "requested"),
    startedAt: "2026-09-01T00:59:00.000Z",
    releaseId: CORE_RELEASE_ID,
  });
  return Object.freeze({
    decision,
    job,
    attempt,
    recipient,
    recipientBindingDigest,
  });
}

function startInput(prepared, claim, overrides = {}) {
  return {
    attemptId: prepared.attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    requestDigest: prepared.attempt.requestDigest,
    recipientBindingDigest: prepared.recipientBindingDigest,
    recipientWechatIdentityId: prepared.recipient.recipientWechatIdentityId,
    recipientRootUserId: prepared.recipient.recipientRootUserId,
    recipientAppCode: prepared.recipient.recipientAppCode,
    recipientOpenid: prepared.recipient.recipientOpenid,
    releaseId: CORE_RELEASE_ID,
    ...overrides,
  };
}

function completionInput(prepared, claim, suffix) {
  return Object.freeze({
    attemptId: prepared.attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: prepared.attempt.transitionFenceDigest,
    nextTransitionFenceDigest: digest("core-transition", suffix, "accepted"),
    outcome: "ACCEPTED",
    providerReceipt: `wechat-msgid:${suffix}`,
    stableErrorCode: null,
    completedAt: "2026-09-01T01:00:01.000Z",
    releaseId: CORE_RELEASE_ID,
  });
}

async function attemptAuthority(pool, attemptId) {
  const [rows] = await pool.execute(
    `SELECT attempt.status, attempt.transition_version,
            attempt.provider_call_state, attempt.provider_call_owner,
            attempt.provider_call_generation, attempt.provider_receipt_digest,
            job.status AS job_status, subscription_grant.status AS grant_status,
            COUNT(transition_row.notification_send_attempt_transition_id) AS transition_count
     FROM notification_send_attempt AS attempt
     INNER JOIN notification_job_v1 AS job
       ON job.notification_job_id = attempt.notification_job_id
     INNER JOIN notification_subscription_grant_v1 AS subscription_grant
       ON subscription_grant.notification_subscription_grant_id = job.notification_subscription_grant_id
     LEFT JOIN notification_send_attempt_transition AS transition_row
       ON transition_row.notification_send_attempt_id = attempt.notification_send_attempt_id
     WHERE attempt.notification_send_attempt_id = ?
     GROUP BY attempt.notification_send_attempt_id, attempt.status,
              attempt.transition_version, attempt.provider_call_state,
              attempt.provider_call_owner, attempt.provider_call_generation,
              attempt.provider_receipt_digest, job.status, subscription_grant.status`,
    [attemptId]
  );
  assert.equal(rows.length, 1);
  return Object.freeze({
    status: rows[0].status,
    transitionVersion: Number(rows[0].transition_version),
    providerCallState: rows[0].provider_call_state,
    providerCallOwner: rows[0].provider_call_owner,
    providerCallGeneration: Number(rows[0].provider_call_generation),
    providerReceiptDigest: rows[0].provider_receipt_digest,
    jobStatus: rows[0].job_status,
    grantStatus: rows[0].grant_status,
    transitionCount: Number(rows[0].transition_count),
  });
}

async function providerColumns(pool) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME AS column_name,
            ORDINAL_POSITION AS ordinal_position,
            IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default,
            COLUMN_TYPE AS column_type,
            CHARACTER_SET_NAME AS character_set_name,
            COLLATION_NAME AS collation_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'notification_send_attempt'
     ORDER BY ordinal_position`
  );
  return rows.map(normalizeProviderColumn);
}

async function providerIndexes(pool) {
  const [rows] = await pool.execute(
    `SELECT INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique,
            SEQ_IN_INDEX AS seq_in_index,
            COLUMN_NAME AS column_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'notification_send_attempt'
       AND index_name IN (
         'idx_notification_provider_call_recovery',
         'idx_notification_provider_call_owner'
       )
     ORDER BY index_name, seq_in_index`
  );
  return rows.map((row) => ({
    indexName: row.index_name,
    nonUnique: Number(row.non_unique),
    sequence: Number(row.seq_in_index),
    columnName: row.column_name,
  }));
}

async function providerChecks(pool) {
  const [rows] = await pool.execute(
    `SELECT tc.CONSTRAINT_NAME AS constraint_name,
            tc.ENFORCED AS enforced,
            cc.CHECK_CLAUSE AS check_clause
     FROM information_schema.table_constraints AS tc
     INNER JOIN information_schema.check_constraints AS cc
       ON cc.constraint_schema = tc.constraint_schema
      AND cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.table_name = 'notification_send_attempt'
       AND tc.constraint_name = 'chk_notification_provider_call_fence'`
  );
  return rows;
}

async function providerRows(pool) {
  const [rows] = await pool.execute(
    `SELECT notification_send_attempt_id, status, provider_call_state,
            provider_call_owner, provider_call_lease_expires_at,
            provider_call_generation, provider_call_started_at
     FROM notification_send_attempt
     ORDER BY notification_send_attempt_id`
  );
  return rows.map((row) => ({
    attemptId: row.notification_send_attempt_id,
    status: row.status,
    providerCallState: row.provider_call_state,
    providerCallOwner: row.provider_call_owner,
    providerCallLeaseExpiresAt: row.provider_call_lease_expires_at,
    providerCallGeneration: row.provider_call_generation === null
      ? null
      : Number(row.provider_call_generation),
    providerCallStartedAt: row.provider_call_started_at,
  }));
}

function assertStageColumns(columns, nullable) {
  const requestDigestIndex = columns.findIndex((row) => row.column_name === "request_digest");
  assert.notEqual(requestDigestIndex, -1);
  const provider = columns.slice(requestDigestIndex + 1, requestDigestIndex + 6);
  assert.deepEqual(provider.map((row) => row.column_name), [
    "provider_call_state",
    "provider_call_owner",
    "provider_call_lease_expires_at",
    "provider_call_generation",
    "provider_call_started_at",
  ]);
  assert.deepEqual(provider.map((row) => row.is_nullable), [
    nullable ? "YES" : "NO",
    "YES",
    "YES",
    nullable ? "YES" : "NO",
    "YES",
  ]);
  assert.equal(provider[0].column_type.toLowerCase(), "varchar(24)");
  assert.equal(provider[0].character_set_name, "ascii");
  assert.equal(provider[0].collation_name, "ascii_bin");
  assert.equal(provider[1].column_type.toLowerCase(), "varchar(32)");
  assert.equal(provider[1].character_set_name, "ascii");
  assert.equal(provider[1].collation_name, "ascii_bin");
  assert.equal(provider[2].column_type.toLowerCase(), "datetime(3)");
  assert.equal(provider[3].column_type.toLowerCase(), "bigint unsigned");
  assert.equal(provider[4].column_type.toLowerCase(), "datetime(3)");
  if (!nullable) assert.equal(String(provider[3].column_default), "0");
}

test("integration guards reject remote hosts and non-disposable database names", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.candidate.internal" }),
    { code: "NOTIFICATION_PROVIDER_FENCE_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_notif_fence_it_candidate_deadbeefdeadbeef",
    "myroot_notif_fence_it_123_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "NOTIFICATION_PROVIDER_FENCE_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(createDatabaseName(), /^myroot_notif_fence_it_[0-9]+_[0-9a-f]{16}$/);
  assert.deepEqual(normalizeProviderColumn({
    COLUMN_NAME: "request_digest",
    ORDINAL_POSITION: 8,
    IS_NULLABLE: "NO",
    COLUMN_DEFAULT: null,
    COLUMN_TYPE: "char(64)",
    CHARACTER_SET_NAME: "ascii",
    COLLATION_NAME: "ascii_bin",
  }), {
    column_name: "request_digest",
    ordinal_position: 8,
    is_nullable: "NO",
    column_default: null,
    column_type: "char(64)",
    character_set_name: "ascii",
    collation_name: "ascii_bin",
  });
  const availableFiles = listMigrationFiles(MIGRATIONS_DIRECTORY);
  assert.ok(availableFiles.length >= MAX_MIGRATION_ORDINAL);
  assert.equal(availableFiles[MAX_MIGRATION_ORDINAL - 1], ENFORCE_MIGRATION);
  assert.deepEqual(
    availableFiles.map((fileName) => fileName.slice(0, 3)),
    Array.from(
      { length: availableFiles.length },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );
});

test("real MySQL proves provider-call fencing migrations 058 through 060", {
  skip: ENABLED
    ? false
    : "set NOTIFICATION_PROVIDER_FENCE_MYSQL_INTEGRATION_ENABLED=true on an isolated local MySQL 8 server",
  timeout: 120_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const subsets = createMigrationSubsets();
  let serverConnection;
  let pool;
  let poolB;
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

    const through057 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[57],
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(through057.latestVersion, "057_notification_recipient_binding_v1_enforce.sql");
    const historicalRequested = await insertAttemptChain(pool, "hist_req", "REQUESTED");
    const historicalAccepted = await insertAttemptChain(pool, "hist_acc", "ACCEPTED");

    const through058 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[58],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(through058.applied, [STAGE_MIGRATION]);
    assertStageColumns(await providerColumns(pool), true);
    assert.deepEqual(await providerIndexes(pool), []);
    assert.deepEqual(await providerChecks(pool), []);
    for (const row of await providerRows(pool)) {
      assert.equal(row.providerCallState, null);
      assert.equal(row.providerCallOwner, null);
      assert.equal(row.providerCallLeaseExpiresAt, null);
      assert.equal(row.providerCallGeneration, null);
      assert.equal(row.providerCallStartedAt, null);
    }

    await pool.execute("DELETE FROM schema_migrations WHERE version = ?", [STAGE_MIGRATION]);
    const recovered058 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[58],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(recovered058.applied, []);
    assert.deepEqual(recovered058.reconciled.map((item) => item.version), [STAGE_MIGRATION]);

    const betweenStageAndBackfill = await insertAttemptChain(pool, "between", "REQUESTED");
    const through059 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[59],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(through059.applied, [BACKFILL_MIGRATION]);
    const backfilled = new Map((await providerRows(pool)).map((row) => [row.attemptId, row]));
    for (const attempt of [historicalRequested, betweenStageAndBackfill]) {
      assert.equal(backfilled.get(attempt.sendAttemptId).providerCallState, "REVIEW_REQUIRED");
      assert.equal(backfilled.get(attempt.sendAttemptId).providerCallGeneration, 0);
    }
    assert.equal(backfilled.get(historicalAccepted.sendAttemptId).providerCallState, "COMPLETED");
    assert.equal(backfilled.get(historicalAccepted.sendAttemptId).providerCallGeneration, 0);
    for (const row of backfilled.values()) {
      assert.equal(row.providerCallOwner, null);
      assert.equal(row.providerCallLeaseExpiresAt, null);
      assert.equal(row.providerCallStartedAt, null);
    }
    const beforeBackfillReplay = await providerRows(pool);
    const replay059 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[59],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(replay059.applied, []);
    assert.deepEqual(replay059.reconciled, []);
    assert.deepEqual(await providerRows(pool), beforeBackfillReplay);

    const oldWriterRace = await insertAttemptChain(pool, "old_race", "REQUESTED");
    await expectMysqlErrno(
      () => applyMysqlMigrations(pool, {
        database,
        migrationsDir: subsets.directories[60],
        migrationLockTimeoutSeconds: 10,
      }),
      1062
    );
    assert.equal(await migrationApplied(pool, ENFORCE_MIGRATION), false);
    assertStageColumns(await providerColumns(pool), true);
    assert.deepEqual(await providerIndexes(pool), []);
    assert.deepEqual(await providerChecks(pool), []);

    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'REVIEW_REQUIRED', provider_call_owner = NULL,
           provider_call_lease_expires_at = NULL, provider_call_generation = 0,
           provider_call_started_at = NULL
       WHERE notification_send_attempt_id = ?`,
      [oldWriterRace.sendAttemptId]
    );
    const through060 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[60],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(through060.applied, [ENFORCE_MIGRATION]);
    assertStageColumns(await providerColumns(pool), false);
    assert.deepEqual(await providerIndexes(pool), [
      { indexName: "idx_notification_provider_call_owner", nonUnique: 1, sequence: 1, columnName: "provider_call_owner" },
      { indexName: "idx_notification_provider_call_owner", nonUnique: 1, sequence: 2, columnName: "provider_call_generation" },
      { indexName: "idx_notification_provider_call_owner", nonUnique: 1, sequence: 3, columnName: "notification_send_attempt_id" },
      { indexName: "idx_notification_provider_call_recovery", nonUnique: 1, sequence: 1, columnName: "status" },
      { indexName: "idx_notification_provider_call_recovery", nonUnique: 1, sequence: 2, columnName: "provider_call_state" },
      { indexName: "idx_notification_provider_call_recovery", nonUnique: 1, sequence: 3, columnName: "provider_call_lease_expires_at" },
      { indexName: "idx_notification_provider_call_recovery", nonUnique: 1, sequence: 4, columnName: "notification_send_attempt_id" },
    ]);
    const checks = await providerChecks(pool);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].constraint_name, "chk_notification_provider_call_fence");
    assert.equal(checks[0].enforced, "YES");
    assert.match(checks[0].check_clause, /provider_call_state/);
    assert.match(checks[0].check_clause, /STARTED/);
    assert.match(checks[0].check_clause, /COMPLETED/);

    const requestedId = historicalRequested.sendAttemptId;
    const acceptedId = historicalAccepted.sendAttemptId;
    const owner = "owner-notification-fence-it-001";
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'AVAILABLE', provider_call_owner = ?
         WHERE notification_send_attempt_id = ?`,
        [owner, requestedId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'LEASED', provider_call_owner = ?,
             provider_call_lease_expires_at = TIMESTAMPADD(SECOND, 10, CURRENT_TIMESTAMP(3)),
             provider_call_generation = 0, provider_call_started_at = NULL
         WHERE notification_send_attempt_id = ?`,
        [owner, requestedId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'STARTED', provider_call_owner = ?,
             provider_call_lease_expires_at = TIMESTAMPADD(SECOND, 10, CURRENT_TIMESTAMP(3)),
             provider_call_generation = 1, provider_call_started_at = NULL
         WHERE notification_send_attempt_id = ?`,
        [owner, requestedId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'STARTED', provider_call_owner = ?,
             provider_call_lease_expires_at = CURRENT_TIMESTAMP(3),
             provider_call_generation = 1, provider_call_started_at = CURRENT_TIMESTAMP(3)
         WHERE notification_send_attempt_id = ?`,
        [owner, requestedId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'COMPLETED', provider_call_owner = NULL,
             provider_call_lease_expires_at = NULL, provider_call_generation = 0,
             provider_call_started_at = NULL
         WHERE notification_send_attempt_id = ?`,
        [requestedId]
      ),
      3819
    );
    await expectMysqlErrno(
      () => pool.execute(
        `UPDATE notification_send_attempt
         SET provider_call_state = 'AVAILABLE'
         WHERE notification_send_attempt_id = ?`,
        [acceptedId]
      ),
      3819
    );

    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'AVAILABLE', provider_call_owner = NULL,
           provider_call_lease_expires_at = NULL, provider_call_generation = 0,
           provider_call_started_at = NULL
       WHERE notification_send_attempt_id = ?`,
      [requestedId]
    );
    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'LEASED', provider_call_owner = ?,
           provider_call_lease_expires_at = TIMESTAMPADD(SECOND, 10, CURRENT_TIMESTAMP(3)),
           provider_call_generation = 1, provider_call_started_at = NULL
       WHERE notification_send_attempt_id = ?`,
      [owner, requestedId]
    );
    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'STARTED',
           provider_call_started_at = TIMESTAMPADD(SECOND, -1, provider_call_lease_expires_at)
       WHERE notification_send_attempt_id = ?`,
      [requestedId]
    );
    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'REVIEW_REQUIRED', provider_call_owner = NULL,
           provider_call_lease_expires_at = NULL, provider_call_generation = 0,
           provider_call_started_at = NULL
       WHERE notification_send_attempt_id = ?`,
      [requestedId]
    );
    await pool.execute(
      `UPDATE notification_send_attempt
       SET provider_call_state = 'COMPLETED', provider_call_owner = ?,
           provider_call_lease_expires_at = TIMESTAMPADD(SECOND, 10, CURRENT_TIMESTAMP(3)),
           provider_call_generation = 1,
           provider_call_started_at = CURRENT_TIMESTAMP(3)
       WHERE notification_send_attempt_id = ?`,
      [owner, acceptedId]
    );

    await pool.execute("DELETE FROM schema_migrations WHERE version = ?", [ENFORCE_MIGRATION]);
    const recovered060 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[60],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(recovered060.applied, []);
    assert.deepEqual(recovered060.reconciled.map((item) => item.version), [ENFORCE_MIGRATION]);

    const structureBeforeBackfillMarkerRecovery = await providerColumns(pool);
    const dataBeforeBackfillMarkerRecovery = await providerRows(pool);
    await pool.execute("DELETE FROM schema_migrations WHERE version = ?", [BACKFILL_MIGRATION]);
    const recovered059 = await applyMysqlMigrations(pool, {
      database,
      migrationsDir: subsets.directories[60],
      migrationLockTimeoutSeconds: 10,
    });
    assert.deepEqual(recovered059.applied, [BACKFILL_MIGRATION]);
    assert.deepEqual(recovered059.reconciled, []);
    assert.deepEqual(await providerColumns(pool), structureBeforeBackfillMarkerRecovery);
    assert.deepEqual(await providerRows(pool), dataBeforeBackfillMarkerRecovery);

    poolB = createPool(serverConfig, database);
    const coreA = createNotificationCore(pool);
    const coreB = createNotificationCore(poolB);

    const concurrent = await prepareCoreAttempt(coreA, pool, "concurrent");
    const competingClaims = await Promise.all([
      coreA.claimProviderCall({
        attemptId: concurrent.attempt.attemptId,
        releaseId: CORE_RELEASE_ID,
      }),
      coreB.claimProviderCall({
        attemptId: concurrent.attempt.attemptId,
        releaseId: CORE_RELEASE_ID,
      }),
    ]);
    assert.equal(competingClaims.filter((claim) => claim.leaseAcquired).length, 1);
    assert.equal(competingClaims.filter((claim) => !claim.leaseAcquired).length, 1);
    const winningClaim = competingClaims.find((claim) => claim.leaseAcquired);
    assert.equal(winningClaim.leaseGeneration, 1);
    assert.equal(winningClaim.leaseOwner.length, 32);
    let concurrentAuthority = await attemptAuthority(pool, concurrent.attempt.attemptId);
    assert.equal(concurrentAuthority.providerCallState, "LEASED");
    assert.equal(concurrentAuthority.providerCallOwner, winningClaim.leaseOwner);
    assert.equal(concurrentAuthority.providerCallGeneration, 1);

    const startedConcurrent = await coreA.startProviderCall(
      startInput(concurrent, winningClaim)
    );
    assert.equal(startedConcurrent.providerCallStarted, true);
    const completeInput = completionInput(concurrent, winningClaim, "concurrent");
    const competingCompletions = await Promise.all([
      coreA.completeSendAttempt(completeInput),
      coreB.completeSendAttempt(completeInput),
    ]);
    assert.equal(competingCompletions.filter((result) => result.replayed === false).length, 1);
    assert.equal(competingCompletions.filter((result) => result.replayed === true).length, 1);
    concurrentAuthority = await attemptAuthority(pool, concurrent.attempt.attemptId);
    assert.equal(concurrentAuthority.status, "ACCEPTED");
    assert.equal(concurrentAuthority.providerCallState, "COMPLETED");
    assert.equal(concurrentAuthority.transitionVersion, 2);
    assert.equal(concurrentAuthority.transitionCount, 2);
    assert.equal(concurrentAuthority.jobStatus, "PROVIDER_ACCEPTED");
    assert.equal(concurrentAuthority.grantStatus, "CONSUMED");
    assert.match(concurrentAuthority.providerReceiptDigest, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(competingCompletions).includes(completeInput.providerReceipt), false);

    const takeover = await prepareCoreAttempt(coreA, pool, "takeover");
    const oldClaim = await coreA.claimProviderCall({
      attemptId: takeover.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    assert.equal(oldClaim.leaseAcquired, true);
    const [expireLeased] = await poolB.execute(
      `UPDATE notification_send_attempt
       SET provider_call_lease_expires_at = TIMESTAMPADD(MICROSECOND, -1000, CURRENT_TIMESTAMP(3))
       WHERE notification_send_attempt_id = ?
         AND provider_call_state = 'LEASED'
         AND provider_call_owner = ?
         AND provider_call_generation = ?`,
      [takeover.attempt.attemptId, oldClaim.leaseOwner, oldClaim.leaseGeneration]
    );
    assert.equal(expireLeased.affectedRows, 1);
    const newClaim = await coreB.claimProviderCall({
      attemptId: takeover.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    assert.equal(newClaim.leaseAcquired, true);
    assert.equal(newClaim.leaseGeneration, oldClaim.leaseGeneration + 1);
    assert.notEqual(newClaim.leaseOwner, oldClaim.leaseOwner);
    const oldOwnerStart = await coreA.startProviderCall(startInput(takeover, oldClaim));
    assert.equal(oldOwnerStart.providerCallStarted, false);
    assert.equal(oldOwnerStart.fenced, true);
    const newOwnerStart = await coreB.startProviderCall(startInput(takeover, newClaim));
    assert.equal(newOwnerStart.providerCallStarted, true);
    const takeoverAuthority = await attemptAuthority(pool, takeover.attempt.attemptId);
    assert.equal(takeoverAuthority.providerCallState, "STARTED");
    assert.equal(takeoverAuthority.providerCallOwner, newClaim.leaseOwner);
    assert.equal(takeoverAuthority.providerCallGeneration, newClaim.leaseGeneration);

    const recovery = await prepareCoreAttempt(coreA, pool, "recovery");
    const recoveryClaim = await coreA.claimProviderCall({
      attemptId: recovery.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    const recoveryStarted = await coreA.startProviderCall(startInput(recovery, recoveryClaim));
    assert.equal(recoveryStarted.providerCallStarted, true);
    const [expireStarted] = await poolB.execute(
      `UPDATE notification_send_attempt
       SET provider_call_started_at = TIMESTAMPADD(SECOND, -2, CURRENT_TIMESTAMP(3)),
           provider_call_lease_expires_at = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(3))
       WHERE notification_send_attempt_id = ?
         AND provider_call_state = 'STARTED'
         AND provider_call_owner = ?
         AND provider_call_generation = ?`,
      [recovery.attempt.attemptId, recoveryClaim.leaseOwner, recoveryClaim.leaseGeneration]
    );
    assert.equal(expireStarted.affectedRows, 1);
    const forbiddenStartedTakeover = await coreB.claimProviderCall({
      attemptId: recovery.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    assert.equal(forbiddenStartedTakeover.leaseAcquired, false);
    const recoveryResults = await Promise.all([
      coreA.recoverProviderCall({
        attemptId: recovery.attempt.attemptId,
        releaseId: CORE_RELEASE_ID,
      }),
      coreB.recoverProviderCall({
        attemptId: recovery.attempt.attemptId,
        releaseId: CORE_RELEASE_ID,
      }),
    ]);
    assert.equal(recoveryResults.every((result) => result.providerCallRecoveredUnknown), true);
    const recoveryAuthority = await attemptAuthority(pool, recovery.attempt.attemptId);
    assert.equal(recoveryAuthority.status, "UNKNOWN");
    assert.equal(recoveryAuthority.providerCallState, "COMPLETED");
    assert.equal(recoveryAuthority.transitionVersion, 2);
    assert.equal(recoveryAuthority.transitionCount, 2);
    assert.equal(recoveryAuthority.jobStatus, "OUTCOME_UNKNOWN");
    assert.equal(recoveryAuthority.grantStatus, "REVIEW_REQUIRED");
    await assert.rejects(
      coreA.completeSendAttempt(completionInput(recovery, recoveryClaim, "recovery-late")),
      (error) => error && error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );

    const identityDrift = await prepareCoreAttempt(coreA, pool, "identity");
    const identityClaim = await coreA.claimProviderCall({
      attemptId: identityDrift.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    const changedOpenid = "openid_core_identity_changed";
    const [changeIdentity] = await poolB.execute(
      `UPDATE wechat_identity
       SET openid = ?, updated_at = CURRENT_TIMESTAMP(3), last_seen_at = CURRENT_TIMESTAMP(3)
       WHERE wechat_identity_id = ? AND root_user_id = ? AND app_code = 'MYROOT'`,
      [
        changedOpenid,
        identityDrift.recipient.recipientWechatIdentityId,
        identityDrift.recipient.rootUserId,
      ]
    );
    assert.equal(changeIdentity.affectedRows, 1);
    const driftFenced = await coreA.startProviderCall(startInput(identityDrift, identityClaim));
    assert.equal(driftFenced.providerCallStarted, false);
    assert.equal(driftFenced.fenced, true);
    const identityAuthority = await attemptAuthority(pool, identityDrift.attempt.attemptId);
    assert.equal(identityAuthority.providerCallState, "LEASED");
    assert.equal(identityAuthority.providerCallOwner, identityClaim.leaseOwner);
    assert.equal(identityAuthority.providerCallGeneration, identityClaim.leaseGeneration);

    const acknowledgement = await prepareCoreAttempt(coreA, pool, "ackloss");
    const acknowledgementClaim = await coreA.claimProviderCall({
      attemptId: acknowledgement.attempt.attemptId,
      releaseId: CORE_RELEASE_ID,
    });
    const acknowledgementStarted = await coreA.startProviderCall(
      startInput(acknowledgement, acknowledgementClaim)
    );
    assert.equal(acknowledgementStarted.providerCallStarted, true);
    const acknowledgementCompletion = completionInput(
      acknowledgement,
      acknowledgementClaim,
      "ackloss"
    );
    const acknowledgementCore = createNotificationCore(
      createCommitAckAfterSuccessPool(pool)
    );
    const acknowledgementRecovered = await acknowledgementCore.completeSendAttempt(
      acknowledgementCompletion
    );
    assert.equal(acknowledgementRecovered.replayed, true);
    assert.equal(acknowledgementRecovered.commitAcknowledgementRecovered, true);
    assert.equal(acknowledgementRecovered.transactionState, "ACKNOWLEDGEMENT_RECOVERED");
    const acknowledgementAuthority = await attemptAuthority(
      poolB,
      acknowledgement.attempt.attemptId
    );
    assert.equal(acknowledgementAuthority.status, "ACCEPTED");
    assert.equal(acknowledgementAuthority.providerCallState, "COMPLETED");
    assert.equal(acknowledgementAuthority.transitionVersion, 2);
    assert.equal(acknowledgementAuthority.transitionCount, 2);
    assert.equal(acknowledgementAuthority.jobStatus, "PROVIDER_ACCEPTED");
    assert.equal(acknowledgementAuthority.grantStatus, "CONSUMED");
  } finally {
    if (poolB) {
      try { await poolB.end(); } catch (error) { cleanupErrors.push(error); }
    }
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
      cleanupErrors.push(integrationError("NOTIFICATION_PROVIDER_FENCE_INTEGRATION_DATABASE_CLEANUP_FAILED"));
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Notification provider-fence integration cleanup failed");
    }
  }
});
