const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertFiles(relativePaths) {
  relativePaths.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `视觉基础文件缺失：${relativePath}`);
  });
}

assertFiles([
  "styles/tokens.wxss",
  "components/root-wordmark/index.js",
  "components/root-wordmark/index.json",
  "components/root-wordmark/index.wxml",
  "components/root-wordmark/index.wxss",
  "components/immersive-header/index.js",
  "components/immersive-header/index.json",
  "components/immersive-header/index.wxml",
  "components/immersive-header/index.wxss",
]);

const tokens = read("styles/tokens.wxss");
[
  "--root-ink: #080806",
  "--root-bg: #f7f4ec",
  "--root-moss: #586b3f",
  "--root-sprout: #a6b77a",
  "--root-canvas-width: 390px",
  "--root-canvas-height: 844px",
  "--root-page-padding: 32rpx",
].forEach((token) => assert.match(tokens.toLowerCase(), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));

assert.match(read("app.wxss"), /@import "\.\/styles\/tokens\.wxss";/);
assert.match(read("components/page-navigation/index.wxss"), /flex:\s*0\s+0\s+40px/);
assert.match(read("components/page-navigation/index.wxml"), /wx:if="\{\{showHome\}\}"/);

const wordmarkWxml = read("components/root-wordmark/index.wxml");
const wordmarkWxss = read("components/root-wordmark/index.wxss");
assert.match(wordmarkWxml, /root-logo-horizontal-light\.png/);
assert.match(wordmarkWxml, /root-logo-horizontal\.png/);
assert.match(wordmarkWxss, /overflow:\s*hidden/);
assert.match(wordmarkWxss, /margin-left:\s*-28px/);
assert.doesNotMatch(wordmarkWxml, />\s*Root\s*</i, "不得用系统字体重构 Root 字标");

const welcomeJson = JSON.parse(read("pages/welcome/index.json"));
assert.equal(welcomeJson.usingComponents["immersive-header"], "/components/immersive-header/index");

const welcomeWxml = read("pages/welcome/index.wxml");
const welcomeWxss = read("pages/welcome/index.wxss");
assert.match(welcomeWxml, /<immersive-header tone="light"/);
assert.match(welcomeWxml, /data-release-asset="DEVELOPMENT_PLACEHOLDER"/);
assert.match(welcomeWxml, /欢迎加入/);
assert.match(welcomeWxml, /Root Member Club/);
assert.match(welcomeWxml, /Sustained Foundation Balance/);
assert.match(welcomeWxml, /平衡不是控制，而是理解。/);
assert.match(welcomeWxml, /帮你把身体还给身体自己。/);
assert.match(welcomeWxml, /welcome__dots--\{\{current\}\}/);
assert.match(welcomeWxss, /\.welcome__kicker\s*\{[^}]*line-height:\s*18px/s);
assert.match(welcomeWxss, /\.welcome__title\s*\{[^}]*min-height:\s*82px/s);
assert.match(welcomeWxss, /\.welcome__skip\s*\{[^}]*width:\s*42px[^}]*margin:\s*0/s);
assert.match(welcomeWxss, /\.welcome__skip\s*\{[^}]*bottom:\s*18px/s);
assert.match(welcomeWxss, /button\.welcome__skip\s*\{[^}]*width:\s*42px\s*!important/s);

const welcomeScript = read("pages/welcome/index.js");
assert.doesNotMatch(welcomeScript, /request\(|login|health/i);
assert.match(welcomeScript, /WELCOME_STORAGE_KEY/);

const homeJson = JSON.parse(read("pages/home/index.json"));
const homeWxml = read("pages/home/index.wxml");
const homeWxss = read("pages/home/index.wxss");
assert.equal(homeJson.usingComponents["immersive-header"], "/components/immersive-header/index");
assert.match(homeWxml, /<immersive-header tone="light"/);
assert.match(homeWxml, /data-release-asset="\{\{item\.assetState\}\}"/);
assert.doesNotMatch(homeWxml, /home-slide__placeholder/);
assert.match(homeWxss, /\.home-slide__copy\s*\{[^}]*bottom:\s*212rpx/s);
assert.match(homeWxss, /\.home-slide__kicker\s*\{[^}]*translateY\(-5px\)/s);
assert.match(homeWxss, /\.home-indicator\s*\{[^}]*bottom:\s*132px/s);

const tabWxml = read("custom-tab-bar/index.wxml");
const tabWxss = read("custom-tab-bar/index.wxss");
assert.match(tabWxml, /root-tab-bar__icon-image/);
assert.match(tabWxml, /selected === index \? item\.activeIcon : item\.icon/);
assert.match(tabWxss, /height:\s*84px/);
[
  "static/icons/tab-home.svg",
  "static/icons/tab-home-active.svg",
  "static/icons/tab-health.svg",
  "static/icons/tab-health-active.svg",
  "static/icons/tab-activity.svg",
  "static/icons/tab-activity-active.svg",
  "static/icons/tab-profile.svg",
  "static/icons/tab-profile-active.svg",
].forEach((icon) => assert.equal(fs.existsSync(path.join(root, icon)), true, `Tab 图标缺失：${icon}`));

const navigationWxml = read("components/page-navigation/index.wxml");
const navigationScript = read("components/page-navigation/index.js");
assert.match(navigationWxml, /style="top: \{\{top\}\}px;"/);
assert.match(navigationScript, /statusBarHeight/);
assert.match(navigationScript, /statusBarHeight \+ 19/);
assert.match(navigationScript, /Math\.min\(76, Math\.max\(52/);
assert.doesNotMatch(navigationScript, /capsule\.bottom \+ 22/);

function navigationTopFor(wxMock) {
  let definition = null;
  vm.runInNewContext(navigationScript, {
    Component(value) { definition = value; },
    getCurrentPages() { return []; },
    wx: wxMock,
  });
  let top = null;
  definition.lifetimes.attached.call({ setData(value) { top = value.top; } });
  return top;
}

assert.equal(navigationTopFor({ getWindowInfo: () => ({ statusBarHeight: 47 }) }), 66);
assert.equal(navigationTopFor({ getWindowInfo: () => ({ statusBarHeight: 20 }) }), 52);
assert.equal(navigationTopFor({ getWindowInfo: () => ({ statusBarHeight: 100 }) }), 76);
assert.equal(navigationTopFor({ getWindowInfo: () => { throw new Error("unavailable"); } }), 66);

const detailWxml = read("subpkg/content/pages/detail/index.wxml");
const detailWxss = read("subpkg/content/pages/detail/index.wxss");
assert.doesNotMatch(detailWxml, /content-detail__asset-state/);
assert.match(detailWxml, /不追求立竿见影的幻觉。/);
assert.match(detailWxss, /\.content-detail__wordmark\s*\{[^}]*top:\s*132px/s);
assert.match(detailWxss, /\.content-detail__kicker\s*\{[^}]*top:\s*500px/s);
assert.match(detailWxss, /\.content-detail__title\s*\{[^}]*top:\s*536px/s);
assert.match(detailWxss, /\.content-detail__body\s*\{[^}]*top:\s*636px/s);

const adminTheme = fs.readFileSync(path.resolve(root, "..", "admin/src/styles/theme.css"), "utf8");
assert.match(adminTheme.toLowerCase(), /--root-ink:\s*#080806/);
assert.match(adminTheme.toLowerCase(), /--root-moss:\s*#586b3f/);
assert.match(adminTheme.toLowerCase(), /--root-page-padding:\s*16px/);

console.log("visual foundation tests ok");
