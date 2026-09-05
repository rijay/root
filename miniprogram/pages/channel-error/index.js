const { defaultOnShareAppMessage } = require("../../utils/page-share");

Page({
  data: {
    title: "这个渠道码暂时无法使用",
    detail: "渠道信息无效、已过期或配置尚未生效。不会记录本次渠道，也不会覆盖已有渠道。",
  },

  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  scanAgain() {
    if (typeof wx.exitMiniProgram === "function") {
      wx.exitMiniProgram();
      return;
    }
    wx.showToast({ title: "请返回微信后重新扫码", icon: "none" });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
