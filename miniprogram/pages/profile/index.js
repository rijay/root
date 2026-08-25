const env = require("../../config/env");
const { appVersion } = require("../../config/version");
const router = require("../../utils/router");
const { clearToken, getToken } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");
const { clearLegacyTransientHealthStorage, clearTransientHealthData } = require("../../utils/transient-health-state");
const { FORMAL_ACCESS_STATE, inspectFormalAccess } = require("../../utils/formal-access");
const { unbindUserScope } = require("../../utils/local-health-assessment");
const { defaultOnShareAppMessage } = require("../../utils/page-share");
const { readProfileCache, writeProfileCache } = require("../../utils/profile-cache");
const { getMemberCommerceSummary } = require("../../utils/member-commerce");

const PROFILE_ROUTE = "/pages/profile/index";
const PENDING_MEMBER_TARGET_KEY = "ROOT_PROFILE_MEMBER_TARGET_V1";
const DEFAULT_PROFILE = Object.freeze({ nickname: "Root用户", avatarUrl: "" });
const GUEST_PROFILE = Object.freeze({ nickname: "未登录", avatarUrl: "" });
const LOCAL_SESSION_KEYS = [
  "ROOT_AUTH_INTENT_V1",
  "ROOT_REGISTRATION_CONTEXT_V1",
  "ROOT_PROFILE_SUBMIT_KEY_V1",
  "ROOT4U_START_PENDING_V1",
  "ROOT4U_INITIAL_SUBMIT_KEY_V1",
  "MYROOT_ACTIVITY_ROUTE_INTENT_V1",
  "MYROOT_ACTIVITY_PENDING_COMMANDS_V1",
  PENDING_MEMBER_TARGET_KEY,
];

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
  const cached = readProfileCache();
  return cached
    ? { loggedIn: true, sessionChecking: false, profile: cached.profile, profileRefreshFailed: false }
    : { loggedIn: true, sessionChecking: true, profile: DEFAULT_PROFILE, profileRefreshFailed: false };
}

const firstProfileState = initialProfileState();

Page({
  data: {
    ...firstProfileState,
    version: appVersion,
    memberLinkFailure: false,
    failedMemberKey: "",
    profileRefreshFailed: false,
    memberCommerce: { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
  },

  onLoad() {
    this.setData({ version: runtimeVersion() });
  },

  onShow() {
    syncTabBar(this, 4);
    const hasSession = Boolean(getToken());
    const cached = hasSession ? readProfileCache() : null;
    this.setData(hasSession
      ? cached
        ? { loggedIn: true, sessionChecking: false, profile: cached.profile, profileRefreshFailed: false }
        : { loggedIn: true, sessionChecking: true, profile: DEFAULT_PROFILE, profileRefreshFailed: false }
      : {
        loggedIn: false,
        sessionChecking: false,
        profile: GUEST_PROFILE,
        memberLinkFailure: false,
        failedMemberKey: "",
        profileRefreshFailed: false,
      });
    if (hasSession) {
      this.loadProfile({ preserveCached: Boolean(cached) });
      this.loadMemberCommerce();
    }
  },

  loadProfile(options = {}) {
    if (this._profileLoadPromise) return this._profileLoadPromise;
    const pending = (async () => {
      try {
        const access = await inspectFormalAccess("profile-home");
        const loggedIn = access.state !== FORMAL_ACCESS_STATE.PHONE_REQUIRED;
        const profile = access.profile || { nickname: loggedIn ? "Root用户" : "未登录", avatarUrl: "" };
        if (loggedIn) writeProfileCache(profile);
        this.setData({
          loggedIn,
          sessionChecking: false,
          profile,
          profileRefreshFailed: false,
        });
        if (loggedIn) this.resumeMemberTarget();
      } catch (error) {
        if (options.preserveCached && getToken()) {
          this.setData({ sessionChecking: false, profileRefreshFailed: true });
          return;
        }
        this.setData({
          loggedIn: false,
          sessionChecking: false,
          profile: GUEST_PROFILE,
          profileRefreshFailed: false,
        });
      }
    })();
    this._profileLoadPromise = pending;
    return pending.finally(() => {
      if (this._profileLoadPromise === pending) this._profileLoadPromise = null;
    });
  },

  loadMemberCommerce() {
    if (this._memberCommercePromise || !getToken()) return this._memberCommercePromise;
    const pending = getMemberCommerceSummary()
      .then((memberCommerce) => this.setData({ memberCommerce }))
      .catch(() => this.setData({
        memberCommerce: { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
      }));
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

  logout() {
    unbindUserScope();
    clearToken();
    LOCAL_SESSION_KEYS.forEach((key) => wx.removeStorageSync(key));
    clearTransientHealthData();
    clearLegacyTransientHealthStorage(wx);
    this.setData({
      loggedIn: false,
      sessionChecking: false,
      profile: GUEST_PROFILE,
      memberLinkFailure: false,
      failedMemberKey: "",
      profileRefreshFailed: false,
      memberCommerce: { ready: false, orderHint: "会员中心", couponHint: "会员中心" },
    });
    wx.showToast({ title: "已退出登录", icon: "success" });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
