const { syncTabBar } = require("../../utils/tab-bar");
const { cancelRequestScope, requestWithDeadline } = require("../../utils/request");
const { readPublicPageCache, writePublicPageCache } = require("../../utils/page-cache");
const router = require("../../utils/router");
const { presentHome } = require("../../utils/content-presenter");
const { getToken } = require("../../utils/request");
const { openProducts } = require("../../utils/product-navigation");
const { track } = require("../../utils/analytics");

const CACHE_KEY = "home";
const REQUEST_SCOPE = "formal-home-content";
const CACHE_OPTIONS = Object.freeze({ freshForMs: 2 * 60 * 1000, maxStaleMs: 24 * 60 * 60 * 1000 });

Page({
  data: { state: "loading", items: [], current: 0 },

  onLoad() {
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
    this.setData({ state: items.length ? "ready" : "empty", items, current: 0 });
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
      this.setData({ state: "error", items: [] });
    } finally {
      if (this._loadPromise === pending) this._loadPromise = null;
    }
  },

  changeSlide(event) {
    this.setData({ current: Number(event.detail.current || 0) });
  },

  openCurrent(event) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)];
    if (item && item.contentId) router.open(item.detailPath);
  },

  openFeaturedProduct() {
    const productId = "4749049439";
    track("home_product_banner_click", {
      productId,
      bannerPosition: "HOME_PRIMARY",
      loggedIn: Boolean(getToken()),
    });
    openProducts(productId, "home_product_banner");
  },
});
