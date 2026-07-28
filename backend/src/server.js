const { createApp } = require("./app");
const { createJsonFileStore, createMysqlStore, createSqliteStore, mysqlConfigFromEnv } = require("./store");
const { assertRuntimePersistence } = require("./runtimePersistenceGuard");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { createCommandResultCodec } = require("./commandResultProtection");
const { assertProtectedJobRouteTokenPolicy } = require("./jobRouteToken");
const { assertWechatSubscriptionSendConfiguration } = require("./wechatSubscribeMessageAdapter");

const port = Number(process.env.PORT || 8787);

function shouldUseMysql(env = process.env) {
  if (env.ROOT_STORE_ADAPTER === "mysql") return true;
  if (env.ROOT_STORE_ADAPTER) return false;
  return Boolean(env.MYSQL_ADDRESS && env.MYSQL_USERNAME && env.MYSQL_PASSWORD);
}

async function createConfiguredStore(env = process.env, options = {}) {
  let storeAdapter;
  if (shouldUseMysql(env)) storeAdapter = await createMysqlStore(mysqlConfigFromEnv(env), {
    env,
    commandRequestDigestCodec: options.commandRequestDigestCodec,
    commandResultCodec: options.commandResultCodec,
  });
  else if (env.ROOT_STORE_ADAPTER === "sqlite" || env.ROOT_SQLITE_FILE) {
    storeAdapter = createSqliteStore(env.ROOT_SQLITE_FILE || "./data/root-checkin.sqlite");
  } else if (env.ROOT_STORE_ADAPTER === "json-file" || env.ROOT_STORE_FILE) {
    storeAdapter = createJsonFileStore(env.ROOT_STORE_FILE || "./data/root-checkin.json");
  }
  assertRuntimePersistence({ env, storeAdapter });
  return storeAdapter;
}

async function main() {
  assertProtectedJobRouteTokenPolicy(process.env);
  assertWechatSubscriptionSendConfiguration(process.env);
  const commandRequestDigestCodec = createCommandRequestDigestCodec(process.env);
  const commandResultCodec = createCommandResultCodec(process.env);
  commandRequestDigestCodec.assertReady();
  commandResultCodec.assertReady();
  const storeAdapter = await createConfiguredStore(process.env, {
    commandRequestDigestCodec,
    commandResultCodec,
  });
  const server = createApp({ storeAdapter, commandRequestDigestCodec, commandResultCodec });
  await server.readyPromise;
  server.listen(port, "0.0.0.0", () => {
    const storeHealth = server.storeAdapter.getStoreHealth ? server.storeAdapter.getStoreHealth() : { kind: server.storeAdapter.kind };
    const storeTarget = server.storeAdapter.filePath
      ? ` (${server.storeAdapter.filePath})`
      : storeHealth.database
        ? ` (${storeHealth.host}:${storeHealth.port}/${storeHealth.database})`
        : "";
    console.log(`ROOT check-in backend listening on http://127.0.0.1:${port}`);
    console.log(`Admin console: http://127.0.0.1:${port}`);
    console.log(`Store adapter: ${server.storeAdapter.kind}${storeTarget}`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; draining ROOT check-in backend`);
    await new Promise((resolve) => server.close(resolve));
    if (server.storeAdapter && typeof server.storeAdapter.close === "function") {
      await server.storeAdapter.close();
    }
  }
  process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
    console.error("Graceful shutdown failed:", error);
    process.exitCode = 1;
  }));
  process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
    console.error("Graceful shutdown failed:", error);
    process.exitCode = 1;
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to start ROOT check-in backend:", error);
    process.exit(1);
  });
}

module.exports = {
  createConfiguredStore,
  shouldUseMysql,
};
