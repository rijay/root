const test = require("node:test");
const assert = require("node:assert/strict");

const TEST_ONLY_PROTECTED_INBOX_ENV = Object.freeze({
  NODE_ENV: "test",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "test-core-inbox-content-key-with-at-least-32-characters",
  ROOT_INBOX_CONTENT_KEY_ID: "test-core-inbox-v1",
});

const adapterPath = require.resolve("../src/mysqlInboxCheckpointAdapter");
const adapterModule = require(adapterPath);
const realAdapterFactory = adapterModule.createMysqlInboxCheckpointAdapter;

const lifecycle = { created: 0, committed: 0, discarded: 0 };
adapterModule.createMysqlInboxCheckpointAdapter = (connection, options) => {
  lifecycle.created += 1;
  connection.seenHandlerRegistration = options.handlerRegistration;
  const invoke = (name, ...args) => {
    if (!connection.plan || typeof connection.plan[name] !== "function") {
      const error = new Error(`unexpected fake adapter method ${name}`);
      error.code = "FAKE_ADAPTER_METHOD_MISSING";
      throw error;
    }
    return connection.plan[name](...args);
  };
  return Object.freeze({
    receive: (...args) => invoke("receive", ...args),
    claimNext: (...args) => invoke("claimNext", ...args),
    completeOwned: (...args) => invoke("completeOwned", ...args),
    failOwned: (...args) => invoke("failOwned", ...args),
    recoverExpired: (...args) => invoke("recoverExpired", ...args),
    readReceiptConvergence: (...args) => invoke("readReceiptConvergence", ...args),
    readClaimByTransition: (...args) => invoke("readClaimByTransition", ...args),
    readTransition: (...args) => invoke("readTransition", ...args),
    readRecoveryByTransition: (...args) => invoke("readRecoveryByTransition", ...args),
    getCheckpoint: (...args) => invoke("getCheckpoint", ...args),
    afterCommit() { lifecycle.committed += 1; },
    discard() { lifecycle.discarded += 1; },
  });
};
const corePath = require.resolve("../src/mysqlInboxCheckpoint");
delete require.cache[corePath];
const { createMysqlInboxCheckpoint } = require(corePath);
adapterModule.createMysqlInboxCheckpointAdapter = realAdapterFactory;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function testEnvelope() {
  return {
    eventId: "event-core-1",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    sourceName: "myroot-api",
    partitionKey: "task_event:event-core-1",
    partitionPosition: 1,
    aggregateType: "TASK_EVENT",
    aggregateId: "event-core-1",
    aggregateVersion: 1,
    occurredAt: "2026-07-16T20:00:00.000+08:00",
    producerVersion: "0.5.13",
    correlationId: null,
    causationId: null,
    idempotencyKey: "task-event:event-core-1",
    payload: {
      taskEventId: "event-core-1",
      taskType: "SHARE",
      eventType: "SHARE_COMPLETED",
    },
    payloadDigest: "a".repeat(64),
  };
}

function testCheckpoint() {
  return {
    checkpointId: "checkpoint-core-1",
    consumerName: "task-share-completion-projection",
    sourceName: "myroot-api",
    partitionKey: "task_event:event-core-1",
    lastContiguousPosition: 0,
    highWatermarkPosition: 1,
    stateGeneration: 1,
    checkpointTransitionId: "receive-core-1",
    gapStatus: "CLEAR",
    gapFromPosition: null,
    gapToPosition: null,
    gapReasonCode: null,
    blockedReceiptId: null,
    handlerVersion: "task-share-completion-v1",
    lastEventId: null,
    lastReceiptId: null,
    createdAt: "2026-07-16 20:00:00.000",
    updatedAt: "2026-07-16 20:00:00.000",
  };
}

function receiveResult(overrides = {}) {
  return {
    created: true,
    receiptId: "inbox-core-1",
    receiptStatus: "RECEIVED",
    envelope: testEnvelope(),
    checkpoint: testCheckpoint(),
    ...overrides,
  };
}

function testClaim(overrides = {}) {
  return {
    receiptId: "inbox-core-1",
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    leaseOwner: "worker-core-1",
    leaseGeneration: 1,
    attemptCount: 1,
    maxAttempts: 5,
    retryPolicyVersion: "inbox-retry-v1",
    claimTransitionId: "claim-core-1",
    payloadDigest: "a".repeat(64),
    envelope: testEnvelope(),
    ...overrides,
  };
}

function completionResult(overrides = {}) {
  return {
    receiptId: "inbox-core-1",
    status: "SUCCEEDED",
    transitionId: "complete-core-1",
    leaseGeneration: 1,
    attemptCount: 1,
    payloadDigest: "a".repeat(64),
    result: { projectionId: "projection-1" },
    completionManifest: {
      handler: { targetFactIds: ["projection-1"] },
      successorOutboxEventIds: [],
      outboxFlush: { inserted: 0, replayed: 0 },
    },
    resultDigest: "b".repeat(64),
    completionManifestDigest: "c".repeat(64),
    ...overrides,
  };
}

function databaseOnlyHandlerFactory() {
  return Object.freeze({
    kind: "DATABASE_ONLY",
    replaySafe: true,
    async apply() { return { result: {}, manifest: {} }; },
    async verify() { return true; },
  });
}

function createPool(plans) {
  const telemetry = {
    connections: [],
    session: 0,
    begins: 0,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    destroys: 0,
  };
  let index = 0;
  return {
    telemetry,
    async getConnection() {
      const plan = plans[index++] || {};
      const connection = {
        plan,
        inTransaction: false,
        retired: false,
        async execute(sql) {
          assert.equal(this.retired, false);
          assert.equal(sql, "SET SESSION time_zone = '+08:00'");
          assert.equal(this.inTransaction, false);
          telemetry.session += 1;
          return [{ affectedRows: 0 }, []];
        },
        async beginTransaction() {
          telemetry.begins += 1;
          if (plan.beginError) throw plan.beginError;
          this.inTransaction = true;
        },
        async commit() {
          assert.equal(this.inTransaction, true);
          telemetry.commits += 1;
          this.inTransaction = false;
          if (plan.commitError) throw plan.commitError;
        },
        async rollback() {
          assert.equal(this.inTransaction, true);
          telemetry.rollbacks += 1;
          this.inTransaction = false;
          if (plan.rollbackError) throw plan.rollbackError;
        },
        release() {
          assert.equal(this.retired, false);
          assert.equal(this.inTransaction, false);
          this.retired = true;
          telemetry.releases += 1;
        },
        destroy() {
          assert.equal(this.retired, false);
          this.retired = true;
          this.inTransaction = false;
          telemetry.destroys += 1;
        },
      };
      telemetry.connections.push(connection);
      return connection;
    },
  };
}

let transitionSequence = 0;
function createCore(pool, overrides = {}) {
  return createMysqlInboxCheckpoint({
    pool,
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    sourceName: "myroot-api",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
    workerId: "worker-core-1",
    env: TEST_ONLY_PROTECTED_INBOX_ENV,
    transitionIdFactory() {
      transitionSequence += 1;
      return `core-transition-${transitionSequence}`;
    },
    ...overrides,
  });
}

function commitUnknown() {
  const error = new Error("commit unknown token=must-not-leak");
  error.code = "COMMIT_ACK_UNKNOWN";
  return error;
}

test("Core exposes the frozen Inbox Interface and rejects caller seams", () => {
  const pool = createPool([]);
  assert.deepEqual(Object.keys(createCore(pool)).sort(), [
    "claimNext", "completeOwned", "failOwned", "getCheckpoint", "receive", "recoverExpired",
  ].sort());
  assert.throws(
    () => createCore(pool, { adapterFactory() {} }),
    (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createCore(pool, { retryPolicy: {} }),
    (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createCore(pool, { deliveryAdapter: {} }),
    (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
  );
});

test("protected Core fails closed for missing Inbox content keys before acquiring MySQL", () => {
  const pool = createPool([]);
  assert.throws(
    () => createCore(pool, { env: { NODE_ENV: "production" } }),
    (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
      && !/ROOT_INBOX_CONTENT/.test(error.message)
  );
  assert.equal(pool.telemetry.connections.length, 0);
});

for (const NODE_ENV of ["development", "test"]) {
  test(`durable Core fails closed for missing Inbox content keys in ${NODE_ENV} before acquiring MySQL`, () => {
    const pool = createPool([]);
    assert.throws(
      () => createCore(pool, { env: { NODE_ENV } }),
      (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
        && !/ROOT_INBOX_CONTENT/.test(error.message)
    );
    assert.equal(pool.telemetry.connections.length, 0, `${NODE_ENV} acquired MySQL before rejecting the codec`);
  });
}

test("protected runtime continues to reject caller-provided handler factories before acquiring MySQL", () => {
  const pool = createPool([]);
  assert.throws(
    () => createCore(pool, {
      env: {
        NODE_ENV: "production",
        ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "protected-core-inbox-content-key-with-at-least-32-characters",
        ROOT_INBOX_CONTENT_KEY_ID: "protected-core-inbox-v1",
      },
      transactionalHandlerFactory: databaseOnlyHandlerFactory,
    }),
    (error) => error.code === "INBOX_CORE_CONFIGURATION_INVALID"
  );
  assert.equal(pool.telemetry.connections.length, 0);
});

test("receive sets the session timezone, commits once and returns an immutable result", async () => {
  const expected = receiveResult();
  let observed;
  const pool = createPool([{
    receive(input) {
      observed = input;
      return expected;
    },
  }]);
  const result = await createCore(pool).receive(testEnvelope());
  assert.deepEqual(result, expected);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.envelope.payload), true);
  assert.equal(observed.consumerName, "task-share-completion-projection");
  assert.equal(observed.handlerVersion, "task-share-completion-v1");
  assert.equal(observed.maxAttempts, 5);
  assert.equal(observed.retryPolicyVersion, "inbox-retry-v1");
  assert.equal(pool.telemetry.session, 1);
  assert.equal(pool.telemetry.commits, 1);
  assert.equal(pool.telemetry.releases, 1);
  assert.equal(pool.telemetry.destroys, 0);
});

test("receive commit ACK unknown destroys the connection and converges from a fresh read", async () => {
  const expected = receiveResult({ created: false, receiptStatus: "CLAIMED" });
  const pool = createPool([
    {
      receive() { return receiveResult(); },
      commitError: commitUnknown(),
    },
    {
      readReceiptConvergence() { return { state: "CONVERGED", result: expected }; },
    },
  ]);
  const result = await createCore(pool).receive(testEnvelope());
  assert.deepEqual(result, expected);
  assert.equal(pool.telemetry.destroys, 1);
  assert.equal(pool.telemetry.rollbacks, 1);
  assert.equal(pool.telemetry.releases, 1);
});

test("receive retries the same transition only when authoritative readback proves absence", async () => {
  const transitions = [];
  const pool = createPool([
    {
      receive(input) { transitions.push(input.transitionId); return receiveResult(); },
      commitError: commitUnknown(),
    },
    {
      readReceiptConvergence() { return { state: "ABSENT" }; },
    },
    {
      receive(input) { transitions.push(input.transitionId); return receiveResult(); },
    },
  ]);
  const result = await createCore(pool).receive(testEnvelope());
  assert.equal(result.receiptId, "inbox-core-1");
  assert.equal(transitions.length, 2);
  assert.equal(transitions[0], transitions[1]);
  assert.equal(pool.telemetry.destroys, 1);
  assert.equal(pool.telemetry.commits, 2);
});

test("claim ACK unknown converges only on the exact immutable claim", async () => {
  const owned = testClaim();
  const pool = createPool([
    {
      claimNext() { return [owned]; },
      commitError: commitUnknown(),
    },
    {
      readClaimByTransition() { return [owned]; },
    },
  ]);
  const [result] = await createCore(pool).claimNext({
    sourceName: "myroot-api",
    partitionKey: "task_event:event-core-1",
  });
  assert.deepEqual(result, owned);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(pool.telemetry.destroys, 1);
});

test("claim ACK unknown fails closed on a partial or changed readback", async () => {
  const pool = createPool([
    {
      claimNext() { return [testClaim()]; },
      commitError: commitUnknown(),
    },
    {
      readClaimByTransition() { return [testClaim({ leaseGeneration: 2 })]; },
    },
  ]);
  await assert.rejects(
    () => createCore(pool).claimNext({ sourceName: "myroot-api", partitionKey: "task_event:event-core-1" }),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED"
  );
});

test("claim ACK unknown never retargets a later partition head after the original transition disappears", async () => {
  let claimAttempts = 0;
  const pool = createPool([
    {
      claimNext() {
        claimAttempts += 1;
        return [testClaim()];
      },
      commitError: commitUnknown(),
    },
    {
      readClaimByTransition() { return []; },
    },
    {
      claimNext() {
        claimAttempts += 1;
        return [testClaim({ receiptId: "inbox-core-2" })];
      },
    },
  ]);
  await assert.rejects(
    () => createCore(pool).claimNext({ sourceName: "myroot-api", partitionKey: "task_event:event-core-1" }),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED"
  );
  assert.equal(claimAttempts, 1);
  assert.equal(pool.telemetry.connections.length, 2);
});

test("complete commit ACK unknown verifies the exact target/outbox manifest result", async () => {
  const owned = testClaim();
  const completed = completionResult();
  const pool = createPool([
    {
      completeOwned(_claim, input) {
        return { ...completed, transitionId: input.transitionId };
      },
      commitError: commitUnknown(),
    },
    {
      readTransition(input) {
        return {
          state: "CONVERGED",
          result: { ...completed, transitionId: input.transitionId },
        };
      },
    },
  ]);
  const result = await createCore(pool).completeOwned(owned);
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(result.result, { projectionId: "projection-1" });
  assert.equal(pool.telemetry.destroys, 1);
});

test("complete ACK unknown retries the same transition only while the same generation remains owned", async () => {
  const owned = testClaim();
  const transitions = [];
  const pool = createPool([
    {
      completeOwned(_claim, input) {
        transitions.push(input.transitionId);
        return { ...completionResult(), transitionId: input.transitionId };
      },
      commitError: commitUnknown(),
    },
    {
      readTransition() { return { state: "OWNED" }; },
    },
    {
      completeOwned(_claim, input) {
        transitions.push(input.transitionId);
        return { ...completionResult(), transitionId: input.transitionId };
      },
    },
  ]);
  const result = await createCore(pool).completeOwned(owned);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(transitions.length, 2);
  assert.equal(transitions[0], transitions[1]);
});

test("a later generation is reported as lease lost and never retried", async () => {
  const pool = createPool([
    {
      completeOwned() { return completionResult(); },
      commitError: commitUnknown(),
    },
    {
      readTransition() { return { state: "LEASE_LOST" }; },
    },
  ]);
  await assert.rejects(
    () => createCore(pool).completeOwned(testClaim()),
    (error) => error.code === "INBOX_CORE_LEASE_LOST"
  );
  assert.equal(pool.telemetry.connections.length, 2);
});

test("failOwned uses the fixed inbox retry policy and maps terminal state", async () => {
  let observed;
  const pool = createPool([{
    failOwned(_claim, input) {
      observed = input;
      return {
        receiptId: "inbox-core-1",
        status: "RETRY_PENDING",
        transitionId: input.transitionId,
        leaseGeneration: 1,
        attemptCount: 1,
        payloadDigest: "a".repeat(64),
      };
    },
  }]);
  const result = await createCore(pool).failOwned(testClaim(), {
    reasonCode: "INBOX_HANDLER_FAILED",
    retryable: true,
  });
  assert.equal(result.status, "RETRY_PENDING");
  assert.equal(observed.retryPolicy.policyVersion, "inbox-retry-v1");
  assert.equal(observed.retryable, true);
});

test("failure ACK unknown passes the exact retry decision into authoritative readback", async () => {
  let expectedFailure;
  const owned = testClaim();
  const terminal = {
    receiptId: "inbox-core-1",
    status: "RETRY_PENDING",
    transitionId: "placeholder",
    leaseGeneration: 1,
    attemptCount: 1,
    payloadDigest: "a".repeat(64),
    failureDecision: {
      kind: "RETRY",
      delayMs: 5_000,
      reasonCode: "INBOX_HANDLER_FAILED",
      policyVersion: "inbox-retry-v1",
      attemptCount: 1,
      maxAttempts: 5,
      leaseGeneration: 1,
    },
    failureDecisionDigest: "b".repeat(64),
  };
  const pool = createPool([
    {
      failOwned(_claim, input) {
        return { ...terminal, transitionId: input.transitionId };
      },
      commitError: commitUnknown(),
    },
    {
      readTransition(input) {
        expectedFailure = input.expectedFailure;
        return { state: "CONVERGED", result: { ...terminal, transitionId: input.transitionId } };
      },
    },
  ]);
  const result = await createCore(pool).failOwned(owned, {
    reasonCode: "INBOX_HANDLER_FAILED",
    retryable: true,
  });
  assert.equal(result.status, "RETRY_PENDING");
  assert.deepEqual(expectedFailure, {
    kind: "RETRY",
    delayMs: 5_000,
    reasonCode: "INBOX_HANDLER_FAILED",
    policyVersion: "inbox-retry-v1",
  });
});

test("recoverExpired commit ACK unknown never retargets a later partition head", async () => {
  const transitions = [];
  const recoveredResult = [{
    receiptId: "inbox-core-1",
    status: "RETRY_PENDING",
    transitionId: "placeholder",
    leaseGeneration: 1,
    attemptCount: 1,
    payloadDigest: "a".repeat(64),
  }];
  const pool = createPool([
    {
      recoverExpired(input) {
        transitions.push(input.transitionId);
        return recoveredResult.map((entry) => ({ ...entry, transitionId: input.transitionId }));
      },
      commitError: commitUnknown(),
    },
    {
      readRecoveryByTransition() { return { state: "ABSENT" }; },
    },
    {
      recoverExpired(input) {
        transitions.push(input.transitionId);
        return recoveredResult.map((entry) => ({ ...entry, transitionId: input.transitionId }));
      },
    },
  ]);
  await assert.rejects(
    () => createCore(pool).recoverExpired({
      sourceName: "myroot-api",
      partitionKey: "task_event:event-core-1",
    }),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED"
  );
  assert.equal(transitions.length, 1);
  assert.equal(pool.telemetry.connections.length, 2);
});

test("recoverExpired ACK unknown returns an observed no-op without probing a new head", async () => {
  let recoverAttempts = 0;
  const pool = createPool([
    {
      recoverExpired() {
        recoverAttempts += 1;
        return [];
      },
      commitError: commitUnknown(),
    },
    {
      readRecoveryByTransition() { return { state: "ABSENT" }; },
    },
    {
      recoverExpired() {
        recoverAttempts += 1;
        return [{ status: "RETRY_PENDING" }];
      },
    },
  ]);
  const result = await createCore(pool).recoverExpired({
    sourceName: "myroot-api",
    partitionKey: "task_event:event-core-1",
  });
  assert.deepEqual(result, []);
  assert.equal(recoverAttempts, 1);
  assert.equal(pool.telemetry.connections.length, 2);
});

test("getCheckpoint is read-only and rolls back instead of committing", async () => {
  const expected = testCheckpoint();
  const pool = createPool([{
    getCheckpoint() { return expected; },
  }]);
  const result = await createCore(pool).getCheckpoint({
    sourceName: "myroot-api",
    partitionKey: "task_event:event-core-1",
  });
  assert.deepEqual(result, expected);
  assert.equal(pool.telemetry.commits, 0);
  assert.equal(pool.telemetry.rollbacks, 1);
  assert.equal(pool.telemetry.releases, 1);
});

test("begin and rollback failures destroy connections while errors stay generic", async () => {
  const beginError = new Error("begin failed bearer=must-not-leak");
  const beginPool = createPool([{ beginError }]);
  await assert.rejects(
    () => createCore(beginPool).receive(testEnvelope()),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED" && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(beginPool.telemetry.destroys, 1);

  const workError = new Error("SQL failed token=must-not-leak");
  workError.code = "ER_LOCK_DEADLOCK";
  const rollbackPool = createPool([{
    receive() { throw workError; },
    rollbackError: new Error("rollback failed secret=must-not-leak"),
  }]);
  await assert.rejects(
    () => createCore(rollbackPool).receive(testEnvelope()),
    (error) => error.code === "INBOX_CORE_PERSISTENCE_FAILED" && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(rollbackPool.telemetry.destroys, 1);
});
