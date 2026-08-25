const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// v0.6.1 运营体验优化明确允许精简 Launching 第一屏、调整活动页标题，
// 并修正活动详情底栏不可操作状态的重复文案，
// 并为体验版虚构活动使用对外可审核运营文案，不展示内部测试措辞；
// 其他受保护页面继续沿用线上 0.5.25 视觉基线。
const baselineHashes = Object.freeze({
  "pages/welcome/index.wxml": "6f6d738714eab98e4648fae7d78b1c0db6b18c2a361c8bc9c2f64382b809b620",
  "pages/welcome/index.wxss": "17fa03a911ab5fab57cc12c79dcc510d0c8d8c60747b2256ce3499f9eb813804",
  "pages/welcome/index.json": "93d132db2005aeb2ce1745eb556e61e85aeb2ab9f576369267fa3cb493d4b699",
  "pages/activities/index.wxml": "423eb5e728d558568fcf19e95127a1f211b3c69db96352a7de781dea69415324",
  "pages/activities/index.wxss": "29c8c1ebf873400e8035e3024a048f0c2db35a7a5212eaa577e9652bb0bf7f10",
  "pages/activities/index.json": "ee29d7e47ea708cc023368fa9d84276ce47ea7ae8ec888d33f674227cd03a571",
  "subpkg/activity/pages/detail/index.wxml": "751cc747e84535ef28b65b60a4d292cb74e8a96b78fd9d7da759a8cbb7691572",
  "subpkg/activity/pages/detail/index.wxss": "4cb917cbbd1c2d3aeec955d1c509e08b35a31203e9cc4ac491f8ccb81137f222",
  "subpkg/activity/pages/enrollments/index.wxml": "dc8a73aa623ab787f645899764e458ce32a2b5bf16caf0d07b0a534190f98f6d",
  "subpkg/activity/pages/enrollments/index.wxss": "184d2486301582705b2297570ba2be51183379a5dd0e98dd2bfc4acbfa058fa8",
  "pages/login/index.wxml": "899e55a2b466069882c0f119af44308a093d8733af05b636e612016c4af232ca",
  "pages/login/index.wxss": "b025d8535661464de1e235d7f62fd201e832d72d64cfcb51748d06eba175fa57",
  "pages/register/index.wxml": "e5d9a8ec1cb836680373d333f15ff0cbd69227a0da13607540044de7701c059f",
  "pages/register/index.wxss": "8aba173eab6427236dacd48f1bba26f803a174a46a72076ba61e547115a5bd6c",
  "pages/profile/index.wxml": "e6f7530b9bd08f8d7062909bbaae761e5fffc9f1ee3770c69f98bffcf1b900c3",
  "pages/profile/index.wxss": "38da86239f14c499ae1c2bd57b477f80e92fdd882c5149e58834175249372aef",
});

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

Object.entries(baselineHashes).forEach(([file, expected]) => {
  assert.equal(sha256(file), expected, `${file} 不得偏离线上 0.5.25 视觉基线`);
});

const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const allRoutes = [
  ...app.pages,
  ...app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
];
["pages/rewards", "pages/tasks", "pages/order", "subpkg/task", "subpkg/checkin", "subpkg/refund"].forEach((prefix) => {
  assert.equal(allRoutes.some((route) => route === prefix || route.startsWith(`${prefix}/`)), false, `越界路由：${prefix}`);
});

const homeWxml = fs.readFileSync(path.join(root, "pages/home/index.wxml"), "utf8");
assert.match(homeWxml, /home-carousel/);
assert.doesNotMatch(homeWxml, /home-product-banner/);

console.log("v0.6.1 first-batch scope regression checks passed");
