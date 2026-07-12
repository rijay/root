const { request } = require("../../../../utils/request");
const { enrichProgress } = require("../../../../utils/task-presenter");

Page({
  data: {
    campaignId: "",
    loading: true,
    campaign: null,
    progress: { tasks: [], summary: { progressPercent: 0 } },
    tasks: [],
    errorText: "",
  },

  onLoad(options = {}) {
    this.setData({ campaignId: options.campaignId || options.campaign_id || "" });
    this.load();
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
