const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createMemoryStore, createMysqlStore } = require("../src/store");

const SCHEDULE = Object.freeze({
  bridgeLimit: 10,
  recoveryLimit: 8,
  scheduleId: "cloudbase-v1-runtime-20260717T030000000Z",
  scheduledAt: "2026-07-17T03:00:00.000Z",
  workerLimit: 12,
});

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

function runtimeStatus(ready = true) {
  return {
    contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
    enabled: true,
    required: false,
    ready,
    status: ready
      ? "V1_RUNTIME_CONTROL_PLANE_READY"
      : "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_STALE",
    killSwitch: "DISENGAGED",
    attestation: {
      state: ready ? "SAFE" : "STALE",
      cycleId: "1".repeat(64),
      completedAt: "2026-07-17T03:00:00.000Z",
      ageSeconds: ready ? 5 : 600,
      latestTerminalCycleId: "1".repeat(64),
      latestTerminalStatus: "SUCCEEDED",
      latestTerminalCompletedAt: "2026-07-17T03:00:00.000Z",
      internalDatabaseName: "must-not-leak",
    },
    openAlerts: {
      totalCount: 0,
      blockerCount: 0,
      warningCount: 0,
      latestObservedAt: null,
      secret: "must-not-leak",
    },
    reviewRequiredCount: 0,
    internalPool: "must-not-leak",
  };
}

function createControlPlane(state, ready = true) {
  return {
    async inspect() {
      state.inspectCalls += 1;
      return runtimeStatus(ready);
    },
    async previewScheduledCycle(schedule) {
      state.previewCalls += 1;
      state.previewSchedule = schedule;
      return {
        contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
        enabled: true,
        ready: true,
        status: "V1_RUNTIME_SCHEDULE_READY",
        scheduleId: schedule.scheduleId,
        inputDigest: "a".repeat(64),
        keyInventory: {
          ready: true,
          status: "KEY_INVENTORY_READY",
          schemaStatus: "KEY_INVENTORY_SCHEMA_READY",
          issueCount: 0,
        },
        runtime: { ready: true, blockerCodes: [] },
        secret: "must-not-leak",
      };
    },
    async runScheduledCycle(schedule) {
      state.runCalls += 1;
      state.runSchedule = schedule;
      return {
        contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
        scheduleId: schedule.scheduleId,
        cycleId: "b".repeat(64),
        status: "SUCCEEDED",
        replayed: false,
        inputDigest: "a".repeat(64),
        resultDigest: "c".repeat(64),
        blockerCount: 0,
        errorCode: null,
        completedAt: "2026-07-17T03:00:01.000Z",
        secret: "must-not-leak",
      };
    },
  };
}

function createHttpStore(controlPlane, transactionState) {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  const store = {
    ...base,
    async runRequest(_options, work) {
      transactionState.calls += 1;
      return work(store.data, {});
    },
  };
  Object.defineProperty(store, "v1RuntimeControlPlane", {
    value: controlPlane,
    enumerable: false,
  });
  return store;
}

function jobEnvironment(extra = {}) {
  return {
    ROOT_ADMIN_TOKENS: JSON.stringify({
      job: { token: "job-token", role: "job" },
      operator: { token: "operator-token", role: "operator" },
      viewer: { token: "viewer-token", role: "viewer" },
    }),
    ...extra,
  };
}

function fakeMysqlRuntime(options = {}) {
  const state = {
    calls: [],
    payload: "",
    mainPool: null,
    runtimePool: null,
    heartbeatPool: null,
    authorityPools: [],
    poolOptions: [],
    createPoolCalls: 0,
    controlOptions: null,
    readinessInspectCalls: 0,
    readinessOptions: null,
  };
  const connection = {
    async beginTransaction() { state.calls.push("BEGIN"); },
    async commit() { state.calls.push("COMMIT"); },
    async rollback() { state.calls.push("ROLLBACK"); },
    async execute(sql, params = []) {
      if (sql.includes("INSERT IGNORE INTO root_store_snapshot")) {
        if (options.failSnapshotInsert) throw new Error("synthetic snapshot insert failure");
        state.payload = params[2];
        state.calls.push("SNAPSHOT_INSERT");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT payload_json")) {
        state.calls.push(sql.includes("FOR UPDATE") ? "SNAPSHOT_LOCK" : "SNAPSHOT_READ");
        return [[{ payload_json: state.payload, updated_at: "2026-07-17 03:00:00.000", revision: 0 }]];
      }
      throw new Error(`unexpected execute: ${sql}`);
    },
    async query(sql) {
      if (sql === "SELECT 1 AS ok") return [[{ ok: 1 }], []];
      if (sql.includes("COUNT(*) AS migration_count")) {
        return [[{
          migration_count: 65,
          latest_version: "065_v1_runtime_alert_registration_return_row.sql",
        }], []];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    release() { state.calls.push("RELEASE"); },
  };
  const mainPool = {
    async getConnection() {
      state.calls.push("GET_CONNECTION");
      return connection;
    },
    async execute(sql) {
      if (!sql.includes("SELECT payload_json")) throw new Error(`unexpected pool execute: ${sql}`);
      state.calls.push("POOL_SNAPSHOT_READ");
      return [[{ payload_json: state.payload, updated_at: "2026-07-17 03:00:00.000", revision: 0 }]];
    },
    async end() { state.calls.push("MAIN_POOL_END"); },
  };
  const runtimePool = {
    config: { connectionLimit: 3 },
    async getConnection() {
      throw new Error("runtime pool must remain behind the injected control Interface");
    },
    async end() { state.calls.push("RUNTIME_POOL_END"); },
  };
  const heartbeatPool = {
    config: { connectionLimit: 1 },
    async getConnection() {
      throw new Error("heartbeat pool must remain behind the injected control Interface");
    },
    async end() { state.calls.push("HEARTBEAT_POOL_END"); },
  };
  state.mainPool = mainPool;
  state.runtimePool = runtimePool;
  state.heartbeatPool = heartbeatPool;
  const hiddenImplementation = {
    pool: runtimePool,
    inspect: async () => runtimeStatus(true),
    previewScheduledCycle: async () => ({}),
    runScheduledCycle: async () => ({}),
    secretMethod() {},
  };
  return {
    state,
    commandRequestDigestCodec: {
      assertReady() {},
      getStatus() { return { ready: true }; },
    },
    commandResultCodec: {
      assertReady() {},
      getStatus() { return { ready: true, enabled: true }; },
    },
    dependencies: {
      mysql: {
        createPool(poolConfig) {
          state.createPoolCalls += 1;
          state.poolOptions.push(poolConfig);
          if (state.createPoolCalls === 1) return mainPool;
          if (state.createPoolCalls === 2) return runtimePool;
          if (options.authorityPools) {
            const poolIndex = state.createPoolCalls;
            const authorityPool = {
              config: { connectionLimit: poolConfig.connectionLimit },
              async getConnection() {
                throw new Error("authority pool must remain behind the injected control Interface");
              },
              async end() { state.calls.push(`AUTHORITY_POOL_${poolIndex}_END`); },
            };
            state.authorityPools.push(authorityPool);
            return authorityPool;
          }
          return heartbeatPool;
        },
      },
      async readMysqlPrivilegePolicy() {
        state.calls.push("PRIVILEGE");
        return { ready: true, scope: "TEST", enforced: true };
      },
      assertMysqlPrivilegePolicy() {},
      async applyMysqlMigrations() {
        state.calls.push("MIGRATIONS");
        return { latestVersion: "033", versions: ["033"] };
      },
      changedCollectionKeys() { return new Set(); },
      async syncCoreProjections() {
        state.calls.push("PROJECTION");
        return { tables: [], rows: {} };
      },
      createMysqlEventTransportAdapter() { return {}; },
      createMysqlCommandIdempotencyAdapter() { return {}; },
      createMysqlCommandRecovery() { return {}; },
      createV1RuntimeControlPlane(options) {
        state.calls.push("CONTROL_PLANE");
        state.controlOptions = options;
        return hiddenImplementation;
      },
      createMysqlRuntimePrincipalReadiness(options) {
        state.readinessOptions = options;
        const initial = Object.freeze({
          enabled: true,
          ready: false,
          requiredRoleCount: 3,
          verifiedRoleCount: 0,
          requiredRoutineCount: 21,
          verifiedRoutineCount: 0,
          issueCount: 3,
        });
        return Object.freeze({
          getStatus() { return initial; },
          async inspect() {
            state.readinessInspectCalls += 1;
            return Object.freeze({
              enabled: true,
              ready: true,
              requiredRoleCount: 3,
              verifiedRoleCount: 3,
              requiredRoutineCount: 21,
              verifiedRoutineCount: 21,
              issueCount: 0,
            });
          },
        });
      },
      async readMysqlPrivilegePolicyFromConnection() {
        return { ready: true, scope: "TEST", enforced: true };
      },
    },
  };
}

test("MySQL Store constructs the control plane after migrations and exposes only its narrow Interface", async () => {
  const runtime = fakeMysqlRuntime();
  const store = await createMysqlStore({
    host: "isolated.test",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_control_http_test",
  }, {
    env: { NODE_ENV: "test", MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-control-http" },
    commandRequestDigestCodec: runtime.commandRequestDigestCodec,
    commandResultCodec: runtime.commandResultCodec,
    dependencies: runtime.dependencies,
  });
  assert.ok(runtime.state.calls.indexOf("MIGRATIONS") < runtime.state.calls.indexOf("CONTROL_PLANE"));
  assert.equal(runtime.state.createPoolCalls, 3);
  assert.equal(runtime.state.controlOptions.pool, runtime.state.runtimePool);
  assert.notEqual(runtime.state.controlOptions.pool, runtime.state.mainPool);
  assert.equal(runtime.state.controlOptions.heartbeatPool, runtime.state.heartbeatPool);
  assert.equal(runtime.state.poolOptions[0].connectionLimit, 8);
  assert.equal(runtime.state.poolOptions[1].connectionLimit, 3);
  assert.equal(runtime.state.poolOptions[2].connectionLimit, 1);
  assert.equal(runtime.state.controlOptions.env.MYSQL_DATABASE, "root_control_http_test");
  assert.equal(runtime.state.controlOptions.env.MYSQL_HOST, "isolated.test");
  assert.equal(runtime.state.controlOptions.env.MYSQL_PORT, "3306");
  assert.equal(runtime.state.controlOptions.env.MYSQL_USERNAME, "root_test");
  assert.equal(runtime.state.controlOptions.env.MYSQL_CONNECTION_LIMIT, "3");
  assert.equal(runtime.state.controlOptions.env.MYROOT_V1_MAIN_CONNECTION_LIMIT, "8");
  assert.equal(runtime.state.controlOptions.env.MYROOT_V1_RUNTIME_CONNECTION_LIMIT, "3");
  assert.equal(runtime.state.controlOptions.env.MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT, "1");
  assert.deepEqual(
    Object.keys(store.v1RuntimeControlPlane).sort(),
    ["inspect", "previewScheduledCycle", "runScheduledCycle"]
  );
  assert.equal(Object.isFrozen(store.v1RuntimeControlPlane), true);
  assert.equal(Object.prototype.hasOwnProperty.call(store.v1RuntimeControlPlane, "pool"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store.v1RuntimeControlPlane, "secretMethod"), false);
  assert.equal(Object.keys(store).includes("v1RuntimeControlPlane"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store, "pool"), false);

  await store.close();
  assert.equal(runtime.state.calls.includes("HEARTBEAT_POOL_END"), true);
  assert.equal(runtime.state.calls.includes("RUNTIME_POOL_END"), true);
  assert.equal(runtime.state.calls.includes("MAIN_POOL_END"), true);
});

test("MySQL Store uses distinct Registrar, Worker, and Inspector credentials when alert delivery is enabled", async () => {
  const runtime = fakeMysqlRuntime({ authorityPools: true });
  const env = {
    NODE_ENV: "test",
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-control-http",
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
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME: "registrar-user",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD: "registrar-test-password",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER: "registrar-user@%",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT: "2",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME: "worker-user",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD: "worker-test-password",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER: "worker-user@%",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT: "3",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_USERNAME: "inspector-user",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD: "inspector-test-password",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER: "inspector-user@%",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT: "1",
  };
  const store = await createMysqlStore({
    host: "isolated.test",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_control_http_test",
  }, {
    env,
    commandRequestDigestCodec: runtime.commandRequestDigestCodec,
    commandResultCodec: runtime.commandResultCodec,
    dependencies: runtime.dependencies,
  });
  assert.equal(runtime.state.createPoolCalls, 6);
  assert.equal(runtime.state.controlOptions.orchestrationPool, runtime.state.runtimePool);
  assert.equal(runtime.state.controlOptions.registrarPool, runtime.state.authorityPools[0]);
  assert.equal(runtime.state.controlOptions.registrarHeartbeatPool, runtime.state.authorityPools[1]);
  assert.equal(runtime.state.controlOptions.runtimeAlertInspectorPool, runtime.state.authorityPools[2]);
  assert.equal(runtime.state.controlOptions.runtimeAlertWorkerPool, runtime.state.authorityPools[3]);
  assert.equal(runtime.state.controlOptions.runtimeAlertRegistrarCurrentUser, "registrar-user@%");
  assert.equal(runtime.state.controlOptions.runtimeAlertWorkerCurrentUser, "worker-user@%");
  assert.equal(runtime.state.controlOptions.runtimeAlertInspectorCurrentUser, "inspector-user@%");
  assert.equal(runtime.state.readinessOptions.registrarPool, runtime.state.authorityPools[0]);
  assert.equal(runtime.state.readinessOptions.inspectorPool, runtime.state.authorityPools[2]);
  assert.equal(runtime.state.readinessOptions.workerPool, runtime.state.authorityPools[3]);
  assert.equal(runtime.state.readinessOptions.registrarCurrentUser, "registrar-user@%");
  assert.equal(runtime.state.readinessOptions.workerCurrentUser, "worker-user@%");
  assert.equal(runtime.state.readinessOptions.inspectorCurrentUser, "inspector-user@%");
  assert.deepEqual(
    runtime.state.poolOptions.slice(2).map((item) => item.connectionLimit),
    [2, 1, 1, 3]
  );
  assert.equal(Object.prototype.hasOwnProperty.call(runtime.state.controlOptions, "pool"), false);
  assert.equal(JSON.stringify(runtime.state.controlOptions).includes("test-password"), false);
  const health = await store.checkHealth();
  assert.equal(health.runtimeAlertDeliveryEnabled, true);
  assert.equal(health.runtimePrincipalReady, true);
  assert.equal(health.runtimePrincipalRequiredRoleCount, 3);
  assert.equal(health.runtimePrincipalVerifiedRoleCount, 3);
  assert.equal(health.runtimePrincipalRequiredRoutineCount, 21);
  assert.equal(health.runtimePrincipalVerifiedRoutineCount, 21);
  assert.equal(health.runtimePrincipalIssueCount, 0);
  assert.equal(runtime.state.readinessInspectCalls, 1);
  assert.doesNotMatch(JSON.stringify(health), /registrar-user|worker-user|inspector-user|GRANT/);
  await store.close();
  assert.equal(runtime.state.calls.filter((call) => /AUTHORITY_POOL_\d+_END/.test(call)).length, 4);
});

test("MySQL Store construction failure closes main, runtime, and heartbeat pools", async () => {
  const runtime = fakeMysqlRuntime({ failSnapshotInsert: true });
  await assert.rejects(
    () => createMysqlStore({
      host: "isolated.test",
      port: 3306,
      user: "root_test",
      password: "test-only",
      database: "root_control_http_test",
    }, {
      env: { NODE_ENV: "test", MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "test-control-http" },
      commandRequestDigestCodec: runtime.commandRequestDigestCodec,
      commandResultCodec: runtime.commandResultCodec,
      dependencies: runtime.dependencies,
    }),
    /synthetic snapshot insert failure/
  );
  assert.equal(runtime.state.calls.includes("HEARTBEAT_POOL_END"), true);
  assert.equal(runtime.state.calls.includes("RUNTIME_POOL_END"), true);
  assert.equal(runtime.state.calls.includes("MAIN_POOL_END"), true);
});

test("ready reads only the control ledger attestation and gates it only when required", async (t) => {
  const optionalState = { inspectCalls: 0, previewCalls: 0, runCalls: 0 };
  const optionalTransactions = { calls: 0 };
  const optionalServer = createApp({
    env: {},
    storeAdapter: createHttpStore(createControlPlane(optionalState, false), optionalTransactions),
  });
  const optionalUrl = await listen(optionalServer);
  t.after(() => closeServer(optionalServer));
  const optionalBaseline = optionalTransactions.calls;
  const optional = await request(optionalUrl, "/ready");

  assert.equal(optional.status, 200);
  assert.equal(optional.body.data.v1Runtime.ready, false);
  assert.equal(optional.body.data.v1Runtime.required, false);
  assert.equal(optional.body.data.v1Runtime.internalPool, undefined);
  assert.equal(optional.body.data.v1Runtime.attestation.internalDatabaseName, undefined);
  assert.equal(optional.body.data.v1Runtime.attestation.latestTerminalStatus, "SUCCEEDED");
  assert.equal(optionalState.inspectCalls, 1);
  assert.equal(optionalState.previewCalls, 0);
  assert.equal(optionalState.runCalls, 0);
  assert.equal(optionalTransactions.calls, optionalBaseline);

  const requiredState = { inspectCalls: 0, previewCalls: 0, runCalls: 0 };
  const requiredServer = createApp({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    storeAdapter: createHttpStore(createControlPlane(requiredState, false), { calls: 0 }),
  });
  const requiredUrl = await listen(requiredServer);
  t.after(() => closeServer(requiredServer));
  const required = await request(requiredUrl, "/ready");

  assert.equal(required.status, 503);
  assert.equal(required.body.code, 50305);
  assert.equal(required.body.data.v1Runtime.required, true);
  assert.equal(required.body.data.v1Runtime.ready, false);
  assert.equal(requiredState.inspectCalls, 1);
  assert.equal(requiredState.previewCalls, 0);
  assert.equal(requiredState.runCalls, 0);

  const warningServer = createApp({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    v1RuntimeControlPlane: {
      async inspect() {
        return {
          ...runtimeStatus(true),
          status: "V1_RUNTIME_CONTROL_PLANE_READY_WITH_WARNING",
          attestation: { ...runtimeStatus(true).attestation, state: "WARNING" },
          openAlerts: {
            totalCount: 1,
            blockerCount: 0,
            warningCount: 1,
            latestObservedAt: "2026-07-17T03:00:01.000Z",
          },
        };
      },
      async previewScheduledCycle() {},
      async runScheduledCycle() {},
    },
  });
  const warningUrl = await listen(warningServer);
  t.after(() => closeServer(warningServer));
  const warning = await request(warningUrl, "/ready");
  assert.equal(warning.status, 200);
  assert.equal(warning.body.data.v1Runtime.ready, true);
  assert.equal(warning.body.data.v1Runtime.status, "V1_RUNTIME_CONTROL_PLANE_READY_WITH_WARNING");
});

test("runtime cycle job enforces CONFIG_WRITE, strict input, dry-run default, execution request id and transaction bypass", async (t) => {
  const storeState = { inspectCalls: 0, previewCalls: 0, runCalls: 0 };
  const explicitState = { inspectCalls: 0, previewCalls: 0, runCalls: 0 };
  const transactions = { calls: 0 };
  const server = createApp({
    env: jobEnvironment(),
    storeAdapter: createHttpStore(createControlPlane(storeState), transactions),
    v1RuntimeControlPlane: createControlPlane(explicitState),
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));
  const baselineTransactions = transactions.calls;

  const unauthorized = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    body: JSON.stringify(SCHEDULE),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.code, 40101);

  const forbidden = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "viewer-token" },
    body: JSON.stringify(SCHEDULE),
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 40301);

  const operatorPreview = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "operator-token" },
    body: JSON.stringify(SCHEDULE),
  });
  assert.equal(operatorPreview.status, 200);
  assert.equal(explicitState.previewCalls, 1);

  const operatorExecution = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: {
      "X-Admin-Token": "operator-token",
      "X-Request-Id": SCHEDULE.scheduleId,
    },
    body: JSON.stringify({ ...SCHEDULE, execute: true }),
  });
  assert.equal(operatorExecution.status, 403);
  assert.equal(operatorExecution.body.code, 40301);
  assert.equal(explicitState.runCalls, 0);

  const unknown = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "job-token" },
    body: JSON.stringify({ ...SCHEDULE, unexpected: true }),
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 40051);

  const conflicting = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "job-token" },
    body: JSON.stringify({ ...SCHEDULE, execute: true, dryRun: true }),
  });
  assert.equal(conflicting.status, 400);
  assert.equal(conflicting.body.code, 40051);

  const preview = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "job-token" },
    body: JSON.stringify(SCHEDULE),
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.code, 0);
  assert.equal(preview.body.data.dryRun, true);
  assert.equal(preview.body.data.secret, undefined);
  assert.deepEqual(explicitState.previewSchedule, SCHEDULE);
  assert.equal(explicitState.previewCalls, 2);
  assert.equal(explicitState.runCalls, 0);
  assert.equal(storeState.previewCalls, 0);

  const missingRequestId = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-Admin-Token": "job-token" },
    body: JSON.stringify({ ...SCHEDULE, execute: true }),
  });
  assert.equal(missingRequestId.status, 400);
  assert.equal(missingRequestId.body.code, 40051);

  const execution = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: {
      "X-Admin-Token": "job-token",
      "X-Request-Id": "cloudbase-v1-runtime-20260717T030000000Z",
    },
    body: JSON.stringify({ ...SCHEDULE, execute: true }),
  });
  assert.equal(execution.status, 200);
  assert.equal(execution.body.code, 0);
  assert.equal(execution.body.data.dryRun, false);
  assert.equal(execution.body.data.status, "SUCCEEDED");
  assert.equal(execution.body.data.secret, undefined);
  assert.deepEqual(explicitState.runSchedule, SCHEDULE);
  assert.equal(explicitState.runCalls, 1);

  const mismatchedIdentity = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: {
      "X-Admin-Token": "job-token",
      "X-Request-Id": "different-request-id",
    },
    body: JSON.stringify({ ...SCHEDULE, execute: true }),
  });
  assert.equal(mismatchedIdentity.status, 400);
  assert.equal(mismatchedIdentity.body.code, 40051);
  assert.equal(explicitState.runCalls, 1);

  const mismatchedBodyIdentity = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: {
      "X-Admin-Token": "job-token",
      "X-Request-Id": SCHEDULE.scheduleId,
    },
    body: JSON.stringify({
      ...SCHEDULE,
      execute: true,
      requestId: "different-body-request-id",
    }),
  });
  assert.equal(mismatchedBodyIdentity.status, 400);
  assert.equal(mismatchedBodyIdentity.body.code, 40051);
  assert.equal(explicitState.runCalls, 1);

  assert.equal(transactions.calls, baselineTransactions);

  await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "job-token" },
  });
  assert.equal(transactions.calls, baselineTransactions + 1);
});

test("required readiness fails closed when the control plane Interface is absent or inspection fails", async (t) => {
  const absentServer = createApp({ env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" } });
  const absentUrl = await listen(absentServer);
  t.after(() => closeServer(absentServer));
  const absent = await request(absentUrl, "/ready");
  assert.equal(absent.status, 503);
  assert.equal(absent.body.data.v1Runtime.status, "V1_RUNTIME_CONTROL_PLANE_REQUIRED_BUT_UNAVAILABLE");

  const failingServer = createApp({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    v1RuntimeControlPlane: {
      async inspect() { throw new Error("sensitive database failure"); },
      async previewScheduledCycle() {},
      async runScheduledCycle() {},
    },
  });
  const failingUrl = await listen(failingServer);
  t.after(() => closeServer(failingServer));
  const failing = await request(failingUrl, "/ready");
  assert.equal(failing.status, 503);
  assert.equal(failing.body.data.v1Runtime.status, "V1_RUNTIME_CONTROL_PLANE_INSPECTION_FAILED");
  assert.equal(JSON.stringify(failing.body).includes("sensitive database failure"), false);

  const blockedWithoutProofServer = createApp({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    v1RuntimeControlPlane: {
      async inspect() {
        return {
          contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
          enabled: true,
          required: true,
          ready: false,
          status: "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_BLOCKED",
          killSwitch: "DISENGAGED",
          attestation: {
            state: "BLOCKED",
            cycleId: null,
            completedAt: null,
            ageSeconds: null,
            latestTerminalCycleId: "2".repeat(64),
            latestTerminalStatus: "FAILED_PRECONDITION",
            latestTerminalCompletedAt: "2026-07-17T03:00:00.000Z",
          },
          openAlerts: {
            totalCount: 0,
            blockerCount: 0,
            warningCount: 0,
            latestObservedAt: null,
          },
          reviewRequiredCount: 0,
        };
      },
      async previewScheduledCycle() {},
      async runScheduledCycle() {},
    },
  });
  const blockedWithoutProofUrl = await listen(blockedWithoutProofServer);
  t.after(() => closeServer(blockedWithoutProofServer));
  const blockedWithoutProof = await request(blockedWithoutProofUrl, "/ready");
  assert.equal(blockedWithoutProof.status, 503);
  assert.equal(
    blockedWithoutProof.body.data.v1Runtime.status,
    "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_BLOCKED"
  );
  assert.equal(
    blockedWithoutProof.body.data.v1Runtime.attestation.latestTerminalStatus,
    "FAILED_PRECONDITION"
  );

  const malformedServer = createApp({
    env: { ROOT_V1_RUNTIME_READY_REQUIRED: "true" },
    v1RuntimeControlPlane: {
      async inspect() {
        return {
          contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
          enabled: true,
          ready: true,
          status: "V1_RUNTIME_CONTROL_PLANE_READY",
          killSwitch: "DISENGAGED",
          attestation: {
            state: "SAFE",
            cycleId: "1".repeat(64),
            completedAt: "2026-07-17T03:00:00.000Z",
            ageSeconds: 1,
            latestTerminalCycleId: "1".repeat(64),
            latestTerminalStatus: "SUCCEEDED",
            latestTerminalCompletedAt: "2026-07-17T03:00:00.000Z",
          },
          // A missing alert ledger summary cannot assert readiness.
          reviewRequiredCount: 0,
        };
      },
      async previewScheduledCycle() {},
      async runScheduledCycle() {},
    },
  });
  const malformedUrl = await listen(malformedServer);
  t.after(() => closeServer(malformedServer));
  const malformed = await request(malformedUrl, "/ready");
  assert.equal(malformed.status, 503);
  assert.equal(malformed.body.data.v1Runtime.ready, false);
  assert.equal(malformed.body.data.v1Runtime.status, "V1_RUNTIME_CONTROL_PLANE_INSPECTION_INVALID");
});
