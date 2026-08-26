const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// v0.7.0 明确允许全局品牌色语义化、图片加载优化和「我的」首屏缓存；
// 这些受保护页面的校验值只接受上述范围内经复核后的变化，继续阻止无关漂移。
const baselineHashes = Object.freeze({
  "pages/welcome/index.wxml": "9c11d9a567593751bb889b28ee42da9d68d3cd973eebe1bbeb57b14c2c9ba378",
  "pages/welcome/index.wxss": "c13648bd26d1d8808a27620da334a3ed9f9e988f4c3321d8dae7180b6c5627ac",
  "pages/welcome/index.json": "93d132db2005aeb2ce1745eb556e61e85aeb2ab9f576369267fa3cb493d4b699",
  "pages/activities/index.wxml": "423eb5e728d558568fcf19e95127a1f211b3c69db96352a7de781dea69415324",
  "pages/activities/index.wxss": "ce7bbefc9376533c6ab5debb34db42ca1e5229145e9a049632a3b464b7d6bd53",
  "pages/activities/index.json": "ee29d7e47ea708cc023368fa9d84276ce47ea7ae8ec888d33f674227cd03a571",
  "subpkg/activity/pages/detail/index.wxml": "751cc747e84535ef28b65b60a4d292cb74e8a96b78fd9d7da759a8cbb7691572",
  "subpkg/activity/pages/detail/index.wxss": "77565586c38e11f5049c38ffbdd42797893095910062809e5bd950e14f8d5fa0",
  "subpkg/activity/pages/enrollments/index.wxml": "dc8a73aa623ab787f645899764e458ce32a2b5bf16caf0d07b0a534190f98f6d",
  "subpkg/activity/pages/enrollments/index.wxss": "4ef4ad3ad7366e041d0cbfc6bdf06ffbc6bc7849a1fd291fc710d2ff3544d03f",
  "pages/login/index.wxml": "6784bc99cdff14d6e7691c774a978a6006fe220035d368f10eec46cee16361c3",
  "pages/login/index.wxss": "0f1e5044abe90631bcdd368f0071747fbe3171f820407b9c7829814d1807a59d",
  "pages/register/index.wxml": "e5d9a8ec1cb836680373d333f15ff0cbd69227a0da13607540044de7701c059f",
  "pages/register/index.wxss": "2526017a545c6dd1b7fdbd8138cf738d659933e83878fae284e2530e19dd5b8b",
  "pages/profile/index.wxml": "6b46e91e30f24a7e28e1c833b937685cfb9ed898663e445b42c4ff21bc71c176",
  "pages/profile/index.wxss": "9098589ff531039922c1b177d21bc5eb740b7a63c7914f77681cc5f398941755",
});

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

Object.entries(baselineHashes).forEach(([file, expected]) => {
  assert.equal(sha256(file), expected, `${file} 不得偏离 0.7.0 已复核页面基线`);
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

console.log("v0.7.0 protected page regression checks passed");
