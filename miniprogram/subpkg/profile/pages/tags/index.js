const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

Page({
  data: {
    profile: null,
    rows: [],
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/profile/pages/tags/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/user/profile" });
      const profile = data.profile;
      this.setData({
        profile,
        rows: profile
          ? [
              { label: "参与原因", value: profile.join_reasons.join("、") },
              { label: "肠道状态", value: profile.gut_health_status },
              { label: "改善方式", value: profile.improvement_methods.join("、") },
              { label: "日常便型", value: profile.stool_type },
            ]
          : [],
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
});
