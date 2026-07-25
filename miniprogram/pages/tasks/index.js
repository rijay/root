const { request } = require("../../utils/request");
const { joinCampaign } = require("../../utils/campaign-join");
const {
  preloadCheckinReminderTemplate,
  requestCheckinReminderSubscribe,
} = require("../../utils/checkin-reminder-subscribe");
const router = require("../../utils/router");
const { enrichProgress, todayChina } = require("../../utils/task-presenter");

function questionnaireTypeOf(task) {
  const config = task.config || {};
  return config.questionnaireType || config.questionnaire_type || "DAY4_MIDPOINT";
}

Page({
  data: {
    loading: true,
    joining: false,
    actionTaskId: "",
    campaign: null,
    progress: { tasks: [], summary: { progressPercent: 0 } },
    tasks: [],
    primaryTask: null,
    errorText: "",
    reminderReady: false,
    reminderLoading: true,
    reminderRequesting: false,
    reminderAccepted: false,
    reminderStatusText: "正在准备提醒...",
    reminderStatusTone: "muted",
    reminderButtonText: "开启明日提醒",
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/tasks/index");
    if (allowed) {
      this.load();
      this.prepareReminder();
    }
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

    const campaignId = this.data.campaign ? this.data.campaign.campaignId : "";
    const subscribePromise = requestCheckinReminderSubscribe({
      trigger: "CAMPAIGN_JOIN",
      campaignId,
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
      const [campaignData, progressData] = await Promise.all([
        request({ url: "/api/v1/campaigns/active" }),
        request({ url: "/api/v1/tasks/progress" }),
      ]);
      const progress = enrichProgress(progressData.progress || {});
      const tasks = progress.tasks || [];
      this.setData({
        campaign: progressData.campaign || campaignData.campaign,
        progress,
        tasks,
        primaryTask: tasks.find((task) => task.required && task.status !== "DONE") || tasks.find((task) => task.status !== "DONE") || null,
      });
    } catch (error) {
      this.setData({ errorText: error.message || "任务加载失败" });
      wx.showToast({ title: error.message || "任务加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async ensureJoined() {
    if (this.data.campaign && this.data.campaign.participant) return true;
    this.setData({ joining: true });
    try {
      const data = await joinCampaign({
        campaignId: this.data.campaign ? this.data.campaign.campaignId : "",
      });
      this.setData({ campaign: data.campaign });
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || "加入失败", icon: "none" });
      return false;
    } finally {
      this.setData({ joining: false });
    }
  },

  async joinCampaign() {
    if (await this.ensureJoined()) {
      wx.showToast({ title: "已加入", icon: "success" });
      this.load();
    }
  },

  openProgress() {
    const campaignId = this.data.campaign ? this.data.campaign.campaignId : "";
    wx.navigateTo({ url: `/subpkg/task/pages/progress/index?campaignId=${campaignId}` });
  },

  async openTask(event) {
    const taskKey = event.currentTarget.dataset.taskKey || event.currentTarget.dataset.taskId;
    const task = this.data.tasks.find((item) => (item.taskKey || item.taskDefinitionId) === taskKey);
    if (!task) return;
    if (task.status === "CANCELED") {
      wx.showToast({ title: "来源活动已取消", icon: "none" });
      return;
    }
    if (task.status === "DONE") {
      wx.showToast({ title: "任务已完成", icon: "none" });
      return;
    }
    if (task.taskType !== "PURCHASE" && !(await this.ensureJoined())) return;
    if (task.taskType === "CHECKIN") {
      wx.navigateTo({ url: `/subpkg/task/pages/checkin/index?campaignId=${this.data.campaign.campaignId}&taskDefinitionId=${encodeURIComponent(task.taskDefinitionId || "")}&taskActivityAssignmentId=${encodeURIComponent(task.taskActivityAssignmentId || "")}&taskDefinitionVersion=${encodeURIComponent(task.taskDefinitionVersion || "")}` });
      return;
    }
    if (task.taskType === "QUESTIONNAIRE") {
      wx.navigateTo({
        url: `/subpkg/task/pages/questionnaire/index?campaignId=${this.data.campaign.campaignId}&questionnaireType=${questionnaireTypeOf(task)}&taskDefinitionId=${encodeURIComponent(task.taskDefinitionId || "")}&taskActivityAssignmentId=${encodeURIComponent(task.taskActivityAssignmentId || "")}&taskDefinitionVersion=${encodeURIComponent(task.taskDefinitionVersion || "")}`,
      });
      return;
    }
    if (task.taskType === "PURCHASE") {
      router.open("/pages/products/index?source=task_purchase");
      return;
    }
    if (task.taskType === "CONSULTATION") {
      await this.recordSimpleTask(task, "CONSULTATION");
      wx.navigateTo({ url: "/subpkg/profile/pages/support/index" });
      return;
    }
    if (task.taskType === "SHARE") {
      await this.recordSimpleTask(task, "SHARE");
      wx.showShareMenu({ withShareTicket: true });
      wx.showToast({ title: "已记录分享任务", icon: "success" });
    }
  },

  async recordSimpleTask(task, taskType) {
    const taskDate = todayChina();
    this.setData({ actionTaskId: task.taskKey || task.taskDefinitionId });
    try {
      await request({
        url: "/api/v1/tasks/events",
        method: "POST",
        data: {
          taskType,
          taskDate,
          payload: {
            taskDate,
            taskDefinitionId: task.taskDefinitionId,
            taskActivityAssignmentId: task.taskActivityAssignmentId || undefined,
            taskDefinitionVersion: task.taskDefinitionVersion || undefined,
          },
          idempotencyKey: `${taskType}:${task.taskDefinitionId}:${taskDate}`,
        },
      });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || "任务记录失败", icon: "none" });
    } finally {
      this.setData({ actionTaskId: "" });
    }
  },

  onShareAppMessage() {
    return {
      title: "一起完成 ROOT 身体记录",
      path: "/pages/home/index",
    };
  },
});
