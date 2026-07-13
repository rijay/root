const assert = require("node:assert/strict");
const {
  appendCloudRoute,
  clearCloudRoute,
  initializeCloudRoute,
} = require("../utils/cloud-route");

const validValue = "preview_route_12345678";

clearCloudRoute();
assert.equal(appendCloudRoute("/health", "trial"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "trial"), true);
assert.equal(
  appendCloudRoute("/api/v1/user/state", "trial"),
  `/api/v1/user/state?myroot_canary=${validValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/products?limit=2", "develop"),
  `/api/v1/products?limit=2&myroot_canary=${validValue}`
);
assert.equal(
  appendCloudRoute(`/health?myroot_canary=${validValue}`, "trial"),
  `/health?myroot_canary=${validValue}`
);
assert.equal(appendCloudRoute("/health", "release"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: "bad&route=1" } }, "trial"), false);
assert.equal(appendCloudRoute("/health", "trial"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "release"), false);
assert.equal(appendCloudRoute("/health", "develop"), "/health");

console.log("cloud route scenarios: 8/8 PASS");
