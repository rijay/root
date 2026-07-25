const ALLOWED_SOURCES = new Set(["CLOUDBASE", "WECHAT_GATEWAY"]);
const APP_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

function text(value) {
  return String(value || "").trim();
}

function assertionError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 401;
  return error;
}

function normalizeIdentifier(value, field) {
  const normalized = text(value);
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw assertionError("TRUSTED_WECHAT_IDENTITY_INVALID", `verified WeChat ${field} is invalid`);
  }
  return normalized;
}

function sessionIdentityError(message) {
  const error = new Error(message);
  error.code = "WECHAT_CODE2SESSION_IDENTITY_INVALID";
  error.status = 502;
  return error;
}

function normalizeWechatSessionIdentity(session, appCode) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw sessionIdentityError("WeChat code2session identity is missing");
  }
  let openid;
  let unionid = "";
  try {
    openid = normalizeIdentifier(session.openid, "openid");
    if (Object.prototype.hasOwnProperty.call(session, "unionid")) {
      unionid = normalizeIdentifier(session.unionid, "unionid");
    }
  } catch {
    throw sessionIdentityError("WeChat code2session identity is invalid");
  }
  const normalizedAppCode = text(appCode).toUpperCase();
  if (!APP_CODE_PATTERN.test(normalizedAppCode)) {
    throw sessionIdentityError("WeChat code2session appCode is invalid");
  }
  return {
    openid,
    unionid,
    appCode: normalizedAppCode,
    source: "WECHAT_CODE2SESSION",
  };
}

function normalizeVerifiedAssertion(assertion) {
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
    throw assertionError("TRUSTED_WECHAT_IDENTITY_INVALID", "verified WeChat identity assertion is missing");
  }
  const source = text(assertion.source).toUpperCase();
  if (!ALLOWED_SOURCES.has(source)) {
    throw assertionError("TRUSTED_WECHAT_IDENTITY_SOURCE_INVALID", "verified WeChat identity source is not allowed");
  }
  const openid = normalizeIdentifier(assertion.openid, "openid");
  const appCode = text(assertion.appCode || assertion.app_code).toUpperCase();
  if (!APP_CODE_PATTERN.test(appCode)) {
    throw assertionError(
      "TRUSTED_WECHAT_APP_CODE_INVALID",
      "verified WeChat appCode is missing or invalid"
    );
  }
  return {
    openid,
    unionid: assertion.unionid ? normalizeIdentifier(assertion.unionid, "unionid") : "",
    appCode,
    source,
  };
}

async function resolveTrustedWechatIdentity(options = {}) {
  if (typeof options.adapter !== "function") return null;
  const assertion = await options.adapter({
    request: options.request,
    env: options.env || process.env,
  });
  if (assertion === null || assertion === undefined) return null;
  return normalizeVerifiedAssertion(assertion);
}

module.exports = {
  ALLOWED_SOURCES,
  normalizeVerifiedAssertion,
  normalizeWechatSessionIdentity,
  resolveTrustedWechatIdentity,
};
