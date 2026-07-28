const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMysqlOutboxDispatcher } = require("../src/mysqlOutboxDispatcher");

function claim(overrides = {}) {
  return {
    outboxEventId: "outbox-1",
    leaseOwner: "worker-opaque-1",
    leaseGeneration: 1,
    attemptCount: 1,
    maxAttempts: 5,
    payloadDigest: "a".repeat(64),
    envelope: { payload_json: { safe: true } },
    ...overrides,
  };
}

function createHarness(options = {}) {
  const calls = [];
  const adapters = options.adapters ? [...options.adapters] : [];
  let connectionIndex = 0;
  const pool = {
    async getConnection() {
      calls.push(["getConnection", connectionIndex]);
      if (options.getConnectionError) throw options.getConnectionError;
      const index = connectionIndex;
      connectionIndex += 1;
      return {
        adapter: adapters[index] || options.adapter,
        async execute(sql) {
          calls.push(["sessionTimeZone", index, sql]);
          if (options.sessionTimeZoneErrors && options.sessionTimeZoneErrors[index]) {
            throw options.sessionTimeZoneErrors[index];
          }
        },
        async beginTransaction() {
          calls.push(["begin", index]);
          if (options.beginError) throw options.beginError;
        },
        async commit() {
          calls.push(["commit", index]);
          if (options.commitErrors && options.commitErrors[index]) throw options.commitErrors[index];
        },
        async rollback() {
          calls.push(["rollback", index]);
          if (options.rollbackErrors && options.rollbackErrors[index]) throw options.rollbackErrors[index];
        },
        destroy() {
          calls.push(["destroy", index]);
        },
        release() {
          calls.push(["release", index]);
        },
      };
    },
  };
  let transitionCalls = 0;
  const dispatcher = createMysqlOutboxDispatcher({
    pool,
    workerId: "worker-opaque-1",
    leaseSeconds: 30,
    maxTransactionAttempts: options.maxTransactionAttempts || 2,
    transitionIdFactory() {
      transitionCalls += 1;
      return `transition-${transitionCalls}`;
    },
    adapterFactory(connection) {
      calls.push(["adapter", connectionIndex - 1]);
      const adapter = connection.adapter;
      if (!adapter) throw new Error("missing fake adapter");
      return {
        ...adapter,
        discard() {
          calls.push(["discard", connectionIndex - 1]);
          if (typeof adapter.discard === "function") adapter.discard();
        },
      };
    },
  });
  return { calls, dispatcher, get transitionCalls() { return transitionCalls; } };
}

test("claimDue commits before returning immutable claims and releases the connection", async () => {
  const stored = claim();
  const harness = createHarness({
    adapter: {
      async claimDue(input) {
        harness.calls.push(["claim", input]);
        return [stored];
      },
    },
  });

  const result = await harness.dispatcher.claimDue({ limit: 3 });
  assert.deepEqual(result, [stored]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[0]), true);
  assert.equal(Object.isFrozen(result[0].envelope), true);
  assert.deepEqual(harness.calls.map((item) => item[0]), [
    "getConnection", "sessionTimeZone", "begin", "adapter", "claim", "commit", "discard", "release",
  ]);
  assert.equal(harness.calls.find((item) => item[0] === "sessionTimeZone")[2], "SET SESSION time_zone = '+08:00'");
  assert.deepEqual(harness.calls.find((item) => item[0] === "claim")[1], {
    workerId: "worker-opaque-1",
    transitionId: "transition-1",
    limit: 3,
    leaseSeconds: 30,
    retryPolicyVersion: "outbox-retry-v1",
  });
});

test("returned claims are deep-cloned and cannot alias mutable Adapter results", async () => {
  const stored = claim({ envelope: { payload: { nested: { value: 1 } } } });
  const harness = createHarness({ adapter: { async claimDue() { return [stored]; } } });
  const result = await harness.dispatcher.claimDue();
  stored.envelope.payload.nested.value = 2;
  assert.equal(result[0].envelope.payload.nested.value, 1);
  assert.equal(Object.isFrozen(result[0].envelope.payload.nested), true);
  result[0].envelope.payload.nested.value = 3;
  assert.equal(result[0].envelope.payload.nested.value, 1);
});

test("operation failures roll back and expose only a generic persistence error", async () => {
  const harness = createHarness({
    adapter: {
      async claimDue() {
        throw new Error("SQL payload token=must-not-leak phone=13800138000");
      },
    },
  });
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.message === "outbox dispatcher persistence failed"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(harness.calls.some((item) => item[0] === "rollback"), true);
  assert.equal(harness.calls.at(-1)[0], "release");
});

test("begin failures destroy the uncertain connection and Adapter lease loss maps to the Core Interface", async () => {
  const beginHarness = createHarness({
    beginError: new Error("driver password=must-not-leak"),
    adapter: {},
  });
  await assert.rejects(
    () => beginHarness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.equal(beginHarness.calls.at(-1)[0], "destroy");

  const leaseHarness = createHarness({
    adapter: {
      async completeOwned() {
        throw Object.assign(new Error("stale SQL detail"), { code: "OUTBOX_LEASE_LOST" });
      },
    },
  });
  await assert.rejects(
    () => leaseHarness.dispatcher.completeOwned(claim()),
    (error) => error.code === "OUTBOX_DISPATCH_LEASE_LOST"
      && error.message === "outbox dispatch lease was lost"
      && !JSON.stringify(error).includes("stale SQL detail")
  );
});

test("completeOwned and failOwned cross the Adapter seam without external delivery", async () => {
  const completeHarness = createHarness({
    adapter: {
      async completeOwned(input, context) {
        completeHarness.calls.push(["complete", input, context]);
        return { status: "SUCCEEDED", replayed: false };
      },
    },
  });
  assert.deepEqual(await completeHarness.dispatcher.completeOwned(claim()), {
    status: "SUCCEEDED",
    replayed: false,
  });
  assert.equal(completeHarness.calls.find((item) => item[0] === "complete")[2].transitionId, "transition-1");

  const failHarness = createHarness({
    adapter: {
      async failOwned(input, context) {
        failHarness.calls.push(["fail", input, context]);
        assert.deepEqual(Object.keys(context).sort(), [
          "reasonCode", "retryPolicy", "retryable", "transitionId",
        ]);
        return { status: "DEAD_LETTER", replayed: false };
      },
    },
  });
  assert.deepEqual(await failHarness.dispatcher.failOwned(claim(), {
    reasonCode: "OUTBOX_PAYLOAD_INVALID",
    retryable: false,
  }), { status: "DEAD_LETTER", replayed: false });
  const failContext = failHarness.calls.find((item) => item[0] === "fail")[2];
  assert.equal(failContext.transitionId, "transition-1");
  assert.equal(failContext.retryable, false);
  assert.equal(failContext.retryPolicy.policyVersion, "outbox-retry-v1");
});

test("recoverExpired uses a bounded database transition and never receives a clock", async () => {
  const harness = createHarness({
    adapter: {
      async recoverExpired(input) {
        harness.calls.push(["recover", input]);
        return { recovered: 2, retryPending: 1, deadLettered: 1 };
      },
    },
  });
  const result = await harness.dispatcher.recoverExpired({ limit: 5 });
  assert.deepEqual(result, { recovered: 2, retryPending: 1, deadLettered: 1 });
  const input = harness.calls.find((item) => item[0] === "recover")[1];
  assert.deepEqual(Object.keys(input).sort(), ["limit", "retryPolicy", "transitionId"]);
  assert.equal(input.limit, 5);
});

test("invalid public inputs fail before acquiring a connection", async () => {
  const harness = createHarness({ adapter: {} });
  await assert.rejects(
    () => harness.dispatcher.claimDue({ limit: 0 }),
    (error) => error.code === "OUTBOX_DISPATCH_INPUT_INVALID"
  );
  await assert.rejects(
    () => harness.dispatcher.completeOwned(null),
    (error) => error.code === "OUTBOX_DISPATCH_INPUT_INVALID"
  );
  assert.equal(harness.calls.length, 0);
});

test("retry policy injection is rejected before any connection is acquired", () => {
  const pool = { async getConnection() { throw new Error("must not run"); } };
  assert.throws(
    () => createMysqlOutboxDispatcher({
      pool,
      workerId: "worker-opaque-1",
      retryPolicy: { policyVersion: "drift-v2", decide() {} },
    }),
    (error) => error.code === "OUTBOX_DISPATCH_CONFIGURATION_INVALID"
  );
});

test("session timezone setup failure destroys the connection before beginning a transaction", async () => {
  const harness = createHarness({
    sessionTimeZoneErrors: [new Error("timezone password=must-not-leak")],
    adapter: {},
  });
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.cause === undefined
      && !require("node:util").inspect(error).includes("must-not-leak")
  );
  assert.equal(harness.calls.at(-1)[0], "destroy");
  assert.equal(harness.calls.some((item) => item[0] === "begin"), false);
});

test("rollback failure destroys the uncertain connection and hides the driver error", async () => {
  const harness = createHarness({
    rollbackErrors: [new Error("rollback dsn=must-not-leak")],
    adapter: {
      async claimDue() {
        throw new Error("work sql=must-not-leak");
      },
    },
  });
  await assert.rejects(
    () => harness.dispatcher.claimDue(),
    (error) => error.code === "OUTBOX_DISPATCH_PERSISTENCE_FAILED"
      && error.cause === undefined
      && !require("node:util").inspect(error).includes("must-not-leak")
  );
  assert.equal(harness.calls.at(-1)[0], "destroy");
  assert.equal(harness.calls.some((item) => item[0] === "release"), false);
});

test("dispatcher source has no external delivery imports or calls", () => {
  const source = [
    "mysqlOutboxDispatcher.js",
    "mysqlOutboxDispatcherAdapter.js",
    "outboxRetryPolicy.js",
    "eventTransport.js",
  ].map((file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8")).join("\n");
  [
    /node:https?/,
    /\brequire\(["']https?["']\)/,
    /\bfetch\s*\(/,
    /axios/i,
    /wework/i,
    /youzan/i,
    /coupon/i,
    /objectStorage/i,
  ].forEach((pattern) => assert.doesNotMatch(source, pattern));
});
