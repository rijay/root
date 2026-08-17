const { getToken, request } = require("../../utils/request");
const router = require("../../utils/router");
const {
  consumePendingProductFocus,
  setPendingProductFocus,
} = require("../../utils/product-navigation");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");
const { failureReason, track } = require("../../utils/analytics");
const { syncTabBar } = require("../../utils/tab-bar");

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
    syncedAt: "",
    errorText: "",
    scrollIntoView: "",
    activeProductId: "",
  },

  onLoad(options = {}) {
    if (options.productId || options.product_id) {
      setPendingProductFocus(options.productId || options.product_id, options.source || "direct");
    }
  },

  async onShow() {
    syncTabBar(this, 1);
    const allowed = await router.routeGuard("/pages/products/index");
    if (!allowed) return;
    const pending = consumePendingProductFocus();
    if (!this.data.products.length) {
      await this.loadProducts(pending.productId);
      return;
    }
    if (pending.productId && pending.productId !== this.data.activeProductId) {
      this.focusProduct(pending.productId);
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadProducts(this.data.activeProductId);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadProducts(focusProductId = "") {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: "/api/v1/products" });
      const products = decorateProducts(data.products || []);
      const defaultProductId = focusProductId || (products[0] && products[0].productId) || "";
      this.setData({
        products,
        syncedAt: data.syncedAt || "",
        activeProductId: defaultProductId,
      });
      this.focusProduct(defaultProductId);
    } catch (error) {
      this.setData({ errorText: error.message || "商品加载失败" });
      wx.showToast({ title: error.message || "商品加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  focusProduct(productId) {
    if (!productId || !this.data.products.some((item) => item.productId === productId)) return;
    this.setData({ scrollIntoView: "", activeProductId: productId }, () => {
      this.setData({ scrollIntoView: `product-${productId}` });
    });
    if (!this._impressedProductIds) this._impressedProductIds = new Set();
    if (!this._impressedProductIds.has(productId)) {
      this._impressedProductIds.add(productId);
      const product = this.data.products.find((item) => item.productId === productId) || {};
      track("product_impression", {
        productId,
        skuId: product.skuId || "",
        sourcePage: "/pages/products/index",
      });
    }
  },

  selectProduct(event) {
    const productId = event.currentTarget.dataset.productId;
    if (productId) this.focusProduct(productId);
  },

  openDetail(event) {
    const productId = event.currentTarget.dataset.productId;
    if (!productId) return;
    setPendingProductFocus(productId, "product_detail_return");
    wx.navigateTo({ url: `/pages/product-detail/index?productId=${productId}&source=product_list` });
  },

  async buyProduct(event) {
    if (this.data.jumpLoadingProductId) return;
    const productId = event.currentTarget.dataset.productId;
    const product = this.data.products.find((item) => item.productId === productId);
    if (!product) return;
    this.setData({ jumpLoadingProductId: productId });
    track("member_center_handoff", {
      productId,
      result: "STARTED",
      failureReason: "",
      sourcePage: "/pages/products/index",
    });
    try {
      if (!getToken()) {
        await jumpToYouzanProduct(mergeJumpTarget(product));
        track("member_center_handoff", {
          productId,
          result: "SUCCESS",
          failureReason: "",
          sourcePage: "/pages/products/index",
        });
        return;
      }
      const jumpResult = await request({
        url: "/api/v1/products/jump",
        method: "POST",
        data: { productId, sourceChannel: "MINIPROGRAM_PRODUCT_LIST" },
      });
      await jumpToYouzanProduct(mergeJumpTarget(product, jumpResult));
      track("member_center_handoff", {
        productId,
        result: "SUCCESS",
        failureReason: "",
        sourcePage: "/pages/products/index",
      });
    } catch (error) {
      track("member_center_handoff", {
        productId,
        result: "FAILED",
        failureReason: failureReason(error),
        sourcePage: "/pages/products/index",
      });
      wx.showToast({ title: error.message || "暂时无法跳转", icon: "none" });
    } finally {
      this.setData({ jumpLoadingProductId: "" });
    }
  },

  onShareAppMessage() {
    return {
      title: "ROOT 益生元饮料｜找到适合你的日常补给",
      path: "/pages/products/index",
    };
  },

  onShareTimeline() {
    return { title: "ROOT 益生元饮料｜找到适合你的日常补给" };
  },
});
