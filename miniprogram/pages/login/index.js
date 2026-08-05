const { request, setToken, stringifyError } = require("../../utils/request");
const { consume: consumeAuthIntent, remember: rememberAuthIntent } = require("../../utils/auth-intent");
const router = require("../../utils/router");
const { openLegalPage } = require("../../utils/legal");
const { authenticateWechat, showLoginFailure } = require("../../utils/wechat-login-flow");

const REGISTRATION_CONTEXT_STORAGE_KEY = "ROOT_REGISTRATION_CONTEXT_V1";

function decodeIntent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return "";
  }
}

Page({
  data: {
    loading: false,
    loginStatusText: "",
    identityConflict: false,
    agreementAccepted: false,
  },

  onLoad(options = {}) {
    const intent = decodeIntent(options.intent);
    if (intent) rememberAuthIntent(intent);
  },

  openUserAgreement() {
    openLegalPage("agreement");
  },

  openPrivacyPolicy() {
    openLegalPage("privacy");
  },

  changeAgreement(event) {
    const values = event && event.detail && Array.isArray(event.detail.value)
      ? event.detail.value
      : [];
    this.setData({ agreementAccepted: values.includes("accepted") });
  },

  async loginWithPhone(event) {
    if (this.data.loading) return;
    if (!this.data.agreementAccepted) {
      wx.showToast({ title: "请先阅读并勾选协议", icon: "none" });
      return;
    }
    const detail = (event && event.detail) || {};
    if (!detail.code || /fail|deny|cancel/i.test(String(detail.errMsg || ""))) {
      wx.showToast({ title: "未授权手机号，可稍后重试", icon: "none" });
      return;
    }

    this.setData({ loading: true, loginStatusText: "正在连接微信…", identityConflict: false });
    const waitingTimer = setTimeout(() => {
      if (this.data.loading) this.setData({ loginStatusText: "验证仍在进行，请稍候…" });
    }, 3000);
    try {
      const data = await authenticateWechat({
        request,
        phoneCode: detail.code,
        onStage: (loginStatusText) => this.setData({ loginStatusText }),
      });
      if (data.sessionOutcome === "IDENTITY_CONFLICT") {
        this.setData({ identityConflict: true, loginStatusText: "" });
        return;
      }
      if (!data.token) throw new Error("手机号验证未完成");
      setToken(data.token);
      const outcome = data.sessionOutcome || (data.nextRoute === "/pages/register/index" ? "NEW_USER" : "REGISTERED");
      if (["NEW_USER", "PROFILE_REQUIRED"].includes(outcome)) {
        wx.setStorageSync(REGISTRATION_CONTEXT_STORAGE_KEY, {
          outcome,
          phone: data.user && data.user.phone || "",
          userId: data.user && data.user.userId || "",
        });
        router.go("/pages/register/index");
        return;
      }
      wx.showToast({ title: "手机号已验证", icon: "success" });
      router.go(consumeAuthIntent() || "/pages/home/index");
    } catch (error) {
      if (String(error && error.code || "").includes("IDENTITY") && String(error && error.code || "").includes("CONFLICT")) {
        this.setData({ identityConflict: true, loginStatusText: "" });
        return;
      }
      // getPhoneNumber codes are single-use. A retry must start from a fresh
      // button tap so the platform can issue a new phone authorization code.
      showLoginFailure(stringifyError(error) || "登录失败，请重试");
    } finally {
      clearTimeout(waitingTimer);
      this.setData({ loading: false });
    }
  },
});
