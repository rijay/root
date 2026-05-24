const { request } = require("../../../../utils/request");
const {
  formatOptionList,
  gutHealthLabel,
  improvementLabel,
  joinReasonLabel,
} = require("../../../../utils/option-labels");
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
              { label: "参与原因", value: formatOptionList(profile.join_reasons, joinReasonLabel) },
              { label: "肠道状态", value: gutHealthLabel(profile.gut_health_status) },
              { label: "改善方式", value: formatOptionList(profile.improvement_methods, improvementLabel) },
            ]
          : [],
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
});
