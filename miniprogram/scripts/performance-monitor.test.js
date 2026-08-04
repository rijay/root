const assert = require("node:assert/strict");
const {
  CRITICAL_EVENT_NAMES,
  createPerformanceMonitor,
} = require("../utils/performance-monitor");

async function main() {
  let now = 1_700_000_000_000;
  const uploaded = [];
  const monitor = createPerformanceMonitor({
    envVersion: "trial",
    enabled: true,
    now: () => now,
    random: () => 0.99,
    uploader: async (batch) => uploaded.push(batch),
    context: {
      version: "0.5.13",
      platform: "android",
      baseLibraryVersion: "3.15.2",
      deviceTier: "ANDROID_4GB_BASELINE",
      networkType: "4g",
      packageState: "LOCAL_PACKAGE",
    },
  });

  const accepted = monitor.record({
    eventId: "evt-start-1",
    name: "app_launch",
    page: "pages/home/index",
    durationMs: 712,
    status: "SUCCESS",
  });
  assert.equal(accepted.accepted, true);

  const sensitive = monitor.record({
    eventId: "evt-sensitive-1",
    name: "page",
    page: "pages/profile/index",
    phone: "13800138000",
  });
  assert.equal(sensitive.accepted, false);
  assert.equal(sensitive.reason, "EVENT_FIELD_FORBIDDEN");

  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.queueLength, 1);
  assert.equal(snapshot.uploadEnabled, true);
  assert.equal(snapshot.sampleRate, 1);

  const flushed = await monitor.flush();
  assert.equal(flushed.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].events.length, 1);
  assert.ok(!JSON.stringify(uploaded).includes("13800138000"));

  const releaseMonitor = createPerformanceMonitor({
    envVersion: "release",
    now: () => now,
    random: () => 0,
  });
  assert.equal(releaseMonitor.getSnapshot().uploadEnabled, false);
  assert.equal(releaseMonitor.getSnapshot().sampleRate, 0.1);
  assert.equal(releaseMonitor.record({
    eventId: "evt-release-1",
    name: "request",
    durationMs: 200,
    status: "SUCCESS",
  }).accepted, true);
  assert.equal(releaseMonitor.record({
    eventId: "evt-release-critical-1",
    name: "memory_warning",
    status: "WARNING",
  }).accepted, true);
  assert.ok(CRITICAL_EVENT_NAMES.has("memory_warning"));
  assert.equal((await releaseMonitor.flush()).reason, "UPLOAD_DISABLED");

  const sampledReleaseMonitor = createPerformanceMonitor({
    envVersion: "release",
    now: () => now,
    random: () => 0.99,
  });
  assert.equal(sampledReleaseMonitor.recordRequest({
    eventId: "evt-write-success-1",
    method: "POST",
    route: "/api/v1/profile",
    status: "SUCCESS",
    write: true,
  }).reason, "SAMPLED_OUT");
  assert.equal(sampledReleaseMonitor.recordRequest({
    eventId: "evt-write-unknown-1",
    method: "POST",
    route: "/api/v1/profile",
    status: "RESULT_UNKNOWN",
    write: true,
  }).accepted, true);

  let failures = 0;
  const resilientMonitor = createPerformanceMonitor({
    envVersion: "develop",
    enabled: true,
    now: () => ++now,
    uploader: async () => {
      failures += 1;
      throw new Error("transport unavailable");
    },
  });
  resilientMonitor.record({ eventId: "evt-failure-1", name: "page", durationMs: 12, status: "SUCCESS" });
  const failedFlush = await resilientMonitor.flush();
  assert.equal(failedFlush.ok, false);
  assert.equal(failures, 1);
  assert.equal(resilientMonitor.getSnapshot().queueLength, 1);

  console.log("mini-program performance monitor tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
