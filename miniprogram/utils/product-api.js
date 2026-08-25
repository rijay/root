const { request } = require("./request");
const { getLocalProduct, listLocalProducts } = require("./local-product-catalog");

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

async function listProducts() {
  try {
    const data = await request({ url: "/api/v1/products" });
    return {
      ...data,
      products: (data.products || []).map((item) => mergeProduct(item, getLocalProduct(item.productId) || {})),
      source: "SERVER_SNAPSHOT",
      degraded: false,
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
    return {
      product: mergeProduct(data.product || {}, getLocalProduct(productId) || {}),
      source: "SERVER_SNAPSHOT",
      degraded: false,
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

module.exports = { getProduct, listProducts, mergeProduct };
