const { currentLoginSession } = require("./login-session");
const { requestWithDeadline } = require("./request");
const { prewarmSessionImage } = require("./session-image-cache");

const FRESH_FOR_MS = 2 * 60 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
const entries = new Map();
const inflight = new Map();

function cacheKey() {
  const sessionId = String((currentLoginSession() || {}).sessionId || "").trim();
  return sessionId || "anonymous";
}

function readActivityFeedCache() {
  const key = cacheKey();
  const entry = entries.get(key);
  if (!entry) return null;
  const ageMs = Math.max(0, Date.now() - entry.updatedAt);
  if (ageMs > MAX_STALE_MS) {
    entries.delete(key);
    return null;
  }
  return {
    value: entry.value,
    updatedAt: entry.updatedAt,
    ageMs,
    fresh: ageMs <= FRESH_FOR_MS,
  };
}

function loadActivityFeed(options = {}) {
  const key = cacheKey();
  const cached = readActivityFeedCache();
  if (!options.force && cached && cached.fresh) return Promise.resolve(cached.value);
  if (inflight.has(key)) return inflight.get(key);
  const pending = requestWithDeadline({
    url: "/api/v1/activities?pageSize=20",
    method: "GET",
    scope: "activity-feed-cache",
  }, 4000)
    .then((payload) => {
      if (cacheKey() === key) entries.set(key, { updatedAt: Date.now(), value: payload });
      return payload;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

function firstHeroUrl(payload) {
  const activities = payload && Array.isArray(payload.activities) ? payload.activities : [];
  return String((activities[0] || {}).heroAssetUrl || "").trim();
}

async function prewarmActivityFeed() {
  const cached = readActivityFeedCache();
  const payload = cached && cached.fresh ? cached.value : await loadActivityFeed();
  const heroUrl = firstHeroUrl(payload);
  if (heroUrl) await prewarmSessionImage(heroUrl);
  return payload;
}

function resetActivityFeedCacheForTests() {
  entries.clear();
  inflight.clear();
}

module.exports = Object.freeze({
  loadActivityFeed,
  prewarmActivityFeed,
  readActivityFeedCache,
  resetActivityFeedCacheForTests,
});
