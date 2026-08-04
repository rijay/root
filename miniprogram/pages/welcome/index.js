const { WELCOME_STORAGE_KEY } = require("../../config/formal-launch-routes");
const { request } = require("../../utils/request");
const { presentWelcome } = require("../../utils/content-presenter");

const WELCOME_CONTENT_KEY = "ROOT_WELCOME_CONTENT_V1";
const DEFAULT_SCREENS = Object.freeze([
  { slot: 1, copy: "欢迎加入\nRoot Member Club", assetUrl: "", assetState: "DEVELOPMENT_PLACEHOLDER" },
  { slot: 2, copy: "ROOT的研究源于肠道——\n人体最复杂也最被忽视的系统。\n\n我们不宣称“神奇功效”，\n也不相信“立竿见影”的幻觉。\n当你选择ROOT，不是简单地服用它，\n而是开始与身体重新合作。\n\n真正的健康，是当身体、心智与能量\n重新步入节奏时，你所感受到的安稳、\n轻盈与清晰。\n\n人如草木，根定而生。\nRoot的使命，就是帮你把身体还给身体自己。", assetUrl: "", assetState: "DEVELOPMENT_PLACEHOLDER" },
]);

Page({
  data: { current: 0, screens: DEFAULT_SCREENS },

  onLoad() {
    if (wx.getStorageSync(WELCOME_STORAGE_KEY) === true) this.enterHome();
    const cached = wx.getStorageSync(WELCOME_CONTENT_KEY);
    if (cached && Array.isArray(cached.screens) && cached.screens.length === 2) this.setData({ screens: cached.screens });
    this.loadPublishedContent();
  },

  async loadPublishedContent() {
    try {
      const data = await request({ url: "/api/v1/public/content/welcome", method: "GET", scope: "formal-welcome-content" });
      const screens = presentWelcome(data);
      if (!screens) return;
      wx.setStorageSync(WELCOME_CONTENT_KEY, { screens });
      this.setData({ screens });
    } catch (_) {
      // 已缓存内容或本地轻量回退视觉继续可用，不阻塞首次进入。
    }
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
