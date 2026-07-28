const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PREVIOUS_KEYRING_MAX_ENTRIES = 8;
const PREVIOUS_KEYRING_MAX_BYTES = 16 * 1024;
const RETIRED_KEY_IDS_MAX_ENTRIES_PER_DOMAIN = 32;
const RETIRED_KEY_IDS_MAX_BYTES = 8 * 1024;
const RETIRED_KEY_DOMAINS = Object.freeze([
  "REQUEST_DIGEST",
  "COMMAND_RESULT",
  "INBOX_CONTENT",
  "NOTIFICATION_RECEIPT",
]);

function invalidConfiguration() {
  const error = new Error("key rotation configuration is invalid");
  error.code = "KEY_ROTATION_CONFIGURATION_INVALID";
  return error;
}

function plainDataRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => Object.prototype.hasOwnProperty.call(descriptor, "value")
  );
}

function parseJsonRecord(raw, maximumBytes) {
  if (typeof raw !== "string"
    || raw.length < 2
    || Buffer.byteLength(raw, "utf8") > maximumBytes) {
    throw invalidConfiguration();
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw invalidConfiguration(); }
  if (!plainDataRecord(parsed)) throw invalidConfiguration();
  return parsed;
}

function parsePreviousKeyring(raw, options = {}) {
  if (raw === undefined) return new Map();
  const activeKeyId = options.activeKeyId;
  const validateSecret = options.validateSecret;
  if (!KEY_ID_PATTERN.test(activeKeyId || "") || typeof validateSecret !== "function") {
    throw invalidConfiguration();
  }
  const parsed = parseJsonRecord(
    raw,
    options.maximumBytes || PREVIOUS_KEYRING_MAX_BYTES
  );
  const entries = Object.entries(parsed);
  const maximumEntries = options.maximumEntries || PREVIOUS_KEYRING_MAX_ENTRIES;
  if (entries.length > maximumEntries) throw invalidConfiguration();
  const keyring = new Map();
  for (const [keyId, secret] of entries) {
    let secretValid = false;
    try { secretValid = validateSecret(secret) === true; } catch { /* stable failure below */ }
    if (!KEY_ID_PATTERN.test(keyId) || keyId === activeKeyId || !secretValid) {
      throw invalidConfiguration();
    }
    keyring.set(keyId, secret);
  }
  return keyring;
}

function emptyRetiredKeyIds() {
  return Object.freeze(Object.fromEntries(
    RETIRED_KEY_DOMAINS.map((domain) => [domain, Object.freeze([])])
  ));
}

function parseRetiredKeyIds(raw) {
  if (raw === undefined) return emptyRetiredKeyIds();
  const parsed = parseJsonRecord(raw, RETIRED_KEY_IDS_MAX_BYTES);
  if (Object.keys(parsed).sort().join(",") !== [...RETIRED_KEY_DOMAINS].sort().join(",")) {
    throw invalidConfiguration();
  }
  const output = {};
  for (const domain of RETIRED_KEY_DOMAINS) {
    const values = parsed[domain];
    if (!Array.isArray(values)
      || values.length > RETIRED_KEY_IDS_MAX_ENTRIES_PER_DOMAIN
      || values.some((value) => typeof value !== "string" || !KEY_ID_PATTERN.test(value))
      || new Set(values).size !== values.length) {
      throw invalidConfiguration();
    }
    output[domain] = Object.freeze([...values].sort());
  }
  return Object.freeze(output);
}

function assertDisjointKeyPolicy({ currentKeyId, previousKeyIds, retiredKeyIds }) {
  if (!KEY_ID_PATTERN.test(currentKeyId || "")
    || !Array.isArray(previousKeyIds)
    || !Array.isArray(retiredKeyIds)
    || previousKeyIds.some((keyId) => !KEY_ID_PATTERN.test(keyId))
    || retiredKeyIds.some((keyId) => !KEY_ID_PATTERN.test(keyId))
    || new Set(previousKeyIds).size !== previousKeyIds.length
    || new Set(retiredKeyIds).size !== retiredKeyIds.length
    || previousKeyIds.includes(currentKeyId)
    || retiredKeyIds.includes(currentKeyId)
    || previousKeyIds.some((keyId) => retiredKeyIds.includes(keyId))) {
    throw invalidConfiguration();
  }
  return true;
}

function classifyKeyId(keyId, policy) {
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) return "UNKNOWN";
  if (policy.retiredKeyIds.includes(keyId)) return "RETIRED";
  if (keyId === policy.currentKeyId) return "CURRENT";
  if (policy.previousKeyIds.includes(keyId)) return "PREVIOUS";
  return "UNKNOWN";
}

module.exports = {
  KEY_ID_PATTERN,
  PREVIOUS_KEYRING_MAX_BYTES,
  PREVIOUS_KEYRING_MAX_ENTRIES,
  RETIRED_KEY_DOMAINS,
  assertDisjointKeyPolicy,
  classifyKeyId,
  parsePreviousKeyring,
  parseRetiredKeyIds,
};
