const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MODEL_ASSISTED,
  REVIEWED_FALLBACK,
  resolveExpectedSource,
  validateResult,
} = require("../scripts/verify-local-health-advice");

function result(overrides = {}) {
  return {
    expectedSource: MODEL_ASSISTED,
    ready: true,
    initialResult: "STEADY",
    gutResult: "HEALTHY",
    adviceSource: MODEL_ASSISTED,
    modelName: "hy3",
    actionCount: 3,
    ...overrides,
  };
}

test("local health advice verification keeps model-assisted as the strict default", () => {
  assert.equal(resolveExpectedSource([]), MODEL_ASSISTED);
  assert.equal(resolveExpectedSource(["--expected-source=REVIEWED_FALLBACK"]), REVIEWED_FALLBACK);
  assert.throws(
    () => resolveExpectedSource(["--expected-source=AUTO"]),
    { code: "LOCAL_HEALTH_ADVICE_VERIFY_SOURCE_INVALID" },
  );
});

test("model-assisted verification requires the configured hy3 model", () => {
  const modelAssisted = result();
  assert.equal(validateResult(modelAssisted), modelAssisted);
  assert.throws(
    () => validateResult(result({ modelName: "" })),
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
