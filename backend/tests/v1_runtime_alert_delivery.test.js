const assert = require("node:assert/strict");
const test = require("node:test");

const { createV1RuntimeAlertDelivery } = require("../src/v1RuntimeAlertDelivery");
const {
  PAYLOAD_SCHEMA_VERSION,
  createV1RuntimeAlertPayloadAdapter,
} = require("../src/v1RuntimeAlertPayloadAdapter");

const DELIVERY_ID = "a".repeat(64);
const ALERT_ID = "b".repeat(64);
const ENDPOINT = "https://receiver.example.invalid/runtime-alerts";
const RECEIVER_SECRET = "receiver-secret-material-2026-07-never-persist";

function env(mode = "CONTROLLED", overrides = {}) {
  return {
    NODE_ENV: "test",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: mode,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "sre-primary-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: ENDPOINT,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET: RECEIVER_SECRET,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_PERSON_NAME: "Private Receiver Person",
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

function alertPayload() {
  return Object.freeze({
    alertCode: "V1_RUNTIME_CYCLE_STALE",
    deliveryId: DELIVERY_ID,
    observedAt: "2026-07-18T00:00:00.000Z",
    runtimeAlertId: ALERT_ID,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    severity: "BLOCKER",
    sloClass: "BLOCKER_IMMEDIATE",
    sloTargetSeconds: 300,
  });
}

function memoryPersistence(options = {}) {
  const mode = options.mode || "CONTROLLED";
  const payloadAdapter = options.payloadAdapter || (mode === "DISABLED"
    ? null : createV1RuntimeAlertPayloadAdapter(env(mode)));
  const storedPayloadAdapter = options.storedPayloadAdapter || payloadAdapter;
  const payload = alertPayload();
  const signed = storedPayloadAdapter ? storedPayloadAdapter.sign(payload) : null;
  const binding = storedPayloadAdapter ? storedPayloadAdapter.binding : null;
  const row = mode === "DISABLED" || options.empty
    ? null
    : {
      deliveryId: DELIVERY_ID,
      runtimeAlertId: ALERT_ID,
      registrationMode: binding.registrationMode,
      receiverBindingAuthorityVersion: binding.authorityVersion,
      receiverBindingRef: binding.ref,
      receiverBindingDigest: binding.digest,
      receiverBindingDigestScheme: binding.digestScheme,
      receiverBindingDigestKeyId: binding.keyId,
      payload,
      payloadCanonicalVersion: signed.canonicalVersion,
      payloadDigest: options.tamper ? "f".repeat(64) : signed.digest,
      payloadDigestScheme: signed.digestScheme,
      payloadDigestKeyId: signed.keyId,
      status: "PENDING",
      attemptCount: 0,
      maximumAttempts: options.maximumAttempts || 3,
      leaseOwner: null,
      leaseGeneration: 0,
      errorCode: null,
    };
  const calls = [];
  function fence(input, status) {
    if (!row || row.status !== status
      || row.leaseOwner !== input.leaseOwner
      || row.leaseGeneration !== input.leaseGeneration) {
      const error = new Error("fenced");
      error.code = "V1_RUNTIME_ALERT_DELIVERY_LEASE_FENCED";
      throw error;
    }
  }
  const persistence = {
    mode,
    registrationRequired: mode !== "DISABLED",
    payloadAdapter,
    calls,
    row,
    async claimNext(input) {
      calls.push(["claimNext", input]);
      if (!row || !["PENDING", "RETRY_WAIT"].includes(row.status)) return null;
      row.status = "CLAIMED";
      row.attemptCount += 1;
      row.leaseOwner = input.leaseOwner;
      row.leaseGeneration += 1;
      row.errorCode = null;
      return Object.freeze({ ...row });
    },
    async markProviderStarted(input) {
      calls.push(["markProviderStarted", input]);
      fence(input, "CLAIMED");
      row.status = "STARTED";
      if (options.crashAfterStarted) {
        const error = new Error("simulated process loss after durable STARTED");
        error.code = "V1_RUNTIME_ALERT_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
        throw error;
      }
      return Object.freeze({ ...row });
    },
    async completeDelivered(input) {
      calls.push(["completeDelivered", input]);
      fence(input, "STARTED");
      if (options.completeAppliedThenAckLost) {
        row.status = "DELIVERED";
        row.receiptDigest = input.receiptDigest;
        row.receiptDigestScheme = input.receiptDigestScheme;
        row.receiptDigestKeyId = input.receiptDigestKeyId;
        row.leaseOwner = null;
        const error = new Error("commit ack lost");
        error.code = "V1_RUNTIME_ALERT_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
        throw error;
      }
      if (options.completeAckLost) {
        const error = new Error("commit ack lost");
        error.code = "V1_RUNTIME_ALERT_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
        throw error;
      }
      row.status = "DELIVERED";
      row.receiptDigest = input.receiptDigest;
      row.receiptDigestScheme = input.receiptDigestScheme;
      row.receiptDigestKeyId = input.receiptDigestKeyId;
      row.leaseOwner = null;
      return Object.freeze({ ...row });
    },
    async failBeforeProvider(input) {
      calls.push(["failBeforeProvider", input]);
      fence(input, "CLAIMED");
      const retry = input.retryable && row.attemptCount < row.maximumAttempts;
      row.status = retry ? "RETRY_WAIT" : "DEAD_LETTER";
      row.errorCode = input.errorCode;
      row.leaseOwner = null;
      row.leaseGeneration += 1;
      return Object.freeze({ ...row });
    },
    async markUnknown(input) {
      calls.push(["markUnknown", input]);
      if (row.status === "DELIVERED") return Object.freeze({ ...row });
      fence(input, "STARTED");
      row.status = "UNKNOWN";
      row.errorCode = input.errorCode;
      row.leaseOwner = null;
      row.leaseGeneration += 1;
      return Object.freeze({ ...row });
    },
    async recoverStale() {
      calls.push(["recoverStale"]);
      const ids = [];
      let unknownCount = 0;
      let recoveredBeforeProviderCount = 0;
      let deadLetterCount = 0;
      if (row && row.status === "STARTED") {
        row.status = "UNKNOWN";
        row.errorCode = "PROVIDER_ACK_UNKNOWN";
        row.leaseOwner = null;
        row.leaseGeneration += 1;
        ids.push(row.deliveryId);
        unknownCount += 1;
      } else if (row && row.status === "CLAIMED") {
        const retry = row.attemptCount < row.maximumAttempts;
        row.status = retry ? "RETRY_WAIT" : "DEAD_LETTER";
        row.errorCode = "CLAIM_EXPIRED_BEFORE_PROVIDER";
        row.leaseOwner = null;
        row.leaseGeneration += 1;
        ids.push(row.deliveryId);
        if (retry) recoveredBeforeProviderCount += 1;
        else deadLetterCount += 1;
      }
      return Object.freeze({
        mode,
        recoveredBeforeProviderCount,
        unknownCount,
        deadLetterCount,
        deliveryIds: Object.freeze(ids),
      });
    },
    async inspect() {
      calls.push(["inspect"]);
      return Object.freeze({
        mode,
        registrationRequired: mode !== "DISABLED",
        totalCount: row ? 1 : 0,
        unknownCount: row && row.status === "UNKNOWN" ? 1 : 0,
        deadLetterCount: row && row.status === "DEAD_LETTER" ? 1 : 0,
      });
    },
  };
  return persistence;
}

function worker(options = {}) {
  const mode = options.mode || "CONTROLLED";
  const activeEnv = options.env || env(mode);
  const payloadAdapter = options.payloadAdapter
    || (mode === "DISABLED" ? null : createV1RuntimeAlertPayloadAdapter(activeEnv));
  const persistence = options.persistence || memoryPersistence({
    ...options,
    mode,
    payloadAdapter,
  });
  const providerCalls = [];
  const provider = mode === "CONTROLLED" ? {
    async deliver(envelope) {
      providerCalls.push(envelope);
      if (options.providerError) throw new Error("private provider outcome");
      return { receipt: { opaqueAck: "provider-ack-private-1" } };
    },
  } : null;
  return {
    providerCalls,
    persistence,
    module: createV1RuntimeAlertDelivery({
      env: activeEnv,
      persistence,
      provider,
      ...(payloadAdapter ? { payloadAdapter } : {}),
    }),
  };
}

const RUN_INPUT = Object.freeze({
  leaseOwner: "runtime-alert-worker-a",
  leaseSeconds: 60,
  limit: 10,
});

test("Interface is deep, mode-controlled, and never lets request input activate delivery", async () => {
  for (const mode of ["DISABLED", "DRY_RUN"]) {
    const current = worker({ mode });
    assert.deepEqual(Object.keys(current.module), ["inspect", "recoverStale", "runDue"]);
    const result = await current.module.runDue(RUN_INPUT);
    assert.equal(result.claimedCount, 0);
    assert.equal(current.providerCalls.length, 0);
    assert.equal(result.gates.receiverEvidenceGate, "OPEN");
    assert.equal(result.gates.syntheticAcknowledgementGate, "OPEN");
    assert.doesNotMatch(JSON.stringify(result), /CLOSED/);
    await assert.rejects(
      () => current.module.runDue({ ...RUN_INPUT, enabled: true }),
      { code: "V1_RUNTIME_ALERT_DELIVERY_INPUT_INVALID" }
    );
  }
});

test("controlled receiver gets one signed minimal payload and only keyed receipt facts persist", async () => {
  const current = worker();
  const result = await current.module.runDue(RUN_INPUT);
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.reviewRequiredCount, 0);
  assert.equal(current.providerCalls.length, 1);
  const envelope = current.providerCalls[0];
  assert.deepEqual(Object.keys(envelope), ["payload", "signature"]);
  assert.deepEqual(Object.keys(envelope.payload).sort(), [
    "alertCode", "deliveryId", "observedAt", "runtimeAlertId",
    "schemaVersion", "severity", "sloClass", "sloTargetSeconds",
  ].sort());
  const serializedEnvelope = JSON.stringify(envelope);
  assert.doesNotMatch(serializedEnvelope, /receiver\.example\.invalid/);
  assert.doesNotMatch(serializedEnvelope, new RegExp(RECEIVER_SECRET));
  assert.doesNotMatch(serializedEnvelope, /Private Receiver Person/);
  const completion = current.persistence.calls.find(([name]) => name === "completeDelivered")[1];
  assert.deepEqual(Object.keys(completion).sort(), [
    "deliveryId", "leaseOwner", "leaseGeneration",
    "receiptDigest", "receiptDigestScheme", "receiptDigestKeyId",
  ].sort());
  assert.doesNotMatch(JSON.stringify(completion), /provider-ack-private-1/);
  assert.equal((await current.module.runDue(RUN_INPUT)).claimedCount, 0);
  assert.equal(current.providerCalls.length, 1, "terminal delivery is never resent");
});

test("payload tamper dead-letters before provider start", async () => {
  const current = worker({ tamper: true });
  const result = await current.module.runDue(RUN_INPUT);
  assert.equal(result.deadLetterCount, 1);
  assert.equal(result.outcomes[0].errorCode, "PAYLOAD_TAMPER_DETECTED");
  assert.equal(current.providerCalls.length, 0);
  assert.equal(
    current.persistence.calls.some(([name]) => name === "markProviderStarted"),
    false
  );
});

test("old PENDING payloads drain through an explicitly configured previous key", async () => {
  const previousAdapter = createV1RuntimeAlertPayloadAdapter(env());
  const rotatedEnv = env("CONTROLLED", {
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-08",
    ROOT_V1_RUNTIME_ALERT_BINDING_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-binding-2026-07":
        env().ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY,
    }),
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-payload-2026-07":
        env().ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY,
    }),
  });
  const rotatedAdapter = createV1RuntimeAlertPayloadAdapter(rotatedEnv);
  const persistence = memoryPersistence({
    payloadAdapter: rotatedAdapter,
    storedPayloadAdapter: previousAdapter,
  });
  const current = worker({
    env: rotatedEnv,
    payloadAdapter: rotatedAdapter,
    persistence,
  });
  const result = await current.module.runDue(RUN_INPUT);
  assert.equal(result.deliveredCount, 1);
  assert.equal(current.providerCalls.length, 1);
  assert.equal(
    current.providerCalls[0].signature.keyId,
    "runtime-alert-payload-2026-07"
  );
});

test("old STARTED payloads remain no-resend UNKNOWN across key rotation", async () => {
  const previousAdapter = createV1RuntimeAlertPayloadAdapter(env());
  const rotatedEnv = env("CONTROLLED", {
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-payload-2026-07":
        env().ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY,
    }),
  });
  const rotatedAdapter = createV1RuntimeAlertPayloadAdapter(rotatedEnv);
  const persistence = memoryPersistence({
    payloadAdapter: rotatedAdapter,
    storedPayloadAdapter: previousAdapter,
  });
  persistence.row.status = "STARTED";
  persistence.row.attemptCount = 1;
  persistence.row.leaseOwner = "runtime-alert-worker-before-rotation";
  persistence.row.leaseGeneration = 1;
  const current = worker({
    env: rotatedEnv,
    payloadAdapter: rotatedAdapter,
    persistence,
  });
  const recovered = await current.module.recoverStale({ limit: 10 });
  assert.equal(recovered.unknownCount, 1);
  assert.equal(persistence.row.status, "UNKNOWN");
  assert.equal(current.providerCalls.length, 0);
  assert.equal((await current.module.runDue(RUN_INPUT)).claimedCount, 0);
});

test("unknown and retired payload keys dead-letter before the Provider Adapter seam", async () => {
  const previousAdapter = createV1RuntimeAlertPayloadAdapter(env());
  for (const [expectedCode, rotation] of [
    ["PAYLOAD_VERIFICATION_KEY_UNKNOWN", {}],
    ["PAYLOAD_VERIFICATION_KEY_RETIRED", {
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_RETIRED_KEY_IDS_JSON: JSON.stringify([
        "runtime-alert-payload-2026-07",
      ]),
    }],
  ]) {
    const rotatedEnv = env("CONTROLLED", {
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
        "payload-signing-secret-material-2026-08-current-distinct",
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
      ...rotation,
    });
    const rotatedAdapter = createV1RuntimeAlertPayloadAdapter(rotatedEnv);
    const persistence = memoryPersistence({
      payloadAdapter: rotatedAdapter,
      storedPayloadAdapter: previousAdapter,
    });
    const current = worker({
      env: rotatedEnv,
      payloadAdapter: rotatedAdapter,
      persistence,
    });
    const result = await current.module.runDue(RUN_INPUT);
    assert.equal(result.deadLetterCount, 1);
    assert.equal(result.outcomes[0].errorCode, expectedCode);
    assert.equal(current.providerCalls.length, 0);
    assert.equal(
      persistence.calls.some(([name]) => name === "markProviderStarted"),
      false
    );
  }
});

test("a DRY_RUN registration can never cross the CONTROLLED binding seam", async () => {
  const dryRunAdapter = createV1RuntimeAlertPayloadAdapter(env("DRY_RUN"));
  const controlledAdapter = createV1RuntimeAlertPayloadAdapter(env());
  const persistence = memoryPersistence({
    payloadAdapter: controlledAdapter,
    storedPayloadAdapter: dryRunAdapter,
  });
  const current = worker({ payloadAdapter: controlledAdapter, persistence });
  const result = await current.module.runDue(RUN_INPUT);
  assert.equal(result.deadLetterCount, 1);
  assert.equal(result.outcomes[0].errorCode, "RECEIVER_BINDING_AUTHORITY_MISMATCH");
  assert.equal(current.providerCalls.length, 0);
});

test("only proven pre-provider transient failures retry, with bounded dead-letter convergence", async () => {
  const activeEnv = env();
  const realPayloadAdapter = createV1RuntimeAlertPayloadAdapter(activeEnv);
  let failuresRemaining = 2;
  const transientPayloadAdapter = Object.freeze({
    ...realPayloadAdapter,
    prepare(stored, payload) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        const error = new Error("local signer temporarily unavailable");
        error.code = "PAYLOAD_SIGNER_TRANSIENT";
        error.preProviderTransient = true;
        throw error;
      }
      return realPayloadAdapter.prepare(stored, payload);
    },
  });
  const persistence = memoryPersistence({
    maximumAttempts: 2,
    payloadAdapter: realPayloadAdapter,
  });
  const current = worker({ payloadAdapter: transientPayloadAdapter, persistence });
  const first = await current.module.runDue({ ...RUN_INPUT, limit: 1 });
  assert.equal(first.retryWaitCount, 1);
  assert.equal(first.outcomes[0].errorCode, "PAYLOAD_SIGNER_TRANSIENT");
  const second = await current.module.runDue({ ...RUN_INPUT, limit: 1 });
  assert.equal(second.deadLetterCount, 1);
  assert.equal(current.providerCalls.length, 0);
  assert.equal((await current.module.runDue({ ...RUN_INPUT, limit: 1 })).claimedCount, 0);
});

test("provider-started process loss recovers only to UNKNOWN and fences the old owner", async () => {
  const current = worker({ crashAfterStarted: true });
  const run = await current.module.runDue(RUN_INPUT);
  assert.equal(run.reviewRequiredCount, 1);
  assert.equal(run.outcomes[0].status, "REVIEW_REQUIRED");
  assert.equal(current.providerCalls.length, 0);
  const staleFence = {
    deliveryId: DELIVERY_ID,
    leaseOwner: "runtime-alert-worker-a",
    leaseGeneration: 1,
  };
  const recovery = await current.module.recoverStale({ limit: 10 });
  assert.equal(recovery.unknownCount, 1);
  assert.equal(current.persistence.row.status, "UNKNOWN");
  await assert.rejects(
    () => current.persistence.completeDelivered({
      ...staleFence,
      receiptDigest: "c".repeat(64),
      receiptDigestScheme: "hmac-sha256:v1",
      receiptDigestKeyId: "runtime-alert-receipt-2026-07",
    }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_LEASE_FENCED" }
  );
  assert.equal((await current.module.runDue(RUN_INPUT)).claimedCount, 0);
});

test("provider errors and ACK loss become UNKNOWN without automatic resend", async () => {
  for (const options of [{ providerError: true }, { completeAckLost: true }]) {
    const current = worker(options);
    const result = await current.module.runDue(RUN_INPUT);
    assert.equal(result.unknownCount, 1);
    assert.equal(result.reviewRequiredCount, 1);
    assert.equal(current.providerCalls.length, 1);
    assert.equal((await current.module.runDue(RUN_INPUT)).claimedCount, 0);
    assert.equal(current.providerCalls.length, 1);
  }
});

test("delivered commit ACK loss converges by readback and is never downgraded", async () => {
  const current = worker({ completeAppliedThenAckLost: true });
  const result = await current.module.runDue(RUN_INPUT);
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.unknownCount, 0);
  assert.equal(current.persistence.row.status, "DELIVERED");
  assert.equal(current.providerCalls.length, 1);
});
