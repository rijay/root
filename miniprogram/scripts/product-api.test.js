const assert = require("node:assert/strict");

let shouldFail = false;
let loggedIn = true;
let liveStatus = "LIVE";
global.wx = {
  getStorageSync() { return loggedIn ? "token" : ""; },
};
require.cache[require.resolve("../utils/request")] = {
  exports: {
    getToken() { return loggedIn ? "token" : ""; },
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
          priceSync: { status: liveStatus, reason: liveStatus === "LIVE" ? "" : "LIVE_READ_UNAVAILABLE", syncedAt: "2026-08-25T10:00:00.000Z" },
        };
      }
      if (options.url === "/api/v1/products/jump") {
        assert.equal(options.method, "POST");
        assert.deepEqual(options.data, { productId: "4749049439", sourceChannel: "PRODUCT_LIST" });
        assert.match(options.idempotencyKey, /^product-jump:4749049439:/);
        return { jumpTarget: { appId: "wxfb75c0b432670215", path: "packages/goods/detail/index?alias=server" } };
      }
      return {
        product: { productId: "4749049439", priceText: "¥199", imageUrl: "" },
        priceSync: { status: liveStatus, reason: liveStatus === "LIVE" ? "" : "LIVE_READ_UNAVAILABLE", syncedAt: "2026-08-25T10:00:00.000Z" },
      };
    },
  },
};

const api = require("../utils/product-api");
const { jumpToYouzanProduct } = require("../utils/youzan-jump");

async function main() {
  const initial = api.initialProductCatalog();
  assert.equal(initial.source, "LOCAL_BUNDLED");
  assert.equal(initial.degraded, false);
  assert.equal(initial.products.length, 2);
  assert.equal(initial.products[0].imageUrl, "/static/products/rt-prb-01.jpg");
  assert.equal(api.initialProduct("4749049439").productId, "4749049439");

  const live = await api.listProducts();
  assert.equal(live.source, "YOUZAN_LIVE");
  assert.equal(live.degraded, false);
  assert.equal(live.products[0].priceText, "¥199");
  assert.equal(live.products[0].imageUrl, "/static/products/rt-prb-01.jpg");
  assert.deepEqual(live.products[0].youzan.allowedQueryKeys, ["alias", "shopAutoEnter"]);

  liveStatus = "UNAVAILABLE";
  const serverFallback = await api.listProducts();
  assert.equal(serverFallback.source, "SERVER_CATALOG");
  assert.equal(serverFallback.degraded, true);
  assert.match(serverFallback.degradedText, /实时价格暂未同步/);
  liveStatus = "LIVE";

  const detail = await api.getProduct("4749049439");
  assert.equal(detail.product.priceText, "¥199");
  assert.equal(detail.product.imageUrl, "/static/products/rt-prb-01.jpg");

  const prepared = await api.prepareProductJump(live.products[0], "PRODUCT_LIST");
  assert.equal(prepared.targetSource, "SERVER");
  assert.equal(prepared.recorded, true);

  loggedIn = false;
  const guest = await api.prepareProductJump(live.products[0], "PRODUCT_LIST");
  assert.equal(guest.targetSource, "CATALOG");
  assert.equal(guest.recorded, false);
  await assert.rejects(jumpToYouzanProduct({
    enabled: true,
    appId: "wx-attacker-app",
    path: "packages/goods/detail/index?alias=server",
    allowedQueryKeys: ["alias"],
  }), (error) => error.code === "MEMBER_APP_MISMATCH");
  await assert.rejects(jumpToYouzanProduct({
    enabled: true,
    shortLink: "#小程序://非ROOT商城/untrusted",
  }), (error) => error.code === "MEMBER_SHORT_LINK_MISMATCH");

  shouldFail = true;
  const fallback = await api.listProducts();
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.source, "LOCAL_BUNDLED");
  assert.match(fallback.degradedText, /价格、库存与优惠以会员中心为准/);

  delete global.wx;
}

main()
  .then(() => console.log("product API snapshot and fallback tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
