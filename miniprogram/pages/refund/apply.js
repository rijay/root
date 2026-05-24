const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    session: {
      orderId: "",
      startDate: "",
      endDate: "",
      missCount: 0,
    },
    loading: false,
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/refund/pages/apply/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/checkin/session" });
      this.setData({ session: data.session });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  async apply() {
    this.setData({ loading: true });
    try {
      await request({ url: "/api/v1/refund/apply", method: "POST", data: {} });
      wx.showToast({ title: "已提交", icon: "success" });
      wx.redirectTo({ url: "/subpkg/refund/pages/status/index" });
    } catch (error) {
      wx.showModal({ title: "暂无法申请", content: error.message || "请联系客服处理", showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
});
