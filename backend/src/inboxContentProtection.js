const crypto = require("node:crypto");

const { isProtectedRuntime } = require("./credentialProtection");
const { payloadSnapshot } = require("./eventTransport");

const PROTECTION = "A256GCM";
const CODEC_VERSION = "A256GCM:v1";
const DIGEST_SCHEME = "hmac-sha256:v1";
const DOMAIN = "myroot-inbox-content:v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PURPOSE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const MAX_DECRYPTION_KEYS = 8;
const MAX_DECRYPTION_KEYS_JSON_BYTES = 16 * 1024;
const MAX_PLAINTEXT_BYTES = Object.freeze({
  PAYLOAD: 64 * 1024,
  RESULT: 96 * 1024,
});
const ENVELOPE_FIELDS = Object.freeze([
  "bindingDigest",
  "ciphertext",
  "codecVersion",
  "contentDigest",
  "digestScheme",
  "iv",
  "keyId",
  "protection",
  "purpose",
  "tag",
]);

function contentError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  try {
    const serialized = JSON.stringify(value === undefined ? null : value);
    return JSON.parse(serialized);
  } catch {
    throw contentError("INBOX_CONTENT_INPUT_INVALID", "Inbox content must be JSON serializable", 409);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateSecret(secret) {
  return typeof secret === "string"
    && Buffer.byteLength(secret, "utf8") >= 32
    && secret === secret.trim()
    && !secret.includes("\u0000")
    && new Set(Array.from(secret)).size >= 8;
}

function validateKeyId(keyId) {
  return typeof keyId === "string" && KEY_ID_PATTERN.test(keyId);
}

function normalizePurpose(value) {
  if (typeof value !== "string" || !PURPOSE_PATTERN.test(value)) {
    throw contentError("INBOX_CONTENT_PURPOSE_INVALID", "Inbox content purpose is invalid", 409);
  }
  return value;
}

function bindingDigest(binding) {
  if (!plainRecord(binding)) {
    throw contentError("INBOX_CONTENT_BINDING_REQUIRED", "Inbox content binding is required", 409);
  }
  const normalized = clone(binding);
  if (!plainRecord(normalized) || Object.keys(normalized).length === 0) {
    throw contentError("INBOX_CONTENT_BINDING_REQUIRED", "Inbox content binding is required", 409);
  }
  return crypto.createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex");
}

function envelopeError() {
  return contentError("INBOX_CONTENT_ENVELOPE_INVALID", "Inbox content envelope is invalid", 409);
}

function decodeCanonicalBase64(value, expectedBytes) {
  if (typeof value !== "string" || !value
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw envelopeError();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value
    || (expectedBytes !== undefined && decoded.length !== expectedBytes)) throw envelopeError();
  return decoded;
}

function maximumBase64Length(byteLength) {
  return 4 * Math.ceil(byteLength / 3);
}

function validateEnvelope(stored) {
  if (!plainRecord(stored)) throw envelopeError();
  const fields = Object.keys(stored).sort();
  if (fields.length !== ENVELOPE_FIELDS.length
    || fields.some((field, index) => field !== ENVELOPE_FIELDS[index])
    || stored.protection !== PROTECTION
    || stored.codecVersion !== CODEC_VERSION
    || stored.digestScheme !== DIGEST_SCHEME
    || !validateKeyId(stored.keyId)
    || !hasOwn(MAX_PLAINTEXT_BYTES, stored.purpose)
    || typeof stored.bindingDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(stored.bindingDigest)
    || typeof stored.contentDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(stored.contentDigest)) throw envelopeError();
  if (typeof stored.ciphertext !== "string"
    || stored.ciphertext.length > maximumBase64Length(MAX_PLAINTEXT_BYTES[stored.purpose])) throw envelopeError();
  const iv = decodeCanonicalBase64(stored.iv, 12);
  const tag = decodeCanonicalBase64(stored.tag, 16);
  const ciphertext = decodeCanonicalBase64(stored.ciphertext);
  if (ciphertext.length === 0 || ciphertext.length > MAX_PLAINTEXT_BYTES[stored.purpose]) throw envelopeError();
  return { iv, tag, ciphertext };
}

function inspectEnvelope(stored) {
  validateEnvelope(stored);
  return Object.freeze({
    protected: true,
    codecVersion: CODEC_VERSION,
    digestScheme: DIGEST_SCHEME,
    keyId: stored.keyId,
    purpose: stored.purpose,
    contentDigest: stored.contentDigest,
  });
}

function deriveKey(secret) {
  const material = Buffer.from(secret, "utf8");
  const salt = Buffer.from(`${DOMAIN}:hkdf-salt`, "utf8");
  return Object.freeze({
    encryptionKey: Buffer.from(crypto.hkdfSync(
      "sha256",
      material,
      salt,
      Buffer.from(`${DOMAIN}:encryption`, "utf8"),
      32
    )),
    digestKey: Buffer.from(crypto.hkdfSync(
      "sha256",
      material,
      salt,
      Buffer.from(`${DOMAIN}:digest`, "utf8"),
      32
    )),
  });
}

function parsePreviousKeys(raw, activeKeyId) {
  if (raw === undefined) return new Map();
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_DECRYPTION_KEYS_JSON_BYTES) {
    throw contentError("INBOX_CONTENT_KEY_RING_INVALID", "Inbox content decryption key ring is invalid");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw contentError("INBOX_CONTENT_KEY_RING_INVALID", "Inbox content decryption key ring is invalid");
  }
  if (!plainRecord(parsed) || Object.keys(parsed).length > MAX_DECRYPTION_KEYS) {
    throw contentError("INBOX_CONTENT_KEY_RING_INVALID", "Inbox content decryption key ring is invalid");
  }
  const keys = new Map();
  for (const [keyId, secret] of Object.entries(parsed)) {
    if (!validateKeyId(keyId) || keyId === activeKeyId || !validateSecret(secret)) {
      throw contentError("INBOX_CONTENT_KEY_RING_INVALID", "Inbox content decryption key ring is invalid");
    }
    keys.set(keyId, deriveKey(secret));
  }
  return keys;
}

function resolveConfiguration(env = process.env) {
  const protectedRuntime = isProtectedRuntime(env);
  const secretConfigured = hasOwn(env, "ROOT_INBOX_CONTENT_ENCRYPTION_KEY");
  const keyIdConfigured = hasOwn(env, "ROOT_INBOX_CONTENT_KEY_ID");
  const previousConfigured = hasOwn(env, "ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON");
  if (!protectedRuntime && !secretConfigured && !keyIdConfigured && !previousConfigured) {
    return {
      protectedRuntime,
      enabled: false,
      activeKeyId: "",
      keys: new Map(),
    };
  }
  const secret = secretConfigured ? env.ROOT_INBOX_CONTENT_ENCRYPTION_KEY : undefined;
  const keyId = keyIdConfigured ? env.ROOT_INBOX_CONTENT_KEY_ID : undefined;
  if (!validateSecret(secret)) {
    throw contentError("INBOX_CONTENT_KEY_REQUIRED", "ROOT_INBOX_CONTENT_ENCRYPTION_KEY does not satisfy protection requirements");
  }
  if (keyId === undefined || keyId === "") {
    throw contentError("INBOX_CONTENT_KEY_ID_REQUIRED", "ROOT_INBOX_CONTENT_KEY_ID is required");
  }
  if (!validateKeyId(keyId)) {
    throw contentError("INBOX_CONTENT_KEY_ID_INVALID", "ROOT_INBOX_CONTENT_KEY_ID has an invalid format");
  }
  const keys = parsePreviousKeys(
    previousConfigured ? env.ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON : undefined,
    keyId
  );
  keys.set(keyId, deriveKey(secret));
  return {
    protectedRuntime,
    enabled: true,
    activeKeyId: keyId,
    keys,
  };
}

function digestWithKey(key, keyId, value, purpose, expectedBindingDigest) {
  const normalized = clone(value);
  return crypto.createHmac("sha256", key.digestKey)
    .update(`${DOMAIN}:digest:${keyId}:${purpose}:${expectedBindingDigest}:`, "utf8")
    .update(canonicalJson(normalized), "utf8")
    .digest("hex");
}

function byteEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function createInboxContentCodec(env = process.env) {
  let configuration;
  function config() {
    if (!configuration) configuration = resolveConfiguration(env);
    return configuration;
  }

  function keyFor(keyId) {
    const key = config().keys.get(keyId);
    if (!key) throw contentError("INBOX_CONTENT_KEY_UNAVAILABLE", "Inbox content encryption key is unavailable", 409);
    return key;
  }

  function digest(value, options = {}) {
    const purpose = normalizePurpose(options.purpose);
    const expectedBindingDigest = bindingDigest(options.binding);
    const current = config();
    if (!current.enabled) return payloadSnapshot(value).digest;
    const keyId = options.keyId === undefined ? current.activeKeyId : options.keyId;
    if (!validateKeyId(keyId)) {
      throw contentError("INBOX_CONTENT_KEY_ID_INVALID", "Inbox content key identifier is invalid", 409);
    }
    return digestWithKey(keyFor(keyId), keyId, value, purpose, expectedBindingDigest);
  }

  return Object.freeze({
    inspectEnvelope,
    seal(value, options = {}) {
      const purpose = normalizePurpose(options.purpose);
      if (!hasOwn(MAX_PLAINTEXT_BYTES, purpose)) {
        throw contentError("INBOX_CONTENT_PURPOSE_INVALID", "Inbox content purpose cannot be persisted", 409);
      }
      const expectedBindingDigest = bindingDigest(options.binding);
      const normalized = clone(value);
      const serialized = JSON.stringify(normalized);
      if (Buffer.byteLength(serialized, "utf8") > MAX_PLAINTEXT_BYTES[purpose]) {
        throw contentError("INBOX_CONTENT_SIZE_LIMIT", "Inbox content exceeds its persistence limit", 409);
      }
      const current = config();
      if (!current.enabled) {
        return Object.freeze({
          stored: normalized,
          contentDigest: payloadSnapshot(normalized).digest,
          keyId: null,
          protected: false,
          codecVersion: "PLAINTEXT:v0",
          digestScheme: "sha256:v0",
        });
      }
      const keyId = current.activeKeyId;
      const key = keyFor(keyId);
      const contentDigest = digestWithKey(key, keyId, normalized, purpose, expectedBindingDigest);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key.encryptionKey, iv);
      cipher.setAAD(Buffer.from(`${DOMAIN}:${keyId}:${purpose}:${expectedBindingDigest}:${contentDigest}`, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(serialized, "utf8")),
        cipher.final(),
      ]);
      return Object.freeze({
        stored: {
          protection: PROTECTION,
          codecVersion: CODEC_VERSION,
          digestScheme: DIGEST_SCHEME,
          keyId,
          purpose,
          bindingDigest: expectedBindingDigest,
          contentDigest,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          ciphertext: ciphertext.toString("base64"),
        },
        contentDigest,
        keyId,
        protected: true,
        codecVersion: CODEC_VERSION,
        digestScheme: DIGEST_SCHEME,
      });
    },
    open(stored, options = {}) {
      const purpose = normalizePurpose(options.purpose);
      const expectedBindingDigest = bindingDigest(options.binding);
      if (!stored || stored.protection !== PROTECTION) {
        const current = config();
        if (current.protectedRuntime || current.enabled) {
          throw contentError("INBOX_CONTENT_REKEY_REQUIRED", "Protected Inbox content cannot replay plaintext", 409);
        }
        const value = clone(stored);
        return Object.freeze({
          value,
          contentDigest: payloadSnapshot(value).digest,
          keyId: null,
          protected: false,
          codecVersion: "PLAINTEXT:v0",
          digestScheme: "sha256:v0",
        });
      }
      const decoded = validateEnvelope(stored);
      if (stored.purpose !== purpose) {
        throw contentError("INBOX_CONTENT_PURPOSE_MISMATCH", "Inbox content purpose could not be verified", 409);
      }
      if (stored.bindingDigest !== expectedBindingDigest) {
        throw contentError("INBOX_CONTENT_BINDING_MISMATCH", "Inbox content binding could not be verified", 409);
      }
      const key = keyFor(stored.keyId);
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key.encryptionKey, decoded.iv);
        decipher.setAAD(Buffer.from(`${DOMAIN}:${stored.keyId}:${purpose}:${expectedBindingDigest}:${stored.contentDigest}`, "utf8"));
        decipher.setAuthTag(decoded.tag);
        const plaintext = Buffer.concat([
          decipher.update(decoded.ciphertext),
          decipher.final(),
        ]).toString("utf8");
        const value = JSON.parse(plaintext);
        const actualDigest = digestWithKey(key, stored.keyId, value, purpose, expectedBindingDigest);
        if (!byteEqual(actualDigest, stored.contentDigest)) throw new Error("digest mismatch");
        return Object.freeze({
          value,
          contentDigest: stored.contentDigest,
          keyId: stored.keyId,
          protected: true,
          codecVersion: CODEC_VERSION,
          digestScheme: DIGEST_SCHEME,
        });
      } catch (cause) {
        if (cause && /^INBOX_CONTENT_/.test(cause.code || "")) throw cause;
        const error = contentError("INBOX_CONTENT_DECRYPT_FAILED", "Inbox content could not be verified", 409);
        error.cause = cause;
        throw error;
      }
    },
    digest,
    verifyDigest(value, expected, options = {}) {
      try { return byteEqual(digest(value, options), expected); } catch { return false; }
    },
    getStatus() {
      try {
        const current = config();
        return {
          ready: true,
          enabled: current.enabled,
          status: current.enabled ? "INBOX_CONTENT_PROTECTION_READY" : "LOCAL_PLAINTEXT_COMPATIBILITY",
          decryptionKeyCount: current.keys.size,
        };
      } catch (error) {
        return {
          ready: false,
          enabled: false,
          status: error.code || "INBOX_CONTENT_PROTECTION_UNAVAILABLE",
          decryptionKeyCount: 0,
        };
      }
    },
    assertReady() {
      config();
      return true;
    },
  });
}

module.exports = {
  createInboxContentCodec,
};
