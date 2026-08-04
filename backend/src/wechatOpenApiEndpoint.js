const { isProtectedRuntime } = require("./credentialProtection");

const DEFAULT_WECHAT_OPENAPI_BASE_URL = "https://api.weixin.qq.com";
const OFFICIAL_WECHAT_OPENAPI_ORIGIN = new URL(DEFAULT_WECHAT_OPENAPI_BASE_URL).origin;

function endpointError() {
  const error = new Error("WeChat OpenAPI endpoint is not trusted");
  error.code = "WECHAT_OPENAPI_ENDPOINT_UNTRUSTED";
  error.status = 503;
  return error;
}

function parseUrl(value) {
  try {
    return value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw endpointError();
  }
}

function isTestLoopbackOrigin(url, env = {}) {
  return env.NODE_ENV === "test"
    && !isProtectedRuntime(env)
    && url.protocol === "http:"
    && ["127.0.0.1", "[::1]"].includes(url.hostname);
}

function assertTrustedWechatOpenApiOrigin(url, env = {}) {
  const official = url.protocol === "https:" && url.origin === OFFICIAL_WECHAT_OPENAPI_ORIGIN;
  if ((!official && !isTestLoopbackOrigin(url, env)) || url.username || url.password) {
    throw endpointError();
  }
  return url;
}

function resolveWechatOpenApiUrl(pathname, env = {}) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    throw endpointError();
  }
  const rawBase = env.ROOT_WECHAT_OPENAPI_BASE_URL || DEFAULT_WECHAT_OPENAPI_BASE_URL;
  if (typeof rawBase !== "string" || !rawBase || rawBase !== rawBase.trim()) throw endpointError();
  const base = parseUrl(rawBase);
  assertTrustedWechatOpenApiOrigin(base, env);
  if (base.pathname !== "/" || base.search || base.hash) throw endpointError();
  const target = new URL(pathname, base);
  assertTrustedWechatOpenApiOrigin(target, env);
  if (target.origin !== base.origin) throw endpointError();
  return target;
}

module.exports = Object.freeze({
  DEFAULT_WECHAT_OPENAPI_BASE_URL,
  OFFICIAL_WECHAT_OPENAPI_ORIGIN,
  resolveWechatOpenApiUrl,
});
