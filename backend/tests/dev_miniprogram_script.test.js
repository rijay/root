const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LOCAL_MINIPROGRAM_ENV,
  buildLocalMiniprogramEnv,
  start,
} = require("../scripts/dev-miniprogram");

test("local miniprogram runtime pins loopback, SQLite and CloudBase hy3 without embedding a credential", () => {
  const env = buildLocalMiniprogramEnv({ ROOT_HEALTH_ADVICE_MODEL_API_KEY: "" });
  assert.equal(env.ROOT_LISTEN_HOST, "127.0.0.1");
  assert.equal(env.ROOT_STORE_ADAPTER, "sqlite");
  assert.equal(env.ROOT_HEALTH_ADVICE_MODEL_NAME, "hy3");
  assert.equal(env.ROOT_HEALTH_ADVICE_MODEL_MAX_TOKENS, "1200");
  assert.equal(env.ROOT_HEALTH_ADVICE_MODEL_TIMEOUT_MS, "20000");
  assert.equal(env.ROOT_HEALTH_ADVICE_MODEL_BASE_URL.endsWith("/v1/ai/cloudbase"), true);
  assert.equal(Object.hasOwn(LOCAL_MINIPROGRAM_ENV, "ROOT_HEALTH_ADVICE_MODEL_API_KEY"), false);
});

test("local miniprogram runtime passes a Keychain-backed configured Adapter without logging the credential", async () => {
  const logs = [];
  let received;
  await start({
    env: {},
    readApiKey: () => "keychain-secret",
    logger: { log: (message) => logs.push(message) },
    main: async (options) => { received = options; },
    fetchImpl: async () => ({ ok: true }),
  });

  assert.equal(received.healthAdviceModelAdapter.configured, true);
  assert.equal(logs.join("\n").includes("keychain-secret"), false);
});

test("local miniprogram runtime does not fall back to an environment credential when Keychain is unavailable", async () => {
  let received;
  await start({
    env: { ROOT_HEALTH_ADVICE_MODEL_API_KEY: "environment-secret" },
    readApiKey: () => "",
    logger: { log() {} },
    main: async (options) => { received = options; },
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(received.healthAdviceModelAdapter.configured, false);
});
