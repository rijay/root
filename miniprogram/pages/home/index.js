const { syncTabBar } = require("../../utils/tab-bar");
const { request } = require("../../utils/request");
const router = require("../../utils/router");
const { presentHome } = require("../../utils/content-presenter");

Page({
  data: { state: "loading", items: [], current: 0 },

  onLoad() {
    this.loadContent();
  },

  onShow() {
    syncTabBar(this, 0);
  },

  async loadContent() {
    this.setData({ state: "loading" });
    try {
      const data = await request({
        url: "/api/v1/public/content/home",
        method: "GET",
        scope: "formal-home-content",
      });
      const items = presentHome(data);
      this.setData({ state: items.length ? "ready" : "empty", items, current: 0 });
    } catch (error) {
      this.setData({ state: "error", items: [] });
    }
  },

  changeSlide(event) {
    this.setData({ current: Number(event.detail.current || 0) });
  },

  openCurrent(event) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)];
    if (item && item.contentId) router.open(item.detailPath);
  },
});
