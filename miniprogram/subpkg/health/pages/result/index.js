const {
  getAssessment,
  startAssessment,
} = require("../../../../utils/health-assessment");
const router = require("../../../../utils/router");
const env = require("../../../../config/env");
const { executeContentAction } = require("../../../../utils/content-action");
const { failureReason, track } = require("../../../../utils/analytics");

Page({
  data: {
    loading: true,
    errorText: "",
    assessmentId: "",
    assessment: null,
    restarting: false,
    trialEligible: false,
    trialOpening: false,
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
      const assessment = data.assessment;
      this.setData({
        assessment,
        trialEligible: assessment.assessmentType === "GUT_REGULARITY"
          && Number(assessment.questionnaireVersion) >= 2
          && assessment.status === "COMPLETED"
          && !assessment.safetyStopped,
      });
      track("assessment_result_view", {
        assessmentType: assessment.assessmentType,
        questionnaireVersion: assessment.questionnaireVersion || 0,
        resultCode: assessment.result && (assessment.result.code || assessment.result.resultCode || assessment.result.title) || "UNKNOWN",
      });
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

  async claimTrialPack() {
    if (this.data.trialOpening || !this.data.trialEligible) return;
    this.setData({ trialOpening: true });
    try {
      const opened = await executeContentAction({
        type: "ROOT_MEMBER_CENTER",
        shortLink: env.rootGutTrialShortLink,
      });
      track("trial_pack_action", {
        assessmentType: this.data.assessment.assessmentType,
        questionnaireVersion: this.data.assessment.questionnaireVersion || 0,
        result: opened ? "OPENED" : "NOT_OPENED",
        failureReason: opened ? "" : "TARGET_UNAVAILABLE",
      });
      if (!opened) wx.showToast({ title: "领取页面暂时无法打开", icon: "none" });
    } catch (error) {
      track("trial_pack_action", {
        assessmentType: this.data.assessment.assessmentType,
        questionnaireVersion: this.data.assessment.questionnaireVersion || 0,
        result: "FAILED",
        failureReason: failureReason(error),
      });
      wx.showToast({ title: "领取页面暂时无法打开", icon: "none" });
    } finally {
      this.setData({ trialOpening: false });
    }
  },

  onShareAppMessage() {
    return {
      title: "ROOT｜从了解当下开始",
      path: "/pages/health/index",
    };
  },
});
