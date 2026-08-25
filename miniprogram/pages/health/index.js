const {
  generateHealthAdvice,
  getCatalog,
  getHealthOverview,
} = require("../../utils/health-assessment");
const {
  ADVICE_CONFIRMATION_DELAYS_MS,
  isAdviceResultUnknown,
} = require("../../utils/health-advice-ui");
const { syncTabBar } = require("../../utils/tab-bar");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    loading: true,
    errorText: "",
    assessments: [],
    storageMode: "",
    overview: null,
    overviewErrorText: "",
    adviceLoading: false,
    adviceConfirming: false,
    adviceStatusText: "",
  },

  onShow() {
    this.invalidateAdviceRun();
    this._healthPageVisible = true;
    this.setData({ adviceLoading: false, adviceConfirming: false, adviceStatusText: "" });
    syncTabBar(this, 2);
    this.loadCatalog();
  },

  onHide() {
    this._healthPageVisible = false;
    this.invalidateAdviceRun();
  },

  onUnload() {
    this._healthPageVisible = false;
    this.invalidateAdviceRun();
  },

  invalidateAdviceRun() {
    this._adviceRunId = Number(this._adviceRunId || 0) + 1;
    if (this._adviceSlowTimer) clearTimeout(this._adviceSlowTimer);
    this._adviceSlowTimer = null;
  },

  adviceRunIsCurrent(runId) {
    return this._healthPageVisible === true && this._adviceRunId === runId;
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
    const runId = Number(this._adviceRunId || 0) + 1;
    this._adviceRunId = runId;
    this.setData({
      adviceLoading: true,
      adviceConfirming: false,
      adviceStatusText: "正在结合两项评测生成建议…",
      overviewErrorText: "",
    });
    this._adviceSlowTimer = setTimeout(() => {
      if (this.adviceRunIsCurrent(runId)) {
        this.setData({ adviceStatusText: "生成需要一点时间，请保持当前页面…" });
      }
    }, 8000);
    try {
      const overview = await generateHealthAdvice(this.data.overview);
      if (this.adviceRunIsCurrent(runId)) this.setData({ overview });
    } catch (error) {
      if (!this.adviceRunIsCurrent(runId)) return;
      if (isAdviceResultUnknown(error)) {
        const confirmed = await this.confirmPendingAdvice(runId);
        if (!confirmed && this.adviceRunIsCurrent(runId)) {
          this.setData({
            overviewErrorText: "建议生成时间较长，暂未确认保存结果。可以稍后重试，系统不会重复生成同一组建议。",
          });
        }
      } else {
        this.setData({ overviewErrorText: error.message || "健康建议暂时无法生成" });
      }
    } finally {
      if (this._adviceSlowTimer) clearTimeout(this._adviceSlowTimer);
      this._adviceSlowTimer = null;
      if (this.adviceRunIsCurrent(runId)) {
        this.setData({ adviceLoading: false, adviceConfirming: false, adviceStatusText: "" });
      }
    }
  },

  async confirmPendingAdvice(runId) {
    this.setData({
      adviceConfirming: true,
      adviceStatusText: "建议已提交，正在确认保存结果…",
    });
    for (const delayMs of ADVICE_CONFIRMATION_DELAYS_MS) {
      await wait(delayMs);
      if (!this.adviceRunIsCurrent(runId)) return false;
      try {
        const overview = await getHealthOverview();
        if (overview.advice) {
          this.setData({ overview });
          return true;
        }
      } catch (error) {
        // The next bounded confirmation read can recover from a transient read failure.
      }
    }
    return false;
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
