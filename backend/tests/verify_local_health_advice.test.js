const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REVIEWED_ADVICE_POOL,
  REVIEWED_FALLBACK,
  resolveExpectedSource,
  validateResult,
} = require("../scripts/verify-local-health-advice");

function result(overrides = {}) {
  return {
    expectedSource: REVIEWED_ADVICE_POOL,
    ready: true,
    initialResult: "STEADY",
    gutResult: "HEALTHY",
    adviceSource: REVIEWED_ADVICE_POOL,
    modelName: "",
    actionCount: 3,
    firstAction: "日常补充益生元，持续滋养肠道有益菌",
    ...overrides,
  };
}

test("local health advice verification keeps reviewed pool as the strict default", () => {
  assert.equal(resolveExpectedSource([]), REVIEWED_ADVICE_POOL);
  assert.equal(resolveExpectedSource(["--expected-source=REVIEWED_FALLBACK"]), REVIEWED_FALLBACK);
  assert.throws(
    () => resolveExpectedSource(["--expected-source=AUTO"]),
    { code: "LOCAL_HEALTH_ADVICE_VERIFY_SOURCE_INVALID" },
  );
});

test("reviewed pool verification requires no runtime model identity", () => {
  const reviewedPool = result();
  assert.equal(validateResult(reviewedPool), reviewedPool);
  assert.throws(
    () => validateResult(result({ modelName: "hy3" })),
    { code: "LOCAL_HEALTH_ADVICE_VERIFY_RESULT_FAILED" },
  );
  assert.throws(
    () => validateResult(result({ firstAction: "被模型改写的建议" })),
    { code: "LOCAL_HEALTH_ADVICE_VERIFY_RESULT_FAILED" },
  );
});

test("reviewed fallback verification is explicit and cannot be mistaken for a model call", () => {
  const fallback = result({
    expectedSource: REVIEWED_FALLBACK,
    adviceSource: REVIEWED_FALLBACK,
    modelName: "",
  });
  assert.equal(validateResult(fallback, REVIEWED_FALLBACK), fallback);
  assert.throws(
    () => validateResult(result(), REVIEWED_FALLBACK),
    { code: "LOCAL_HEALTH_ADVICE_VERIFY_RESULT_FAILED" },
  );
});
