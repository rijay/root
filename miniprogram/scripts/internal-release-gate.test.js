const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const removedLocalActivityFiles = [
  "utils/local-test-activity.js",
  "scripts/local-test-activity.test.js",
];

removedLocalActivityFiles.forEach((relativePath) => {
  assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} must not ship`);
});

const activityListScript = read("pages/activities/index.js");
const activityDetailScript = read("subpkg/activity/pages/detail/index.js");
const activityReleaseSurface = `${activityListScript}\n${activityDetailScript}`;

assert.doesNotMatch(activityReleaseSurface, /local-test-activity|activity_preview_202609|ROOT_LOCAL_SEPTEMBER_ACTIVITY_V1|testOnly/);
assert.match(activityListScript, /presentActivityList\(payload\)/);
assert.match(activityListScript, /state:\s*"error"/);
assert.match(activityDetailScript, /\/api\/v1\/activities\/detail/);
assert.match(activityDetailScript, /\/api\/v1\/activities\/enroll/);
assert.match(activityDetailScript, /\/api\/v1\/activities\/cancel/);

const resultWxml = read("subpkg/health/pages/result/index.wxml");
const resultWxss = read("subpkg/health/pages/result/index.wxss");
const campaignWxml = read("subpkg/campaign/pages/root-with-you/index.wxml");
const runtimeEnv = read("config/env.js");
const trialPackSurface = `${resultWxml}\n${campaignWxml}`;

assert.match(resultWxml, /前往领取 5 支体验装/);
assert.match(resultWxss, /button\.result-trial-action\s*\{[^}]*width:\s*100%\s*!important/s);
assert.match(resultWxss, /button\.result-trial-action\s*\{[^}]*height:\s*96rpx/s);
assert.match(resultWxss, /button\.result-trial-action\s*\{[^}]*white-space:\s*nowrap/s);
assert.match(trialPackSurface, /体验装已上架，库存有限，领完即止/);
assert.doesNotMatch(trialPackSurface, /领取资格、库存与购买状态/);
assert.match(runtimeEnv, /#小程序:\/\/ROOT会员商城\/n3slzlsfIydORAd/);

console.log("internal release gate: activity and trial-pack contracts PASS");
