const assert = require("node:assert/strict");

const { initialHome, presentDetail, presentHome, presentHomeAction, presentWelcome } = require("../utils/content-presenter");

const assetUrl = "/api/v1/public/content/assets/content_asset_001";

const firstFrame = initialHome();
assert.deepEqual(firstFrame.map((item) => item.contentId), [
  "SHARED_DETAIL_C53C7360B016F4",
  "SHARED_DETAIL_6292953EB853D1",
  "SHARED_DETAIL_DB47F77499F012",
]);
assert.deepEqual(firstFrame.map((item) => item.coverAssetUrl), [
  "/static/home/banner1.jpg",
  "/static/home/banner2.jpg",
  "/static/campaign/root-with-you-home.jpg",
]);
assert.equal(firstFrame[0].kicker, "");
assert.equal(firstFrame[0].topCopy, "ROOT 的旅程，从一粒种子开始");
assert.deepEqual(firstFrame[0].lines, ["立即探索"]);
assert.deepEqual(firstFrame.map((item) => item.action.type), ["MINIPROGRAM_PAGE", "PRODUCTS", "MINIPROGRAM_PAGE"]);

const refreshedHome = presentHome({ items: [
  {
    contentId: "SHARED_DETAIL_C53C7360B016F4",
    kicker: "ROOT FOUNDATION",
    lines: ["人如草木，", "根定而生"],
    coverAssetUrl: assetUrl,
  },
  {
    contentId: "SHARED_DETAIL_6292953EB853D1",
    kicker: "ROOT PRODUCTS",
    lines: ["根据自身肠道状态", "选择专属养护方式"],
    coverAssetUrl: assetUrl,
  },
  {
    contentId: "SHARED_DETAIL_DB47F77499F012",
    kicker: "ROOT WITH YOU",
    lines: ["ROOT陪伴计划", "快速了解你的肠道状态", "并领取5支益生元体验装"],
    coverAssetUrl: assetUrl,
  },
] });
assert.deepEqual(refreshedHome.map((item) => item.contentId), firstFrame.map((item) => item.contentId));
assert.deepEqual(refreshedHome.map((item) => item.lines), firstFrame.map((item) => item.lines));
assert.deepEqual(refreshedHome.map((item) => item.action), firstFrame.map((item) => item.action));

assert.equal(presentWelcome({ screens: [{ slot: 1, copy: "第一屏", assetUrl }] }), null);
assert.deepEqual(presentWelcome({ screens: [
  { slot: 2, copy: "第二屏", assetUrl },
  { slot: 1, copy: "第一屏", assetUrl },
] }).map((screen) => screen.slot), [1, 2]);

assert.deepEqual(presentHome({ items: [{ contentId: "unsafe", lines: ["一", "二"], coverAssetUrl: "javascript:1", detailPath: "/subpkg/content/pages/detail/index?contentId=unsafe" }] }).map((item) => item.contentId), ["ROOT_WITH_YOU_V060"]);
assert.equal(presentHome({ items: [{ contentId: "detail_001", lines: ["一", "二"], coverAssetUrl: assetUrl, detailPath: "/subpkg/content/pages/detail/index?contentId=detail_001" }] }).length, 2);
assert.deepEqual(presentHomeAction({ detailPath: "/subpkg/content/pages/detail/index?contentId=detail_001" }), {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/content/pages/detail/index?contentId=detail_001",
});
assert.deepEqual(presentHome({ items: [{
  contentId: "cnt_home_foundation",
  lines: ["人如草木", "根定而生"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=cnt_home_foundation",
}] })[0].action, {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/content/pages/brand-foundation/index",
});
assert.deepEqual(presentHome({ items: [{
  contentId: "cnt_home_foundation",
  lines: ["后台旧标题", "后台旧副标题"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=cnt_home_foundation",
}] })[0].lines, ["立即探索"]);
assert.equal(presentHome({ items: [{
  contentId: "cnt_home_foundation",
  lines: ["后台旧标题", "后台旧副标题"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=cnt_home_foundation",
}] })[0].topCopy, "ROOT 的旅程，从一粒种子开始");
assert.equal(presentHome({ items: [{
  contentId: "cnt_home_foundation",
  lines: ["后台旧标题", "后台旧副标题"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=cnt_home_foundation",
}] })[0].copyVariant, "foundation-single");
assert.equal(presentHome({ items: [{
  contentId: "cnt_home_foundation",
  lines: ["后台旧标题", "后台旧副标题"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=cnt_home_foundation",
}] })[0].coverAssetUrl, "/static/home/banner1.jpg");
assert.deepEqual(presentHome({ items: [{
  contentId: "SHARED_DETAIL_C53C7360B016F4",
  lines: ["人如草木", "根定而生"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=SHARED_DETAIL_C53C7360B016F4",
}] })[0].action, {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/content/pages/brand-foundation/index",
});
assert.deepEqual(presentHome({ items: [{
  contentId: "other_first_banner",
  lines: ["其它内容", "不应误接"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=other_first_banner",
}] })[0].action, {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/content/pages/detail/index?contentId=other_first_banner",
});
assert.deepEqual(presentHome({ items: [{
  contentId: "future_brand_banner",
  slot: 1,
  lines: ["人如草木", "根定而生"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=future_brand_banner",
}] })[0].action, {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/content/pages/brand-foundation/index",
});
assert.deepEqual(presentHome({ items: [{
  contentId: "products_001",
  lines: ["新品上新", "两款产品"],
  coverAssetUrl: assetUrl,
  action: { type: "PRODUCTS", productId: "4749049439" },
}] })[0].action, { type: "PRODUCTS", productId: "4749049439", source: "home_banner" });
const productsBanner = presentHome({ items: [{
  contentId: "SHARED_DETAIL_6292953EB853D1",
  lines: ["后台旧标题", "后台旧副标题"],
  coverAssetUrl: assetUrl,
  action: { type: "MINIPROGRAM_PAGE", path: "/subpkg/content/pages/detail/index?contentId=SHARED_DETAIL_6292953EB853D1" },
}] })[0];
assert.deepEqual(productsBanner.action, { type: "PRODUCTS", productId: "", source: "home_banner" });
assert.deepEqual(productsBanner.lines, ["根据自身肠道状态", "选择专属养护方式"]);
assert.equal(productsBanner.coverAssetUrl, "/static/home/banner2.jpg");
assert.deepEqual(presentHome({ items: [{
  contentId: "unsafe_action",
  lines: ["一", "二"],
  coverAssetUrl: assetUrl,
  action: { type: "MINIPROGRAM_PAGE", path: "/pages/health/index?answers=private" },
}] }).map((item) => item.contentId), ["ROOT_WITH_YOU_V060"]);

const localCampaign = presentHome({ items: [] })[0];
assert.equal(localCampaign.contentId, "ROOT_WITH_YOU_V060");
assert.equal(localCampaign.copyMode, "text");
assert.equal(localCampaign.copyVariant, "campaign-split");
assert.equal(localCampaign.coverAssetUrl, "/static/campaign/root-with-you-home.jpg");
assert.deepEqual(localCampaign.lines, ["ROOT陪伴计划", "快速了解你的肠道状态", "并领取5支益生元体验装"]);

const backendCampaign = presentHome({ items: [{
  contentId: "ROOT_WITH_YOU_V060",
  slot: 3,
  kicker: "后台眉题",
  lines: ["后台标题", "后台副标题"],
  coverAssetUrl: assetUrl,
  detailPath: "/subpkg/content/pages/detail/index?contentId=ROOT_WITH_YOU_V060",
}] })[0];
assert.equal(backendCampaign.kicker, "后台眉题");
assert.deepEqual(backendCampaign.lines, ["后台标题", "后台副标题"]);
assert.equal(backendCampaign.copyMode, "text");
assert.equal(backendCampaign.copyVariant, "campaign-split");
assert.equal(backendCampaign.coverAssetUrl, "/static/campaign/root-with-you-home.jpg");

const generatedBackendCampaign = presentHome({ items: [
  {
    contentId: "backend_banner_1",
    kicker: "第一张",
    lines: ["第一张标题", "第一张副标题"],
    coverAssetUrl: assetUrl,
    detailPath: "/subpkg/content/pages/detail/index?contentId=backend_banner_1",
  },
  {
    contentId: "backend_banner_2",
    kicker: "第二张",
    lines: ["第二张标题", "第二张副标题"],
    coverAssetUrl: assetUrl,
    detailPath: "/subpkg/content/pages/detail/index?contentId=backend_banner_2",
  },
  {
    contentId: "backend_generated_banner_3",
    kicker: "后台可编辑眉题",
    lines: ["后台可编辑标题", "后台可编辑副标题"],
    coverAssetUrl: assetUrl,
    detailPath: "/subpkg/content/pages/detail/index?contentId=backend_generated_banner_3",
  },
] })[2];
assert.equal(generatedBackendCampaign.contentId, "backend_generated_banner_3");
assert.equal(generatedBackendCampaign.kicker, "后台可编辑眉题");
assert.deepEqual(generatedBackendCampaign.lines, ["后台可编辑标题", "后台可编辑副标题"]);
assert.equal(generatedBackendCampaign.coverAssetUrl, "/static/campaign/root-with-you-home.jpg");
assert.deepEqual(generatedBackendCampaign.action, {
  type: "MINIPROGRAM_PAGE",
  path: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY",
});

const detail = presentDetail({ item: {
  contentId: "detail_001",
  assets: [{ assetId: "asset_001", imageUrl: assetUrl, width: 1125, height: 1500, hotspots: [{ x: 10, y: 10, width: 20, height: 20, action: { type: "MINIPROGRAM_PAGE", path: "/pages/activities/index" } }] }],
  detailImages: [assetUrl],
} });
assert.equal(detail.assets.length, 1);
assert.equal(detail.assets[0].hotspots.length, 1);
assert.equal(detail.assets[0].displayHeightRpx, 1000);
assert.equal(detail.assets[0].displayStyle, "height: 1000rpx;");
assert.equal(detail.assets[0].displayMode, "aspectFill");

console.log("content presenter tests ok");
