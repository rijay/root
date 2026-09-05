const { deleteAssessment, getHistory } = require("../../../../utils/health-assessment");
const {
  FILTERS,
  buildHistoryView,
  selectedRows,
  toggleSelection,
} = require("../../../../utils/assessment-history");
const router = require("../../../../utils/router");

Page({
  data: {
    loading: true,
    refreshing: false,
    errorText: "",
    refreshErrorText: "",
    assessmentType: "",
    assessments: [],
    visibleAssessments: [],
    selectedIds: [],
    activeFilter: "ALL",
    filters: FILTERS,
    recentPairIds: [],
    recentPairText: "",
    deletingAssessmentId: "",
  },

  onLoad(options = {}) {
    this.setData({ assessmentType: options.assessmentType || options.assessment_type || "" });
    this.load();
  },

  async load(options = {}) {
    const hasRows = this.data.assessments.length > 0;
    this.setData({
      loading: !hasRows,
      refreshing: hasRows || options.refreshing === true,
      errorText: "",
      refreshErrorText: "",
    });
    try {
      const allowed = await router.routeGuard("/subpkg/health/pages/history/index");
      if (!allowed) return;
      const data = await getHistory(this.data.assessmentType);
      this.applyView(data.assessments || [], this.data.selectedIds);
    } catch (error) {
      const errorText = error.message || "历史结果暂时无法加载";
      this.setData(hasRows ? { refreshErrorText: errorText } : { errorText });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  applyView(assessments, selectedIds) {
    this.setData(buildHistoryView(assessments, this.data.activeFilter, selectedIds));
  },

  setFilter(event) {
    const activeFilter = event.currentTarget.dataset.filter || "ALL";
    this.setData({ activeFilter });
    this.applyView(this.data.assessments, []);
  },

  toggleSelection(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    const result = toggleSelection(this.data.selectedIds, assessmentId);
    if (result.rejected) {
      wx.showToast({ title: "最多选择两次结果", icon: "none" });
      return;
    }
    this.applyView(this.data.assessments, result.selectedIds);
  },

  openResult(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    if (assessmentId) router.open(`/subpkg/health/pages/result/index?assessmentId=${assessmentId}`);
  },

  async confirmDelete(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    if (!assessmentId || this.data.deletingAssessmentId) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "删除这条评测记录？",
        content: "这条记录的问卷答案和评测结果将从账号中删除；若已用于综合建议，对应建议也会删除。删除后无法恢复。",
        confirmText: "删除",
        confirmColor: "#d23f31",
        success: (result) => resolve(result.confirm === true),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;
    this.setData({ deletingAssessmentId: assessmentId });
    try {
      const result = await deleteAssessment(assessmentId);
      this.applyView(
        this.data.assessments.filter((item) => item.assessmentId !== assessmentId),
        this.data.selectedIds.filter((id) => id !== assessmentId),
      );
      wx.showToast({
        title: result.invalidatedAdviceCount ? "记录及建议已删除" : result.deleted ? "记录已删除" : "记录已不存在",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败，请重试", icon: "none" });
    } finally {
      this.setData({ deletingAssessmentId: "" });
    }
  },

  compareRecent() {
    if (this.data.recentPairIds.length !== 2) {
      wx.showToast({ title: "暂无同问卷同版本记录", icon: "none" });
      return;
    }
    this.openCompare(selectedRows(this.data.assessments, this.data.recentPairIds));
  },

  compareSelected() {
    if (this.data.selectedIds.length !== 2) {
      wx.showToast({ title: "请选择两次结果", icon: "none" });
      return;
    }
    this.openCompare(selectedRows(this.data.assessments, this.data.selectedIds));
  },

  openCompare(rows) {
    if (rows.length !== 2) return;
    router.open(`/subpkg/health/pages/compare/index?leftAssessmentId=${rows[0].assessmentId}&rightAssessmentId=${rows[1].assessmentId}`);
  },

  onShareAppMessage() {
    return { title: "ROOT｜从了解当下开始", path: "/pages/health/index" };
  },

  async onPullDownRefresh() {
    await this.load({ refreshing: true });
    wx.stopPullDownRefresh();
  },
});
