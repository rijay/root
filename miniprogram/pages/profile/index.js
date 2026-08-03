const router = require("../../utils/router");
const { getToken } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");

Page({
  data: { loggedIn: false },
  onShow() {
    syncTabBar(this, 3);
    this.setData({ loggedIn: Boolean(getToken()) });
  },
  openLogin() {
    if (!this.data.loggedIn) {
      router.open(`/pages/login/index?intent=${encodeURIComponent("/pages/profile/index")}`);
    }
  },
  openMemberEntry() {
    if (!this.data.loggedIn) router.open(`/pages/login/index?intent=${encodeURIComponent("/pages/profile/index")}`);
    else wx.showToast({ title: "会员中心入口即将开放", icon: "none" });
  },
  openAbout() { router.open("/subpkg/profile/pages/about/index"); },
  openSupport() { router.open("/subpkg/profile/pages/support/index"); },
});
