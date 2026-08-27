const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let stored = null;
global.wx = {
  getStorageSync() { return stored; },
  setStorageSync(_key, value) { stored = value; },
};

const navigation = require("../utils/product-navigation");
const { listLocalProducts } = require("../utils/local-product-catalog");
const { formatProductSyncedAt } = require("../utils/product-display");
const { isConfiguredProductPath, mergeJumpTarget } = require("../utils/youzan-jump");

assert.equal(formatProductSyncedAt("2026-08-25"), "2026.08.25");
assert.equal(formatProductSyncedAt("2026-08-25T21:28:24+08:00"), "2026.08.25 21:28");
assert.equal(formatProductSyncedAt("2026-08-25T13:28:24Z"), "2026.08.25 21:28");
assert.equal(formatProductSyncedAt(""), "");

const products = listLocalProducts().products;
assert.equal(navigation.activeProductIdForScroll(products, 0, 375), "4749049439");
assert.equal(navigation.activeProductIdForScroll(products, 330, 375), "4875324599");
assert.equal(navigation.scrollLeftForProduct(products, "4749049439", 375), 0);
assert.equal(Math.round(navigation.scrollLeftForProduct(products, "4875324599", 375)), 316);
assert.deepEqual(navigation.saveProductViewState({
  productId: "4875324599",
  scrollLeft: 318,
  scrollTop: 426,
}), {
  productId: "4875324599",
  scrollLeft: 318,
  scrollTop: 426,
});
assert.deepEqual(navigation.readProductViewState(), stored);
assert.deepEqual(navigation.resolveProductFocus(products, "4875324599", "4749049439"), {
  productId: "4875324599",
  requestedUnavailable: false,
});
assert.deepEqual(navigation.resolveProductFocus(products, "missing-product", "4875324599"), {
  productId: "4875324599",
  requestedUnavailable: true,
});
assert.deepEqual(navigation.resolveProductFocus(products, "missing-product", "missing-saved"), {
  productId: "4749049439",
  requestedUnavailable: true,
});

products.forEach((product) => {
  const target = mergeJumpTarget(product);
  assert.equal(target.enabled, true);
  assert.equal(isConfiguredProductPath(target.path, target.allowedQueryKeys), true);
  assert.equal(target.updatedAt, "2026-08-24");
  assert.match(product.imageUrl, /^\/static\/products\/rt-prb-0[12]\.jpg$/);
  assert.match(product.specText, /会员中心/);
  assert.equal(product.syncedAt, "2026-08-25T21:28:24+08:00");
  assert.match(product.summary, /益生元饮料/);
  assert.match(product.description, /会员中心快照/);
});
assert.equal(isConfiguredProductPath(
  "packages/goods/detail/index?alias=valid&shopAutoEnter=1&openid=private",
  ["alias", "shopAutoEnter"],
), false);

const root = path.resolve(__dirname, "..");
const listScript = fs.readFileSync(path.join(root, "pages/products/index.js"), "utf8");
const listWxml = fs.readFileSync(path.join(root, "pages/products/index.wxml"), "utf8");
const detailScript = fs.readFileSync(path.join(root, "pages/product-detail/index.js"), "utf8");
const detailWxml = fs.readFileSync(path.join(root, "pages/product-detail/index.wxml"), "utf8");
assert.match(listWxml, /bindscroll="onProductScroll"/);
assert.match(listWxml, /ROOT 核心原料 PHGG 科学参考文献集/);
assert.match(listScript, /persistViewState/);
assert.match(listScript, /product_impression/);
assert.match(listScript, /member_center_handoff/);
assert.match(listScript, /confirmText:\s*"重试"/);
assert.match(listScript, /cancelText:\s*"留在此页"/);
assert.match(listScript, /指定商品暂不可见/);
assert.match(listScript, /scrollLeftForProduct/);
assert.match(listScript, /resetPageScroll:\s*true/);
assert.match(listScript, /carouselVisible:\s*false/);
assert.match(listWxml, /wx:if="\{\{carouselVisible\}\}"/);
assert.doesNotMatch(listWxml, /\{\{catalogNotice\}\}/);
assert.match(listScript, /presentCatalogRefreshStatus\(data\.degradedText \|\| ""\)/);
assert.match(listScript, /title:\s*"商品更新失败，已显示本地信息"/);
assert.match(listScript, /icon:\s*"none"/);
assert.match(detailScript, /product_detail_view/);
assert.match(detailScript, /member_center_handoff/);
assert.match(detailScript, /openProducts\(\)/);
assert.match(detailWxml, /product\.syncedAtText/);
assert.doesNotMatch(detailWxml, /\{\{product\.syncedAt\}\}/);

delete global.wx;
console.log("product experience tests passed");
