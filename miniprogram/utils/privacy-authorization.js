let initialized = false;
let activePresenter = null;

function wxApi(value) {
  if (value) return value;
  return typeof wx !== "undefined" ? wx : null;
}

function initializePrivacyAuthorization(apiValue) {
  const api = wxApi(apiValue);
  if (initialized || !api || typeof api.onNeedPrivacyAuthorization !== "function") return false;
  api.onNeedPrivacyAuthorization((resolve, eventInfo = {}) => {
    if (typeof activePresenter !== "function") {
      resolve({ event: "disagree" });
      return;
    }
    activePresenter({ resolve, eventInfo });
  });
  initialized = true;
  return true;
}

function setPrivacyPresenter(presenter) {
  activePresenter = typeof presenter === "function" ? presenter : null;
  return () => {
    if (activePresenter === presenter) activePresenter = null;
  };
}

function getPrivacySetting(apiValue) {
  const api = wxApi(apiValue);
  return new Promise((resolve) => {
    if (!api || typeof api.getPrivacySetting !== "function") {
      resolve({ needAuthorization: false, privacyContractName: "" });
      return;
    }
    api.getPrivacySetting({
      success: (result) => resolve(result || { needAuthorization: false }),
      fail: () => resolve({ needAuthorization: false, privacyContractName: "" }),
    });
  });
}

function requirePrivacyAuthorization(apiValue) {
  const api = wxApi(apiValue);
  if (!api || typeof api.requirePrivacyAuthorize !== "function") return Promise.resolve(true);
  initializePrivacyAuthorization(api);
  return new Promise((resolve) => {
    api.requirePrivacyAuthorize({
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function openPrivacyContract(apiValue) {
  const api = wxApi(apiValue);
  return new Promise((resolve) => {
    if (!api || typeof api.openPrivacyContract !== "function") {
      resolve(false);
      return;
    }
    api.openPrivacyContract({
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function resetPrivacyAuthorizationForTests() {
  initialized = false;
  activePresenter = null;
}

module.exports = {
  getPrivacySetting,
  initializePrivacyAuthorization,
  openPrivacyContract,
  requirePrivacyAuthorization,
  resetPrivacyAuthorizationForTests,
  setPrivacyPresenter,
};
