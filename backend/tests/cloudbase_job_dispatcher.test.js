const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildJobRequestUrl,
  boolEnv,
  currentJobToken,
  dispatch,
  JOBS,
  RELEASE_VERSION,
  requestIdFor,
  resolveJob,
  sanitize,
  summarizeJobData,
} = require("../../cloudfunctions/myroot-job-dispatcher");
const runtimeScheduler = require("../../cloudfunctions/myroot-v1-runtime-scheduler");

test("CloudBase dispatcher parses dry-run and token rotation fail-closed", () => {
  assert.equal(boolEnv(undefined, true), true);
  assert.equal(boolEnv("true", false), true);
  assert.equal(boolEnv("false", true), false);
  assert.throws(() => boolEnv("treu", true), /exact string true or false/);
  assert.equal(currentJobToken({
    ROOT_ADMIN_JOB_TOKENS: JSON.stringify(["job-old", "job-current"]),
  }), "job-current");
  assert.throws(
    () => currentJobToken({ ROOT_ADMIN_JOB_TOKENS: "not-json" }),
    /valid JSON/
  );
  assert.throws(
    () => currentJobToken({ ROOT_ADMIN_JOB_TOKENS: "[]" }),
    /between 1 and 16/
  );
});

test("CloudBase dispatchers select the current token for the exact route and fail closed in strict mode", async () => {
  const checkinRoute = "/api/v1/jobs/checkin-reminders";
  const runtimeRoute = "/api/v1/jobs/v1-runtime-cycle";
  const checkinCurrent = "checkin-current-route-secret-2026";
  const runtimeCurrent = "runtime-current-route-secret-2026";
  const routeTokens = JSON.stringify({
    [checkinRoute]: ["checkin-old-route-secret-2026", checkinCurrent],
    [runtimeRoute]: ["runtime-old-route-secret-2026", runtimeCurrent],
  });
  let genericHeader = "";
  await dispatch({ TriggerName: "checkin_reminders" }, {
    ROOT_ADMIN_JOB_ROUTE_TOKENS: routeTokens,
    ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret",
    ROOT_JOB_BASE_URL: "https://example.test",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  }, async (_url, _body, headers) => {
    genericHeader = headers["X-ROOT-ADMIN-TOKEN"];
    return { statusCode: 200, body: { code: 0, data: {} } };
  });
  assert.equal(genericHeader, checkinCurrent);

  let runtimeHeader = "";
  await runtimeScheduler.dispatch({
    TriggerName: "v1_runtime_cycle",
    Time: "2026-07-17T03:00:00Z",
  }, {
    ROOT_ADMIN_JOB_ROUTE_TOKENS: routeTokens,
    ROOT_JOB_BASE_URL: "https://runtime.example.test",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
  }, async (_url, body, headers) => {
    runtimeHeader = headers["X-ROOT-ADMIN-TOKEN"];
    return {
      statusCode: 200,
      body: {
        code: 0,
        data: {
          dryRun: true,
          requestId: body.requestId,
          scheduleId: body.scheduleId,
        },
      },
    };
  });
  assert.equal(runtimeHeader, runtimeCurrent);

  let calls = 0;
  await assert.rejects(
    () => dispatch({ TriggerName: "operational_alerts" }, {
      ROOT_ADMIN_JOB_ROUTE_TOKENS: routeTokens,
      ROOT_ADMIN_JOB_TOKEN: "legacy-job-secret",
      ROOT_JOB_BASE_URL: "https://example.test",
      ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
    }, async () => {
      calls += 1;
      return { statusCode: 200, body: { code: 0, data: {} } };
    }),
    /required for exact route/
  );
  assert.equal(calls, 0);
});

test("CloudBase dispatcher rejects one scoped token reused by two Job routes before HTTP", async () => {
  const duplicate = "duplicate-scoped-route-secret-2026";
  let calls = 0;
  await assert.rejects(
    () => dispatch({ TriggerName: "checkin_reminders" }, {
      ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
        "/api/v1/jobs/checkin-reminders": [duplicate],
        "/api/v1/jobs/operational-alerts": [duplicate],
      }),
      ROOT_JOB_BASE_URL: "https://example.test",
    }, async () => {
      calls += 1;
      return { statusCode: 200, body: { code: 0, data: {} } };
    }),
    /cannot reuse one token across Job routes/
  );
  assert.equal(calls, 0);
});

test("CloudBase dispatcher exposes exactly the eleven approved Jobs", () => {
  assert.equal(RELEASE_VERSION, "0.5.13");
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
  assert.equal(result.releaseVersion, "0.5.13");
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

test("dedicated v1 runtime scheduler derives one canonical identity from timer Time", () => {
  assert.equal(runtimeScheduler.RELEASE_VERSION, "0.5.13");
  assert.equal(runtimeScheduler.ROUTE, "/api/v1/jobs/v1-runtime-cycle");
  const utc = runtimeScheduler.canonicalTimerSchedule({
    TriggerName: "v1_runtime_cycle",
    Time: "2026-07-17T03:00:00Z",
  });
  const offset = runtimeScheduler.canonicalTimerSchedule({
    TriggerName: "v1_runtime_cycle",
    Time: "2026-07-17T11:00:00+08:00",
  });
  assert.deepEqual(utc, offset);
  assert.deepEqual(utc, {
    scheduleId: "cloudbase-v1-runtime-20260717T030000000Z",
    scheduledAt: "2026-07-17T03:00:00.000Z",
  });
  assert.throws(
    () => runtimeScheduler.canonicalTimerSchedule({ TriggerName: "checkin_reminders", Time: "2026-07-17T03:00:00Z" }),
    /fixed CloudBase timer trigger/
  );
  assert.throws(
    () => runtimeScheduler.canonicalTimerSchedule({
      TriggerName: "v1_runtime_cycle",
      Time: "2026-07-17T03:00:00Z",
      jobId: "v1_runtime_cycle",
    }),
    /fixed CloudBase timer trigger/
  );
  assert.throws(
    () => runtimeScheduler.canonicalTimerSchedule({ TriggerName: "v1_runtime_cycle" }),
    /requires event.Time/
  );
});

test("dedicated v1 runtime scheduler defaults to preview and binds requestId to scheduleId", async () => {
  const event = { TriggerName: "v1_runtime_cycle", Time: "2026-07-17T03:00:00Z" };
  const captures = [];
  const env = {
    ROOT_ADMIN_JOB_TOKENS: JSON.stringify(["job-old", "job-current"]),
    ROOT_JOB_BASE_URL: "https://runtime.example.test",
  };
  const request = async (url, body, headers, timeoutMs) => {
    captures.push({ url, body, headers, timeoutMs });
    return {
      statusCode: 200,
      body: {
        code: 0,
        data: {
          status: "V1_RUNTIME_SCHEDULE_READY",
          dryRun: true,
          ready: true,
          requestId: body.requestId,
          scheduleId: body.scheduleId,
          internalPool: "must-not-leak",
        },
      },
    };
  };
  const first = await runtimeScheduler.dispatch(event, env, request);
  const replay = await runtimeScheduler.dispatch(event, env, request);
  assert.deepEqual(captures[0], captures[1]);
  assert.equal(captures[0].url, "https://runtime.example.test/api/v1/jobs/v1-runtime-cycle");
  assert.deepEqual(Object.keys(captures[0].body).sort(), [
    "bridgeLimit", "dryRun", "recoveryLimit", "requestId", "scheduleId", "scheduledAt", "workerLimit",
  ].sort());
  assert.equal(captures[0].body.dryRun, true);
  assert.equal(captures[0].body.requestId, captures[0].body.scheduleId);
  assert.equal(captures[0].headers["X-Request-Id"], captures[0].body.scheduleId);
  assert.equal(captures[0].headers["X-ROOT-ADMIN-TOKEN"], "job-current");
  assert.equal(captures[0].timeoutMs, 15000);
  assert.equal(first.requestId, replay.requestId);
  assert.equal(first.data.internalPool, undefined);
});

test("dedicated v1 runtime scheduler requires an exact execute flag and never calls HTTP on invalid configuration", async () => {
  let calls = 0;
  const event = { TriggerName: "v1_runtime_cycle", Time: "2026-07-17T03:00:00.000Z" };
  const request = async (_url, body) => {
    calls += 1;
    return {
      statusCode: 200,
      body: {
        code: 0,
        data: {
          status: "SUCCEEDED",
          dryRun: false,
          requestId: body.requestId,
          scheduleId: body.scheduleId,
        },
      },
    };
  };
  await assert.rejects(
    () => runtimeScheduler.dispatch(event, {
      ROOT_ADMIN_JOB_TOKEN: "job-secret",
      ROOT_JOB_BASE_URL: "https://runtime.example.test",
      ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN: "treu",
    }, request),
    /exact string true or false/
  );
  assert.equal(calls, 0);

  const executed = await runtimeScheduler.dispatch(event, {
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_JOB_BASE_URL: "https://runtime.example.test",
    ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN: "false",
  }, request);
  assert.equal(calls, 1);
  assert.equal(executed.dryRun, false);

  await assert.rejects(
    () => runtimeScheduler.dispatch(event, {
      ROOT_ADMIN_JOB_TOKEN: "job-secret",
      ROOT_JOB_BASE_URL: "https://runtime.example.test",
      ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS: "26",
    }, request),
    /integer from 1 to 25/
  );
  assert.equal(calls, 1);

  await assert.rejects(
    () => runtimeScheduler.dispatch(event, {
      ROOT_ADMIN_JOB_TOKEN: "job-secret",
      ROOT_JOB_BASE_URL: "https://runtime.example.test",
    }, async () => ({
      statusCode: 200,
      body: {
        code: 0,
        data: {
          status: "V1_RUNTIME_SCHEDULE_READY",
          dryRun: true,
          requestId: "wrong-request",
          scheduleId: "wrong-schedule",
        },
      },
    })),
    /mismatched schedule identity/
  );
});
