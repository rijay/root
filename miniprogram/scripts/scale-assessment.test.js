const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("app.json"));
const routes = require("../config/formal-launch-routes");
const healthPackage = app.subPackages.find((item) => item.root === "subpkg/health");
const healthScript = read("pages/health/index.js");
const healthView = read("pages/health/index.wxml");

assert.equal(healthPackage.pages.includes("pages/scale-assessment/index"), false);
assert.equal(routes.REGISTERED_FORMAL_ROUTES.includes("subpkg/health/pages/scale-assessment/index"), false);
assert.doesNotMatch(healthScript, /openRecommendedScale|scaleVersionId/);
assert.doesNotMatch(healthView, /bindtap="openRecommendedScale"/);
assert.match(healthScript, /getCatalog/);

console.log("legacy scale assessment is excluded from v0.6.0");
