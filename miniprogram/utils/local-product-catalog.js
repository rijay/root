const PRODUCTS = Object.freeze([
  Object.freeze({
    productId: "4749049439",
    youzanProductId: "4749049439",
    title: "ROOT 低敏畅享·每日衡养益生元饮料 RT-PrB-01",
    subtitle: "温和清畅，敏肠之选",
    summary: "为日常饮用场景设计的温和型益生元饮料。",
    description: "商品信息来自 Root 会员中心快照。规格、价格、库存、优惠及适用说明以会员中心实时展示为准。",
    specText: "具体规格以 Root 会员中心实时页面为准",
    imageUrl: "/static/products/rt-prb-01.jpg",
    priceText: "会员中心实时价格",
    status: "ACTIVE",
    badge: "低敏畅享",
    skuCount: 0,
    skus: Object.freeze([]),
    syncedAt: "2026-08-25T21:28:24+08:00",
    updatedAt: "2026-08-25T21:28:24+08:00",
    youzan: Object.freeze({
      enabled: true,
      appId: "wxfb75c0b432670215",
      path: "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1",
      allowedQueryKeys: Object.freeze(["alias", "shopAutoEnter"]),
      updatedAt: "2026-08-24",
      envVersion: "release",
    }),
  }),
  Object.freeze({
    productId: "4875324599",
    youzanProductId: "4875324599",
    title: "ROOT 双链速畅·深彻赋活益生元饮料 RT-PrB-02",
    subtitle: "长短链协同，畅然速调",
    summary: "长短链协同配方的日常益生元饮料。",
    description: "商品信息来自 Root 会员中心快照。规格、价格、库存、优惠及适用说明以会员中心实时展示为准。",
    specText: "具体规格以 Root 会员中心实时页面为准",
    imageUrl: "/static/products/rt-prb-02.jpg",
    priceText: "会员中心实时价格",
    status: "ACTIVE",
    badge: "双链速畅",
    skuCount: 0,
    skus: Object.freeze([]),
    syncedAt: "2026-08-25T21:28:24+08:00",
    updatedAt: "2026-08-25T21:28:24+08:00",
    youzan: Object.freeze({
      enabled: true,
      appId: "wxfb75c0b432670215",
      path: "packages/goods/detail/index?alias=3f2cc448cksvnmk&shopAutoEnter=1",
      allowedQueryKeys: Object.freeze(["alias", "shopAutoEnter"]),
      updatedAt: "2026-08-24",
      envVersion: "release",
    }),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listLocalProducts() {
  return {
    products: clone(PRODUCTS),
    syncedAt: "2026-08-25T21:28:24+08:00",
    source: "LOCAL_V060_COMPAT",
  };
}

function getLocalProduct(productId) {
  const product = PRODUCTS.find((item) => item.productId === String(productId || ""));
  return product ? clone(product) : null;
}

module.exports = Object.freeze({
  PRODUCTS,
  getLocalProduct,
  listLocalProducts,
});
