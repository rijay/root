const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
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
  "static/brand/splash.png",
  "static/banner/activity.png",
  "static/badge/complete.png",
  "static/empty/no-record.png",
  "static/empty/no-order.png",
  "static/tabbar/home.png",
  "static/tabbar/home_active.png",
  "static/tabbar/profile.png",
  "static/tabbar/profile_active.png",
  "static/celebration/confetti.png",
  "static/icon/checkin.png",
  "static/icon/refund.png",
  "static/icon/shop.png",
].forEach((asset) => {
  if (!fs.existsSync(path.join(root, asset))) missing.push(path.join(root, asset));
});

for (let index = 1; index <= 7; index += 1) {
  ["static/stool", "static/badge"].forEach((dir) => {
    const name = dir.includes("stool") ? `type${index}.png` : `day${index}.png`;
    if (!fs.existsSync(path.join(root, dir, name))) missing.push(path.join(root, dir, name));
  });
}

require("../utils/options.js");
require("../utils/router.js");
const {
  formatDateCn,
  formatDateRangeCn,
  formatDateTimeCn,
  formatRelativeDateCn,
} = require("../utils/date-display.js");
require("../utils/option-labels.js");
require("../utils/checkin-presenter.js");
require("../utils/share-poster.js");

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
];
const copyProblems = [];

scannedPages.forEach((pagePath) => {
  ["js", "wxml"].forEach((ext) => {
    const file = path.join(root, `${pagePath}.${ext}`);
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    disallowedCopy.forEach((phrase) => {
      if (content.includes(phrase)) copyProblems.push(`${file}: contains ${phrase}`);
    });
  });
});

if (missing.length) {
  console.error(`Missing files:\\n${missing.join("\\n")}`);
  process.exit(1);
}

if (copyProblems.length) {
  console.error(`Disallowed user-facing copy:\\n${copyProblems.join("\\n")}`);
  process.exit(1);
}

console.log("miniprogram validation ok");
