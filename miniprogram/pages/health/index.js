const { getToken } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    viewState: "loading",
    errorText: "",
  },

  onShow() {
    this.loadShell();
  },

  async loadShell() {
    this.setData({ viewState: "loading", errorText: "" });
    if (!getToken()) {
      this.setData({ viewState: "guest" });
      return;
    }
    try {
      const state = await router.fetchState();
      if (!state || !state.user || state.user.state === "GUEST") {
        this.setData({ viewState: "guest" });
        return;
      }
      if (state.user.state === "UNREGISTERED") {
        this.setData({ viewState: "accountRequired" });
        return;
      }
      this.setData({ viewState: "contentGated" });
    } catch (error) {
      this.setData({
        viewState: getToken() ? "error" : "guest",
        errorText: "账号状态暂未确认，请稍后重试。",
      });
    }
  },

  goLogin() {
    router.go("/pages/login/index?source=health");
  },

  goRegister() {
    router.go("/pages/register/index?source=health");
  },

  openPrivacy() {
    router.open("/pages/legal/index?type=privacy&source=health");
  },

  openSupport() {
    router.open("/subpkg/profile/pages/support/index?topic=health&source=health");
  },
});
