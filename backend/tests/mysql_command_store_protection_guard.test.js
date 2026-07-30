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

test("MySQL Store normalizes the Node process environment before crossing persistence interfaces", async () => {
  const names = [
    "NODE_ENV",
    "ROOT_COMMAND_REQUEST_DIGEST_KEY",
    "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID",
    "ROOT_COMMAND_RESULT_ENCRYPTION_KEY",
    "ROOT_COMMAND_RESULT_KEY_ID",
    "ROOT_MYSQL_MIGRATION_MODE",
  ];
  const previous = Object.fromEntries(names.map((name) => [
    name,
    Object.prototype.hasOwnProperty.call(process.env, name)
      ? process.env[name]
      : undefined,
  ]));
  process.env.NODE_ENV = "production";
  process.env.ROOT_COMMAND_REQUEST_DIGEST_KEY =
    "store-process-env-request-digest-key-with-strong-entropy-2026";
  process.env.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID = "store-process-env-request-v1";
  process.env.ROOT_COMMAND_RESULT_ENCRYPTION_KEY =
    "store-process-env-result-encryption-key-with-strong-entropy-2026";
  process.env.ROOT_COMMAND_RESULT_KEY_ID = "store-process-env-result-v1";
  process.env.ROOT_MYSQL_MIGRATION_MODE = "verify_only";

  const sentinel = new Error("normalized process environment observed");
  let poolEnded = false;
  try {
    await assert.rejects(
      () => createMysqlStore(MYSQL_CONFIG, {
        dependencies: {
          mysql: {
            createPool() {
              return {
                async end() {
                  poolEnded = true;
                },
              };
            },
          },
          createMysqlNotificationDeliveryCore(_pool, options) {
            assert.equal(Object.getPrototypeOf(options.env), Object.prototype);
            assert.notEqual(options.env, process.env);
            assert.equal(
              options.env.ROOT_COMMAND_RESULT_KEY_ID,
              "store-process-env-result-v1"
            );
            throw sentinel;
          },
        },
      }),
      (error) => error === sentinel
    );
    assert.equal(poolEnded, true);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
