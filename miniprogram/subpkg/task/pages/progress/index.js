const { request } = require("../../../../utils/request");
const { enrichProgress } = require("../../../../utils/task-presenter");
const {
  preloadCheckinReminderTemplate,
  requestCheckinReminderSubscribe,
} = require("../../../../utils/checkin-reminder-subscribe");

Page({
  data: {
    campaignId: "",
    loading: true,
    campaign: null,
    progress: { tasks: [], summary: { progressPercent: 0 } },
    tasks: [],
    errorText: "",
    checkinSaved: false,
    reminderReady: false,
    reminderLoading: true,
    reminderRequesting: false,
    reminderAccepted: false,
    reminderStatusText: "正在准备提醒...",
    reminderStatusTone: "muted",
    reminderButtonText: "开启明日提醒",
  },

  onLoad(options = {}) {
    this.setData({
      campaignId: options.campaignId || options.campaign_id || "",
      checkinSaved: options.fromCheckin === "1",
    });
    this.load();
    this.prepareReminder();
  },

  async prepareReminder(options = {}) {
    this.setData({ reminderLoading: true });
    const result = await preloadCheckinReminderTemplate(options);
    this.setData({
      reminderReady: result.ready,
      reminderLoading: false,
      reminderStatusText: result.ready
        ? "微信会在你允许后，于明日发送一次打卡提醒。"
        : result.message,
      reminderStatusTone: result.ready ? "muted" : result.tone,
      reminderButtonText: result.ready ? "开启明日提醒" : result.buttonText,
    });
  },

  async enableReminder() {
    if (this.data.reminderRequesting || this.data.reminderAccepted) return;
    if (!this.data.reminderReady) {
      await this.prepareReminder({ force: true });
      return;
    }

    const subscribePromise = requestCheckinReminderSubscribe({
      trigger: this.data.checkinSaved ? "CHECKIN_SUBMIT" : "CAMPAIGN_JOIN",
      campaignId: this.data.campaignId,
    });
    this.setData({ reminderRequesting: true });
    const result = await subscribePromise;
    this.setData({
      reminderRequesting: false,
      reminderAccepted: result.result === "accept",
      reminderStatusText: result.message,
      reminderStatusTone: result.tone,
      reminderButtonText: result.buttonText,
      reminderReady: !result.skipped,
    });
  },

  async load() {
    this.setData({ loading: true, errorText: "" });
    try {
      const suffix = this.data.campaignId ? `?campaignId=${this.data.campaignId}` : "";
      const data = await request({ url: `/api/v1/tasks/progress${suffix}` });
      const progress = enrichProgress(data.progress || {});
      this.setData({
        campaign: data.campaign || null,
        progress,
        tasks: progress.tasks || [],
      });
    } catch (error) {
      this.setData({ errorText: error.message || "进度加载失败" });
      wx.showToast({ title: error.message || "进度加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
