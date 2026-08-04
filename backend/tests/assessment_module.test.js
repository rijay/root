const assert = require("node:assert/strict");
const test = require("node:test");

const assessment = require("../src/assessmentModule");

function answers(overrides = {}) {
  return {
    primary_goal: "bowel",
    impact_level: "4_6",
    safety: ["none"],
    bowel_frequency: "every_2_3_days",
    stool_form: "hard",
    digestive_feelings: ["straining"],
    sleep_duration: "7_8",
    sleep_issues: ["none"],
    activity: "light_1_2",
    diet: ["low_variety"],
    hydration: ["low_water"],
    stress_energy: ["stable"],
    ...overrides,
  };
}

test("initial profile definition is versioned and requires exactly 12 questions", () => {
  const definition = assessment.getPublishedDefinition({ gender: "FEMALE" });

  assert.equal(definition.questionnaireId, "ROOT4U_INITIAL_PROFILE");
  assert.equal(definition.version, 1);
  assert.equal(definition.questions.length, 12);
  assert.equal(definition.questions.every((question) => question.required), true);
  assert.equal(definition.questions[2].options.some((option) => option.value === "pregnancy"), true);
  assert.equal(
    assessment.getPublishedDefinition({ gender: "MALE" }).questions[2].options
      .some((option) => option.value === "pregnancy"),
    false,
  );
});

test("answer validation rejects missing and conflicting required selections", () => {
  const definition = assessment.getPublishedDefinition({ gender: "FEMALE" });

  assert.throws(
    () => assessment.normalizeAnswers(answers({ primary_goal: "" }), definition),
    { code: "FORMAL_HEALTH_ANSWER_REQUIRED" },
  );
  assert.throws(
    () => assessment.normalizeAnswers(answers({ hydration: ["adequate", "low_water"] }), definition),
    { code: "FORMAL_HEALTH_ANSWER_CONFLICT" },
  );
});

test("scoring is deterministic, traceable and prioritizes material sleep impact", () => {
  const bowel = assessment.scoreAssessment(answers());
  const sleep = assessment.scoreAssessment(answers({
    primary_goal: "bowel",
    impact_level: "9_10",
    sleep_duration: "under_5",
    sleep_issues: ["onset", "waking", "unrefreshed"],
  }));

  assert.equal(bowel.categoryCode, "BOWEL");
  assert.equal(bowel.scoringVersion, 1);
  assert.equal(Number.isInteger(bowel.scores.BOWEL), true);
  assert.equal(sleep.categoryCode, "SLEEP");
  assert.ok(sleep.scores.SLEEP > sleep.scores.BOWEL);
  assert.deepEqual(bowel.tags, ["饮水偏少"]);
});

test("observation goal with multiple unstable signals produces a variable category", () => {
  const result = assessment.scoreAssessment(answers({
    primary_goal: "observe",
    bowel_frequency: "variable",
    stool_form: "variable",
    diet: ["variable"],
  }));

  assert.equal(result.categoryCode, "VARIABLE");
});

test("ordinary primary goals remain primary until a higher-impact state overrides them", () => {
  const expected = {
    bowel: "BOWEL",
    digestion: "DIGESTION",
    sleep: "SLEEP",
    energy: "ENERGY",
    lifestyle: "LIFESTYLE",
    observe: "BASELINE",
  };

  for (const [goal, category] of Object.entries(expected)) {
    assert.equal(assessment.scoreAssessment(answers({ primary_goal: goal })).categoryCode, category, goal);
  }
});

test("the scoring Interface cannot be used before safety passes", () => {
  assert.throws(
    () => assessment.scoreAssessment(answers({ safety: ["blood_stool"] })),
    { code: "FORMAL_HEALTH_SCORING_BLOCKED_BY_SAFETY" },
  );
});

module.exports = { answers };
