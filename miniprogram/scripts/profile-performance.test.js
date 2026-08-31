const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
const app = read("app.js");
const page = read("pages/profile/index.js");
const view = read("pages/profile/index.wxml");
const request = read("utils/request.js");

assert.match(app, /prewarmMemberCommerceSummary/);
assert.match(app, /prewarmSessionImage/);
assert.match(page, /readMemberCommerceSummaryEntry/);
assert.match(page, /if \(!cached \|\| !cached\.fresh\) this\.loadProfile/);
assert.match(page, /if \(!memberCommerceEntry \|\| !memberCommerceEntry\.fresh\) this\.loadMemberCommerce/);
assert.match(page, /cachedImageUrl/);
assert.match(page, /durationMs: Date\.now\(\) - this\._avatarStartedAt/);
assert.match(view, /src="\{\{profile\.displayAvatarUrl\}\}"/);
assert.match(request, /clearMemberCommerceCache\(\)/);

console.log("profile performance contract tests passed");
