const env = require("../../config/env");
const { appVersion } = require("../../config/version");
const router = require("../../utils/router");
const { clearToken, getToken, request } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");
const { clearLegacyTransientHealthStorage, clearTransientHealthData } = require("../../utils/transient-health-state");

const PROFILE_ROUTE = "/pages/profile/index";
const PENDING_MEMBER_TARGET_KEY = "ROOT_PROFILE_MEMBER_TARGET_V1";
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

Page({
  data: {
    loggedIn: false,
    profile: { nickname: "未登录", avatarUrl: "" },
    version: appVersion,
    memberLinkFailure: false,
    failedMemberKey: "",
  },

  onLoad() {
    this.setData({ version: runtimeVersion() });
  },

  onShow() {
    syncTabBar(this, 3);
    const loggedIn = Boolean(getToken());
    this.setData(loggedIn
      ? { loggedIn }
      : { loggedIn, memberLinkFailure: false, failedMemberKey: "" });
    if (loggedIn) {
      this.loadProfile();
      const pendingTarget = wx.getStorageSync(PENDING_MEMBER_TARGET_KEY);
      if (pendingTarget && !this._resumingMemberTarget) {
        this._resumingMemberTarget = true;
        wx.removeStorageSync(PENDING_MEMBER_TARGET_KEY);
        setTimeout(() => {
          this.openMemberPath(pendingTarget);
          this._resumingMemberTarget = false;
        }, 0);
      }
    }
  },

  async loadProfile() {
    try {
      const data = await request({ url: "/api/v1/user/formal-profile", method: "GET", scope: "profile-home" });
      this.setData({ profile: data.profile || { nickname: "Root用户", avatarUrl: "" } });
    } catch (error) {
      this.setData({ profile: { nickname: "Root用户", avatarUrl: "" } });
    }
  },

  openLogin() {
    if (!this.data.loggedIn) router.open(`/pages/login/index?intent=${encodeURIComponent(PROFILE_ROUTE)}`);
  },

  handleIdentityTap() {
    if (this.data.loggedIn) this.openProfileEditor();
    else this.openLogin();
  },

  openMemberEntry(event) {
    const key = event.currentTarget.dataset.key;
    if (!this.data.loggedIn) {
      wx.setStorageSync(PENDING_MEMBER_TARGET_KEY, key);
      this.openLogin();
      return;
    }
    this.openMemberPath(key);
  },

  openMemberPath(key) {
    const path = key === "orders" ? env.rootMemberCenterOrdersPath : env.rootMemberCenterCouponsPath;
    if (!env.rootMemberCenterAppId || !path) {
      this.setData({ memberLinkFailure: true, failedMemberKey: key });
      return;
    }
    wx.navigateToMiniProgram({
      appId: env.rootMemberCenterAppId,
      path,
      envVersion: "release",
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
    clearToken();
    LOCAL_SESSION_KEYS.forEach((key) => wx.removeStorageSync(key));
    clearTransientHealthData();
    clearLegacyTransientHealthStorage(wx);
    this.setData({
      loggedIn: false,
      profile: { nickname: "未登录", avatarUrl: "" },
      memberLinkFailure: false,
      failedMemberKey: "",
    });
    wx.showToast({ title: "已退出登录", icon: "success" });
  },
});
