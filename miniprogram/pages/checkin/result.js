const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    session: {
      missCount: 0,
      records: [],
    },
    completedDays: 0,
    failed: false,
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/result/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/checkin/session" });
      const completedDays = data.session.records.filter((item) => item.checkedIn).length;
      this.setData({
        session: data.session,
        completedDays,
        failed: data.user.state === "CHECKIN_FAILED",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  goRefund() {
    wx.navigateTo({ url: "/subpkg/refund/pages/apply/index" });
  },

  goHistory() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/history/index" });
  },
});
