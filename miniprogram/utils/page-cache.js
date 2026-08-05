const PUBLIC_PREFIX = "MYROOT_PUBLIC_PAGE_CACHE_V1:";
const MAX_PUBLIC_CACHE_BYTES = 256 * 1024;
const sessionEntries = new Map();

function timestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function result(entry, options = {}) {
  if (!entry || typeof entry !== "object" || entry.version !== 1 || entry.value === undefined) return null;
  const updatedAt = timestamp(entry.updatedAt);
  const ageMs = Math.max(0, Date.now() - updatedAt);
  const maxStaleMs = Math.max(0, Number(options.maxStaleMs || 0));
  if (!updatedAt || (maxStaleMs && ageMs > maxStaleMs)) return null;
  return {
    value: entry.value,
    updatedAt,
    ageMs,
    fresh: ageMs <= Math.max(0, Number(options.freshForMs || 0)),
  };
}

function publicKey(key) {
  return `${PUBLIC_PREFIX}${String(key || "").trim()}`;
}

function readPublicPageCache(key, options = {}) {
  try {
    const cacheKey = publicKey(key);
    const cached = result(wx.getStorageSync(cacheKey), options);
    if (!cached) wx.removeStorageSync(cacheKey);
    return cached;
  } catch (_) {
    return null;
  }
}

function utf8ByteLength(value) {
  const text = String(value || "");
  try {
    return unescape(encodeURIComponent(text)).length;
  } catch (_) {
    return text.length * 3;
  }
}

function writePublicPageCache(key, value) {
  const entry = { version: 1, updatedAt: Date.now(), value };
  try {
    if (utf8ByteLength(JSON.stringify(entry)) > MAX_PUBLIC_CACHE_BYTES) return false;
    wx.setStorageSync(publicKey(key), entry);
    return true;
  } catch (_) {
    return false;
  }
}

function readSessionPageCache(key, options = {}) {
  const normalized = String(key || "").trim();
  const cached = result(sessionEntries.get(normalized), options);
  if (!cached) sessionEntries.delete(normalized);
  return cached;
}

function writeSessionPageCache(key, value) {
  const normalized = String(key || "").trim();
  if (!normalized) return false;
  sessionEntries.set(normalized, { version: 1, updatedAt: Date.now(), value });
  return true;
}

function clearSessionPageCache(key) {
  if (key === undefined) sessionEntries.clear();
  else sessionEntries.delete(String(key || "").trim());
}

function resetPageCacheForTests() {
  sessionEntries.clear();
}

module.exports = {
  clearSessionPageCache,
  readPublicPageCache,
  readSessionPageCache,
  resetPageCacheForTests,
  writePublicPageCache,
  writeSessionPageCache,
};
