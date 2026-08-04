const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildFormalLaunchSnapshotCleanupPlan,
  collectionCount,
} = require("../src/formalLaunchSnapshotCleanup");
const { parseArgs, parseSnapshot } = require("../scripts/formal-launch-snapshot-cleanup-dry-run");
const { migrationChecksum, splitSqlStatements } = require("../src/mysqlMigrations");

const cleanupMigrationName = "067_formal_launch_retired_runtime_cleanup.sql";
const cleanupMigrationPath = path.join(__dirname, "..", "db", "migrations", cleanupMigrationName);

test("cleanup planning is dry-run only and never exposes record content", () => {
  const snapshot = {
    users: [{ user_id: "sensitive-user" }],
    profiles: [{ profile_id: "sensitive-profile", gut_health_status: "sensitive" }],
    sessions: [{ session_id: "sensitive-session" }],
    idempotency: {
      old_request: { code: 0, data: { token: "must-not-appear" } },
    },
    operationalAlertRuns: [{ operational_alert_run_id: "run-1" }],
    auditLogs: [
      { action: "OPERATIONAL_ALERT_JOB_PREVIEW", target_id: "old-preview" },
      { action: "FORMAL_CONTENT_PUBLISHED", target_id: "keep-audit" },
    ],
    taskEvents: [{ task_event_id: "legacy-event" }],
    productionCutoverProofs: [{ proof_id: "old-proof" }],
  };
  const original = JSON.stringify(snapshot);
  const report = buildFormalLaunchSnapshotCleanupPlan(snapshot);
  const serialized = JSON.stringify(report);

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.writePerformed, false);
  assert.equal(report.filteredAuditLogs.itemCount, 1);
  assert.ok(report.estimatedReducibleBytes > 0);
  assert.ok(report.blockers.some((item) => item.includes("pre-launch business records")));
  assert.ok(report.blockers.some((item) => item.includes("offline archive")));
  assert.ok(report.blockers.some((item) => item.includes("sessions")));
  assert.equal(serialized.includes("sensitive-user"), false);
  assert.equal(serialized.includes("must-not-appear"), false);
  assert.equal(JSON.stringify(snapshot), original);
});

test("collection counts support arrays, maps and missing values", () => {
  assert.equal(collectionCount([{}, {}]), 2);
  assert.equal(collectionCount({ one: {}, two: {} }), 2);
  assert.equal(collectionCount(undefined), 0);
});

test("CLI accepts only an explicit local input file", () => {
  assert.deepEqual(parseArgs(["--input", "snapshot.json"]).input.endsWith("snapshot.json"), true);
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["--input", "one.json", "--write"]), /Usage/);
  assert.deepEqual(parseSnapshot('{"payload_json":"{\\"users\\":[]}"}'), { users: [] });
});

test("067 cleanup is forward-only, guarded by empty-table inventory and leaves user history out", () => {
  const sql = fs.readFileSync(cleanupMigrationPath, "utf8");
  const statements = splitSqlStatements(sql);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "checksums.json"),
    "utf8"
  ));

  assert.equal(statements.length, 57);
  assert.match(sql, /SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /retired tables contain rows/);
  assert.equal((sql.match(/DROP PROCEDURE IF EXISTS v1_runtime_/g) || []).length, 22);
  assert.equal((sql.match(/DROP TABLE IF EXISTS /g) || []).length, 31);
  assert.doesNotMatch(sql, /DROP TABLE IF EXISTS (root_user|wechat_identity|privacy_consent_record|user_lifecycle_event|task_event|task_progress_snapshot|campaign_participant|notification_subscription);/);
  assert.equal(manifest.files[cleanupMigrationName], migrationChecksum(sql));
});
