const { appVersion } = require("../../../../config/version");
const router = require("../../../../utils/router");
const { getToken } = require("../../../../utils/request");

const ROUTE = "/subpkg/profile/pages/privacy-account/index";

function runtimeVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.version || appVersion;
  } catch (_) {
    return appVersion;
  }
}

Page({
  data: {
    version: appVersion,
    cancellationVisible: false,
    cancellationConfirmed: false,
  },

  onLoad() {
    this.setData({ version: runtimeVersion() });
  },

  openLegal(event) {
    const type = event.currentTarget.dataset.type || "privacy";
    router.open(`/pages/legal/index?type=${encodeURIComponent(type)}`);
  },

  openCancellation() {
    if (!getToken()) {
      router.open(`/pages/login/index?intent=${encodeURIComponent(ROUTE)}`);
      return;
    }
    this.setData({ cancellationVisible: true, cancellationConfirmed: false });
  },

  closeCancellation() {
    this.setData({ cancellationVisible: false, cancellationConfirmed: false });
  },

  toggleCancellationConfirmation() {
    this.setData({ cancellationConfirmed: !this.data.cancellationConfirmed });
  },

  submitCancellation() {
    if (!this.data.cancellationConfirmed) {
      wx.showToast({ title: "请先确认注销范围与后果", icon: "none" });
      return;
    }
    wx.showModal({
      title: "请联系客服完成注销",
      content: "正式受理时限与处理规则确认前，不会在小程序内制造已提交状态。",
      confirmText: "联系客服",
      cancelText: "暂不注销",
      success: (result) => {
        if (!result.confirm) return;
        this.closeCancellation();
        router.open("/subpkg/profile/pages/support/index?type=contact");
      },
    });
  },

  openSupport() {
    this.closeCancellation();
    router.open("/subpkg/profile/pages/support/index?type=contact");
  },

  preventTouchMove() {},
});
