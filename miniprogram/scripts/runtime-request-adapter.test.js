const assert = require("node:assert/strict");
const {
  LOCAL_DEVTOOLS_API_BASE_URL,
  resolveRuntimeRequestConfig,
  runtimePlatform,
} = require("../utils/runtime-request-adapter");

const develop = {
  envVersion: "develop",
  requestAdapter: "cloudContainer",
  localDevtoolsApiBaseUrl: LOCAL_DEVTOOLS_API_BASE_URL,
};
const devtools = { getDeviceInfo: () => ({ platform: "devtools" }) };

assert.equal(runtimePlatform(devtools), "devtools");
assert.deepEqual(resolveRuntimeRequestConfig(develop, devtools), {
  adapter: "wxRequest",
  apiBaseUrl: LOCAL_DEVTOOLS_API_BASE_URL,
  mode: "LOCAL_DEVTOOLS",
});

[
  [{ ...develop, envVersion: "trial" }, devtools],
  [{ ...develop, envVersion: "release" }, devtools],
  [develop, { getDeviceInfo: () => ({ platform: "ios" }) }],
  [develop, {}],
  [{ ...develop, localDevtoolsApiBaseUrl: "http://localhost:8787" }, devtools],
  [{ ...develop, localDevtoolsApiBaseUrl: "http://127.0.0.1:8788" }, devtools],
].forEach(([config, api]) => {
  assert.equal(resolveRuntimeRequestConfig(config, api).mode, "CLOUD");
  assert.equal(resolveRuntimeRequestConfig(config, api).adapter, "cloudContainer");
});

console.log("runtime request Adapter tests passed");
