const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    refund: null,
    refundStatus: "",
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/refund/pages/status/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/refund/status" });
      this.setData({ refund: data.refund, refundStatus: data.refundStatus || "未申请" });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
});
