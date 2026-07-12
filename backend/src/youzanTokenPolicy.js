function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function shouldEnforce(env = {}) {
  return text(env.NODE_ENV || process.env.NODE_ENV).toLowerCase() === "production" ||
    enabled(env.ROOT_ENFORCE_YOUZAN_TOKEN_POLICY);
}

function firstPresent(env, names) {
  for (const name of names) {
    if (text(env[name])) return { name, value: text(env[name]) };
  }
  return { name: names[0] || "YOUZAN_ACCESS_TOKEN_EXPIRES_AT", value: "" };
}

function buildYouzanTokenPolicyStatus(env = {}, options = {}) {
  const expiryNames = Array.from(new Set([
    ...(options.expiryNames || []),
    "YOUZAN_ACCESS_TOKEN_EXPIRES_AT",
  ]));
  const expiry = firstPresent(env, expiryNames);
  const parsedNow = Date.parse(options.now || "");
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const expiresAtMs = Date.parse(expiry.value);
  const minRemainingMinutes = Math.max(0, Number(options.minRemainingMinutes ?? env.YOUZAN_TOKEN_MIN_REMAINING_MINUTES) || 0);
  const remainingMinutes = Number.isFinite(expiresAtMs) ? Math.floor((expiresAtMs - nowMs) / 60000) : null;
  const mode = text(env.YOUZAN_TOKEN_MANAGEMENT_MODE).toUpperCase();
  const issues = [];
  if (mode !== "STATIC_ROTATION") issues.push("YOUZAN_TOKEN_MANAGEMENT_MODE=STATIC_ROTATION");
  if (!text(env.YOUZAN_CLIENT_ID)) issues.push("YOUZAN_CLIENT_ID");
  if (!text(env.YOUZAN_GRANT_ID)) issues.push("YOUZAN_GRANT_ID");
  if (!text(env.YOUZAN_TOKEN_ROTATION_OWNER)) issues.push("YOUZAN_TOKEN_ROTATION_OWNER");
  if (!expiry.value || !Number.isFinite(expiresAtMs)) {
    issues.push(`${expiry.name}=有效时间`);
  } else if (remainingMinutes <= minRemainingMinutes) {
    issues.push(`${expiry.name}=未过期且剩余>${minRemainingMinutes}分钟`);
  }
  return {
    enforced: shouldEnforce(env),
    ready: issues.length === 0,
    mode,
    expiresAt: expiry.value,
    expirySource: expiry.name,
    remainingMinutes,
    minRemainingMinutes,
    rotationOwnerPresent: Boolean(text(env.YOUZAN_TOKEN_ROTATION_OWNER)),
    grantIdPresent: Boolean(text(env.YOUZAN_GRANT_ID)),
    issues,
  };
}

function assertYouzanTokenReady(env = {}, options = {}) {
  const status = buildYouzanTokenPolicyStatus(env, options);
  if (!status.enforced || status.ready) return status;
  const error = new Error(`有赞 token 生产策略未就绪：${status.issues.join(", ")}`);
  error.code = 503;
  error.detail = {
    mode: status.mode,
    expirySource: status.expirySource,
    remainingMinutes: status.remainingMinutes,
    issues: status.issues,
  };
  throw error;
}

module.exports = {
  assertYouzanTokenReady,
  buildYouzanTokenPolicyStatus,
  shouldEnforce,
};
