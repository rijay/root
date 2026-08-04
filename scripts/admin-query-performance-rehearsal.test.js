const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectAdminQueryRehearsal,
  createRehearsalStore,
  parseArgs,
} = require("./admin-query-performance-rehearsal");
const {
  FIXTURE_COUNTS,
  FIXTURE_VERSION,
} = require("../backend/tests/fixtures/adminPerformanceFixture");

test("local rehearsal uses the approved fixed dataset and no production Adapter", () => {
  const store = createRehearsalStore();
  assert.equal(store.users.length, FIXTURE_COUNTS.users);
  assert.equal(store.activityEnrollments.length, FIXTURE_COUNTS.activityEnrollments);
  assert.equal(store.auditLogs.length, FIXTURE_COUNTS.auditLogs);
  assert.equal(store.contentVersions.length, FIXTURE_COUNTS.contentVersions);
  assert.equal(store.healthContentVersions.length, FIXTURE_COUNTS.scaleQuestions);
});

test("rehearsal emits candidate-compatible dimensions without user data", async () => {
  const events = await collectAdminQueryRehearsal({ samples: 2, version: "test-build" });
  assert.deepEqual(events.map((event) => event.scenario), ["list", "list", "detail", "detail", "audit", "audit", "write", "write"]);
  events.forEach((event) => {
    assert.equal(event.version, "test-build");
    assert.equal(event.environment, "local-fixed-fixture");
    assert.equal(event.evidenceClass, "LOCAL_REHEARSAL");
    assert.match(event.targetOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(event.artifactCommit, "");
    assert.equal(event.datasetVersion, FIXTURE_VERSION);
    assert.equal(Number.isFinite(event.durationMs), true);
    assert.equal(Number.isFinite(event.responseBytes), true);
  });
  assert.equal(JSON.stringify(events).includes("13900000001"), false);
});

test("CLI parser rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--samples", "20", "--version", "candidate-a"]), {
    outputPath: "",
    samples: 20,
    version: "candidate-a",
  });
  assert.throws(() => parseArgs(["--candidate"]), /Unknown argument/);
});
