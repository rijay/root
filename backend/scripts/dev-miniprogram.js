const { createEnvironmentHealthAdviceModelAdapter } = require("../src/healthAdviceModelAdapter");
const { readLocalHealthAdviceApiKey } = require("../src/localHealthAdviceKeychain");
const { main } = require("../src/server");

const LOCAL_MINIPROGRAM_ENV = Object.freeze({
  NODE_ENV: "development",
  ROOT_LISTEN_HOST: "127.0.0.1",
  ROOT_STORE_ADAPTER: "sqlite",
  ROOT_SQLITE_FILE: "./data/myroot-v070-devtools.sqlite",
  ROOT_ALLOW_OPENID_LOGIN: "true",
  ROOT_LOCAL_MINIPROGRAM_DEV_SEED: "true",
  ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
  ROOT_HEALTH_ADVICE_MODEL_BASE_URL: "https://myroot-prod-d5gl3gzg7115f149a.api.tcloudbasegateway.com/v1/ai/cloudbase",
  ROOT_HEALTH_ADVICE_MODEL_NAME: "hy3",
  ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "腾讯云 CloudBase AI",
  ROOT_HEALTH_ADVICE_MODEL_TIMEOUT_MS: "20000",
  ROOT_HEALTH_ADVICE_MODEL_MAX_TOKENS: "1200",
});

function buildLocalMiniprogramEnv(env = process.env) {
  return { ...env, ...LOCAL_MINIPROGRAM_ENV };
}

async function start(options = {}) {
  const runtimeEnv = buildLocalMiniprogramEnv(options.env || process.env);
  Object.assign(process.env, LOCAL_MINIPROGRAM_ENV);
  const apiKey = (options.readApiKey || readLocalHealthAdviceApiKey)();
  const healthAdviceModelAdapter = createEnvironmentHealthAdviceModelAdapter(runtimeEnv, {
    apiKey,
    fetchImpl: options.fetchImpl,
  });
  const logger = options.logger || console;
  logger.log(healthAdviceModelAdapter.configured
    ? "Health advice model: CloudBase hy3 (credential loaded from macOS Keychain)"
    : "Health advice model: reviewed fallback (macOS Keychain credential unavailable)");
  return (options.main || main)({ healthAdviceModelAdapter });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start local miniprogram backend:", error);
    process.exit(1);
  });
}

module.exports = {
  LOCAL_MINIPROGRAM_ENV,
  buildLocalMiniprogramEnv,
  start,
};
