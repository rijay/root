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

assert.match(productsScript, /entry: "usable_content"/);
assert.match(productsScript, /entry: "product_image"/);
assert.match(productsView, /bindload="productImageLoaded" binderror="productImageFailed"/);

for (const source of [profileScript, homeScript, productsScript]) {
  assert.doesNotMatch(source, /recordImageResult\([\s\S]{0,240}(?:imageUrl|avatarUrl|productId)/);
}

console.log("v0.7.0 loading metric checks passed");
