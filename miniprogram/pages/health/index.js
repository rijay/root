const router = require("../../utils/router");
const { getToken } = require("../../utils/request");
const { syncTabBar } = require("../../utils/tab-bar");

Page({
  onShow() { syncTabBar(this, 1); },
  startAssessment() {
    if (!getToken()) router.open(`/pages/login/index?intent=${encodeURIComponent("/pages/health/index")}`);
    else wx.showToast({ title: "健康起点评测即将开放", icon: "none" });
  },
});
