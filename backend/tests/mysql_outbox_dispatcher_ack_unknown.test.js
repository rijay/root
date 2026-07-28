const test = require("node:test");
const assert = require("node:assert/strict");

const { createMysqlOutboxDispatcher } = require("../src/mysqlOutboxDispatcher");

function claim(overrides = {}) {
  return {
    outboxEventId: "outbox-ack-1",
    leaseOwner: "worker-ack-1",
    leaseGeneration: 1,
    attemptCount: 1,
    maxAttempts: 5,
    payloadDigest: "a".repeat(64),
    envelope: { payload_json: { safe: true } },
    ...overrides,
  };
}

function ackHarness(scenarios) {
  const calls = [];
  let index = 0;
  let transitionFactoryCalls = 0;
  const pool = {
    async getConnection() {
      const scenario = scenarios[index] || {};
      const current = index;
      index += 1;
      calls.push(["get", current]);
      return {
        scenario,
        async execute() { calls.push(["sessionTimeZone", current]); },
        async beginTransaction() { calls.push(["begin", current]); },
        async commit() {
          calls.push(["commit", current]);
          if (scenario.commitError) throw scenario.commitError;
        },
        async rollback() {
          calls.push(["rollback", current]);
          if (scenario.rollbackError) throw scenario.rollbackError;
        },
        destroy() { calls.push(["destroy", current]); },
        release() { calls.push(["release", current]); },
      };
    },
  };
  const dispatcher = createMysqlOutboxDispatcher({
    pool,
    workerId: "worker-ack-1",
    transitionIdFactory() {
      transitionFactoryCalls += 1;
      return `ack-transition-${transitionFactoryCalls}`;
    },
    adapterFactory(connection) {
      return Object.freeze({
        ...(connection.scenario.adapter || {}),
        discard() { calls.push(["discard"]); },
      });
    },
  });
  return { calls, dispatcher, get transitionFactoryCalls() { return transitionFactoryCalls; } };
}

function ackLost() {
  return Object.assign(new Error("driver SQL endpoint token=must-not-leak"), { code: "COMMIT_ACK_LOST" });
}

test("claim commit ACK unknown converges by transition readback without a second claim", async () => {
  let claimCalls = 0;
  const persisted = claim();
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async claimDue() {
          claimCalls += 1;
          return [persisted];
        },
      },
    },
    {
      adapter: {
        async readClaimsByTransition(input) {
          assert.equal(input.transitionId, "ack-transition-1");
          return [persisted];
        },
      },
    },
  ]);
  assert.deepEqual(await harness.dispatcher.claimDue(), [persisted]);
  assert.equal(claimCalls, 1);
  assert.equal(harness.transitionFactoryCalls, 1);
  assert.deepEqual(
    harness.calls.filter((item) => item[0] === "rollback"),
    [["rollback", 1]],
    "only the read-only authoritative readback transaction is rolled back"
  );
  assert.equal(harness.calls.some((item) => item[0] === "destroy" && item[1] === 0), true);
  assert.equal(harness.calls.some((item) => item[0] === "release" && item[1] === 0), false);
});

test("an uncommitted claim fails closed instead of claiming a different batch", async () => {
  const transitions = [];
  const persisted = claim();
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async claimDue(input) {
          transitions.push(input.transitionId);
          return [persisted];
        },
      },
    },
    { adapter: { async readClaimsByTransition() { return []; } } },
  ]);
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
  );
  assert.deepEqual(transitions, ["ack-transition-1"]);
  assert.equal(harness.transitionFactoryCalls, 1);
});

test("claim ACK readback with an extra or changed row never converges", async () => {
  for (const recovered of [
    [claim(), claim({ outboxEventId: "outbox-ack-extra" })],
    [claim({ payloadDigest: "b".repeat(64) })],
  ]) {
    const harness = ackHarness([
      {
        commitError: ackLost(),
        adapter: { async claimDue() { return [claim()]; } },
      },
      { adapter: { async readClaimsByTransition() { return recovered; } } },
    ]);
    await assert.rejects(
      () => harness.dispatcher.claimDue(),
      (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
    );
  }
});

test("an expired claim readback fails closed instead of claiming a different batch", async () => {
  let claimCalls = 0;
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async claimDue() {
          claimCalls += 1;
          return [claim()];
        },
      },
    },
    {
      adapter: {
        async readClaimsByTransition() {
          throw Object.assign(new Error("expired row detail"), { code: "OUTBOX_LEASE_LOST" });
        },
      },
    },
  ]);
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_LEASE_LOST"
      && !JSON.stringify(error).includes("expired row detail")
  );
  assert.equal(claimCalls, 1);
  assert.equal(harness.transitionFactoryCalls, 1);
});

test("success commit ACK unknown returns the persisted terminal transition", async () => {
  let completeCalls = 0;
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async completeOwned() {
          completeCalls += 1;
          return { status: "SUCCEEDED", replayed: false };
        },
      },
    },
    {
      adapter: {
        async readTransition(input) {
          assert.equal(input.expectedStatus, "SUCCEEDED");
          return { state: "CONVERGED", result: { status: "SUCCEEDED", replayed: true } };
        },
      },
    },
  ]);
  assert.deepEqual(await harness.dispatcher.completeOwned(claim()), {
    status: "SUCCEEDED",
    replayed: true,
  });
  assert.equal(completeCalls, 1);
  assert.equal(harness.transitionFactoryCalls, 1);
});

test("retry and dead-letter commit ACK unknown converge through matching terminal readback", async () => {
  for (const scenario of [
    { retryable: true, expectedStatus: "RETRY_PENDING" },
    { retryable: false, expectedStatus: "DEAD_LETTER" },
  ]) {
    let failureCalls = 0;
    const persisted = { status: scenario.expectedStatus, transitionId: "ack-transition-1" };
    const harness = ackHarness([
      {
        commitError: ackLost(),
        adapter: {
          async failOwned(input, context) {
            failureCalls += 1;
            assert.equal(context.transitionId, "ack-transition-1");
            assert.equal(context.retryable, scenario.retryable);
            return persisted;
          },
        },
      },
      {
        adapter: {
          async readTransition(input) {
            assert.equal(input.expectedStatus, scenario.expectedStatus);
            return { state: "CONVERGED", result: persisted };
          },
        },
      },
    ]);
    assert.deepEqual(await harness.dispatcher.failOwned(claim(), {
      reasonCode: "OUTBOX_DISPATCH_FAILED",
      retryable: scenario.retryable,
    }), persisted);
    assert.equal(failureCalls, 1);
    assert.equal(harness.transitionFactoryCalls, 1);
  }
});

test("failure finalize retries only the same transition when readback remains owned", async () => {
  const transitions = [];
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async failOwned(input, context) {
          transitions.push(context.transitionId);
          return { status: "RETRY_PENDING" };
        },
      },
    },
    { adapter: { async readTransition() { return { state: "OWNED" }; } } },
    {
      adapter: {
        async failOwned(input, context) {
          transitions.push(context.transitionId);
          return { status: "RETRY_PENDING" };
        },
      },
    },
  ]);
  assert.deepEqual(await harness.dispatcher.failOwned(claim(), {
    reasonCode: "OUTBOX_DISPATCH_FAILED",
    retryable: true,
  }), { status: "RETRY_PENDING" });
  assert.deepEqual(transitions, ["ack-transition-1", "ack-transition-1"]);
  assert.equal(harness.transitionFactoryCalls, 1);
});

test("failure finalize rejects a later lease generation after commit ACK unknown", async () => {
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: { async failOwned() { return { status: "RETRY_PENDING" }; } },
    },
    { adapter: { async readTransition() { return { state: "LEASE_LOST" }; } } },
  ]);
  await assert.rejects(
    () => harness.dispatcher.failOwned(claim(), {
      reasonCode: "OUTBOX_DISPATCH_FAILED",
      retryable: true,
    }),
    (error) => error.code === "OUTBOX_DISPATCH_LEASE_LOST"
  );
});

test("same owned fence retries only the database finalize and a later generation fails closed", async () => {
  let completeCalls = 0;
  const retryHarness = ackHarness([
    {
      commitError: ackLost(),
      adapter: { async completeOwned() { completeCalls += 1; return { status: "SUCCEEDED" }; } },
    },
    { adapter: { async readTransition() { return { state: "OWNED" }; } } },
    { adapter: { async completeOwned() { completeCalls += 1; return { status: "SUCCEEDED" }; } } },
  ]);
  assert.deepEqual(await retryHarness.dispatcher.completeOwned(claim()), { status: "SUCCEEDED" });
  assert.equal(completeCalls, 2);
  assert.equal(retryHarness.transitionFactoryCalls, 1);

  const lostHarness = ackHarness([
    { commitError: ackLost(), adapter: { async completeOwned() { return { status: "SUCCEEDED" }; } } },
    { adapter: { async readTransition() { return { state: "LEASE_LOST" }; } } },
  ]);
  await assert.rejects(
    () => lostHarness.dispatcher.completeOwned(claim()),
    (error) => error.code === "OUTBOX_DISPATCH_LEASE_LOST"
  );
});

test("expired recovery commit ACK unknown converges without a second recovery transition", async () => {
  let recoverCalls = 0;
  const persisted = [{
    outboxEventId: "outbox-recovery-ack-1",
    status: "RETRY_PENDING",
    transitionId: "ack-transition-1",
    leaseGeneration: 1,
    retryPolicyVersion: "outbox-retry-v1",
    delayMs: 5_000,
  }];
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: {
        async recoverExpired() {
          recoverCalls += 1;
          return persisted;
        },
      },
    },
    {
      adapter: {
        async readRecoveryByTransition(input) {
          assert.equal(input.transitionId, "ack-transition-1");
          return {
            state: "CONVERGED",
            result: persisted,
          };
        },
      },
    },
  ]);
  assert.deepEqual(await harness.dispatcher.recoverExpired(), persisted);
  assert.equal(recoverCalls, 1);
});

test("partial recovery ACK readback fails closed", async () => {
  const first = { outboxEventId: "outbox-recovery-1", status: "RETRY_PENDING" };
  const second = { outboxEventId: "outbox-recovery-2", status: "RETRY_PENDING" };
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: { async recoverExpired() { return [first, second]; } },
    },
    {
      adapter: {
        async readRecoveryByTransition() {
          return { state: "CONVERGED", result: [first] };
        },
      },
    },
  ]);
  await assert.rejects(
    () => harness.dispatcher.recoverExpired(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
  );
});

test("authoritative readback rollback failure destroys that connection", async () => {
  const persisted = claim();
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: { async claimDue() { return [persisted]; } },
    },
    {
      rollbackError: new Error("rollback endpoint=must-not-leak"),
      adapter: { async readClaimsByTransition() { return [persisted]; } },
    },
  ]);
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.cause === undefined
      && !require("node:util").inspect(error).includes("must-not-leak")
  );
  assert.equal(harness.calls.some((item) => item[0] === "destroy" && item[1] === 1), true);
  assert.equal(harness.calls.some((item) => item[0] === "release" && item[1] === 1), false);
});

test("failed authoritative readback remains generic and never repeats the transition", async () => {
  let completeCalls = 0;
  const harness = ackHarness([
    {
      commitError: ackLost(),
      adapter: { async completeOwned() { completeCalls += 1; return { status: "SUCCEEDED" }; } },
    },
    {
      adapter: {
        async readTransition() {
          throw new Error("SELECT password=must-not-leak");
        },
      },
    },
  ]);
  await assert.rejects(
    () => harness.dispatcher.completeOwned(claim()),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.message === "outbox dispatcher persistence failed"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(completeCalls, 1);
});
