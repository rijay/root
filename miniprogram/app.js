const env = require("./config/env");
const { appVersion } = require("./config/version");
const router = require("./utils/router");
const { initializeCloudRoute, refreshCloudRoute } = require("./utils/cloud-route");
const { performanceMonitor } = require("./utils/performance-monitor");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const { installGlobalSharePolicy } = require("./utils/page-share");
const { navigateToLaunchingTarget, prepareLaunchingEntry } = require("./utils/launching-entry");
const { captureFirstChannel, channelEntryOptions } = require("./utils/channel-attribution");
const { cleanupExpiredLocalHealthData } = require("./utils/local-health-retention");

installGlobalSharePolicy(globalThis);

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
    launchingHandledThisSession: false,
  },

  onLaunch(options = {}) {
    if (env.healthAssessmentStorageMode === "LOCAL_DEVICE") {
      try {
        cleanupExpiredLocalHealthData(wx);
      } catch (_) {
        // 本机存储异常不得阻断小程序启动；进入健康页时会再次提示。
      }
    }
    performanceMonitor.startNativeObservation(wx);
    performanceMonitor.record({
      name: "app_launch",
      entry: String(options.scene || "unknown"),
      durationMs: Date.now() - appModuleStartedAt,
      status: "OBSERVED",
      ...performanceContext(),
    });
    initializeCloudRoute(options, env.envVersion);
    const channelEntry = captureFirstChannel(options);
    if (channelEntry.result !== "NO_CHANNEL") this.globalData.pendingChannelEntry = channelEntry;
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
    const capturedChannel = captureFirstChannel(options);
    const channelEntry = this.globalData.pendingChannelEntry || capturedChannel;
    delete this.globalData.pendingChannelEntry;
    const entryOptions = channelEntryOptions(channelEntry, options);
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const entry = prepareLaunchingEntry(this, entryOptions, pages);
    if (entry.relaunch) wx.reLaunch({ url: "/pages/welcome/index?mode=launching" });
    else if (entry.navigateDirect) navigateToLaunchingTarget(entry.target);
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
