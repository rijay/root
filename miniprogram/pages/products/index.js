const { syncTabBar } = require("../../utils/tab-bar");
const {
  activeProductIdForScroll,
  consumePendingProductFocus,
  readProductViewState,
  resolveProductFocus,
  saveProductViewState,
  scrollLeftForProduct,
  setPendingProductFocus,
} = require("../../utils/product-navigation");
const { initialProductCatalog, listProducts } = require("../../utils/product-api");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");
const { failureReason, track } = require("../../utils/analytics");
const { showFriendShareMenu } = require("../../utils/page-share");
const { performanceMonitor } = require("../../utils/performance-monitor");

function decorateProducts(products = []) {
  return products.map((product, index) => ({
    ...product,
    visualTone: index % 2 === 0 ? "sprout" : "graphite",
    productCode: product.title && product.title.includes("RT-PrB-")
      ? `RT-PrB-${product.title.split("RT-PrB-")[1].split(/\s/)[0]}`
      : "ROOT",
  }));
}

const firstCatalog = initialProductCatalog();
const firstProducts = decorateProducts(firstCatalog.products || []);

Page({
  data: {
    loading: false,
    jumpLoadingProductId: "",
    products: firstProducts,
    errorText: "",
    scrollIntoView: "",
    activeProductId: firstProducts[0] && firstProducts[0].productId || "",
    carouselScrollLeft: 0,
    carouselVisible: true,
    focusNotice: "",
    failedProductImages: {},
  },

  onLoad(options = {}) {
    this._pageStartedAt = Date.now();
    this.viewState = readProductViewState();
    this.carouselScrollLeft = this.viewState.scrollLeft;
    this.pageScrollTop = this.viewState.scrollTop;
    this.impressedProductIds = new Set();
    if (options.productId || options.product_id) {
      setPendingProductFocus(options.productId || options.product_id, options.source || "direct");
    }
    if (this.data.products.length) this.recordUsableContent("LOCAL_FIRST_FRAME");
  },

  onShow() {
    showFriendShareMenu();
    syncTabBar(this, 1);
    const pending = consumePendingProductFocus();
    if (!this._catalogRefreshStarted) {
      this._catalogRefreshStarted = true;
      const firstFocusId = pending.productId || this.viewState.productId;
      if (this.data.products.length) {
        if (pending.source === "product_detail_return") this.restoreViewState(pending.productId);
        else if (pending.productId) this.focusProduct(pending.productId, { resetPageScroll: true });
        else this.restoreViewState();
      }
      this.loadProducts(firstFocusId, { background: this.data.products.length > 0 });
      return;
    }
    if (pending.source === "product_detail_return") {
      this.restoreViewState(pending.productId);
      return;
    }
    if (pending.productId) this.focusProduct(pending.productId, { resetPageScroll: true });
    else this.restoreViewState();
  },

  onHide() {
    this.persistViewState();
  },

  onUnload() {
    this.persistViewState();
  },

  onPageScroll(event = {}) {
    const scrollTop = Number(event.scrollTop);
    if (Number.isFinite(scrollTop) && scrollTop >= 0) this.pageScrollTop = scrollTop;
  },

  async onPullDownRefresh() {
    await this.loadProducts(this.data.activeProductId, { background: this.data.products.length > 0 });
    wx.stopPullDownRefresh();
  },

  async loadProducts(focusProductId = "", options = {}) {
    const background = options.background === true && this.data.products.length > 0;
    this.setData({ loading: !background, errorText: "" });
    try {
      const data = await listProducts();
      const products = decorateProducts(data.products || []);
      const savedProductId = this.viewState.productId;
      const focus = resolveProductFocus(products, focusProductId, savedProductId);
      const defaultProductId = focus.productId;
      this.setData({
        products,
        activeProductId: defaultProductId,
        carouselScrollLeft: this.carouselScrollLeft || 0,
        focusNotice: focus.requestedUnavailable
          ? "指定商品暂不可见，已为你展示当前可用产品。"
          : "",
        loading: false,
      }, () => {
        this.recordUsableContent(products.length ? "CONTENT_READY" : "EMPTY_READY");
        if (!focus.requestedUnavailable && focusProductId && focusProductId !== savedProductId) {
          this.focusProduct(defaultProductId, { resetPageScroll: true });
        }
        else this.restoreViewState(defaultProductId);
        this.recordProductImpression(defaultProductId);
        this.presentCatalogRefreshStatus(data.degradedText || "");
      });
    } catch (error) {
      this.setData(background
        ? { loading: false }
        : { errorText: error.message || "商品加载失败", loading: false }, () => {
        this.recordUsableContent("ERROR_READY");
        if (background) this.presentCatalogRefreshStatus("商品信息刷新失败");
      });
    }
  },

  presentCatalogRefreshStatus(message) {
    if (!message || typeof wx.showToast !== "function") return;
    wx.showToast({
      title: "商品更新失败，已显示本地信息",
      icon: "none",
      duration: 3000,
    });
  },

  recordUsableContent(status) {
    if (this._usableContentRecorded) return;
    this._usableContentRecorded = true;
    performanceMonitor.recordPageMetric({
      page: "pages/products/index",
      entry: "usable_content",
      durationMs: Date.now() - this._pageStartedAt,
      status,
    });
  },

  focusProduct(productId, options = {}) {
    if (!productId || !this.data.products.some((item) => item.productId === productId)) {
      this.setData({ focusNotice: "指定商品暂不可见，已为你展示当前可用产品。" });
      return false;
    }
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const targetScrollLeft = scrollLeftForProduct(this.data.products, productId, info.windowWidth);
    this.carouselScrollLeft = targetScrollLeft;
    if (options.resetPageScroll) this.pageScrollTop = 0;
    const applyFocus = () => this.setData({
      scrollIntoView: `product-${productId}`,
      activeProductId: productId,
      carouselScrollLeft: targetScrollLeft,
      carouselVisible: true,
      focusNotice: "",
    }, () => {
      if (options.resetPageScroll && typeof wx.pageScrollTo === "function") {
        wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      }
      this.recordProductImpression(productId);
    });
    if (options.resetPageScroll) {
      this.setData({ carouselVisible: false, scrollIntoView: "" }, applyFocus);
    } else {
      this.setData({ scrollIntoView: "" }, applyFocus);
    }
    return true;
  },

  restoreViewState(productId = "") {
    const activeProductId = productId || this.viewState.productId || this.data.activeProductId;
    const hasProduct = this.data.products.some((item) => item.productId === activeProductId);
    this.setData({
      activeProductId: hasProduct ? activeProductId : this.data.activeProductId,
      carouselScrollLeft: this.carouselScrollLeft || 0,
    });
    this.recordProductImpression(hasProduct ? activeProductId : this.data.activeProductId);
    if (this.pageScrollTop > 0 && typeof wx.pageScrollTo === "function") {
      setTimeout(() => wx.pageScrollTo({ scrollTop: this.pageScrollTop, duration: 0 }), 0);
    }
  },

  persistViewState() {
    this.viewState = saveProductViewState({
      productId: this.data.activeProductId,
      scrollLeft: this.carouselScrollLeft || 0,
      scrollTop: this.pageScrollTop || 0,
    });
  },

  recordProductImpression(productId) {
    if (!productId || this.impressedProductIds.has(productId)) return;
    this.impressedProductIds.add(productId);
    track("product_impression", { productId, skuId: "", sourcePage: "products" });
  },

  productImageFailed(event) {
    const productId = String(event.currentTarget.dataset.productId || "");
    if (productId) this.setData({ [`failedProductImages.${productId}`]: true });
    performanceMonitor.recordImageResult({
      page: "pages/products/index",
      entry: "product_image",
      status: "LOAD_FAILED",
      errorCode: "IMAGE_LOAD_FAILED",
    });
  },

  productImageLoaded() {
    performanceMonitor.recordImageResult({
      page: "pages/products/index",
      entry: "product_image",
      status: "LOAD_SUCCESS",
    });
  },

  openPhggReference() {
    wx.navigateTo({ url: "/subpkg/content/pages/phgg-reference/index?source=products" });
  },

  onProductScroll(event = {}) {
    const scrollLeft = Number(event.detail && event.detail.scrollLeft);
    if (!Number.isFinite(scrollLeft) || scrollLeft < 0) return;
    this.carouselScrollLeft = scrollLeft;
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const productId = activeProductIdForScroll(this.data.products, scrollLeft, info.windowWidth);
    if (productId && productId !== this.data.activeProductId) {
      this.setData({ activeProductId: productId });
      this.recordProductImpression(productId);
    }
  },

  selectProduct(event) {
    this.focusProduct(event.currentTarget.dataset.productId);
  },

  openDetail(event) {
    const productId = event.currentTarget.dataset.productId;
    if (!productId) return;
    this.persistViewState();
    setPendingProductFocus(productId, "product_detail_return");
    wx.navigateTo({ url: `/pages/product-detail/index?productId=${productId}&source=product_list` });
  },

  async buyProduct(event) {
    const productId = event.currentTarget.dataset.productId;
    this.startPurchase(productId);
  },

  async startPurchase(productId) {
    if (this.data.jumpLoadingProductId) return;
    const product = this.data.products.find((item) => item.productId === productId);
    if (!product) return;
    this.persistViewState();
    this.setData({ jumpLoadingProductId: productId });
    track("member_center_handoff", { productId, result: "STARTED", failureReason: "", sourcePage: "products" });
    try {
      await jumpToYouzanProduct(mergeJumpTarget(product));
      track("member_center_handoff", { productId, result: "SUCCESS", failureReason: "", sourcePage: "products" });
    } catch (error) {
      track("member_center_handoff", {
        productId,
        result: "FAILED",
        failureReason: failureReason(error),
        sourcePage: "products",
      });
      this.presentPurchaseFailure(productId, error.message || "暂时无法跳转");
    } finally {
      this.setData({ jumpLoadingProductId: "" });
    }
  },

  presentPurchaseFailure(productId, message) {
    wx.showModal({
      title: "未能打开 Root 会员中心",
      content: message,
      confirmText: "重试",
      cancelText: "留在此页",
      success: (result) => {
        if (result.confirm) this.startPurchase(productId);
      },
    });
  },

  onShareAppMessage() {
    return { title: "ROOT 益生元饮料｜找到适合你的日常补给", path: "/pages/products/index" };
  },
});
