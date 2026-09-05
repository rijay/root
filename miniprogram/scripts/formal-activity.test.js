const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const listScript = read("pages/activities/index.js");
const feedCacheScript = read("utils/activity-feed-cache.js");
const listWxml = read("pages/activities/index.wxml");
const detailScript = read("subpkg/activity/pages/detail/index.js");
const detailJson = read("subpkg/activity/pages/detail/index.json");
const detailWxml = read("subpkg/activity/pages/detail/index.wxml");
const detailWxss = read("subpkg/activity/pages/detail/index.wxss");

assert.match(feedCacheScript, /\/api\/v1\/activities\?pageSize=20/);
assert.match(listScript, /presentActivityList/);
assert.match(listScript, /readActivityFeedCache/);
assert.match(feedCacheScript, /requestWithDeadline/);
assert.match(listScript, /listingState === "AVAILABLE"/);
assert.match(listScript, /routeGuard\("\/subpkg\/activity\/pages\/enrollments\/index"\)/);
assert.match(listScript, /我的报名/);
assert.match(listWxml, /activity-card--featured/);
assert.doesNotMatch(listWxml, /任务|积分|奖励/);

assert.match(detailScript, /fetchAuthoritativeDetail/);
assert.match(detailScript, /commandReachedAuthorityState/);
assert.match(detailJson, /page-navigation/);
assert.match(detailJson, /root-wordmark/);
assert.match(detailWxml, /detail-action-bar/);
assert.match(detailWxml, /action\.kind !== 'NONE'/);
assert.match(detailWxml, /\{\{action\.explanation\}\}/);
assert.match(detailWxml, /confirmSheetVisible/);
assert.match(detailWxml, /重复点击不会产生重复报名/);
assert.match(detailWxss, /position:\s*fixed/);
assert.match(detailWxss, /max-width:\s*375px/);

console.log("formal activity tests ok");
