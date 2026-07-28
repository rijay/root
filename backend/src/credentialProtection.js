const crypto = require("node:crypto");

const PHONE_FINGERPRINT_VERSION = "hmac-sha256:v1";
const SESSION_DIGEST_VERSION = "sha256:v1";
const LOCAL_PHONE_HMAC_KEY = "myroot-local-development-only-phone-hmac-key";

function text(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return text(value).replace(/\D/g, "");
}

function isProtectedRuntime(env = process.env) {
  return text(env.NODE_ENV).toLowerCase() === "production" || Boolean(
    text(env.ROOT_CLOUDBASE_ENV_ID) ||
    text(env.CLOUDBASE_ENV_ID) ||
    text(env.TCB_ENV_ID) ||
    text(env.TCB_ENV) ||
    text(env.SCF_NAMESPACE) ||
    text(env.K_SERVICE) ||
    text(env.WX_CLOUD_ENV)
  );
}

function resolvePhoneHmacKey(env = process.env) {
  const configured = text(env.ROOT_PHONE_HMAC_KEY);
  if (configured) return configured;
  if (!isProtectedRuntime(env)) return LOCAL_PHONE_HMAC_KEY;
  const error = new Error("ROOT_PHONE_HMAC_KEY is required in production and cloud runtimes");
  error.code = "PHONE_HMAC_KEY_REQUIRED";
  error.status = 503;
  throw error;
}

function phoneFingerprint(phone, env = process.env) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  const digest = crypto.createHmac("sha256", resolvePhoneHmacKey(env)).update(normalized, "utf8").digest("hex");
  return `${PHONE_FINGERPRINT_VERSION}:${digest}`;
}

function sessionTokenDigest(token) {
  const normalized = text(token);
  if (!normalized) return "";
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${SESSION_DIGEST_VERSION}:${digest}`;
}

function containsCredentialMaterial(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const entries = Array.isArray(value) ? value.map((item) => ["", item]) : Object.entries(value);
  return entries.some(([key, item]) => {
    const normalizedKey = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (["token", "accesstoken", "authorization", "bearer", "sessiontoken"].includes(normalizedKey)) return true;
    return containsCredentialMaterial(item, seen);
  });
}

function normalizePersistedCredentials(data = {}) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const protectedTokens = {};

  sessions.forEach((session) => {
    if (!session || typeof session !== "object") return;
    const legacyToken = text(session.token);
    const tokenHash = text(session.token_hash) || sessionTokenDigest(legacyToken);
    if (tokenHash) session.token_hash = tokenHash;
    if (Object.prototype.hasOwnProperty.call(session, "token")) delete session.token;
    if (tokenHash && session.user_id) protectedTokens[tokenHash] = session.user_id;
  });

  data.sessions = sessions;
  data.tokens = protectedTokens;
  // The legacy replay cache could contain complete login responses. Preserve
  // non-credential sentinels used by existing Store probes, but invalidate any
  // entry whose shape can carry bearer material.
  const legacyIdempotency = data.idempotency && typeof data.idempotency === "object"
    ? data.idempotency
    : {};
  data.idempotency = Object.fromEntries(Object.entries(legacyIdempotency)
    .filter(([, value]) => !containsCredentialMaterial(value)));
  return data;
}

module.exports = {
  PHONE_FINGERPRINT_VERSION,
  SESSION_DIGEST_VERSION,
  isProtectedRuntime,
  normalizePersistedCredentials,
  phoneFingerprint,
  resolvePhoneHmacKey,
  sessionTokenDigest,
};
