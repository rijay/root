const test = require("node:test");
const assert = require("node:assert/strict");

const { createMysqlStore } = require("../src/store");

const MYSQL_CONFIG = Object.freeze({
  host: "127.0.0.1",
  port: 3306,
  user: "root_test",
  password: "test-only",
  database: "root_checkin_test_command_protection",
});

function mysqlProbe(state) {
  return {
    createPool() {
      state.poolCreated = true;
      throw new Error("pool must not be created before command protection is ready");
    },
  };
}

test("MySQL Store refuses plaintext command results before creating a pool", async () => {
  const state = { poolCreated: false };
  await assert.rejects(
    () => createMysqlStore(MYSQL_CONFIG, {
      env: { NODE_ENV: "test" },
      dependencies: { mysql: mysqlProbe(state) },
    }),
    (error) => error.code === "MYSQL_COMMAND_PROTECTION_REQUIRED"
  );
  assert.equal(state.poolCreated, false);
});

test("protected MySQL Store refuses a missing request digest key before creating a pool", async () => {
  const state = { poolCreated: false };
  await assert.rejects(
    () => createMysqlStore(MYSQL_CONFIG, {
      env: {
        NODE_ENV: "production",
        ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "store-result-protection-key-with-strong-entropy-2026",
        ROOT_COMMAND_RESULT_KEY_ID: "store-result-key-v1",
      },
      dependencies: { mysql: mysqlProbe(state) },
    }),
    (error) => error.code === "COMMAND_REQUEST_DIGEST_KEY_REQUIRED"
  );
  assert.equal(state.poolCreated, false);
});
