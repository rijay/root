const {
  generateHealthAdvice,
  getCatalog,
  getHealthOverview,
} = require("../../utils/health-assessment");
const { syncTabBar } = require("../../utils/tab-bar");

Page({
  data: {
    loading: true,
    errorText: "",
    assessments: [],
    storageMode: "",
    overview: null,
    overviewErrorText: "",
    adviceLoading: false,
  },

  onShow() {
    syncTabBar(this, 2);
    this.loadCatalog();
  },

  async loadCatalog() {
    this.setData({ loading: true, errorText: "", overviewErrorText: "" });
    try {
      const data = await getCatalog();
      this.setData({ assessments: data.assessments || [], storageMode: data.storageMode || "" });
      try {
        const overview = await getHealthOverview();
        this.setData({ overview });
        if (overview.ready && !overview.advice) this.generateAdvice();
      } catch (error) {
        this.setData({ overviewErrorText: error.message || "当前状态暂时无法加载" });
      }
    } catch (error) {
      this.setData({ errorText: error.message || "健康评测暂时无法加载" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async generateAdvice() {
    if (this.data.adviceLoading || !this.data.overview || !this.data.overview.ready) return;
    this.setData({ adviceLoading: true, overviewErrorText: "" });
    try {
      const overview = await generateHealthAdvice(this.data.overview);
      this.setData({ overview });
    } catch (error) {
      this.setData({ overviewErrorText: error.message || "健康建议暂时无法生成" });
    } finally {
      this.setData({ adviceLoading: false });
    }
  },

  async reloadOverview() {
    try {
      this.setData({ overviewErrorText: "" });
      const overview = await getHealthOverview();
      this.setData({ overview });
      if (overview.ready && !overview.advice) this.generateAdvice();
    } catch (error) {
      this.setData({ overviewErrorText: error.message || "当前状态暂时无法加载" });
    }
  },

  startAssessment(event) {
    const assessmentType = event.currentTarget.dataset.type;
    const item = this.data.assessments.find((entry) => entry.assessmentType === assessmentType);
    if (!item || item.available === false) return;
    if (item.inProgress && item.inProgress.assessmentId) {
      wx.navigateTo({ url: `/subpkg/health/pages/assessment/index?assessmentId=${item.inProgress.assessmentId}` });
      return;
    }
    wx.navigateTo({ url: `/subpkg/health/pages/assessment/index?assessmentType=${assessmentType}` });
  },

  openLatest(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    if (assessmentId) wx.navigateTo({ url: `/subpkg/health/pages/result/index?assessmentId=${assessmentId}` });
  },

  openHistory() {
    wx.navigateTo({ url: "/subpkg/health/pages/history/index" });
  },

  onShareAppMessage() {
    return { title: "ROOT 健康评测", path: "/pages/health/index" };
  },
});
