const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");

const { isProtectedRuntime } = require("./credentialProtection");
const {
  COMMAND_RESULT_PROTECTION_POLICY,
} = require("./commandResultProtectionPolicy");
const {
  KEY_ID_PATTERN,
  assertDisjointKeyPolicy,
  classifyKeyId,
  parsePreviousKeyring,
  parseRetiredKeyIds,
} = require("./keyRotationConfiguration");

const PROTECTION = COMMAND_RESULT_PROTECTION_POLICY.protection;
const CODEC_VERSION = COMMAND_RESULT_PROTECTION_POLICY.codecVersion;
const MAX_PLAINTEXT_BYTES = COMMAND_RESULT_PROTECTION_POLICY.maximumPlaintextBytes;
const ENVELOPE_FIELDS = COMMAND_RESULT_PROTECTION_POLICY.envelopeFields;
const PREVIOUS_KEYS_ENV = "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON";
const RETIRED_KEYS_ENV = "ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON";

function text(value) {
  return String(value || "").trim();
}

function protectionError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function bindingDigest(binding) {
  const normalized = text(binding);
  if (!normalized) throw protectionError("COMMAND_RESULT_BINDING_REQUIRED", "Command result binding is required", 409);
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isValidSecret(secret) {
  return typeof secret === "string"
    && Buffer.byteLength(secret, "utf8") >= 32
    && Buffer.byteLength(secret, "utf8") <= 4096
    && secret === secret.trim()
    && !secret.includes("\u0000")
    && new Set(Array.from(secret)).size >= 8;
}

function validateKeyId(keyId) {
  return typeof keyId === "string" && KEY_ID_PATTERN.test(keyId);
}

function rotationConfiguration(env, activeKeyId) {
  try {
    const previous = parsePreviousKeyring(
      hasOwn(env, PREVIOUS_KEYS_ENV) ? env[PREVIOUS_KEYS_ENV] : undefined,
      { activeKeyId, validateSecret: isValidSecret }
    );
    const retiredKeyIds = parseRetiredKeyIds(
      hasOwn(env, RETIRED_KEYS_ENV) ? env[RETIRED_KEYS_ENV] : undefined
    ).COMMAND_RESULT;
    const policy = {
      currentKeyId: activeKeyId,
      previousKeyIds: [...previous.keys()].sort(),
      retiredKeyIds: [...retiredKeyIds],
    };
    assertDisjointKeyPolicy(policy);
    return { previous, policy };
  } catch {
    throw protectionError(
      "COMMAND_RESULT_KEY_RING_INVALID",
      "Command result key rotation configuration is invalid"
    );
  }
}

function envelopeError() {
  return protectionError(
    "COMMAND_RESULT_ENVELOPE_INVALID",
    "Command result envelope is invalid",
    409
  );
}

function serializationError() {
  return protectionError(
    "COMMAND_RESULT_SERIALIZATION_INVALID",
    "Command result cannot be persisted",
    409
  );
}

function sizeError() {
  return protectionError(
    "COMMAND_RESULT_PLAINTEXT_TOO_LARGE",
    "Command result exceeds the persistence limit",
    413
  );
}

function serializeWithinLimit(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value === undefined ? null : value);
  } catch {
    throw serializationError();
  }
  if (typeof serialized !== "string") throw serializationError();
  if (Buffer.byteLength(serialized, "utf8") > MAX_PLAINTEXT_BYTES) throw sizeError();
  return serialized;
}

function cloneWithinLimit(value) {
  const serialized = serializeWithinLimit(value);
  try {
    return JSON.parse(serialized);
  } catch {
    throw serializationError();
  }
}

function descriptorSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return {
      descriptors,
      keys: Reflect.ownKeys(descriptors),
      plainDataRecord: !array && (prototype === Object.prototype || prototype === null),
    };
  } catch {
    throw envelopeError();
  }
}

function isEnvelopeCandidate(snapshot) {
  if (!snapshot) return false;
  const descriptor = snapshot.descriptors.protection;
  if (!descriptor) return false;
  // A256GCM is the persistence discriminator. Other field names are valid
  // business-result keys and must not turn local plaintext into an envelope.
  // An accessor cannot be trusted as a discriminator, so keep it on the
  // fail-closed envelope-validation path without invoking the getter.
  return !hasOwn(descriptor, "value") || descriptor.value === PROTECTION;
}

function decodeCanonicalBase64(value, options = {}) {
  if (typeof value !== "string" || !value) throw envelopeError();
  const expectedBytes = options.expectedBytes;
  const maximumBytes = options.maximumBytes;
  const derivedMaximumEncodedCharacters = expectedBytes === undefined
    ? 4 * Math.ceil(maximumBytes / 3)
    : 4 * Math.ceil(expectedBytes / 3);
  const maximumEncodedCharacters = options.maximumEncodedCharacters === undefined
    ? derivedMaximumEncodedCharacters
    : options.maximumEncodedCharacters;
  if (!Number.isSafeInteger(maximumEncodedCharacters)
    || maximumEncodedCharacters < 4
    || maximumEncodedCharacters !== derivedMaximumEncodedCharacters
    || value.length > maximumEncodedCharacters) {
    throw envelopeError();
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw envelopeError();
  }
  const paddingBytes = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedByteLength = (value.length / 4) * 3 - paddingBytes;
  if (!Number.isSafeInteger(decodedByteLength)
    || decodedByteLength < 1
    || (expectedBytes !== undefined && decodedByteLength !== expectedBytes)
    || (maximumBytes !== undefined && decodedByteLength > maximumBytes)) {
    throw envelopeError();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw envelopeError();
  if (decoded.length !== decodedByteLength) throw envelopeError();
  return decoded;
}

function validateEnvelopeSnapshot(snapshot) {
  if (!snapshot
    || snapshot.plainDataRecord !== true
    || snapshot.keys.some((key) => typeof key !== "string")) {
    throw envelopeError();
  }
  const fields = [...snapshot.keys].sort();
  if (fields.length !== ENVELOPE_FIELDS.length
    || fields.some((field, index) => field !== ENVELOPE_FIELDS[index])) {
    throw envelopeError();
  }
  const values = Object.create(null);
  for (const field of ENVELOPE_FIELDS) {
    const descriptor = snapshot.descriptors[field];
    if (!descriptor || !hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      throw envelopeError();
    }
    values[field] = descriptor.value;
  }
  if (values.protection !== PROTECTION || !validateKeyId(values.keyId)) throw envelopeError();
  if (typeof values.bindingDigest !== "string" || !/^[a-f0-9]{64}$/.test(values.bindingDigest)) {
    throw envelopeError();
  }
  const iv = decodeCanonicalBase64(values.iv, {
    expectedBytes: COMMAND_RESULT_PROTECTION_POLICY.ivBytes,
  });
  const tag = decodeCanonicalBase64(values.tag, {
    expectedBytes: COMMAND_RESULT_PROTECTION_POLICY.tagBytes,
  });
  const ciphertext = decodeCanonicalBase64(values.ciphertext, {
    maximumBytes: COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBytes,
    maximumEncodedCharacters: COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBase64Characters,
  });
  if (Buffer.byteLength(JSON.stringify(values), "utf8")
    > COMMAND_RESULT_PROTECTION_POLICY.maximumEnvelopeBytes) {
    throw envelopeError();
  }
  return {
    metadata: {
      protected: true,
      codecVersion: CODEC_VERSION,
      keyId: values.keyId,
    },
    values: Object.freeze(values),
    iv,
    tag,
    ciphertext,
  };
}

function validateEnvelope(stored) {
  return validateEnvelopeSnapshot(descriptorSnapshot(stored));
}

function inspectEnvelope(stored) {
  try {
    return validateEnvelope(stored).metadata;
  } catch (error) {
    if (error && error.code === "COMMAND_RESULT_ENVELOPE_INVALID") throw error;
    throw envelopeError();
  }
}

function resolveConfiguration(env = process.env) {
  const protectedRuntime = isProtectedRuntime(env);
  const secretConfigured = hasOwn(env, "ROOT_COMMAND_RESULT_ENCRYPTION_KEY");
  const keyIdConfigured = hasOwn(env, "ROOT_COMMAND_RESULT_KEY_ID");
  const previousConfigured = hasOwn(env, PREVIOUS_KEYS_ENV);
  const secret = secretConfigured ? env.ROOT_COMMAND_RESULT_ENCRYPTION_KEY : undefined;
  const keyId = keyIdConfigured
    ? env.ROOT_COMMAND_RESULT_KEY_ID
    : undefined;
  if (!secretConfigured && !keyIdConfigured && !previousConfigured && !protectedRuntime) {
    return { protectedRuntime, enabled: false, keyId: "" };
  }
  if (!secret && protectedRuntime) {
    throw protectionError(
      "COMMAND_RESULT_KEY_REQUIRED",
      "ROOT_COMMAND_RESULT_ENCRYPTION_KEY is required"
    );
  }
  if (!isValidSecret(secret)) {
    throw protectionError(
      "COMMAND_RESULT_KEY_REQUIRED",
      "ROOT_COMMAND_RESULT_ENCRYPTION_KEY does not satisfy protection requirements"
    );
  }
  if (keyId === undefined || keyId === "") {
    throw protectionError("COMMAND_RESULT_KEY_ID_REQUIRED", "ROOT_COMMAND_RESULT_KEY_ID is required");
  }
  if (!validateKeyId(keyId)) {
    throw protectionError(
      "COMMAND_RESULT_KEY_ID_INVALID",
      "ROOT_COMMAND_RESULT_KEY_ID has an invalid format"
    );
  }
  const rotation = rotationConfiguration(env, keyId);
  const keys = new Map();
  for (const [previousKeyId, previousSecret] of rotation.previous.entries()) {
    keys.set(previousKeyId, crypto.createHash("sha256").update(previousSecret, "utf8").digest());
  }
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  keys.set(keyId, key);
  return {
    protectedRuntime,
    enabled: true,
    keyId,
    key,
    keys,
    policy: rotation.policy,
  };
}

function createCommandResultCodec(env = process.env) {
  let configuration;
  function config() {
    if (!configuration) configuration = resolveConfiguration(env);
    return configuration;
  }

  return {
    inspectEnvelope,
    encode(value, options = {}) {
      const current = config();
      const serialized = serializeWithinLimit(value);
      if (!current.enabled) return JSON.parse(serialized);
      const expectedBindingDigest = bindingDigest(options.binding);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", current.key, iv);
      cipher.setAAD(Buffer.from(`myroot-command-result:${current.keyId}:${expectedBindingDigest}`, "utf8"));
      const plaintext = Buffer.from(serialized, "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        protection: PROTECTION,
        keyId: current.keyId,
        bindingDigest: expectedBindingDigest,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
    },
    decode(stored, options = {}) {
      let snapshot;
      try {
        snapshot = descriptorSnapshot(stored);
      } catch (error) {
        if (error && error.code === "COMMAND_RESULT_ENVELOPE_INVALID") throw error;
        throw envelopeError();
      }
      if (!isEnvelopeCandidate(snapshot)) {
        const current = config();
        if (current.protectedRuntime) {
          throw protectionError("COMMAND_RESULT_REKEY_REQUIRED", "Protected runtime cannot replay an unprotected command result", 409);
        }
        return cloneWithinLimit(stored);
      }
      let validated;
      try {
        validated = validateEnvelopeSnapshot(snapshot);
      } catch (error) {
        if (error && error.code === "COMMAND_RESULT_ENVELOPE_INVALID") throw error;
        throw envelopeError();
      }
      const current = config();
      if (!current.enabled) {
        throw protectionError("COMMAND_RESULT_KEY_UNAVAILABLE", "Command result encryption key is unavailable", 409);
      }
      const keyState = classifyKeyId(validated.values.keyId, current.policy);
      if (keyState === "RETIRED") {
        throw protectionError("COMMAND_RESULT_KEY_RETIRED", "Command result encryption key is retired", 409);
      }
      const decryptionKey = current.keys.get(validated.values.keyId);
      if (!decryptionKey || keyState === "UNKNOWN") {
        throw protectionError("COMMAND_RESULT_KEY_UNAVAILABLE", "Command result encryption key is unavailable", 409);
      }
      const expectedBindingDigest = bindingDigest(options.binding);
      if (validated.values.bindingDigest !== expectedBindingDigest) {
        throw protectionError("COMMAND_RESULT_BINDING_MISMATCH", "Command result binding could not be verified", 409);
      }
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", decryptionKey, validated.iv);
        decipher.setAAD(Buffer.from(`myroot-command-result:${validated.values.keyId}:${expectedBindingDigest}`, "utf8"));
        decipher.setAuthTag(validated.tag);
        const plaintextBytes = Buffer.concat([
          decipher.update(validated.ciphertext),
          decipher.final(),
        ]);
        const plaintext = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
        return JSON.parse(plaintext);
      } catch {
        throw protectionError("COMMAND_RESULT_DECRYPT_FAILED", "Command result could not be verified", 409);
      }
    },
    getStatus() {
      try {
        const current = config();
        return {
          ready: true,
          enabled: current.enabled,
          status: current.enabled ? "COMMAND_RESULT_PROTECTION_READY" : "LOCAL_PLAINTEXT_COMPATIBILITY",
        };
      } catch (error) {
        return {
          ready: false,
          enabled: false,
          status: error.code || "COMMAND_RESULT_PROTECTION_UNAVAILABLE",
        };
      }
    },
    assertReady() {
      config();
      return true;
    },
  };
}

module.exports = {
  createCommandResultCodec,
};
