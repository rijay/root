const assert = require("node:assert/strict");

const entry = require("../utils/gut-assessment-entry");

assert.equal(
  entry.FIXED_GUT_ASSESSMENT_PATH,
  "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY"
);
assert.equal(entry.GUT_INTRO_PATH, "/subpkg/campaign/pages/root-with-you/index");
assert.equal(entry.GUT_INTRO_SOURCE, "campaign");
assert.equal(entry.DEFAULT_EXTERNAL_ASSESSMENT_TYPE, "GUT_REGULARITY");
assert.equal(
  entry.GUT_ASSESSMENT_CONTINUE_PATH,
  "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY&source=campaign"
);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY" }), true);
assert.equal(entry.shouldRedirectToIntro({}), true, "历史无参扫码 path 必须进入肠道自测前置图");
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "INITIAL" }), false);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY", assessmentId: "gut_001" }), false);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY", source: "campaign" }), false);
assert.equal(entry.shouldRedirectToIntro({ assessmentType: "GUT_REGULARITY", source: "unknown" }), true);
assert.equal(
  entry.assessmentGuardPath({}),
  entry.FIXED_GUT_ASSESSMENT_PATH
);
assert.equal(
  entry.assessmentGuardPath({ assessmentType: "GUT_REGULARITY", source: "campaign" }),
  "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY&source=campaign"
);
assert.equal(
  entry.assessmentGuardPath({ assessmentType: "GUT_REGULARITY" }),
  entry.FIXED_GUT_ASSESSMENT_PATH
);
assert.equal(
  entry.assessmentGuardPath({ assessmentType: "INITIAL", source: "campaign" }),
  "/subpkg/health/pages/assessment/index?assessmentType=INITIAL"
);
assert.equal(entry.assessmentTypeFromOptions({ assessmentType: "INITIAL" }), "INITIAL");
assert.equal(
  entry.assessmentGuardPath({ assessmentId: "gut 001" }),
  "/subpkg/health/pages/assessment/index?assessmentId=gut%20001"
);

console.log("gut assessment fixed-entry tests passed");
