const assert = require("node:assert/strict");
const test = require("node:test");

const {
  expectedMysqlMigrationRows,
  readMysqlMigrationPlan,
  verifyMysqlMigrations,
} = require("../src/mysqlMigrations");
const { resolveMysqlMigrationMode } = require("../src/store");

function poolWithLedger(rows, options = {}) {
  const state = { released: false };
  return {
    state,
    async getConnection() {
      return {
        async execute(sql) {
          assert.match(sql, /information_schema\.tables/);
          return [[{ table_count: options.ledgerExists === false ? 0 : 1 }]];
        },
        async query(sql) {
          assert.match(sql, /FROM schema_migrations/);
          return [rows];
        },
        release() { state.released = true; },
      };
    },
  };
}

test("production runtime requires explicit verify_only migration mode", () => {
  assert.equal(resolveMysqlMigrationMode({ NODE_ENV: "test" }), "auto_apply");
  assert.equal(resolveMysqlMigrationMode({
    NODE_ENV: "production",
    ROOT_MYSQL_MIGRATION_MODE: "verify_only",
  }), "verify_only");
  assert.throws(
    () => resolveMysqlMigrationMode({ NODE_ENV: "production" }),
    { code: "MYSQL_MIGRATION_MODE_INVALID" }
  );
  assert.throws(
    () => resolveMysqlMigrationMode({
      NODE_ENV: "production",
      ROOT_MYSQL_MIGRATION_MODE: "auto_apply",
    }),
    { code: "MYSQL_MIGRATION_MODE_INVALID" }
  );
});

test("verify_only accepts the exact immutable migration ledger", async () => {
  const rows = expectedMysqlMigrationRows().map((row) => ({ ...row, applied_at: "2026-07-20" }));
  const pool = poolWithLedger(rows);
  const result = await verifyMysqlMigrations(pool);
  assert.equal(result.verifiedOnly, true);
  assert.equal(result.latestVersion, rows.at(-1).version);
  assert.equal(pool.state.released, true);
});

test("verify_only fails closed when Candidate or production is behind", async () => {
  const expected = expectedMysqlMigrationRows();
  const pool = poolWithLedger(expected.slice(0, 5));
  const plan = await readMysqlMigrationPlan(pool);
  assert.equal(plan.ready, false);
  assert.equal(plan.appliedCount, 5);
  assert.equal(plan.pending.length, expected.length - 5);

  await assert.rejects(
    () => verifyMysqlMigrations(poolWithLedger(expected.slice(0, 5))),
    (error) => error.code === "MYSQL_MIGRATION_REQUIRED"
      && error.detail.expectedLatestVersion === expected.at(-1).version
      && error.detail.pendingCount === expected.length - 5
  );
});

test("migration ledger checksum drift is never auto-repaired", async () => {
  const expected = expectedMysqlMigrationRows();
  const rows = expected.slice(0, 5).map((row) => ({ ...row }));
  rows[4].checksum = "0".repeat(64);
  await assert.rejects(
    () => readMysqlMigrationPlan(poolWithLedger(rows)),
    { code: "MYSQL_MIGRATION_LEDGER_CHECKSUM_DRIFT" }
  );
});
