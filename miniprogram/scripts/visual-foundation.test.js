const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
assert.match(welcomeWxml, /<immersive-header tone="light"/);
assert.match(welcomeWxml, /data-release-asset="DEVELOPMENT_PLACEHOLDER"/);
assert.match(welcomeWxml, /欢迎加入/);
assert.match(welcomeWxml, /Root Member Club/);
assert.match(welcomeWxml, /Sustained Foundation Balance/);
assert.match(welcomeWxml, /平衡不是控制，而是理解。/);
assert.match(welcomeWxml, /帮你把身体还给身体自己。/);

const welcomeScript = read("pages/welcome/index.js");
assert.doesNotMatch(welcomeScript, /request\(|login|health/i);
assert.match(welcomeScript, /WELCOME_STORAGE_KEY/);

const adminTheme = fs.readFileSync(path.resolve(root, "..", "admin/src/styles/theme.css"), "utf8");
assert.match(adminTheme.toLowerCase(), /--root-ink:\s*#080806/);
assert.match(adminTheme.toLowerCase(), /--root-moss:\s*#586b3f/);
assert.match(adminTheme.toLowerCase(), /--root-page-padding:\s*16px/);

console.log("visual foundation tests ok");
