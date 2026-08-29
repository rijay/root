const env = require("../../config/env");
const { appVersion } = require("../../config/version");
const router = require("../../utils/router");
const { getToken } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");
const { FORMAL_ACCESS_STATE, inspectFormalAccess } = require("../../utils/formal-access");
const { defaultOnShareAppMessage } = require("../../utils/page-share");
const { readProfileCache, writeProfileCache } = require("../../utils/profile-cache");
const { currentLoginSession, ensureLoginSession } = require("../../utils/login-session");
const { getMemberCommerceSummary, readMemberCommerceSummary } = require("../../utils/member-commerce");
const { performanceMonitor } = require("../../utils/performance-monitor");

const PROFILE_ROUTE = "/pages/profile/index";
const PENDING_MEMBER_TARGET_KEY = "ROOT_PROFILE_MEMBER_TARGET_V1";
const DEFAULT_PROFILE = Object.freeze({ nickname: "Root用户", avatarUrl: "" });
const GUEST_PROFILE = Object.freeze({ nickname: "未登录", avatarUrl: "" });
function runtimeVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.version || appVersion;
  } catch (error) {
    return appVersion;
  }
}

function initialProfileState() {
  if (!getToken()) {
    return { loggedIn: false, sessionChecking: false, profile: GUEST_PROFILE, profileRefreshFailed: false };
  }
  ensureLoginSession();
  const cached = readProfileCache();
  return cached
    ? { loggedIn: true, sessionChecking: false, profile: cached.profile, profileRefreshFailed: false }
    : { loggedIn: true, sessionChecking: true, profile: DEFAULT_PROFILE, profileRefreshFailed: false };
}

const firstProfileState = initialProfileState();
const firstMemberCommerce = firstProfileState.loggedIn ? readMemberCommerceSummary() : null;

Page({
  data: {
    ...firstProfileState,
    version: appVersion,
    memberLinkFailure: false,
    failedMemberKey: "",
    profileRefreshFailed: false,
    profileImageFailed: false,
    memberCommerce: firstMemberCommerce || { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
  },

  onLoad() {
    this._pageStartedAt = Date.now();
    this.setData({ version: runtimeVersion() }, () => this.recordUsableContent());
  },

  onShow() {
    syncTabBar(this, 4);
    const hasSession = Boolean(getToken());
    if (hasSession) ensureLoginSession();
    const cached = hasSession ? readProfileCache() : null;
    const memberCommerce = hasSession ? readMemberCommerceSummary() : null;
    this.setData(hasSession
      ? cached
        ? { loggedIn: true, sessionChecking: false, profile: cached.profile, profileRefreshFailed: false, profileImageFailed: false, ...(memberCommerce ? { memberCommerce } : {}) }
        : { loggedIn: true, sessionChecking: true, profile: DEFAULT_PROFILE, profileRefreshFailed: false, profileImageFailed: false, ...(memberCommerce ? { memberCommerce } : {}) }
      : {
        loggedIn: false,
        sessionChecking: false,
        profile: GUEST_PROFILE,
        memberLinkFailure: false,
        failedMemberKey: "",
        profileRefreshFailed: false,
        profileImageFailed: false,
        memberCommerce: { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
      });
    if (hasSession) {
      this.loadProfile({ preserveCached: Boolean(cached) });
      this.loadMemberCommerce();
    }
  },

  loadProfile(options = {}) {
    if (this._profileLoadPromise) return this._profileLoadPromise;
    const startedAt = Date.now();
    const expectedSessionId = currentLoginSession().sessionId;
    let refreshStatus = "REFRESH_FAILED";
    const pending = (async () => {
      try {
        const access = await inspectFormalAccess("profile-home");
        if (!getToken() || currentLoginSession().sessionId !== expectedSessionId) {
          refreshStatus = "SESSION_CHANGED";
          return;
        }
        const loggedIn = access.state !== FORMAL_ACCESS_STATE.PHONE_REQUIRED;
        const profile = access.profile || { nickname: loggedIn ? "Root用户" : "未登录", avatarUrl: "" };
        refreshStatus = loggedIn ? "REFRESH_SUCCESS" : "REFRESH_GUEST";
        if (loggedIn) writeProfileCache(profile);
        this.setData({
          loggedIn,
          sessionChecking: false,
          profile,
          profileRefreshFailed: false,
          profileImageFailed: false,
        });
        if (loggedIn) this.resumeMemberTarget();
      } catch (error) {
        if (!getToken() || currentLoginSession().sessionId !== expectedSessionId) {
          refreshStatus = "SESSION_CHANGED";
          return;
        }
        if (options.preserveCached && getToken()) {
          refreshStatus = "REFRESH_STALE_CACHE";
          this.setData({ sessionChecking: false, profileRefreshFailed: true });
          return;
        }
        this.setData({
          loggedIn: false,
          sessionChecking: false,
          profile: GUEST_PROFILE,
          profileRefreshFailed: false,
          profileImageFailed: false,
        });
      }
    })();
    this._profileLoadPromise = pending;
    return pending.finally(() => {
      performanceMonitor.recordPageMetric({
        page: "pages/profile/index",
        entry: "profile_refresh",
        durationMs: Date.now() - startedAt,
        status: refreshStatus,
      });
      if (this._profileLoadPromise === pending) this._profileLoadPromise = null;
    });
  },

  recordUsableContent() {
    if (this._usableContentRecorded) return;
    this._usableContentRecorded = true;
    performanceMonitor.recordPageMetric({
      page: "pages/profile/index",
      entry: "usable_content",
      durationMs: Date.now() - this._pageStartedAt,
      status: "FIRST_FRAME_READY",
    });
  },

  profileImageLoaded() {
    performanceMonitor.recordImageResult({
      page: "pages/profile/index",
      entry: "profile_avatar",
      status: "LOAD_SUCCESS",
    });
  },

  profileImageFailed() {
    this.setData({ profileImageFailed: true });
    performanceMonitor.recordImageResult({
      page: "pages/profile/index",
      entry: "profile_avatar",
      status: "LOAD_FAILED",
      errorCode: "IMAGE_LOAD_FAILED",
    });
  },

  loadMemberCommerce() {
    if (this._memberCommercePromise || !getToken()) return this._memberCommercePromise;
    const expectedSessionId = currentLoginSession().sessionId;
    const pending = getMemberCommerceSummary()
      .then((memberCommerce) => {
        if (getToken() && currentLoginSession().sessionId === expectedSessionId) this.setData({ memberCommerce });
      })
      .catch(() => {
        if (getToken() && currentLoginSession().sessionId === expectedSessionId) this.setData({
          memberCommerce: { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
        });
      });
    this._memberCommercePromise = pending;
    return pending.finally(() => {
      if (this._memberCommercePromise === pending) this._memberCommercePromise = null;
    });
  },

  resumeMemberTarget() {
    const pendingTarget = wx.getStorageSync(PENDING_MEMBER_TARGET_KEY);
    if (!pendingTarget || this._resumingMemberTarget) return;
    this._resumingMemberTarget = true;
    wx.removeStorageSync(PENDING_MEMBER_TARGET_KEY);
    setTimeout(() => {
      this.openMemberPath(pendingTarget);
      this._resumingMemberTarget = false;
    }, 0);
  },

  openLogin() {
    if (!this.data.loggedIn) router.open(`/pages/login/index?intent=${encodeURIComponent(PROFILE_ROUTE)}`);
  },

  handleIdentityTap() {
    if (this.data.sessionChecking) return;
    if (this.data.loggedIn) this.openProfileEditor();
    else this.openLogin();
  },

  openMemberEntry(event) {
    if (this.data.sessionChecking) return;
    const key = event.currentTarget.dataset.key;
    if (!this.data.loggedIn) {
      wx.setStorageSync(PENDING_MEMBER_TARGET_KEY, key);
      this.openLogin();
      return;
    }
    this.openMemberPath(key);
  },

  openMemberPath(key) {
    const shortLink = key === "orders"
      ? env.rootMemberCenterOrdersShortLink
      : env.rootMemberCenterCouponsShortLink;
    if (!shortLink) {
      this.setData({ memberLinkFailure: true, failedMemberKey: key });
      return;
    }
    wx.navigateToMiniProgram({
      shortLink,
      success: () => this.setData({ memberLinkFailure: false, failedMemberKey: "" }),
      fail: () => this.setData({ memberLinkFailure: true, failedMemberKey: key }),
    });
  },

  retryMemberEntry() {
    this.openMemberPath(this.data.failedMemberKey || "orders");
  },

  openProfileEditor() {
    if (!this.data.loggedIn) return this.openLogin();
    router.open("/pages/register/index?mode=edit&intent=%2Fpages%2Fprofile%2Findex");
  },

  openSupport(event) {
    const type = event.currentTarget.dataset.type || "contact";
    router.open(`/subpkg/profile/pages/support/index?type=${encodeURIComponent(type)}`);
  },

  openAbout() {
    router.open("/subpkg/profile/pages/about/index");
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
