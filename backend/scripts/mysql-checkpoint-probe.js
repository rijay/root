#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const mysql = require("mysql2/promise");
const os = require("node:os");
const path = require("node:path");
const { applyMysqlMigrations } = require("../src/mysqlMigrations");
const { createMysqlStore, mysqlConfigFromEnv } = require("../src/store");

function isIsolatedDatabaseName(value) {
  return /(?:^|_)(?:test|probe|local)(?:_|$)/i.test(String(value || ""));
}

function assertProbeAllowed(argv, config) {
  if (!argv.includes("--confirm-isolated-database")) {
    throw new Error("--confirm-isolated-database is required");
  }
  if (!isIsolatedDatabaseName(config.database)) {
    throw new Error("checkpoint probe refuses a database name without test, probe, or local");
  }
}

function waitWithTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function assertEmptyProbeDatabase(config) {
  const connection = await mysql.createConnection(config);
  try {
    const [rows] = await connection.execute(
      "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = ?",
      [config.database]
    );
    if (Number(rows[0] && (rows[0].table_count || rows[0].TABLE_COUNT) || 0) !== 0) {
      throw new Error("checkpoint probe requires an empty isolated database");
    }
  } finally {
    await connection.end();
  }
}

function createBaselineMigrationsDir() {
  const sourceDir = path.join(__dirname, "..", "db", "migrations");
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-migrations-004-"));
  for (const fileName of [
    "001_store_snapshot.sql",
    "002_core_relational.sql",
    "003_privacy_consent.sql",
    "004_external_evidence_minimization.sql",
  ]) {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
  }
  return targetDir;
}

async function schemaEvidence(config, grantId) {
  const connection = await mysql.createConnection(config);
  try {
    const [migrationRows] = await connection.query(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const [columnRows] = await connection.execute(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = ?
          AND (
            table_name = 'notification_subscription_grant'
            OR (table_name = 'notification_job' AND column_name = 'notification_subscription_grant_id')
            OR (table_name = 'notification_delivery' AND column_name IN ('notification_subscription_grant_id', 'external_error_code', 'delivery_outcome'))
          )
      `,
      [config.database]
    );
    const [grantRows] = await connection.execute(
      "SELECT status FROM notification_subscription_grant WHERE notification_subscription_grant_id = ?",
      [grantId]
    );
    return {
      versions: migrationRows.map((row) => row.version),
      columns: columnRows.map((row) => {
        return `${row.table_name || row.TABLE_NAME}.${row.column_name || row.COLUMN_NAME}`;
      }).sort(),
      grantProjectionStatus: grantRows[0] && grantRows[0].status || "",
    };
  } finally {
    await connection.end();
  }
}

async function runProbe(env = process.env, argv = process.argv.slice(2)) {
  const config = mysqlConfigFromEnv(env);
  assertProbeAllowed(argv, config);
  const policyEnv = { ...env, NODE_ENV: "production" };
  await assertEmptyProbeDatabase(config);
  const baselineMigrationsDir = createBaselineMigrationsDir();
  let baselineMigration = "";
  const baselinePool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  });
  try {
    const state = await applyMysqlMigrations(baselinePool, {
      database: config.database,
      migrationsDir: baselineMigrationsDir,
    });
    baselineMigration = state.latestVersion;
  } finally {
    await baselinePool.end();
    fs.rmSync(baselineMigrationsDir, { recursive: true, force: true });
  }
  if (baselineMigration !== "004_external_evidence_minimization.sql") {
    throw new Error(`checkpoint probe baseline migration mismatch: ${baselineMigration || "missing"}`);
  }
  const first = await createMysqlStore(config, { env: policyEnv, seedSampleData: false });
  const second = await createMysqlStore(config, { env: policyEnv, seedSampleData: false });
  const runId = crypto.randomBytes(8).toString("hex");
  const grantId = `nsg_probe_${runId}`;
  const reservedKey = `checkpoint-probe:${runId}:reserved`;
  const concurrentKey = `checkpoint-probe:${runId}:concurrent`;
  const finalizedKey = `checkpoint-probe:${runId}:finalized`;
  let signalCheckpoint;
  let releaseExternalCall;
  const checkpointReached = new Promise((resolve) => {
    signalCheckpoint = resolve;
  });
  const externalCallHeld = new Promise((resolve) => {
    releaseExternalCall = resolve;
  });
  let concurrentWriteVisibleAfterResume = false;
  let firstRequest = null;

  try {
    firstRequest = first.runRequest({ write: true }, async (data, control) => {
      data.idempotency[reservedKey] = { status: "RESERVED" };
      const now = new Date().toISOString();
      data.notificationSubscriptionGrants.push({
        notification_subscription_grant_id: grantId,
        notification_subscription_id: `nts_probe_${runId}`,
        root_user_id: `usr_probe_${runId}`,
        campaign_id: "ROOT_PROBE",
        template_key: "CHECKIN_REMINDER_NEXT_DAY",
        template_id: "tmpl_probe",
        template_version: "v-probe",
        grant_request_id: `grant-probe-${runId}`,
        status: "RESERVED",
        notification_job_id: `ntj_probe_${runId}`,
        last_notification_job_id: `ntj_probe_${runId}`,
        idempotency_key: `SUBSCRIPTION_GRANT:usr_probe_${runId}:grant-probe-${runId}`,
        source_channel: "MYSQL_CHECKPOINT_PROBE",
        granted_at: now,
        reserved_at: now,
        created_at: now,
        updated_at: now,
      });
      await control.checkpoint();
      signalCheckpoint();
      await externalCallHeld;
      await control.resume();
      concurrentWriteVisibleAfterResume = Boolean(data.idempotency[concurrentKey]);
      data.idempotency[finalizedKey] = { status: "FINALIZED" };
      const grant = data.notificationSubscriptionGrants.find((item) => {
        return item.notification_subscription_grant_id === grantId;
      });
      if (!grant) throw new Error("grant projection probe lost its reserved record");
      grant.status = "CONSUMED";
      grant.consumed_at = new Date().toISOString();
      grant.updated_at = grant.consumed_at;
    });

    await waitWithTimeout(checkpointReached, 5000, "checkpoint");
    const secondRequest = second.runRequest({ write: true }, async (data) => {
      data.idempotency[concurrentKey] = { status: "COMMITTED_WHILE_SUSPENDED" };
    });
    await waitWithTimeout(secondRequest, 5000, "concurrent request");
    releaseExternalCall();
    await waitWithTimeout(firstRequest, 5000, "checkpoint resume");
  } finally {
    releaseExternalCall();
    if (firstRequest) await Promise.allSettled([firstRequest]);
    await Promise.allSettled([first.close(), second.close()]);
  }

  const restarted = await createMysqlStore(config, { env: policyEnv, seedSampleData: false });
  let persisted;
  try {
    persisted = {
      reserved: Boolean(restarted.data.idempotency[reservedKey]),
      concurrent: Boolean(restarted.data.idempotency[concurrentKey]),
      finalized: Boolean(restarted.data.idempotency[finalizedKey]),
    };
  } finally {
    await restarted.close();
  }
  const schema = await schemaEvidence(config, grantId);
  const expectedColumns = [
    "notification_delivery.delivery_outcome",
    "notification_delivery.external_error_code",
    "notification_delivery.notification_subscription_grant_id",
    "notification_job.notification_subscription_grant_id",
  ];
  const grantColumnCount = schema.columns.filter((item) => item.startsWith("notification_subscription_grant.")).length;
  const report = {
    databaseClass: "isolated",
    baselineMigration,
    latestMigration: schema.versions.at(-1) || "",
    migrationCount: schema.versions.length,
    grantTableColumnCount: grantColumnCount,
    grantProjectionStatus: schema.grantProjectionStatus,
    reminderColumnsPresent: expectedColumns.every((column) => schema.columns.includes(column)),
    checkpointReleasedLock: true,
    concurrentWriteVisibleAfterResume,
    restartPersistence: persisted,
    pass: baselineMigration === "004_external_evidence_minimization.sql" &&
      schema.versions.at(-1) === "006_command_event_foundation.sql" &&
      grantColumnCount >= 20 &&
      schema.grantProjectionStatus === "CONSUMED" &&
      expectedColumns.every((column) => schema.columns.includes(column)) &&
      concurrentWriteVisibleAfterResume &&
      Object.values(persisted).every(Boolean),
  };
  return report;
}

if (require.main === module) {
  runProbe().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) throw new Error("checkpoint probe failed");
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertProbeAllowed,
  isIsolatedDatabaseName,
  runProbe,
};
