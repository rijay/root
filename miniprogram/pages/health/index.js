const router = require("../../utils/router");
const { getToken, request } = require("../../utils/request");
const { ensureHealthConsent } = require("../../utils/health-consent");
const { syncTabBar } = require("../../utils/tab-bar");

const START_PENDING_KEY = "ROOT4U_START_PENDING_V1";

Page({
  data: {
    loading: true,
    error: "",
    bootstrap: null,
    result: null,
  },

  onShow() {
    const safety = Boolean(this.data.result && this.data.result.safetyStatus !== "STANDARD_GUIDANCE");
    syncTabBar(this, 1, { hidden: safety });
    this.load();
  },

  applyBootstrap(bootstrap) {
    const recommendations = bootstrap && bootstrap.result && Array.isArray(bootstrap.result.recommendations)
      ? bootstrap.result.recommendations.map((item, index) => ({
        ...item,
        viewKey: item.scaleVersionId || `${item.title || "assessment"}-${index}`,
        detail: item.latestResult
          ? `${item.latestResult.levelTitle} · ${item.latestResult.score}/${item.latestResult.maximumScore} 分`
          : item.availability === "PUBLISHED"
          ? `${item.questionCount} 题 · 约 ${item.estimatedMinutes} 分钟`
          : "继续了解自己的日常状态",
        statusLabel: item.latestResult
          ? "已完成 · 查看结果"
          : item.availability === "PUBLISHED" ? "已为你匹配" : "即将开放",
      }))
      : [];
    const result = bootstrap && bootstrap.result ? {
      ...bootstrap.result,
      tags: Array.isArray(bootstrap.result.tags) ? bootstrap.result.tags : [],
      tips: Array.isArray(bootstrap.result.tips) ? bootstrap.result.tips : [],
      recommendations,
    } : null;
    const safety = Boolean(result && result.safetyStatus !== "STANDARD_GUIDANCE");
    this.setData({ bootstrap, result });
    syncTabBar(this, 1, { hidden: safety });
  },

  async load() {
    if (!getToken()) {
      this.setData({ loading: false, bootstrap: null, result: null });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const bootstrap = await request({ url: "/api/v1/health/root4u", scope: "root4u-home" });
      this.applyBootstrap(bootstrap);
      if (wx.getStorageSync(START_PENDING_KEY) && !bootstrap.consentRequired && bootstrap.eligibility === "ELIGIBLE") {
        wx.removeStorageSync(START_PENDING_KEY);
        this.openAssessment();
      }
    } catch (error) {
      this.setData({ error: error.message || "健康信息加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async startAssessment() {
    if (!getToken()) {
      router.open(`/pages/login/index?intent=${encodeURIComponent("/pages/health/index")}`);
      return;
    }
    const bootstrap = this.data.bootstrap;
    if (!bootstrap) return this.load();
    if (bootstrap.eligibility === "PROFILE_REQUIRED") {
      router.open("/pages/register/index");
      return;
    }
    if (bootstrap.eligibility === "AGE_RESTRICTED") {
      wx.showModal({ title: "暂不支持建档", content: "首发仅面向 18 岁及以上用户。", showCancel: false });
      return;
    }
    if (bootstrap.assessmentState === "COMPLETED") return;
    if (bootstrap.consentRequired) {
      wx.setStorageSync(START_PENDING_KEY, true);
      await ensureHealthConsent();
      return;
    }
    this.openAssessment();
  },

  openAssessment() {
    wx.navigateTo({ url: "/subpkg/health/pages/initial-assessment/index" });
  },

  openRecommendedScale(event) {
    const versionId = String(event.currentTarget.dataset.versionId || "").trim();
    if (!versionId) return;
    wx.navigateTo({ url: `/subpkg/health/pages/scale-assessment/index?versionId=${encodeURIComponent(versionId)}` });
  },

  manageConsent() {
    wx.navigateTo({ url: "/pages/health-consent/index?mode=manage" });
  },

  acknowledgeSafety() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  retry() {
    this.load();
  },
});
