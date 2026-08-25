const assert = require("node:assert/strict");
const test = require("node:test");

const assessment = require("../src/healthAssessment");
const {
  LOCAL_SEED_SCOPE,
  localDefinitions,
  seedLocalMiniprogramDevData,
} = require("../src/localMiniprogramDevSeed");
const { createSeedData } = require("../src/seed");

function localEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    ROOT_LISTEN_HOST: "127.0.0.1",
    ROOT_STORE_ADAPTER: "sqlite",
    ROOT_SQLITE_FILE: "./data/myroot-v070-devtools.sqlite",
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_LOCAL_MINIPROGRAM_DEV_SEED: "true",
    ...overrides,
  };
}

function localStore() {
  return {
    kind: "sqlite",
    filePath: "/tmp/myroot-v070-devtools.sqlite",
  };
}

const healthyInitialAnswers = Object.freeze({
  primary_goal: "observe",
  impact_level: "0",
  safety: ["none"],
  bowel_frequency: "daily",
  stool_form: "formed",
  digestive_feelings: ["none"],
  sleep_duration: "7_8",
  sleep_issues: ["none"],
  activity: "regular_3",
  diet: ["balanced"],
  hydration: ["adequate"],
  stress_energy: ["stable"],
});

const healthyGutAnswers = Object.freeze({
  Q1: "A",
  Q2: "B",
  Q3: ["A"],
  Q4: ["A"],
  Q5: ["A"],
});

test("local mini program seed is disabled by default", () => {
  const data = createSeedData();
  const result = seedLocalMiniprogramDevData(data, { env: {}, storeAdapter: {} });
  assert.deepEqual(result, { enabled: false, changed: false, definitionCount: 0 });
  assert.equal(data.healthAssessmentDefinitions.length, 0);
});

test("local mini program seed fails closed outside its dedicated loopback SQLite boundary", () => {
  const cases = [
    [localEnv({ NODE_ENV: "production" }), localStore(), "LOCAL_DEV_SEED_ENV_INVALID"],
    [localEnv({ ROOT_LISTEN_HOST: "0.0.0.0" }), localStore(), "LOCAL_DEV_SEED_HOST_INVALID"],
    [localEnv({ ROOT_STORE_ADAPTER: "mysql" }), { ...localStore(), kind: "mysql" }, "LOCAL_DEV_SEED_STORE_INVALID"],
    [localEnv({ ROOT_SQLITE_FILE: "./data/another.sqlite" }), localStore(), "LOCAL_DEV_SEED_FILE_INVALID"],
    [localEnv({ ROOT_ALLOW_OPENID_LOGIN: "false" }), localStore(), "LOCAL_DEV_SEED_LOGIN_INVALID"],
  ];
  cases.forEach(([env, storeAdapter, code]) => {
    assert.throws(
      () => seedLocalMiniprogramDevData(createSeedData(), { env, storeAdapter }),
      (error) => error.code === code,
    );
  });
});

test("local mini program seed is idempotent and preserves non-fixture definitions", () => {
  const data = createSeedData();
  data.healthAssessmentDefinitions.push({ assessment_definition_id: "preserved" });
  const first = seedLocalMiniprogramDevData(data, { env: localEnv(), storeAdapter: localStore() });
  const second = seedLocalMiniprogramDevData(data, { env: localEnv(), storeAdapter: localStore() });
  assert.equal(first.definitionCount, 2);
  assert.equal(second.definitionCount, 2);
  assert.equal(data.healthAssessmentDefinitions.length, 3);
  assert.ok(data.healthAssessmentDefinitions.some((item) => item.assessment_definition_id === "preserved"));
  assert.equal(data.healthAssessmentDefinitions.filter((item) => item.development_fixture_scope === LOCAL_SEED_SCOPE).length, 2);
});

test("seeded definitions reuse the current 12-question and 5-question client content", () => {
  const definitions = localDefinitions();
  const initial = definitions.find((item) => item.assessment_type === "INITIAL");
  const gut = definitions.find((item) => item.assessment_type === "GUT_REGULARITY");
  assert.equal(initial.questionnaire_id, "ROOT4U_INITIAL_PROFILE");
  assert.equal(initial.questions.length, 12);
  assert.equal(gut.questionnaire_id, "ROOT_GUT_5Q");
  assert.equal(gut.questionnaire_version, 2);
  assert.equal(gut.questions.length, 5);
  assert.equal(gut.questions[2].options[0].exclusive, true);
});

test("seeded definitions complete server-side, preserve safety, and classify combined gut signals", () => {
  const data = createSeedData();
  seedLocalMiniprogramDevData(data, { env: localEnv(), storeAdapter: localStore() });

  const initial = assessment.start(data, "root-local-dev", { assessmentType: "INITIAL" }).assessment;
  const completedInitial = assessment.complete(data, "root-local-dev", initial.assessmentId, {
    answers: healthyInitialAnswers,
  }).assessment;
  assert.equal(completedInitial.status, "COMPLETED");
  assert.equal(completedInitial.result.resultCode, "BASELINE");

  const gut = assessment.start(data, "root-local-dev", { assessmentType: "GUT_REGULARITY" }).assessment;
  assert.equal(gut.definition.questions[2].options[0].exclusive, true);
  const completedGut = assessment.complete(data, "root-local-dev", gut.assessmentId, {
    answers: healthyGutAnswers,
  }).assessment;
  assert.equal(completedGut.result.resultCode, "HEALTHY");

  const alternating = assessment.start(data, "root-local-alt", { assessmentType: "GUT_REGULARITY" }).assessment;
  const completedAlternating = assessment.complete(data, "root-local-alt", alternating.assessmentId, {
    answers: { ...healthyGutAnswers, Q1: "B", Q2: "D" },
  }).assessment;
  assert.equal(completedAlternating.result.resultCode, "ALTERNATING");

  const invalid = assessment.start(data, "root-local-invalid", { assessmentType: "GUT_REGULARITY" }).assessment;
  assert.throws(
    () => assessment.complete(data, "root-local-invalid", invalid.assessmentId, {
      answers: { ...healthyGutAnswers, Q3: ["A", "B"] },
    }),
    (error) => error.code === 6104,
  );

  const safety = assessment.start(data, "root-local-safety", { assessmentType: "INITIAL" }).assessment;
  const stopped = assessment.complete(data, "root-local-safety", safety.assessmentId, {
    answers: { safety: ["self_harm"] },
  }).assessment;
  assert.equal(stopped.status, "SAFETY_STOPPED");
  assert.equal(stopped.safetyState, "URGENT");
});
