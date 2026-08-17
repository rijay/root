const { getToken, request } = require("./request");

const LOGIN_SESSION_STORAGE_KEY = "ROOT_LOGIN_SESSION_CONTEXT_V1";

function rememberLoginSession(session) {
  const source = session && typeof session === "object" ? session : {};
  const loginSessionId = String(source.loginSessionId || source.login_session_id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(loginSessionId)) return "";
  wx.setStorageSync(LOGIN_SESSION_STORAGE_KEY, {
    loginSessionId,
    expiresAt: String(source.expiresAt || source.expires_at || ""),
  });
  return loginSessionId;
}

function readLoginSessionId() {
  const source = wx.getStorageSync(LOGIN_SESSION_STORAGE_KEY);
  return source && typeof source === "object" ? String(source.loginSessionId || "") : "";
}

function clearLoginSession() {
  wx.removeStorageSync(LOGIN_SESSION_STORAGE_KEY);
}

async function ensureLoginSessionId() {
  const existing = readLoginSessionId();
  if (existing) return existing;
  if (!getToken()) return "";
  const state = await request({ url: "/api/v1/user/state" });
  return rememberLoginSession(state.session);
}

async function claimCampaignPopup() {
  if (!getToken()) return { popup: null, reason: "SESSION_UNAVAILABLE" };
  const loginSessionId = await ensureLoginSessionId();
  if (!loginSessionId) return { popup: null, reason: "SESSION_UNAVAILABLE" };
  return request({
    url: "/api/v1/operations/popup/claim",
    method: "POST",
    idempotencyKey: `campaign-popup-claim:${loginSessionId}`,
    data: {},
  });
}

function recordCampaignPopupAction(popupId, actionType) {
  const loginSessionId = readLoginSessionId();
  if (!loginSessionId || !popupId) return Promise.resolve(null);
  return request({
    url: "/api/v1/operations/popup/action",
    method: "POST",
    idempotencyKey: `campaign-popup:${loginSessionId}:${popupId}:${String(actionType || "").toLowerCase()}`,
    data: { popupId, actionType },
  });
}

module.exports = {
  LOGIN_SESSION_STORAGE_KEY,
  claimCampaignPopup,
  clearLoginSession,
  ensureLoginSessionId,
  readLoginSessionId,
  recordCampaignPopupAction,
  rememberLoginSession,
};
