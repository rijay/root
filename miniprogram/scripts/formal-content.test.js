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
const phggWxss = read("subpkg/content/pages/phgg-reference/index.wxss");

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
assert.match(phggScript, /showTimelineShareMenu/);
assert.match(phggScript, /setClipboardData/);
assert.match(phggScript, /onShareAppMessage/);
assert.match(phggScript, /onShareTimeline/);
assert.match(phggScript, /33ad4be54acef24a7ac0d345ea7a1e54ae8ab3f8ab9ac34d8b4114c9f58d7081/);
[
  "一、原料概览",
  "二、核心理化与配方特性",
  "三、作用机制",
  "四、肠道健康临床证据",
  "五、体重管理与代谢证据",
  "六、安全性与耐受性",
  "七、完整参考文献",
  "表 1 PHGG 与其他常见益生元/膳食纤维关键特性对比",
  "表 2 PHGG 在 IBS 及相关肠道症状中的关键临床试验",
  "Fibalance® 28 天消费者测试",
  "特殊人群：SIBO 辅助治疗",
  "术后肠内营养应用（中国人群数据）",
  "文献引用仅用于科学信息交流，不构成医疗建议或功效宣称。产品不能替代药物治疗。",
].forEach((copy) => assert.equal(phggWxml.includes(copy), true, `missing PHGG source copy: ${copy}`));
assert.equal((phggWxml.match(/id="s[1-7]"/g) || []).length, 7);
assert.match(phggWxml, /<text wx:if="\{\{item\.identifier\}\}" class="science-reference__source"/);
assert.doesNotMatch(phggWxml, /science-reference__copy|<button[^>]*item\.identifier/);
assert.match(phggWxss, /science-reference__source\s*\{[^}]*display:\s*block[^}]*text-align:\s*left[^}]*word-break:\s*break-all/s);
assert.doesNotMatch(phggWxss, /science-reference__copy/);
const referenceSourceRule = phggWxss.match(/\.science-reference__source\s*\{[^}]*\}/s)[0];
assert.doesNotMatch(referenceSourceRule, /background|border-radius|padding|min-height|max-width|text-overflow|white-space/);
assert.match(detailScript, /\/api\/v1\/public\/content\/detail/);
assert.match(detailScript, /executeContentAction/);
assert.match(detailWxml, /page-navigation/);
assert.match(detailWxml, /wx:for="\{\{item\.detailImages\}\}"/);
assert.match(detailWxss, /content-detail__kicker[^{]*\{[^}]*width:\s*calc\(100% - 48px\)/s);

console.log("formal content tests ok");
