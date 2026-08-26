const { readLocalYouzanAccessToken } = require("../src/localYouzanKeychain");
const { main } = require("../src/server");

const LOCAL_MINIPROGRAM_ENV = Object.freeze({
  NODE_ENV: "development",
  ROOT_LISTEN_HOST: "127.0.0.1",
  ROOT_STORE_ADAPTER: "sqlite",
  ROOT_SQLITE_FILE: "./data/myroot-v070-devtools.sqlite",
  ROOT_ALLOW_OPENID_LOGIN: "true",
  ROOT_LOCAL_MINIPROGRAM_DEV_SEED: "true",
});

function buildLocalMiniprogramEnv(env = process.env) {
  return { ...env, ...LOCAL_MINIPROGRAM_ENV };
}

async function start(options = {}) {
  const runtimeEnv = buildLocalMiniprogramEnv(options.env || process.env);
  Object.assign(process.env, LOCAL_MINIPROGRAM_ENV);
  const youzanAccessToken = (options.readYouzanToken || readLocalYouzanAccessToken)();
  const logger = options.logger || console;
  logger.log("Health advice: reviewed local catalog with fixed-content fallback (no runtime model call)");
  logger.log(youzanAccessToken
    ? "Youzan commerce: live read-only (credential loaded from macOS Keychain)"
    : "Youzan commerce: local fallback (macOS Keychain credential unavailable)");
  return (options.main || main)({
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
