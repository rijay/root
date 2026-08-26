const assert = require("node:assert/strict");
const test = require("node:test");

const healthAssessment = require("../src/healthAssessment");
const healthStatusAdvice = require("../src/healthStatusAdvice");
const { createSeedData } = require("../src/seed");

function completedAttempt(id, rootUserId, type, resultCode, options = {}) {
  return {
    assessment_id: id,
    root_user_id: rootUserId,
    assessment_definition_id: `definition-${type}`,
    assessment_type: type,
    questionnaire_id: `questionnaire-${type}`,
    questionnaire_version: 1,
    status: options.safetyStopped ? "SAFETY_STOPPED" : "COMPLETED",
    safety_state: options.safetyStopped ? "REVIEW_RECOMMENDED" : "NONE",
    result_json: {
      resultCode,
      title: options.title || `${type} 当前状态`,
      summary: "已审核结果摘要",
    },
    dimensions_json: [],
    completed_at: options.completedAt || "2026-08-25T10:00:00.000Z",
    updated_at: options.completedAt || "2026-08-25T10:00:00.000Z",
  };
}

function readyData(rootUserId = "root-advice") {
  const data = createSeedData();
  data.healthAssessmentAttempts.push(
    completedAttempt("has-initial", rootUserId, "INITIAL", "STEADY"),
    completedAttempt("has-gut", rootUserId, "GUT_REGULARITY", "HEALTHY"),
  );
  return data;
}

test("combined overview identifies the missing assessment before generation", () => {
  const data = createSeedData();
  data.healthAssessmentAttempts.push(completedAttempt("has-initial", "root-missing", "INITIAL", "STEADY"));
  const overview = healthStatusAdvice.overview(data, "root-missing");
  assert.equal(overview.ready, false);
  assert.deepEqual(overview.missingAssessmentTypes, ["GUT_REGULARITY"]);
  assert.equal(overview.advice, null);
});

test("model advice receives only derived state fields and is reused for the same inputs", async () => {
  const data = readyData();
  let calls = 0;
  let received;
  const adapter = {
    adapterId: "TEST_MODEL_ADAPTER",
    configured: true,
    modelName: "test-health-model",
    async generate(input) {
      calls += 1;
      received = input;
      return {
        summary: "先保持近期节奏稳定。",
        actions: ["固定起床时间。", "分次补充饮水。", "记录一周身体感受。"],
        cautions: ["不适持续时请咨询专业人士。"],
        followUp: "一周后可再次评测。",
      };
    },
  };

  const generated = await healthStatusAdvice.generate(data, "root-advice", { healthAdviceModelAdapter: adapter });
  assert.equal(generated.advice.source, "MODEL_ASSISTED");
  assert.equal(generated.advice.sourceLabel, "AI 辅助生成");
  assert.equal(data.healthAdviceSnapshots.length, 1);
  assert.equal(JSON.stringify(received).includes("has-initial"), false);
  assert.equal(JSON.stringify(received).includes("root-advice"), false);
  assert.deepEqual(Object.keys(received.states[0]).sort(), [
    "assessmentType", "questionnaireVersion", "resultCode", "title",
  ]);
  assert.equal(received.states[0].safetyStopped, undefined);
  assert.equal(data.healthAdviceSnapshots[0].states_json[0].safetyStopped, false);

  const reused = await healthStatusAdvice.generate(data, "root-advice", { healthAdviceModelAdapter: adapter });
  assert.equal(reused.reused, true);
  assert.equal(calls, 1);
});

test("safety result never calls the ordinary model and deleting an input removes its advice snapshot", async () => {
  const data = readyData("root-safety-advice");
  data.healthAssessmentAttempts[1].status = "SAFETY_STOPPED";
  let calls = 0;
  const generated = await healthStatusAdvice.generate(data, "root-safety-advice", {
    healthAdviceModelAdapter: {
      configured: true,
      async generate() { calls += 1; throw new Error("must not run"); },
    },
  });
  assert.equal(calls, 0);
  assert.equal(generated.advice.source, "REVIEWED_SAFETY");
  assert.equal(data.healthAdviceSnapshots.length, 1);

  const removed = healthAssessment.remove(data, "root-safety-advice", "has-gut");
  assert.equal(removed.invalidatedAdviceCount, 1);
  assert.equal(data.healthAdviceSnapshots.length, 0);
});

test("invalid model output falls back to reviewed fixed content", async () => {
  const data = readyData("root-fallback");
  const generated = await healthStatusAdvice.generate(data, "root-fallback", {
    healthAdviceModelAdapter: {
      adapterId: "INVALID_TEST_ADAPTER",
      configured: true,
      modelName: "invalid-model",
      async generate() {
        return { summary: "保证有效并提供治疗", actions: ["一条"], followUp: "稍后" };
      },
    },
  });
  assert.equal(generated.advice.source, "REVIEWED_FALLBACK");
  assert.equal(generated.advice.actions.length, 3);
});
