const assert = require("node:assert/strict");

function loadEnv(envVersion) {
  global.__wxConfig = { envVersion };
  delete require.cache[require.resolve("../config/env")];
  return require("../config/env");
}

const develop = loadEnv("develop");
const trial = loadEnv("trial");
const release = loadEnv("release");

assert.equal(develop.localV060CompatMode, true, "开发环境保留本地兼容能力");
assert.equal(trial.localV060CompatMode, false, "体验版不得启用本地兼容能力");
assert.equal(release.localV060CompatMode, false, "正式版不得启用本地兼容能力");

["requestAdapter", "cloudEnvId", "cloudServiceName", "localV060CompatMode", "healthAssessmentStorageMode", "healthAssessmentRetentionDays"].forEach((key) => {
  assert.deepEqual(trial[key], release[key], `体验版与正式版配置不一致：${key}`);
});

assert.equal(trial.healthAssessmentStorageMode, "LOCAL_DEVICE");
assert.equal(trial.healthAssessmentRetentionDays, 180);

delete global.__wxConfig;
delete require.cache[require.resolve("../config/env")];
console.log("trial/release runtime config parity tests passed");
