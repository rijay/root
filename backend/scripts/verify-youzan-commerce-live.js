const { readLocalYouzanAccessToken } = require("../src/localYouzanKeychain");
const { createEnvironmentYouzanCommerceAdapter } = require("../src/youzanCommerceAdapter");
const { OFFICIAL_PRODUCTS } = require("../src/productCatalog");

async function main(options = {}) {
  const token = (options.readToken || readLocalYouzanAccessToken)();
  const env = options.env || process.env;
  const adapter = createEnvironmentYouzanCommerceAdapter(env, {
    accessTokenProvider: token ? async () => token : null,
    fetchImpl: options.fetchImpl,
    kdtId: options.kdtId,
  });
  if (!adapter.configured) {
    console.log(JSON.stringify({ configured: false, ok: false, reason: "KEYCHAIN_TOKEN_UNAVAILABLE" }));
    process.exitCode = 1;
    return;
  }
  const expectedIds = OFFICIAL_PRODUCTS.map((item) => item.youzan_product_id).sort();
  const result = await adapter.readProductSnapshots({ productIds: expectedIds });
  const products = Array.isArray(result.products) ? result.products : [];
  const actualIds = products.map((item) => item.productId).sort();
  console.log(JSON.stringify({
    configured: true,
    ok: JSON.stringify(actualIds) === JSON.stringify(expectedIds)
      && products.every((item) => /^¥\d/.test(item.priceText) && item.syncedAt && item.skus.length > 0),
    productCount: products.length,
    productIdsMatched: JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    livePriceCount: products.filter((item) => /^¥\d/.test(item.priceText)).length,
    skuCount: products.reduce((total, item) => total + (Array.isArray(item.skus) ? item.skus.length : 0), 0),
    syncedAtPresent: products.every((item) => Boolean(item.syncedAt)),
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify({ configured: true, ok: false, reason: String(error && error.code || "LIVE_PROBE_FAILED") }));
    process.exitCode = 1;
  });
}

module.exports = { main };
