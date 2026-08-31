const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../subpkg/health/pages/assessment/index.js"), "utf8");

assert.match(source, /createDraftSyncQueue/);
assert.match(source, /started\.assessment[\s\S]*this\.hydrate\(started\.assessment\)/);
assert.match(source, /currentQuestion\.saveBarrier/);
assert.match(source, /queueDraftSnapshot\(\);[\s\S]*advanceQuestion\(\);/);
assert.doesNotMatch(source, /const saved = await this\.persistDraft\(true\);[\s\S]*currentIndex: this\.data\.currentIndex \+ 1/);
assert.match(source, /isFinalQuestion[\s\S]*await this\.finish\(\)/);

console.log("assessment performance contract tests passed");
