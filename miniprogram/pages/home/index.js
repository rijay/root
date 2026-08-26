const { syncTabBar } = require("../../utils/tab-bar");
const { cancelRequestScope, requestWithDeadline } = require("../../utils/request");
const { readPublicPageCache, writePublicPageCache } = require("../../utils/page-cache");
const { presentHome } = require("../../utils/content-presenter");
const { executeContentAction } = require("../../utils/content-action");
const { defaultOnShareAppMessage } = require("../../utils/page-share");
const { track } = require("../../utils/analytics");
const { performanceMonitor } = require("../../utils/performance-monitor");

const CACHE_KEY = "home";
const REQUEST_SCOPE = "formal-home-content";
const CACHE_OPTIONS = Object.freeze({ freshForMs: 2 * 60 * 1000, maxStaleMs: 24 * 60 * 60 * 1000 });

Page({
  data: { state: "loading", items: [], current: 0, failedImages: {} },

  onLoad() {
    this._pageStartedAt = Date.now();
    const cached = readPublicPageCache(CACHE_KEY, CACHE_OPTIONS);
    if (cached) this.applyContent(cached.value);
    this.loadContent({ background: Boolean(cached) });
  },

  onShow() {
    syncTabBar(this, 0);
    if (this._shownOnce && !this._loadPromise) {
      this.loadContent({ background: this.data.items.length > 0 });
    }
    this._shownOnce = true;
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

  applyContent(payload) {
    const items = presentHome(payload);
    const selected = this.data.items[Number(this.data.current || 0)];
    const selectedIndex = selected
      ? items.findIndex((item) => item.contentId === selected.contentId)
      : -1;
    const current = selectedIndex >= 0
      ? selectedIndex
      : Math.min(Number(this.data.current || 0), Math.max(0, items.length - 1));
    this.setData({ state: items.length ? "ready" : "empty", items, current }, () => {
      this.recordUsableContent(items.length ? "CONTENT_READY" : "EMPTY_READY");
    });
    this.trackImpression(items[current], current);
  },

  recordUsableContent(status) {
    if (this._usableContentRecorded) return;
    this._usableContentRecorded = true;
    performanceMonitor.recordPageMetric({
      page: "pages/home/index",
      entry: "usable_content",
      durationMs: Date.now() - this._pageStartedAt,
      status,
    });
  },

  async loadContent(options = {}) {
    if (this._loadPromise) return this._loadPromise;
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    if (!options.background && !this.data.items.length) this.setData({ state: "loading" });
    const pending = requestWithDeadline({
      url: "/api/v1/public/content/home",
      method: "GET",
      scope: REQUEST_SCOPE,
    }, 4000);
    this._loadPromise = pending;
    try {
      const data = await pending;
      if (sequence !== this._loadSequence) return;
      writePublicPageCache(CACHE_KEY, data);
      this.applyContent(data);
    } catch (error) {
      if (sequence !== this._loadSequence || this.data.items.length) return;
      this.applyContent({ items: [] });
    } finally {
      if (this._loadPromise === pending) this._loadPromise = null;
    }
  },

  changeSlide(event) {
    const current = Number(event.detail.current || 0);
    this.setData({ current });
    this.trackImpression(this.data.items[current], current);
  },

  trackImpression(item, index) {
    if (!item || !item.contentId) return;
    const key = `${item.contentId}:${index}`;
    if (this._lastImpressionKey === key) return;
    this._lastImpressionKey = key;
    track("home_banner_impression", {
      contentId: item.contentId,
      bannerPosition: index + 1,
      sourcePage: "home",
    });
  },

  imageFailed(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`failedImages.${index}`]: true });
    performanceMonitor.recordImageResult({
      page: "pages/home/index",
      entry: "home_banner",
      status: "LOAD_FAILED",
      errorCode: "IMAGE_LOAD_FAILED",
    });
  },

  imageLoaded() {
    performanceMonitor.recordImageResult({
      page: "pages/home/index",
      entry: "home_banner",
      status: "LOAD_SUCCESS",
    });
  },

  async openCurrent(event) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)];
    if (item && item.contentId && item.action) {
      track("home_banner_click", {
        contentId: item.contentId,
        bannerPosition: Number(event.currentTarget.dataset.index) + 1,
        sourcePage: "home",
      });
      await executeContentAction(item.action);
    }
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
