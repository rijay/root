const PRODUCTS_ROUTE = "/pages/products/index";

function runtimeState() {
  if (typeof getApp !== "function") return null;
  try {
    const app = getApp();
    if (!app) return null;
    if (!app.globalData) app.globalData = {};
    return app.globalData;
  } catch (_) {
    return null;
  }
}

function setPendingProductFocus(productId = "", source = "") {
  const state = runtimeState();
  if (!state) return;
  state.pendingProductFocus = {
    productId: String(productId || "").trim(),
    source: String(source || "").trim(),
  };
}

function consumePendingProductFocus() {
  const state = runtimeState();
  if (!state || !state.pendingProductFocus) return { productId: "", source: "" };
  const pending = state.pendingProductFocus;
  delete state.pendingProductFocus;
  return pending;
}

function openProducts(productId = "", source = "") {
  setPendingProductFocus(productId, source);
  wx.switchTab({ url: PRODUCTS_ROUTE });
}

module.exports = {
  PRODUCTS_ROUTE,
  consumePendingProductFocus,
  openProducts,
  setPendingProductFocus,
};
