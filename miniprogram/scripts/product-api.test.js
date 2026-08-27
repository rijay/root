const assert = require("node:assert/strict");

let shouldFail = false;
require.cache[require.resolve("../utils/request")] = {
  exports: {
    async request(options) {
      if (shouldFail) throw new Error("offline");
      if (options.url === "/api/v1/products") {
        return {
          products: [{
            productId: "4749049439",
            title: "ROOT 低敏畅享·每日衡养益生元饮料 RT-PrB-01",
            priceText: "¥199",
            imageUrl: "",
            youzan: { appId: "wxfb75c0b432670215", path: "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1" },
          }],
          syncedAt: "2026-08-25T10:00:00.000Z",
        };
      }
      return { product: { productId: "4749049439", priceText: "¥199", imageUrl: "" } };
    },
  },
};

const api = require("../utils/product-api");

async function main() {
  const initial = api.initialProductCatalog();
  assert.equal(initial.source, "LOCAL_BUNDLED");
  assert.equal(initial.degraded, false);
  assert.equal(initial.products.length, 2);
  assert.equal(initial.products[0].imageUrl, "/static/products/rt-prb-01.jpg");
  assert.equal(api.initialProduct("4749049439").productId, "4749049439");

  const live = await api.listProducts();
  assert.equal(live.source, "SERVER_SNAPSHOT");
  assert.equal(live.products[0].priceText, "¥199");
  assert.equal(live.products[0].imageUrl, "/static/products/rt-prb-01.jpg");
  assert.deepEqual(live.products[0].youzan.allowedQueryKeys, ["alias", "shopAutoEnter"]);

  const detail = await api.getProduct("4749049439");
  assert.equal(detail.product.priceText, "¥199");
  assert.equal(detail.product.imageUrl, "/static/products/rt-prb-01.jpg");

  shouldFail = true;
  const fallback = await api.listProducts();
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.source, "LOCAL_V060_COMPAT");
  assert.match(fallback.degradedText, /价格、库存与优惠以会员中心为准/);
}

main()
  .then(() => console.log("product API snapshot and fallback tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
