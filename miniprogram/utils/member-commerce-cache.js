const { currentLoginSession } = require("./login-session");

const MEMBER_COMMERCE_CACHE_KEY = "ROOT_MEMBER_COMMERCE_CACHE_V1";
const MEMBER_COMMERCE_CACHE_VERSION = 1;
const FRESH_FOR_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

function safeStorage(method, value) {
  if (typeof wx === "undefined" || typeof wx[method] !== "function") return null;
  try {
    return value === undefined
      ? wx[method](MEMBER_COMMERCE_CACHE_KEY)
      : wx[method](MEMBER_COMMERCE_CACHE_KEY, value);
  } catch (_) {
    return null;
  }
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function normalize(value = {}) {
  const ready = value.status === "READY";
  return {
    status: ready ? "READY" : "UNAVAILABLE",
    reason: String(value.reason || "").trim().slice(0, 64),
    orders: ready ? {
      totalCount: nonNegativeInteger(value.orders && value.orders.totalCount),
      pendingCount: nonNegativeInteger(value.orders && value.orders.pendingCount),
    } : null,
    coupons: ready ? {
      availableCount: nonNegativeInteger(value.coupons && value.coupons.availableCount),
      expiringSoonCount: value.coupons && value.coupons.expiringSoonCount !== null
        && value.coupons.expiringSoonCount !== undefined
        ? nonNegativeInteger(value.coupons.expiringSoonCount)
        : null,
    } : null,
    priceSync: ready ? {
      syncedAt: String(value.priceSync && value.priceSync.syncedAt || "").trim().slice(0, 40),
    } : null,
  };
}

function readMemberCommerceCache(now = Date.now()) {
  const sessionId = String((currentLoginSession() || {}).sessionId || "").trim();
  const entry = safeStorage("getStorageSync");
  const updatedAt = Number(entry && entry.updatedAt);
  const ageMs = Math.max(0, Number(now) - updatedAt);
  if (!sessionId
    || !entry
    || entry.version !== MEMBER_COMMERCE_CACHE_VERSION
    || entry.sessionId !== sessionId
    || !Number.isFinite(updatedAt)
    || updatedAt <= 0
    || ageMs > MAX_STALE_MS) {
    return null;
  }
  return {
    value: normalize(entry.value),
    updatedAt,
    ageMs,
    fresh: ageMs <= FRESH_FOR_MS,
  };
}

function writeMemberCommerceCache(value, now = Date.now()) {
  const sessionId = String((currentLoginSession() || {}).sessionId || "").trim();
  if (!sessionId || !value) return false;
  safeStorage("setStorageSync", {
    version: MEMBER_COMMERCE_CACHE_VERSION,
    sessionId,
    updatedAt: Number(now),
    value: normalize(value),
  });
  return true;
}

function clearMemberCommerceCache() {
  safeStorage("removeStorageSync");
}

module.exports = Object.freeze({
  FRESH_FOR_MS,
  MAX_STALE_MS,
  MEMBER_COMMERCE_CACHE_KEY,
  MEMBER_COMMERCE_CACHE_VERSION,
  clearMemberCommerceCache,
  readMemberCommerceCache,
  writeMemberCommerceCache,
});
