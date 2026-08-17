const { compareAssessments } = require("../../../../utils/health-assessment");
const router = require("../../../../utils/router");

const REASON_COPY = {
  SAME_ASSESSMENT: "请选择两次不同的评测结果。",
  ASSESSMENT_NOT_COMPLETED: "存在未完成的评测，暂不支持对比。",
  QUESTIONNAIRE_VERSION_MISMATCH: "问卷版本不同，暂不支持直接对比。你仍可分别查看两次结果。",
  SAFETY_RESULT_NOT_COMPARABLE: "安全分支结果不进行数值对比，请分别查看结果中的优先行动。",
  NO_SHARED_DIMENSIONS: "两次结果没有可直接对比的相同维度。",
};

Page({
  data: {
    loading: true,
    refreshing: false,
    errorText: "",
    leftAssessmentId: "",
    rightAssessmentId: "",
    comparison: null,
    reasonText: "",
  },

  onLoad(options = {}) {
    this.setData({
      leftAssessmentId: options.leftAssessmentId || options.left_assessment_id || "",
      rightAssessmentId: options.rightAssessmentId || options.right_assessment_id || "",
    });
    this.load();
  },

  async load() {
    const hasComparison = Boolean(this.data.comparison);
    this.setData({ loading: !hasComparison, refreshing: hasComparison, errorText: "" });
    try {
      const allowed = await router.routeGuard("/subpkg/health/pages/compare/index");
      if (!allowed) return;
      if (!this.data.leftAssessmentId || !this.data.rightAssessmentId) throw new Error("请选择两次评测结果");
      const comparison = await compareAssessments(this.data.leftAssessmentId, this.data.rightAssessmentId);
      this.setData({
        comparison,
        reasonText: comparison.comparable ? "" : (REASON_COPY[comparison.reason] || "两次结果暂不支持直接对比。"),
      });
    } catch (error) {
      this.setData({ errorText: error.message || "对比结果暂时无法加载" });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  openResult(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    if (assessmentId) router.open(`/subpkg/health/pages/result/index?assessmentId=${assessmentId}`);
  },

  onShareAppMessage() {
    return { title: "ROOT｜从了解当下开始", path: "/pages/health/index" };
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },
});
