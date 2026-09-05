const FIXED_GUT_ASSESSMENT_PATH = "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY";
const GUT_INTRO_PATH = "/subpkg/campaign/pages/root-with-you/index";
const GUT_INTRO_SOURCE = "campaign";
const GUT_ASSESSMENT_CONTINUE_PATH = `${FIXED_GUT_ASSESSMENT_PATH}&source=${GUT_INTRO_SOURCE}`;
const DEFAULT_EXTERNAL_ASSESSMENT_TYPE = "GUT_REGULARITY";

function assessmentTypeFromOptions(options = {}) {
  return String(
    options.assessmentType
    || options.assessment_type
    || DEFAULT_EXTERNAL_ASSESSMENT_TYPE
  ).trim();
}

function isFreshGutEntry(options = {}) {
  const assessmentType = assessmentTypeFromOptions(options);
  const assessmentId = String(options.assessmentId || options.assessment_id || "").trim();
  return assessmentType === "GUT_REGULARITY" && !assessmentId;
}

function isIntroContinuation(options = {}) {
  return String(options.source || "").trim() === GUT_INTRO_SOURCE;
}

function assessmentGuardPath(options = {}) {
  const assessmentType = assessmentTypeFromOptions(options);
  const assessmentId = String(options.assessmentId || options.assessment_id || "").trim();
  if (assessmentId) {
    return `/subpkg/health/pages/assessment/index?assessmentId=${encodeURIComponent(assessmentId)}`;
  }
  const source = assessmentType === "GUT_REGULARITY" && isIntroContinuation(options)
    ? `&source=${GUT_INTRO_SOURCE}`
    : "";
  return `/subpkg/health/pages/assessment/index?assessmentType=${encodeURIComponent(assessmentType)}${source}`;
}

function shouldRedirectToIntro(options = {}) {
  return isFreshGutEntry(options) && !isIntroContinuation(options);
}

module.exports = {
  DEFAULT_EXTERNAL_ASSESSMENT_TYPE,
  FIXED_GUT_ASSESSMENT_PATH,
  GUT_ASSESSMENT_CONTINUE_PATH,
  GUT_INTRO_PATH,
  GUT_INTRO_SOURCE,
  assessmentGuardPath,
  assessmentTypeFromOptions,
  isFreshGutEntry,
  isIntroContinuation,
  shouldRedirectToIntro,
};
