const assert = require("node:assert/strict");
const test = require("node:test");

const assessment = require("../src/healthAssessment");
const { createSeedData } = require("../src/seed");

function approvedInitialDefinition(version = 1) {
  return {
    assessment_definition_id: `had_initial_v${version}`,
    assessment_type: "INITIAL",
    questionnaire_id: "ROOT_INITIAL_BASELINE",
    questionnaire_version: version,
    title: "初始状态评测",
    description: "用于测试评测流程，不代表正式题库。",
    estimated_minutes: 2,
    status: "ACTIVE",
    content_review_status: "APPROVED",
    professional_review_status: "APPROVED",
    compliance_review_status: "APPROVED",
    result_copy_version: 1,
    dimensions: [
      { key: "daily_state", label: "日常状态", direction: "HIGHER_IS_BETTER" },
    ],
    questions: [
      {
        field: "stateScore",
        type: "scale",
        title: "测试分值",
        required: true,
        min: 1,
        max: 5,
        dimension_key: "daily_state",
      },
      {
        field: "frequency",
        type: "single",
        title: "测试频率",
        required: true,
        dimension_key: "daily_state",
        options: [
          { value: "low", label: "较少", score: 0 },
          { value: "regular", label: "规律", score: 2 },
        ],
      },
    ],
    result_rules: [
      { result_code: "STEADY", all: [{ dimension_key: "daily_state", operator: "GTE", value: 5 }] },
    ],
    default_result_code: "OBSERVE",
    result_copies: [
      {
        code: "OBSERVE",
        title: "保持观察",
        summary: "这是测试文案。",
        priority_action: "继续记录",
        risk_notice: "不构成诊断。",
        retest_advice: "可在合适时间复测。",
      },
      {
        code: "STEADY",
        title: "状态较平稳",
        summary: "这是测试文案。",
        priority_action: "保持当前节奏",
        risk_notice: "不构成诊断。",
        retest_advice: "可在合适时间复测。",
      },
    ],
  };
}

function approvedGutDefinition() {
  return {
    assessment_definition_id: "had_gut_v1",
    assessment_type: "GUT_REGULARITY",
    questionnaire_id: "ROOT_GUT_REGULARITY",
    questionnaire_version: 1,
    title: "肠道规律自测",
    status: "ACTIVE",
    content_review_status: "APPROVED",
    professional_review_status: "APPROVED",
    compliance_review_status: "APPROVED",
    result_copy_version: 1,
    dimensions: [{ key: "regularity", label: "规律观察", direction: "HIGHER_IS_BETTER" }],
    questions: [
      { field: "safety", type: "boolean", title: "测试安全题", required: true },
      { field: "regularity", type: "scale", title: "测试规律题", required: true, min: 1, max: 5, dimension_key: "regularity" },
    ],
    safety_rules: [{ field: "safety", operator: "EQ", value: true, safety_state: "REVIEW_RECOMMENDED", result_code: "SAFETY" }],
    default_result_code: "OBSERVE",
    result_copies: [
      { code: "SAFETY", title: "建议优先咨询专业人士", summary: "测试安全分支。", risk_notice: "请勿仅依赖自测。" },
      { code: "OBSERVE", title: "继续观察", summary: "测试常规分支。" },
    ],
  };
}

test("health assessment retest keeps independent results and compares same questionnaire version", () => {
  const data = createSeedData();
  data.healthAssessmentDefinitions.push(approvedInitialDefinition());

  const firstStart = assessment.start(data, "root-1", { assessmentType: "INITIAL" });
  assert.equal(firstStart.created, true);
  assert.equal(firstStart.assessment.isRetest, false);
  assessment.saveDraft(data, "root-1", firstStart.assessment.assessmentId, {
    answers: { stateScore: 2, frequency: "low" },
  });
  const first = assessment.complete(data, "root-1", firstStart.assessment.assessmentId);
  assert.equal(first.assessment.status, "COMPLETED");
  assert.equal(first.assessment.dimensions[0].score, 2);

  const secondStart = assessment.start(data, "root-1", { assessmentType: "INITIAL" });
  assert.equal(secondStart.assessment.isRetest, true);
  const catalogWithDraft = assessment.catalog(data, "root-1");
  const initialCatalog = catalogWithDraft.assessments.find((item) => item.assessmentType === "INITIAL");
  assert.equal(initialCatalog.canResume, true);
  assert.equal(initialCatalog.inProgress.assessmentId, secondStart.assessment.assessmentId);
  assert.equal(initialCatalog.inProgress.answers, undefined);
  const second = assessment.complete(data, "root-1", secondStart.assessment.assessmentId, {
    answers: { stateScore: 4, frequency: "regular" },
  });
  assert.equal(second.assessment.dimensions[0].score, 6);
  assert.notEqual(first.assessment.assessmentId, second.assessment.assessmentId);

  const history = assessment.history(data, "root-1", { assessmentType: "INITIAL" });
  assert.equal(history.total, 2);
  assert.equal(history.assessments.every((item) => item.answers === undefined), true);

  const compared = assessment.compare(data, "root-1", {
    leftAssessmentId: second.assessment.assessmentId,
    rightAssessmentId: first.assessment.assessmentId,
  });
  assert.equal(compared.comparable, true);
  assert.equal(compared.left.assessmentId, first.assessment.assessmentId);
  assert.equal(compared.right.assessmentId, second.assessment.assessmentId);
  assert.deepEqual(compared.dimensions[0], {
    key: "daily_state",
    label: "日常状态",
    beforeScore: 2,
    afterScore: 6,
    delta: 4,
    unit: "",
    direction: "HIGHER_IS_BETTER",
  });

  const sameAssessment = assessment.compare(data, "root-1", {
    leftAssessmentId: first.assessment.assessmentId,
    rightAssessmentId: first.assessment.assessmentId,
  });
  assert.equal(sameAssessment.comparable, false);
  assert.equal(sameAssessment.reason, "SAME_ASSESSMENT");
});

test("health assessment comparison rejects different questionnaire versions", () => {
  const data = createSeedData();
  data.healthAssessmentDefinitions.push(approvedInitialDefinition(1));
  const firstStart = assessment.start(data, "root-2", { assessmentType: "INITIAL" });
  const first = assessment.complete(data, "root-2", firstStart.assessment.assessmentId, {
    answers: { stateScore: 2, frequency: "low" },
  });

  data.healthAssessmentDefinitions[0].status = "ARCHIVED";
  data.healthAssessmentDefinitions.push(approvedInitialDefinition(2));
  const secondStart = assessment.start(data, "root-2", { assessmentType: "INITIAL" });
  const second = assessment.complete(data, "root-2", secondStart.assessment.assessmentId, {
    answers: { stateScore: 4, frequency: "regular" },
  });

  const compared = assessment.compare(data, "root-2", {
    leftAssessmentId: first.assessment.assessmentId,
    rightAssessmentId: second.assessment.assessmentId,
  });
  assert.equal(compared.comparable, false);
  assert.equal(compared.reason, "QUESTIONNAIRE_VERSION_MISMATCH");
});

test("health assessment deletion is owned, idempotent and does not expose another user's record", () => {
  const data = createSeedData();
  data.healthAssessmentDefinitions.push(approvedInitialDefinition());
  const started = assessment.start(data, "root-delete-owner", { assessmentType: "INITIAL" });
  assessment.complete(data, "root-delete-owner", started.assessment.assessmentId, {
    answers: { stateScore: 4, frequency: "regular" },
  });

  assert.deepEqual(
    assessment.remove(data, "root-other-user", started.assessment.assessmentId),
    { assessmentId: started.assessment.assessmentId, deleted: false },
  );
  assert.equal(assessment.history(data, "root-delete-owner").total, 1);

  const removed = assessment.remove(data, "root-delete-owner", started.assessment.assessmentId);
  assert.equal(removed.deleted, true);
  assert.equal(typeof removed.deletedAt, "string");
  assert.equal(assessment.history(data, "root-delete-owner").total, 0);
  assert.deepEqual(
    assessment.remove(data, "root-delete-owner", started.assessment.assessmentId),
    { assessmentId: started.assessment.assessmentId, deleted: false },
  );
});

test("health assessment safety branch can stop before ordinary required questions", () => {
  const data = createSeedData();
  data.healthAssessmentDefinitions.push(approvedGutDefinition());
  const started = assessment.start(data, "root-3", { assessmentType: "GUT_REGULARITY" });
  const saved = assessment.saveDraft(data, "root-3", started.assessment.assessmentId, {
    answers: { safety: true },
  });
  assert.equal(saved.safetyTriggered, true);
  const completed = assessment.complete(data, "root-3", started.assessment.assessmentId);
  assert.equal(completed.assessment.status, "SAFETY_STOPPED");
  assert.equal(completed.assessment.safetyState, "REVIEW_RECOMMENDED");
  assert.equal(completed.assessment.dimensions.length, 0);
});

test("health assessment removes answers after their conditional questions become hidden", () => {
  const data = createSeedData();
  const definition = approvedInitialDefinition();
  definition.questions.push(
    { field: "hasDetail", type: "boolean", title: "是否补充说明", required: true },
    {
      field: "detail",
      type: "text",
      title: "补充说明",
      required: true,
      visible_if: { field: "hasDetail", operator: "EQ", value: true },
    },
  );
  data.healthAssessmentDefinitions.push(definition);

  const started = assessment.start(data, "root-conditional", { assessmentType: "INITIAL" });
  assessment.saveDraft(data, "root-conditional", started.assessment.assessmentId, {
    answers: {
      stateScore: 3,
      frequency: "regular",
      hasDetail: true,
      detail: "先前填写的敏感说明",
    },
  });
  const changed = assessment.saveDraft(data, "root-conditional", started.assessment.assessmentId, {
    answers: {
      stateScore: 3,
      frequency: "regular",
      hasDetail: false,
      detail: "不应继续保留",
    },
  });
  assert.deepEqual(changed.assessment.answers, {
    stateScore: 3,
    frequency: "regular",
    hasDetail: false,
  });

  const completed = assessment.complete(data, "root-conditional", started.assessment.assessmentId, {
    answers: {
      stateScore: 3,
      frequency: "regular",
      hasDetail: false,
      detail: "也不应进入完成快照",
    },
  });
  assert.equal(completed.assessment.status, "COMPLETED");
  const stored = data.healthAssessmentAttempts.find((item) => item.assessment_id === started.assessment.assessmentId);
  assert.equal(Object.prototype.hasOwnProperty.call(stored.answers_json, "detail"), false);
});

test("health assessment keeps unreviewed content unavailable", () => {
  const data = createSeedData();
  const definition = approvedInitialDefinition();
  definition.professional_review_status = "PENDING";
  data.healthAssessmentDefinitions.push(definition);
  const catalog = assessment.catalog(data, "root-4");
  const initial = catalog.assessments.find((item) => item.assessmentType === "INITIAL");
  assert.equal(initial.available, false);
  assert.equal(initial.unavailableReason, "CONTENT_REVIEW_PENDING");
  assert.throws(
    () => assessment.start(data, "root-4", { assessmentType: "INITIAL" }),
    /审核或配置中/
  );
});
