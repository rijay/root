const FIXED_GUT_ASSESSMENT_PATH = "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY";
const GUT_INTRO_PATH = "/subpkg/campaign/pages/root-with-you/index";
const CONTINUE_STORAGE_KEY = "ROOT_GUT_INTRO_CONTINUE_V1";
const CONTINUE_TTL_MS = 10 * 60 * 1000;

function readContinuation(now = Date.now()) {
  const value = wx.getStorageSync(CONTINUE_STORAGE_KEY);
  if (!value || Number(value.expiresAt) <= now) {
    if (value) wx.removeStorageSync(CONTINUE_STORAGE_KEY);
    return false;
  }
  return true;
}

function rememberContinuation(now = Date.now()) {
  wx.setStorageSync(CONTINUE_STORAGE_KEY, { expiresAt: now + CONTINUE_TTL_MS });
  return true;
}

function clearContinuation() {
  wx.removeStorageSync(CONTINUE_STORAGE_KEY);
}

function isFreshGutEntry(options = {}) {
  const assessmentType = String(options.assessmentType || options.assessment_type || "").trim();
  const assessmentId = String(options.assessmentId || options.assessment_id || "").trim();
  return assessmentType === "GUT_REGULARITY" && !assessmentId;
}

function shouldRedirectToIntro(options = {}, now = Date.now()) {
  return isFreshGutEntry(options) && !readContinuation(now);
}

module.exports = {
  CONTINUE_STORAGE_KEY,
  FIXED_GUT_ASSESSMENT_PATH,
  GUT_INTRO_PATH,
  clearContinuation,
  isFreshGutEntry,
  readContinuation,
  rememberContinuation,
  shouldRedirectToIntro,
};
