const crypto = require("node:crypto");

const tokenCache = new Map();

function text(value) {
  return String(value || "").trim();
}

function credentialFor(env = {}) {
  return {
    corpId: text(env.WEWORK_CORP_ID),
    secret: text(env.WEWORK_CONTACT_SECRET || env.WEWORK_APP_SECRET || env.WEWORK_SECRET),
  };
}

function staticAccessToken(env = {}, names = []) {
  for (const name of names) {
    const value = text(env[name]);
    if (value) return value;
  }
  return text(env.WEWORK_ACCESS_TOKEN || env.WEWORK_CONTACT_ACCESS_TOKEN);
}

function cacheKey(credential) {
  return crypto.createHash("sha256").update(`${credential.corpId}\n${credential.secret}`).digest("hex");
}

function tokenError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

async function resolveWeworkAccessToken(env = {}, options = {}) {
  const direct = staticAccessToken(env, options.tokenEnvNames || []);
  if (direct) return direct;
  const credential = credentialFor(env);
  if (!credential.corpId || !credential.secret) {
    throw tokenError(400, "企业微信 AccessToken 缺少 WEWORK_CORP_ID 或 WEWORK_CONTACT_SECRET");
  }

  const nowMs = Number(options.nowMs) || Date.now();
  const key = cacheKey(credential);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > nowMs + 5 * 60 * 1000) return cached.token;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw tokenError(500, "当前 Node 环境没有可用 fetch Implementation");
  const tokenUrl = new URL(text(env.WEWORK_TOKEN_URL) || "https://qyapi.weixin.qq.com/cgi-bin/gettoken");
  tokenUrl.searchParams.set("corpid", credential.corpId);
  tokenUrl.searchParams.set("corpsecret", credential.secret);
  const response = await fetchImpl(tokenUrl, { method: "GET", headers: { Accept: "application/json" } });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw tokenError(502, `企业微信 AccessToken 响应不是合法 JSON：${error.message}`);
  }
  const errcode = Number(payload && payload.errcode);
  if (!response.ok || (Number.isFinite(errcode) && errcode !== 0) || !text(payload && payload.access_token)) {
    throw tokenError(
      Number.isFinite(errcode) && errcode !== 0 ? errcode : response.status || 502,
      `企业微信 AccessToken 获取失败：${text(payload && payload.errmsg) || `HTTP ${response.status || "FAILED"}`}`,
      payload,
    );
  }
  const token = text(payload.access_token);
  const expiresIn = Math.max(600, Number(payload.expires_in) || 7200);
  tokenCache.set(key, { token, expiresAtMs: nowMs + expiresIn * 1000 });
  return token;
}

function clearWeworkAccessTokenCache() {
  tokenCache.clear();
}

function isOfficialWeworkUrl(value, pathSuffix = "") {
  try {
    const url = new URL(text(value));
    return url.hostname === "qyapi.weixin.qq.com" && (!pathSuffix || url.pathname.endsWith(pathSuffix));
  } catch {
    return false;
  }
}

module.exports = {
  clearWeworkAccessTokenCache,
  credentialFor,
  isOfficialWeworkUrl,
  resolveWeworkAccessToken,
  staticAccessToken,
};
