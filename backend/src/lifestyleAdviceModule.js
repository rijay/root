const { createClientError } = require("./clientError");
const { createFixedContentAdapter } = require("./lifestyleAdviceAdapters/fixedContentAdapter");

function assertResult(result) {
  if (!result || !Array.isArray(result.tips) || result.tips.length !== 3) {
    throw createClientError("FORMAL_HEALTH_ADVICE_INVALID", "生活方式建议暂不可用", 503);
  }
  if (!Array.isArray(result.recommendations) || !Array.isArray(result.tags)) {
    throw createClientError("FORMAL_HEALTH_ADVICE_INVALID", "生活方式建议暂不可用", 503);
  }
  return result;
}

function createLifestyleAdviceModule({ fixedContentAdapter = createFixedContentAdapter() } = {}) {
  if (!fixedContentAdapter
    || typeof fixedContentAdapter.generateStandardAdvice !== "function"
    || typeof fixedContentAdapter.getSafetyGuidance !== "function") {
    throw new TypeError("fixedContentAdapter must satisfy the lifestyle advice Interface");
  }
  return Object.freeze({
    buildResult({ assessment, safety } = {}) {
      if (!safety || !safety.status) {
        throw createClientError("FORMAL_HEALTH_SAFETY_REQUIRED", "安全分流结果缺失", 500);
      }
      if (safety.status !== "STANDARD_GUIDANCE") {
        return assertResult(fixedContentAdapter.getSafetyGuidance({
          status: safety.status,
          urgency: safety.urgency,
          guidanceKey: safety.guidanceKey,
        }));
      }
      if (!assessment || !assessment.categoryCode) {
        throw createClientError("FORMAL_HEALTH_ASSESSMENT_REQUIRED", "评测结果缺失", 500);
      }
      return assertResult(fixedContentAdapter.generateStandardAdvice({
        categoryCode: assessment.categoryCode,
        tags: Array.isArray(assessment.tags) ? assessment.tags.slice(0, 3) : [],
      }));
    },
  });
}

const defaultModule = createLifestyleAdviceModule();

module.exports = {
  buildResult: defaultModule.buildResult,
  createLifestyleAdviceModule,
};
