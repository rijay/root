const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const listWxml = read("pages/activities/index.wxml");
const listWxss = read("pages/activities/index.wxss");

assert.match(listWxml, /activity-card__compact-status/);
assert.match(listWxml, /activity-card__status--hero/);
assert.match(listWxss, /activity-head__title\s*\{[^}]*font-size:\s*30px/s);
assert.match(listWxss, /activity-page\s*\{[^}]*padding:\s*78px 20px 160px/s);
assert.match(listWxss, /activity-head__subtitle\s*\{[^}]*margin-top:\s*6px/s);
assert.match(listWxss, /activity-filters\s*\{[^}]*margin-top:\s*20px/s);
assert.match(listWxss, /activity-filter\s*\{[^}]*height:\s*34px/s);
assert.match(listWxss, /activity-filter\s*\{[^}]*margin-left:\s*0 !important/s);
assert.match(listWxss, /activity-list\s*\{[^}]*margin-top:\s*24px/s);
assert.match(listWxss, /activity-card\s*\{[^}]*width:\s*100%/s);
assert.match(listWxss, /activity-card--featured\s*\{[^}]*height:\s*390px/s);
assert.match(listWxss, /activity-card--featured \.activity-card__visual\s*\{[^}]*height:\s*238px/s);
assert.match(listWxss, /activity-card--compact\s*\{[^}]*height:\s*104px/s);
assert.match(listWxss, /activity-card--compact \.activity-card__visual\s*\{[^}]*width:\s*80px/s);
assert.match(listWxss, /activity-card \+ \.activity-card\s*\{[^}]*margin-top:\s*18px/s);

const detailWxml = read("subpkg/activity/pages/detail/index.wxml");
const detailWxss = read("subpkg/activity/pages/detail/index.wxss");

assert.match(detailWxml, /detail-first-screen/);
assert.match(detailWxml, /detail-lower-shade/);
assert.match(detailWxml, /detail-scroll-spacer/);
assert.match(detailWxml, /action\.kind === 'ENROLL' \? '暂不报名' : '暂不操作'/);
assert.match(detailWxss, /detail-first-screen\s*\{[^}]*min-height:\s*844px/s);
assert.match(detailWxss, /detail-hero\s*\{[^}]*height:\s*844px/s);
assert.match(detailWxss, /detail-hero__wordmark\s*\{[^}]*top:\s*132px/s);
assert.match(detailWxss, /detail-kicker\s*\{[^}]*top:\s*444px/s);
assert.match(detailWxss, /detail-title\s*\{[^}]*top:\s*478px/s);
assert.match(detailWxss, /detail-summary\s*\{[^}]*top:\s*532px/s);
assert.match(detailWxss, /detail-meta\s*\{[^}]*top:\s*602px/s);
assert.match(detailWxss, /detail-meta\s*\{[^}]*width:\s*calc\(100% - 48px\)/s);
assert.match(detailWxss, /detail-action-bar\s*\{[^}]*height:\s*100px/s);
assert.match(detailWxss, /detail-action-button\s*\{[^}]*width:\s*198px/s);
assert.match(detailWxss, /confirmation-sheet\s*\{[^}]*height:\s*500px/s);
assert.match(detailWxss, /sheet-tag\s*\{[^}]*top:\s*46px/s);
assert.match(detailWxss, /sheet-title\s*\{[^}]*top:\s*82px/s);
assert.match(detailWxss, /sheet-summary\s*\{[^}]*top:\s*138px/s);
assert.match(detailWxss, /sheet-notice\s*\{[^}]*top:\s*302px/s);
assert.match(detailWxss, /sheet-primary\s*\{[^}]*top:\s*370px/s);
assert.match(detailWxss, /sheet-secondary\s*\{[^}]*top:\s*442px/s);

console.log("activity high-fidelity contract: 36/36 PASS");
