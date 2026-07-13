const { request } = require("../../../../utils/request");
const { ensureHealthConsent } = require("../../../../utils/health-consent");
const { todayChina } = require("../../../../utils/task-presenter");

Page({
  data: {
    campaignId: "",
    taskDate: "",
    tookProduct: null,
    hadStool: null,
    stoolType: "",
    feedback: "",
    submitting: false,
    stoolOptions: [
      { value: "type1", label: "偏干硬" },
      { value: "type2", label: "成形但偏硬" },
      { value: "type3", label: "成形有裂纹" },
      { value: "type4", label: "光滑柔软" },
      { value: "type5", label: "柔软块状" },
      { value: "type6", label: "糊状偏散" },
      { value: "type7", label: "水样" },
    ],
  },

  onLoad(options = {}) {
    this.setData({
      campaignId: options.campaignId || options.campaign_id || "",
      taskDate: todayChina(),
    });
  },

  async onShow() {
    await ensureHealthConsent();
  },

  selectBoolean(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value === "true";
    this.setData({ [field]: value });
  },

  selectStool(event) {
    this.setData({ stoolType: event.currentTarget.dataset.value });
  },

  onFeedbackInput(event) {
    this.setData({ feedback: event.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!(await ensureHealthConsent())) return;
    if (this.data.tookProduct === null || this.data.hadStool === null) {
      wx.showToast({ title: "请先完成选择", icon: "none" });
      return;
    }
    if (this.data.hadStool && !this.data.stoolType) {
      wx.showToast({ title: "请选择排便状态", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      await request({
        url: "/api/v1/tasks/events",
        method: "POST",
        data: {
          campaignId: this.data.campaignId,
          taskType: "CHECKIN",
          taskDate: this.data.taskDate,
          payload: {
            taskDate: this.data.taskDate,
            tookProduct: this.data.tookProduct,
            hadStool: this.data.hadStool,
            stoolType: this.data.hadStool ? this.data.stoolType : "",
            feedback: this.data.feedback,
          },
          idempotencyKey: `task-checkin:${this.data.campaignId || "default"}:${this.data.taskDate}`,
        },
      });
      wx.redirectTo({
        url: `/subpkg/task/pages/progress/index?campaignId=${this.data.campaignId}&fromCheckin=1`,
      });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
