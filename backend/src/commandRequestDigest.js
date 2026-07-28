const crypto = require("node:crypto");

const { isProtectedRuntime } = require("./credentialProtection");
const {
  KEY_ID_PATTERN,
  assertDisjointKeyPolicy,
  classifyKeyId,
  parsePreviousKeyring,
  parseRetiredKeyIds,
} = require("./keyRotationConfiguration");

const CANONICAL_VERSION = "canonical-json:v1";
const DIGEST_VERSION = "hmac-sha256:v1";
const LEGACY_DIGEST_VERSION = "sha256:v0";
const LOCAL_KEY_ID = "local-development-v1";
const LOCAL_SECRET = "myroot-local-command-request-digest-key-2026-07-only";
const DOMAIN = "myroot-command-request-digest";
const PREVIOUS_KEYS_ENV = "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON";
const RETIRED_KEYS_ENV = "ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON";

function digestError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function configurationError(code, message) {
  return digestError(code, message, 503);
}

function ownDataValue(input, key, required = true) {
  const property = Object.getOwnPropertyDescriptor(input, key);
  if (!property) {
    if (!required) return undefined;
    throw digestError("COMMAND_REQUEST_DESCRIPTOR_INVALID", "Command request descriptor is invalid");
  }
  if (typeof property.get === "function" || typeof property.set === "function") {
    throw digestError("COMMAND_REQUEST_DESCRIPTOR_INVALID", "Command request descriptor is invalid");
  }
  return property.value;
}

function normalizeScopeValue(value, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw digestError("COMMAND_REQUEST_DESCRIPTOR_INVALID", "Command request descriptor is invalid");
  }
  return value;
}

function normalizeDescriptor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw digestError("COMMAND_REQUEST_DESCRIPTOR_INVALID", "Command request descriptor is invalid");
  }
  try {
    return {
      commandName: normalizeScopeValue(ownDataValue(input, "commandName"), 96),
      actorId: normalizeScopeValue(ownDataValue(input, "actorId"), 128),
      idempotencyKey: normalizeScopeValue(ownDataValue(input, "idempotencyKey"), 191),
      request: ownDataValue(input, "request", false),
    };
  } catch (error) {
    if (error && error.code === "COMMAND_REQUEST_DESCRIPTOR_INVALID") throw error;
    throw digestError("COMMAND_REQUEST_DESCRIPTOR_INVALID", "Command request descriptor is invalid");
  }
}

function canonicalizationFailure() {
  return digestError(
    "COMMAND_REQUEST_NOT_CANONICALIZABLE",
    "Command request cannot be represented as canonical JSON"
  );
}

function canonicalize(value, stack = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw canonicalizationFailure();
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw canonicalizationFailure();
  if (stack.has(value)) throw canonicalizationFailure();

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      throw canonicalizationFailure();
    }
    const enumerableKeys = Object.keys(value);
    if (enumerableKeys.length !== value.length) throw canonicalizationFailure();
    stack.add(value);
    try {
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw canonicalizationFailure();
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (!property || typeof property.get === "function" || typeof property.set === "function") {
          throw canonicalizationFailure();
        }
        entries.push(canonicalize(property.value, stack));
      }
      return `[${entries.join(",")}]`;
    } finally {
      stack.delete(value);
    }
  }

  if (prototype !== Object.prototype && prototype !== null) throw canonicalizationFailure();
  if (Object.getOwnPropertySymbols(value).length > 0) throw canonicalizationFailure();
  stack.add(value);
  try {
    const entries = Object.keys(value).sort().map((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || typeof property.get === "function" || typeof property.set === "function") {
        throw canonicalizationFailure();
      }
      return `${JSON.stringify(key)}:${canonicalize(property.value, stack)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

function canonicalRequest(request) {
  try {
    return canonicalize(request === undefined ? null : request);
  } catch (error) {
    if (error && error.code === "COMMAND_REQUEST_NOT_CANONICALIZABLE") throw error;
    throw canonicalizationFailure();
  }
}

function framed(value) {
  const content = Buffer.from(value, "utf8");
  if (content.length > 0xffffffff) throw canonicalizationFailure();
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(content.length);
  return Buffer.concat([length, content]);
}

function domainSeparatedMessage(descriptor, canonical, keyId) {
  return Buffer.concat([
    framed(DOMAIN),
    framed(DIGEST_VERSION),
    framed(CANONICAL_VERSION),
    framed(keyId),
    framed(descriptor.commandName),
    framed(descriptor.actorId),
    framed(descriptor.idempotencyKey),
    framed(canonical),
  ]);
}

function rawEnvironmentValue(env, key, invalidCode) {
  let value;
  try {
    value = env && env[key];
  } catch {
    throw configurationError(invalidCode, "Command request digest configuration is invalid");
  }
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw configurationError(invalidCode, "Command request digest configuration is invalid");
  }
  return value;
}

function isValidSecret(secret) {
  if (typeof secret !== "string") return false;
  const byteLength = Buffer.byteLength(secret, "utf8");
  const distinctCharacters = new Set(Array.from(secret)).size;
  return !(
    byteLength < 32
    || byteLength > 4096
    || secret !== secret.trim()
    || secret.includes("\u0000")
    || distinctCharacters < 8
  );
}

function validateSecret(secret) {
  if (!isValidSecret(secret)) {
    throw configurationError(
      "COMMAND_REQUEST_DIGEST_KEY_INVALID",
      "Command request digest key does not meet strength requirements"
    );
  }
}

function validateKeyId(keyId) {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw configurationError(
      "COMMAND_REQUEST_DIGEST_KEY_ID_INVALID",
      "Command request digest key identifier is invalid"
    );
  }
}

function hasEnvironmentValue(env, key, invalidCode) {
  try {
    return Boolean(env) && Object.prototype.hasOwnProperty.call(env, key);
  } catch {
    throw configurationError(invalidCode, "Command request digest configuration is invalid");
  }
}

function rotationConfiguration(env, activeKeyId) {
  try {
    const previousRaw = hasEnvironmentValue(
      env,
      PREVIOUS_KEYS_ENV,
      "COMMAND_REQUEST_DIGEST_KEY_RING_INVALID"
    )
      ? rawEnvironmentValue(env, PREVIOUS_KEYS_ENV, "COMMAND_REQUEST_DIGEST_KEY_RING_INVALID")
      : undefined;
    const retiredRaw = hasEnvironmentValue(
      env,
      RETIRED_KEYS_ENV,
      "COMMAND_REQUEST_DIGEST_RETIRED_KEYS_INVALID"
    )
      ? rawEnvironmentValue(env, RETIRED_KEYS_ENV, "COMMAND_REQUEST_DIGEST_RETIRED_KEYS_INVALID")
      : undefined;
    const previous = parsePreviousKeyring(previousRaw, {
      activeKeyId,
      validateSecret: isValidSecret,
    });
    const retired = parseRetiredKeyIds(retiredRaw).REQUEST_DIGEST;
    const policy = {
      currentKeyId: activeKeyId,
      previousKeyIds: [...previous.keys()].sort(),
      retiredKeyIds: [...retired],
    };
    assertDisjointKeyPolicy(policy);
    return { previous, policy };
  } catch (error) {
    if (error && String(error.code || "").startsWith("COMMAND_REQUEST_DIGEST_")) throw error;
    throw configurationError(
      "COMMAND_REQUEST_DIGEST_KEY_RING_INVALID",
      "Command request digest key rotation configuration is invalid"
    );
  }
}

function resolveConfiguration(env = process.env) {
  const protectedRuntime = isProtectedRuntime(env);
  const configuredSecret = rawEnvironmentValue(
    env,
    "ROOT_COMMAND_REQUEST_DIGEST_KEY",
    "COMMAND_REQUEST_DIGEST_KEY_INVALID"
  );
  const configuredKeyId = rawEnvironmentValue(
    env,
    "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID",
    "COMMAND_REQUEST_DIGEST_KEY_ID_INVALID"
  );
  const previousConfigured = hasEnvironmentValue(
    env,
    PREVIOUS_KEYS_ENV,
    "COMMAND_REQUEST_DIGEST_KEY_RING_INVALID"
  );
  const hasExplicitConfiguration = Boolean(configuredSecret || configuredKeyId || previousConfigured);

  if (!hasExplicitConfiguration && !protectedRuntime) {
    return {
      keyId: LOCAL_KEY_ID,
      secret: LOCAL_SECRET,
      keys: new Map([[LOCAL_KEY_ID, LOCAL_SECRET]]),
      policy: {
        currentKeyId: LOCAL_KEY_ID,
        previousKeyIds: [],
        retiredKeyIds: [],
      },
      local: true,
    };
  }
  if (!configuredSecret) {
    throw configurationError(
      "COMMAND_REQUEST_DIGEST_KEY_REQUIRED",
      "Active command request digest key is required"
    );
  }
  if (!configuredKeyId) {
    throw configurationError(
      "COMMAND_REQUEST_DIGEST_KEY_ID_REQUIRED",
      "Active command request digest key identifier is required"
    );
  }
  validateSecret(configuredSecret);
  validateKeyId(configuredKeyId);
  const rotation = rotationConfiguration(env, configuredKeyId);
  const keys = new Map(rotation.previous);
  keys.set(configuredKeyId, configuredSecret);
  return {
    keyId: configuredKeyId,
    secret: configuredSecret,
    keys,
    policy: rotation.policy,
    local: false,
  };
}

function safeHexEqual(expected, candidate) {
  if (!/^[a-f0-9]{64}$/.test(candidate)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  return expectedBuffer.length === candidateBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}

function normalizeStoredDigest(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  let canonicalVersion;
  let digestVersion;
  let keyId;
  let digest;
  try {
    canonicalVersion = ownDataValue(stored, "canonicalVersion", false);
    digestVersion = ownDataValue(stored, "digestVersion", false);
    keyId = ownDataValue(stored, "keyId", false);
    const storedDigest = ownDataValue(stored, "digest", false);
    canonicalVersion = typeof canonicalVersion === "string" ? canonicalVersion : "";
    digestVersion = typeof digestVersion === "string" ? digestVersion : "";
    keyId = typeof keyId === "string" ? keyId : "";
    digest = typeof storedDigest === "string" ? storedDigest.toLowerCase() : "";
  } catch {
    return null;
  }
  if (
    canonicalVersion !== CANONICAL_VERSION
    || digestVersion !== DIGEST_VERSION
    || !KEY_ID_PATTERN.test(keyId)
    || !/^[a-f0-9]{64}$/.test(digest)
  ) return null;
  return { canonicalVersion, digestVersion, keyId, digest };
}

function createCommandRequestDigestCodec(env = process.env) {
  let configuration;

  function config() {
    if (!configuration) configuration = resolveConfiguration(env);
    return configuration;
  }

  function digestWithKey(input, keyId, secret) {
    const descriptor = normalizeDescriptor(input);
    const canonical = canonicalRequest(descriptor.request);
    const value = crypto.createHmac("sha256", secret)
      .update(domainSeparatedMessage(descriptor, canonical, keyId))
      .digest("hex");
    return Object.freeze({
      canonicalVersion: CANONICAL_VERSION,
      digestVersion: DIGEST_VERSION,
      keyId,
      digest: value,
    });
  }

  function digest(input) {
    const current = config();
    return digestWithKey(input, current.keyId, current.secret);
  }

  return Object.freeze({
    digest,
    verify(stored, input) {
      const current = config();
      const candidate = normalizeStoredDigest(stored);
      if (!candidate || classifyKeyId(candidate.keyId, current.policy) === "RETIRED") return false;
      const secret = current.keys.get(candidate.keyId);
      if (!secret) return false;
      const expected = digestWithKey(input, candidate.keyId, secret);
      return safeHexEqual(expected.digest, candidate.digest);
    },
    classifyKeyId(keyId) {
      return classifyKeyId(keyId, config().policy);
    },
    getStatus() {
      try {
        const current = config();
        return {
          ready: true,
          status: current.local ? "LOCAL_COMMAND_REQUEST_DIGEST_KEY" : "COMMAND_REQUEST_DIGEST_READY",
          canonicalVersion: CANONICAL_VERSION,
          digestVersion: DIGEST_VERSION,
          keyId: current.keyId,
        };
      } catch (error) {
        return {
          ready: false,
          status: error && error.code ? error.code : "COMMAND_REQUEST_DIGEST_UNAVAILABLE",
          canonicalVersion: CANONICAL_VERSION,
          digestVersion: DIGEST_VERSION,
        };
      }
    },
    assertReady() {
      config();
      return true;
    },
  });
}

function legacyStableSerialize(value, stack = new Set(), arrayEntry = false) {
  if (value === null) return "null";
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return arrayEntry ? "null" : undefined;
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw canonicalizationFailure();
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw canonicalizationFailure();
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (stack.has(value)) throw canonicalizationFailure();
  if (!value || typeof value !== "object") throw canonicalizationFailure();

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => legacyStableSerialize(item, stack, true)).join(",")}]`;
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, legacyStableSerialize(value[key], stack, false)])
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}:${item}`);
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

function legacyDigestValue(stored) {
  if (typeof stored === "string") return stored.toLowerCase();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return "";
  try {
    const digestVersion = ownDataValue(stored, "digestVersion", false);
    const digest = ownDataValue(stored, "digest", false);
    if (digestVersion !== LEGACY_DIGEST_VERSION || typeof digest !== "string") return "";
    return digest.toLowerCase();
  } catch {
    return "";
  }
}

function verifyLegacySha256V0(stored, request) {
  const candidate = legacyDigestValue(stored);
  if (!/^[a-f0-9]{64}$/.test(candidate)) return false;
  let canonical;
  try {
    canonical = legacyStableSerialize(request === undefined ? null : request);
  } catch (error) {
    if (error && error.code === "COMMAND_REQUEST_NOT_CANONICALIZABLE") throw error;
    throw canonicalizationFailure();
  }
  const expected = crypto.createHash("sha256").update(canonical).digest("hex");
  return safeHexEqual(expected, candidate);
}

module.exports = {
  createCommandRequestDigestCodec,
  verifyLegacySha256V0,
};
