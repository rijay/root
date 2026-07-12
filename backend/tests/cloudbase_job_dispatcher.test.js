const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildJobRequestUrl,
  dispatch,
  JOBS,
  RELEASE_VERSION,
  requestIdFor,
  resolveJob,
  sanitize,
  summarizeJobData,
} = require("../../cloudfunctions/myroot-job-dispatcher");

test("CloudBase dispatcher exposes exactly the eleven approved Jobs", () => {
  assert.equal(RELEASE_VERSION, "0.5.6");
  assert.deepEqual(Object.keys(JOBS).sort(), [
    "adapter_retry_due",
    "checkin_reminders",
    "health_data_retention_cleanup",
    "lifecycle_settlement_cleanup",
    "lifecycle_settlement_due",
    "lifecycle_user_exports_cleanup",
    "lifecycle_user_exports_delivery_retry",
    "lifecycle_users_export",
    "operational_alerts",
    "wework_touch_due",
    "youzan_identity_reconcile",
  ]);
  assert.throws(() => resolveJob({ TriggerName: "unknown_job" }), /Unknown scheduled job/);
});

test("CloudBase dispatcher keeps Youzan identity reconciliation dry-run by default", async () => {
  let captured;
  const result = await dispatch({ TriggerName: "youzan_identity_reconcile" }, {
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_JOB_BASE_URL: "https://example.test",
  }, async (url, body) => {
    captured = { url, body };
    return { statusCode: 200, body: { code: 0, message: "ok", data: { candidateCount: 2 } } };
  });

  assert.equal(captured.url, "https://example.test/api/v1/jobs/youzan-identity-reconcile");
  assert.equal(captured.body.dryRun, true);
  assert.equal(captured.body.batchSize, 5);
  assert.equal(captured.body.requestId, undefined);
  assert.equal(result.data.candidateCount, 2);
});

test("CloudBase dispatcher appends an explicit candidate route query without changing the default URL", async () => {
  assert.equal(
    buildJobRequestUrl("https://example.test", "/api/v1/jobs/checkin-reminders"),
    "https://example.test/api/v1/jobs/checkin-reminders",
  );
  assert.equal(
    buildJobRequestUrl(
      "https://example.test",
      "/api/v1/jobs/checkin-reminders",
      "myroot_candidate=v0.5.6&probe=dry-run",
    ),
    "https://example.test/api/v1/jobs/checkin-reminders?myroot_candidate=v0.5.6&probe=dry-run",
  );

  let capturedUrl = "";
  await dispatch({ TriggerName: "health_data_retention_cleanup" }, {
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_JOB_BASE_URL: "https://example.test",
    ROOT_JOB_ROUTE_QUERY: "myroot_candidate=v0.5.6",
  }, async (url) => {
    capturedUrl = url;
    return { statusCode: 200, body: { code: 0, message: "ok", data: { dryRun: true } } };
  });
  assert.equal(
    capturedUrl,
    "https://example.test/api/v1/jobs/health-data-retention-cleanup?myroot_candidate=v0.5.6",
  );
});

test("CloudBase dispatcher defaults to dry-run and keeps the Job token out of output", async () => {
  let captured;
  const result = await dispatch({ TriggerName: "checkin_reminders" }, {
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_JOB_BASE_URL: "https://example.test",
  }, async (url, body, headers, timeoutMs) => {
    captured = { url, body, headers, timeoutMs };
    return {
      statusCode: 200,
      body: {
        code: 0,
        message: "ok",
        data: { scannedCount: 0, openid: "should-not-leak" },
      },
    };
  });

  assert.equal(captured.url, "https://example.test/api/v1/jobs/checkin-reminders");
  assert.equal(captured.body.dryRun, true);
  assert.equal(captured.body.requestId, undefined);
  assert.equal(captured.headers["X-ROOT-ADMIN-TOKEN"], "job-secret");
  assert.equal(result.dryRun, true);
  assert.equal(result.releaseVersion, "0.5.6");
  assert.deepEqual(result.data, { scannedCount: 0 });
  assert.equal(JSON.stringify(result).includes("job-secret"), false);
});

test("CloudBase dispatcher uses the trigger instant as an execute idempotency key", async () => {
  const event = { TriggerName: "adapter_retry_due", Time: "2026-07-11T10:20:00Z" };
  const expectedRequestId = requestIdFor("adapter_retry_due", event);
  let captured;
  const result = await dispatch(event, {
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
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

test("CloudBase dispatcher sanitizes nested identity and credential fields", () => {
  assert.deepEqual(sanitize({ token: "a", nested: { phone: "b", count: 2 } }), {
    token: "[REDACTED]",
    nested: { phone: "[REDACTED]", count: 2 },
  });
});

test("CloudBase dispatcher logs only aggregate Job data", () => {
  assert.deepEqual(summarizeJobData({
    dryRun: true,
    selectedCount: 2,
    summary: { deliveredCount: 1, filename: "private.csv" },
    alerts: [{ ownerContact: "private" }],
    results: [{ userId: "private" }],
    run: { requestId: "private" },
    openid: "private",
  }), {
    dryRun: true,
    selectedCount: 2,
    summary: { deliveredCount: 1 },
    alertsCount: 1,
    resultsCount: 1,
  });
});
