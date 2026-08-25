const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const homeScript = read("pages/home/index.js");
const homeWxml = read("pages/home/index.wxml");
const detailScript = read("subpkg/content/pages/detail/index.js");
const detailWxml = read("subpkg/content/pages/detail/index.wxml");
const detailWxss = read("subpkg/content/pages/detail/index.wxss");
const brandScript = read("subpkg/content/pages/brand-foundation/index.js");
const brandWxml = read("subpkg/content/pages/brand-foundation/index.wxml");
const brandWxss = read("subpkg/content/pages/brand-foundation/index.wxss");

assert.match(homeScript, /\/api\/v1\/public\/content\/home/);
assert.match(homeScript, /readPublicPageCache/);
assert.match(homeScript, /requestWithDeadline/);
assert.match(homeScript, /contentId/);
assert.match(homeScript, /executeContentAction/);
assert.doesNotMatch(homeScript, /user\/state|health|tasks|member-center/i);
assert.match(homeWxml, /<swiper/);
assert.match(homeWxml, /immersive-header/);
assert.match(homeWxml, /data-release-asset="\{\{item\.assetState\}\}"/);
assert.doesNotMatch(homeWxml, /home-product-banner/);
assert.match(homeScript, /selectedIndex/);
assert.match(brandScript, /\[1, 2, 3, 4, 5\]/);
assert.match(brandScript, /onShareAppMessage/);
assert.match(brandWxml, /<swiper/);
assert.match(brandWxml, /mode="aspectFit"/);
assert.match(brandWxml, /brand-foundation__progress/);
assert.match(brandWxss, /safe-area-inset-bottom/);
assert.match(detailScript, /\/api\/v1\/public\/content\/detail/);
assert.match(detailScript, /executeContentAction/);
assert.match(detailWxml, /page-navigation/);
assert.match(detailWxml, /wx:for="\{\{item\.detailImages\}\}"/);
assert.match(detailWxss, /content-detail__kicker[^{]*\{[^}]*width:\s*calc\(100% - 48px\)/s);

console.log("formal content tests ok");
