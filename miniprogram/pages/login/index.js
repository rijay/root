const env = require("../../config/env");
const { request, setToken, stringifyError } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    isDevelop: env.envVersion === "develop",
    agreed: false,
    loading: false,
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  loginWithPhone(event) {
    this.submitLogin((event && event.detail) || {});
  },

  loginWithDemoPhone() {
    this.submitLogin({ errMsg: "getPhoneNumber:fail devtools mock", code: "dev_phone_code", forceMock: true });
  },

  submitLogin(detail) {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    const phoneAuthFailed = detail.errMsg && detail.errMsg.includes("fail");
    if (phoneAuthFailed && !env.allowMockPhoneLogin) {
      wx.showToast({ title: "需要手机号才能继续", icon: "none" });
      return;
    }
    if (phoneAuthFailed && env.allowMockPhoneLogin) {
      wx.showToast({ title: "调试模式使用演示手机号", icon: "none" });
    }

    this.setData({ loading: true });
    if (env.allowMockPhoneLogin && env.envVersion === "develop") {
      this.submitMockLogin(detail);
      return;
    }
    wx.login({
      success: async (loginResult) => {
        try {
          const useMockPhone = Boolean(env.allowMockPhoneLogin && (phoneAuthFailed || detail.forceMock || env.envVersion === "develop"));
          const data = await request({
            url: "/api/v1/auth/login",
            method: "POST",
            data: {
              wxCode: loginResult.code || "dev_wx_code",
              phoneCode: detail.code || "",
              ...(useMockPhone ? { phone: env.demoPhone, useMockPhone: true } : {}),
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
      fail: async (error) => {
        if (env.allowMockPhoneLogin) {
          try {
            const data = await request({
              url: "/api/v1/auth/login",
              method: "POST",
              data: {
                wxCode: "dev_wx_login_failed",
                phoneCode: detail.code || "dev_phone_code",
                phone: env.demoPhone,
                useMockPhone: true,
              },
            });
            setToken(data.token);
            router.go(data.nextRoute);
            return;
          } catch (requestError) {
            wx.showToast({ title: (stringifyError(requestError) || "登录失败").slice(0, 28), icon: "none" });
          } finally {
            this.setData({ loading: false });
          }
          return;
        }
        this.setData({ loading: false });
        wx.showToast({ title: (stringifyError(error) || "登录失败，请重试").slice(0, 28), icon: "none" });
      },
    });
  },

  async submitMockLogin(detail) {
    try {
      const data = await request({
        url: "/api/v1/auth/login",
        method: "POST",
        data: {
          wxCode: "dev_wx_code",
          phoneCode: detail.code || "dev_phone_code",
          phone: env.demoPhone,
          useMockPhone: true,
        },
      });
      setToken(data.token);
      router.go(data.nextRoute);
    } catch (error) {
      wx.showToast({ title: (stringifyError(error) || "登录失败").slice(0, 28), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
