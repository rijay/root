const { request } = require("../../utils/request");
const router = require("../../utils/router");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");

Page({
  data: {
    loading: true,
    jumpLoadingProductId: "",
    products: [],
    syncedAt: "",
    errorText: "",
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/products/index");
    if (allowed) this.loadProducts();
  },

  async loadProducts() {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: "/api/v1/products" });
      this.setData({
        products: data.products || [],
        syncedAt: data.syncedAt || "",
      });
    } catch (error) {
      this.setData({ errorText: error.message || "商品加载失败" });
      wx.showToast({ title: error.message || "商品加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(event) {
    const productId = event.currentTarget.dataset.productId;
    if (!productId) return;
    wx.navigateTo({ url: `/pages/product-detail/index?productId=${productId}` });
  },

  async buyProduct(event) {
    if (this.data.jumpLoadingProductId) return;
    const productId = event.currentTarget.dataset.productId;
    const product = this.data.products.find((item) => item.productId === productId);
    if (!product) return;
    this.setData({ jumpLoadingProductId: productId });
    try {
      const jumpResult = await request({
        url: "/api/v1/products/jump",
        method: "POST",
        data: { productId },
      });
      const target = mergeJumpTarget(product, jumpResult);
      await jumpToYouzanProduct(target);
    } catch (error) {
      wx.showToast({ title: error.message || "暂时无法跳转", icon: "none" });
    } finally {
      this.setData({ jumpLoadingProductId: "" });
    }
  },
});
