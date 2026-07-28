const { getToken, request, setToken, stringifyError } = require("../../utils/request");
const { activityLoginRecoveryUrl, ROUTE_INTENT_STORAGE_KEY } = require("../../utils/activity-actions");
const router = require("../../utils/router");

function runWxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        resolve(result.code || "");
      },
      fail: reject,
    });
  });
}

function consumeActivityLoginRecovery() {
  const value = wx.getStorageSync(ROUTE_INTENT_STORAGE_KEY);
  const url = activityLoginRecoveryUrl(value, Date.now());
  if (value) wx.removeStorageSync(ROUTE_INTENT_STORAGE_KEY);
  return url;
}

Page({
  data: {
    loading: false,
    phoneLoading: false,
    user: null,
    identity: {
      unionidStatus: "PENDING",
      appCode: "MYROOT",
    },
    hasToken: false,
    hasPhone: false,
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const hasToken = Boolean(getToken());
    this.setData({ hasToken });
    if (!hasToken) return;
    try {
      const state = await router.fetchState();
      this.setData({
        user: state.user || null,
        identity: state.identity || this.data.identity,
        hasPhone: Boolean(state.user && state.user.phone),
      });
    } catch (error) {
      this.setData({ hasToken: false, user: null, hasPhone: false });
    }
  },

  async authorizeEntry() {
    this.setData({ loading: true });
    try {
      const wxCode = await runWxLogin();
      const data = await request({
        url: "/api/v1/auth/login",
        method: "POST",
        timeout: 45000,
        data: {
          wxCode,
          appCode: "MYROOT",
          sourceChannel: "MYROOT_REGISTER",
        },
      });
      setToken(data.token);
      await this.refresh();
    } catch (error) {
      wx.showToast({ title: (stringifyError(error) || "授权失败，请重试").slice(0, 28), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async authorizePhone(event) {
    const detail = (event && event.detail) || {};
    const failed = detail.errMsg && detail.errMsg.includes("fail");
    if (failed) {
      wx.showToast({ title: "未授权手机号也可以继续参与", icon: "none" });
      return;
    }
    this.setData({ phoneLoading: true });
    try {
      const wxCode = await runWxLogin();
      const data = await request({
        url: "/api/v1/auth/login",
        method: "POST",
        timeout: 45000,
        data: {
          wxCode,
          phoneCode: detail.code || "",
          appCode: "MYROOT",
          sourceChannel: "MYROOT_PHONE_AUTH",
        },
      });
      setToken(data.token);
      await this.refresh();
      wx.showToast({ title: "已记录手机号", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (stringifyError(error) || "手机号授权失败").slice(0, 28), icon: "none" });
    } finally {
      this.setData({ phoneLoading: false });
    }
  },

  continueToHome() {
    router.go(consumeActivityLoginRecovery() || "/pages/home/index");
  },
});
