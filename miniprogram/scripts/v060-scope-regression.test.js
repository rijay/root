const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// v0.7.2 只放开已明确提出的启动图防闪；其余受保护页面继续阻止范围外漂移。
const baselineHashes = Object.freeze({
  "pages/welcome/index.wxml": "a8e8de1e4e7558171dc36f9ab0e39959d0e925afd4741083bc7c9eb13fdfddc0",
  "pages/welcome/index.wxss": "c13648bd26d1d8808a27620da334a3ed9f9e988f4c3321d8dae7180b6c5627ac",
  "pages/welcome/index.json": "93d132db2005aeb2ce1745eb556e61e85aeb2ab9f576369267fa3cb493d4b699",
  "pages/activities/index.wxml": "4f6e48a7c6633f04afb103e649e6989ca930b126ccb964d4d3dade248e91dd5b",
  "pages/activities/index.wxss": "ac7fcf82d5b941e824012c66810910ed03cbdfa89cfb4b6c26dff3ae9d291b8b",
  "pages/activities/index.json": "ee29d7e47ea708cc023368fa9d84276ce47ea7ae8ec888d33f674227cd03a571",
  "subpkg/activity/pages/detail/index.wxml": "751cc747e84535ef28b65b60a4d292cb74e8a96b78fd9d7da759a8cbb7691572",
  "subpkg/activity/pages/detail/index.wxss": "77565586c38e11f5049c38ffbdd42797893095910062809e5bd950e14f8d5fa0",
  "subpkg/activity/pages/enrollments/index.wxml": "dc8a73aa623ab787f645899764e458ce32a2b5bf16caf0d07b0a534190f98f6d",
  "subpkg/activity/pages/enrollments/index.wxss": "4ef4ad3ad7366e041d0cbfc6bdf06ffbc6bc7849a1fd291fc710d2ff3544d03f",
  "pages/login/index.wxml": "6784bc99cdff14d6e7691c774a978a6006fe220035d368f10eec46cee16361c3",
  "pages/login/index.wxss": "0f1e5044abe90631bcdd368f0071747fbe3171f820407b9c7829814d1807a59d",
  "pages/register/index.wxml": "12c7f23ba35a4aecb2f76a25c11bccbbf19c05d97a5a94de6c0c021e688a4aec",
  "pages/register/index.wxss": "6314aa4690af35c7e324aee267f1099ffc08a77c7ad49fbe795074a0b19fd59d",
  "pages/profile/index.wxml": "7f318983c06ef428557a552982e9f99f227d955d876808932e034d76913be28e",
  "pages/profile/index.wxss": "1306d9bb48ec54fef94e93498f8f7bfd4d2d7ad5d82baa715f3c17c1f24306b7",
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

console.log("v0.7.2 protected page regression checks passed");
