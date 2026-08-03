const { WELCOME_STORAGE_KEY } = require("../../config/formal-launch-routes");

Page({
  data: { current: 0 },

  onLoad() {
    if (wx.getStorageSync(WELCOME_STORAGE_KEY) === true) this.enterHome();
  },

  onSlideChange(event) {
    const current = Number(event.detail.current) || 0;
    this.setData({ current });
    if (current === 1) wx.setStorageSync(WELCOME_STORAGE_KEY, true);
  },

  skipWelcome() {
    wx.setStorageSync(WELCOME_STORAGE_KEY, true);
    this.enterHome();
  },

  enterHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
