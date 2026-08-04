const test = require("node:test");
const assert = require("node:assert/strict");
const retentionScheduler = require("../../cloudfunctions/myroot-job-dispatcher");

test("formal CloudBase topology exposes only the health retention job", () => {
  assert.equal(retentionScheduler.RELEASE_VERSION, "0.5.13");
  assert.deepEqual(Object.keys(retentionScheduler.JOBS), ["health_data_retention_cleanup"]);
  assert.throws(
    () => retentionScheduler.resolveJob({ TriggerName: "checkin_reminders" }),
    /Unknown scheduled job/
  );
});

test("health retention scheduler validates dry-run and scoped token rotation", async () => {
  assert.equal(retentionScheduler.boolEnv(undefined, true), true);
  assert.equal(retentionScheduler.boolEnv("false", true), false);
  assert.throws(() => retentionScheduler.boolEnv("treu", true), /exact string true or false/);

  const route = "/api/v1/jobs/health-data-retention-cleanup";
  let captured;
  const result = await retentionScheduler.dispatch({
    TriggerName: "health_data_retention_cleanup",
  }, {
    ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
      [route]: ["retention-old-secret-2026", "retention-current-secret-2026"],
    }),
    ROOT_JOB_BASE_URL: "https://example.test",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  }, async (url, body, headers) => {
    captured = { url, body, headers };
    return { statusCode: 200, body: { code: 0, message: "ok", data: { selectedCount: 2 } } };
  });

  assert.equal(captured.url, `https://example.test${route}`);
  assert.deepEqual(captured.body, { limit: 50, objectCleanup: true, dryRun: true });
  assert.equal(captured.headers["X-ROOT-ADMIN-TOKEN"], "retention-current-secret-2026");
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.data, { selectedCount: 2 });
  assert.equal(JSON.stringify(result).includes("retention-current-secret-2026"), false);
});

test("health retention execute uses timer identity for idempotency", async () => {
  const event = {
    TriggerName: "health_data_retention_cleanup",
    Time: "2026-08-03T20:15:00Z",
  };
  const expectedRequestId = retentionScheduler.requestIdFor("health_data_retention_cleanup", event);
  let captured;
  const result = await retentionScheduler.dispatch(event, {
    ROOT_ADMIN_JOB_TOKEN: "retention-job-secret",
    ROOT_JOB_BASE_URL: "https://example.test/",
    ROOT_JOB_DRY_RUN: "false",
  }, async (url, body, headers) => {
    captured = { url, body, headers };
    return { statusCode: 200, body: { code: 0, message: "ok", data: {} } };
  });

  assert.equal(captured.body.requestId, expectedRequestId);
  assert.equal(captured.headers["X-Request-Id"], expectedRequestId);
  assert.equal(result.requestId, expectedRequestId);
});

test("health retention scheduler preserves candidate query and sanitizes output", async () => {
  assert.equal(
    retentionScheduler.buildJobRequestUrl(
      "https://example.test",
      "/api/v1/jobs/health-data-retention-cleanup",
      "myroot_candidate=v0.5.13"
    ),
    "https://example.test/api/v1/jobs/health-data-retention-cleanup?myroot_candidate=v0.5.13"
  );
  assert.deepEqual(
    retentionScheduler.sanitize({ token: "secret", nested: { phone: "13800138000", count: 2 } }),
    { token: "[REDACTED]", nested: { phone: "[REDACTED]", count: 2 } }
  );
  assert.deepEqual(
    retentionScheduler.summarizeJobData({ selectedCount: 2, results: [{ userId: "private" }], openid: "private" }),
    { selectedCount: 2, resultsCount: 1 }
  );
});
