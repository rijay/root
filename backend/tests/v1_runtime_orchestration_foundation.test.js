const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const sourcePath = path.join(__dirname, "../src/v1RuntimeOrchestrationFoundation.js");
const productionExports = require(sourcePath);
const { createV1RuntimeOrchestrationFoundation } = productionExports;

function loadInternalTestSeams() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const testModule = new Module(sourcePath, module);
  testModule.filename = sourcePath;
  testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  testModule._compile(`${source}\nmodule.exports = {\n`
    + "  createRuntimeOrchestrationCore,\n"
    + "  createMysqlNamedLockCoordinator,\n"
    + "  runtimeTargetIdentity,\n"
    + "  runtimeLockName,\n"
    + "  createTargetBoundMysqlPool,\n"
    + "  mysqlPoolConnectionLimit,\n"
    + "};\n", sourcePath);
  return testModule.exports;
}

const {
  createRuntimeOrchestrationCore,
  createMysqlNamedLockCoordinator,
  runtimeTargetIdentity,
  runtimeLockName,
  createTargetBoundMysqlPool,
  mysqlPoolConnectionLimit,
} = loadInternalTestSeams();

const ENABLED_ENV = Object.freeze({
  MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED: "true",
  MYROOT_V1_RUNTIME_KILL_SWITCH: "DISENGAGED",
  MYROOT_V1_RUNTIME_OWNER: "runtime-owner-a",
  MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "true",
  MYROOT_INBOX_WORKER_HARNESS_ENABLED: "true",
  MYSQL_CONNECTION_LIMIT: "8",
  MYSQL_DATABASE: "myroot_test_a",
  MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-environment-a",
});

function expectCode(action, code) {
  return assert.rejects(action, (error) => error && error.code === code);
}

function bridgeSnapshot(overrides = {}) {
  return {
    enabled: true,
    killSwitch: "OPEN",
    lag: { receipt: 0, claimed: 0 },
    mismatch: {
      outboxScope: 0,
      inboxRegistration: 0,
      terminalWithoutReceipt: 0,
      unregisteredActive: 0,
      successorUnavailableActive: 0,
      outboxOpenDeadLetter: 0,
      deadLetterCompanion: 0,
    },
    readiness: { ready: true, reasonCode: "BRIDGE_SCOPE_READY" },
    ...overrides,
  };
}

function workerSnapshot(overrides = {}) {
  return {
    receiptCount: 0,
    statusCounts: {
      received: 0,
      retryPending: 0,
      claimed: 0,
      succeeded: 0,
      deadLetter: 0,
      reviewRequired: 0,
    },
    runnableScopeCount: 0,
    recoverableScopeCount: 0,
    blockedGapScopeCount: 0,
    checkpointMissingReceiptCount: 0,
    registrationMismatchHeadCount: 0,
    successorUnavailableHeadCount: 0,
    ...overrides,
  };
}

function createAdapterSet(options = {}) {
  const calls = [];
  let held = options.held !== false;
  let releaseCount = 0;
  let acquisitionCount = 0;
  let bridgeInspectionCount = 0;
  let workerInspectionCount = 0;
  const bridge = {
    async inspect() {
      calls.push("bridge.inspect");
      if (options.bridgeInspectError) throw options.bridgeInspectError;
      const snapshots = options.bridgeSnapshots || [options.bridgeSnapshot || bridgeSnapshot()];
      const snapshot = snapshots[Math.min(bridgeInspectionCount, snapshots.length - 1)];
      bridgeInspectionCount += 1;
      return snapshot;
    },
    async recoverOnce(input) {
      calls.push(`bridge.recover:${input.limit}`);
      if (options.bridgeRecover) return options.bridgeRecover(input);
      return { enabled: true, recoveredCount: 0, retryPendingCount: 0, deadLetteredCount: 0 };
    },
    async runOnce(input) {
      calls.push(`bridge.run:${input.limit}`);
      if (options.bridgeRun) return options.bridgeRun(input);
      return {
        enabled: true,
        claimedCount: 0,
        inboxCreatedCount: 0,
        inboxReplayedCount: 0,
        outboxCompletedCount: 0,
        retryScheduledCount: 0,
        deadLetteredCount: 0,
      };
    },
  };
  const worker = {
    async inspect() {
      calls.push("worker.inspect");
      if (options.workerInspectError) throw options.workerInspectError;
      const snapshots = options.workerSnapshots || [options.workerSnapshot || workerSnapshot()];
      const snapshot = snapshots[Math.min(workerInspectionCount, snapshots.length - 1)];
      workerInspectionCount += 1;
      return snapshot;
    },
    async recoverOnce(input) {
      calls.push(`worker.recover:${input.limit}`);
      if (options.workerRecover) return options.workerRecover(input);
      return {
        discoveredScopeCount: 0,
        recoveredCount: 0,
        retryPendingCount: 0,
        deadLetterCount: 0,
        noOpCount: 0,
      };
    },
    async runOnce(input) {
      calls.push(`worker.run:${input.limit}`);
      if (options.workerRun) return options.workerRun(input);
      return {
        discoveredScopeCount: 0,
        claimedCount: 0,
        succeededCount: 0,
        retryScheduledCount: 0,
        noOpCount: 0,
      };
    },
  };
  const coordinator = {
    async inspect() {
      calls.push("coordinator.inspect");
      if (options.coordinatorInspectError) throw options.coordinatorInspectError;
      return options.coordinationSnapshot || {
        ready: true,
        lockState: "FREE",
        coordinationScope: "NON_OVERLAP_COORDINATION_ONLY",
      };
    },
    async tryAcquire(identity) {
      calls.push(`coordinator.acquire:${identity.runtimeOwner}`);
      acquisitionCount += 1;
      if (options.busy || acquisitionCount > (options.maximumAcquisitions || 100)) return null;
      return {
        coordinationDigest: "a".repeat(64),
        coordinationScope: "NON_OVERLAP_COORDINATION_ONLY",
        async assertHeld() {
          calls.push("coordinator.assertHeld");
          if (options.assertHeld) return options.assertHeld({ calls, releaseCount });
          return held;
        },
        async release() {
          calls.push("coordinator.release");
          releaseCount += 1;
          held = false;
          if (options.releaseError) throw options.releaseError;
        },
      };
    },
  };
  return {
    calls,
    bridge,
    worker,
    coordinator,
    releaseCount: () => releaseCount,
  };
}

function foundation(options = {}) {
  const adapterSet = options.adapterSet || createAdapterSet(options);
  const env = options.env || ENABLED_ENV;
  return {
    adapterSet,
    module: createRuntimeOrchestrationCore({
      env,
      adapters: {
        bridge: adapterSet.bridge,
        worker: adapterSet.worker,
        coordinator: adapterSet.coordinator,
      },
      actualConnectionLimit: Object.prototype.hasOwnProperty.call(options, "actualConnectionLimit")
        ? options.actualConnectionLimit
        : 8,
    }),
  };
}

test("production construction has a narrow Interface and accepts no caller Adapter or factory", () => {
  const pool = { getConnection() {} };
  assert.doesNotThrow(() => createV1RuntimeOrchestrationFoundation({ pool }));
  assert.throws(
    () => createV1RuntimeOrchestrationFoundation({
      pool: { getConnection() {} },
      env: {},
      bridge: {},
    }),
    (error) => error && error.code === "V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeOrchestrationFoundation({
      pool: { getConnection() {} },
      env: {},
      factory() {},
    }),
    (error) => error && error.code === "V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID"
  );
});

test("production exports only the production Interface and no test constructor", () => {
  assert.deepEqual(Object.keys(productionExports), ["createV1RuntimeOrchestrationFoundation"]);
  assert.equal("createV1RuntimeOrchestrationFoundationForTest" in productionExports, false);
});

test("global execution is disabled by default and does not acquire coordination", async () => {
  const { module, adapterSet } = foundation({ env: {} });
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 10, workerLimit: 10, recoveryLimit: 5 }),
    "V1_RUNTIME_ORCHESTRATOR_DISABLED"
  );
  assert.equal(adapterSet.calls.some((item) => item.startsWith("coordinator.acquire")), false);
});

test("the kill switch is engaged unless the exact DISENGAGED value is present", async () => {
  const { module, adapterSet } = foundation({
    env: { ...ENABLED_ENV, MYROOT_V1_RUNTIME_KILL_SWITCH: "disengaged" },
  });
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 10, workerLimit: 10, recoveryLimit: 5 }),
    "V1_RUNTIME_ORCHESTRATOR_KILL_SWITCH_ENGAGED"
  );
  assert.equal(adapterSet.calls.some((item) => item.startsWith("coordinator.acquire")), false);
});

test("inspect aggregates named ownership, global control and manual-only exclusions", async () => {
  const { module } = foundation();
  const status = await module.inspect();
  assert.equal(status.enabled, true);
  assert.equal(status.killSwitch, "DISENGAGED");
  assert.equal(status.runtimeOwner, "runtime-owner-a");
  assert.deepEqual(status.ownedModules, ["OUTBOX_INBOX_BRIDGE", "INBOX_WORKER"]);
  assert.deepEqual(status.excludedModules, [
    { module: "INBOX_SHADOW_REPLAY", reasonCode: "GOVERNED_MANUAL_ONLY" },
    { module: "NOTIFICATION_PROVIDER_SEND", reasonCode: "NO_PROVIDER_SEND_INTERFACE" },
  ]);
  assert.equal(status.readiness.ready, true);
  assert.deepEqual(status.readiness.blockerCodes, []);
  assert.equal(Object.isFrozen(status), true);
  assert.equal(Object.isFrozen(status.alerts), true);
});

test("non-zero operational lag is visible as warnings without inventing a blocker", async () => {
  const { module } = foundation({
    bridgeSnapshot: bridgeSnapshot({ lag: { receipt: 3, claimed: 1 } }),
    workerSnapshot: workerSnapshot({
      receiptCount: 8,
      runnableScopeCount: 2,
      recoverableScopeCount: 1,
      statusCounts: {
        received: 2,
        retryPending: 1,
        claimed: 1,
        succeeded: 4,
        deadLetter: 0,
        reviewRequired: 0,
      },
    }),
  });
  const status = await module.inspect();
  assert.equal(status.readiness.ready, true);
  assert.deepEqual(status.lag, {
    bridgeReceipt: 3,
    bridgeClaimed: 1,
    workerRunnable: 2,
    workerRecoverable: 1,
  });
  assert.deepEqual(
    status.alerts.map((item) => [item.code, item.severity]),
    [
      ["BRIDGE_RECEIPT_LAG", "WARNING"],
      ["BRIDGE_CLAIMED_LAG", "WARNING"],
      ["WORKER_RUNNABLE_LAG", "WARNING"],
      ["WORKER_RECOVERABLE_LAG", "WARNING"],
    ]
  );
});

test("scope drift, checkpoint gaps and terminal review states fail readiness closed", async () => {
  const { module } = foundation({
    bridgeSnapshot: bridgeSnapshot({
      mismatch: {
        outboxScope: 1,
        inboxRegistration: 0,
        terminalWithoutReceipt: 1,
        unregisteredActive: 0,
        successorUnavailableActive: 0,
        outboxOpenDeadLetter: 0,
        deadLetterCompanion: 0,
      },
      readiness: { ready: false, reasonCode: "BRIDGE_SCOPE_REVIEW_REQUIRED" },
    }),
    workerSnapshot: workerSnapshot({
      receiptCount: 2,
      blockedGapScopeCount: 1,
      checkpointMissingReceiptCount: 1,
      registrationMismatchHeadCount: 1,
      statusCounts: {
        received: 0,
        retryPending: 0,
        claimed: 0,
        succeeded: 0,
        deadLetter: 1,
        reviewRequired: 1,
      },
    }),
  });
  const status = await module.inspect();
  assert.equal(status.readiness.ready, false);
  assert.deepEqual(status.readiness.blockerCodes, [
    "BRIDGE_SCOPE_REVIEW_REQUIRED",
    "BRIDGE_OUTBOX_SCOPE_MISMATCH",
    "BRIDGE_TERMINAL_WITHOUT_RECEIPT",
    "WORKER_BLOCKED_GAP",
    "WORKER_CHECKPOINT_MISSING",
    "WORKER_REGISTRATION_MISMATCH",
    "WORKER_DEAD_LETTER",
    "WORKER_REVIEW_REQUIRED",
  ]);
});

test("pre-existing OUTBOX dead letters and companion drift are orchestration blockers", async () => {
  const { module } = foundation({
    bridgeSnapshot: bridgeSnapshot({
      mismatch: {
        outboxScope: 0,
        inboxRegistration: 0,
        terminalWithoutReceipt: 0,
        unregisteredActive: 0,
        successorUnavailableActive: 0,
        outboxOpenDeadLetter: 2,
        deadLetterCompanion: 1,
      },
      readiness: { ready: false, reasonCode: "BRIDGE_SCOPE_REVIEW_REQUIRED" },
    }),
  });
  const status = await module.inspect();
  assert.deepEqual(status.readiness.blockerCodes, [
    "BRIDGE_SCOPE_REVIEW_REQUIRED",
    "BRIDGE_OUTBOX_OPEN_DEAD_LETTER",
    "BRIDGE_DEAD_LETTER_COMPANION_MISMATCH",
  ]);
});

test("missing Settlement successor is scope-local and does not starve a runnable cycle", async () => {
  const { module, adapterSet } = foundation({
    bridgeSnapshot: bridgeSnapshot({
      mismatch: {
        outboxScope: 0,
        inboxRegistration: 0,
        terminalWithoutReceipt: 0,
        unregisteredActive: 0,
        successorUnavailableActive: 1,
        outboxOpenDeadLetter: 0,
        deadLetterCompanion: 0,
      },
      readiness: { ready: true, reasonCode: "BRIDGE_SCOPE_READY" },
    }),
    workerSnapshot: workerSnapshot({
      receiptCount: 1,
      statusCounts: {
        received: 1, retryPending: 0, claimed: 0, succeeded: 0,
        deadLetter: 0, reviewRequired: 0,
      },
      successorUnavailableHeadCount: 1,
    }),
  });
  const status = await module.inspect();
  assert.equal(status.readiness.ready, true);
  assert.deepEqual(status.readiness.blockerCodes, []);
  assert.deepEqual(status.alerts.map(({ code, severity }) => [code, severity]), [
    ["BRIDGE_SUCCESSOR_UNAVAILABLE_ACTIVE", "WARNING"],
    ["WORKER_SUCCESSOR_UNAVAILABLE", "WARNING"],
  ]);

  const result = await module.runOneShot({ bridgeLimit: 2, workerLimit: 2, recoveryLimit: 1 });
  assert.equal(result.postflight.readiness.ready, true);
  assert.equal(adapterSet.calls.includes("bridge.run:2"), true);
  assert.equal(adapterSet.calls.includes("worker.run:2"), true);
});

test("missing owner and disabled child Modules fail readiness closed", async () => {
  const { module } = foundation({
    env: {
      MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED: "true",
      MYROOT_V1_RUNTIME_KILL_SWITCH: "DISENGAGED",
    },
    bridgeSnapshot: bridgeSnapshot({
      enabled: false,
      killSwitch: "CLOSED",
      readiness: { ready: false, reasonCode: "BRIDGE_DISABLED" },
    }),
  });
  const status = await module.inspect();
  assert.equal(status.runtimeOwner, "UNASSIGNED");
  assert.deepEqual(status.readiness.blockerCodes, [
    "RUNTIME_OWNER_UNASSIGNED",
    "RUNTIME_TARGET_IDENTITY_UNASSIGNED",
    "BRIDGE_DISABLED",
    "WORKER_DISABLED",
  ]);
});

test("a pool with fewer than three connections fails before acquiring coordination", async () => {
  for (const connectionLimit of [1, 2]) {
    const { module, adapterSet } = foundation({
      env: { ...ENABLED_ENV, MYSQL_CONNECTION_LIMIT: String(connectionLimit) },
      actualConnectionLimit: connectionLimit,
    });
    const status = await module.inspect();
    assert.deepEqual(status.readiness.blockerCodes, ["RUNTIME_POOL_CAPACITY_INSUFFICIENT"]);
    await expectCode(
      () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
      "V1_RUNTIME_ORCHESTRATOR_NOT_READY"
    );
    assert.equal(adapterSet.calls.some((item) => item.startsWith("coordinator.acquire")), false);
  }
});

test("enabled readiness rejects unprovable and mismatched actual pool capacity", async () => {
  const unverified = foundation({ actualConnectionLimit: null });
  assert.deepEqual(
    (await unverified.module.inspect()).readiness.blockerCodes,
    ["RUNTIME_POOL_CAPACITY_UNVERIFIED"]
  );
  await expectCode(
    () => unverified.module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    "V1_RUNTIME_ORCHESTRATOR_NOT_READY"
  );
  assert.equal(unverified.adapterSet.calls.some((item) => item.startsWith("coordinator.acquire")), false);

  const mismatched = foundation({ actualConnectionLimit: 4 });
  const status = await mismatched.module.inspect();
  assert.deepEqual(status.readiness.blockerCodes, ["RUNTIME_POOL_CAPACITY_MISMATCH"]);
  assert.deepEqual(status.poolCapacity, {
    configured: 8,
    actual: 4,
    verified: true,
    consistent: false,
  });
});

test("mysql2 PromisePool capacity is read from the underlying pool config", () => {
  assert.equal(mysqlPoolConnectionLimit({ pool: { config: { connectionLimit: 8 } } }), 8);
  assert.equal(mysqlPoolConnectionLimit({ config: { connectionLimit: 5 } }), 5);
  assert.equal(mysqlPoolConnectionLimit({ getConnection() {} }), null);
  assert.equal(mysqlPoolConnectionLimit({ pool: { config: { connectionLimit: "8" } } }), null);
});

test("enabled runtime requires an exact database and stable environment identity", async () => {
  for (const env of [
    { ...ENABLED_ENV, MYSQL_DATABASE: "" },
    { ...ENABLED_ENV, MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "" },
    { ...ENABLED_ENV, MYSQL_DATABASE: "db name with spaces" },
  ]) {
    const { module, adapterSet } = foundation({ env });
    const status = await module.inspect();
    assert.equal(status.readiness.blockerCodes.includes("RUNTIME_TARGET_IDENTITY_UNASSIGNED"), true);
    await expectCode(
      () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
      "V1_RUNTIME_ORCHESTRATOR_NOT_READY"
    );
    assert.equal(adapterSet.calls.some((item) => item.startsWith("coordinator.acquire")), false);
  }
});

test("coordination lock authority uses actual database and a fixed application scope", () => {
  const first = runtimeTargetIdentity(ENABLED_ENV);
  const same = runtimeTargetIdentity({ ...ENABLED_ENV });
  const otherDatabase = runtimeTargetIdentity({ ...ENABLED_ENV, MYSQL_DATABASE: "myroot_test_b" });
  const otherEnvironment = runtimeTargetIdentity({
    ...ENABLED_ENV,
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-environment-b",
  });
  assert.deepEqual(first, same);
  assert.equal(runtimeLockName(first.database), runtimeLockName(otherEnvironment.database));
  assert.notEqual(runtimeLockName(first.database), runtimeLockName(otherDatabase.database));
  assert.match(runtimeLockName(first.database), /^myroot:v1:runtime:[0-9a-f]{40}$/);
  assert.ok(Buffer.byteLength(runtimeLockName(first.database), "utf8") <= 64);
});

test("every target-bound child connection verifies actual database before business work", async () => {
  const calls = [];
  function connection(name, actualDatabase) {
    return {
      async execute(sql) {
        calls.push(`${name}:${sql}`);
        if (String(sql).includes("DATABASE()")) {
          return [[{ database_name: actualDatabase }], []];
        }
        return [[{ business: true }], []];
      },
      async beginTransaction() { calls.push(`${name}:BEGIN`); },
      release() { calls.push(`${name}:RELEASE`); },
      destroy() { calls.push(`${name}:DESTROY`); },
    };
  }
  const connections = [
    connection("bridge", "myroot_test_a"),
    connection("worker", "drifted_database"),
  ];
  const targetBoundPool = createTargetBoundMysqlPool({
    async getConnection() { return connections.shift(); },
  }, "myroot_test_a");
  assert.deepEqual(Object.keys(targetBoundPool), ["getConnection"]);

  const bridgeConnection = await targetBoundPool.getConnection();
  await bridgeConnection.execute("SELECT bridge_business_fact");
  bridgeConnection.release();
  await expectCode(
    () => targetBoundPool.getConnection(),
    "V1_RUNTIME_ORCHESTRATOR_TARGET_AUTHORITY_FAILED"
  );

  assert.deepEqual(calls, [
    "bridge:SELECT DATABASE() AS database_name",
    "bridge:SELECT bridge_business_fact",
    "bridge:RELEASE",
    "worker:SELECT DATABASE() AS database_name",
    "worker:DESTROY",
  ]);
  assert.equal(calls.some((item) => item === "worker:BEGIN"), false);
  assert.equal(calls.some((item) => item.includes("worker_business")), false);
});

test("production wiring gives Bridge, Worker and coordinator only the target-bound pool", () => {
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.match(source, /pool: targetBoundPool,[\s\S]*pool: targetBoundPool,/);
  assert.match(source, /createMysqlNamedLockCoordinator\(targetBoundPool,/);
  assert.doesNotMatch(source, /WeakMap|POOL_TARGET_AUTHORITIES|bindPoolTargetAuthority/);
});

test("GET_LOCK NULL is a coordination failure, never a busy result", async () => {
  let destroyed = 0;
  let released = 0;
  let requestedLockName = null;
  const connection = {
    async execute(sql, params) {
      if (sql.startsWith("SET SESSION")) return [[], []];
      if (sql.includes("DATABASE()")) return [[{ database_name: "myroot_test_a" }], []];
      if (sql.includes("GET_LOCK")) {
        requestedLockName = params[0];
        return [[{ acquired: null, connection_id: 91 }], []];
      }
      throw new Error("unexpected SQL");
    },
    release() { released += 1; },
    destroy() { destroyed += 1; },
  };
  const coordinator = createMysqlNamedLockCoordinator(
    { async getConnection() { return connection; } },
    "myroot_test_a"
  );
  await expectCode(
    () => coordinator.tryAcquire({ runtimeOwner: "runtime-owner-a", cycleId: "a".repeat(32) }),
    "V1_RUNTIME_ORCHESTRATOR_COORDINATION_FAILED"
  );
  assert.equal(released, 0);
  assert.equal(destroyed, 1);
  assert.equal(requestedLockName, runtimeLockName("myroot_test_a"));
});

test("actual MySQL database drift fails closed before lock inspection", async () => {
  let destroyed = 0;
  let released = 0;
  let lockInspections = 0;
  const connection = {
    async execute(sql) {
      if (sql.startsWith("SET SESSION")) return [[], []];
      if (sql.includes("DATABASE()")) return [[{ database_name: "myroot_actual" }], []];
      lockInspections += 1;
      throw new Error("lock inspection must not run");
    },
    release() { released += 1; },
    destroy() { destroyed += 1; },
  };
  const coordinator = createMysqlNamedLockCoordinator(
    { async getConnection() { return connection; } },
    "myroot_configured"
  );
  await expectCode(
    () => coordinator.inspect(),
    "V1_RUNTIME_ORCHESTRATOR_COORDINATION_FAILED"
  );
  assert.equal(lockInspections, 0);
  assert.equal(released, 0);
  assert.equal(destroyed, 1);
});

test("coordination inspection derives its lock only after actual database authority is verified", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params = []) {
      calls.push([String(sql), params]);
      if (String(sql).startsWith("SET SESSION")) return [[], []];
      if (String(sql).includes("DATABASE()")) {
        return [[{ database_name: "myroot_test_a" }], []];
      }
      if (String(sql).includes("IS_FREE_LOCK")) {
        return [[{ is_free: 1, connection_id: null }], []];
      }
      throw new Error("unexpected SQL");
    },
    release() { calls.push(["RELEASE", []]); },
    destroy() { calls.push(["DESTROY", []]); },
  };
  const coordinator = createMysqlNamedLockCoordinator(
    { async getConnection() { return connection; } },
    "myroot_test_a"
  );
  assert.deepEqual(await coordinator.inspect(), {
    ready: true,
    lockState: "FREE",
    coordinationScope: "NON_OVERLAP_COORDINATION_ONLY",
  });
  assert.equal(calls[1][0], "SELECT DATABASE() AS database_name");
  assert.deepEqual(calls[2][1], [
    runtimeLockName("myroot_test_a"),
    runtimeLockName("myroot_test_a"),
  ]);
  assert.equal(calls.some(([sql]) => sql === "DESTROY"), false);
  assert.equal(calls.some(([sql]) => sql === "RELEASE"), true);
});

test("inspection failures become explicit blockers instead of false green", async () => {
  const { module } = foundation({
    bridgeInspectError: new Error("db unavailable"),
    coordinatorInspectError: new Error("lock unavailable"),
  });
  const status = await module.inspect();
  assert.equal(status.readiness.ready, false);
  assert.deepEqual(status.readiness.blockerCodes, [
    "COORDINATION_INSPECTION_FAILED",
    "BRIDGE_INSPECTION_FAILED",
  ]);
  assert.equal(status.bridge.status, "UNAVAILABLE");
  assert.equal(status.coordination.status, "UNAVAILABLE");
});

test("a one-shot cycle has fixed phase order, non-overlap checks and a postflight inspection", async () => {
  const { module, adapterSet } = foundation();
  const result = await module.runOneShot({ bridgeLimit: 11, workerLimit: 12, recoveryLimit: 3 });
  assert.deepEqual(adapterSet.calls, [
    "coordinator.acquire:runtime-owner-a",
    "coordinator.assertHeld",
    "bridge.inspect",
    "worker.inspect",
    "coordinator.assertHeld",
    "coordinator.assertHeld",
    "bridge.recover:3",
    "coordinator.assertHeld",
    "coordinator.assertHeld",
    "bridge.run:11",
    "coordinator.assertHeld",
    "coordinator.assertHeld",
    "worker.recover:3",
    "coordinator.assertHeld",
    "coordinator.assertHeld",
    "worker.run:12",
    "coordinator.assertHeld",
    "coordinator.assertHeld",
    "bridge.inspect",
    "worker.inspect",
    "coordinator.assertHeld",
    "coordinator.release",
  ]);
  assert.equal(result.runtimeOwner, "runtime-owner-a");
  assert.match(result.cycleId, /^[0-9a-f]{32}$/);
  assert.equal(result.coordinationLeaseDigest, "a".repeat(64));
  assert.equal(result.coordinationScope, "NON_OVERLAP_COORDINATION_ONLY");
  assert.deepEqual(Object.keys(result.phases), [
    "bridgeRecovery",
    "bridgeDispatch",
    "workerRecovery",
    "workerExecution",
  ]);
  assert.equal(Object.isFrozen(result.phases), true);
  assert.equal(result.postflight.readiness.ready, true);
  assert.equal(Object.isFrozen(result.postflight), true);
  assert.equal(adapterSet.releaseCount(), 1);
});

test("strict one-shot input rejects defaults, extras and unsafe limits", async () => {
  const { module } = foundation();
  for (const input of [
    {},
    { bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1, extra: true },
    { bridgeLimit: 0, workerLimit: 1, recoveryLimit: 1 },
    { bridgeLimit: 1, workerLimit: 101, recoveryLimit: 1 },
    { bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1.5 },
  ]) {
    await expectCode(() => module.runOneShot(input), "V1_RUNTIME_ORCHESTRATOR_INPUT_INVALID");
  }
});

test("cross-instance coordination busy fails without running a phase", async () => {
  const { module, adapterSet } = foundation({ busy: true });
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    "V1_RUNTIME_ORCHESTRATOR_BUSY"
  );
  assert.deepEqual(adapterSet.calls, ["coordinator.acquire:runtime-owner-a"]);
});

test("coordination loss stops before the next phase and still attempts release", async () => {
  let checks = 0;
  const { module, adapterSet } = foundation({
    assertHeld() {
      checks += 1;
      return checks < 4;
    },
  });
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    "V1_RUNTIME_ORCHESTRATOR_COORDINATION_LOST"
  );
  assert.equal(adapterSet.calls.includes("bridge.run:1"), false);
  assert.equal(adapterSet.releaseCount(), 1);
});

test("a phase failure is localized, later phases do not run and coordination is released", async () => {
  const { module, adapterSet } = foundation({
    bridgeRun() { throw new Error("bridge failed"); },
  });
  await assert.rejects(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    (error) => error
      && error.code === "V1_RUNTIME_ORCHESTRATOR_PHASE_FAILED"
      && error.phase === "BRIDGE_DISPATCH"
  );
  assert.equal(adapterSet.calls.includes("worker.recover:1"), false);
  assert.equal(adapterSet.releaseCount(), 1);
});

test("impossible child counts are rejected as inspection or phase failures", async () => {
  const inspection = foundation({
    workerSnapshot: workerSnapshot({
      receiptCount: 1,
      statusCounts: {
        received: 0,
        retryPending: 0,
        claimed: 0,
        succeeded: 0,
        deadLetter: 0,
        reviewRequired: 0,
      },
    }),
  });
  const status = await inspection.module.inspect();
  assert.deepEqual(status.readiness.blockerCodes, ["WORKER_INSPECTION_FAILED"]);

  const execution = foundation({
    bridgeRun() {
      return {
        enabled: true,
        claimedCount: 2,
        inboxCreatedCount: 1,
        inboxReplayedCount: 0,
        outboxCompletedCount: 1,
        retryScheduledCount: 0,
        deadLetteredCount: 0,
      };
    },
  });
  await assert.rejects(
    () => execution.module.runOneShot({ bridgeLimit: 2, workerLimit: 1, recoveryLimit: 1 }),
    (error) => error
      && error.code === "V1_RUNTIME_ORCHESTRATOR_PHASE_FAILED"
      && error.phase === "BRIDGE_DISPATCH"
  );
  assert.equal(execution.adapterSet.calls.includes("worker.recover:1"), false);
});

test("a dead letter produced by this cycle returns REVIEW_REQUIRED and releases coordination", async () => {
  const { module, adapterSet } = foundation({
    bridgeRecover() {
      return { enabled: true, recoveredCount: 1, retryPendingCount: 0, deadLetteredCount: 1 };
    },
  });
  await assert.rejects(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    (error) => error
      && error.code === "V1_RUNTIME_ORCHESTRATOR_REVIEW_REQUIRED"
      && error.outcome === "REVIEW_REQUIRED"
      && error.cycleDeadLetterCount === 1
      && error.newWorkerTerminalCount === 0
  );
  assert.equal(adapterSet.releaseCount(), 1);
});

test("a new postflight terminal state returns REVIEW_REQUIRED with blockers", async () => {
  const postflightWorker = workerSnapshot({
    receiptCount: 1,
    statusCounts: {
      received: 0,
      retryPending: 0,
      claimed: 0,
      succeeded: 0,
      deadLetter: 1,
      reviewRequired: 0,
    },
  });
  const { module, adapterSet } = foundation({
    workerSnapshots: [workerSnapshot(), postflightWorker],
  });
  await assert.rejects(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    (error) => error
      && error.code === "V1_RUNTIME_ORCHESTRATOR_REVIEW_REQUIRED"
      && error.outcome === "REVIEW_REQUIRED"
      && error.newWorkerTerminalCount === 1
      && error.blockerCodes.includes("WORKER_DEAD_LETTER")
  );
  assert.equal(adapterSet.releaseCount(), 1);
});

test("a postflight inspection failure cannot report success", async () => {
  const { module, adapterSet } = foundation({
    bridgeSnapshots: [bridgeSnapshot(), {}],
  });
  await assert.rejects(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    (error) => error
      && error.code === "V1_RUNTIME_ORCHESTRATOR_REVIEW_REQUIRED"
      && error.outcome === "REVIEW_REQUIRED"
      && error.blockerCodes.includes("BRIDGE_INSPECTION_FAILED")
  );
  assert.equal(adapterSet.releaseCount(), 1);
});

test("release failure never reports a successful cycle", async () => {
  const { module } = foundation({ releaseError: new Error("release unknown") });
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    "V1_RUNTIME_ORCHESTRATOR_COORDINATION_RELEASE_FAILED"
  );
});

test("in-process overlap is rejected before a second acquisition", async () => {
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const adapterSet = createAdapterSet({
    async bridgeRecover() {
      await gate;
      return { enabled: true, recoveredCount: 0, retryPendingCount: 0, deadLetteredCount: 0 };
    },
  });
  const { module } = foundation({ adapterSet });
  const first = module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 });
  while (!adapterSet.calls.includes("bridge.recover:1")) await new Promise(setImmediate);
  await expectCode(
    () => module.runOneShot({ bridgeLimit: 1, workerLimit: 1, recoveryLimit: 1 }),
    "V1_RUNTIME_ORCHESTRATOR_BUSY"
  );
  assert.equal(adapterSet.calls.filter((item) => item.startsWith("coordinator.acquire")).length, 1);
  unblock();
  await first;
});

test("the source contains no timer, cron or provider-send loop", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/v1RuntimeOrchestrationFoundation.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /setInterval|setTimeout|node-cron|scheduleJob|provider\.send|sendMessage/);
  assert.match(source, /GET_LOCK/);
  assert.match(source, /IS_USED_LOCK/);
  assert.match(source, /RELEASE_LOCK/);
  assert.match(source, /NON_OVERLAP_COORDINATION_ONLY/);
  assert.doesNotMatch(source, /WRITE[_ -]?FENC|write[_ -]?fenc/i);
});
