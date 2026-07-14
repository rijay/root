const assert = require("node:assert/strict");
const {
  appendCloudRoute,
  clearCloudRoute,
  initializeCloudRoute,
  refreshCloudRoute,
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
assert.equal(refreshCloudRoute({}, "trial"), true);
assert.equal(appendCloudRoute("/health", "trial"), `/health?myroot_canary=${validValue}`);

const refreshedValue = "preview_route_87654321";
assert.equal(refreshCloudRoute({ query: { myroot_canary: refreshedValue } }, "trial"), true);
assert.equal(appendCloudRoute("/health", "trial"), `/health?myroot_canary=${refreshedValue}`);

assert.equal(refreshCloudRoute({ query: { myroot_canary: "bad&route=1" } }, "trial"), false);
assert.equal(appendCloudRoute("/health", "trial"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "trial"), true);
assert.equal(
  appendCloudRoute(`/health?myroot_canary=${validValue}`, "trial"),
  `/health?myroot_canary=${validValue}`
);
assert.equal(appendCloudRoute("/health", "release"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: "bad&route=1" } }, "trial"), false);
assert.equal(appendCloudRoute("/health", "trial"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "release"), false);
assert.equal(appendCloudRoute("/health", "develop"), "/health");

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "trial"), true);
assert.equal(refreshCloudRoute({}, "release"), false);
assert.equal(appendCloudRoute("/health", "trial"), "/health");

console.log("cloud route scenarios: 20/20 PASS");
