const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OWNER_CONFIRMATION_RELATIONAL_TABLES,
} = require("../src/formalLaunchDataDisposition");
const {
  DEPENDENCY_QUERY,
  MIGRATION_QUERY,
  SCHEMA_SUMMARY_QUERY,
  SNAPSHOT_AGGREGATE_QUERY,
  TABLE_AGGREGATE_QUERY,
  TABLE_PROFILES,
  collectFormalLaunchMysqlDispositionReport,
} = require("../src/formalLaunchMysqlDispositionReport");
const {
  createCloudBaseExecutor,
  parseArguments,
  rowsFromCloudBaseOutput,
} = require("../scripts/cloudbase-formal-launch-disposition");

const QUERIES = [
  TABLE_AGGREGATE_QUERY,
  SNAPSHOT_AGGREGATE_QUERY,
  DEPENDENCY_QUERY,
  MIGRATION_QUERY,
  SCHEMA_SUMMARY_QUERY,
];

test("disposition collector exactly covers the owner-confirmation registry with SELECT-only queries", () => {
  assert.deepEqual(
    TABLE_PROFILES.map(({ tableName }) => tableName).sort(),
    [...OWNER_CONFIRMATION_RELATIONAL_TABLES].sort()
  );
  QUERIES.forEach((query) => {
    assert.match(query, /^SELECT\b/i);
    assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|CALL)\b/i);
  });
  assert.doesNotMatch(TABLE_AGGREGATE_QUERY, /(?:title|description|payload_json|request_json|response_json|root_user_id)\s+AS/i);
});

test("CloudBase executor always pins the target and read-only flag", async () => {
  const calls = [];
  const execute = createCloudBaseExecutor({
    environmentId: "myroot-prod-d5gl3gzg7115f149a",
    executable: "/safe/tcb",
    run: async (...args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ data: { items: [{ ok: 1 }] } }) };
    },
  });
  assert.deepEqual(await execute("SELECT 1 AS ok"), [{ ok: 1 }]);
  assert.deepEqual(calls[0][0], "/safe/tcb");
  assert.deepEqual(calls[0][1].slice(0, 7), [
    "db", "execute", "-e", "myroot-prod-d5gl3gzg7115f149a", "--read-only", "--json", "--sql",
  ]);
  await assert.rejects(() => execute("DELETE FROM root_user"), { code: "FORMAL_DISPOSITION_NON_SELECT_QUERY_FORBIDDEN" });
});

test("command requires explicit app and environment identities", () => {
  assert.deepEqual(parseArguments([
    "--read-only", "--appid", "wx7727a02565aed1c2", "--env-id", "myroot-prod-d5gl3gzg7115f149a",
  ]), {
    appId: "wx7727a02565aed1c2",
    environmentId: "myroot-prod-d5gl3gzg7115f149a",
  });
  assert.throws(() => parseArguments(["--read-only"]), { code: "FORMAL_DISPOSITION_COMMAND_INVALID" });
  assert.throws(() => rowsFromCloudBaseOutput("not-json"), { code: "FORMAL_DISPOSITION_CLOUDBASE_OUTPUT_INVALID" });
});

test("collector emits aggregate-only owner-confirmation evidence", async () => {
  const tableRows = TABLE_PROFILES.map((profile, index) => ({
    table_name: profile.tableName,
    row_count: index + 1,
    linked_user_count: profile.userColumn ? 1 : null,
    linked_campaign_count: profile.campaignColumn ? 1 : null,
    first_record_at: "2026-07-11 16:15:04.000",
    last_record_at: "2026-07-15 17:09:05.000",
  }));
  const snapshots = Object.fromEntries(TABLE_PROFILES.map((profile, index) => [profile.snapshotKey, index + 1]));
  const results = new Map([
    [TABLE_AGGREGATE_QUERY, tableRows],
    [SNAPSHOT_AGGREGATE_QUERY, [snapshots]],
    [DEPENDENCY_QUERY, [{ table_name: "task_activity_assignment", referenced_table_name: "task_definition", constraint_name: "fk_task" }]],
    [MIGRATION_QUERY, [{ migration_count: 66, latest_migration: "066.sql" }]],
    [SCHEMA_SUMMARY_QUERY, [{ table_count: 56, estimated_nonempty_table_count: 17 }]],
  ]);
  const report = await collectFormalLaunchMysqlDispositionReport({
    appId: "wx7727a02565aed1c2",
    environmentId: "myroot-prod-d5gl3gzg7115f149a",
    execute: async (query) => results.get(query),
    now: () => "2026-08-04T05:00:00.000Z",
  });
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.summary, {
    ownerConfirmationTableCount: 11,
    tablesWithRows: 11,
    totalRows: 66,
    snapshotMismatchCount: 0,
  });
  assert.deepEqual(
    report.tables.find(({ tableName }) => tableName === "task_definition").inboundDependencies,
    ["task_activity_assignment"]
  );
  assert.equal(report.tables[0].disposition, "OWNER_CONFIRMATION_REQUIRED");
});
