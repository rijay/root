const { syncTabBar } = require("../../utils/tab-bar");
const { request } = require("../../utils/request");
const { presentActivityList } = require("../../utils/activity-presenter");
const router = require("../../utils/router");

const FILTERS = Object.freeze([
  { key: "all", label: "全部" },
  { key: "available", label: "可报名" },
  { key: "mine", label: "我的报名" },
]);

function filterActivities(activities, filterKey) {
  if (filterKey === "available") {
    return activities.filter((item) => item.listingState === "AVAILABLE");
  }
  return activities;
}

function decorateActivities(activities, filterKey) {
  return filterActivities(activities, filterKey).map((item, index) => ({
    ...item,
    featured: index === 0,
    heroReady: Boolean(item.heroAssetUrl),
    enrollmentLabel: item.enrollment ? item.enrollment.label : "",
  }));
}

Page({
  data: {
    state: "loading",
    filters: FILTERS,
    filterKey: "all",
    activities: [],
    visibleActivities: [],
    errorText: "",
  },

  onShow() {
    syncTabBar(this, 2);
    this.loadActivities();
  },

  onUnload() {
    this._loadSequence = (this._loadSequence || 0) + 1;
  },

  async loadActivities() {
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    this.setData({ state: "loading", errorText: "" });
    try {
      const payload = await request({
        url: "/api/v1/activities?pageSize=20",
        method: "GET",
        scope: "formal-activity-list",
      });
      if (sequence !== this._loadSequence) return;
      const activities = presentActivityList(payload);
      const visibleActivities = decorateActivities(activities, this.data.filterKey);
      this.setData({
        activities,
        visibleActivities,
        state: activities.length ? "ready" : "empty",
      });
    } catch (_) {
      if (sequence !== this._loadSequence) return;
      this.setData({
        state: "error",
        activities: [],
        visibleActivities: [],
        errorText: "活动暂时没有读到，请稍后再试。",
      });
    }
  },

  selectFilter(event) {
    const filterKey = String(event.currentTarget.dataset.key || "");
    if (filterKey === "mine") {
      router.routeGuard("/subpkg/activity/pages/enrollments/index").then((allowed) => {
        if (allowed) router.open("/subpkg/activity/pages/enrollments/index");
      });
      return;
    }
    if (!FILTERS.some((item) => item.key === filterKey)) return;
    this.setData({
      filterKey,
      visibleActivities: decorateActivities(this.data.activities, filterKey),
    });
  },

  openActivity(event) {
    const sessionId = String(event.currentTarget.dataset.sessionId || "");
    if (!sessionId) return;
    router.open(`/subpkg/activity/pages/detail/index?sessionId=${encodeURIComponent(sessionId)}`);
  },

  handleImageError(event) {
    const sessionId = String(event.currentTarget.dataset.sessionId || "");
    const activities = this.data.activities.map((item) => (
      item.sessionId === sessionId ? { ...item, heroAssetUrl: "" } : item
    ));
    this.setData({
      activities,
      visibleActivities: decorateActivities(activities, this.data.filterKey),
    });
  },
});
