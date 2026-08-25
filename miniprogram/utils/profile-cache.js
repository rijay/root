const { currentLoginSession } = require("./login-session");

const PROFILE_CACHE_KEY = "ROOT_PROFILE_CACHE_V1";
const PROFILE_CACHE_VERSION = 1;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeStorage(method, value) {
  if (typeof wx === "undefined" || typeof wx[method] !== "function") return null;
  try {
    return value === undefined
      ? wx[method](PROFILE_CACHE_KEY)
      : wx[method](PROFILE_CACHE_KEY, value);
  } catch (_) {
    return null;
  }
}

function safeAvatarUrl(value) {
  const url = String(value || "").trim();
  return /^(?:https:\/\/|cloud:\/\/|wxfile:\/\/|\/static\/)/.test(url) ? url.slice(0, 800) : "";
}

function present(profile = {}) {
  return {
    nickname: String(profile.nickname || "Root用户").trim().slice(0, 40) || "Root用户",
    avatarUrl: safeAvatarUrl(profile.avatarUrl || profile.avatar_url),
  };
}

function readProfileCache(now = Date.now()) {
  const session = currentLoginSession();
  const entry = safeStorage("getStorageSync");
  if (!session.sessionId
    || !entry
    || entry.version !== PROFILE_CACHE_VERSION
    || entry.sessionId !== session.sessionId
    || !Number.isFinite(Number(entry.updatedAt))
    || Math.max(0, Number(now) - Number(entry.updatedAt)) > MAX_CACHE_AGE_MS) {
    return null;
  }
  return { profile: present(entry.profile), updatedAt: Number(entry.updatedAt) };
}

function writeProfileCache(profile, now = Date.now()) {
  const session = currentLoginSession();
  if (!session.sessionId || !profile) return false;
  safeStorage("setStorageSync", {
    version: PROFILE_CACHE_VERSION,
    sessionId: session.sessionId,
    updatedAt: Number(now),
    profile: present(profile),
  });
  return true;
}

function clearProfileCache() {
  safeStorage("removeStorageSync");
}

module.exports = Object.freeze({
  MAX_CACHE_AGE_MS,
  PROFILE_CACHE_KEY,
  PROFILE_CACHE_VERSION,
  clearProfileCache,
  readProfileCache,
  writeProfileCache,
});
