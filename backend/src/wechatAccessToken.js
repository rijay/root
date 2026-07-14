const crypto = require("node:crypto");
const { fetchWechatJson } = require("./wechatHttp");

const STABLE_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const tokenCache = new Map();
const tokenRequests = new Map();

function text(value) {
  return String(value || "").trim();
}

function credentialFor(config = {}) {
  return {
    appid: text(config.appid || config.appId),
    secret: text(config.secret || config.appSecret),
  };
}

function cacheKey(credential) {
  return crypto
    .createHash("sha256")
    .update(`${credential.appid}\n${credential.secret}`)
    .digest("hex");
}

function tokenError(message) {
  const error = new Error(message);
  error.code = 1006;
  return error;
}

async function resolveWechatAccessToken(config = {}, options = {}) {
  const credential = credentialFor(config);
  if (!credential.appid || !credential.secret) {
    throw tokenError("微信稳定版接口调用凭据缺少 AppID 或 AppSecret");
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const key = cacheKey(credential);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > nowMs + REFRESH_AHEAD_MS) return cached.token;

  if (tokenRequests.has(key)) return tokenRequests.get(key);

  const request = (async () => {
    const fetchJson = typeof options.fetchJson === "function" ? options.fetchJson : fetchWechatJson;
    const payload = await fetchJson(new URL(STABLE_TOKEN_URL), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: credential.appid,
        secret: credential.secret,
        force_refresh: false,
      }),
    });
    const token = text(payload && payload.access_token);
    if (!token) throw tokenError("微信稳定版接口调用凭据响应缺少 access_token");
    const rawExpiresIn = Number(payload && payload.expires_in);
    const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 7200;
    tokenCache.set(key, {
      token,
      expiresAtMs: nowMs + expiresIn * 1000,
    });
    return token;
  })();

  tokenRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (tokenRequests.get(key) === request) tokenRequests.delete(key);
  }
}

function clearWechatAccessTokenCache() {
  tokenCache.clear();
  tokenRequests.clear();
}

module.exports = {
  clearWechatAccessTokenCache,
  resolveWechatAccessToken,
};
