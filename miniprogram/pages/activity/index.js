const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    profile: null,
    tags: "",
    loading: false,
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/activity/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/user/profile" });
      const profile = data.profile;
      const tags = profile ? [profile.gut_health_status, profile.stool_type].filter(Boolean).join(" / ") : "身体节奏";
      this.setData({ profile, tags });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  goMatch() {
    wx.navigateTo({ url: "/pages/order/match" });
  },

  confirmStart() {
    wx.showModal({
      title: "确认开始",
      content: "确认已收到产品并准备开始7天打卡？开始后将按今天作为Day1。",
      confirmText: "确认开始",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ loading: true });
        try {
          await request({
            url: "/api/v1/checkin/start",
            method: "POST",
            data: { confirmReceived: true },
          });
          router.go("/pages/home/index");
        } catch (error) {
          wx.showToast({ title: error.message || "启动失败", icon: "none" });
        } finally {
          this.setData({ loading: false });
        }
      },
    });
  },
});
