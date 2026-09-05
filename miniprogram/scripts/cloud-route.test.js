const assert = require("node:assert/strict");
const {
  appendCloudRoute,
  clearCloudRoute,
  initializeCloudRoute,
  refreshCloudRoute,
} = require("../utils/cloud-route");

const validValue = "preview_route_12345678";
const trialCandidateValue = "5a9f237e88948739367da8cc29ab79332f9ddf358bcb1694";

clearCloudRoute();
assert.equal(appendCloudRoute("/health", "trial"), "/health");
assert.equal(
  appendCloudRoute("/api/v1/channels/resolve", "trial"),
  `/api/v1/channels/resolve?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/channels/funnel", "trial"),
  `/api/v1/channels/funnel?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/health/assessments/catalog", "trial"),
  `/api/v1/health/assessments/catalog?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/health/assessments/history?assessmentType=INITIAL", "trial"),
  `/api/v1/health/assessments/history?assessmentType=INITIAL&myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/privacy/health-consent", "trial"),
  `/api/v1/privacy/health-consent?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/privacy/health-consent?mode=decision", "trial"),
  `/api/v1/privacy/health-consent?mode=decision&myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/products", "trial"),
  `/api/v1/products?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/products/4749049439", "trial"),
  `/api/v1/products/4749049439?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/member-commerce/summary", "trial"),
  `/api/v1/member-commerce/summary?myroot_canary=${trialCandidateValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/health/overview", "develop"),
  "/api/v1/health/overview"
);
assert.equal(
  appendCloudRoute("/api/v1/health/overview", "release"),
  "/api/v1/health/overview"
);
assert.equal(
  appendCloudRoute("/api/v1/privacy/health-consent", "release"),
  "/api/v1/privacy/health-consent"
);

assert.equal(initializeCloudRoute({ query: { myroot_canary: validValue } }, "trial"), true);
assert.equal(
  appendCloudRoute("/api/v1/user/state", "trial"),
  `/api/v1/user/state?myroot_canary=${validValue}`
);
assert.equal(
  appendCloudRoute("/api/v1/activities?limit=2", "develop"),
  `/api/v1/activities?limit=2&myroot_canary=${validValue}`
);
assert.equal(refreshCloudRoute({}, "trial"), true);
assert.equal(appendCloudRoute("/health", "trial"), `/health?myroot_canary=${validValue}`);

const refreshedValue = "preview_route_87654321";
assert.equal(refreshCloudRoute({ query: { myroot_canary: refreshedValue } }, "trial"), true);
assert.equal(appendCloudRoute("/health", "trial"), `/health?myroot_canary=${refreshedValue}`);

assert.equal(refreshCloudRoute({ query: { myroot_canary: "bad&route=1" } }, "trial"), false);
assert.equal(appendCloudRoute("/health", "trial"), "/health");
assert.equal(
  appendCloudRoute("/api/v1/health/overview", "trial"),
  `/api/v1/health/overview?myroot_canary=${trialCandidateValue}`
);

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

console.log("cloud route scenarios: trial v0.8.0 data binding and release isolation PASS");
