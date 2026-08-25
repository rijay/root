const { syncTabBar } = require("../../utils/tab-bar");
const { cancelRequestScope, requestWithDeadline } = require("../../utils/request");
const { readPublicPageCache, writePublicPageCache } = require("../../utils/page-cache");
const { presentActivityList } = require("../../utils/activity-presenter");
const router = require("../../utils/router");
const { defaultOnShareAppMessage } = require("../../utils/page-share");

const CACHE_KEY = "activities";
const REQUEST_SCOPE = "formal-activity-list";
const CACHE_OPTIONS = Object.freeze({ freshForMs: 2 * 60 * 1000, maxStaleMs: 24 * 60 * 60 * 1000 });

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

  onLoad() {
    const cached = readPublicPageCache(CACHE_KEY, CACHE_OPTIONS);
    this._cacheFresh = Boolean(cached && cached.fresh);
    if (cached) this.applyActivities(cached.value);
  },

  onShow() {
    syncTabBar(this, 3);
    if (!this._loadPromise && (!this._cacheFresh || !this.data.activities.length)) {
      this.loadActivities({ background: this.data.activities.length > 0 });
    }
  },

  onHide() {
    this._loadSequence = (this._loadSequence || 0) + 1;
    cancelRequestScope(REQUEST_SCOPE);
    this._loadPromise = null;
  },

  onUnload() {
    this._loadSequence = (this._loadSequence || 0) + 1;
    cancelRequestScope(REQUEST_SCOPE);
  },

  applyActivities(payload) {
    const activities = presentActivityList(payload);
    const visibleActivities = decorateActivities(activities, this.data.filterKey);
    this.setData({
      activities,
      visibleActivities,
      state: activities.length ? "ready" : "empty",
      errorText: "",
    });
  },

  async loadActivities(options = {}) {
    if (this._loadPromise) return this._loadPromise;
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    if (!options.background && !this.data.activities.length) this.setData({ state: "loading", errorText: "" });
    const pending = requestWithDeadline({
      url: "/api/v1/activities?pageSize=20",
      method: "GET",
      scope: REQUEST_SCOPE,
    }, 4000);
    this._loadPromise = pending;
    try {
      const payload = await pending;
      if (sequence !== this._loadSequence) return;
      this._cacheFresh = true;
      writePublicPageCache(CACHE_KEY, payload);
      this.applyActivities(payload);
    } catch (_) {
      if (sequence !== this._loadSequence) return;
      if (this.data.activities.length) return;
      this.setData({
        state: "error",
        activities: [],
        visibleActivities: [],
        errorText: "活动暂时没有读到，请稍后再试。",
      });
    } finally {
      if (this._loadPromise === pending) this._loadPromise = null;
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

  onShareAppMessage: defaultOnShareAppMessage,
});
