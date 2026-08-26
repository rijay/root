const { createEnvironmentHealthAdviceModelAdapter } = require("../src/healthAdviceModelAdapter");
const { readLocalHealthAdviceApiKey } = require("../src/localHealthAdviceKeychain");
const { readLocalYouzanAccessToken } = require("../src/localYouzanKeychain");
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
  ROOT_HEALTH_ADVICE_MODEL_SECONDARY_USE: "NONE",
  ROOT_HEALTH_ADVICE_MODEL_PROCESSING_REGION: "CN_MAINLAND",
  ROOT_HEALTH_ADVICE_MODEL_OTHER_PROCESSORS: "NONE",
  ROOT_HEALTH_ADVICE_MODEL_LOG_RETENTION_DAYS: "7",
  ROOT_HEALTH_ADVICE_MODEL_CACHE_RETENTION_DAYS: "0",
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
  const youzanAccessToken = (options.readYouzanToken || readLocalYouzanAccessToken)();
  const healthAdviceModelAdapter = createEnvironmentHealthAdviceModelAdapter(runtimeEnv, {
    apiKey,
    fetchImpl: options.fetchImpl,
  });
  const logger = options.logger || console;
  logger.log(healthAdviceModelAdapter.configured
    ? "Health advice model: CloudBase hy3 (credential loaded from macOS Keychain)"
    : apiKey
      ? "Health advice model: reviewed fallback (data policy verification unavailable)"
      : "Health advice model: reviewed fallback (macOS Keychain credential unavailable)");
  logger.log(youzanAccessToken
    ? "Youzan commerce: live read-only (credential loaded from macOS Keychain)"
    : "Youzan commerce: local fallback (macOS Keychain credential unavailable)");
  return (options.main || main)({
    healthAdviceModelAdapter,
    youzanAccessTokenProvider: youzanAccessToken ? async () => youzanAccessToken : undefined,
  });
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
