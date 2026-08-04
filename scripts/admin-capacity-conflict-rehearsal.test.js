const test = require("node:test");
const assert = require("node:assert/strict");

const budgets = require("../admin/config/performance-budgets.json");
const {
  collectAdminCapacityConflictRehearsal,
  createSessions,
  parseArgs,
} = require("./admin-capacity-conflict-rehearsal");

test("capacity rehearsal defines five isolated admin sessions within the browser read limit", () => {
  const sessions = createSessions();
  assert.equal(sessions.length, budgets.capacity.maximumSessions);
  assert.equal(new Set(sessions.map((session) => session.operatorId)).size, sessions.length);
  assert.equal(new Set(sessions.map((session) => session.token)).size, sessions.length);
  assert.equal(
    budgets.capacity.maximumConcurrentReadsAcrossSessions / sessions.length,
    2,
  );
  assert.ok(2 <= budgets.network.maxConcurrentReadsPerBrowser);
});

test("local HTTP rehearsal observes ten reads and rejects both stale editor writes", async () => {
  const evidence = await collectAdminCapacityConflictRehearsal({ version: "test-capacity-conflict" });
  assert.equal(evidence.evidenceClass, "LOCAL_REHEARSAL");
  assert.equal(evidence.capacity.status, "PASS");
  assert.equal(evidence.capacity.sessionCount, 5);
  assert.equal(evidence.capacity.observedMaximumConcurrentReads, 10);
  assert.equal(evidence.capacity.successfulResponses, 10);
  Object.values(evidence.capacity.maximumConcurrentReadsPerSession).forEach((maximum) => {
    assert.ok(maximum <= budgets.network.maxConcurrentReadsPerBrowser);
  });
  assert.deepEqual(
    evidence.conflicts.map((item) => [item.scenario, item.staleWriteHttpStatus, item.staleWriteErrorCode]),
    [
      ["HOME_CAROUSEL_DRAFT", 409, "CONTENT_REVISION_CONFLICT"],
      ["HEALTH_SCALE_DRAFT", 409, "HEALTH_CONTENT_REVISION_CONFLICT"],
    ],
  );
  evidence.conflicts.forEach((item) => {
    assert.equal(item.authoritativeWinnerPreserved, true);
    assert.equal(item.refreshInstruction, "内容已被其他运营更新，请刷新后重试");
  });
  assert.deepEqual(evidence.limitations, [
    "LOCAL_HTTP_ONLY",
    "NOT_BROWSER_SESSION_EVIDENCE",
    "NOT_CANDIDATE_GATE_EVIDENCE",
    "NOT_PRODUCTION_EVIDENCE",
  ]);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("local-capacity-"), false);
  assert.equal(serialized.includes("13900000001"), false);
});

test("capacity rehearsal CLI parser rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--version", "candidate-a"]), {
    outputPath: "",
    version: "candidate-a",
  });
  assert.throws(() => parseArgs(["--candidate"]), /Unknown argument/);
});
