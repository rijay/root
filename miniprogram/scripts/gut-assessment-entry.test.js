const assert = require("node:assert/strict");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key) || "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
};

const entry = require("../utils/gut-assessment-entry");

assert.equal(
  entry.FIXED_GUT_ASSESSMENT_PATH,
  "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY"
);
assert.equal(entry.GUT_INTRO_PATH, "/subpkg/campaign/pages/root-with-you/index");
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY" }, 1000), true);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "INITIAL" }, 1000), false);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY", assessmentId: "gut_001" }, 1000), false);

entry.rememberContinuation(1000);
assert.equal(entry.readContinuation(1001), true);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY" }, 1001), false);
assert.equal(entry.readContinuation(1000 + 10 * 60 * 1000 + 1), false);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY" }, 1000 + 10 * 60 * 1000 + 1), true);

entry.rememberContinuation(2000);
entry.clearContinuation();
assert.equal(entry.readContinuation(2001), false);

delete global.wx;
console.log("gut assessment fixed-entry tests passed");
