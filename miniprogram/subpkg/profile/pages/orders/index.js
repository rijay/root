const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

Page({
  data: {
    orders: [],
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/profile/pages/orders/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/user/orders" });
      this.setData({ orders: data.orders || [] });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
});
