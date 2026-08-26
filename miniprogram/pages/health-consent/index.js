const { getHealthConsentStatus } = require("../../utils/health-consent");
const { openLegalPage } = require("../../utils/legal");
const { request } = require("../../utils/request");
const router = require("../../utils/router");
const { defaultOnShareAppMessage } = require("../../utils/page-share");

Page({
  data: {
    loading: true,
    submitting: false,
    confirmed: false,
    required: true,
    configured: false,
    active: false,
    manageMode: false,
    notice: {
      title: "身体反馈与健康记录单独同意",
      purposes: [],
      dataCategories: [],
      necessity: "",
      refusalImpact: "",
      modelProcessingText: "",
      controllerName: "",
      contact: "",
      retentionText: "",
      policyVersion: "",
    },
  },

  onLoad(options = {}) {
    this.setData({ manageMode: options.mode === "manage" });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const status = await getHealthConsentStatus();
      if ((!status.required || status.active) && !this.data.manageMode) {
        this.finishAgreement();
        return;
      }
      this.setData({ required: status.required, active: status.active, configured: status.configured, notice: status.notice });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleConfirmed(event) {
    this.setData({ confirmed: Boolean(event.detail.value && event.detail.value.length) });
  },

  openPrivacyPolicy() {
    openLegalPage("privacy");
  },

  async agree() {
    if (!this.data.confirmed || !this.data.configured || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await request({
        url: "/api/v1/privacy/health-consent",
        method: "POST",
        data: {
          decision: "GRANTED",
          policyVersion: this.data.notice.policyVersion,
          sourceChannel: "MINIPROGRAM_HEALTH_CONSENT",
        },
      });
      if (!result.active) throw new Error("同意记录未生效，请重试");
      this.finishAgreement();
    } catch (error) {
      wx.showToast({ title: error.message || "确认失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async decline() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      if (this.data.configured && this.data.notice.policyVersion) {
        await request({
          url: "/api/v1/privacy/health-consent",
          method: "POST",
          data: {
            decision: "WITHDRAWN",
            policyVersion: this.data.notice.policyVersion,
            sourceChannel: "MINIPROGRAM_HEALTH_CONSENT",
          },
        });
      }
    } catch (_) {
      // Declining must remain available even if the audit write temporarily fails.
    } finally {
      this.setData({ submitting: false });
      router.go("/pages/health/index");
    }
  },

  async withdraw() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await request({
        url: "/api/v1/privacy/health-consent",
        method: "POST",
        data: {
          decision: "WITHDRAWN",
          policyVersion: this.data.notice.policyVersion,
          sourceChannel: "MINIPROGRAM_PRIVACY_SETTINGS",
        },
      });
      if (result.active) throw new Error("撤回未生效，请重试");
      this.setData({ active: false, confirmed: false });
      wx.showToast({ title: "已撤回", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "撤回失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBack() {
    this.finishAgreement();
  },

  finishAgreement() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: "/pages/home/index" });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
