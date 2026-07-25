const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const sourcePath = path.join(__dirname, "../src/v1RuntimeControlPlaneFoundation.js");
const productionExports = require(sourcePath);
const { createV1RuntimeControlPlane } = productionExports;

function loadInternalTestSeam() {
  const source = fs.readFileSync(sourcePath, "utf8").replace(
    "const LEASE_HEARTBEAT_INTERVAL_MILLISECONDS = 30_000;",
    "const LEASE_HEARTBEAT_INTERVAL_MILLISECONDS = 5;"
  );
  const testModule = new Module(sourcePath, module);
  testModule.filename = sourcePath;
  testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  testModule._compile(`${source}\nmodule.exports = { createV1RuntimeControlPlaneCore, runtimeControlScopeId };\n`, sourcePath);
  return testModule.exports;
}

const { createV1RuntimeControlPlaneCore, runtimeControlScopeId } = loadInternalTestSeam();
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const CYCLE_ID = "c".repeat(64);
const SCHEDULED_AT = "2026-07-17T08:00:00.000Z";
const COMPLETED_AT = "2026-07-17T08:00:01.000Z";
const ENABLED_ENV = Object.freeze({
  MYSQL_HOST: "mysql.internal",
  MYSQL_PORT: "3306",
  MYSQL_USERNAME: "myroot_runtime",
  MYSQL_DATABASE: "myroot_test",
  K_REVISION: "myroot-api-00001-test",
  MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS: "180",
  MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED: "true",
  MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-environment-a",
  MYROOT_V1_RUNTIME_KILL_SWITCH: "DISENGAGED",
  MYROOT_V1_RUNTIME_OWNER: "runtime-owner-a",
  MYROOT_V1_RUNTIME_TARGET_GENERATION: "test-generation-a",
  MYROOT_V1_MAIN_CONNECTION_LIMIT: "8",
  MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "3",
  MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT: "1",
  MYROOT_CLOUDRUN_MAX_INSTANCES: "2",
  MYSQL_SERVER_MAX_CONNECTIONS: "100",
  MYROOT_MYSQL_CONNECTION_HEADROOM: "20",
  MYROOT_MYSQL_CAPACITY_EVIDENCE_REF: "candidate-capacity-proof-a",
  ROOT_CLOUDBASE_ENV_ID: "cloudbase-test-a",
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "command-request-secret-material-0001",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "command-request-key-a",
  ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-secret-material-0001",
  ROOT_COMMAND_RESULT_KEY_ID: "command-result-key-a",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "inbox-content-secret-material-0001",
  ROOT_INBOX_CONTENT_KEY_ID: "inbox-content-key-a",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY:
    "notification-receipt-secret-material-0001",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "notification-receipt-key-a",
  ROOT_V1_RUNTIME_READY_REQUIRED: "true",
  ROOT_RELEASE_ID: "v1.0.0-test-a",
});
const CONTROL_SCOPE_ID = runtimeControlScopeId(ENABLED_ENV);

function scheduleInput(overrides = {}) {
  return {
    bridgeLimit: 20,
    recoveryLimit: 10,
    scheduleId: "runtime-20260717T080000000Z",
    scheduledAt: SCHEDULED_AT,
    workerLimit: 20,
    ...overrides,
  };
}

function keyReport(overrides = {}) {
  return {
    ready: true,
    status: "KEY_INVENTORY_READY",
    schema: { ready: true, status: "KEY_INVENTORY_SCHEMA_READY" },
    issues: [],
    ...overrides,
  };
}

function runtimeInspection(overrides = {}) {
  return {
    readiness: { ready: true, blockerCodes: [] },
    ...overrides,
  };
}

function ledgerInspection(overrides = {}) {
  return {
    environmentId: CONTROL_SCOPE_ID,
    databaseName: "myroot_test",
    inspectedAt: COMPLETED_AT,
    maximumAgeSeconds: 180,
    attestation: {
      state: "SAFE",
      cycleId: CYCLE_ID,
      completedAt: COMPLETED_AT,
      ageSeconds: 0,
      latestTerminalCycleId: CYCLE_ID,
      latestTerminalStatus: "SUCCEEDED",
      latestTerminalCompletedAt: COMPLETED_AT,
    },
    openAlerts: {
      totalCount: 0,
      blockerCount: 0,
      warningCount: 0,
      latestObservedAt: null,
    },
    reviewRequiredCount: 0,
    ...overrides,
  };
}

function runningClaim(overrides = {}) {
  return {
    outcome: "CLAIMED",
    cycleId: CYCLE_ID,
    environmentId: CONTROL_SCOPE_ID,
    scheduleId: "runtime-20260717T080000000Z",
    scheduledAt: SCHEDULED_AT,
    inputDigest: overrides.inputDigest || DIGEST_A,
    status: "RUNNING",
    leaseOwner: "cp-owner-a",
    leaseExpiresAt: "2026-07-17T08:02:00.000Z",
    leaseGeneration: 1,
    claimedAt: SCHEDULED_AT,
    completedAt: null,
    resultDigest: null,
    blockerCount: 0,
    errorCode: null,
    ...overrides,
  };
}

function terminalCycle(status = "SUCCEEDED", overrides = {}) {
  return {
    cycleId: CYCLE_ID,
    environmentId: CONTROL_SCOPE_ID,
    scheduleId: "runtime-20260717T080000000Z",
    scheduledAt: SCHEDULED_AT,
    inputDigest: DIGEST_A,
    status,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseGeneration: 1,
    claimedAt: SCHEDULED_AT,
    completedAt: COMPLETED_AT,
    resultDigest: DIGEST_B,
    blockerCount: status === "SUCCEEDED" ? 0 : 1,
    errorCode: status === "SUCCEEDED" ? null : "DEPENDENCY_NOT_READY",
    ...overrides,
  };
}

function adapterSet(options = {}) {
  const calls = [];
  const environmentId = options.controlScopeId || CONTROL_SCOPE_ID;
  let claim;
  let renewCount = 0;
  const ledger = {
    async inspect(input) {
      calls.push(["ledger.inspect", input]);
      return options.ledgerInspection || ledgerInspection({ environmentId });
    },
    async claimCycle(input) {
      calls.push(["ledger.claimCycle", input]);
      claim = options.claim
        ? {
          ...options.claim,
          inputDigest: input.inputDigest,
          scheduleId: input.scheduleId,
          scheduledAt: input.scheduledAt,
        }
        : runningClaim({
          environmentId,
          inputDigest: input.inputDigest,
          scheduleId: input.scheduleId,
          scheduledAt: input.scheduledAt,
          leaseOwner: input.leaseOwner,
        });
      return claim;
    },
    async renewCycle(input) {
      calls.push(["ledger.renewCycle", input]);
      assert.deepEqual(Object.keys(input).sort(), [
        "cycleId", "leaseGeneration", "leaseOwner", "leaseSeconds",
      ].sort());
      renewCount += 1;
      if (options.renewErrorAt === renewCount) throw new Error("private renewal failure");
      assert.equal(input.cycleId, claim.cycleId);
      assert.equal(input.leaseOwner, claim.leaseOwner);
      assert.equal(input.leaseGeneration, claim.leaseGeneration);
      assert.equal(input.leaseSeconds, 120);
      claim = runningClaim({
        environmentId,
        inputDigest: claim.inputDigest,
        scheduleId: claim.scheduleId,
        scheduledAt: claim.scheduledAt,
        leaseOwner: claim.leaseOwner,
        leaseGeneration: claim.leaseGeneration + 1,
        leaseExpiresAt: "2026-07-17T08:04:00.000Z",
      });
      const { outcome, ...renewed } = claim;
      return renewed;
    },
    async finalizeCycle(input) {
      calls.push(["ledger.finalizeCycle", input]);
      if (options.finalizeError) throw options.finalizeError;
      if (input.status === "SKIPPED_BUSY" && input.blockerCount !== 0) {
        const error = new Error("real ledger shape rejected");
        error.code = "V1_RUNTIME_LEDGER_INPUT_INVALID";
        throw error;
      }
      assert.equal(input.leaseGeneration, claim.leaseGeneration);
      return terminalCycle(input.status, {
        environmentId,
        inputDigest: claim.inputDigest,
        scheduleId: claim.scheduleId,
        scheduledAt: claim.scheduledAt,
        resultDigest: input.resultDigest,
        blockerCount: input.blockerCount,
        errorCode: input.errorCode,
        leaseGeneration: input.leaseGeneration,
      });
    },
    async recordAlert(input) {
      calls.push(["ledger.recordAlert", input]);
      if (options.recordAlertError) throw options.recordAlertError;
      return {
        outcome: "RECORDED",
        alertId: "d".repeat(64),
        cycleId: input.cycleId,
        environmentId,
        scheduleId: claim.scheduleId,
        inputDigest: claim.inputDigest,
        alertCode: input.alertCode,
        severity: input.severity,
        observedAt: COMPLETED_AT,
      };
    },
    async recoverStale(input) {
      calls.push(["ledger.recoverStale", input]);
      return {
        environmentId,
        reviewRequiredCount: 0,
        cycleIds: [],
        alertCount: 0,
      };
    },
  };
  const keyInventory = {
    async inspect() {
      calls.push(["key.inspect"]);
      return options.keyInspection || keyReport();
    },
    async verify() {
      calls.push(["key.verify"]);
      if (options.keyVerifyHook) await options.keyVerifyHook();
      if (options.keyVerifyError) throw options.keyVerifyError;
      return options.keyVerification || keyReport();
    },
  };
  const runtime = {
    async inspect() {
      calls.push(["runtime.inspect"]);
      return options.runtimeInspection || runtimeInspection();
    },
    async runOneShot(input) {
      calls.push(["runtime.runOneShot", input]);
      if (options.runtimeRunHook) await options.runtimeRunHook();
      if (options.runtimeError) throw options.runtimeError;
      return options.runtimeResult || { status: "SUCCEEDED", processedCount: 0 };
    },
  };
  return { calls, ledger, keyInventory, runtime };
}

function foundation(options = {}) {
  const env = options.env || ENABLED_ENV;
  const adapters = options.adapters || adapterSet({
    ...options,
    controlScopeId: env.MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED === "true"
      ? runtimeControlScopeId(env)
      : CONTROL_SCOPE_ID,
  });
  return {
    adapters,
    module: createV1RuntimeControlPlaneCore({
      env,
      adapters,
      instanceId: "instance-a",
    }),
  };
}

function callNames(calls) { return calls.map(([name]) => name); }

test("production exports only the narrow production Interface", () => {
  assert.deepEqual(Object.keys(productionExports), ["createV1RuntimeControlPlane"]);
  assert.equal("createV1RuntimeControlPlaneCore" in productionExports, false);
  const controlPlane = createV1RuntimeControlPlane({
    pool: { getConnection() {} },
    env: {
      MYSQL_DATABASE: "myroot_test",
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-environment-a",
    },
  });
  assert.deepEqual(Object.keys(controlPlane), [
    "inspect",
    "previewScheduledCycle",
    "runScheduledCycle",
  ]);
  assert.equal(Object.isFrozen(controlPlane), true);
  assert.throws(
    () => createV1RuntimeControlPlane({
      pool: { getConnection() {} },
      env: ENABLED_ENV,
      ledger: {},
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
});

test("enabled alert delivery requires distinct orchestration, Registrar, Worker, and Inspector pools", () => {
  const alertEnv = {
    MYSQL_DATABASE: "myroot_test",
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-environment-a",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "CONTROLLED",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "sre-primary-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT:
      "https://receiver.example.invalid/runtime-alerts",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET:
      "receiver-secret-material-2026-07-never-persist",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-07",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-07",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY:
      "receipt-digest-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID: "runtime-alert-receipt-2026-07",
  };
  const pool = () => ({ getConnection() {} });
  const options = {
    env: alertEnv,
    orchestrationPool: pool(),
    registrarPool: pool(),
    registrarHeartbeatPool: pool(),
    runtimeAlertWorkerPool: pool(),
    runtimeAlertInspectorPool: pool(),
    runtimeAlertRegistrarCurrentUser: "myroot_runtime_registrar@%",
    runtimeAlertWorkerCurrentUser: "myroot_runtime_worker@%",
    runtimeAlertInspectorCurrentUser: "myroot_runtime_inspector@%",
  };
  const module = createV1RuntimeControlPlane(options);
  assert.deepEqual(Object.keys(module), [
    "inspect",
    "previewScheduledCycle",
    "runScheduledCycle",
  ]);
  assert.throws(
    () => createV1RuntimeControlPlane({
      pool: pool(),
      env: alertEnv,
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlane({
      ...options,
      runtimeAlertInspectorPool: options.runtimeAlertWorkerPool,
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
});

test("disabled control plane is non-required by default and performs no persistence read", async () => {
  const adapters = adapterSet();
  const module = createV1RuntimeControlPlaneCore({ env: {}, adapters, instanceId: "instance-a" });
  const inspection = await module.inspect();
  assert.equal(inspection.enabled, false);
  assert.equal(inspection.required, false);
  assert.equal(inspection.ready, true);
  assert.equal(inspection.status, "V1_RUNTIME_CONTROL_PLANE_NOT_REQUIRED");
  assert.deepEqual(adapters.calls, []);
});

test("required but disabled control plane fails readiness without querying runtime adapters", async () => {
  const adapters = adapterSet();
  const module = createV1RuntimeControlPlaneCore({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    adapters,
    instanceId: "instance-a",
  });
  const inspection = await module.inspect();
  assert.equal(inspection.ready, false);
  assert.equal(inspection.status, "V1_RUNTIME_CONTROL_PLANE_REQUIRED_BUT_DISABLED");
  assert.deepEqual(adapters.calls, []);
});

test("inspect reads only the durable ledger attestation and maps readiness states", async () => {
  const { module, adapters } = foundation();
  const inspection = await module.inspect();
  assert.equal(inspection.ready, true);
  assert.equal(inspection.status, "V1_RUNTIME_CONTROL_PLANE_READY");
  assert.deepEqual(callNames(adapters.calls), ["ledger.inspect"]);
  assert.deepEqual(adapters.calls[0][1], { maximumAgeSeconds: 180 });

  const blocked = foundation({
    ledgerInspection: ledgerInspection({
      attestation: {
        state: "BLOCKED",
        cycleId: CYCLE_ID,
        completedAt: COMPLETED_AT,
        ageSeconds: 1,
        latestTerminalCycleId: "d".repeat(64),
        latestTerminalStatus: "FAILED_PRECONDITION",
        latestTerminalCompletedAt: "2026-07-17T08:00:02.000Z",
      },
      openAlerts: {
        totalCount: 1,
        blockerCount: 1,
        warningCount: 0,
        latestObservedAt: COMPLETED_AT,
      },
    }),
  });
  assert.equal((await blocked.module.inspect()).status, "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_BLOCKED");
});

test("a fresh attestation from another release or configuration scope is rejected", async () => {
  const oldScopeId = runtimeControlScopeId({
    ...ENABLED_ENV,
    ROOT_RELEASE_ID: "v0.5.13-old-release",
  });
  assert.notEqual(oldScopeId, CONTROL_SCOPE_ID);
  const { module } = foundation({
    ledgerInspection: ledgerInspection({ environmentId: oldScopeId }),
  });
  await assert.rejects(
    () => module.inspect(),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_PERSISTENCE_FAILED"
  );
});

test("scope identity changes with deployment, database target, capacity, platform generation, and key configuration", () => {
  const variants = [
    { K_REVISION: "myroot-api-00002-test" },
    { ROOT_RELEASE_ARTIFACT_DIGEST: "e".repeat(64) },
    { MYSQL_HOST: "mysql-replacement.internal" },
    { MYSQL_PORT: "3307" },
    { MYSQL_USERNAME: "myroot_runtime_next" },
    { ROOT_CLOUDBASE_ENV_ID: "cloudbase-test-b" },
    { MYROOT_V1_RUNTIME_TARGET_GENERATION: "test-generation-b" },
    { MYROOT_V1_MAIN_CONNECTION_LIMIT: "9" },
    { MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "4" },
    { MYROOT_CLOUDRUN_MAX_INSTANCES: "3" },
    { MYSQL_SERVER_MAX_CONNECTIONS: "101" },
    { MYROOT_MYSQL_CONNECTION_HEADROOM: "21" },
    { MYROOT_MYSQL_CAPACITY_EVIDENCE_REF: "candidate-capacity-proof-b" },
    { ROOT_COMMAND_REQUEST_DIGEST_KEY: "command-request-secret-material-0002" },
    { ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({ "command-request-previous-a": "previous-request-secret-material-0001" }) },
    { ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-secret-material-0002" },
    { ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: JSON.stringify({ "command-result-previous-a": "previous-result-secret-material-0001" }) },
    { ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "inbox-content-secret-material-0002" },
    { ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: JSON.stringify({ "inbox-previous-a": "previous-secret-material-0001" }) },
    { ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY: "notification-receipt-secret-material-0002" },
    { ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "notification-receipt-key-b" },
    { ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({ REQUEST_DIGEST: [], COMMAND_RESULT: ["command-old-a"], INBOX_CONTENT: [], NOTIFICATION_RECEIPT: [] }) },
  ];
  for (const variant of variants) {
    assert.notEqual(runtimeControlScopeId({ ...ENABLED_ENV, ...variant }), CONTROL_SCOPE_ID);
  }
  assert.doesNotThrow(() => runtimeControlScopeId({
    ...ENABLED_ENV,
    K_REVISION: "",
    ROOT_RELEASE_ARTIFACT_DIGEST: "f".repeat(64),
  }));
});

test("fresh warning and busy evidence stay ready without being represented as success", async () => {
  for (const [state, status] of [
    ["WARNING", "V1_RUNTIME_CONTROL_PLANE_READY_WITH_WARNING"],
    ["BUSY", "V1_RUNTIME_CONTROL_PLANE_READY_BUSY"],
  ]) {
    const { module } = foundation({
      ledgerInspection: ledgerInspection({
        attestation: {
          state,
          cycleId: CYCLE_ID,
          completedAt: COMPLETED_AT,
          ageSeconds: 10,
          latestTerminalCycleId: "d".repeat(64),
          latestTerminalStatus: "SKIPPED_BUSY",
          latestTerminalCompletedAt: "2026-07-17T08:00:02.000Z",
        },
        openAlerts: {
          totalCount: 1,
          blockerCount: 0,
          warningCount: 1,
          latestObservedAt: "2026-07-17T08:00:02.000Z",
        },
      }),
    });
    const result = await module.inspect();
    assert.equal(result.ready, true);
    assert.equal(result.status, status);
    assert.equal(result.attestation.state, state);
    assert.equal(result.attestation.cycleId, CYCLE_ID, "proof must remain the last success");
    assert.equal(result.attestation.latestTerminalStatus, "SKIPPED_BUSY");
  }
});

test("kill switch keeps readiness closed even with a fresh safe attestation", async () => {
  const { module } = foundation({
    env: { ...ENABLED_ENV, MYROOT_V1_RUNTIME_KILL_SWITCH: "ENGAGED" },
  });
  const inspection = await module.inspect();
  assert.equal(inspection.ready, false);
  assert.equal(inspection.status, "V1_RUNTIME_CONTROL_PLANE_KILL_SWITCH_ENGAGED");
});

test("preview is read-only and checks Key Inventory before runtime readiness", async () => {
  const { module, adapters } = foundation();
  const preview = await module.previewScheduledCycle(scheduleInput());
  assert.equal(preview.ready, true);
  assert.match(preview.inputDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(callNames(adapters.calls), ["key.inspect", "runtime.inspect"]);
  assert.equal(callNames(adapters.calls).some((name) => name.startsWith("ledger.")), false);
});

test("successful cycle recovers stale work, claims once, verifies keys, runs, and finalizes", async () => {
  const { module, adapters } = foundation();
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.replayed, false);
  assert.deepEqual(callNames(adapters.calls), [
    "ledger.recoverStale",
    "ledger.claimCycle",
    "ledger.renewCycle",
    "key.verify",
    "runtime.runOneShot",
    "ledger.finalizeCycle",
  ]);
  assert.deepEqual(adapters.calls[4][1], {
    bridgeLimit: 20,
    workerLimit: 20,
    recoveryLimit: 10,
  });
  assert.equal(adapters.calls[5][1].status, "SUCCEEDED");
  assert.equal(adapters.calls[5][1].leaseGeneration, 2);
});

test("fixed heartbeat renews across slow Key verification and runtime, then finalizes with latest fence", async () => {
  const delay = () => new Promise((resolve) => setTimeout(resolve, 14));
  const { module, adapters } = foundation({ keyVerifyHook: delay, runtimeRunHook: delay });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "SUCCEEDED");
  const renewCalls = adapters.calls.filter(([name]) => name === "ledger.renewCycle");
  assert.ok(renewCalls.length >= 3, "immediate plus periodic heartbeats must cover both long operations");
  for (const [, input] of renewCalls) {
    assert.equal(input.leaseSeconds, 120, "lease duration cannot be caller or environment controlled");
  }
  const finalization = adapters.calls.find(([name]) => name === "ledger.finalizeCycle")[1];
  assert.equal(finalization.leaseGeneration, 1 + renewCalls.length);
});

test("heartbeat failure leaves the cycle RUNNING for stale recovery and cannot report success", async () => {
  const { module, adapters } = foundation({
    keyVerifyHook: () => new Promise((resolve) => setTimeout(resolve, 14)),
    renewErrorAt: 2,
  });
  await assert.rejects(
    () => module.runScheduledCycle(scheduleInput()),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_LEASE_HEARTBEAT_FAILED"
      && !error.message.includes("private renewal failure")
  );
  const names = callNames(adapters.calls);
  assert.equal(names.filter((name) => name === "ledger.renewCycle").length, 2);
  assert.equal(names.includes("runtime.runOneShot"), false);
  assert.equal(names.includes("ledger.finalizeCycle"), false);
  assert.equal(names.includes("ledger.recordAlert"), false);
});

test("initial renewal failure stops before Key verification and leaves the claim recoverable", async () => {
  const { module, adapters } = foundation({ renewErrorAt: 1 });
  await assert.rejects(
    () => module.runScheduledCycle(scheduleInput()),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_LEASE_HEARTBEAT_FAILED"
  );
  assert.deepEqual(callNames(adapters.calls), [
    "ledger.recoverStale",
    "ledger.claimCycle",
    "ledger.renewCycle",
  ]);
});

test("durable terminal replay never verifies keys or reruns runtime", async () => {
  const replay = { outcome: "REPLAY", ...terminalCycle("SUCCEEDED") };
  const { module, adapters } = foundation({ claim: replay });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.replayed, true);
  assert.deepEqual(callNames(adapters.calls), ["ledger.recoverStale", "ledger.claimCycle"]);
});

test("in-flight replay reports RUNNING and never creates a second execution", async () => {
  const replay = runningClaim({ outcome: "REPLAY" });
  const { module, adapters } = foundation({ claim: replay });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "RUNNING");
  assert.equal(result.replayed, true);
  assert.deepEqual(callNames(adapters.calls), ["ledger.recoverStale", "ledger.claimCycle"]);
});

test("failed terminal replay idempotently repairs alert evidence without rerunning", async () => {
  const replay = {
    outcome: "REPLAY",
    ...terminalCycle("FAILED_PRECONDITION", {
      errorCode: "DEPENDENCY_NOT_READY",
      blockerCount: 1,
    }),
  };
  const { module, adapters } = foundation({ claim: replay });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "FAILED_PRECONDITION");
  assert.equal(result.replayed, true);
  assert.deepEqual(callNames(adapters.calls), [
    "ledger.recoverStale",
    "ledger.claimCycle",
    "ledger.recordAlert",
  ]);
  assert.deepEqual(adapters.calls[2][1], {
    cycleId: CYCLE_ID,
    alertCode: "DEPENDENCY_NOT_READY",
    severity: "BLOCKER",
  });
});

test("Key Inventory failure finalizes before alerting and never enters runtime", async () => {
  const { module, adapters } = foundation({ keyVerifyError: new Error("secret database text") });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "FAILED_PRECONDITION");
  assert.equal(result.errorCode, "KEY_INVENTORY_VERIFICATION_FAILED");
  assert.deepEqual(callNames(adapters.calls), [
    "ledger.recoverStale",
    "ledger.claimCycle",
    "ledger.renewCycle",
    "key.verify",
    "ledger.finalizeCycle",
    "ledger.recordAlert",
  ]);
  assert.equal(callNames(adapters.calls).includes("runtime.runOneShot"), false);
  assert.equal(adapters.calls[5][1].severity, "BLOCKER");
});

test("busy runtime is a warning terminal while unknown failures require review", async () => {
  const busyError = Object.assign(new Error("busy"), { code: "V1_RUNTIME_ORCHESTRATOR_BUSY" });
  const busy = foundation({ runtimeError: busyError });
  const skipped = await busy.module.runScheduledCycle(scheduleInput());
  assert.equal(skipped.status, "SKIPPED_BUSY");
  assert.equal(skipped.blockerCount, 0);
  assert.equal(busy.adapters.calls.at(-1)[1].severity, "WARNING");

  const unknown = foundation({ runtimeError: Object.assign(new Error("private detail"), { code: "UNKNOWN_FAILURE" }) });
  const review = await unknown.module.runScheduledCycle(scheduleInput());
  assert.equal(review.status, "REVIEW_REQUIRED");
  assert.equal(review.errorCode, "UNKNOWN_FAILURE");
  assert.equal(unknown.adapters.calls.at(-1)[1].severity, "BLOCKER");
});

test("precondition runtime errors do not become ambiguous review results", async () => {
  const error = Object.assign(new Error("not ready"), {
    code: "V1_RUNTIME_ORCHESTRATOR_NOT_READY",
    blockerCodes: ["BRIDGE_NOT_READY"],
  });
  const { module } = foundation({ runtimeError: error });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "FAILED_PRECONDITION");
  assert.equal(result.errorCode, "V1_RUNTIME_ORCHESTRATOR_NOT_READY");
  assert.equal(result.blockerCount, 1);
});

test("control-plane kill switch creates durable blocker evidence before any Key scan", async () => {
  const { module, adapters } = foundation({
    env: { ...ENABLED_ENV, MYROOT_V1_RUNTIME_KILL_SWITCH: "ENGAGED" },
  });
  const result = await module.runScheduledCycle(scheduleInput());
  assert.equal(result.status, "FAILED_PRECONDITION");
  assert.equal(result.errorCode, "V1_RUNTIME_CONTROL_PLANE_KILL_SWITCH_ENGAGED");
  assert.deepEqual(callNames(adapters.calls), [
    "ledger.recoverStale",
    "ledger.claimCycle",
    "ledger.finalizeCycle",
    "ledger.recordAlert",
  ]);
});

test("disabled execution and exact canonical schedule validation fail before writes", async () => {
  const adapters = adapterSet();
  const disabled = createV1RuntimeControlPlaneCore({ env: {}, adapters, instanceId: "instance-a" });
  await assert.rejects(
    () => disabled.runScheduledCycle(scheduleInput()),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_DISABLED"
  );
  await assert.rejects(
    () => disabled.previewScheduledCycle({ ...scheduleInput(), freeText: "do-not-echo" }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_INPUT_INVALID"
      && !error.message.includes("do-not-echo")
  );
  await assert.rejects(
    () => disabled.previewScheduledCycle(scheduleInput({ scheduledAt: "2026-07-17T08:00:00Z" })),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_INPUT_INVALID"
  );
  assert.deepEqual(adapters.calls, []);
});

test("invalid flags and Adapter drift fail closed at construction", () => {
  const adapters = adapterSet();
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ...ENABLED_ENV, ROOT_RELEASE_ID: "" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ...ENABLED_ENV, MYROOT_V1_RUNTIME_TARGET_GENERATION: "" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ...ENABLED_ENV, K_REVISION: "", ROOT_RELEASE_ARTIFACT_DIGEST: "" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ...ENABLED_ENV, ROOT_RELEASE_ARTIFACT_DIGEST: "ABC123" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ...ENABLED_ENV, MYSQL_SERVER_MAX_CONNECTIONS: "43" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: { ROOT_V1_RUNTIME_READY_REQUIRED: "yes" },
      adapters,
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createV1RuntimeControlPlaneCore({
      env: ENABLED_ENV,
      adapters: { ...adapters, ledger: { ...adapters.ledger, clearAlerts() {} } },
      instanceId: "instance-a",
    }),
    (error) => error.code === "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID"
  );
});
