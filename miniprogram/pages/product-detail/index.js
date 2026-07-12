const { request } = require("../../utils/request");
const router = require("../../utils/router");
const { jumpToYouzanProduct, mergeJumpTarget } = require("../../utils/youzan-jump");

Page({
  data: {
    loading: true,
    jumpLoading: false,
    productId: "",
    product: null,
    errorText: "",
  },

  async onLoad(options = {}) {
    this.setData({ productId: options.productId || options.product_id || "" });
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/product-detail/index");
    if (allowed) this.loadProduct();
  },

  async loadProduct() {
    if (!this.data.productId) {
      this.setData({ loading: false, errorText: "商品不存在" });
      return;
    }
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: `/api/v1/products/${this.data.productId}` });
      this.setData({ product: data.product || null });
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
    try {
      const jumpResult = await request({
        url: "/api/v1/products/jump",
        method: "POST",
        data: { productId: product.productId },
      });
      const target = mergeJumpTarget(product, jumpResult);
      await jumpToYouzanProduct(target);
    } catch (error) {
      wx.showToast({ title: error.message || "暂时无法跳转", icon: "none" });
    } finally {
      this.setData({ jumpLoading: false });
    }
  },
});
