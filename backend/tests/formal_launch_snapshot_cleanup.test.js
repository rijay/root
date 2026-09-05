const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildFormalLaunchSnapshotCleanupPlan,
  collectionCount,
} = require("../src/formalLaunchSnapshotCleanup");
const {
  ACTIVE_RELATIONAL_TABLES,
  ACTIVE_SNAPSHOT_KEYS,
  ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
  CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES,
  CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
  FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
  PROTECTED_SNAPSHOT_KEYS,
  RELATIONAL_DISPOSITION_GROUPS,
  RETIRED_SNAPSHOT_DEFAULT_KEYS,
  SYSTEM_RELATIONAL_TABLES,
} = require("../src/formalLaunchDataDisposition");
const { createSeedData } = require("../src/seed");
const { createEmptyData } = require("../src/store");
const { parseArgs, parseSnapshot } = require("../scripts/formal-launch-snapshot-cleanup-dry-run");
const { migrationChecksum, splitSqlStatements } = require("../src/mysqlMigrations");

const cleanupMigrationName = "067_formal_launch_retired_runtime_cleanup.sql";
const cleanupMigrationPath = path.join(__dirname, "..", "db", "migrations", cleanupMigrationName);
const confirmedCleanupMigrationName = "068_formal_launch_confirmed_prelaunch_cleanup.sql";
const confirmedCleanupMigrationPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  confirmedCleanupMigrationName
);

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
    operationTasks: [{ operation_task_id: "still-needs-confirmation" }],
    productionCutoverProofs: [{ proof_id: "old-proof" }],
  };
  const original = JSON.stringify(snapshot);
  const report = buildFormalLaunchSnapshotCleanupPlan(snapshot);
  const serialized = JSON.stringify(report);

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.dispositionVersion, FORMAL_LAUNCH_DATA_DISPOSITION_VERSION);
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

test("one Registry classifies every snapshot key and every retained relational table exactly once", () => {
  const snapshotGroups = [
    ACTIVE_SNAPSHOT_KEYS,
    PROTECTED_SNAPSHOT_KEYS,
    AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
    CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
    ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
    CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
  ];
  const classifiedSnapshotKeys = snapshotGroups.flat().sort();
  const classifiedSnapshotKeySet = new Set(classifiedSnapshotKeys);
  assert.deepEqual(
    Object.keys(createSeedData()).filter((key) => !classifiedSnapshotKeySet.has(key)),
    []
  );
  assert.equal(new Set(classifiedSnapshotKeys).size, classifiedSnapshotKeys.length);

  const emptyData = createEmptyData();
  assert.deepEqual(
    Object.keys(emptyData).sort(),
    [...ACTIVE_SNAPSHOT_KEYS, ...PROTECTED_SNAPSHOT_KEYS].sort()
  );
  RETIRED_SNAPSHOT_DEFAULT_KEYS.forEach((key) => assert.equal(
    Object.prototype.hasOwnProperty.call(emptyData, key),
    false,
    key
  ));
  [...ACTIVE_SNAPSHOT_KEYS, ...PROTECTED_SNAPSHOT_KEYS].forEach((key) => assert.equal(
    Object.prototype.hasOwnProperty.call(emptyData, key),
    true,
    key
  ));

  const schema = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  const schemaTables = [...schema.matchAll(/^-- table: ([a-z0-9_]+)$/gm)].map((match) => match[1]);
  const classifiedTables = [
    ...ACTIVE_RELATIONAL_TABLES,
    ...SYSTEM_RELATIONAL_TABLES,
  ].sort();
  assert.deepEqual(classifiedTables, schemaTables.sort());
  assert.equal(new Set(classifiedTables).size, classifiedTables.length);
});

test("confirmed pre-launch collections are removed from the cleanup candidate", () => {
  const snapshot = Object.fromEntries(
    CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS.map((key) => [key, [{ old: true }]])
  );
  const report = buildFormalLaunchSnapshotCleanupPlan(snapshot);
  assert.equal(
    report.confirmedPrelaunchRetirement.length,
    CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS.length
  );
  assert.equal(report.confirmedPrelaunchRetirement.every(({ itemCount }) => itemCount === 1), true);
  assert.equal(report.blockers.some((item) => item.includes("pre-launch business records")), false);
});

test("confirmed relational retirement is intentionally outside the final schema registry", () => {
  assert.equal(CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES.length, 11);
  assert.equal(RELATIONAL_DISPOSITION_GROUPS.flat().some(
    (tableName) => CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES.includes(tableName)
  ), false);
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

test("068 removes only the confirmed pre-launch tables and snapshot collections", () => {
  const sql = fs.readFileSync(confirmedCleanupMigrationPath, "utf8");
  const statements = splitSqlStatements(sql);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "checksums.json"),
    "utf8"
  ));
  const tableCalls = [...sql.matchAll(
    /CALL assert_confirmed_prelaunch_table\('([a-z0-9_]+)',\s*\d+,\s*'[^']+'\)/g
  )].map((match) => match[1]);
  const tableDrops = [...sql.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+)/g)]
    .map((match) => match[1]);
  const snapshotPaths = [...new Set([...sql.matchAll(
    /'\$\.([A-Za-z][A-Za-z0-9]+)'/g
  )].map((match) => match[1]))].sort();

  assert.equal(statements.length, 29);
  assert.deepEqual(tableCalls.sort(), [...CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES].sort());
  assert.deepEqual(tableDrops.sort(), [...CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES].sort());
  assert.deepEqual(snapshotPaths, [
    ...CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
    "campaignDefinitions",
  ].sort());
  assert.match(sql, /@actual_row_count NOT IN \(0, confirmed_row_count\)/);
  assert.match(sql, /@actual_last_at > confirmed_last_at/);
  assert.match(sql, /snapshot inventory drifted/);
  assert.doesNotMatch(sql, /DROP TABLE `(?:root_user|wechat_identity|privacy_consent_record|questionnaire_answer)`/);
  assert.equal(manifest.files[confirmedCleanupMigrationName], migrationChecksum(sql));
});
