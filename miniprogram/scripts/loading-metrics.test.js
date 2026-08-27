const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const monitor = read("utils/performance-monitor.js");
const profileScript = read("pages/profile/index.js");
const profileView = read("pages/profile/index.wxml");
const homeScript = read("pages/home/index.js");
const homeView = read("pages/home/index.wxml");
const productsScript = read("pages/products/index.js");
const productsView = read("pages/products/index.wxml");
const productDetailScript = read("pages/product-detail/index.js");
const healthScript = read("pages/health/index.js");

assert.match(monitor, /function recordPageMetric\(input = \{\}\)/);
assert.match(monitor, /function recordImageResult\(input = \{\}\)/);
assert.match(monitor, /input\.status === "LOAD_FAILED" \? "LOAD_FAILED" : "LOAD_SUCCESS"/);

assert.match(profileScript, /entry: "usable_content"/);
assert.match(profileScript, /entry: "profile_refresh"/);
assert.match(profileScript, /entry: "profile_avatar"/);
assert.match(profileView, /bindload="profileImageLoaded" binderror="profileImageFailed"/);

assert.match(homeScript, /entry: "usable_content"/);
assert.match(homeScript, /entry: "home_banner"/);
assert.match(homeView, /bindload="imageLoaded" binderror="imageFailed"/);
assert.match(homeScript, /const firstItems = initialHome\(\)/);
assert.match(homeScript, /state: firstItems\.length \? "ready" : "loading"/);
assert.match(homeScript, /recordUsableContent\("LOCAL_FIRST_FRAME"\)/);
assert.match(homeScript, /background: this\.data\.items\.length > 0/);

assert.match(productsScript, /entry: "usable_content"/);
assert.match(productsScript, /entry: "product_image"/);
assert.match(productsView, /bindload="productImageLoaded" binderror="productImageFailed"/);
assert.match(productsScript, /const firstCatalog = initialProductCatalog\(\)/);
assert.match(productsScript, /loading: false,[\s\S]*products: firstProducts/);
assert.match(productsScript, /background: this\.data\.products\.length > 0/);
assert.match(productsScript, /recordUsableContent\("LOCAL_FIRST_FRAME"\)/);
assert.match(productDetailScript, /decorateProduct\(initialProduct\(productId\)\)/);
assert.match(productDetailScript, /loading: !product/);
assert.match(healthScript, /const firstCatalog = initialCatalog\(\)/);
assert.match(healthScript, /loading: false,[\s\S]*assessments: firstHealthState\.assessments \|\| firstCatalog\.assessments/);
assert.match(healthScript, /readSessionPageCache\(healthCacheKey\(\)\)/);
assert.match(healthScript, /cacheKey !== healthCacheKey\(\)/);
assert.match(healthScript, /finally \{[\s\S]*cacheKey === healthCacheKey\(\)[\s\S]*loading: false/);
assert.match(healthScript, /async reloadOverview\(\) \{[\s\S]*const cacheKey = this\._healthCacheKey \|\| healthCacheKey\(\)[\s\S]*cacheKey !== healthCacheKey\(\)/);

for (const source of [profileScript, homeScript, productsScript]) {
  assert.doesNotMatch(source, /recordImageResult\([\s\S]{0,240}(?:imageUrl|avatarUrl|productId)/);
}

console.log("v0.7.0 loading metric checks passed");
