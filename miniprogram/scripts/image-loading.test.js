const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const welcomeConfig = JSON.parse(read("pages/welcome/index.json"));

assert.match(read("pages/home/index.wxml"), /lazy-load="\{\{index > 0\}\}"/);
assert.match(read("pages/welcome/index.wxml"), /screens\[1\][\s\S]*lazy-load="\{\{true\}\}"/);
assert.match(read("pages/welcome/index.wxml"), /screens\[0\][\s\S]*fade-in="\{\{false\}\}"/);
assert.doesNotMatch(read("pages/welcome/index.js"), /setData\(\{ screens \}\)/);
assert.match(read("pages/welcome/index.js"), /const INITIAL_SCREENS = initialScreens\(\)/);
assert.equal(welcomeConfig.backgroundColor, "#000000");
assert.equal(welcomeConfig.backgroundColorTop, "#000000");
assert.equal(welcomeConfig.backgroundColorBottom, "#000000");
assert.match(read("pages/welcome/index.wxss"), /\.welcome,\s*\.welcome__swiper,\s*\.welcome__slide\s*\{[^}]*background:\s*var\(--root-ink\)/s);
assert.match(read("pages/products/index.wxml"), /lazy-load="\{\{index > 0\}\}"[\s\S]*binderror="productImageFailed"/);
assert.match(read("pages/products/index.js"), /productImageFailed\(event\)/);
assert.match(read("subpkg/content/pages/detail/index.wxml"), /lazy-load="\{\{assetIndex > 0\}\}"/);
assert.match(read("subpkg/content/pages/detail/index.wxml"), /lazy-load="\{\{detailIndex > 0\}\}"/);
assert.match(read("subpkg/content/pages/detail/index.wxml"), /style="\{\{asset\.displayStyle\}\}"/);
assert.match(read("subpkg/content/pages/detail/index.wxss"), /content-detail__asset--reserved[^}]*overflow:\s*hidden/);
assert.match(read("utils/content-presenter.js"), /displayHeightRpx[\s\S]*Math\.round\(750 \* height \/ width\)/);
assert.match(read("pages/activities/index.wxml"), /activity-state activity-state--loading/);
assert.match(read("pages/activities/index.wxss"), /activity-state--loading[^}]*min-height:\s*390px/);
assert.match(read("subpkg/health/pages/assessment/index.wxml"), /bristol-reference__image[\s\S]*lazy-load="\{\{true\}\}"/);

console.log("image loading checks passed");
