const assert = require("node:assert/strict");
const test = require("node:test");

const { createLifestyleAdviceModule } = require("../src/lifestyleAdviceModule");
const { createFixedContentAdapter } = require("../src/lifestyleAdviceAdapters/fixedContentAdapter");

test("standard assessment returns exactly three fixed, non-diagnostic tips", () => {
  const advice = createLifestyleAdviceModule({ fixedContentAdapter: createFixedContentAdapter() });
  const result = advice.buildResult({
    assessment: { categoryCode: "BOWEL", tags: ["饮水偏少"] },
    safety: { status: "STANDARD_GUIDANCE", urgency: "NONE", matchedSignals: [], guidanceKey: null },
  });

  assert.equal(result.safetyStatus, "STANDARD_GUIDANCE");
  assert.equal(result.categoryTitle, "肠道规律关注型");
  assert.equal(result.tips.length, 3);
  assert.equal(result.recommendations.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /诊断|治疗|治愈|疗效/);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 80 * 1024);
});

test("risk routing never invokes the ordinary advice path", () => {
  let standardCalls = 0;
  const fixedContentAdapter = {
    generateStandardAdvice() {
      standardCalls += 1;
      throw new Error("ordinary advice must not run");
    },
    getSafetyGuidance(safety) {
      return {
        safetyStatus: safety.status,
        categoryCode: "SAFETY_GUIDANCE",
        categoryTitle: "这次不继续生成普通生活方式建议",
        tags: [],
        tips: ["请及时寻求专业支持。", "如存在立即危险，请联系当地紧急支持。", "不要因本次问卷延迟求助。"],
        recommendations: [],
      };
    },
  };
  const advice = createLifestyleAdviceModule({ fixedContentAdapter });
  const result = advice.buildResult({
    assessment: null,
    safety: {
      status: "PROFESSIONAL_SUPPORT_RECOMMENDED",
      urgency: "URGENT",
      matchedSignals: ["self_harm"],
      guidanceKey: "URGENT_SUPPORT",
    },
  });

  assert.equal(standardCalls, 0);
  assert.equal(result.categoryCode, "SAFETY_GUIDANCE");
  assert.equal(result.recommendations.length, 0);
});

test("the fixed advice Adapter only receives derived, minimum health fields", () => {
  let received;
  const fixedContentAdapter = {
    generateStandardAdvice(input) {
      received = input;
      return createFixedContentAdapter().generateStandardAdvice(input);
    },
    getSafetyGuidance: createFixedContentAdapter().getSafetyGuidance,
  };
  const advice = createLifestyleAdviceModule({ fixedContentAdapter });

  advice.buildResult({
    assessment: {
      categoryCode: "SLEEP",
      tags: ["睡眠不足或不规律"],
      scores: { SLEEP: 8 },
      rawAnswers: { sleep_duration: "under_5" },
      phone: "13800138000",
    },
    safety: { status: "STANDARD_GUIDANCE", urgency: "NONE", matchedSignals: [], guidanceKey: null },
    user: { nickname: "不应传递", openid: "secret" },
  });

  assert.deepEqual(received, {
    categoryCode: "SLEEP",
    tags: ["睡眠不足或不规律"],
  });
});
