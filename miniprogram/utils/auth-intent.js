const { REGISTERED_FORMAL_ROUTES, WELCOME_ROUTE } = require("../config/formal-launch-routes");

const AUTH_INTENT_STORAGE_KEY = "ROOT_AUTH_INTENT_V1";
const AUTH_INTENT_TTL_MS = 30 * 60 * 1000;
const excluded = new Set([
  `/${WELCOME_ROUTE}`,
  "/pages/login/index",
  "/pages/register/index",
]);
const allowed = new Set(REGISTERED_FORMAL_ROUTES.map((route) => `/${route}`));

function normalize(route) {
  const value = String(route || "").trim();
  if (!value || /^https?:\/\//i.test(value)) return "";
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const pathOnly = normalized.split("?")[0];
  return allowed.has(pathOnly) && !excluded.has(pathOnly) ? normalized : "";
}

function remember(route, now = Date.now()) {
  const value = normalize(route);
  if (!value) return false;
  wx.setStorageSync(AUTH_INTENT_STORAGE_KEY, {
    route: value,
    createdAt: now,
    expiresAt: now + AUTH_INTENT_TTL_MS,
  });
  return true;
}

function peek(now = Date.now()) {
  const intent = wx.getStorageSync(AUTH_INTENT_STORAGE_KEY);
  if (!intent || !normalize(intent.route) || Number(intent.expiresAt) <= now) {
    if (intent) wx.removeStorageSync(AUTH_INTENT_STORAGE_KEY);
    return "";
  }
  return normalize(intent.route);
}

function consume(now = Date.now()) {
  const route = peek(now);
  if (route) wx.removeStorageSync(AUTH_INTENT_STORAGE_KEY);
  return route;
}

module.exports = {
  AUTH_INTENT_STORAGE_KEY,
  AUTH_INTENT_TTL_MS,
  consume,
  peek,
  remember,
};
