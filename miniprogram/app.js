const env = require("./config/env");
const { appVersion } = require("./config/version");
const router = require("./utils/router");
const { initializeCloudRoute, refreshCloudRoute } = require("./utils/cloud-route");
const { performanceMonitor } = require("./utils/performance-monitor");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const { installGlobalSharePolicy } = require("./utils/page-share");
const { navigateToLaunchingTarget, prepareLaunchingEntry } = require("./utils/launching-entry");
const { captureFirstChannel, channelEntryOptions } = require("./utils/channel-attribution");
const { FORMAL_ACCESS_STATE, inspectFormalAccess } = require("./utils/formal-access");
const { readProfileCache, writeProfileCache } = require("./utils/profile-cache");
const { ensureLoginSession } = require("./utils/login-session");
const { getToken } = require("./utils/request");
const { resolveRuntimeRequestConfig } = require("./utils/runtime-request-adapter");

installGlobalSharePolicy(globalThis);

const appModuleStartedAt = Date.now();

function prewarmProfileCache() {
  if (!getToken()) return;
  ensureLoginSession();
  if (readProfileCache()) return;
  inspectFormalAccess("profile-home")
    .then((access) => {
      if (access.state !== FORMAL_ACCESS_STATE.PHONE_REQUIRED && access.profile) {
        writeProfileCache(access.profile);
      }
    })
    .catch(() => {
      // 预热失败不阻断启动；进入“我的”页时仍会按原流程刷新。
    });
}

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
    const runtimeRequestConfig = resolveRuntimeRequestConfig(env, wx);
    this.globalData.requestRuntimeMode = runtimeRequestConfig.mode;
    if (runtimeRequestConfig.adapter === "cloudContainer" && wx.cloud) {
      const cloudOptions = { traceUser: true };
      if (env.cloudEnvId) cloudOptions.env = env.cloudEnvId;
      wx.cloud.init(cloudOptions);
    }
    this.globalData.bootstrapped = true;
    prewarmProfileCache();
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
