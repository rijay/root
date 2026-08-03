const { executeContentAction } = require("../../../../utils/content-action");
const { request } = require("../../../../utils/request");

Page({
  data: { state: "loading", item: null },

  onLoad(options = {}) {
    this.contentId = String(options.contentId || "").trim();
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
