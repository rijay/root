const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertProtectedJobRouteTokenPolicy,
  authenticateJobRouteToken,
  parseScopedJobRouteTokens,
  resolveJobRouteTokenCandidates,
} = require("../src/jobRouteToken");
const { buildProductionEnvMatrix } = require("../src/productionEnvMatrix");

const CHECKIN_ROUTE = "/api/v1/jobs/health-data-retention-cleanup";
const ALERT_ROUTE = "/api/v1/jobs/v1-runtime-cycle";
const CHECKIN_OLD = "checkin-route-old-secret-2026";
const CHECKIN_CURRENT = "checkin-route-current-secret-2026";
const ALERT_CURRENT = "alert-route-current-secret-2026";

function scopedEnv(extra = {}) {
  return {
    ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
      [CHECKIN_ROUTE]: [CHECKIN_OLD, { token: CHECKIN_CURRENT }],
      [ALERT_ROUTE]: [ALERT_CURRENT],
    }),
    ...extra,
  };
}

test("scoped Job token rotation authenticates only its exact route", () => {
  const env = scopedEnv({ ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true" });
  assert.equal(authenticateJobRouteToken(env, CHECKIN_ROUTE, CHECKIN_OLD).matched, true);
  assert.equal(authenticateJobRouteToken(env, CHECKIN_ROUTE, CHECKIN_CURRENT).matched, true);
  assert.equal(authenticateJobRouteToken(env, ALERT_ROUTE, CHECKIN_CURRENT).matched, false);
  assert.equal(authenticateJobRouteToken(env, ALERT_ROUTE, ALERT_CURRENT).matched, true);
  assert.equal(resolveJobRouteTokenCandidates(env, CHECKIN_ROUTE).mode, "SCOPED");
});

test("strict scoped mode fails closed without an exact route and never falls back to legacy", () => {
  const route = "/api/v1/jobs/unconfigured";
  const env = scopedEnv({
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  });
  const resolution = resolveJobRouteTokenCandidates(env, route);
  assert.equal(resolution.mode, "SCOPED_REQUIRED");
  assert.equal(resolution.failClosed, true);
  assert.deepEqual(resolution.candidates, []);
  assert.equal(authenticateJobRouteToken(env, route, "legacy-job-secret-2026").matched, false);
});

test("legacy Job token remains a controlled opt-out while strict scoped mode is disabled", () => {
  const legacy = resolveJobRouteTokenCandidates({
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
  }, CHECKIN_ROUTE);
  assert.equal(legacy.mode, "LEGACY");
  assert.equal(legacy.failClosed, false);
  assert.deepEqual(legacy.candidates, ["legacy-job-secret-2026"]);
});

test("protected runtime always fails closed instead of falling back to a generic token", () => {
  const env = {
    NODE_ENV: "production",
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
  };
  const resolution = resolveJobRouteTokenCandidates(env, CHECKIN_ROUTE);
  assert.equal(resolution.mode, "SCOPED_REQUIRED");
  assert.equal(resolution.failClosed, true);
  assert.deepEqual(resolution.candidates, []);
  assert.equal(authenticateJobRouteToken(env, CHECKIN_ROUTE, env.ROOT_ADMIN_JOB_TOKEN).matched, false);
  assert.throws(() => assertProtectedJobRouteTokenPolicy(env), {
    code: "PROTECTED_JOB_ROUTE_TOKEN_POLICY_REQUIRED",
  });

  const protectedScoped = scopedEnv({
    NODE_ENV: "production",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  });
  assert.deepEqual(assertProtectedJobRouteTokenPolicy(protectedScoped), {
    ready: true,
    runtimeMode: "production",
    strict: true,
    routeCount: 2,
  });
});

test("malformed scoped configuration and token reuse across routes fail closed", () => {
  const duplicateToken = "duplicate-route-secret-2026";
  assert.throws(
    () => parseScopedJobRouteTokens({
      ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
        [CHECKIN_ROUTE]: [duplicateToken],
        [ALERT_ROUTE]: [duplicateToken],
      }),
    }),
    /cannot reuse one token across Job routes/
  );

  const invalidConfig = resolveJobRouteTokenCandidates({
    ROOT_ADMIN_JOB_ROUTE_TOKENS: "not-json",
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
  }, CHECKIN_ROUTE);
  assert.equal(invalidConfig.mode, "INVALID_CONFIG");
  assert.equal(invalidConfig.failClosed, true);
  assert.deepEqual(invalidConfig.candidates, []);

  const invalidFlag = resolveJobRouteTokenCandidates({
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "TRUE",
  }, CHECKIN_ROUTE);
  assert.equal(invalidFlag.mode, "INVALID_CONFIG");
  assert.equal(invalidFlag.failClosed, true);
});

test("production matrix requires scoped Job tokens and rejects legacy-only credentials", () => {
  const common = {
    ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE: "candidate-timer-only-policy-proof",
    ROOT_JOB_BASE_URL: "https://candidate.example.test",
  };
  const scoped = buildProductionEnvMatrix({
    ...common,
    ...scopedEnv({ ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true" }),
  }, { target: "production" }).groups.find((group) => group.id === "cloudbase_jobs");
  assert.equal(scoped.status, "PASS");

  const missingScoped = buildProductionEnvMatrix({
    ...common,
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  }, { target: "production" }).groups.find((group) => group.id === "cloudbase_jobs");
  assert.equal(missingScoped.status, "BLOCKER");
  assert.ok(missingScoped.missingRequired.some((item) => item.startsWith("ROOT_ADMIN_JOB_ROUTE_TOKENS=")));

  const legacy = buildProductionEnvMatrix({
    ...common,
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret-2026",
  }, { target: "production" }).groups.find((group) => group.id === "cloudbase_jobs");
  assert.equal(legacy.status, "BLOCKER");
  assert.ok(legacy.missingRequired.some((item) => item.startsWith("ROOT_ADMIN_JOB_ROUTE_TOKENS")));
  assert.ok(legacy.missingRequired.some((item) => item.startsWith("ROOT_REQUIRE_SCOPED_JOB_TOKENS")));
});
