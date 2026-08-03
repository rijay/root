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
    syncTabBar(this, 1);
    this.load();
  },

  async load() {
    if (!getToken()) {
      this.setData({ loading: false, bootstrap: null, result: null });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const bootstrap = await request({ url: "/api/v1/health/root4u", scope: "root4u-home" });
      this.setData({ bootstrap, result: bootstrap.result || null });
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

  manageConsent() {
    wx.navigateTo({ url: "/pages/health-consent/index?mode=manage" });
  },

  retry() {
    this.load();
  },
});
