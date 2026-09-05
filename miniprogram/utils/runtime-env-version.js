const VALID_ENV_VERSIONS = new Set(["develop", "trial", "release"]);

function normalizeEnvVersion(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_ENV_VERSIONS.has(normalized) ? normalized : "";
}

function runtimePlatform(wxApi = {}) {
  try {
    if (typeof wxApi.getDeviceInfo === "function") {
      return String((wxApi.getDeviceInfo() || {}).platform || "").trim().toLowerCase();
    }
    if (typeof wxApi.getSystemInfoSync === "function") {
      return String((wxApi.getSystemInfoSync() || {}).platform || "").trim().toLowerCase();
    }
  } catch (_) {
    // An unreadable device type must not enable candidate routing on a real device.
  }
  return "";
}

function detectRuntimeEnvVersion(wxApi = null, wxConfig = null) {
  if (wxApi && typeof wxApi.getAccountInfoSync === "function") {
    try {
      const accountInfo = wxApi.getAccountInfoSync() || {};
      const officialVersion = normalizeEnvVersion(
        accountInfo.miniProgram && accountInfo.miniProgram.envVersion
      );
      if (officialVersion) return officialVersion;
    } catch (_) {
      // Older runtimes may not expose account information; continue to compatibility evidence.
    }
  }

  const compatibleVersion = normalizeEnvVersion(wxConfig && wxConfig.envVersion);
  if (compatibleVersion) return compatibleVersion;

  if (!wxApi) return "develop";
  return runtimePlatform(wxApi) === "devtools" ? "develop" : "release";
}

module.exports = {
  detectRuntimeEnvVersion,
  normalizeEnvVersion,
};
