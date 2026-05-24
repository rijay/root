const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

Page({
  data: {
    refund: null,
    refundStatus: "",
    eligibility: null,
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/refund/pages/status/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/refund/status" });
      this.setData({ refund: data.refundWorkItem || data.refund, refundStatus: data.refundStatus || "未进入处理", eligibility: data.eligibility || null });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
});
