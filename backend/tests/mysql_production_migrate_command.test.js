const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertWriteConfirmation,
  migrationConfigFromEnv,
  parseArgs,
} = require("../scripts/mysql-production-migrate");

const SHA = "a".repeat(64);

test("production migration command separates plan from authorized apply", () => {
  const plan = parseArgs(["--plan", "--target", "candidate", "--release-id", "v1.0.0-rc1"]);
  assert.equal(plan.mode, "plan");
  assert.doesNotThrow(() => assertWriteConfirmation(plan, {}));

  const apply = parseArgs([
    "--apply", "--target", "production", "--release-id", "v1.0.0", "--authorization", SHA,
  ]);
  assert.throws(() => assertWriteConfirmation(apply, {}), {
    code: "MYSQL_MIGRATION_WRITE_CONFIRMATION_MISMATCH",
  });
  assert.doesNotThrow(() => assertWriteConfirmation(apply, {
    MYROOT_MYSQL_MIGRATION_WRITE_CONFIRM: `APPLY:production:v1.0.0:${SHA}`,
  }));
});

test("migration credentials use an isolated environment namespace", () => {
  const config = migrationConfigFromEnv({
    MYROOT_MYSQL_MIGRATION_ADDRESS: "127.0.0.1:3306",
    MYROOT_MYSQL_MIGRATION_USERNAME: "migration_actor",
    MYROOT_MYSQL_MIGRATION_PASSWORD: "not-a-real-secret",
    MYROOT_MYSQL_MIGRATION_DATABASE: "root_candidate",
  });
  assert.equal(config.user, "migration_actor");
  assert.equal(config.database, "root_candidate");
});

test("apply rejects target, release, or authorization ambiguity", () => {
  assert.throws(() => parseArgs(["--apply", "--target", "production", "--release-id", "v1.0.0"]), {
    code: "MYSQL_MIGRATION_AUTHORIZATION_INVALID",
  });
  assert.throws(() => parseArgs(["--plan", "--target", "unknown", "--release-id", "v1.0.0"]), {
    code: "MYSQL_MIGRATION_COMMAND_INVALID",
  });
});
