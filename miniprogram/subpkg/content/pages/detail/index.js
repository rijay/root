const { executeContentAction } = require("../../../../utils/content-action");
const { request } = require("../../../../utils/request");

function resolveWordmarkTop() {
  try {
    const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    if (capsule && Number.isFinite(capsule.bottom)) return Math.max(132, Math.round(capsule.bottom + 88));
  } catch (error) {
    // 模拟器或低版本环境回退到 Ardot 390 × 844 画板位置。
  }
  return 132;
}

Page({
  data: { state: "loading", item: null, wordmarkTop: 132 },

  onLoad(options = {}) {
    this.contentId = String(options.contentId || "").trim();
    this.setData({ wordmarkTop: resolveWordmarkTop() });
    this.loadDetail();
  },

  async loadDetail() {
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(this.contentId)) {
      this.setData({ state: "error" });
      return;
    }
    this.setData({ state: "loading" });
    try {
      const data = await request({
        url: `/api/v1/public/content/detail?contentId=${encodeURIComponent(this.contentId)}`,
        method: "GET",
        scope: `formal-content:${this.contentId}`,
      });
      this.setData({ state: "ready", item: data.item });
    } catch (error) {
      this.setData({ state: "error", item: null });
    }
  },

  handleAction() {
    if (this.data.item) executeContentAction(this.data.item.action);
  },
});
