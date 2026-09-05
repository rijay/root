const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
const app = read("app.js");
const page = read("pages/activities/index.js");
const view = read("pages/activities/index.wxml");

assert.match(app, /prewarmActivityFeed/);
assert.match(page, /readActivityFeedCache/);
assert.match(page, /loadActivityFeed/);
assert.match(page, /cachedImageUrl/);
assert.doesNotMatch(page, /readPublicPageCache|writePublicPageCache/);
assert.match(page, /entry: "activity_hero"/);
assert.match(page, /durationMs: Date\.now\(\) - startedAt/);
assert.match(view, /src="\{\{item\.displayHeroUrl\}\}"/);
assert.match(view, /bindload="activityImageLoaded"/);

console.log("activity performance contract tests passed");
