const { getToken, request } = require("../../utils/request");
const router = require("../../utils/router");
const { setPendingProductFocus } = require("../../utils/product-navigation");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");
const { failureReason, track } = require("../../utils/analytics");

function decorateProduct(product) {
  if (!product) return null;
  return {
    ...product,
    productCode: product.title && product.title.includes("RT-PrB-")
      ? `RT-PrB-${product.title.split("RT-PrB-")[1].split(/\s/)[0]}`
      : "ROOT",
    visualTone: product.productId === "4875324599" ? "graphite" : "sprout",
  };
}

Page({
  data: {
    loading: true,
    jumpLoading: false,
    productId: "",
    sourcePage: "DIRECT",
    product: null,
    errorText: "",
  },

  onLoad(options = {}) {
    this.setData({
      productId: options.productId || options.product_id || "",
      sourcePage: options.source || "direct",
    });
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/product-detail/index");
    if (allowed && !this.data.product) await this.loadProduct();
  },

  onUnload() {
    setPendingProductFocus(this.data.productId, "product_detail_return");
  },

  async loadProduct() {
    if (!this.data.productId) {
      this.setData({ loading: false, errorText: "商品不存在" });
      return;
    }
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: `/api/v1/products/${this.data.productId}` });
      const product = decorateProduct(data.product);
      this.setData({ product });
      track("product_detail_view", {
        productId: product.productId,
        skuId: product.skuId || "",
        sourcePage: this.data.sourcePage === "product_list"
          ? "/pages/products/index"
          : this.data.sourcePage === "home_product_row"
            ? "/pages/home/index"
            : "/pages/product-detail/index",
      });
    } catch (error) {
      this.setData({ errorText: error.message || "商品加载失败" });
      wx.showToast({ title: error.message || "商品加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async buyProduct() {
    if (this.data.jumpLoading) return;
    const product = this.data.product;
    if (!product || !product.productId) return;
    this.setData({ jumpLoading: true });
    track("member_center_handoff", {
      productId: product.productId,
      result: "STARTED",
      failureReason: "",
      sourcePage: "/pages/product-detail/index",
    });
    try {
      if (!getToken()) {
        await jumpToYouzanProduct(mergeJumpTarget(product));
        track("member_center_handoff", {
          productId: product.productId,
          result: "SUCCESS",
          failureReason: "",
          sourcePage: "/pages/product-detail/index",
        });
        return;
      }
      const jumpResult = await request({
        url: "/api/v1/products/jump",
        method: "POST",
        data: { productId: product.productId, sourceChannel: "MINIPROGRAM_PRODUCT_DETAIL" },
      });
      await jumpToYouzanProduct(mergeJumpTarget(product, jumpResult));
      track("member_center_handoff", {
        productId: product.productId,
        result: "SUCCESS",
        failureReason: "",
        sourcePage: "/pages/product-detail/index",
      });
    } catch (error) {
      track("member_center_handoff", {
        productId: product.productId,
        result: "FAILED",
        failureReason: failureReason(error),
        sourcePage: "/pages/product-detail/index",
      });
      wx.showToast({ title: error.message || "暂时无法跳转", icon: "none" });
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

  onShareTimeline() {
    const product = this.data.product || {};
    return {
      title: product.subtitle || product.title || "ROOT 产品",
      query: `productId=${this.data.productId}`,
    };
  },
});
