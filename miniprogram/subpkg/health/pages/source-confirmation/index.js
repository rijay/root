const {
  confirmAssessmentSource,
  getAssessmentSourceGate,
  resultPath,
  safeAssessmentId,
} = require("../../../../utils/assessment-source-survey");
const { defaultOnShareAppMessage } = require("../../../../utils/page-share");

Page({
  data: {
    loading: true,
    submitting: false,
    errorText: "",
    assessmentId: "",
    title: "你是从哪里知道 ROOT 的？",
    subtitle: "请选择最接近的一项，帮助我们优化后续活动与服务。",
    configVersion: 0,
    options: [],
    selectedOptionId: "",
  },

  onLoad(options = {}) {
    const assessmentId = safeAssessmentId(options.assessmentId || options.assessment_id);
    this.setData({ assessmentId });
    if (wx.hideShareMenu) wx.hideShareMenu();
    if (!assessmentId) {
      this.setData({ loading: false, errorText: "评测记录无效" });
      return;
    }
    this.load();
  },

  async load() {
    if (!this.data.assessmentId) return;
    this.setData({ loading: true, errorText: "" });
    try {
      const gate = await getAssessmentSourceGate(this.data.assessmentId);
      if (!gate || gate.required !== true || !gate.config) {
        this.goResult();
        return;
      }
      this.setData({
        title: gate.config.title || this.data.title,
        subtitle: gate.config.subtitle || this.data.subtitle,
        configVersion: Number(gate.config.configVersion || 0),
        options: (gate.config.options || []).map((item) => ({ ...item, selected: false })),
        selectedOptionId: "",
      });
    } catch (error) {
      this.setData({ errorText: error.message || "渠道选项暂时无法加载" });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectOption(event) {
    if (this.data.submitting) return;
    const optionId = String(event.currentTarget.dataset.optionId || "");
    this.setData({
      selectedOptionId: optionId,
      options: this.data.options.map((item) => ({ ...item, selected: item.optionId === optionId })),
    });
  },

  async confirm() {
    if (!this.data.selectedOptionId || this.data.submitting) return;
    this.setData({ submitting: true, errorText: "" });
    try {
      await confirmAssessmentSource(
        this.data.assessmentId,
        this.data.selectedOptionId,
        this.data.configVersion,
      );
      this.goResult();
    } catch (error) {
      if (error && error.code === "ASSESSMENT_SOURCE_CONFIG_STALE") {
        wx.showToast({ title: "渠道选项已更新，请重新选择", icon: "none" });
        await this.load();
        return;
      }
      this.setData({ errorText: error.message || "确认失败，请重试" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goResult() {
    if (this._leaving) return;
    this._leaving = true;
    wx.redirectTo({
      url: resultPath(this.data.assessmentId),
      fail: () => wx.switchTab({ url: "/pages/health/index" }),
    });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
