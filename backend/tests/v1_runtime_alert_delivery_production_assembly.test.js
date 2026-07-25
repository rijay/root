const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createV1RuntimeAlertDeliveryProductionAssembly,
} = require("../src/v1RuntimeAlertDeliveryProductionAssembly");
const {
  createMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
} = require("../src/mysqlV1RuntimeAlertDeliveryAuthorityAdapter");

const DATABASE = "myroot_production_assembly_test";

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

function controlledEnv() {
  return {
    MYSQL_DATABASE: DATABASE,
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "production-assembly-test",
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
}

function rolePool(currentUser, counters) {
  return {
    async getConnection() {
      counters.acquired += 1;
      return {
        async execute(sql) {
          const compact = String(sql).replace(/\s+/g, " ").trim();
          if (compact.includes("connection_authority")) {
            return [[{ database_name: DATABASE, authenticated_account: currentUser }], []];
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
          if (compact.includes("v1_runtime_alert_delivery:lock_stale")) {
            return [[], []];
          }
          throw new Error(`unexpected SQL ${compact}`);
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() { counters.released += 1; },
        destroy() { counters.destroyed += 1; },
      };
    },
  };
}

function authorityPersistence(mode) {
  if (mode === "DISABLED") {
    return {
      adapter: createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
        env: {
          MYSQL_DATABASE: DATABASE,
          MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "production-assembly-test",
        },
      }),
      worker: { acquired: 0, released: 0, destroyed: 0 },
      inspector: { acquired: 0, released: 0, destroyed: 0 },
    };
  }
  const worker = { acquired: 0, released: 0, destroyed: 0 };
  const inspector = { acquired: 0, released: 0, destroyed: 0 };
  return {
    adapter: createMysqlV1RuntimeAlertDeliveryAuthorityAdapter({
      env: controlledEnv(),
      registrarCurrentUser: "myroot_runtime_registrar@%",
      workerCurrentUser: "myroot_runtime_worker@%",
      inspectorCurrentUser: "myroot_runtime_inspector@%",
      workerPool: rolePool("myroot_runtime_worker@%", worker),
      inspectorPool: rolePool("myroot_runtime_inspector@%", inspector),
    }),
    worker,
    inspector,
  };
}

test("production assembly is default-disabled and keeps both evidence gates OPEN", async () => {
  const store = authorityPersistence("DISABLED");
  const module = createV1RuntimeAlertDeliveryProductionAssembly({
    env: {},
    persistence: store.adapter,
  });
  assert.deepEqual(Object.keys(module), ["inspect", "recoverStale", "runDue"]);
  const inspection = await module.inspect();
  assert.equal(inspection.mode, "DISABLED");
  assert.equal(inspection.productionAssembly.databaseAuthorityAdapterReady, true);
  assert.equal(inspection.productionAssembly.providerAdapterReady, false);
  assert.equal(inspection.productionAssembly.runnerReady, true);
  assert.equal(inspection.productionAssembly.realReceiverEvidencePresent, false);
  assert.equal(inspection.gates.receiverEvidenceGate, "OPEN");
  assert.equal(inspection.gates.syntheticAcknowledgementGate, "OPEN");
  assert.doesNotMatch(JSON.stringify(inspection), /CLOSED/);
});

test("CONTROLLED without a Provider Adapter cannot claim or fake closure", async () => {
  const store = authorityPersistence("CONTROLLED");
  const module = createV1RuntimeAlertDeliveryProductionAssembly({
    env: controlledEnv(),
    persistence: store.adapter,
  });
  const inspection = await module.inspect();
  assert.equal(inspection.status, "V1_RUNTIME_ALERT_DELIVERY_PROVIDER_ADAPTER_UNAVAILABLE");
  assert.equal(inspection.productionAssembly.providerAdapterReady, false);
  assert.equal(inspection.productionAssembly.runnerReady, false);
  assert.equal(inspection.gates.receiverEvidenceGate, "OPEN");
  await assert.rejects(
    () => module.runDue({ leaseOwner: "must-not-claim", leaseSeconds: 60, limit: 1 }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_PROVIDER_ADAPTER_UNAVAILABLE" }
  );
  assert.equal(store.worker.acquired, 0);
  const recovery = await module.recoverStale({ limit: 10 });
  assert.equal(recovery.gates.syntheticAcknowledgementGate, "OPEN");
  assert.equal(store.worker.acquired, 1);
  assert.equal(store.inspector.acquired, 1);
});

test("production Interface rejects caller-injected Provider Adapters", () => {
  let deliverCalls = 0;
  assert.throws(
    () => createV1RuntimeAlertDeliveryProductionAssembly({
      env: { MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "CONTROLLED" },
      persistence: authorityPersistence("CONTROLLED").adapter,
      providerAdapter: {
        async deliver() { deliverCalls += 1; return { receipt: {} }; },
      },
    }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_PRODUCTION_ASSEMBLY_INVALID" }
  );
  assert.equal(deliverCalls, 0);
});

test("production Interface rejects unbranded persistence even when its shape is complete", () => {
  const unbranded = {
    mode: "DISABLED",
    registrationRequired: false,
    async claimNext() {},
    async completeDelivered() {},
    async failBeforeProvider() {},
    async inspect() {},
    async markProviderStarted() {},
    async markUnknown() {},
    async recoverStale() {},
  };
  assert.throws(
    () => createV1RuntimeAlertDeliveryProductionAssembly({
      env: {},
      persistence: unbranded,
    }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_PRODUCTION_ASSEMBLY_INVALID" }
  );
});

test("production assembly contains no concrete receiver or network implementation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/v1RuntimeAlertDeliveryProductionAssembly.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /\b(?:fetch|axios|https\.request|http\.request)\b/);
  assert.doesNotMatch(source, /RECEIVER_(?:ENDPOINT|SECRET)/);
});
