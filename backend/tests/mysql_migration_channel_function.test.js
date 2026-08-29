"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const channel = require("../migration-channel/index");
const { build } = require("../scripts/build-migration-channel-package");
const {
  existingFunctionPassword,
  jsonFromOutput,
  rows,
} = require("../scripts/provision-migration-channel");

const AUTHORIZATION = "a".repeat(64);
const BASE_ENV = Object.freeze({
  MYROOT_MYSQL_MIGRATION_ADDRESS: "172.17.0.2:3306",
  MYROOT_MYSQL_MIGRATION_USERNAME: "myroot_migrator_067_068",
  MYROOT_MYSQL_MIGRATION_PASSWORD: "fixture-only",
  MYROOT_MYSQL_MIGRATION_DATABASE: "myroot-prod-d5gl3gzg7115f149a",
  MYROOT_MYSQL_MIGRATION_RELEASE_ID: "v1.0.0+a4c84a57-20260804",
});

function withEnv(values, callback) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve().then(callback).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("plan returns a sanitized migration summary and closes the pool", async () => {
  let ended = 0;
  const pool = { end: async () => { ended += 1; } };
  const dependencies = {
    mysql: { createPool: (config) => {
      assert.equal(config.user, BASE_ENV.MYROOT_MYSQL_MIGRATION_USERNAME);
      assert.equal(config.password, BASE_ENV.MYROOT_MYSQL_MIGRATION_PASSWORD);
      return pool;
    } },
    migrations: {
      readMysqlMigrationPlan: async () => ({
        ready: false,
        appliedCount: 66,
        expectedCount: 68,
        latestVersion: "066_v1_runtime_alert_delivery_severity_slo_authority.sql",
        expectedLatestVersion: "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        pending: [
          "067_formal_launch_retired_runtime_cleanup.sql",
          "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        ],
      }),
    },
  };
  await withEnv(BASE_ENV, async () => {
    const result = await channel.execute({ action: "plan" }, dependencies, process.env);
    assert.equal(result.pendingCount, 2);
    assert.equal(result.nextVersion, "067_formal_launch_retired_runtime_cleanup.sql");
    assert.equal(Object.hasOwn(result, "password"), false);
  });
  assert.equal(ended, 1);
});

test("apply remains disabled without the exact environment gate", async () => {
  await withEnv({ ...BASE_ENV, MYROOT_MYSQL_MIGRATION_CHANNEL_MODE: "plan" }, async () => {
    await assert.rejects(
      channel.execute({ action: "apply", authorization: AUTHORIZATION }, {}, process.env),
      { code: "MYSQL_MIGRATION_CHANNEL_APPLY_DISABLED" }
    );
  });
});

test("apply requires an exact release-bound write confirmation", async () => {
  await withEnv({
    ...BASE_ENV,
    MYROOT_MYSQL_MIGRATION_CHANNEL_MODE: "apply",
    MYROOT_MYSQL_MIGRATION_WRITE_CONFIRM: "wrong",
  }, async () => {
    assert.throws(
      () => channel.assertApplyAuthorization({ authorization: AUTHORIZATION }, process.env),
      { code: "MYSQL_MIGRATION_CHANNEL_WRITE_CONFIRMATION_MISMATCH" }
    );
  });
});

test("package builder copies the immutable 73 migration set", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-migration-channel-test-"));
  const output = path.join(parent, "package");
  try {
    const result = build(output);
    assert.equal(result.migrationCount, 73);
    assert.equal(fs.existsSync(path.join(output, "index.js")), true);
    assert.equal(fs.existsSync(path.join(output, "package-lock.json")), true);
    assert.equal(fs.existsSync(path.join(output, "src", "mysqlMigrations.js")), true);
    assert.equal(fs.existsSync(path.join(output, "db", "migrations", "068_formal_launch_confirmed_prelaunch_cleanup.sql")), true);
    assert.equal(fs.existsSync(path.join(output, "db", "migrations", "071_product_analytics.sql")), true);
    assert.equal(fs.existsSync(path.join(output, "db", "migrations", "072_health_advice_snapshot.sql")), true);
    assert.equal(fs.existsSync(path.join(output, "db", "migrations", "073_channel_code_funnel.sql")), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("provision parsers accept CLI credentials and SDK row envelopes without logging secrets", () => {
  const parsed = jsonFromOutput('- Loading data...\n{"data":{"secretId":"id","secretKey":"key","token":"token"}}');
  assert.deepEqual(Object.keys(parsed.data).sort(), ["secretId", "secretKey", "token"]);
  assert.deepEqual(rows({ Items: ['{"account_conflict":0}'] }), [{ account_conflict: 0 }]);
});

test("existing function reconciliation validates VPC, mode and the fixed target", () => {
  const password = "p".repeat(48);
  const detail = {
    FunctionName: "myroot-migration-067-068",
    Runtime: "Nodejs18.15",
    Status: "Active",
    AvailableStatus: "Available",
    VpcConfig: {
      vpc: { VpcId: "vpc-3plmoyf8" },
      subnet: { SubnetId: "subnet-entx2uvt" },
    },
    Triggers: [],
    Environment: { Variables: [
      { Key: "MYROOT_MYSQL_MIGRATION_ADDRESS", Value: "172.17.0.2:3306" },
      { Key: "MYROOT_MYSQL_MIGRATION_USERNAME", Value: "myroot_migrator_067_068" },
      { Key: "MYROOT_MYSQL_MIGRATION_PASSWORD", Value: password },
      { Key: "MYROOT_MYSQL_MIGRATION_DATABASE", Value: "myroot-prod-d5gl3gzg7115f149a" },
      { Key: "MYROOT_MYSQL_MIGRATION_RELEASE_ID", Value: "v1.0.0+a4c84a57-20260804" },
      { Key: "MYROOT_MYSQL_MIGRATION_CHANNEL_MODE", Value: "plan" },
    ] },
  };
  assert.equal(existingFunctionPassword(detail), password);
  assert.throws(
    () => existingFunctionPassword({ ...detail, Triggers: [{ TriggerName: "unexpected" }] }),
    { code: "MIGRATION_CHANNEL_EXISTING_FUNCTION_DRIFT" }
  );
});
