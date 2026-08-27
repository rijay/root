const assert = require("node:assert/strict");
const test = require("node:test");

const healthAssessment = require("../src/healthAssessment");
const {
  CATALOG_PROMPT_VERSION,
  CATALOG_VERSION,
  SYNTHETIC_SCENARIOS,
  TAXONOMY_VERSION,
  createHealthAdviceCatalog,
  requiredFiberActionForGutResult,
} = require("../src/healthAdviceCatalog");
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

function reviewedCatalog(overrides = {}) {
  return createHealthAdviceCatalog({
    schemaVersion: 1,
    catalogVersion: CATALOG_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    modelName: "hy3",
    generatedAt: "2026-08-26T10:00:00.000Z",
    reviewStatus: "APPROVED",
    reviewedAt: "2026-08-26T11:00:00.000Z",
    reviewer: "content-reviewer-1",
    entries: SYNTHETIC_SCENARIOS.map((scenario) => ({
      ...scenario,
      reviewStatus: "APPROVED",
      advice: {
        summary: "先保持近期节奏稳定。",
        actions: [requiredFiberActionForGutResult(scenario.gutResultCode), "分次补充饮水。", "记录一周身体感受。"],
        cautions: ["不适持续时请咨询专业人士。"],
        followUp: "一周后可再次评测。",
      },
    })),
    ...overrides,
  });
}

test("reviewed model catalog is selected locally and reused for the same inputs", async () => {
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
    healthAdviceCatalog: reviewedCatalog(),
    healthAdviceModelAdapter: forbiddenRuntimeAdapter,
  });
  assert.equal(generated.advice.source, "REVIEWED_MODEL_CATALOG");
  assert.equal(generated.advice.sourceLabel, "AI 辅助生成，经审核");
  assert.equal(generated.advice.modelName, "hy3");
  assert.equal(generated.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
  assert.equal(data.healthAdviceSnapshots.length, 1);
  assert.equal(data.healthAdviceSnapshots[0].states_json[0].safetyStopped, false);
  assert.equal(calls, 0);

  const reused = await healthStatusAdvice.generate(data, "root-advice", { healthAdviceCatalog: reviewedCatalog() });
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

test("draft or incomplete catalog falls back to reviewed fixed content", async () => {
  const data = readyData("root-fallback");
  const generated = await healthStatusAdvice.generate(data, "root-fallback", {
    healthAdviceCatalog: reviewedCatalog({ reviewStatus: "DRAFT" }),
  });
  assert.equal(generated.advice.source, "REVIEWED_FALLBACK");
  assert.equal(generated.advice.actions.length, 3);
  assert.equal(generated.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
});

test("runtime rejects a catalog Adapter that changes the required fiber action", async () => {
  const data = readyData("root-runtime-fiber-guard");
  const generated = await healthStatusAdvice.generate(data, "root-runtime-fiber-guard", {
    healthAdviceCatalog: {
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
