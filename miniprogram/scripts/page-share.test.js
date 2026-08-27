const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let shown = 0;
let hidden = 0;
let lastShareMenuOptions = null;
global.wx = {
  getStorageSync() {
    return "";
  },
  showShareMenu(options) {
    shown += 1;
    lastShareMenuOptions = options;
  },
  hideShareMenu() { hidden += 1; },
};

const {
  GENERIC_PATH,
  buildShareCard,
  defaultOnShareAppMessage,
  installGlobalSharePolicy,
  showFriendShareMenu,
} = require("../utils/page-share");

assert.equal(showFriendShareMenu(), true);
assert.equal(shown, 1);
assert.equal(lastShareMenuOptions.withShareTicket, false);
assert.deepEqual(lastShareMenuOptions.menus, ["shareAppMessage"]);
assert.equal(typeof lastShareMenuOptions.success, "function");
assert.equal(typeof lastShareMenuOptions.fail, "function");

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

const content = buildShareCard("/subpkg/content/pages/detail/index", {
  contentId: "root_daily_01",
  token: "must-not-share",
}, { title: "ROOT 内容" });
assert.equal(content.path, "/subpkg/content/pages/detail/index?contentId=root_daily_01");

const phggReference = buildShareCard("/subpkg/content/pages/phgg-reference/index", {
  token: "must-not-share",
}, { title: "PHGG 原料科学档案" });
assert.equal(phggReference.path, "/subpkg/content/pages/phgg-reference/index");
assert.equal(JSON.stringify(phggReference).includes("must-not-share"), false);

const gutAssessment = buildShareCard("/subpkg/health/pages/assessment/index", {
  assessmentType: "GUT_REGULARITY",
  assessmentId: "must-not-share",
}, { title: "ROOT 肠道自测" });
assert.equal(gutAssessment.path, "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY");
assert.equal(JSON.stringify(gutAssessment).includes("must-not-share"), false);

assert.deepEqual(defaultOnShareAppMessage.call({
  route: "subpkg/campaign/pages/root-with-you/index",
  options: {},
}), {
  title: "ROOT｜身体，自有其序",
  path: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY",
});

assert.deepEqual(defaultOnShareAppMessage.call({ route: "pages/profile/index", options: {} }), {
  title: "ROOT｜身体，自有其序",
  path: "/pages/home/index",
});

const sensitive = buildShareCard("/subpkg/health/pages/result/index", {
  assessmentId: "personal-result",
}, {
  title: "我的评测结果",
  imageUrl: "/tmp/personal.png",
});
assert.equal(sensitive.path, GENERIC_PATH);
assert.equal(JSON.stringify(sensitive).includes("personal"), false);

let registered = null;
let originalShows = 0;
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
  onShow() {
    originalShows += 1;
  },
  onShareAppMessage() {
    return { title: "产品分享", path: "/wrong" };
  },
});
const page = { route: "pages/product-detail/index" };
registered.onLoad.call(page, { productId: "4875324599", signature: "a".repeat(64) });
assert.equal(shown, 2);
assert.equal(page.loadedProductId, "4875324599");
registered.onShow.call(page);
assert.equal(originalShows, 1);
assert.equal(shown, 3);
assert.deepEqual(registered.onShareAppMessage.call(page), {
  title: "产品分享",
  path: "/pages/product-detail/index?productId=4875324599",
});
assert.equal(installGlobalSharePolicy(runtime), false);

runtime.Page({});
const welcomePage = { route: "pages/welcome/index" };
registered.onLoad.call(welcomePage, {});
assert.equal(hidden, 1);
registered.onShow.call(welcomePage);
assert.equal(hidden, 2);

registered.onShow.call({ route: "subpkg/content/pages/phgg-reference/index" });
assert.equal(shown, 4, "public page onShow must restore sharing after a hidden-share page");

const root = path.resolve(__dirname, "..");
const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const registeredPages = [
  ...appConfig.pages,
  ...appConfig.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
].filter((route) => route !== "pages/welcome/index");
registeredPages.forEach((route) => {
  const source = fs.readFileSync(path.join(root, `${route}.js`), "utf8");
  assert.match(source, /onShareAppMessage/, `${route} must explicitly register onShareAppMessage`);
});

delete global.wx;
console.log("page share tests passed");
