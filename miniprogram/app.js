const env = require("./config/env");
const { appVersion } = require("./config/version");
const router = require("./utils/router");
const { initializeCloudRoute, refreshCloudRoute } = require("./utils/cloud-route");
const { performanceMonitor } = require("./utils/performance-monitor");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const {
  clearLegacyTransientHealthStorage,
  clearTransientHealthData,
} = require("./utils/transient-health-state");

const appModuleStartedAt = Date.now();

function performanceContext() {
  const appInfo = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : {};
  const deviceInfo = typeof wx.getDeviceInfo === "function" ? wx.getDeviceInfo() : {};
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, "_");
  return {
    version: appVersion,
    platform: normalize(deviceInfo.platform),
    osVersion: normalize(deviceInfo.system),
    wechatVersion: normalize(appInfo.version),
    baseLibraryVersion: normalize(appInfo.SDKVersion),
    packageState: env.envVersion === "release" ? "RELEASE_PACKAGE" : "LOCAL_OR_CANDIDATE_PACKAGE",
  };
}

App({
  globalData: {
    bootstrapped: false,
  },

  onLaunch(options = {}) {
    performanceMonitor.startNativeObservation(wx);
    performanceMonitor.record({
      name: "app_launch",
      entry: String(options.scene || "unknown"),
      durationMs: Date.now() - appModuleStartedAt,
      status: "OBSERVED",
      ...performanceContext(),
    });
    initializeCloudRoute(options, env.envVersion);
    clearTransientHealthData();
    clearLegacyTransientHealthStorage();
    initializePrivacyAuthorization();
    if (env.requestAdapter === "cloudContainer" && wx.cloud) {
      const cloudOptions = { traceUser: true };
      if (env.cloudEnvId) cloudOptions.env = env.cloudEnvId;
      wx.cloud.init(cloudOptions);
    }
    this.globalData.bootstrapped = true;
  },

  onShow(options = {}) {
    refreshCloudRoute(options, env.envVersion);
  },

  onHide() {
    performanceMonitor.flush();
  },

  onError() {
    performanceMonitor.record({
      name: "crash",
      status: "FAILED",
      errorCode: "APP_ERROR",
      ...performanceContext(),
    });
    performanceMonitor.flush();
  },

  onMemoryWarning() {
    performanceMonitor.record({
      name: "memory_warning",
      status: "WARNING",
      ...performanceContext(),
    });
    performanceMonitor.flush();
  },

  fetchUserState() {
    return router.fetchState();
  },

  decideHomeRoute() {
    return router.decideHomeRoute();
  },
});
