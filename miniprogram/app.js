const env = require("./config/env");
const { appVersion } = require("./config/version");
const {
  captureLaunchAttribution,
  channelErrorUrl,
  confirmPendingAttribution,
} = require("./utils/channel-attribution");
const { pathOnly, routeFromLaunchOptions } = require("./utils/entry-launch");
const { installGlobalSharePolicy } = require("./utils/page-share");
const router = require("./utils/router");
const { initializeCloudRoute, refreshCloudRoute } = require("./utils/cloud-route");
const { performanceMonitor } = require("./utils/performance-monitor");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const {
  clearLegacyTransientHealthStorage,
  clearTransientHealthData,
} = require("./utils/transient-health-state");

const appModuleStartedAt = Date.now();

installGlobalSharePolicy(globalThis);

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
    entrySequence: 0,
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
    const channel = captureLaunchAttribution(options);
    const originalTarget = routeFromLaunchOptions(options);
    const channelTarget = channel.reason === "PAYLOAD_INVALID"
      ? channelErrorUrl(channel.reason)
      : channel.targetPage;
    this.scheduleEntryLaunch(channelTarget || originalTarget, Boolean(channelTarget));
    this.confirmPendingChannelAttribution();
  },

  scheduleEntryLaunch(targetPage, forceTarget = false) {
    if (this.entryLaunchPending) return;
    const entryId = String(++this.globalData.entrySequence);
    this.entryLaunchPending = {
      entryId,
      targetPage: targetPage || "/pages/home/index",
      forceTarget,
      overlay: false,
    };
    let attempts = 0;
    const openLaunching = () => {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current && pathOnly(current.route) === "/pages/launching/index") return;
      if (!current && attempts < 8) {
        attempts += 1;
        setTimeout(openLaunching, 30);
        return;
      }
      wx.navigateTo({
        url: `/pages/launching/index?entryId=${entryId}`,
        success: () => {
          if (this.entryLaunchPending && this.entryLaunchPending.entryId === entryId) {
            this.entryLaunchPending.overlay = true;
          }
        },
        fail: () => wx.redirectTo({ url: `/pages/launching/index?entryId=${entryId}` }),
      });
    };
    setTimeout(openLaunching, 0);
  },

  consumeEntryLaunch(entryId) {
    const entry = this.entryLaunchPending;
    if (!entry || entry.entryId !== String(entryId || "")) return null;
    this.entryLaunchPending = null;
    return entry;
  },

  async confirmPendingChannelAttribution() {
    const result = await confirmPendingAttribution();
    if (!result || result.state !== "REJECTED") return result;
    const errorTarget = channelErrorUrl(result.reason);
    if (this.entryLaunchPending) {
      this.entryLaunchPending.targetPage = errorTarget;
      this.entryLaunchPending.forceTarget = true;
      return result;
    }
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    if (!current || pathOnly(current.route) !== "/pages/channel-error/index") router.go(errorTarget);
    return result;
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
