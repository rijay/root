const { appVersion } = require("../../../../config/version");
const router = require("../../../../utils/router");
const { defaultOnShareAppMessage } = require("../../../../utils/page-share");

function runtimeVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.version || appVersion;
  } catch (_) {
    return appVersion;
  }
}

Page({
  data: { version: appVersion },

  onLoad() {
    this.setData({ version: runtimeVersion() });
  },

  openLegal(event) {
    const type = event.currentTarget.dataset.type || "agreement";
    router.open(`/pages/legal/index?type=${encodeURIComponent(type)}`);
  },

  openPrivacyAccount() {
    router.open("/subpkg/profile/pages/privacy-account/index");
  },

  openPhggReference() {
    router.open("/subpkg/content/pages/phgg-reference/index?source=about");
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
