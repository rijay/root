const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createMysqlV1RuntimeAlertDeliveryAdapter,
} = require("../src/mysqlV1RuntimeAlertDeliveryAdapter");
const {
  RUNTIME_ALERT_DELIVERY_SLO_BY_SEVERITY,
  runtimeAlertDeliverySloForSeverity,
} = require("../src/v1RuntimeAlertDeliveryPolicy");
const {
  createV1RuntimeAlertPayloadAdapter,
} = require("../src/v1RuntimeAlertPayloadAdapter");

const DATABASE = "myroot_test";
const ENVIRONMENT = "runtime-alert-test";
const ALERT_ID = "a".repeat(64);
const ENDPOINT = "https://receiver.example.invalid/runtime-alerts?opaque=1";
const RECEIVER_SECRET = "receiver-secret-material-2026-07-never-persist";
const PERSON_NAME = "Private Receiver Person";

function env(overrides = {}) {
  return {
    NODE_ENV: "test",
    MYSQL_DATABASE: DATABASE,
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "CONTROLLED",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MAXIMUM_ATTEMPTS: "3",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_BACKOFF_SECONDS: "10",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "sre-primary-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: ENDPOINT,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET: RECEIVER_SECRET,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_PERSON_NAME: PERSON_NAME,
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-07",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-07",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY:
      "receipt-digest-secret-material-2026-07-distinct",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID: "runtime-alert-receipt-2026-07",
    ...overrides,
  };
}

function alert(overrides = {}) {
  return {
    runtimeAlertId: ALERT_ID,
    environmentId: ENVIRONMENT,
    alertCode: "V1_RUNTIME_CYCLE_STALE",
    severity: "BLOCKER",
    observedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

test("runtime alert SLO policy is exact, immutable, and shared by delivery callers", () => {
  assert.ok(Object.isFrozen(RUNTIME_ALERT_DELIVERY_SLO_BY_SEVERITY));
  assert.deepEqual(runtimeAlertDeliverySloForSeverity("BLOCKER"), {
    sloClass: "BLOCKER_IMMEDIATE",
    sloTargetSeconds: 300,
  });
  assert.deepEqual(runtimeAlertDeliverySloForSeverity("WARNING"), {
    sloClass: "WARNING_STANDARD",
    sloTargetSeconds: 1800,
  });
  assert.equal(runtimeAlertDeliverySloForSeverity("BLOCKER_IMMEDIATE"), null);
  assert.equal(runtimeAlertDeliverySloForSeverity("UNKNOWN"), null);
  assert.ok(Object.isFrozen(runtimeAlertDeliverySloForSeverity("BLOCKER")));
  assert.ok(Object.isFrozen(runtimeAlertDeliverySloForSeverity("WARNING")));
});

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

function registrationConnection() {
  const calls = [];
  let row = null;
  return {
    calls,
    get row() { return row; },
    tamper(column, value) { row[column] = value; },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: compact, values: [...values] });
      if (compact.includes("v1_runtime_alert_delivery:register_")) {
        assert.equal(values.length, 8);
        const registrationMode = compact.includes("register_dry_run")
          ? "DRY_RUN" : "CONTROLLED";
        const binding = createV1RuntimeAlertPayloadAdapter(env({
          MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: registrationMode,
        })).binding;
        const outcome = row ? "REPLAY" : "REGISTERED";
        row = row || {
          runtime_alert_delivery_id: values[0],
          runtime_alert_id: values[1],
          environment_id: values[2],
          registration_mode: registrationMode,
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
        return [[[{ operation_outcome: outcome, ...row }], new ResultSetHeader()], []];
      }
      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
}

function adapter(overrides = {}) {
  return createMysqlV1RuntimeAlertDeliveryAdapter({
    pool: { async getConnection() { throw new Error("pool must not be acquired"); } },
    env: env(overrides),
  });
}

test("registration is deterministic, replay-safe, and stores no receiver material", async () => {
  const persistence = adapter();
  const connection = registrationConnection();
  const registered = await persistence.registerAlertInTransaction(connection, alert());
  assert.equal(registered.outcome, "REGISTERED");
  assert.match(registered.deliveryId, /^[0-9a-f]{64}$/);
  assert.match(registered.receiverBindingDigest, /^[0-9a-f]{64}$/);
  assert.equal(registered.registrationMode, "CONTROLLED");
  assert.equal(
    registered.receiverBindingAuthorityVersion,
    "runtime-alert-receiver-authority:v1"
  );
  const replay = await persistence.registerAlertInTransaction(connection, alert());
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(replay.deliveryId, registered.deliveryId);
  assert.equal(
    connection.calls.filter((call) => call.sql.includes(":register_")).length,
    2
  );
  const persistedShape = JSON.stringify({ row: connection.row, calls: connection.calls });
  assert.doesNotMatch(persistedShape, /receiver\.example\.invalid/);
  assert.doesNotMatch(persistedShape, new RegExp(RECEIVER_SECRET));
  assert.doesNotMatch(persistedShape, new RegExp(PERSON_NAME));
  assert.doesNotMatch(persistedShape, /V1_RUNTIME_CYCLE_STALE/);
});

test("DRY_RUN registration is permanently non-promotable to CONTROLLED", async () => {
  const connection = registrationConnection();
  const dryRun = adapter({ MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "DRY_RUN" });
  const recorded = await dryRun.registerAlertInTransaction(connection, alert());
  assert.equal(recorded.registrationMode, "DRY_RUN");
  assert.equal(
    (await dryRun.registerAlertInTransaction(connection, alert())).outcome,
    "REPLAY"
  );
  const controlled = adapter();
  await assert.rejects(
    () => controlled.registerAlertInTransaction(connection, alert()),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFLICT" }
  );
  assert.equal(connection.row.registration_mode, "DRY_RUN");
  assert.equal(
    connection.calls.filter((call) => call.sql.includes(":register_")).length,
    3
  );
});

test("key rotation replays one authority row; endpoint or ref rotation cannot duplicate it", async () => {
  const connection = registrationConnection();
  const previousEnv = env();
  const previous = adapter();
  const registered = await previous.registerAlertInTransaction(connection, alert());
  const rotatedKeys = adapter({
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-08",
    ROOT_V1_RUNTIME_ALERT_BINDING_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-binding-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY,
    }),
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-payload-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY,
    }),
  });
  const replay = await rotatedKeys.registerAlertInTransaction(connection, alert());
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(replay.deliveryId, registered.deliveryId);
  assert.equal(replay.receiverBindingDigestKeyId, "runtime-alert-binding-2026-07");
  assert.equal(replay.payloadDigestKeyId, "runtime-alert-payload-2026-07");

  const endpointRotated = adapter({
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT:
      "https://receiver-rotated.example.invalid/runtime-alerts",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-08",
    ROOT_V1_RUNTIME_ALERT_BINDING_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-binding-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY,
    }),
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-payload-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY,
    }),
  });
  await assert.rejects(
    () => endpointRotated.registerAlertInTransaction(connection, alert()),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFLICT" }
  );
  const authorityRefRotated = adapter({
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "sre-primary-v2",
  });
  await assert.rejects(
    () => authorityRefRotated.registerAlertInTransaction(connection, alert()),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFLICT" }
  );
  assert.equal(
    connection.calls.filter((call) => call.sql.includes(":register_")).length,
    4
  );
});

test("registration replay detects a drifted keyed payload digest and fails closed", async () => {
  const persistence = adapter();
  const connection = registrationConnection();
  await persistence.registerAlertInTransaction(connection, alert());
  connection.tamper("payload_digest", "f".repeat(64));
  await assert.rejects(
    () => persistence.registerAlertInTransaction(connection, alert()),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFLICT" }
  );
});

test("disabled registration is a no-op even when no receiver configuration exists", async () => {
  const persistence = createMysqlV1RuntimeAlertDeliveryAdapter({
    pool: { async getConnection() { throw new Error("pool must not be acquired"); } },
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  const connection = registrationConnection();
  assert.equal(persistence.mode, "DISABLED");
  assert.equal(persistence.registrationRequired, false);
  assert.deepEqual(
    await persistence.registerAlertInTransaction(connection, {}),
    { outcome: "DISABLED" }
  );
  assert.equal(connection.calls.length, 0);
  const inspection = await persistence.inspect();
  assert.equal(inspection.mode, "DISABLED");
  assert.equal(inspection.totalCount, 0);
});

test("write paths use controlled procedures while reads preserve database-time fencing", () => {
  const rawSource = fs.readFileSync(
    path.join(__dirname, "../src/mysqlV1RuntimeAlertDeliveryAdapter.js"),
    "utf8"
  );
  const source = rawSource.replace(/\s+/g, " ");
  assert.doesNotMatch(source, /v1_runtime_alert_delivery:select_registration/);
  assert.match(
    source,
    /v1_runtime_alert_delivery:lock_due.*registration_mode = 'CONTROLLED'.*receiver_binding_authority_version = \?.*receiver_binding_ref = \?.*status IN \('PENDING', 'RETRY_WAIT'\)/
  );
  for (const routine of [
    "register_dry_run", "register_controlled", "claim",
    "mark_provider_started", "complete_delivered",
    "fail_before_provider_retry", "fail_before_provider_dead",
    "mark_unknown", "recover_started_unknown", "recover_claim_retry",
    "recover_claim_dead", "inspect",
  ]) {
    assert.match(source, new RegExp(`CALL v1_runtime_alert_delivery_${routine}\\(`));
  }
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\s+v1_runtime_alert_delivery\b/i);
  assert.match(source, /readMysqlProcedureAffectedRows/);
  assert.match(source, /readMysqlProcedureResultRow/);
});
