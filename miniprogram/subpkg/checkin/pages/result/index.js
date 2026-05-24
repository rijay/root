const { formatDateCn } = require("../../../../utils/date-display");
const { getResultPageCopy } = require("../../../../utils/checkin-presenter");
const { request } = require("../../../../utils/request");
const { buildSharePosterPayload } = require("../../../../utils/share-poster");
const { stoolLabel } = require("../../../../utils/option-labels");
const router = require("../../../../utils/router");

function yesNo(value) {
  return value ? "有" : "没有";
}

function tookText(value) {
  return value ? "已服用" : "未服用";
}

function read(record, snakeKey, camelKey) {
  if (!record) return "";
  if (record[snakeKey] !== undefined) return record[snakeKey];
  return record[camelKey];
}

function recordRows(record) {
  if (!record) return [];
  const hadStool = Boolean(read(record, "had_stool", "hadStool"));
  const rows = [
    { label: "服用 ROOT", value: tookText(read(record, "took_product", "tookProduct")) },
    { label: "昨日排便", value: yesNo(hadStool) },
  ];
  if (hadStool) rows.push({ label: "便型", value: stoolLabel(read(record, "stool_type", "stoolType")) });
  rows.push({ label: "感受", value: record.feedback || "今天也完成了一次真实记录。", long: true });
  return rows;
}

function statsItems(mode, stats, completedDays) {
  if (mode === "daily") {
    return [
      { label: "累计记录", value: `${stats.totalDays || 0} 天` },
      { label: "当前连续", value: `${stats.currentStreak || 0} 天` },
    ];
  }
  return [
    { label: "已完成", value: `${completedDays || 0}/7 天` },
    { label: "当前阶段", value: "试饮记录" },
  ];
}

Page({
  data: {
    mode: "checkin",
    resultCopy: getResultPageCopy("checkin", {}),
    record: null,
    recordDate: "",
    summaryRows: [],
    stats: {},
    statsItems: [],
    completedDays: 0,
    failed: false,
    loading: false,
  },

  onLoad(options = {}) {
    this.setData({ mode: options.mode || "checkin" });
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/result/index");
    if (allowed) this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const state = await request({ url: "/api/v1/user/state" });
      if (state.user.state === "DAILY_USER" || this.data.mode === "daily") {
        await this.loadDailyResult();
      } else {
        await this.loadCheckinResult(state.user.state === "CHECKIN_FAILED");
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadDailyResult() {
    const cached = wx.getStorageSync("ROOT_LAST_RESULT") || {};
    const [stats, history] = await Promise.all([
      request({ url: "/api/v1/daily/stats" }),
      request({ url: "/api/v1/daily/history?limit=1" }),
    ]);
    const record = cached.mode === "daily" && cached.record ? cached.record : (history.records && history.records[0]) || null;
    const resultCopy = getResultPageCopy("daily", {});
    this.setData({
      mode: "daily",
      resultCopy,
      record,
      recordDate: record ? formatDateCn(read(record, "checkin_date", "checkinDate")) : "",
      summaryRows: recordRows(record),
      stats,
      statsItems: statsItems("daily", stats, 0),
      completedDays: 0,
      failed: false,
    });
  },

  async loadCheckinResult(failed) {
    const cached = wx.getStorageSync("ROOT_LAST_RESULT") || {};
    const [sessionData, recordsData] = await Promise.all([
      request({ url: "/api/v1/checkin/session" }),
      request({ url: "/api/v1/checkin/records" }).catch(() => ({ records: [] })),
    ]);
    const records = recordsData.records || [];
    const latest = cached.mode === "checkin" && cached.record
      ? cached.record
      : records.slice().sort((left, right) => Number(right.day_index) - Number(left.day_index))[0] || null;
    const completedDays = sessionData.session.records.filter((item) => item.checkedIn).length;
    const resultCopy = getResultPageCopy("checkin", { failed, completedDays });
    this.setData({
      mode: "checkin",
      resultCopy,
      record: latest,
      recordDate: latest ? formatDateCn(read(latest, "checkin_date", "checkinDate")) : "",
      summaryRows: recordRows(latest),
      stats: {},
      statsItems: statsItems("checkin", {}, completedDays),
      completedDays,
      failed,
    });
  },

  goRefund() {
    wx.navigateTo({ url: "/subpkg/refund/pages/apply/index" });
  },

  goHistory() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/history/index" });
  },

  goSharePoster() {
    if (!this.data.record || this.data.failed) return;
    const payload = buildSharePosterPayload(this.data.record, {
      mode: this.data.mode,
      stats: this.data.stats,
      completedDays: this.data.completedDays,
    });
    wx.setStorageSync("ROOT_SHARE_POSTER_PAYLOAD", payload);
    wx.navigateTo({ url: "/subpkg/checkin/pages/share-poster/index" });
  },

  goHome() {
    router.go("/pages/home/index");
  },
});
