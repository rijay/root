const assert = require("node:assert/strict");

const {
  pathOnly,
  routeFromLaunchOptions,
} = require("../utils/entry-launch");

assert.equal(routeFromLaunchOptions({ path: "pages/home/index" }), "/pages/home/index");
assert.equal(routeFromLaunchOptions({
  path: "pages/product-detail/index",
  query: { productId: "4749049439", unsafe: "a/b", signature: "a".repeat(64) },
}), "/pages/product-detail/index?productId=4749049439");
assert.equal(pathOnly("/pages/products/index?productId=4749049439"), "/pages/products/index");

console.log("entry launch tests passed");
