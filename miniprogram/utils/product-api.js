const { getToken, request } = require("./request");
const { getLocalProduct, listLocalProducts } = require("./local-product-catalog");

const LIVE_PRICE_DEGRADED_TEXT = "商品实时价格暂未同步，当前显示基础信息；最终价格、库存与优惠以 Root 会员中心为准。";

function mergeProduct(serverProduct = {}, localProduct = {}) {
  return {
    ...localProduct,
    ...serverProduct,
    imageUrl: serverProduct.imageUrl || localProduct.imageUrl || "",
    specText: serverProduct.specText || localProduct.specText || "具体规格以 Root 会员中心实时页面为准",
    youzan: {
      ...(localProduct.youzan || {}),
      ...(serverProduct.youzan || {}),
    },
  };
}

function initialProductCatalog() {
  const local = listLocalProducts();
  return {
    ...local,
    products: (local.products || []).map((item) => mergeProduct({}, item)),
    source: "LOCAL_BUNDLED",
    degraded: false,
    degradedText: "",
  };
}

function initialProduct(productId) {
  const local = getLocalProduct(productId);
  return local ? mergeProduct({}, local) : null;
}

async function listProducts() {
  try {
    const data = await request({ url: "/api/v1/products" });
    const live = data.priceSync && data.priceSync.status === "LIVE";
    return {
      ...data,
      products: (data.products || []).map((item) => mergeProduct(item, getLocalProduct(item.productId) || {})),
      source: live ? "YOUZAN_LIVE" : "SERVER_CATALOG",
      degraded: !live,
      degradedText: live ? "" : LIVE_PRICE_DEGRADED_TEXT,
    };
  } catch (error) {
    const fallback = listLocalProducts();
    return {
      ...fallback,
      degraded: true,
      degradedText: "商品信息刷新失败，当前显示本地基础信息；价格、库存与优惠以会员中心为准。",
    };
  }
}

async function getProduct(productId) {
  try {
    const data = await request({ url: `/api/v1/products/${productId}` });
    const live = data.priceSync && data.priceSync.status === "LIVE";
    return {
      product: mergeProduct(data.product || {}, getLocalProduct(productId) || {}),
      priceSync: data.priceSync || null,
      source: live ? "YOUZAN_LIVE" : "SERVER_CATALOG",
      degraded: !live,
      degradedText: live ? "" : LIVE_PRICE_DEGRADED_TEXT,
    };
  } catch (error) {
    const product = getLocalProduct(productId);
    return {
      product,
      source: "LOCAL_FALLBACK",
      degraded: Boolean(product),
      degradedText: product ? "商品信息刷新失败，价格、库存与优惠以会员中心为准。" : "",
    };
  }
}

async function prepareProductJump(product = {}, sourceChannel = "MINIPROGRAM_PRODUCT") {
  const fallback = {
    jumpTarget: product.youzan || {},
    targetSource: "CATALOG",
    recorded: false,
  };
  if (!product.productId || !getToken()) return fallback;
  try {
    const data = await request({
      url: "/api/v1/products/jump",
      method: "POST",
      data: { productId: product.productId, sourceChannel },
      idempotencyKey: `product-jump:${product.productId}:${Date.now()}`,
    });
    return {
      ...data,
      targetSource: "SERVER",
      recorded: true,
    };
  } catch (error) {
    return {
      ...fallback,
      recordStatus: error && error.resultUnknown ? "UNKNOWN" : "FAILED",
    };
  }
}

module.exports = {
  getProduct,
  initialProduct,
  initialProductCatalog,
  listProducts,
  mergeProduct,
  prepareProductJump,
};
