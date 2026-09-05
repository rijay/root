const assert = require("node:assert/strict");

const calls = [];
global.getApp = () => ({ globalData: {} });
global.wx = {
  navigateToMiniProgram(options) {
    calls.push(options);
  },
  switchTab(options) {
    calls.push(options);
  },
  navigateTo(options) {
    calls.push(options);
  },
  showToast() {},
};

const { executeContentAction } = require("../utils/content-action");

(async () => {
  const shortLink = "#小程序://ROOT会员中心/BTsqrmF8skMJwlv";
  assert.equal(await executeContentAction({ type: "ROOT_MEMBER_CENTER", shortLink }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shortLink, shortLink);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0], "path"), false);

  const trialShortLink = "#小程序://ROOT会员商城/n3slzlsfIydORAd";
  assert.equal(await executeContentAction({ type: "ROOT_MEMBER_CENTER", shortLink: trialShortLink }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].shortLink, trialShortLink);

  assert.equal(await executeContentAction({
    type: "ROOT_MEMBER_CENTER",
    appId: "wxfb75c0b432670215",
    path: "pages/home/index",
  }), true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].appId, "wxfb75c0b432670215");
  assert.equal(calls[2].path, "pages/home/index");

  assert.equal(await executeContentAction({
    type: "ROOT_MEMBER_CENTER",
    shortLink: "#小程序://其他会员中心/BTsqrmF8skMJwlv",
  }), false);
  assert.equal(calls.length, 3);

  assert.equal(await executeContentAction({
    type: "PRODUCTS",
    productId: "4875324599",
    source: "home_banner",
  }), true);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], { url: "/pages/products/index" });

  assert.equal(await executeContentAction({
    type: "MINIPROGRAM_PAGE",
    path: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY",
  }), true);
  assert.deepEqual(calls[4], {
    url: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY",
  });

  console.log("content action tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
