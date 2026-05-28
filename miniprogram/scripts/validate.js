const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
const privateConfigPath = path.join(root, "project.private.config.json");
const privateConfig = fs.existsSync(privateConfigPath)
  ? JSON.parse(fs.readFileSync(privateConfigPath, "utf8"))
  : null;
const requiredExts = ["js", "json", "wxml", "wxss"];
const missing = [];

function checkPage(pagePath) {
  requiredExts.forEach((ext) => {
    const file = path.join(root, `${pagePath}.${ext}`);
    if (!fs.existsSync(file)) missing.push(file);
  });
}

app.pages.forEach(checkPage);
(app.subPackages || []).forEach((pkg) => {
  pkg.pages.forEach((page) => checkPage(path.join(pkg.root, page)));
});

[
  "static/brand/logo.png",
  "static/banner/activity.png",
  "static/badge/complete.png",
  "static/tabbar/home.png",
  "static/tabbar/home_active.png",
  "static/tabbar/profile.png",
  "static/tabbar/profile_active.png",
  "static/icon/checkin.png",
  "static/icon/refund.png",
  "static/icon/shop.png",
].forEach((asset) => {
  if (!fs.existsSync(path.join(root, asset))) missing.push(path.join(root, asset));
});

for (let index = 1; index <= 7; index += 1) {
  const name = `type${index}.png`;
  if (!fs.existsSync(path.join(root, "static/stool", name))) missing.push(path.join(root, "static/stool", name));
}

require("../utils/options.js");
require("../utils/router.js");
require("../utils/legal.js");
const runtimeEnv = require("../config/env.js");
const {
  formatDateCn,
  formatDateRangeCn,
  formatDateTimeCn,
  formatRelativeDateCn,
} = require("../utils/date-display.js");
require("../utils/option-labels.js");
require("../utils/checkin-presenter.js");
require("../subpkg/checkin/utils/share-poster.js");

const dateChecks = [
  [formatDateCn("2026-05-24", { referenceYear: 2026 }), "5月24日"],
  [formatDateCn("2025-05-24", { referenceYear: 2026 }), "2025年5月24日"],
  [formatDateRangeCn("2026-05-20", "2026-05-26", { referenceYear: 2026 }), "5月20日 至 5月26日"],
  [formatRelativeDateCn("2026-05-24", "2026-05-24"), "今天 · 5月24日"],
  [formatRelativeDateCn("2025-12-31", "2026-01-01"), "昨天 · 2025年12月31日"],
  [formatDateTimeCn("2026-05-24T09:08:00+08:00", { referenceYear: 2026 }), "5月24日 09:08"],
];

dateChecks.forEach(([actual, expected]) => {
  if (actual !== expected) {
    console.error(`Date display check failed: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
});

const scannedPages = app.pages.concat(
  (app.subPackages || []).flatMap((pkg) => pkg.pages.map((page) => path.join(pkg.root, page)))
);
const disallowedCopy = [
  "自动发布朋友圈",
  "一键发布小红书",
  "治好",
  "立刻改善",
  "开发调试登录",
  "调试模式使用演示手机号",
  "dev_phone_code",
  "dev_wx_code",
  "useMockPhone",
  "allowMockPhoneLogin",
  "微信授权并开始",
  "微信授权登录",
];
const copyProblems = [];
const nativeControlProblems = [];
const networkProblems = [];

if (runtimeEnv.requestAdapter !== "cloudContainer") {
  networkProblems.push(`config/env.js: default requestAdapter must be cloudContainer, got ${runtimeEnv.requestAdapter}`);
}
if (!runtimeEnv.cloudEnvId || !runtimeEnv.cloudServiceName) {
  networkProblems.push("config/env.js: cloudEnvId and cloudServiceName are required for wx.cloud.callContainer");
}
if (projectConfig.setting && projectConfig.setting.urlCheck !== true) {
  networkProblems.push("project.config.json: setting.urlCheck must be true before upload");
}
if (privateConfig && privateConfig.setting && privateConfig.setting.urlCheck === false) {
  networkProblems.push("project.private.config.json: setting.urlCheck must not disable domain checks");
}

scannedPages.forEach((pagePath) => {
  ["js", "wxml"].forEach((ext) => {
    const file = path.join(root, `${pagePath}.${ext}`);
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    disallowedCopy.forEach((phrase) => {
      if (content.includes(phrase)) copyProblems.push(`${file}: contains ${phrase}`);
    });
  });
});

scannedPages.forEach((pagePath) => {
  const file = path.join(root, `${pagePath}.wxml`);
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const buttonPattern = /<button\b[^>]*\bopen-type="[^"]+"[^>]*>/g;
  const layoutClassPattern = /\b(menu-row|avatar-picker|root-card|root-cell-group|display-profile-card)\b/;
  const matches = content.match(buttonPattern) || [];
  matches.forEach((tag) => {
    const classMatch = tag.match(/\bclass="([^"]*)"/);
    const className = classMatch ? classMatch[1] : "";
    if (/\bhitarea\b/.test(className)) return;
    if (layoutClassPattern.test(className)) {
      nativeControlProblems.push(`${file}: native open-type button must not own layout class "${className}"`);
    }
  });
});

const homeLogin = fs.readFileSync(path.join(root, "pages/home/index.wxml"), "utf8");
const standaloneLogin = fs.readFileSync(path.join(root, "pages/login/index.wxml"), "utf8");
[
  ["pages/home/index.wxml", homeLogin],
  ["pages/login/index.wxml", standaloneLogin],
].forEach(([file, content]) => {
  if (!content.includes("手机号快捷登录")) {
    copyProblems.push(`${path.join(root, file)}: missing 手机号快捷登录 copy`);
  }
  if (!content.includes("openPrivacyPolicy")) {
    copyProblems.push(`${path.join(root, file)}: privacy policy link is not wired`);
  }
});

if (missing.length) {
  console.error(`Missing files:\\n${missing.join("\\n")}`);
  process.exit(1);
}

if (copyProblems.length) {
  console.error(`Disallowed user-facing copy:\\n${copyProblems.join("\\n")}`);
  process.exit(1);
}

if (nativeControlProblems.length) {
  console.error(`Native control layout risks:\\n${nativeControlProblems.join("\\n")}`);
  process.exit(1);
}

if (networkProblems.length) {
  console.error(`Network config risks:\\n${networkProblems.join("\\n")}`);
  process.exit(1);
}

console.log("miniprogram validation ok");
