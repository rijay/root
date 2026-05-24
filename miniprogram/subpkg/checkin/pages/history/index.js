const { request } = require("../../../../utils/request");
const { formatDateCn } = require("../../../../utils/date-display");
const { stoolLabel } = require("../../../../utils/option-labels");
const router = require("../../../../utils/router");

function yesNo(value) {
  return value ? "有" : "没有";
}

function detailRows(detail) {
  if (!detail) {
    return [{ label: "记录状态", value: "这一天还没有提交记录" }];
  }
  const rows = [
    { label: "服用 ROOT", value: yesNo(detail.took_product) },
    { label: "是否排便", value: yesNo(detail.had_stool) },
  ];
  if (detail.had_stool) rows.push({ label: "便型", value: stoolLabel(detail.stool_type) });
  rows.push({ label: "身体反馈", value: detail.feedback || "暂无文字反馈", long: true });
  return rows;
}

Page({
  data: {
    mode: "checkin",
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
      const state = await request({ url: "/api/v1/user/state" });
      if (state.user.state === "DAILY_USER") {
        const data = await request({ url: "/api/v1/daily/history?limit=60" });
        const records = data.records.map((item, index) => ({
          dayIndex: index + 1,
          date: item.checkin_date,
          dateText: formatDateCn(item.checkin_date),
          checkedIn: true,
          detail: item,
          detailRows: detailRows(item),
          marker: "日",
          title: "今日记录",
          statusText: `连续 ${item.streak_count} 天`,
          statusLabel: "已记录",
          summary: item.feedback || (item.had_stool ? stoolLabel(item.stool_type) : "仍可记录身体感受"),
        }));
        this.setData({ mode: "daily", session: null, records });
        return;
      }
      const data = await request({ url: "/api/v1/checkin/records" });
      const records = data.session.records.map((item) => {
        const detail = data.records.find((record) => record.day_index === item.dayIndex);
        return {
          ...item,
          dateText: formatDateCn(item.date),
          detail,
          detailRows: detailRows(detail),
          marker: item.checkedIn ? "✓" : item.dayIndex,
          title: `第 ${item.dayIndex} 天`,
          statusText: item.checkedIn ? "已完成" : "未打卡",
          statusLabel: item.checkedIn ? "已记录" : "待记录",
          summary: detail ? (detail.feedback || stoolLabel(detail.stool_type)) : "等待真实记录",
        };
      });
      this.setData({ mode: "checkin", session: data.session, records });
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
