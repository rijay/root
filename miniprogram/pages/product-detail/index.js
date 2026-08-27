const { getProduct, initialProduct } = require("../../utils/product-api");
const { setPendingProductFocus } = require("../../utils/product-navigation");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");
const { failureReason, track } = require("../../utils/analytics");
const { showFriendShareMenu } = require("../../utils/page-share");
const { formatProductSyncedAt } = require("../../utils/product-display");

function decorateProduct(product) {
  if (!product) return null;
  return {
    ...product,
    productCode: product.title && product.title.includes("RT-PrB-")
      ? `RT-PrB-${product.title.split("RT-PrB-")[1].split(/\s/)[0]}`
      : "ROOT",
    syncedAtText: formatProductSyncedAt(product.syncedAt),
    visualTone: product.productId === "4875324599" ? "graphite" : "sprout",
  };
}

Page({
  data: {
    loading: true,
    jumpLoading: false,
    productId: "",
    product: null,
    errorText: "",
    sourcePage: "direct",
    catalogNotice: "",
  },

  onLoad(options = {}) {
    const productId = options.productId || options.product_id || "";
    const product = decorateProduct(initialProduct(productId));
    this.setData({
      loading: !product,
      productId,
      product,
      sourcePage: options.source || "direct",
    });
    this.loadProduct({ background: Boolean(product) });
  },

  onUnload() {
    setPendingProductFocus(this.data.productId, "product_detail_return");
  },

  onShow() {
    showFriendShareMenu();
  },

  async loadProduct(options = {}) {
    if (!this.data.productId) {
      this.setData({ loading: false, errorText: "商品不存在" });
      return;
    }
    try {
      const data = await getProduct(this.data.productId);
      const product = decorateProduct(data.product);
      this.setData({
        loading: false,
        product: product || this.data.product,
        errorText: product || this.data.product ? "" : "商品不存在",
        catalogNotice: data.degradedText || "",
      });
      if (product && !this._detailViewTracked) {
        this._detailViewTracked = true;
        track("product_detail_view", {
          productId: product.productId,
          skuId: "",
          sourcePage: this.data.sourcePage,
        });
      }
    } catch (error) {
      if (!options.background || !this.data.product) {
        this.setData({ loading: false, errorText: error.message || "商品不存在" });
      }
    }
  },

  openProducts() {
    wx.switchTab({ url: "/pages/products/index" });
  },

  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  async buyProduct() {
    if (this.data.jumpLoading || !this.data.product) return;
    const productId = this.data.product.productId;
    this.setData({ jumpLoading: true });
    track("member_center_handoff", { productId, result: "STARTED", failureReason: "", sourcePage: "product_detail" });
    try {
      await jumpToYouzanProduct(mergeJumpTarget(this.data.product));
      track("member_center_handoff", { productId, result: "SUCCESS", failureReason: "", sourcePage: "product_detail" });
    } catch (error) {
      track("member_center_handoff", {
        productId,
        result: "FAILED",
        failureReason: failureReason(error),
        sourcePage: "product_detail",
      });
      wx.showModal({
        title: "未能打开 Root 会员中心",
        content: error.message || "暂时无法跳转",
        confirmText: "重试",
        cancelText: "留在此页",
        success: (result) => {
          if (result.confirm) this.buyProduct();
        },
      });
    } finally {
      this.setData({ jumpLoading: false });
    }
  },

  onShareAppMessage() {
    const product = this.data.product || {};
    return {
      title: product.subtitle ? `${product.subtitle}｜${product.title}` : (product.title || "ROOT 产品"),
      path: `/pages/product-detail/index?productId=${this.data.productId}`,
    };
  },
});
