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
const { listLocalProducts } = require("../../utils/local-product-catalog");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");
const { failureReason, track } = require("../../utils/analytics");
const { showFriendShareMenu } = require("../../utils/page-share");

function decorateProducts(products = []) {
  return products.map((product, index) => ({
    ...product,
    visualTone: index % 2 === 0 ? "sprout" : "graphite",
    productCode: product.title && product.title.includes("RT-PrB-")
      ? `RT-PrB-${product.title.split("RT-PrB-")[1].split(/\s/)[0]}`
      : "ROOT",
  }));
}

Page({
  data: {
    loading: true,
    jumpLoadingProductId: "",
    products: [],
    errorText: "",
    scrollIntoView: "",
    activeProductId: "",
    carouselScrollLeft: 0,
    carouselVisible: true,
    focusNotice: "",
  },

  onLoad(options = {}) {
    this.viewState = readProductViewState();
    this.carouselScrollLeft = this.viewState.scrollLeft;
    this.pageScrollTop = this.viewState.scrollTop;
    this.impressedProductIds = new Set();
    if (options.productId || options.product_id) {
      setPendingProductFocus(options.productId || options.product_id, options.source || "direct");
    }
  },

  onShow() {
    showFriendShareMenu();
    syncTabBar(this, 1);
    const pending = consumePendingProductFocus();
    if (!this.data.products.length) {
      this.loadProducts(pending.productId || this.viewState.productId);
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

  onPullDownRefresh() {
    this.loadProducts(this.data.activeProductId);
    wx.stopPullDownRefresh();
  },

  loadProducts(focusProductId = "") {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = listLocalProducts();
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
        if (!focus.requestedUnavailable && focusProductId && focusProductId !== savedProductId) {
          this.focusProduct(defaultProductId, { resetPageScroll: true });
        }
        else this.restoreViewState(defaultProductId);
        this.recordProductImpression(defaultProductId);
      });
    } catch (error) {
      this.setData({ errorText: error.message || "商品加载失败", loading: false });
    }
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
