const assert = require("node:assert/strict");
const { detectRuntimeEnvVersion } = require("../utils/runtime-env-version");

assert.equal(detectRuntimeEnvVersion({
  getAccountInfoSync() {
    return { miniProgram: { envVersion: "trial" } };
  },
}, null), "trial");

assert.equal(detectRuntimeEnvVersion({
  getAccountInfoSync() {
    return { miniProgram: { envVersion: "release" } };
  },
}, { envVersion: "trial" }), "release");

assert.equal(detectRuntimeEnvVersion({
  getAccountInfoSync() {
    throw new Error("unsupported");
  },
}, { envVersion: "trial" }), "trial");

assert.equal(detectRuntimeEnvVersion({
  getDeviceInfo() {
    return { platform: "devtools" };
  },
}, null), "develop");

assert.equal(detectRuntimeEnvVersion({
  getDeviceInfo() {
    return { platform: "ios" };
  },
}, null), "release");

assert.equal(detectRuntimeEnvVersion(null, null), "develop");

delete global.__wxConfig;
global.wx = {
  getAccountInfoSync() {
    return { miniProgram: { envVersion: "trial" } };
  },
};
delete require.cache[require.resolve("../config/env")];
assert.equal(require("../config/env").envVersion, "trial");
delete require.cache[require.resolve("../config/env")];
delete global.wx;

console.log("runtime env version scenarios: official account info and fail-closed fallback PASS");
