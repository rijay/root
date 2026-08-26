const { createApp } = require("./app");
const { createJsonFileStore, createMysqlStore, createSqliteStore, mysqlConfigFromEnv } = require("./store");
const { assertRuntimePersistence } = require("./runtimePersistenceGuard");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { createCommandResultCodec } = require("./commandResultProtection");
const { assertProtectedJobRouteTokenPolicy } = require("./jobRouteToken");
const { createCloudbaseObjectStorageAdapter } = require("./cloudbaseObjectStorageAdapter");
const { createEnvironmentActivityPublicationAuthorizationAdapter } = require("./activityPublicationAuthorizationAdapter");
const { createDataBackedActivityAssetAdapter } = require("./activityAssetAdapter");
const { seedLocalMiniprogramDevData } = require("./localMiniprogramDevSeed");

const port = Number(process.env.PORT || 8787);

function listenHostFromEnv(env = process.env) {
  const host = String(env.ROOT_LISTEN_HOST || "0.0.0.0").trim();
  if (!["0.0.0.0", "127.0.0.1"].includes(host)) {
    const error = new Error("ROOT_LISTEN_HOST must be 0.0.0.0 or 127.0.0.1");
    error.code = "LISTEN_HOST_INVALID";
    throw error;
  }
  return host;
}

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

async function main(options = {}) {
  const listenHost = listenHostFromEnv(process.env);
  assertProtectedJobRouteTokenPolicy(process.env);
  const commandRequestDigestCodec = createCommandRequestDigestCodec(process.env);
  const commandResultCodec = createCommandResultCodec(process.env);
  commandRequestDigestCodec.assertReady();
  commandResultCodec.assertReady();
  const storeAdapter = await createConfiguredStore(process.env, {
    commandRequestDigestCodec,
    commandResultCodec,
  });
  const localSeed = seedLocalMiniprogramDevData(storeAdapter.data, {
    env: process.env,
    storeAdapter,
  });
  if (localSeed.changed) await Promise.resolve(storeAdapter.save());
  const objectStorageAdapter = process.env.ROOT_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID
    ? createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, { env: process.env })
    : null;
  const activityPublicationAuthorizationAdapter = createEnvironmentActivityPublicationAuthorizationAdapter(process.env);
  const activityAssetAdapter = createDataBackedActivityAssetAdapter({ dataProvider: () => storeAdapter.data });
  const server = createApp({
    storeAdapter,
    commandRequestDigestCodec,
    commandResultCodec,
    objectStorageAdapter,
    activityPublicationAuthorizationAdapter,
    activityAssetAdapter,
    healthAdviceCatalog: options.healthAdviceCatalog,
    youzanCommerceAdapter: options.youzanCommerceAdapter,
    youzanAccessTokenProvider: options.youzanAccessTokenProvider,
  });
  await server.readyPromise;
  server.listen(port, listenHost, () => {
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
  listenHostFromEnv,
  main,
  shouldUseMysql,
};
