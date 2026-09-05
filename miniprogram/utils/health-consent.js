const { request } = require("./request");
const { currentLoginSession } = require("./login-session");

let navigating = false;
let cachedConsent = null;

function sessionId() {
  return String((currentLoginSession() || {}).sessionId || "").trim();
}

function clearHealthConsentCache() {
  cachedConsent = null;
}

function updateHealthConsentCache(status) {
  const currentSessionId = sessionId();
  if (!currentSessionId || !status) {
    clearHealthConsentCache();
    return status;
  }
  cachedConsent = { sessionId: currentSessionId, status };
  return status;
}

async function getHealthConsentStatus(options = {}) {
  const currentSessionId = sessionId();
  if (!options.force && currentSessionId && cachedConsent && cachedConsent.sessionId === currentSessionId) {
    return cachedConsent.status;
  }
  const status = await request({ url: "/api/v1/privacy/health-consent" });
  if (currentSessionId && sessionId() === currentSessionId) {
    cachedConsent = { sessionId: currentSessionId, status };
  }
  return status;
}

async function ensureHealthConsent(options = {}) {
  const shouldNavigate = options.navigate !== false;
  try {
    const status = await getHealthConsentStatus();
    if (!status.required || status.active) return true;
    if (!status.configured) {
      if (shouldNavigate) {
        wx.showModal({
          title: "暂时无法提交",
          content: "敏感信息处理说明尚未配置，请先使用商品浏览或人工协助。",
          showCancel: false,
        });
      }
      return false;
    }
    if (shouldNavigate && !navigating) {
      navigating = true;
      wx.navigateTo({
        url: "/pages/health-consent/index",
        complete: () => { navigating = false; },
      });
    }
    return false;
  } catch (error) {
    wx.showToast({ title: error.message || "隐私说明加载失败", icon: "none" });
    return false;
  }
}

module.exports = {
  clearHealthConsentCache,
  ensureHealthConsent,
  getHealthConsentStatus,
  updateHealthConsentCache,
};
