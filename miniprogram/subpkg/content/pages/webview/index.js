const { request } = require("../../../../utils/request");
const { defaultOnShareAppMessage } = require("../../../../utils/page-share");

Page({
  data: { state: "loading", url: "" },

  onLoad(options = {}) {
    this.actionId = String(options.actionId || "").trim();
    this.loadAction();
  },

  async loadAction() {
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(this.actionId)) {
      this.setData({ state: "error" });
      return;
    }
    try {
      const data = await request({
        url: `/api/v1/public/content/action?actionId=${encodeURIComponent(this.actionId)}`,
        method: "GET",
        scope: `formal-content-action:${this.actionId}`,
      });
      const url = String(data.action?.url || "");
      if (data.action?.type !== "BUSINESS_WEBVIEW" || !url.startsWith("https://")) throw new Error("内容链接不可用");
      this.setData({ state: "ready", url });
    } catch (_) {
      this.setData({ state: "error", url: "" });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
