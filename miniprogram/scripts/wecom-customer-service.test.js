const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const supportPath = path.join(root, "subpkg/profile/pages/support/index.js");
let pageDefinition;
let invocation;
let toast;

global.Page = (definition) => {
  pageDefinition = definition;
};
global.wx = {
  openCustomerServiceChat(options) {
    invocation = options;
    options.success();
    options.complete();
  },
  showToast(options) {
    toast = options;
  },
};

require(supportPath);

function createPage() {
  return {
    data: { ...pageDefinition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

const successPage = createPage();
pageDefinition.openWeComCustomerService.call(successPage);
assert.equal(invocation.corpId, "ww4c7f2598188d97db");
assert.deepEqual(invocation.extInfo, {
  url: "https://work.weixin.qq.com/kfid/kfc9a886fb6a493c66b",
});
assert.equal(successPage.data.openingCustomerService, false);
assert.equal(successPage.data.showNativeContactFallback, false);

global.wx.openCustomerServiceChat = (options) => {
  options.fail({ errMsg: "openCustomerServiceChat:fail test" });
  options.complete();
};
const originalWarn = console.warn;
console.warn = () => {};
const failurePage = createPage();
pageDefinition.openWeComCustomerService.call(failurePage);
console.warn = originalWarn;
assert.equal(failurePage.data.openingCustomerService, false);
assert.equal(failurePage.data.showNativeContactFallback, true);
assert.equal(toast.title, "企微客服暂未打开，请使用微信客服");

delete global.wx.openCustomerServiceChat;
const unavailablePage = createPage();
pageDefinition.openWeComCustomerService.call(unavailablePage);
assert.equal(unavailablePage.data.showNativeContactFallback, true);
assert.equal(toast.title, "企微客服暂不可用，请使用微信客服");

delete global.Page;
delete global.wx;

console.log("wecom customer service tests ok");
