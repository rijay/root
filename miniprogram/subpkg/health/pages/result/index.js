const {
  getAssessment,
  startAssessment,
} = require("../../../../utils/health-assessment");
const router = require("../../../../utils/router");

Page({
  data: {
    loading: true,
    errorText: "",
    assessmentId: "",
    assessment: null,
    restarting: false,
  },

  onLoad(options = {}) {
    this.setData({ assessmentId: options.assessmentId || options.assessment_id || "" });
    this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: "" });
    try {
      const allowed = await router.routeGuard("/subpkg/health/pages/result/index");
      if (!allowed) return;
      if (!this.data.assessmentId) throw new Error("评测记录不存在");
      const data = await getAssessment(this.data.assessmentId);
      if (data.assessment.status === "IN_PROGRESS") {
        wx.redirectTo({ url: `/subpkg/health/pages/assessment/index?assessmentId=${this.data.assessmentId}` });
        return;
      }
      this.setData({ assessment: data.assessment });
    } catch (error) {
      this.setData({ errorText: error.message || "结果暂时无法加载" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async restart() {
    if (this.data.restarting || !this.data.assessment) return;
    this.setData({ restarting: true });
    try {
      const result = await startAssessment(this.data.assessment.assessmentType);
      const assessmentId = result.assessment && result.assessment.assessmentId;
      if (!assessmentId) throw new Error("复测创建失败");
      wx.redirectTo({ url: `/subpkg/health/pages/assessment/index?assessmentId=${assessmentId}` });
    } catch (error) {
      wx.showToast({ title: error.message || "暂时无法开始复测", icon: "none" });
    } finally {
      this.setData({ restarting: false });
    }
  },

  openHistory() {
    router.open(`/subpkg/health/pages/history/index?assessmentType=${this.data.assessment.assessmentType}`);
  },

  backToHealth() {
    wx.switchTab({ url: "/pages/health/index" });
  },

  onShareAppMessage() {
    return {
      title: "ROOT｜从了解当下开始",
      path: "/pages/health/index",
    };
  },
});
