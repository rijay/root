const assert = require("node:assert/strict");

const calls = [];
global.wx = {
  navigateToMiniProgram(options) {
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

  assert.equal(await executeContentAction({
    type: "ROOT_MEMBER_CENTER",
    appId: "wxfb75c0b432670215",
    path: "pages/home/index",
  }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].appId, "wxfb75c0b432670215");
  assert.equal(calls[1].path, "pages/home/index");

  assert.equal(await executeContentAction({
    type: "ROOT_MEMBER_CENTER",
    shortLink: "#小程序://其他会员中心/BTsqrmF8skMJwlv",
  }), false);
  assert.equal(calls.length, 2);

  console.log("content action tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
