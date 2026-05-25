const { request, setToken, stringifyError } = require("../../utils/request");
const router = require("../../utils/router");
const { openLegalPage } = require("../../utils/legal");
const { getWechatDisplayProfile } = require("../../utils/wechat-profile");

Page({
  data: {
    agreed: false,
    loading: false,
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  openUserAgreement() {
    openLegalPage("agreement");
  },

  openPrivacyPolicy() {
    openLegalPage("privacy");
  },

  loginWithPhone(event) {
    this.submitLogin((event && event.detail) || {});
  },

  submitLogin(detail) {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    const phoneAuthFailed = detail.errMsg && detail.errMsg.includes("fail");
    if (phoneAuthFailed) {
      wx.showToast({ title: "需要手机号才能继续", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    const displayProfilePromise = getWechatDisplayProfile();
    wx.login({
      success: async (loginResult) => {
        try {
          const displayProfile = await displayProfilePromise;
          const data = await request({
            url: "/api/v1/auth/login",
            method: "POST",
            timeout: 45000,
            data: {
              wxCode: loginResult.code || "",
              phoneCode: detail.code || "",
              nickname: displayProfile.nickname || "",
              avatarUrl: displayProfile.avatarUrl || "",
            },
          });
          setToken(data.token);
          router.go(data.nextRoute);
        } catch (error) {
          wx.showToast({ title: (stringifyError(error) || "登录失败，请重试").slice(0, 28), icon: "none" });
        } finally {
          this.setData({ loading: false });
        }
      },
      fail: (error) => {
        this.setData({ loading: false });
        wx.showToast({ title: (stringifyError(error) || "登录失败，请重试").slice(0, 28), icon: "none" });
      },
    });
  },
});
