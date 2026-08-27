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
const phggScript = read("subpkg/content/pages/phgg-reference/index.js");
const phggWxml = read("subpkg/content/pages/phgg-reference/index.wxml");

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
assert.match(phggScript, /showFriendShareMenu/);
assert.match(phggScript, /setClipboardData/);
assert.match(phggScript, /onShareAppMessage/);
assert.match(phggWxml, /不代表任何 ROOT 成品具备同等研究结论/);
assert.match(phggWxml, /研究中的用量不能替代包装标示的食用方式/);
assert.doesNotMatch(phggWxml, /阻挡\s*30%|100%改善|体重下降|国内首款|抗生素|术后|治疗作用/);
assert.match(detailScript, /\/api\/v1\/public\/content\/detail/);
assert.match(detailScript, /executeContentAction/);
assert.match(detailWxml, /page-navigation/);
assert.match(detailWxml, /wx:for="\{\{item\.detailImages\}\}"/);
assert.match(detailWxss, /content-detail__kicker[^{]*\{[^}]*width:\s*calc\(100% - 48px\)/s);

console.log("formal content tests ok");
