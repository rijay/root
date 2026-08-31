const TRANSIENT_HEALTH_KEYS = Object.freeze({
  LAST_RESULT: "LAST_RESULT",
  SHARE_POSTER: "SHARE_POSTER",
});

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

module.exports = {
  TRANSIENT_HEALTH_KEYS,
  clearTransientHealthData,
  consumeTransientHealthData,
  setTransientHealthData,
};
