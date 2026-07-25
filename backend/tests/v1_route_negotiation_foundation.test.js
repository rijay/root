const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createV1RouteNegotiationFoundation,
} = require("../src/v1RouteNegotiationFoundation");

function enabledFoundation() {
  return createV1RouteNegotiationFoundation({
    env: { MYROOT_V1_ROUTE_NEGOTIATION_ENABLED: "true" },
  });
}

test("Route Negotiation Foundation exposes only its deep local Interface", () => {
  const implementation = enabledFoundation();
  assert.deepEqual(Object.keys(implementation).sort(), ["assertReady", "resolve"]);
  const readiness = implementation.assertReady();
  assert.equal(readiness.runtimeIntegrated, false);
  assert.equal(readiness.registryVersion, "1.0.0-draft.8");
  assert.match(readiness.registryDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(readiness), true);
});

test("Route Negotiation Foundation is disabled unless the exact flag is true", () => {
  for (const env of [{}, { MYROOT_V1_ROUTE_NEGOTIATION_ENABLED: "TRUE" }]) {
    const implementation = createV1RouteNegotiationFoundation({ env });
    assert.throws(
      () => implementation.resolve({ clientVersion: "1.0.0", parameters: {}, routeId: "HOME" }),
      (error) => error && error.code === "V1_ROUTE_NEGOTIATION_DISABLED"
    );
  }
});

test("v1 clients resolve canonical routes and retain only target-allowlisted parameters", () => {
  const resolved = enabledFoundation().resolve({
    clientVersion: "1.0.0",
    routeId: "ACTIVITY_DETAIL",
    parameters: {
      activityId: "activity-001",
      ignored: "drop-me",
      source: "home",
    },
  });
  assert.deepEqual(resolved, {
    requestedRouteId: "ACTIVITY_DETAIL",
    resolvedRouteId: "ACTIVITY_DETAIL",
    canonicalPath: "/subpkg/activity/pages/detail/index",
    navigationMode: "REDIRECT",
    compatibilityMode: "V1_CANONICAL",
    parameters: { activityId: "activity-001", source: "home" },
    writeReplay: "DENY",
    reason: "RESOLVED",
    registryDigest: resolved.registryDigest,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.parameters), true);
});

test("legacy clients receive only frozen v0.5.13 paths and never a write replay", () => {
  const resolved = enabledFoundation().resolve({
    clientVersion: "0.5.13",
    routeId: "ACTIVITY_DETAIL",
    parameters: {
      activityId: "activity-001",
      campaignId: "campaign-001",
      sessionId: "must-drop",
      source: "share",
    },
  });
  assert.equal(resolved.resolvedRouteId, "LEGACY_ACTIVITY_ROUTER");
  assert.equal(resolved.canonicalPath, "/pages/activity/index");
  assert.equal(resolved.compatibilityMode, "LEGACY_0_5");
  assert.equal(resolved.writeReplay, "DENY");
  assert.deepEqual(resolved.parameters, {
    activityId: "activity-001",
    campaignId: "campaign-001",
    source: "share",
  });
});

test("unknown versions and unknown route IDs fail to HOME without forwarding parameters", () => {
  const implementation = enabledFoundation();
  for (const input of [
    { clientVersion: "1.0.1", parameters: { source: "unsafe" }, routeId: "ACTIVITY_DETAIL" },
    { clientVersion: "1.0.0", parameters: { source: "unsafe" }, routeId: "UNKNOWN_ROUTE" },
  ]) {
    const resolved = implementation.resolve(input);
    assert.equal(resolved.resolvedRouteId, "HOME");
    assert.equal(resolved.canonicalPath, "/pages/home/index");
    assert.equal(resolved.compatibilityMode, "SAFE_HOME");
    assert.deepEqual(resolved.parameters, {});
    assert.equal(resolved.writeReplay, "DENY");
  }
});

test("the exact input shape and safe scalar parameter contract fail closed", () => {
  const implementation = enabledFoundation();
  const invalid = [
    { clientVersion: "1.0.0", parameters: {}, routeId: "HOME", url: "https://example.com" },
    { clientVersion: "1.0.0", parameters: [], routeId: "HOME" },
    { clientVersion: "1.0.0", parameters: { source: { nested: true } }, routeId: "HOME" },
    { clientVersion: "1.0.0", parameters: { source: "" }, routeId: "HOME" },
    { clientVersion: "1.0.0", parameters: { source: "line\nbreak" }, routeId: "HOME" },
    { clientVersion: "1.0.0\n", parameters: {}, routeId: "HOME" },
    { clientVersion: "1.0.0", parameters: {}, routeId: "../HOME" },
  ];
  for (const input of invalid) {
    assert.throws(
      () => implementation.resolve(input),
      (error) => error && error.code === "V1_ROUTE_NEGOTIATION_INPUT_INVALID"
    );
  }
});
