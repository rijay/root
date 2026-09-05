const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const launching = require("../utils/launching-entry");

assert.deepEqual(launching.resolveEntryTarget({ path: "pages/welcome/index" }, [
  { route: "pages/welcome/index", options: {} },
]), { route: "/pages/home/index", options: {} });

assert.deepEqual(launching.resolveEntryTarget({ path: "pages/product-detail/index", query: {
  productId: "4749049439",
  channelId: "must-not-follow-target",
} }, []), {
  route: "/pages/product-detail/index",
  options: { productId: "4749049439" },
});

assert.deepEqual(launching.resolveEntryTarget({
  __rootChannelEntry: true,
  path: "subpkg/campaign/pages/root-with-you/index",
  query: { q: "z6gry3rf", answers: "must-not-follow-target" },
}, []), {
  route: "/subpkg/campaign/pages/root-with-you/index",
  options: { q: "Z6GRY3RF" },
});
assert.equal(launching.serializeTarget({
  route: "/subpkg/campaign/pages/root-with-you/index",
  options: { q: "1A2OGWPR", token: "must-not-follow-target" },
}), "/subpkg/campaign/pages/root-with-you/index?q=1A2OGWPR");
assert.deepEqual(launching.sanitizeOptions(
  "/subpkg/campaign/pages/root-with-you/index",
  { q: "invalid-code!" },
), {});

const gutRoute = "/subpkg/campaign/pages/root-with-you/index";
const scannedEntry = {
  __rootChannelEntry: true,
  path: gutRoute.slice(1),
  scene: 1048,
  query: { q: "BVHTPDEV", token: "must-not-follow-target" },
};
for (const oldOptions of [{ q: "JSVFNCAG" }, { scene: "q%3DJSVFNCAG" }, {}]) {
  assert.deepEqual(launching.resolveEntryTarget(scannedEntry, [
    { route: gutRoute.slice(1), options: oldOptions },
  ]), { route: gutRoute, options: { q: "BVHTPDEV" } }, "同页扫码必须使用本次渠道参数");
}

for (const currentRoute of ["", "pages/home/index", gutRoute.slice(1),
  "subpkg/health/pages/assessment/index", "pages/welcome/index"]) {
  for (const alreadyHandled of [false, true]) {
    const scannedApp = { globalData: {
      launchingHandledThisSession: alreadyHandled,
      launchingTarget: { route: gutRoute, options: { q: "JSVFNCAG" } },
    } };
    const scanned = launching.prepareLaunchingEntry(scannedApp, scannedEntry,
      currentRoute ? [{ route: currentRoute, options: { q: "JSVFNCAG" } }] : []);
    assert.deepEqual(scanned, {
      relaunch: false,
      navigateDirect: true,
      target: { route: gutRoute, options: { q: "BVHTPDEV" } },
      reason: "CHANNEL_ENTRY_DIRECT",
    }, `渠道扫码必须直达，不受当前页面或会话标记影响：${currentRoute || "empty"}`);
    assert.equal(scannedApp.globalData.launchingHandledThisSession, true);
    assert.equal(scannedApp.globalData.launchingTarget, undefined, "不得保留上一次启动目标");
  }
}

for (const scene of [1001, 1089, undefined]) {
  const resumed = launching.prepareLaunchingEntry(
    { globalData: { launchingHandledThisSession: true } },
    { ...scannedEntry, scene },
    [{ route: "subpkg/health/pages/assessment/index", options: { assessmentId: "in-progress" } }],
  );
  assert.equal(resumed.relaunch, false, "普通回前台不得因残留渠道参数中断答题");
  assert.equal(resumed.navigateDirect, false);
  assert.equal(resumed.reason, "SESSION_ALREADY_HANDLED");
}

for (const options of [
  { path: gutRoute.slice(1), query: { q: "BVHTPDEV" } },
  { __rootChannelEntry: true, path: gutRoute.slice(1), query: {} },
  { __rootChannelEntry: true, path: gutRoute.slice(1), query: { q: "invalid-code!" } },
]) {
  const ordinary = launching.prepareLaunchingEntry({ globalData: {} }, options, []);
  assert.equal(ordinary.relaunch, true, "非有效渠道入口保留普通启动策略");
  assert.equal(ordinary.navigateDirect, false);
}

const app = { globalData: {} };
const entry = launching.prepareLaunchingEntry(app, {}, [
  { route: "pages/products/index", options: { productId: "4875324599", source: "member_return" } },
]);
assert.equal(entry.relaunch, true);
assert.equal(entry.reason, "FIRST_SESSION_ENTRY");
assert.equal(app.globalData.launchingHandledThisSession, true);
assert.equal(app.globalData.launchingTarget.route, "/pages/products/index");
assert.deepEqual(launching.consumeLaunchingTarget(app), entry.target);
assert.equal(app.globalData.launchingTarget, undefined);

const repeatedApp = { globalData: {} };
const firstEntry = launching.prepareLaunchingEntry(repeatedApp, {}, [
  { route: "pages/products/index", options: { productId: "4749049439" } },
]);
const resumedEntry = launching.prepareLaunchingEntry(repeatedApp, {}, [
  { route: "subpkg/health/pages/assessment/index", options: { assessmentId: "assessment-1" } },
]);
assert.equal(firstEntry.relaunch, true);
assert.equal(resumedEntry.relaunch, false);
assert.equal(resumedEntry.navigateDirect, false);
assert.equal(resumedEntry.reason, "SESSION_ALREADY_HANDLED");
assert.equal(repeatedApp.globalData.launchingTarget.route, "/pages/products/index", "重复 onShow 不得覆盖首次恢复目标");

const assessmentApp = { globalData: {} };
const assessmentEntry = launching.prepareLaunchingEntry(assessmentApp, {
  path: "subpkg/health/pages/assessment/index",
  query: { assessmentType: "GUT_REGULARITY" },
}, [{ route: "subpkg/health/pages/assessment/index", options: { assessmentType: "GUT_REGULARITY" } }]);
assert.equal(assessmentEntry.relaunch, false);
assert.equal(assessmentEntry.navigateDirect, false);
assert.equal(assessmentEntry.reason, "PROTECTED_ROUTE_BYPASS");
assert.equal(assessmentApp.globalData.launchingHandledThisSession, true);
assert.equal(assessmentApp.globalData.launchingTarget, undefined);

const protectedDeepLinkApp = { globalData: {} };
const protectedDeepLink = launching.prepareLaunchingEntry(protectedDeepLinkApp, {
  path: "subpkg/health/pages/assessment/index",
  query: { assessmentType: "GUT_REGULARITY" },
}, [{ route: "pages/welcome/index", options: {} }]);
assert.equal(protectedDeepLink.relaunch, false);
assert.equal(protectedDeepLink.navigateDirect, true);
assert.equal(protectedDeepLink.target.route, "/subpkg/health/pages/assessment/index");

const naturalLaunchApp = { globalData: {} };
const naturalLaunch = launching.prepareLaunchingEntry(naturalLaunchApp, { path: "pages/welcome/index" }, [
  { route: "pages/welcome/index", options: {} },
]);
assert.equal(naturalLaunch.relaunch, false);
assert.equal(naturalLaunch.navigateDirect, false);
assert.equal(naturalLaunch.reason, "LAUNCHING_ALREADY_VISIBLE");
assert.equal(naturalLaunchApp.globalData.launchingTarget.route, "/pages/home/index");

const coldLaunchBeforePageReadyApp = { globalData: {} };
const coldLaunchBeforePageReady = launching.prepareLaunchingEntry(
  coldLaunchBeforePageReadyApp,
  { path: "pages/welcome/index" },
  [],
);
assert.equal(coldLaunchBeforePageReady.relaunch, false, "页面栈尚未建立时不得重复 reLaunch 欢迎页");
assert.equal(coldLaunchBeforePageReady.navigateDirect, false);
assert.equal(coldLaunchBeforePageReady.reason, "LAUNCHING_ALREADY_VISIBLE");
assert.equal(coldLaunchBeforePageReadyApp.globalData.launchingTarget.route, "/pages/home/index");

assert.deepEqual(launching.resolveEntryTarget({ path: "pages/unknown/index" }, []), {
  route: "/pages/home/index",
  options: {},
});
assert.equal(launching.serializeTarget({
  route: "/subpkg/health/pages/assessment/index",
  options: { assessmentType: "GUT_REGULARITY", answers: "private" },
}), "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY");

const appScript = fs.readFileSync(path.join(root, "app.js"), "utf8");
const welcomeScript = fs.readFileSync(path.join(root, "pages/welcome/index.js"), "utf8");
const welcomeWxml = fs.readFileSync(path.join(root, "pages/welcome/index.wxml"), "utf8");
assert.match(appScript, /prepareLaunchingEntry/);
assert.match(appScript, /wx\.reLaunch\(\{ url: "\/pages\/welcome\/index\?mode=launching" \}\)/);
assert.match(appScript, /entry\.navigateDirect/);
assert.match(appScript, /launchingHandledThisSession:\s*false/);
assert.doesNotMatch(welcomeScript, /LAUNCHING_DURATION_MS/);
assert.doesNotMatch(welcomeScript, /setTimeout\(\(\) => this\.enterTarget/);
assert.match(welcomeScript, /skipWelcome\(\)[\s\S]*this\.enterTarget\(\)/);
assert.match(welcomeScript, /consumeLaunchingTarget\(getApp\(\)\)/);
assert.match(welcomeWxml, /ROOT MEMBER CLUB/);
assert.doesNotMatch(welcomeWxml, /Sustained Foundation Balance/);
assert.doesNotMatch(welcomeWxml, /Root Member Club/);
assert.doesNotMatch(welcomeScript, /Root的使命/);

console.log("launching entry tests passed");
