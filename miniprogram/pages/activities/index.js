const { syncTabBar } = require("../../utils/tab-bar");
const { loadActivityFeed, readActivityFeedCache } = require("../../utils/activity-feed-cache");
const { presentActivityList } = require("../../utils/activity-presenter");
const { performanceMonitor } = require("../../utils/performance-monitor");
const { cachedImageUrl, prewarmSessionImage } = require("../../utils/session-image-cache");
const router = require("../../utils/router");
const { defaultOnShareAppMessage } = require("../../utils/page-share");

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
    displayHeroUrl: cachedImageUrl(item.heroAssetUrl),
    heroReady: Boolean(cachedImageUrl(item.heroAssetUrl)),
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
    this._activityImageStartedAt = new Map();
    this._activityImageRecorded = new Set();
    const cached = readActivityFeedCache();
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
    // 保留共享请求；再次切回 tab 时可以直接复用结果。
  },

  onUnload() {
    this._loadSequence = (this._loadSequence || 0) + 1;
  },

  applyActivities(payload) {
    const activities = presentActivityList(payload);
    const visibleActivities = decorateActivities(activities, this.data.filterKey);
    visibleActivities.forEach((item) => {
      if (item.heroReady && !this._activityImageRecorded.has(item.sessionId)) {
        this._activityImageStartedAt.set(item.sessionId, Date.now());
      }
    });
    this.setData({
      activities,
      visibleActivities,
      state: activities.length ? "ready" : "empty",
      errorText: "",
    });
    const first = activities[0];
    if (first && first.heroAssetUrl) {
      prewarmSessionImage(first.heroAssetUrl).then((displayHeroUrl) => {
        const current = this.data.activities[0];
        if (!current || current.sessionId !== first.sessionId || !displayHeroUrl) return;
        this.setData({ visibleActivities: decorateActivities(this.data.activities, this.data.filterKey) });
      });
    }
  },

  async loadActivities(options = {}) {
    if (this._loadPromise) return this._loadPromise;
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    if (!options.background && !this.data.activities.length) this.setData({ state: "loading", errorText: "" });
    const pending = loadActivityFeed({ force: options.force === true });
    this._loadPromise = pending;
    try {
      const payload = await pending;
      if (sequence !== this._loadSequence) return;
      this._cacheFresh = true;
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
    this.recordActivityImage(event, "LOAD_FAILED", "IMAGE_LOAD_FAILED");
    const sessionId = String(event.currentTarget.dataset.sessionId || "");
    const activities = this.data.activities.map((item) => (
      item.sessionId === sessionId ? { ...item, heroAssetUrl: "" } : item
    ));
    this.setData({
      activities,
      visibleActivities: decorateActivities(activities, this.data.filterKey),
    });
  },

  activityImageLoaded(event) {
    this.recordActivityImage(event, "LOAD_SUCCESS");
  },

  recordActivityImage(event, status, errorCode = "") {
    const sessionId = String(event.currentTarget.dataset.sessionId || "");
    if (!sessionId || this._activityImageRecorded.has(sessionId)) return;
    const startedAt = this._activityImageStartedAt.get(sessionId) || Date.now();
    this._activityImageRecorded.add(sessionId);
    this._activityImageStartedAt.delete(sessionId);
    performanceMonitor.recordImageResult({
      page: "activities",
      entry: "activity_hero",
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
    });
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
