const { request, setToken, stringifyError } = require("../../utils/request");
const { activityLoginRecoveryUrl, ROUTE_INTENT_STORAGE_KEY } = require("../../utils/activity-actions");
const router = require("../../utils/router");
const { openLegalPage } = require("../../utils/legal");
const {
  authenticateWechat,
  ensureLoginAgreement,
  showLoginFailure,
} = require("../../utils/wechat-login-flow");

function consumeActivityLoginRecovery() {
  const value = wx.getStorageSync(ROUTE_INTENT_STORAGE_KEY);
  const url = activityLoginRecoveryUrl(value, Date.now());
  if (value) wx.removeStorageSync(ROUTE_INTENT_STORAGE_KEY);
  return url;
}

Page({
  data: {
    agreed: false,
    loading: false,
    loginStatusText: "",
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

  async loginWithWechat() {
    if (this.data.loading) return;
    const confirmed = await ensureLoginAgreement(this.data.agreed);
    if (!confirmed) return;
    if (!this.data.agreed) this.setData({ agreed: true });
    return this.submitLogin({});
  },

  async submitLogin(detail) {
    if (this.data.loading) return;
    this.setData({ loading: true, loginStatusText: "正在连接微信…" });
    try {
      const data = await authenticateWechat({
        request,
        phoneCode: detail.code || "",
        onStage: (loginStatusText) => this.setData({ loginStatusText }),
      });
      setToken(data.token);
      this.setData({ loginStatusText: "身份验证完成，正在进入…" });
      const nextRoute = String(data.nextRoute || "");
      const requiresRegistration = nextRoute.split("?")[0] === "/pages/register/index";
      router.go((requiresRegistration ? "" : consumeActivityLoginRecovery()) || nextRoute || "/pages/home/index");
    } catch (error) {
      showLoginFailure(stringifyError(error) || "登录失败，请重试", () => this.submitLogin(detail));
    } finally {
      this.setData({ loading: false, loginStatusText: "" });
    }
  },
});
