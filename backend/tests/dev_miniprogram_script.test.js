const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LOCAL_MINIPROGRAM_ENV,
  buildLocalMiniprogramEnv,
  start,
} = require("../scripts/dev-miniprogram");

test("local miniprogram runtime pins loopback and SQLite without model configuration", () => {
  const env = buildLocalMiniprogramEnv({ ROOT_HEALTH_ADVICE_MODEL_API_KEY: "legacy-secret" });
  assert.equal(env.ROOT_LISTEN_HOST, "127.0.0.1");
  assert.equal(env.ROOT_STORE_ADAPTER, "sqlite");
  assert.equal(Object.keys(LOCAL_MINIPROGRAM_ENV).some((key) => key.includes("HEALTH_ADVICE_MODEL")), false);
  assert.equal(Object.hasOwn(LOCAL_MINIPROGRAM_ENV, "ROOT_HEALTH_ADVICE_MODEL_API_KEY"), false);
});

test("local miniprogram runtime has no model Adapter and preserves Keychain-backed Youzan access", async () => {
  const logs = [];
  let received;
  await start({
    readYouzanToken: () => "keychain-youzan-token",
    logger: { log: (message) => logs.push(message) },
    main: async (options) => { received = options; },
  });

  assert.equal(received.healthAdviceModelAdapter, undefined);
  assert.match(logs.join("\n"), /no runtime model call/);
  assert.equal(await received.youzanAccessTokenProvider(), "keychain-youzan-token");
  assert.equal(logs.join("\n").includes("keychain-youzan-token"), false);
});

test("local miniprogram runtime does not expose an environment model credential", async () => {
  let received;
  await start({
    env: { ROOT_HEALTH_ADVICE_MODEL_API_KEY: "environment-secret" },
    readYouzanToken: () => "",
    logger: { log() {} },
    main: async (options) => { received = options; },
  });
  assert.equal(received.healthAdviceModelAdapter, undefined);
  assert.equal(received.youzanAccessTokenProvider, undefined);
});
