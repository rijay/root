const assert = require("node:assert/strict");
const test = require("node:test");

const safetyPolicy = require("../src/healthSafetyPolicy");

test("no declared safety signal keeps the ordinary advice path available", () => {
  assert.deepEqual(safetyPolicy.evaluateSafety({ safety: ["none"] }), {
    status: "STANDARD_GUIDANCE",
    urgency: "NONE",
    matchedSignals: [],
    guidanceKey: null,
    policyVersion: 1,
  });
});

test("every published risk option closes the ordinary advice path", () => {
  for (const signal of safetyPolicy.SAFETY_SIGNALS) {
    const result = safetyPolicy.evaluateSafety({ safety: [signal] });
    assert.equal(result.status, "PROFESSIONAL_SUPPORT_RECOMMENDED", signal);
    assert.equal(result.matchedSignals.includes(signal), true, signal);
    assert.notEqual(result.guidanceKey, null, signal);
    assert.equal(result.policyVersion, 1, signal);
  }
});

test("immediate danger signals receive the strongest fixed guidance route", () => {
  const result = safetyPolicy.evaluateSafety({ safety: ["self_harm", "blood_stool"] });

  assert.equal(result.urgency, "URGENT");
  assert.equal(result.guidanceKey, "URGENT_SUPPORT");
  assert.deepEqual(result.matchedSignals, ["blood_stool", "self_harm"]);
});

test("missing or contradictory safety answers fail closed", () => {
  assert.throws(() => safetyPolicy.evaluateSafety({ safety: [] }), {
    code: "FORMAL_HEALTH_SAFETY_REQUIRED",
  });
  assert.throws(() => safetyPolicy.evaluateSafety({ safety: ["none", "medical_diet"] }), {
    code: "FORMAL_HEALTH_SAFETY_CONFLICT",
  });
});
