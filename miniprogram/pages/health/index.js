const { getToken } = require("../../utils/request");
const { getHealthConsentStatus } = require("../../utils/health-consent");
const { getCatalog, startAssessment } = require("../../utils/health-assessment");
const { syncTabBar } = require("../../utils/tab-bar");
const router = require("../../utils/router");

Page({
  data: {
    viewState: "loading",
    errorText: "",
    assessments: [],
    startingType: "",
    historyCount: 0,
  },

  onShow() {
    syncTabBar(this, 2);
    this.loadShell();
  },

  async loadShell() {
    this.setData({ viewState: "loading", errorText: "" });
    if (!getToken()) {
      this.setData({ viewState: "guest", assessments: [], historyCount: 0 });
      return;
    }
    try {
      const state = await router.fetchState();
      if (!state || !state.user || state.user.state === "GUEST") {
        this.setData({ viewState: "guest" });
        return;
      }
      if (state.user.state === "UNREGISTERED") {
        this.setData({ viewState: "accountRequired" });
        return;
      }
      const consent = await getHealthConsentStatus();
      if (consent.required && !consent.active) {
        this.setData({ viewState: "consentRequired" });
        return;
      }
      const catalog = await getCatalog();
      const assessments = catalog.assessments || [];
      const historyCount = assessments.reduce((sum, item) => sum + Number(item.historyCount || 0), 0);
      this.setData({
        assessments,
        historyCount,
        viewState: assessments.some((item) => item.available) ? "ready" : "contentGated",
      });
    } catch (error) {
      this.setData({
        viewState: getToken() ? "error" : "guest",
        errorText: error.message || "健康页暂时无法加载，请稍后重试。",
      });
    }
  },

  goLogin() {
    router.open(`/pages/login/index?intent=${encodeURIComponent("/pages/health/index")}`);
  },

  goRegister() {
    router.open("/pages/register/index");
  },

  openConsent() {
    router.open("/pages/health-consent/index?source=health");
  },

  confirmRetest() {
    return new Promise((resolve) => {
      wx.showModal({
        title: "开始一次新的复测？",
        content: "已有评测结果会继续保留。同一问卷 ID 与版本的结果可用于前后对比。",
        confirmText: "开始复测",
        cancelText: "暂不",
        success: (result) => resolve(result.confirm === true),
        fail: () => resolve(false),
      });
    });
  },

  async beginAssessment(event) {
    const assessmentType = event.currentTarget.dataset.assessmentType;
    if (!assessmentType || this.data.startingType) return;
    const item = this.data.assessments.find((candidate) => candidate.assessmentType === assessmentType);
    if (!item || !item.available) {
      wx.showToast({ title: (item && item.unavailableText) || "暂未开放", icon: "none" });
      return;
    }
    if (item.canRetest && !item.canResume && !(await this.confirmRetest())) return;
    this.setData({ startingType: assessmentType });
    try {
      const result = await startAssessment(assessmentType);
      const assessmentId = result.assessment && result.assessment.assessmentId;
      if (!assessmentId) throw new Error("评测创建失败");
      router.open(`/subpkg/health/pages/assessment/index?assessmentId=${assessmentId}`);
    } catch (error) {
      wx.showToast({ title: error.message || "暂时无法开始评测", icon: "none" });
    } finally {
      this.setData({ startingType: "" });
    }
  },

  openLatest(event) {
    const assessmentId = event.currentTarget.dataset.assessmentId;
    if (assessmentId) router.open(`/subpkg/health/pages/result/index?assessmentId=${assessmentId}`);
  },

  openHistory() {
    router.open("/subpkg/health/pages/history/index");
  },

  openPrivacy() {
    router.open("/pages/legal/index?type=privacy&source=health");
  },

  openSupport() {
    router.open("/subpkg/profile/pages/support/index?topic=health&source=health");
  },

  onShareAppMessage() {
    return { title: "ROOT｜从了解当下开始", path: "/pages/health/index" };
  },
});
