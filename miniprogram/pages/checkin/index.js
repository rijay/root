const { request } = require("../../utils/request");
const router = require("../../utils/router");

function buildProgress(session) {
  if (!session) return [];
  return session.records.map((record) => ({
    ...record,
    status: record.checkedIn ? "done" : record.dayIndex === session.currentDayIndex ? "today" : "pending",
    statusText: record.checkedIn ? "已完成" : record.dayIndex === session.currentDayIndex ? "今日" : "未到",
  }));
}

Page({
  data: {
    user: null,
    session: {
      currentDayIndex: 1,
      todayChecked: false,
      missCount: 0,
      records: [],
    },
    progress: [],
    remainingDays: 6,
    loading: false,
    banner: "",
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/home/index");
    if (allowed) this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await request({ url: "/api/v1/checkin/session" });
      const bannerMap = {
        1: "欢迎开始Day1。今天只记录真实感受，不追求立刻变化。",
        4: "你已经完成一半啦，再坚持3天就能获得免单资格。",
        6: "Day6提醒：完成今日记录后，离免单只差一步。",
        7: "最后一天，今日打卡后即可进入免单申请。",
      };
      this.setData({
        user: data.user,
        session: data.session,
        progress: buildProgress(data.session),
        remainingDays: Math.max(0, 7 - data.session.currentDayIndex),
        banner: bannerMap[data.session.currentDayIndex] || "",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  goToday() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/today/index" });
  },

  goHistory() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/history/index" });
  },
});
