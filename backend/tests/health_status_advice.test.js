const assert = require("node:assert/strict");
const test = require("node:test");

const healthAssessment = require("../src/healthAssessment");
const poolManifest = require("../data/health-advice-pool.v1.json");
const { createHealthAdvicePool, POOL_VERSION } = require("../src/healthAdvicePool");
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
    completedAttempt("has-initial", rootUserId, "INITIAL", "BASELINE"),
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reviewedPool(transform) {
  const source = clone(poolManifest);
  if (transform) transform(source);
  return createHealthAdvicePool(source);
}

test("reviewed advice pool is selected locally and reused for the same inputs", async () => {
  const data = readyData();
  let calls = 0;
  const forbiddenRuntimeAdapter = {
    configured: true,
    async generate(input) {
      calls += 1;
      throw new Error(`runtime model must not run: ${JSON.stringify(input)}`);
    },
  };

  const generated = await healthStatusAdvice.generate(data, "root-advice", {
    healthAdvicePool: reviewedPool(),
    healthAdviceModelAdapter: forbiddenRuntimeAdapter,
  });
  assert.equal(generated.advice.source, "REVIEWED_ADVICE_POOL");
  assert.equal(generated.advice.sourceLabel, "AI 辅助起草，经人工审核");
  assert.equal(generated.advice.modelName, "");
  assert.equal(generated.advice.contentVersion, POOL_VERSION);
  assert.equal(generated.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
  assert.equal(data.healthAdviceSnapshots.length, 1);
  assert.equal(data.healthAdviceSnapshots[0].states_json[0].safetyStopped, false);
  assert.equal(calls, 0);

  const reused = await healthStatusAdvice.generate(data, "root-advice", { healthAdvicePool: reviewedPool() });
  assert.equal(reused.reused, true);
  assert.equal(calls, 0);
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

test("draft or incomplete pool falls back to reviewed fixed content", async () => {
  const data = readyData("root-fallback");
  const generated = await healthStatusAdvice.generate(data, "root-fallback", {
    healthAdvicePool: reviewedPool((source) => {
      source.gutGroups.HEALTHY.actions[0].reviewStatus = "PENDING_REVIEW";
    }),
  });
  assert.equal(generated.advice.source, "REVIEWED_FALLBACK");
  assert.equal(generated.advice.actions.length, 3);
  assert.equal(generated.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
});

test("runtime rejects a pool Adapter that changes the required fiber action", async () => {
  const data = readyData("root-runtime-fiber-guard");
  const generated = await healthStatusAdvice.generate(data, "root-runtime-fiber-guard", {
    healthAdvicePool: {
      adapterId: "INVALID_POOL",
      poolVersion: "invalid-pool",
      lookup() {
        return {
          advice: {
            summary: "模型目录摘要。",
            actions: ["被改写的纤维建议。", "分次饮水。", "记录身体感受。"],
            cautions: [],
            followUp: "一周后回测。",
          },
        };
      },
    },
  });
  assert.equal(generated.advice.source, "REVIEWED_FALLBACK");
  assert.equal(generated.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
});
