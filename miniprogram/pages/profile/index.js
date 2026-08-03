const router = require("../../utils/router");
const { getToken } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");

Page({
  data: { loggedIn: false },
  onShow() {
    syncTabBar(this, 3);
    this.setData({ loggedIn: Boolean(getToken()) });
  },
  openLogin() { router.open("/pages/login/index?intent=profile"); },
  openMemberEntry(event) {
    const intent = event.currentTarget.dataset.intent;
    if (!this.data.loggedIn) router.open(`/pages/login/index?intent=${intent}`);
    else wx.showToast({ title: "会员中心入口即将开放", icon: "none" });
  },
  openAbout() { router.open("/subpkg/profile/pages/about/index"); },
  openSupport() { router.open("/subpkg/profile/pages/support/index"); },
});
