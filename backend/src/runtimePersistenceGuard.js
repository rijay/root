const CLOUD_RUNTIME_KEYS = Object.freeze([
  "ROOT_CLOUDBASE_ENV_ID",
  "CLOUDBASE_ENV_ID",
  "TCB_ENV_ID",
  "TCB_ENV",
  "SCF_NAMESPACE",
  "K_SERVICE",
  "WX_CLOUD_ENV",
]);

function text(value) {
  return String(value || "").trim();
}

function isCloudRuntime(env = process.env) {
  return CLOUD_RUNTIME_KEYS.some((key) => text(env && env[key]));
}

function runtimeMode(env = process.env) {
  if (isCloudRuntime(env)) return "cloud";
  const nodeEnv = text(env && env.NODE_ENV).toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  if (!nodeEnv || ["development", "dev", "local"].includes(nodeEnv)) return "local";
  return "managed";
}

function storeHealth(storeAdapter) {
  if (!storeAdapter || typeof storeAdapter.getStoreHealth !== "function") return {};
  return storeAdapter.getStoreHealth() || {};
}

function getRuntimePersistenceStatus(options = {}) {
  const env = options.env || {};
  const storeAdapter = options.storeAdapter;
  const mode = runtimeMode(env);
  const kind = text(storeAdapter && storeAdapter.kind) || "memory";
  const health = storeHealth(storeAdapter);
  const persistent = health.persistent === true;
  const transactional = health.transactional === true;
  const multiInstanceSafe = health.multiInstanceSafe === true;
  const protectedRuntime = !["local", "test"].includes(mode);

  if (protectedRuntime && !persistent) {
    return {
      ready: false,
      status: "PERSISTENT_STORE_REQUIRED",
      runtimeMode: mode,
      storeKind: kind,
      persistent: false,
      transactional,
      multiInstanceSafe,
    };
  }

  if (protectedRuntime && (!transactional || !multiInstanceSafe)) {
    return {
      ready: false,
      status: "MULTI_INSTANCE_STORE_REQUIRED",
      runtimeMode: mode,
      storeKind: kind,
      persistent,
      transactional,
      multiInstanceSafe,
    };
  }

  return {
    ready: true,
    status: persistent ? "PERSISTENT_STORE_READY" : "LOCAL_MEMORY_ALLOWED",
    runtimeMode: mode,
    storeKind: kind,
    persistent,
    transactional,
    multiInstanceSafe,
  };
}

function assertRuntimePersistence(options = {}) {
  const status = getRuntimePersistenceStatus(options);
  if (status.ready) return status;

  const error = new Error(
    `Transactional multi-instance Store required in ${status.runtimeMode} runtime; refusing ${status.storeKind} Store`
  );
  error.code = "RUNTIME_PERSISTENCE_REQUIRED";
  error.detail = status;
  throw error;
}

module.exports = {
  assertRuntimePersistence,
  getRuntimePersistenceStatus,
  isCloudRuntime,
  runtimeMode,
};
