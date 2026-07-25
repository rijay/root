const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
  isMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
} = require("../src/mysqlV1RuntimeAlertDeliveryAuthorityAdapter");
const {
  createV1RuntimeAlertPayloadAdapter,
} = require("../src/v1RuntimeAlertPayloadAdapter");

const DATABASE = "myroot_authority_test";
const ENVIRONMENT = "runtime-alert-authority-test";
const REGISTRAR = "myroot_runtime_registrar@%";
const WORKER = "myroot_runtime_worker@%";
const INSPECTOR = "myroot_runtime_inspector@%";
const ALERT_ID = "a".repeat(64);

function env(mode = "CONTROLLED") {
  return {
    NODE_ENV: "test",
    MYSQL_DATABASE: DATABASE,
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: mode,
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
}

class ResultSetHeader {
  constructor() {
    this.fieldCount = 0;
    this.affectedRows = 0;
    this.insertId = 0;
    this.info = "";
    this.serverStatus = 2;
    this.warningStatus = 0;
  }
}

function inspectPool(currentUser, counters, overrides = {}) {
  return {
    async getConnection() {
      counters.acquired += 1;
      let destroyed = false;
      return {
        async execute(sql) {
          const compact = String(sql).replace(/\s+/g, " ").trim();
          if (compact.includes("connection_authority")) {
            return [[{
              database_name: overrides.database || DATABASE,
              authenticated_account: overrides.currentUser || currentUser,
            }], []];
          }
          if (compact === "SELECT DATABASE() AS database_name") {
            return [[{ database_name: DATABASE }], []];
          }
          if (compact === "SET time_zone = ?") return [[], []];
          if (compact === "SELECT @@session.time_zone AS session_time_zone") {
            return [[{ session_time_zone: "+08:00" }], []];
          }
          if (compact.includes("v1_runtime_alert_delivery:inspect")) {
            return [[[{ 
              total_count: 0,
              dry_run_recorded_count: 0,
              controlled_count: 0,
              authority_mismatch_count: 0,
              pending_count: 0,
              claimed_count: 0,
              retry_wait_count: 0,
              started_count: 0,
              delivered_count: 0,
              dead_letter_count: 0,
              unknown_count: 0,
              oldest_available_at: null,
              db_now: "2026-07-19 01:00:00.000",
            }], new ResultSetHeader()], []];
          }
          throw new Error(`unexpected SQL ${compact}`);
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() { counters.released += 1; },
        destroy() { destroyed = true; counters.destroyed += 1; },
        get destroyed() { return destroyed; },
      };
    },
  };
}

function registrationConnection(currentUser = REGISTRAR) {
  let row = null;
  const calls = [];
  return {
    calls,
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      calls.push(compact);
      if (compact.includes("connection_authority")) {
        return [[{ database_name: DATABASE, authenticated_account: currentUser }], []];
      }
      if (compact.includes("select_registration")) {
        return [row ? [{ ...row }] : [], []];
      }
      if (compact.includes("register_controlled")) {
        const outcome = row ? "REPLAY" : "REGISTERED";
        const binding = createV1RuntimeAlertPayloadAdapter(env()).binding;
        row = row || {
          runtime_alert_delivery_id: values[0],
          runtime_alert_id: values[1],
          environment_id: values[2],
          registration_mode: "CONTROLLED",
          receiver_binding_authority_version: binding.authorityVersion,
          receiver_binding_ref: binding.ref,
          receiver_binding_digest: binding.digest,
          receiver_binding_digest_scheme: binding.digestScheme,
          receiver_binding_digest_key_id: binding.keyId,
          payload_schema_version: "myroot.runtime-alert.delivery.v1",
          payload_canonical_version: "canonical-json:v1",
          payload_digest: values[3],
          payload_digest_scheme: "hmac-sha256:v1",
          payload_digest_key_id: values[4],
          slo_class: values[5],
          slo_target_seconds: values[6],
          retry_policy_version: "pre-provider-exponential:v1",
          maximum_attempts: values[7],
          status: "PENDING",
        };
        return [[[{ ...row, operation_outcome: outcome }], new ResultSetHeader()], []];
      }
      throw new Error(`unexpected SQL ${compact}`);
    },
    destroy() {},
  };
}

function controlled(overrides = {}) {
  const workerCounters = { acquired: 0, released: 0, destroyed: 0 };
  const inspectorCounters = { acquired: 0, released: 0, destroyed: 0 };
  const workerPool = inspectPool(WORKER, workerCounters);
  const inspectorPool = inspectPool(INSPECTOR, inspectorCounters);
  return {
    workerCounters,
    inspectorCounters,
    adapter: createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
      env: env(),
      registrarCurrentUser: REGISTRAR,
      workerCurrentUser: WORKER,
      inspectorCurrentUser: INSPECTOR,
      workerPool,
      inspectorPool,
      ...overrides,
    }),
  };
}

test("DISABLED is branded and opens no database pool seam", async () => {
  const adapter = createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  assert.equal(isMysqlV1RuntimeAlertDeliveryAuthorityAdapter(adapter), true);
  assert.equal(adapter.mode, "DISABLED");
  assert.equal((await adapter.inspect()).totalCount, 0);
  assert.equal(adapter.authority.registrarTransactionAuthorityRequired, false);
});

test("CONTROLLED rejects shared pools, shared principals, and incomplete role configuration", () => {
  const counters = { acquired: 0, released: 0, destroyed: 0 };
  const pool = inspectPool(WORKER, counters);
  assert.throws(() => createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
    env: env(),
    registrarCurrentUser: REGISTRAR,
    workerCurrentUser: WORKER,
    inspectorCurrentUser: INSPECTOR,
    workerPool: pool,
    inspectorPool: pool,
  }), { code: "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_CONFIGURATION_INVALID" });
  assert.throws(() => createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
    env: env(),
    registrarCurrentUser: REGISTRAR,
    workerCurrentUser: REGISTRAR,
    inspectorCurrentUser: INSPECTOR,
    workerPool: pool,
    inspectorPool: inspectPool(INSPECTOR, counters),
  }), { code: "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_CONFIGURATION_INVALID" });
  assert.equal(counters.acquired, 0);
});

test("registration uses only the caller Registrar transaction and verifies its authority first", async () => {
  const { adapter, workerCounters, inspectorCounters } = controlled();
  const connection = registrationConnection();
  const result = await adapter.registerAlertInTransaction(connection, {
    runtimeAlertId: ALERT_ID,
    environmentId: ENVIRONMENT,
    alertCode: "V1_RUNTIME_CYCLE_STALE",
    severity: "BLOCKER",
    observedAt: "2026-07-19T01:00:00.000Z",
  });
  assert.equal(result.outcome, "REGISTERED");
  assert.equal(connection.calls[0].includes("connection_authority"), true);
  assert.equal(workerCounters.acquired, 0);
  assert.equal(inspectorCounters.acquired, 0);
});

test("registration rejects a non-Registrar transaction before any business read or CALL", async () => {
  const { adapter } = controlled();
  const connection = registrationConnection(WORKER);
  await assert.rejects(
    () => adapter.registerAlertInTransaction(connection, {
      runtimeAlertId: ALERT_ID,
      environmentId: ENVIRONMENT,
      alertCode: "V1_RUNTIME_CYCLE_STALE",
      severity: "BLOCKER",
      observedAt: "2026-07-19T01:00:00.000Z",
    }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_MISMATCH" }
  );
  assert.equal(connection.calls.length, 1);
});

test("inspect uses only the Inspector pool and returns no principal material", async () => {
  const { adapter, workerCounters, inspectorCounters } = controlled();
  const result = await adapter.inspect();
  assert.equal(result.totalCount, 0);
  assert.equal(inspectorCounters.acquired, 1);
  assert.equal(inspectorCounters.released, 1);
  assert.equal(workerCounters.acquired, 0);
  assert.doesNotMatch(JSON.stringify(result), /myroot_runtime_(?:worker|inspector|registrar)/);
});

test("role drift destroys the connection and never falls back to another pool", async () => {
  const workerCounters = { acquired: 0, released: 0, destroyed: 0 };
  const inspectorCounters = { acquired: 0, released: 0, destroyed: 0 };
  const adapter = createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
    env: env(),
    registrarCurrentUser: REGISTRAR,
    workerCurrentUser: WORKER,
    inspectorCurrentUser: INSPECTOR,
    workerPool: inspectPool(WORKER, workerCounters),
    inspectorPool: inspectPool(INSPECTOR, inspectorCounters, { currentUser: WORKER }),
  });
  await assert.rejects(
    () => adapter.inspect(),
    { code: "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_MISMATCH" }
  );
  assert.equal(inspectorCounters.acquired, 1);
  assert.equal(inspectorCounters.destroyed, 1);
  assert.equal(workerCounters.acquired, 0);
});

test("driver errors are replaced with stable authority errors without secret material", async () => {
  const secret = "mysql://runtime:secret@private-host/myroot";
  const adapter = createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
    env: env(),
    registrarCurrentUser: REGISTRAR,
    workerCurrentUser: WORKER,
    inspectorCurrentUser: INSPECTOR,
    workerPool: { async getConnection() { throw new Error(secret); } },
    inspectorPool: { async getConnection() { throw new Error(secret); } },
  });
  let captured;
  try { await adapter.inspect(); } catch (error) { captured = error; }
  assert.equal(captured.code, "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_PROBE_FAILED");
  assert.doesNotMatch(`${captured.message}\n${JSON.stringify(captured)}`, /private-host|secret/);
});
