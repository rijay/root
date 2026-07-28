const { getToken, request } = require("../../utils/request");
const { presentActivityList } = require("../../utils/activity-presenter");
const {
  ROUTE_INTENT_STORAGE_KEY,
  createMyEnrollmentsLoginRouteIntent,
} = require("../../utils/activity-actions");
const router = require("../../utils/router");

const PAGE_SIZE = 10;

function trimmed(value) {
  return String(value || "").trim();
}

function buildListUrl(filters, page) {
  const query = {
    city: trimmed(filters.city),
    date: trimmed(filters.date),
    activityType: trimmed(filters.activityType).toUpperCase(),
    page: String(page),
    pageSize: String(PAGE_SIZE),
  };
  const search = Object.keys(query)
    .filter((key) => query[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
    .join("&");
  return `/api/v1/activities?${search}`;
}

function paginationFrom(payload, requestedPage) {
  const pagination = payload && payload.pagination && typeof payload.pagination === "object"
    ? payload.pagination
    : {};
  const page = Number.isInteger(pagination.page) && pagination.page > 0
    ? pagination.page
    : requestedPage;
  return {
    page,
    total: Number.isInteger(pagination.total) && pagination.total >= 0 ? pagination.total : null,
    hasMore: pagination.hasNextPage === true,
  };
}

function withVisualState(activity) {
  return {
    ...activity,
    heroReady: Boolean(activity.heroAssetUrl),
  };
}

Page({
  data: {
    viewState: "loading",
    activities: [],
    errorText: "",
    filterPanelOpen: false,
    draftFilters: {
      city: "",
      date: "",
      activityType: "",
    },
    appliedFilters: {
      city: "",
      date: "",
      activityType: "",
    },
    activeFilterCount: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    total: null,
    hasMore: false,
    isLoadingMore: false,
    loadMoreError: "",
  },

  onShow() {
    this.loadActivities({ reset: true });
  },

  async loadActivities(options = {}) {
    const reset = options.reset !== false;
    if (!reset && (this.data.isLoadingMore || !this.data.hasMore)) return;

    const requestedPage = reset ? 1 : this.data.page + 1;
    const filters = this.data.appliedFilters;
    const loadSequence = (this._loadSequence || 0) + 1;
    this._loadSequence = loadSequence;

    if (reset) {
      this.setData({
        viewState: "loading",
        activities: [],
        errorText: "",
        page: 1,
        total: null,
        hasMore: false,
        isLoadingMore: false,
        loadMoreError: "",
      });
    } else {
      this.setData({ isLoadingMore: true, loadMoreError: "" });
    }

    try {
      const payload = await request({ url: buildListUrl(filters, requestedPage) });
      if (loadSequence !== this._loadSequence) return;
      const incoming = presentActivityList(payload).map(withVisualState);
      const current = reset ? [] : this.data.activities;
      const knownIds = new Set(current.map((item) => item.sessionId));
      const activities = current.concat(incoming.filter((item) => !knownIds.has(item.sessionId)));
      const pagination = paginationFrom(payload, requestedPage);
      this.setData({
        activities,
        viewState: activities.length ? "ready" : "empty",
        page: pagination.page,
        total: pagination.total,
        hasMore: pagination.hasMore,
        isLoadingMore: false,
        loadMoreError: "",
      });
    } catch (_) {
      if (loadSequence !== this._loadSequence) return;
      if (!reset) {
        this.setData({
          isLoadingMore: false,
          loadMoreError: "更多活动暂未加载，请重试。",
        });
        return;
      }
      this.setData({
        viewState: "error",
        errorText: "活动数据暂未完成读取。请稍后重试，或联系人工协助。",
        isLoadingMore: false,
      });
    }
  },

  loadMore() {
    return this.loadActivities({ reset: false });
  },

  toggleFilters() {
    const nextOpen = !this.data.filterPanelOpen;
    this.setData({
      filterPanelOpen: nextOpen,
      draftFilters: nextOpen ? { ...this.data.appliedFilters } : this.data.draftFilters,
    });
  },

  updateCity(event) {
    this.setData({ "draftFilters.city": event.detail.value });
  },

  updateActivityType(event) {
    this.setData({ "draftFilters.activityType": event.detail.value });
  },

  updateDate(event) {
    this.setData({ "draftFilters.date": event.detail.value });
  },

  clearDate() {
    this.setData({ "draftFilters.date": "" });
  },

  applyFilters() {
    const appliedFilters = {
      city: trimmed(this.data.draftFilters.city),
      date: trimmed(this.data.draftFilters.date),
      activityType: trimmed(this.data.draftFilters.activityType).toUpperCase(),
    };
    const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;
    this.setData({
      appliedFilters,
      draftFilters: { ...appliedFilters },
      activeFilterCount,
      filterPanelOpen: false,
    }, () => this.loadActivities({ reset: true }));
  },

  clearFilters() {
    const emptyFilters = { city: "", date: "", activityType: "" };
    this.setData({
      appliedFilters: emptyFilters,
      draftFilters: { ...emptyFilters },
      activeFilterCount: 0,
      filterPanelOpen: false,
    }, () => this.loadActivities({ reset: true }));
  },

  handleHeroError(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    const index = this.data.activities.findIndex((item) => item.sessionId === sessionId);
    if (index < 0) return;
    this.setData({ [`activities[${index}].heroReady`]: false });
  },

  openDetail(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    router.open(`/subpkg/activity/pages/detail/index?sessionId=${encodeURIComponent(sessionId)}&source=activity_list`);
  },

  openMyEnrollments() {
    if (!getToken()) {
      try {
        wx.setStorageSync(
          ROUTE_INTENT_STORAGE_KEY,
          createMyEnrollmentsLoginRouteIntent(Date.now()),
        );
      } catch (_) {
        // Login remains available; recovery falls back to the server-selected route.
      }
      router.go("/pages/login/index?source=my_enrollments");
      return;
    }
    router.open("/subpkg/activity/pages/enrollments/index?source=activity_list");
  },

  openTasks() {
    router.go("/pages/tasks/index");
  },

  openSupport() {
    router.open("/subpkg/profile/pages/support/index?topic=activity&source=activity_list");
  },
});
