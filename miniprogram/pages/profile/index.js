const env = require("../../config/env");
const router = require("../../utils/router");
const { clearToken, getToken, request } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");

const PROFILE_ROUTE = "/pages/profile/index";
const LOCAL_SESSION_KEYS = ["ROOT_AUTH_INTENT_V1", "ROOT_REGISTRATION_CONTEXT_V1", "ROOT_PROFILE_SUBMIT_KEY_V1"];

function runtimeVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.version || "0.5.13";
  } catch (error) {
    return "0.5.13";
  }
}

Page({
  data: {
    loggedIn: false,
    profile: { nickname: "未登录", avatarUrl: "" },
    version: "0.5.13",
  },

  onLoad() {
    this.setData({ version: runtimeVersion() });
  },

  onShow() {
    syncTabBar(this, 3);
    const loggedIn = Boolean(getToken());
    this.setData({ loggedIn });
    if (loggedIn) this.loadProfile();
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

  openMemberEntry(event) {
    if (!this.data.loggedIn) {
      this.openLogin();
      return;
    }
    const key = event.currentTarget.dataset.key;
    const path = key === "orders" ? env.rootMemberCenterOrdersPath : env.rootMemberCenterCouponsPath;
    if (!env.rootMemberCenterAppId || !path) {
      wx.showToast({ title: "入口路径待会员中心确认", icon: "none" });
      return;
    }
    wx.navigateToMiniProgram({ appId: env.rootMemberCenterAppId, path, envVersion: "release" });
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
    this.setData({ loggedIn: false, profile: { nickname: "未登录", avatarUrl: "" } });
    wx.showToast({ title: "已退出登录", icon: "success" });
  },
});
