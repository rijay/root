const env = require("./config/env");
const { appVersion } = require("./config/version");
const router = require("./utils/router");
const { initializeCloudRoute, refreshCloudRoute } = require("./utils/cloud-route");
const { performanceMonitor } = require("./utils/performance-monitor");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const { installGlobalSharePolicy } = require("./utils/page-share");
const { navigateToLaunchingTarget, normalizeRoute, prepareLaunchingEntry, serializeTarget } = require("./utils/launching-entry");
const { captureFirstChannel, channelEntryOptions, prepareChannelVisitEntry } = require("./utils/channel-attribution");
const { GUT_INTRO_PATH } = require("./utils/gut-assessment-entry");
const { FORMAL_ACCESS_STATE, inspectFormalAccess } = require("./utils/formal-access");
const { readProfileCache, writeProfileCache } = require("./utils/profile-cache");
const { ensureLoginSession } = require("./utils/login-session");
const { getToken } = require("./utils/request");
const { resolveRuntimeRequestConfig } = require("./utils/runtime-request-adapter");
const { prewarmActivityFeed } = require("./utils/activity-feed-cache");
const { getMemberCommerceSummary, readMemberCommerceSummaryEntry } = require("./utils/member-commerce");
const { prewarmSessionImage } = require("./utils/session-image-cache");

installGlobalSharePolicy(globalThis);

const appModuleStartedAt = Date.now();

function prewarmProfileCache() {
  if (!getToken()) return;
  ensureLoginSession();
  const cached = readProfileCache();
  if (cached && cached.profile.avatarUrl) prewarmSessionImage(cached.profile.avatarUrl);
  if (cached && cached.fresh) return;
  inspectFormalAccess("profile-home")
    .then((access) => {
      if (access.state !== FORMAL_ACCESS_STATE.PHONE_REQUIRED && access.profile) {
        writeProfileCache(access.profile);
        if (access.profile.avatarUrl) prewarmSessionImage(access.profile.avatarUrl);
      }
    })
    .catch(() => {
      // 预热失败不阻断启动；进入“我的”页时仍会按原流程刷新。
    });
}

function prewarmMemberCommerceSummary() {
  if (!getToken()) return;
  ensureLoginSession();
  const cached = readMemberCommerceSummaryEntry();
  if (cached && cached.fresh) return;
  getMemberCommerceSummary().catch(() => {
    // 会员摘要预热失败不影响启动；进入“我的”页时仍会保留可用旧摘要。
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
    // 显式渠道码的原生首屏已是手绘页时，首个 onShow 无需再次重开。
    this.globalData.pendingNativeChannelCode = channelEntry.result === "VALID_SHORT_CODE"
      && !channelEntry.inferred && normalizeRoute(options.path) === GUT_INTRO_PATH
      ? channelEntry.shortCode : "";
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
    prewarmMemberCommerceSummary();
    prewarmActivityFeed().catch(() => {
      // 活动预热失败不影响启动；进入活动页时会继续沿用正常加载流程。
    });
  },

  onShow(options = {}) {
    refreshCloudRoute(options, env.envVersion);
    const capturedChannel = captureFirstChannel(options);
    // 当前显式扫码优先；首屏丢参时保留启动捕获，避免被通用码推断覆盖。
    const channelEntry = capturedChannel.result !== "NO_CHANNEL" && !capturedChannel.inferred
      ? capturedChannel
      : this.globalData.pendingChannelEntry || capturedChannel;
    const nativeChannelCode = this.globalData.pendingNativeChannelCode;
    delete this.globalData.pendingChannelEntry;
    delete this.globalData.pendingNativeChannelCode;
    const entryOptions = channelEntryOptions(channelEntry, options);
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const entry = prepareLaunchingEntry(this, entryOptions, pages);
    if (entry.reason === "CHANNEL_ENTRY_DIRECT") {
      prepareChannelVisitEntry(entry.target.options.q);
      if (pages.length || nativeChannelCode !== entry.target.options.q) {
        wx.reLaunch({ url: serializeTarget(entry.target) });
      }
    } else {
      prepareChannelVisitEntry();
      if (entry.relaunch) wx.reLaunch({ url: "/pages/welcome/index?mode=launching" });
      else if (entry.navigateDirect) navigateToLaunchingTarget(entry.target);
    }
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
