const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("app.json"));
const script = read("subpkg/health/pages/scale-assessment/index.js");
const view = read("subpkg/health/pages/scale-assessment/index.wxml");
const healthScript = read("pages/health/index.js");
const healthView = read("pages/health/index.wxml");

assert.ok(app.subPackages.some((item) => item.root === "subpkg/health" && item.pages.includes("pages/scale-assessment/index")));
assert.match(script, /\/api\/v1\/health\/root4u\/scales\/\$\{this\.scaleVersionId\}\?group=/);
assert.match(script, /responses\/latest/);
assert.match(script, /idempotencyKey/);
assert.match(script, /this\.answers/);
assert.doesNotMatch(script.slice(script.indexOf("data: {"), script.indexOf("onLoad")), /answers\s*:/);
assert.doesNotMatch(script.slice(script.indexOf("data: {"), script.indexOf("onLoad")), /definition\s*:/);
assert.match(script, /this\.definition/);
assert.match(script, /this\.questionGroups/);
assert.match(view, /评测结果/);
assert.match(view, /结果用于整理日常状态/);
assert.match(healthScript, /openRecommendedScale/);
assert.match(healthScript, /latestResult/);
assert.match(healthScript, /已完成 · 查看结果/);
assert.match(healthView, /bindtap="openRecommendedScale"/);

console.log("scale assessment checks passed");
