const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");
const { createPerformanceMetricsModule } = require("../src/performanceMetricsModule");

function validEvent(overrides = {}) {
  return {
    eventId: "evt-valid-1",
    name: "app_launch",
    occurredAt: "2026-08-03T00:00:00.000Z",
    version: "0.5.13",
    platform: "android",
    baseLibraryVersion: "3.15.2",
    deviceTier: "ANDROID_4GB_BASELINE",
    networkType: "4g",
    entry: "cold_start",
    packageState: "LOCAL_PACKAGE",
    page: "pages/home/index",
    durationMs: 720,
    status: "SUCCESS",
    ...overrides,
  };
}

function batch(events, overrides = {}) {
  return {
    schemaVersion: 1,
    events,
    ...overrides,
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test("performance metrics Module accepts only allow-listed technical fields", () => {
  const records = [];
  const metrics = createPerformanceMetricsModule({
    logger: { info: (label, record) => records.push({ label, record }) },
    now: () => Date.parse("2026-08-03T00:01:00.000Z"),
  });

  const result = metrics.acceptBatch(batch([validEvent()]), { sessionId: "perf-session-1" });
  assert.equal(result.acceptedCount, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].label, "MYROOT_PERFORMANCE_EVENT");
  assert.equal(records[0].record.sessionId, "perf-session-1");
  assert.ok(!JSON.stringify(records).includes("openid"));
});

test("performance metrics Module rejects sensitive, oversized, duplicate and high-frequency input", () => {
  const metrics = createPerformanceMetricsModule({
    logger: { info() {} },
    now: () => Date.parse("2026-08-03T00:01:00.000Z"),
    maxEventsPerMinute: 2,
  });

  assert.throws(
    () => metrics.acceptBatch(batch([{ ...validEvent(), phone: "13800138000" }]), { sessionId: "perf-sensitive" }),
    (error) => error.code === "PERFORMANCE_EVENT_FIELD_FORBIDDEN" && error.status === 400,
  );
  assert.throws(
    () => metrics.acceptBatch(batch([validEvent()], { unionid: "sensitive" }), { sessionId: "perf-batch-sensitive" }),
    (error) => error.code === "PERFORMANCE_BATCH_FIELD_FORBIDDEN" && error.status === 400,
  );
  assert.throws(
    () => metrics.acceptBatch(batch([validEvent({ page: `pages/home/${"x".repeat(40_000)}` })]), { sessionId: "perf-large" }),
    (error) => error.code === "PERFORMANCE_BATCH_TOO_LARGE" && error.status === 413,
  );

  metrics.acceptBatch(batch([validEvent({ eventId: "evt-rate-1" })]), { sessionId: "perf-rate" });
  metrics.acceptBatch(batch([validEvent({ eventId: "evt-rate-2" })]), { sessionId: "perf-rate" });
  assert.throws(
    () => metrics.acceptBatch(batch([validEvent({ eventId: "evt-rate-3" })]), { sessionId: "perf-rate" }),
    (error) => error.code === "PERFORMANCE_RATE_LIMITED" && error.status === 429,
  );
  assert.throws(
    () => metrics.acceptBatch(batch([validEvent({ eventId: "evt-rate-2" })]), { sessionId: "perf-other" }),
    (error) => error.code === "PERFORMANCE_EVENT_DUPLICATE" && error.status === 409,
  );
});

test("performance metrics HTTP Interface does not require business persistence", async (t) => {
  const records = [];
  const performanceMetricsModule = createPerformanceMetricsModule({
    logger: { info: (_label, record) => records.push(record) },
  });
  const server = createApp({ performanceMetricsModule });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/api/v1/performance/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Performance-Session": "perf-http-1",
    },
    body: JSON.stringify(batch([validEvent({ eventId: "evt-http-1" })])),
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.code, 0);
  assert.equal(payload.data.acceptedCount, 1);
  assert.equal(records.length, 1);
});
