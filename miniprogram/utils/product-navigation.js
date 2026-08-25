const PRODUCTS_ROUTE = "/pages/products/index";
const PRODUCT_VIEW_STATE_KEY = "myroot_product_view_state_v1";

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

function normalizeViewState(value = {}) {
  const scrollLeft = Number(value.scrollLeft);
  const scrollTop = Number(value.scrollTop);
  return {
    productId: String(value.productId || "").trim(),
    scrollLeft: Number.isFinite(scrollLeft) && scrollLeft >= 0 ? scrollLeft : 0,
    scrollTop: Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0,
  };
}

function readProductViewState() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return normalizeViewState();
  }
  try {
    return normalizeViewState(wx.getStorageSync(PRODUCT_VIEW_STATE_KEY) || {});
  } catch (_) {
    return normalizeViewState();
  }
}

function saveProductViewState(value = {}) {
  const state = normalizeViewState(value);
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(PRODUCT_VIEW_STATE_KEY, state);
    } catch (_) {
      // 浏览状态写入失败不应阻断商品浏览或购买。
    }
  }
  return state;
}

function productScrollStep(viewportWidth = 375) {
  const width = Number(viewportWidth);
  return (632 / 750) * (Number.isFinite(width) && width > 0 ? width : 375);
}

function activeProductIdForScroll(products = [], scrollLeft = 0, viewportWidth = 375) {
  if (!products.length) return "";
  const step = productScrollStep(viewportWidth);
  const index = Math.max(0, Math.min(products.length - 1, Math.round(Number(scrollLeft || 0) / step)));
  return String((products[index] && products[index].productId) || "");
}

function scrollLeftForProduct(products = [], productId = "", viewportWidth = 375) {
  const target = String(productId || "").trim();
  const index = products.findIndex((item) => String((item && item.productId) || "").trim() === target);
  return index > 0 ? index * productScrollStep(viewportWidth) : 0;
}

function resolveProductFocus(products = [], requestedProductId = "", savedProductId = "") {
  const ids = new Set(products.map((item) => String((item && item.productId) || "").trim()).filter(Boolean));
  const requested = String(requestedProductId || "").trim();
  const saved = String(savedProductId || "").trim();
  const hasRequested = requested !== "" && ids.has(requested);
  const hasSaved = saved !== "" && ids.has(saved);
  return {
    productId: hasRequested ? requested : (hasSaved ? saved : String((products[0] && products[0].productId) || "")),
    requestedUnavailable: requested !== "" && !hasRequested,
  };
}

module.exports = {
  PRODUCT_VIEW_STATE_KEY,
  PRODUCTS_ROUTE,
  activeProductIdForScroll,
  consumePendingProductFocus,
  openProducts,
  readProductViewState,
  resolveProductFocus,
  saveProductViewState,
  scrollLeftForProduct,
  setPendingProductFocus,
};
