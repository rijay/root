const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

assert.match(read("pages/home/index.wxml"), /lazy-load="\{\{index > 0\}\}"/);
assert.match(read("pages/welcome/index.wxml"), /screens\[1\][\s\S]*lazy-load="\{\{true\}\}"/);
assert.match(read("pages/products/index.wxml"), /lazy-load="\{\{index > 0\}\}"[\s\S]*binderror="productImageFailed"/);
assert.match(read("pages/products/index.js"), /productImageFailed\(event\)/);
assert.match(read("subpkg/content/pages/detail/index.wxml"), /lazy-load="\{\{assetIndex > 0\}\}"/);
assert.match(read("subpkg/content/pages/detail/index.wxml"), /lazy-load="\{\{detailIndex > 0\}\}"/);
assert.match(read("subpkg/health/pages/assessment/index.wxml"), /bristol-reference__image[\s\S]*lazy-load="\{\{true\}\}"/);

console.log("image loading checks passed");
