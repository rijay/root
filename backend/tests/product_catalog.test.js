const assert = require("node:assert/strict");
const test = require("node:test");

const productCatalog = require("../src/productCatalog");
const { createEmptyData } = require("../src/store");

test("v0.6 official catalog replaces the retired snapshot product without discarding future dynamic fields", () => {
  const data = createEmptyData();
  data.youzanProducts = [{
    youzan_product_id: "ROOT_PREBIOTIC_7D_RESET",
    title: "旧 7 日商品",
    status: "ACTIVE",
    youzan_app_id: "legacy",
    youzan_path: "#小程序://legacy",
  }];
  data.campaignProductRelations = [{
    campaign_product_relation_id: "legacy_relation",
    campaign_id: "ROOT_ROADSHOW_DEFAULT",
    youzan_product_id: "ROOT_PREBIOTIC_7D_RESET",
    display_order: 1,
  }];

  const catalog = productCatalog.listProducts(data);
  assert.deepEqual(catalog.products.map((item) => item.productId), ["4749049439", "4875324599"]);
  assert.equal(catalog.products.some((item) => item.productId === "ROOT_PREBIOTIC_7D_RESET"), false);
  assert.equal(catalog.products.every((item) => item.youzan.appId === "wxfb75c0b432670215"), true);
  assert.equal(catalog.products[0].youzan.path, "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1");
  assert.equal(catalog.products[1].youzan.path, "packages/goods/detail/index?alias=3f2cc448cksvnmk&shopAutoEnter=1");
});

test("persisted dynamic price and image remain available while the official jump target stays authoritative", () => {
  const data = createEmptyData();
  data.youzanProducts = [{
    youzan_product_id: "4749049439",
    title: "stale title",
    image_url: "https://example.invalid/product.png",
    price_text: "¥299",
    status: "ACTIVE",
    youzan_app_id: "wrong",
    youzan_path: "packages/wrong",
  }];
  const product = productCatalog.getProduct(data, "4749049439", {
    env: {
      ROOT_MEMBER_CENTER_APPID: "wx-wrong-env-override",
      ROOT_MEMBER_CENTER_PRODUCT_PATH: "packages/wrong-env",
      ROOT_MEMBER_CENTER_ENV_VERSION: "invalid",
    },
  });
  assert.equal(product.title, "ROOT 低敏畅享·每日衡养益生元饮料 RT-PrB-01");
  assert.equal(product.imageUrl, "https://example.invalid/product.png");
  assert.equal(product.priceText, "¥299");
  assert.equal(product.youzan.appId, "wxfb75c0b432670215");
  assert.equal(product.youzan.path, "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1");
  assert.equal(product.youzan.envVersion, "release");
});

test("live Youzan snapshots override only dynamic price, image and SKU fields", () => {
  const data = createEmptyData();
  const product = productCatalog.getProduct(data, "4749049439", {
    liveProductSnapshots: [{
      productId: "4749049439",
      title: "远端标题不得使用",
      priceText: "¥199",
      imageUrl: "https://img01.yzcdn.cn/product.jpg",
      syncedAt: "2026-08-25T12:00:00.000Z",
      skus: [{ skuId: "101", skuName: "14袋", price: 19900, priceText: "¥199", stockStatus: "IN_STOCK" }],
    }],
  });
  assert.equal(product.title, "ROOT 低敏畅享·每日衡养益生元饮料 RT-PrB-01");
  assert.equal(product.priceText, "¥199");
  assert.equal(product.imageUrl, "https://img01.yzcdn.cn/product.jpg");
  assert.equal(product.syncedAt, "2026-08-25T12:00:00.000Z");
  assert.deepEqual(product.skus, [
    { skuId: "101", skuName: "14袋", price: 19900, priceText: "¥199", stockStatus: "IN_STOCK" },
  ]);
  assert.equal(product.youzan.path, "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1");
});
