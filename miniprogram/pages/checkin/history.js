const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    session: null,
    records: [],
    selected: null,
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/history/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: "/api/v1/checkin/records" });
      const records = data.session.records.map((item) => {
        const detail = data.records.find((record) => record.day_index === item.dayIndex);
        return {
          ...item,
          detail,
          title: `Day ${item.dayIndex}`,
          statusText: item.checkedIn ? "已完成" : "未打卡",
        };
      });
      this.setData({ session: data.session, records });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  select(event) {
    const dayIndex = Number(event.currentTarget.dataset.day);
    const selected = this.data.records.find((item) => item.dayIndex === dayIndex);
    this.setData({ selected });
  },
});
