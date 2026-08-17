const assert = require("node:assert/strict");

global.wx = {
  getStorageSync() {
    return "";
  },
  showShareMenu() {},
  hideShareMenu() {},
};

const {
  GENERIC_PATH,
  buildShareCard,
  installGlobalSharePolicy,
} = require("../utils/page-share");

const product = buildShareCard("pages/product-detail/index", {
  productId: "4749049439",
  channelId: "must-not-share",
}, {
  title: "ROOT 每日衡养",
  path: "/unsafe?openid=private",
});
assert.equal(product.path, "/pages/product-detail/index?productId=4749049439");
assert.equal(product.title, "ROOT 每日衡养");
assert.equal(JSON.stringify(product).includes("private"), false);

const sensitive = buildShareCard("/subpkg/health/pages/result/index", {
  assessmentId: "personal-result",
}, {
  title: "我的评测结果",
  imageUrl: "/tmp/personal.png",
});
assert.equal(sensitive.path, GENERIC_PATH);
assert.equal(JSON.stringify(sensitive).includes("personal"), false);

let registered = null;
const runtime = {
  Page(definition) {
    registered = definition;
    return definition;
  },
};
assert.equal(installGlobalSharePolicy(runtime), true);
runtime.Page({
  onLoad(options) {
    this.loadedProductId = options.productId;
  },
  onShareAppMessage() {
    return { title: "产品分享", path: "/wrong" };
  },
});
const page = { route: "pages/product-detail/index" };
registered.onLoad.call(page, { productId: "4875324599", signature: "a".repeat(64) });
assert.equal(page.loadedProductId, "4875324599");
assert.deepEqual(registered.onShareAppMessage.call(page), {
  title: "产品分享",
  path: "/pages/product-detail/index?productId=4875324599",
});
assert.equal(installGlobalSharePolicy(runtime), false);

delete global.wx;
console.log("page share tests passed");
