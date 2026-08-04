const assert = require("node:assert/strict");

const { presentDetail, presentHome, presentWelcome } = require("../utils/content-presenter");

const assetUrl = "/api/v1/public/content/assets/content_asset_001";

assert.equal(presentWelcome({ screens: [{ slot: 1, copy: "第一屏", assetUrl }] }), null);
assert.deepEqual(presentWelcome({ screens: [
  { slot: 2, copy: "第二屏", assetUrl },
  { slot: 1, copy: "第一屏", assetUrl },
] }).map((screen) => screen.slot), [1, 2]);

assert.equal(presentHome({ items: [{ contentId: "unsafe", lines: ["一", "二"], coverAssetUrl: "javascript:1", detailPath: "/subpkg/content/pages/detail/index?contentId=unsafe" }] }).length, 0);
assert.equal(presentHome({ items: [{ contentId: "detail_001", lines: ["一", "二"], coverAssetUrl: assetUrl, detailPath: "/subpkg/content/pages/detail/index?contentId=detail_001" }] }).length, 1);

const detail = presentDetail({ item: {
  contentId: "detail_001",
  assets: [{ assetId: "asset_001", imageUrl: assetUrl, hotspots: [{ x: 10, y: 10, width: 20, height: 20, action: { type: "MINIPROGRAM_PAGE", path: "/pages/activities/index" } }] }],
  detailImages: [assetUrl],
} });
assert.equal(detail.assets.length, 1);
assert.equal(detail.assets[0].hotspots.length, 1);

console.log("content presenter tests ok");
