const assert = require("node:assert/strict");

function loadEnv(envVersion) {
  global.__wxConfig = { envVersion };
  delete require.cache[require.resolve("../config/env")];
  return require("../config/env");
}

const develop = loadEnv("develop");
const trial = loadEnv("trial");
const release = loadEnv("release");

assert.equal(develop.analyticsEnabled, false, "开发环境不得写入产品分析事件");
assert.equal(trial.analyticsEnabled, true, "体验版必须启用产品分析事件");
assert.equal(release.analyticsEnabled, true, "正式版必须启用产品分析事件");

["requestAdapter", "cloudEnvId", "cloudServiceName", "localDevtoolsApiBaseUrl", "analyticsEnabled"].forEach((key) => {
  assert.deepEqual(trial[key], release[key], `体验版与正式版配置不一致：${key}`);
});

assert.equal(develop.localDevtoolsApiBaseUrl, "http://127.0.0.1:8787");
assert.equal(trial.localDevtoolsApiBaseUrl, "");
assert.equal(release.localDevtoolsApiBaseUrl, "");

delete global.__wxConfig;
delete require.cache[require.resolve("../config/env")];
require("./runtime-request-adapter.test");
console.log("trial/release runtime config parity tests passed");
