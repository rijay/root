const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const {
  assertRuntimePersistence,
  getRuntimePersistenceStatus,
} = require("../src/runtimePersistenceGuard");
const { createConfiguredStore } = require("../src/server");
const { createMemoryStore } = require("../src/store");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("Runtime Persistence Guard allows memory only in local and test runtimes", () => {
  const memoryStore = createMemoryStore(undefined, { seedSampleData: false });

  const local = getRuntimePersistenceStatus({ env: {}, storeAdapter: memoryStore });
  const testRuntime = getRuntimePersistenceStatus({
    env: { NODE_ENV: "test" },
    storeAdapter: memoryStore,
  });
  const production = getRuntimePersistenceStatus({
    env: { NODE_ENV: "production" },
    storeAdapter: memoryStore,
  });
  const cloud = getRuntimePersistenceStatus({
    env: { TCB_ENV: "myroot-prod" },
    storeAdapter: memoryStore,
  });
  const staging = getRuntimePersistenceStatus({
    env: { NODE_ENV: "staging" },
    storeAdapter: memoryStore,
  });

  assert.deepEqual(
    [local.ready, local.status, testRuntime.ready, testRuntime.status],
    [true, "LOCAL_MEMORY_ALLOWED", true, "LOCAL_MEMORY_ALLOWED"]
  );
  assert.equal(production.ready, false);
  assert.equal(production.status, "PERSISTENT_STORE_REQUIRED");
  assert.equal(production.runtimeMode, "production");
  assert.equal(cloud.ready, false);
  assert.equal(cloud.runtimeMode, "cloud");
  assert.equal(staging.ready, false);
  assert.equal(staging.runtimeMode, "managed");

  const unprovenMysql = getRuntimePersistenceStatus({
    env: { NODE_ENV: "production" },
    storeAdapter: { kind: "mysql" },
  });
  assert.equal(unprovenMysql.ready, false);
  assert.equal(unprovenMysql.persistent, false);

  const singleProcessPersistent = getRuntimePersistenceStatus({
    env: { NODE_ENV: "production" },
    storeAdapter: {
      kind: "json-file",
      getStoreHealth() {
        return { persistent: true, transactional: false, multiInstanceSafe: false };
      },
    },
  });
  assert.equal(singleProcessPersistent.ready, false);
  assert.equal(singleProcessPersistent.status, "MULTI_INSTANCE_STORE_REQUIRED");
});

test("Runtime Persistence Guard rejects an absent Store in production and CloudBase", async () => {
  await assert.rejects(
    () => createConfiguredStore({ NODE_ENV: "production" }),
    (error) => error.code === "RUNTIME_PERSISTENCE_REQUIRED"
  );
  await assert.rejects(
    () => createConfiguredStore({ ROOT_CLOUDBASE_ENV_ID: "myroot-prod" }),
    (error) => error.code === "RUNTIME_PERSISTENCE_REQUIRED"
  );

  assert.doesNotThrow(() => assertRuntimePersistence({ env: {}, storeAdapter: undefined }));
  assert.doesNotThrow(() => assertRuntimePersistence({ env: { NODE_ENV: "test" }, storeAdapter: undefined }));
});

test("ready Interface fails closed for implicit production memory Store", async (t) => {
  const server = createApp({ env: { NODE_ENV: "production" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const health = await requestJson(baseUrl, "/health");
  const ready = await requestJson(baseUrl, "/ready");

  assert.equal(health.status, 200);
  assert.equal(ready.status, 503);
  assert.equal(ready.body.code, 50302);
  assert.equal(ready.body.data.store.kind, "memory");
  assert.equal(ready.body.data.store.persistenceStatus, "PERSISTENT_STORE_REQUIRED");
  assert.equal(ready.body.data.store.runtimeMode, "production");
});

test("ready Interface fails closed for implicit CloudBase memory Store", async (t) => {
  const server = createApp({ env: { TCB_ENV_ID: "myroot-prod" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const ready = await requestJson(baseUrl, "/ready");

  assert.equal(ready.status, 503);
  assert.equal(ready.body.code, 50302);
  assert.equal(ready.body.data.store.runtimeMode, "cloud");
});

test("ready Interface accepts local memory and a persistent production Store", async (t) => {
  const localServer = createApp({ env: {} });
  const localBaseUrl = await listen(localServer);
  t.after(() => localServer.close());

  const localReady = await requestJson(localBaseUrl, "/ready");
  assert.equal(localReady.status, 200);
  assert.equal(localReady.body.data.store.persistenceStatus, "LOCAL_MEMORY_ALLOWED");

  const base = createMemoryStore(undefined, { seedSampleData: false });
  const persistentStore = {
    ...base,
    kind: "mysql",
    async checkHealth() {
      return { ok: true, persistent: true, migrationVersion: "test-only" };
    },
    getStoreHealth() {
      return { kind: "mysql", persistent: true, transactional: true, multiInstanceSafe: true };
    },
  };
  const productionServer = createApp({
    env: {
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "runtime-ready-command-request-digest-key-strong-2026",
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "runtime-ready-request-v1",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "runtime-ready-command-result-key-with-at-least-32-characters",
      ROOT_COMMAND_RESULT_KEY_ID: "runtime-ready-v1",
    },
    storeAdapter: persistentStore,
  });
  const productionBaseUrl = await listen(productionServer);
  t.after(() => productionServer.close());

  const productionReady = await requestJson(productionBaseUrl, "/ready");
  assert.equal(productionReady.status, 200);
  assert.equal(productionReady.body.data.store.persistenceStatus, "PERSISTENT_STORE_READY");
  assert.equal(productionReady.body.data.commandRequestDigest.ready, true);
  assert.equal(productionReady.body.data.commandResultProtection.ready, true);
});

test("ready Interface fails closed when protected command result keys are missing", async (t) => {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  const persistentStore = {
    ...base,
    kind: "mysql",
    async checkHealth() {
      return { ok: true, persistent: true, migrationVersion: "test-only" };
    },
    getStoreHealth() {
      return { kind: "mysql", persistent: true, transactional: true, multiInstanceSafe: true };
    },
  };
  const server = createApp({ env: { NODE_ENV: "production" }, storeAdapter: persistentStore });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const ready = await requestJson(baseUrl, "/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.code, 50303);
  assert.equal(ready.body.data.store.persistenceStatus, "PERSISTENT_STORE_READY");
  assert.deepEqual(ready.body.data.commandResultProtection, {
    ready: false,
    enabled: false,
    status: "COMMAND_RESULT_KEY_REQUIRED",
  });
});

test("ready Interface fails closed when the protected request digest key is missing", async (t) => {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  const persistentStore = {
    ...base,
    kind: "mysql",
    async checkHealth() {
      return { ok: true, persistent: true, migrationVersion: "test-only" };
    },
    getStoreHealth() {
      return { kind: "mysql", persistent: true, transactional: true, multiInstanceSafe: true };
    },
  };
  const server = createApp({
    env: {
      NODE_ENV: "production",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "runtime-ready-command-result-key-with-at-least-32-characters",
      ROOT_COMMAND_RESULT_KEY_ID: "runtime-ready-v1",
    },
    storeAdapter: persistentStore,
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const ready = await requestJson(baseUrl, "/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.code, 50304);
  assert.equal(ready.body.data.store.persistenceStatus, "PERSISTENT_STORE_READY");
  assert.equal(ready.body.data.commandResultProtection.ready, true);
  assert.deepEqual(ready.body.data.commandRequestDigest, {
    ready: false,
    status: "COMMAND_REQUEST_DIGEST_KEY_REQUIRED",
    canonicalVersion: "canonical-json:v1",
    digestVersion: "hmac-sha256:v1",
  });
});
