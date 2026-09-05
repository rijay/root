const LOGIN_SESSION_KEY = "ROOT_LOGIN_SESSION_V1";
const CAMPAIGN_SHOWN_KEY = "ROOT_CAMPAIGN_SHOWN_V1";

function safeStorage(method, key, value) {
  if (typeof wx === "undefined" || typeof wx[method] !== "function") return "";
  try {
    return value === undefined ? wx[method](key) : wx[method](key, value);
  } catch (_) {
    return "";
  }
}

function createLocalSessionId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeSession(value = {}) {
  return {
    sessionId: String(value.sessionId || value.id || "").trim(),
    startedAt: String(value.startedAt || "").trim(),
  };
}

function startLoginSession(serverSession = {}) {
  const session = normalizeSession({
    sessionId: serverSession.sessionId || serverSession.id || createLocalSessionId(),
    startedAt: new Date().toISOString(),
  });
  safeStorage("setStorageSync", LOGIN_SESSION_KEY, session);
  safeStorage("removeStorageSync", CAMPAIGN_SHOWN_KEY);
  return session;
}

function currentLoginSession() {
  return normalizeSession(safeStorage("getStorageSync", LOGIN_SESSION_KEY) || {});
}

function ensureLoginSession() {
  const current = currentLoginSession();
  return current.sessionId ? current : startLoginSession();
}

function campaignShownInSession(campaignId, session = currentLoginSession()) {
  const shown = safeStorage("getStorageSync", CAMPAIGN_SHOWN_KEY) || {};
  return Boolean(
    session.sessionId
    && shown.sessionId === session.sessionId
    && shown.campaignId === String(campaignId || "").trim()
  );
}

function markCampaignShown(campaignId, session = currentLoginSession()) {
  if (!session.sessionId || !campaignId) return false;
  safeStorage("setStorageSync", CAMPAIGN_SHOWN_KEY, {
    sessionId: session.sessionId,
    campaignId: String(campaignId).trim(),
    shownAt: new Date().toISOString(),
  });
  return true;
}

function clearLoginSession() {
  safeStorage("removeStorageSync", LOGIN_SESSION_KEY);
  safeStorage("removeStorageSync", CAMPAIGN_SHOWN_KEY);
}

module.exports = Object.freeze({
  CAMPAIGN_SHOWN_KEY,
  LOGIN_SESSION_KEY,
  campaignShownInSession,
  clearLoginSession,
  currentLoginSession,
  ensureLoginSession,
  markCampaignShown,
  startLoginSession,
});
