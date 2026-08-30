const { normalizeAppCode } = require("./identity");

const ALLOWED_SOURCE_PLATFORM_PAIRS = Object.freeze({
  wx_devtools: new Set(["devtools"]),
  wx_client: new Set(["android", "ios"]),
});

function text(value) {
  return String(value || "").trim();
}

function readHeader(headers = {}, name) {
  const value = headers[name] || headers[name.toLowerCase()];
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function assertionError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 401;
  return error;
}

function configuredCloudbaseEnvId(env = {}) {
  return text(env.ROOT_CLOUDBASE_ENV_ID || env.CLOUDBASE_ENV_ID || env.TCB_ENV_ID);
}

function configuredWechatAppId(env = {}) {
  return text(env.ROOT_WECHAT_APPID || env.WECHAT_APPID || env.WX_APPID);
}

function hasCloudbaseIdentityHeaders(headers = {}) {
  return [
    "x-wx-openid",
    "x-wx-unionid",
    "x-wx-appid",
    "x-wx-env",
    "x-wx-source",
    "x-wx-platform",
    "x-wx-from-openid",
    "x-wx-from-appid",
    "x-wx-from-unionid",
  ].some((name) => Boolean(readHeader(headers, name)));
}

function createCloudbaseTrustedWechatIdentityAdapter(env = {}) {
  const expectedEnvId = configuredCloudbaseEnvId(env);
  const expectedAppId = configuredWechatAppId(env);
  if (!expectedEnvId || !expectedAppId) return null;

  const appCode = normalizeAppCode(env.ROOT_WECHAT_APP_CODE || "MYROOT");
  return async function cloudbaseTrustedWechatIdentityAdapter({ request } = {}) {
    const headers = request && request.headers ? request.headers : {};
    if (!hasCloudbaseIdentityHeaders(headers)) return null;

    if (["x-wx-from-openid", "x-wx-from-appid", "x-wx-from-unionid"]
      .some((name) => Boolean(readHeader(headers, name)))) {
      throw assertionError(
        "CLOUDBASE_IDENTITY_RESOURCE_SHARING_UNSUPPORTED",
        "CloudBase resource-sharing identity requires a separately reviewed Adapter",
      );
    }

    const requestEnvId = readHeader(headers, "x-wx-env");
    const requestAppId = readHeader(headers, "x-wx-appid");
    const source = readHeader(headers, "x-wx-source").toLowerCase();
    const platform = readHeader(headers, "x-wx-platform").toLowerCase();
    const openid = readHeader(headers, "x-wx-openid");
    const unionid = readHeader(headers, "x-wx-unionid");

    if (requestEnvId !== expectedEnvId) {
      throw assertionError("CLOUDBASE_IDENTITY_ENV_MISMATCH", "CloudBase identity environment mismatch");
    }
    if (requestAppId !== expectedAppId) {
      throw assertionError("CLOUDBASE_IDENTITY_APPID_MISMATCH", "CloudBase identity AppID mismatch");
    }
    const allowedPlatforms = ALLOWED_SOURCE_PLATFORM_PAIRS[source];
    if (!allowedPlatforms || !allowedPlatforms.has(platform)) {
      // An unknown source/platform pair must never be trusted as a CloudBase
      // identity assertion. Returning null keeps that fail-closed boundary
      // while allowing the login flow to verify the supplied wxCode through
      // WeChat code2session instead of rejecting the user outright.
      return null;
    }
    if (!openid) {
      throw assertionError("CLOUDBASE_IDENTITY_OPENID_MISSING", "CloudBase identity openid is missing");
    }

    return {
      openid,
      unionid,
      appCode,
      source: "CLOUDBASE",
    };
  };
}

module.exports = {
  ALLOWED_SOURCE_PLATFORM_PAIRS,
  configuredCloudbaseEnvId,
  configuredWechatAppId,
  createCloudbaseTrustedWechatIdentityAdapter,
  hasCloudbaseIdentityHeaders,
  readHeader,
};
