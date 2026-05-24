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

if (missing.length) {
  console.error(`Missing files:\\n${missing.join("\\n")}`);
  process.exit(1);
}

console.log("miniprogram validation ok");
