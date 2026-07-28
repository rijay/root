const crypto = require("node:crypto");

const { isProtectedRuntime } = require("./credentialProtection");
const {
  KEY_ID_PATTERN,
  assertDisjointKeyPolicy,
  classifyKeyId,
  parsePreviousKeyring,
} = require("./keyRotationConfiguration");
const {
  runtimeAlertDeliverySloForSeverity,
} = require("./v1RuntimeAlertDeliveryPolicy");

const DELIVERY_MODES = Object.freeze(["DISABLED", "DRY_RUN", "CONTROLLED"]);
const PAYLOAD_SCHEMA_VERSION = "myroot.runtime-alert.delivery.v1";
const CANONICAL_VERSION = "canonical-json:v1";
const DIGEST_SCHEME = "hmac-sha256:v1";
const RECEIVER_BINDING_AUTHORITY_VERSION = "runtime-alert-receiver-authority:v1";
const MAXIMUM_RECEIPT_BYTES = 8 * 1024;
const MAXIMUM_RETIRED_KEY_IDS = 32;
const MAXIMUM_RETIRED_KEY_IDS_BYTES = 8 * 1024;
const BINDING_PREVIOUS_KEYS_ENV =
  "ROOT_V1_RUNTIME_ALERT_BINDING_VERIFICATION_KEYS_JSON";
const BINDING_RETIRED_KEYS_ENV =
  "ROOT_V1_RUNTIME_ALERT_BINDING_RETIRED_KEY_IDS_JSON";
const PAYLOAD_PREVIOUS_KEYS_ENV =
  "ROOT_V1_RUNTIME_ALERT_PAYLOAD_VERIFICATION_KEYS_JSON";
const PAYLOAD_RETIRED_KEYS_ENV =
  "ROOT_V1_RUNTIME_ALERT_PAYLOAD_RETIRED_KEY_IDS_JSON";
const PAYLOAD_KEYS = Object.freeze([
  "alertCode",
  "deliveryId",
  "observedAt",
  "runtimeAlertId",
  "schemaVersion",
  "severity",
  "sloClass",
  "sloTargetSeconds",
]);

function payloadError(code, status) {
  const error = new Error("V1 runtime alert payload configuration or input is invalid");
  error.name = "V1RuntimeAlertPayloadError";
  error.code = code;
  error.status = status;
  return error;
}

function configurationError() {
  return payloadError("V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID", 503);
}

function inputError() {
  return payloadError("V1_RUNTIME_ALERT_PAYLOAD_INVALID", 400);
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => Object.prototype.hasOwnProperty.call(descriptor, "value")
  );
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function environmentText(env, name) {
  let value;
  try { value = env && env[name]; } catch { throw configurationError(); }
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw configurationError();
  return value;
}

function hasEnvironmentValue(env, name) {
  try { return Boolean(env) && Object.prototype.hasOwnProperty.call(env, name); }
  catch { throw configurationError(); }
}

function runtimeAlertDeliveryMode(env = process.env) {
  const raw = environmentText(env, "MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE");
  const mode = raw || "DISABLED";
  if (!DELIVERY_MODES.includes(mode)) throw configurationError();
  const required = environmentText(env, "MYROOT_V1_RUNTIME_ALERT_DELIVERY_REQUIRED");
  if (required && !["true", "false"].includes(required)) throw configurationError();
  if (required === "true" && mode === "DISABLED") throw configurationError();
  return mode;
}

function strongSecret(value) {
  return typeof value === "string"
    && value === value.trim()
    && !value.includes("\u0000")
    && Buffer.byteLength(value, "utf8") >= 32
    && Buffer.byteLength(value, "utf8") <= 4096
    && new Set(Array.from(value)).size >= 8;
}

function opaqueReference(value, maximumLength) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function controlledEndpoint(value, protectedRuntime) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return false;
  let endpoint;
  try { endpoint = new URL(value); } catch { return false; }
  if (endpoint.username || endpoint.password || endpoint.hash) return false;
  if (protectedRuntime && endpoint.protocol !== "https:") return false;
  return ["https:", "http:"].includes(endpoint.protocol);
}

function canonicalJson(value, stack = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw inputError();
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || stack.has(value)) throw inputError();
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Object.keys(value).length !== value.length) throw inputError();
    stack.add(value);
    try { return `[${value.map((item) => canonicalJson(item, stack)).join(",")}]`; }
    finally { stack.delete(value); }
  }
  if (!plainRecord(value)) throw inputError();
  stack.add(value);
  try {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key], stack)}`
    ).join(",")}}`;
  } finally { stack.delete(value); }
}

function isoInstant(value) {
  if (typeof value !== "string" || value.length > 32) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function digest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function stableCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function parseRetiredKeyIds(raw) {
  if (raw === undefined) return Object.freeze([]);
  if (typeof raw !== "string"
    || raw.length < 2
    || Buffer.byteLength(raw, "utf8") > MAXIMUM_RETIRED_KEY_IDS_BYTES) {
    throw configurationError();
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw configurationError(); }
  if (!Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Array.prototype
    || parsed.length > MAXIMUM_RETIRED_KEY_IDS
    || parsed.some((keyId) => typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId))
    || new Set(parsed).size !== parsed.length) throw configurationError();
  return Object.freeze([...parsed].sort());
}

function keyRotation(env, activeKeyId, activeSecret, previousEnv, retiredEnv) {
  try {
    const previous = parsePreviousKeyring(
      hasEnvironmentValue(env, previousEnv) ? environmentText(env, previousEnv) : undefined,
      { activeKeyId, validateSecret: strongSecret }
    );
    const retiredKeyIds = parseRetiredKeyIds(
      hasEnvironmentValue(env, retiredEnv) ? environmentText(env, retiredEnv) : undefined
    );
    const policy = Object.freeze({
      currentKeyId: activeKeyId,
      previousKeyIds: Object.freeze([...previous.keys()].sort()),
      retiredKeyIds,
    });
    assertDisjointKeyPolicy(policy);
    const keys = new Map(previous);
    keys.set(activeKeyId, activeSecret);
    return Object.freeze({ keys, policy });
  } catch (error) {
    if (error && error.code === "V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID") throw error;
    throw configurationError();
  }
}

function verificationError(code) {
  const error = payloadError(code, 503);
  error.preProviderTransient = false;
  return error;
}

function normalizePayload(payload) {
  const expectedSlo = runtimeAlertDeliverySloForSeverity(payload?.severity);
  if (!exactKeys(payload, PAYLOAD_KEYS)
    || payload.schemaVersion !== PAYLOAD_SCHEMA_VERSION
    || !digest(payload.deliveryId)
    || !digest(payload.runtimeAlertId)
    || !stableCode(payload.alertCode)
    || !expectedSlo
    || !Number.isSafeInteger(payload.sloTargetSeconds)
    || payload.sloTargetSeconds < 1
    || payload.sloTargetSeconds > 86400
    || payload.sloClass !== expectedSlo.sloClass
    || payload.sloTargetSeconds !== expectedSlo.sloTargetSeconds
    || !isoInstant(payload.observedAt)) throw inputError();
  return Object.freeze({ ...payload });
}

function framed(value) {
  const bytes = Buffer.from(String(value), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function keyedDigest(secret, domain, keyId, value) {
  return crypto.createHmac("sha256", secret)
    .update(framed(domain))
    .update(framed(DIGEST_SCHEME))
    .update(framed(keyId))
    .update(framed(value))
    .digest("hex");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function createV1RuntimeAlertPayloadAdapter(env = process.env) {
  const mode = runtimeAlertDeliveryMode(env);
  if (mode === "DISABLED") throw configurationError();
  const protectedRuntime = isProtectedRuntime(env);
  const receiverBindingRef = environmentText(
    env,
    "ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF"
  );
  const receiverEndpoint = environmentText(env, "ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT");
  const receiverSecret = environmentText(env, "ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET");
  const bindingKey = environmentText(env, "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY");
  const bindingKeyId = environmentText(env, "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID");
  const payloadKey = environmentText(env, "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY");
  const payloadKeyId = environmentText(env, "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID");
  const receiptKey = environmentText(env, "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY");
  const receiptKeyId = environmentText(env, "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID");
  if (!opaqueReference(receiverBindingRef, 128)
    || !controlledEndpoint(receiverEndpoint, protectedRuntime)
    || !strongSecret(receiverSecret)
    || !strongSecret(bindingKey)
    || !strongSecret(payloadKey)
    || !strongSecret(receiptKey)
    || !KEY_ID_PATTERN.test(bindingKeyId)
    || !KEY_ID_PATTERN.test(payloadKeyId)
    || !KEY_ID_PATTERN.test(receiptKeyId)
    || new Set([bindingKeyId, payloadKeyId, receiptKeyId]).size !== 3
    || new Set([bindingKey, payloadKey, receiptKey]).size !== 3) throw configurationError();

  const bindingRotation = keyRotation(
    env,
    bindingKeyId,
    bindingKey,
    BINDING_PREVIOUS_KEYS_ENV,
    BINDING_RETIRED_KEYS_ENV
  );
  const payloadRotation = keyRotation(
    env,
    payloadKeyId,
    payloadKey,
    PAYLOAD_PREVIOUS_KEYS_ENV,
    PAYLOAD_RETIRED_KEYS_ENV
  );

  const bindingDescriptor = canonicalJson({
    authorityVersion: RECEIVER_BINDING_AUTHORITY_VERSION,
    registrationMode: mode,
    receiverBindingRef,
    receiverEndpoint,
    receiverSecret,
  });
  const binding = Object.freeze({
    authorityVersion: RECEIVER_BINDING_AUTHORITY_VERSION,
    registrationMode: mode,
    ref: receiverBindingRef,
    digest: keyedDigest(
      bindingKey,
      "myroot:v1-runtime-alert:receiver-binding:v1",
      bindingKeyId,
      bindingDescriptor
    ),
    digestScheme: DIGEST_SCHEME,
    keyId: bindingKeyId,
  });

  function keyState(keyId, rotation) {
    return classifyKeyId(keyId, rotation.policy);
  }

  function bindingDigestFor(keyId) {
    const secret = bindingRotation.keys.get(keyId);
    if (!secret) return null;
    return keyedDigest(
      secret,
      "myroot:v1-runtime-alert:receiver-binding:v1",
      keyId,
      bindingDescriptor
    );
  }

  function verifyBinding(stored) {
    if (!exactKeys(stored, [
      "authorityVersion", "registrationMode", "ref", "digest", "digestScheme", "keyId",
    ])
      || stored.authorityVersion !== RECEIVER_BINDING_AUTHORITY_VERSION
      || stored.registrationMode !== mode
      || stored.ref !== receiverBindingRef
      || stored.digestScheme !== DIGEST_SCHEME
      || !digest(stored.digest)) return false;
    const state = keyState(stored.keyId, bindingRotation);
    if (!["CURRENT", "PREVIOUS"].includes(state)) return false;
    const expected = bindingDigestFor(stored.keyId);
    return expected !== null && safeEqual(stored.digest, expected);
  }

  function sign(payload) {
    const normalized = normalizePayload(payload);
    const canonical = canonicalJson(normalized);
    const value = keyedDigest(
      payloadKey,
      "myroot:v1-runtime-alert:payload:v1",
      payloadKeyId,
      canonical
    );
    return Object.freeze({
      canonicalVersion: CANONICAL_VERSION,
      digestScheme: DIGEST_SCHEME,
      keyId: payloadKeyId,
      digest: value,
      signature: value,
    });
  }

  function verify(stored, payload) {
    if (!exactKeys(stored, ["canonicalVersion", "digestScheme", "keyId", "digest"])
      || stored.canonicalVersion !== CANONICAL_VERSION
      || stored.digestScheme !== DIGEST_SCHEME
      || !digest(stored.digest)) return false;
    const state = keyState(stored.keyId, payloadRotation);
    if (!["CURRENT", "PREVIOUS"].includes(state)) return false;
    const secret = payloadRotation.keys.get(stored.keyId);
    if (!secret) return false;
    try {
      const canonical = canonicalJson(normalizePayload(payload));
      return safeEqual(stored.digest, keyedDigest(
        secret,
        "myroot:v1-runtime-alert:payload:v1",
        stored.keyId,
        canonical
      ));
    } catch { return false; }
  }

  function prepare(stored, payload) {
    if (!plainRecord(stored)) throw verificationError("PAYLOAD_TAMPER_DETECTED");
    const state = keyState(stored.keyId, payloadRotation);
    if (state === "RETIRED") {
      throw verificationError("PAYLOAD_VERIFICATION_KEY_RETIRED");
    }
    if (state === "UNKNOWN") {
      throw verificationError("PAYLOAD_VERIFICATION_KEY_UNKNOWN");
    }
    if (!verify(stored, payload)) throw verificationError("PAYLOAD_TAMPER_DETECTED");
    return Object.freeze({
      canonicalVersion: stored.canonicalVersion,
      digestScheme: stored.digestScheme,
      keyId: stored.keyId,
      digest: stored.digest,
      signature: stored.digest,
      keyState: state,
    });
  }

  function digestReceipt(deliveryId, receipt) {
    if (!digest(deliveryId)) throw inputError();
    const canonical = canonicalJson(receipt);
    if (Buffer.byteLength(canonical, "utf8") < 1
      || Buffer.byteLength(canonical, "utf8") > MAXIMUM_RECEIPT_BYTES) throw inputError();
    return Object.freeze({
      digest: keyedDigest(
        receiptKey,
        "myroot:v1-runtime-alert:receipt:v1",
        receiptKeyId,
        canonicalJson({ deliveryId, receipt })
      ),
      digestScheme: DIGEST_SCHEME,
      keyId: receiptKeyId,
    });
  }

  function inspect() {
    return Object.freeze({
      ready: true,
      mode,
      payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
      canonicalVersion: CANONICAL_VERSION,
      digestScheme: DIGEST_SCHEME,
      bindingKeyId,
      bindingPreviousKeyIds: bindingRotation.policy.previousKeyIds,
      bindingRetiredKeyIds: bindingRotation.policy.retiredKeyIds,
      payloadKeyId,
      payloadPreviousKeyIds: payloadRotation.policy.previousKeyIds,
      payloadRetiredKeyIds: payloadRotation.policy.retiredKeyIds,
      receiptKeyId,
      receiverBindingAuthorityVersion: RECEIVER_BINDING_AUTHORITY_VERSION,
    });
  }

  return Object.freeze({
    binding,
    sign,
    verify,
    prepare,
    verifyBinding,
    digestReceipt,
    inspect,
  });
}

module.exports = {
  CANONICAL_VERSION,
  DIGEST_SCHEME,
  PAYLOAD_SCHEMA_VERSION,
  RECEIVER_BINDING_AUTHORITY_VERSION,
  createV1RuntimeAlertPayloadAdapter,
  normalizePayload,
  runtimeAlertDeliveryMode,
};
