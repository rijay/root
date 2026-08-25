const env = require("../config/env");

const STORAGE_KEY = "ROOT_LOCAL_HEALTH_ASSESSMENTS_V060";
const STORAGE_VERSION = 1;
const LOCAL_HEALTH_RETENTION_DAYS = Number(env.healthAssessmentRetentionDays) || 180;
const LOCAL_HEALTH_RETENTION_MS = LOCAL_HEALTH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pruneExpiredAttempts(state, currentTime = Date.now()) {
  let removed = 0;
  Object.values(state.users || {}).forEach((user) => {
    const attempts = Array.isArray(user && user.attempts) ? user.attempts : [];
    const retained = attempts.filter((attempt) => {
      const timestamp = Date.parse(attempt && (attempt.updatedAt || attempt.completedAt || attempt.startedAt) || "");
      if (!Number.isFinite(timestamp) || timestamp > currentTime) return true;
      return currentTime - timestamp < LOCAL_HEALTH_RETENTION_MS;
    });
    removed += attempts.length - retained.length;
    if (retained.length !== attempts.length) user.attempts = retained;
  });
  return removed;
}

function cleanupExpiredLocalHealthData(api = typeof wx !== "undefined" ? wx : null, currentTime = Date.now()) {
  if (!api || typeof api.getStorageSync !== "function") {
    return { state: { storageVersion: STORAGE_VERSION, users: {} }, removed: 0 };
  }
  const stored = api.getStorageSync(STORAGE_KEY);
  const state = !stored || typeof stored !== "object" || stored.storageVersion !== STORAGE_VERSION
    ? { storageVersion: STORAGE_VERSION, users: {} }
    : clone(stored);
  const removed = pruneExpiredAttempts(state, currentTime);
  if (removed > 0 && typeof api.setStorageSync === "function") api.setStorageSync(STORAGE_KEY, state);
  return { state, removed };
}

module.exports = Object.freeze({
  LOCAL_HEALTH_RETENTION_DAYS,
  STORAGE_KEY,
  STORAGE_VERSION,
  cleanupExpiredLocalHealthData,
  pruneExpiredAttempts,
});
