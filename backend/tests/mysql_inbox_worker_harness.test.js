const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const corePath = require.resolve("../src/mysqlInboxCheckpoint");
const workerPath = require.resolve("../src/mysqlInboxWorkerHarness");
const originalCoreCache = require.cache[corePath];
let nextCore;
const coreConstructions = [];

require.cache[corePath] = {
  id: corePath,
  filename: corePath,
  loaded: true,
  exports: {
    createMysqlInboxCheckpoint(options) {
      coreConstructions.push(options);
      if (!nextCore) throw new Error("missing fake core");
      return nextCore;
    },
  },
};
delete require.cache[workerPath];
const { createMysqlInboxWorkerHarness } = require(workerPath);

test.after(() => {
  delete require.cache[workerPath];
  if (originalCoreCache) require.cache[corePath] = originalCoreCache;
  else delete require.cache[corePath];
});

const ENABLED_ENV = Object.freeze({ MYROOT_INBOX_WORKER_HARNESS_ENABLED: "true" });
const INSPECT_ROW = Object.freeze({
  receipt_count: 12,
  received_count: 2,
  retry_pending_count: 1,
  claimed_count: 1,
  succeeded_count: 5,
  dead_letter_count: 2,
  review_required_count: 1,
  checkpoint_missing_receipt_count: 1,
  blocked_gap_scope_count: 2,
  runnable_scope_count: 3,
  recoverable_scope_count: 1,
  successor_unavailable_head_count: 0,
  registration_mismatch_head_count: 2,
});
const EMPTY_INSPECT_ROW = Object.freeze(Object.fromEntries(
  Object.keys(INSPECT_ROW).map((key) => [key, 0])
));

function scopeRow(suffix = "1") {
  return {
    source_name: "myroot-api",
    partition_key: `task_event:event-worker-${suffix}`,
    partition_position: 1,
  };
}

function createPool(options = {}) {
  const telemetry = {
    executes: [],
    releases: 0,
    destroys: 0,
  };
  const pool = {
    telemetry,
    async getConnection() {
      return {
        async execute(sql, values = []) {
          telemetry.executes.push({ sql, values });
          if (/^SET SESSION time_zone/.test(sql)) return [[], []];
          if (/COUNT\(\*\) AS receipt_count/.test(sql)) {
            if (values.includes("task.event.recorded.v1")) {
              return [[options.inspectRow || INSPECT_ROW], []];
            }
            return [[EMPTY_INSPECT_ROW], []];
          }
          if (/r\.status = 'CLAIMED'/.test(sql)) {
            const eventType = values.find((value) => typeof value === "string"
              && value.endsWith(".v1") && value.includes("."));
            if (options.recoverRowsByEventType
              && Object.hasOwn(options.recoverRowsByEventType, eventType)) {
              return [options.recoverRowsByEventType[eventType], []];
            }
            return [values.includes("task.event.recorded.v1") ? (options.recoverRows || []) : [], []];
          }
          const eventType = values.find((value) => typeof value === "string"
            && value.endsWith(".v1") && value.includes("."));
          if (options.runRowsByEventType && Object.hasOwn(options.runRowsByEventType, eventType)) {
            return [options.runRowsByEventType[eventType], []];
          }
          return [values.includes("task.event.recorded.v1") ? (options.runRows || []) : [], []];
        },
        release() { telemetry.releases += 1; },
        destroy() { telemetry.destroys += 1; },
      };
    },
  };
  return pool;
}

function createCore(overrides = {}) {
  const calls = [];
  const core = {
    calls,
    async claimNext(scope) {
      calls.push(["claimNext", scope]);
      return [{ receiptId: "receipt-worker-1", attemptCount: 1, maxAttempts: 5 }];
    },
    async completeOwned(claim) {
      calls.push(["completeOwned", claim]);
      return { status: "SUCCEEDED" };
    },
    async failOwned(claim, input) {
      calls.push(["failOwned", claim, input]);
      return { status: "RETRY_PENDING" };
    },
    async recoverExpired(scope) {
      calls.push(["recoverExpired", scope]);
      return [{ status: "RETRY_PENDING" }];
    },
    ...overrides,
  };
  return core;
}

test.beforeEach(() => {
  coreConstructions.length = 0;
  nextCore = createCore();
});

test("production construction fixes the explicit runnable registrations and exposes only the worker Interface", async () => {
  const pool = createPool({ runRows: [scopeRow()] });
  const harness = createMysqlInboxWorkerHarness({
    pool,
    env: ENABLED_ENV,
    workerId: "inbox-worker-test-1",
  });
  assert.deepEqual(Object.keys(harness).sort(), ["inspect", "recoverOnce", "runOnce"]);
  assert.equal(Object.isFrozen(harness), true);
  assert.equal(coreConstructions.length, 1);
  assert.deepEqual({
    consumerName: coreConstructions[0].consumerName,
    handlerVersion: coreConstructions[0].handlerVersion,
    sourceName: coreConstructions[0].sourceName,
    eventType: coreConstructions[0].eventType,
    schemaVersion: coreConstructions[0].schemaVersion,
    aggregateType: coreConstructions[0].aggregateType,
  }, {
    consumerName: "task-share-completion-projection",
    handlerVersion: "task-share-completion-v1",
    sourceName: "myroot-api",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    aggregateType: "TASK_EVENT",
  });
  assert.equal(coreConstructions[0].pool, pool);
  assert.equal("registry" in coreConstructions[0], false);
  assert.equal("handlerFactory" in coreConstructions[0], false);
  assert.equal("deliveryAdapter" in coreConstructions[0], false);

  const result = await harness.runOnce({ limit: 1 });
  assert.deepEqual(result, {
    discoveredScopeCount: 1,
    claimedCount: 1,
    succeededCount: 1,
    retryScheduledCount: 0,
    noOpCount: 0,
  });
  assert.deepEqual(nextCore.calls.map((entry) => entry[0]), ["claimNext", "completeOwned"]);
  assert.deepEqual(nextCore.calls[0][1], {
    sourceName: "myroot-api",
    partitionKey: "task_event:event-worker-1",
  });

  const discovery = pool.telemetry.executes.find((entry) => /inbox_worker:discover_runnable/.test(entry.sql));
  assert.match(discovery.sql, /c\.gap_status = 'CLEAR'/);
  assert.match(discovery.sql, /r\.partition_position = c\.last_contiguous_position \+ 1/);
  assert.match(discovery.sql, /r\.next_retry_at <= CURRENT_TIMESTAMP\(3\)/);
  assert.match(discovery.sql, /r\.handler_descriptor_digest = \?/);
  assert.match(discovery.sql, /r\.handler_source_digest = \?/);
  assert.match(discovery.sql, /r\.handler_registration_digest = \?/);
  assert.doesNotMatch(discovery.sql, /payload_json|result_json|error_json|aggregate_id/i);
  assert.equal(discovery.values.length, 13);
  assert.equal(pool.telemetry.releases, 1);
  assert.equal(pool.telemetry.destroys, 0);
});

test("runOnce schedules the fixed retry decision after handler completion fails", async () => {
  const pool = createPool({ runRows: [scopeRow()] });
  nextCore = createCore({
    async completeOwned(claim) {
      this.calls.push(["completeOwned", claim]);
      throw new Error("sensitive handler payload must-not-leak");
    },
  });
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  const result = await harness.runOnce({ limit: 1 });
  assert.deepEqual(result, {
    discoveredScopeCount: 1,
    claimedCount: 1,
    succeededCount: 0,
    retryScheduledCount: 1,
    noOpCount: 0,
  });
  const failure = nextCore.calls.find((entry) => entry[0] === "failOwned");
  assert.deepEqual(failure[2], {
    reasonCode: "INBOX_HANDLER_EXECUTION_FAILED",
    retryable: true,
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("runOnce fails closed with a generic error when completion and retry persistence both fail", async () => {
  const pool = createPool({ runRows: [scopeRow()] });
  nextCore = createCore({
    async completeOwned(claim) {
      this.calls.push(["completeOwned", claim]);
      throw new Error("handler-secret");
    },
    async failOwned(claim, input) {
      this.calls.push(["failOwned", claim, input]);
      throw new Error("database-secret");
    },
  });
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  await assert.rejects(
    () => harness.runOnce({ limit: 1 }),
    (error) => error.code === "INBOX_WORKER_PERSISTENCE_FAILED"
      && error.message === "inbox worker harness operation failed"
      && !require("node:util").inspect(error).includes("secret")
  );
});

test("recoverOnce discovers only an expired clear checkpoint head and returns counts", async () => {
  const pool = createPool({ recoverRows: [scopeRow("recover")] });
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  const result = await harness.recoverOnce({ limit: 5 });
  assert.deepEqual(result, {
    discoveredScopeCount: 1,
    recoveredCount: 1,
    retryPendingCount: 1,
    deadLetterCount: 0,
    noOpCount: 0,
  });
  assert.deepEqual(nextCore.calls, [[
    "recoverExpired",
    { sourceName: "myroot-api", partitionKey: "task_event:event-worker-recover" },
  ]]);
  const discovery = pool.telemetry.executes.find((entry) => /r\.status = 'CLAIMED'/.test(entry.sql));
  assert.match(discovery.sql, /r\.lease_expires_at <= CURRENT_TIMESTAMP\(3\)/);
  assert.match(discovery.sql, /c\.gap_status = 'CLEAR'/);
  assert.match(discovery.sql, /r\.partition_position = c\.last_contiguous_position \+ 1/);
  assert.match(discovery.sql, /r\.handler_registration_digest = \?/);
  assert.doesNotMatch(discovery.sql, /payload_json|result_json|error_json|aggregate_id/i);
});

test("an absent discovery result blocks gap or stale candidates before Core invocation", async () => {
  const pool = createPool({ runRows: [], recoverRows: [] });
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  assert.deepEqual(await harness.runOnce({ limit: 10 }), {
    discoveredScopeCount: 0,
    claimedCount: 0,
    succeededCount: 0,
    retryScheduledCount: 0,
    noOpCount: 0,
  });
  assert.deepEqual(await harness.recoverOnce({ limit: 10 }), {
    discoveredScopeCount: 0,
    recoveredCount: 0,
    retryPendingCount: 0,
    deadLetterCount: 0,
    noOpCount: 0,
  });
  assert.deepEqual(nextCore.calls, []);
});

test("inspect returns aggregate counts only and never selects persisted content", async () => {
  const pool = createPool();
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  const result = await harness.inspect();
  assert.deepEqual(result, {
    receiptCount: 12,
    statusCounts: {
      received: 2,
      retryPending: 1,
      claimed: 1,
      succeeded: 5,
      deadLetter: 2,
      reviewRequired: 1,
    },
    runnableScopeCount: 3,
    recoverableScopeCount: 1,
    blockedGapScopeCount: 2,
    checkpointMissingReceiptCount: 1,
    registrationMismatchHeadCount: 2,
    successorUnavailableHeadCount: 0,
  });
  const query = pool.telemetry.executes.find((entry) => /COUNT\(\*\) AS receipt_count/.test(entry.sql));
  assert.doesNotMatch(query.sql, /payload_json|result_json|error_json|aggregate_id|event_id/i);
  const mismatch = query;
  assert.match(mismatch.sql, /r\.partition_position = c\.last_contiguous_position \+ 1/);
  assert.match(mismatch.sql, /NOT \(/);
  assert.match(mismatch.sql, /r\.handler_registration_digest = \?/);
  assert.doesNotMatch(mismatch.sql, /payload_json|result_json|error_json|aggregate_id|event_id/i);
  assert.equal(mismatch.values.length, 15);
  assert.equal(JSON.stringify(result).includes("partition"), false);
  assert.equal(JSON.stringify(result).includes("user"), false);
});

test("formal runtime is disabled by default while read-only inspection remains available", async () => {
  const pool = createPool();
  const harness = createMysqlInboxWorkerHarness({ pool, env: {} });
  assert.equal(coreConstructions.length, 0);
  await assert.rejects(
    () => harness.runOnce({ limit: 1 }),
    (error) => error.code === "INBOX_WORKER_DISABLED"
  );
  await assert.rejects(
    () => harness.recoverOnce({ limit: 1 }),
    (error) => error.code === "INBOX_WORKER_DISABLED"
  );
  assert.equal((await harness.inspect()).receiptCount, 12);
});

test("caller factories, registries, network and delivery adapters are outside the production constructor", () => {
  const pool = createPool();
  for (const option of ["handlerFactory", "registry", "network", "deliveryAdapter", "coreFactory"]) {
    assert.throws(
      () => createMysqlInboxWorkerHarness({ pool, env: {}, [option]: {} }),
      (error) => error.code === "INBOX_WORKER_CONFIGURATION_INVALID"
    );
  }
  assert.throws(
    () => createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV, workerId: "bad worker id" }),
    (error) => error.code === "INBOX_WORKER_CONFIGURATION_INVALID"
  );
});

test("input and discovery rows are bounded and malformed state fails closed", async () => {
  const pool = createPool({ runRows: [scopeRow(), scopeRow()] });
  const harness = createMysqlInboxWorkerHarness({ pool, env: ENABLED_ENV });
  for (const input of [{}, { limit: 0 }, { limit: 101 }, { limit: 1, extra: true }]) {
    await assert.rejects(
      () => harness.runOnce(input),
      (error) => error.code === "INBOX_WORKER_INPUT_INVALID"
    );
  }
  await assert.rejects(
    () => harness.runOnce({ limit: 2 }),
    (error) => error.code === "INBOX_WORKER_PERSISTENCE_FAILED"
  );
});

test("worker source has no scheduler, caller factory, network or delivery seam", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "mysqlInboxWorkerHarness.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /require\(["'](?:node:)?https?["']\)|\bfetch\s*\(|setInterval|setTimeout/);
  assert.doesNotMatch(source, /adapterFactory|handlerFactory|deliveryAdapter|testOnlyHandlerRegistry/);
  assert.doesNotMatch(source, /assertSuccessorAvailable|INBOX_WORKER_SUCCESSOR_UNAVAILABLE/);
  assert.match(source, /getDefaultInboxHandlerRegistry/);
  assert.match(source, /MYROOT_INBOX_WORKER_HARNESS_ENABLED/);
});
