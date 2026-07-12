const TRANSIENT_HEALTH_KEYS = Object.freeze({
  LAST_RESULT: "LAST_RESULT",
  SHARE_POSTER: "SHARE_POSTER",
});

const legacyStorageKeys = ["ROOT_LAST_RESULT", "ROOT_SHARE_POSTER_PAYLOAD"];
const values = new Map();

function assertKey(key) {
  if (!Object.values(TRANSIENT_HEALTH_KEYS).includes(key)) {
    throw new Error("Unsupported transient health state key");
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function setTransientHealthData(key, value) {
  assertKey(key);
  values.set(key, clone(value));
}

function consumeTransientHealthData(key, fallback = null) {
  assertKey(key);
  if (!values.has(key)) return fallback;
  const value = values.get(key);
  values.delete(key);
  return clone(value);
}

function clearTransientHealthData() {
  values.clear();
}

function clearLegacyTransientHealthStorage(apiValue) {
  const api = apiValue || (typeof wx !== "undefined" ? wx : null);
  if (!api || typeof api.removeStorageSync !== "function") return false;
  legacyStorageKeys.forEach((key) => api.removeStorageSync(key));
  return true;
}

module.exports = {
  TRANSIENT_HEALTH_KEYS,
  clearLegacyTransientHealthStorage,
  clearTransientHealthData,
  consumeTransientHealthData,
  setTransientHealthData,
};
