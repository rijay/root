const LOCAL_DEVTOOLS_API_BASE_URL = "http://127.0.0.1:8787";

function runtimePlatform(wxApi = {}) {
  try {
    if (typeof wxApi.getDeviceInfo === "function") {
      return String((wxApi.getDeviceInfo() || {}).platform || "").trim().toLowerCase();
    }
    if (typeof wxApi.getSystemInfoSync === "function") {
      return String((wxApi.getSystemInfoSync() || {}).platform || "").trim().toLowerCase();
    }
  } catch (_) {
    // Runtime detection is fail-closed: an unreadable platform keeps cloud transport.
  }
  return "";
}

function resolveRuntimeRequestConfig(env = {}, wxApi = {}) {
  const cloudConfig = Object.freeze({
    adapter: env.requestAdapter || "cloudContainer",
    apiBaseUrl: String(env.apiBaseUrl || "").trim().replace(/\/$/, ""),
    mode: "CLOUD",
  });
  const localBaseUrl = String(env.localDevtoolsApiBaseUrl || "").trim().replace(/\/$/, "");
  if (
    env.envVersion !== "develop"
    || runtimePlatform(wxApi) !== "devtools"
    || localBaseUrl !== LOCAL_DEVTOOLS_API_BASE_URL
  ) {
    return cloudConfig;
  }
  return Object.freeze({
    adapter: "wxRequest",
    apiBaseUrl: LOCAL_DEVTOOLS_API_BASE_URL,
    mode: "LOCAL_DEVTOOLS",
  });
}

module.exports = {
  LOCAL_DEVTOOLS_API_BASE_URL,
  resolveRuntimeRequestConfig,
  runtimePlatform,
};
