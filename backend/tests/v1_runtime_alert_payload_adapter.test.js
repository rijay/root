const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CANONICAL_VERSION,
  DIGEST_SCHEME,
  PAYLOAD_SCHEMA_VERSION,
  RECEIVER_BINDING_AUTHORITY_VERSION,
  createV1RuntimeAlertPayloadAdapter,
  runtimeAlertDeliveryMode,
} = require("../src/v1RuntimeAlertPayloadAdapter");

const DELIVERY_ID = "a".repeat(64);
const ALERT_ID = "b".repeat(64);
const ENDPOINT = "https://receiver.example.invalid/runtime-alerts";
const RECEIVER_SECRET = "receiver-secret-material-2026-07-never-persist";

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "CONTROLLED",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "sre-primary-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: ENDPOINT,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET: RECEIVER_SECRET,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_PERSON_NAME: "Private Person Name",
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

function payload(overrides = {}) {
  return {
    alertCode: "V1_RUNTIME_CYCLE_STALE",
    deliveryId: DELIVERY_ID,
    observedAt: "2026-07-18T00:00:00.000Z",
    runtimeAlertId: ALERT_ID,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    severity: "BLOCKER",
    sloClass: "BLOCKER_IMMEDIATE",
    sloTargetSeconds: 300,
    ...overrides,
  };
}

test("delivery mode is default-off and cannot be enabled by an operation input", () => {
  assert.equal(runtimeAlertDeliveryMode({}), "DISABLED");
  assert.equal(runtimeAlertDeliveryMode({ MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "DRY_RUN" }), "DRY_RUN");
  assert.throws(
    () => runtimeAlertDeliveryMode({ MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "true" }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID" }
  );
  assert.throws(
    () => runtimeAlertDeliveryMode({
      MYROOT_V1_RUNTIME_ALERT_DELIVERY_REQUIRED: "true",
    }),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID" }
  );
});

test("payload Adapter signs only the stable minimal schema and verifies tamper", () => {
  const adapter = createV1RuntimeAlertPayloadAdapter(enabledEnv());
  assert.deepEqual(Object.keys(adapter), [
    "binding", "sign", "verify", "prepare", "verifyBinding", "digestReceipt", "inspect",
  ]);
  assert.deepEqual(Object.keys(adapter.binding), [
    "authorityVersion", "registrationMode", "ref", "digest", "digestScheme", "keyId",
  ]);
  assert.equal(adapter.binding.authorityVersion, RECEIVER_BINDING_AUTHORITY_VERSION);
  assert.equal(adapter.binding.registrationMode, "CONTROLLED");
  assert.equal(adapter.binding.digestScheme, DIGEST_SCHEME);
  assert.match(adapter.binding.digest, /^[0-9a-f]{64}$/);
  const signed = adapter.sign(payload());
  assert.deepEqual(signed, {
    canonicalVersion: CANONICAL_VERSION,
    digestScheme: DIGEST_SCHEME,
    keyId: "runtime-alert-payload-2026-07",
    digest: signed.digest,
    signature: signed.digest,
  });
  assert.equal(adapter.verify({
    canonicalVersion: signed.canonicalVersion,
    digestScheme: signed.digestScheme,
    keyId: signed.keyId,
    digest: signed.digest,
  }, payload()), true);
  assert.equal(adapter.verify({
    canonicalVersion: signed.canonicalVersion,
    digestScheme: signed.digestScheme,
    keyId: signed.keyId,
    digest: signed.digest,
  }, payload({ alertCode: "PAYLOAD_TAMPER_DETECTED" })), false);
  assert.throws(
    () => adapter.sign({ ...payload(), rootUserId: "must-not-be-signed" }),
    { code: "V1_RUNTIME_ALERT_PAYLOAD_INVALID" }
  );
});

test("stored payload verification accepts bounded previous keys and rejects unknown or retired keyIds", () => {
  const previousEnv = enabledEnv();
  const previous = createV1RuntimeAlertPayloadAdapter(previousEnv);
  const previousSigned = previous.sign(payload());
  const stored = {
    canonicalVersion: previousSigned.canonicalVersion,
    digestScheme: previousSigned.digestScheme,
    keyId: previousSigned.keyId,
    digest: previousSigned.digest,
  };
  const rotatedEnv = enabledEnv({
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-payload-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY,
    }),
  });
  const rotated = createV1RuntimeAlertPayloadAdapter(rotatedEnv);
  assert.equal(rotated.verify(stored, payload()), true);
  assert.equal(rotated.prepare(stored, payload()).keyState, "PREVIOUS");

  assert.throws(
    () => rotated.prepare({ ...stored, keyId: "runtime-alert-payload-unseen" }, payload()),
    { code: "PAYLOAD_VERIFICATION_KEY_UNKNOWN" }
  );
  const retired = createV1RuntimeAlertPayloadAdapter(enabledEnv({
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "payload-signing-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-2026-08",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_RETIRED_KEY_IDS_JSON: JSON.stringify([
      "runtime-alert-payload-2026-07",
    ]),
  }));
  assert.equal(retired.verify(stored, payload()), false);
  assert.throws(
    () => retired.prepare(stored, payload()),
    { code: "PAYLOAD_VERIFICATION_KEY_RETIRED" }
  );
});

test("rotation keyrings are bounded and receiver binding verification is mode-bound", () => {
  const previousEnv = enabledEnv();
  const previous = createV1RuntimeAlertPayloadAdapter(previousEnv);
  const rotated = createV1RuntimeAlertPayloadAdapter(enabledEnv({
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "binding-digest-secret-material-2026-08-current-distinct",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-2026-08",
    ROOT_V1_RUNTIME_ALERT_BINDING_VERIFICATION_KEYS_JSON: JSON.stringify({
      "runtime-alert-binding-2026-07": previousEnv.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY,
    }),
  }));
  assert.equal(rotated.verifyBinding(previous.binding), true);
  const controlledAgainstDryRun = createV1RuntimeAlertPayloadAdapter(enabledEnv({
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "DRY_RUN",
  }));
  assert.equal(rotated.verifyBinding(controlledAgainstDryRun.binding), false);

  const tooMany = Object.fromEntries(Array.from(
    { length: 9 },
    (_, index) => [`previous-payload-${index}`, `previous-secret-material-${index}-abcdefghijklmno`]
  ));
  assert.throws(
    () => createV1RuntimeAlertPayloadAdapter(enabledEnv({
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON: JSON.stringify(tooMany),
    })),
    { code: "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID" }
  );
});

test("binding and receipt persistable facts are keyed digests without raw material", () => {
  const adapter = createV1RuntimeAlertPayloadAdapter(enabledEnv());
  const receipt = { providerRequestId: "opaque-provider-ack-1", accepted: true };
  const digested = adapter.digestReceipt(DELIVERY_ID, receipt);
  assert.deepEqual(Object.keys(digested), ["digest", "digestScheme", "keyId"]);
  assert.match(digested.digest, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify({
    binding: adapter.binding,
    receipt: digested,
    inspection: adapter.inspect(),
  });
  assert.doesNotMatch(serialized, /receiver\.example\.invalid/);
  assert.doesNotMatch(serialized, new RegExp(RECEIVER_SECRET));
  assert.doesNotMatch(serialized, /Private Person Name/);
  assert.doesNotMatch(serialized, /opaque-provider-ack-1/);
});

test("protected and controlled runtimes fail closed on missing, weak, or non-HTTPS configuration", () => {
  for (const overrides of [
    { ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET: "" },
    { ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY: "weak" },
    { ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: "http://receiver.example.invalid/alerts" },
    { ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "bad key id" },
  ]) {
    const env = enabledEnv({ NODE_ENV: "production", ...overrides });
    assert.throws(
      () => createV1RuntimeAlertPayloadAdapter(env),
      (error) => {
        const serialized = `${error.code}:${error.message}:${error.stack}`;
        assert.equal(error.code, "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID");
        assert.equal(error.status, 503);
        assert.doesNotMatch(serialized, new RegExp(RECEIVER_SECRET));
        assert.doesNotMatch(serialized, /receiver\.example\.invalid/);
        return true;
      }
    );
  }
});
