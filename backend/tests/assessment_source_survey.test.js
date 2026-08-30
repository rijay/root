const assert = require("node:assert/strict");
const test = require("node:test");

const assessmentSourceSurvey = require("../src/assessmentSourceSurvey");
const { createStore } = require("../src/domain");

function completedAttempt(overrides = {}) {
  return {
    assessment_id: "assessment_source_001",
    root_user_id: "root_source_001",
    assessment_type: "GUT_REGULARITY",
    status: "COMPLETED",
    updated_at: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function activeConfig(data, options = [
  { optionId: "OFFLINE_EVENT", label: "线下活动" },
  { optionId: "WECHAT_FRIEND", label: "微信好友推荐" },
]) {
  return assessmentSourceSurvey.saveConfiguration(data, {
    assessmentType: "GUT_REGULARITY",
    status: "ACTIVE",
    title: "你是从哪里知道 ROOT 的？",
    subtitle: "请选择最接近的一项",
    options,
    operatorId: "channel-admin",
    requestId: "source-config-test",
  }).config;
}

test("completed gut assessments are gated only when an active non-empty config exists", () => {
  const data = createStore();
  data.healthAssessmentAttempts.push(completedAttempt());
  assert.equal(assessmentSourceSurvey.gate(data, "root_source_001", "assessment_source_001").required, false);

  const config = activeConfig(data);
  const gate = assessmentSourceSurvey.gate(data, "root_source_001", "assessment_source_001");
  assert.equal(gate.required, true);
  assert.equal(gate.config.configVersion, config.configVersion);
  assert.deepEqual(gate.config.options.map((item) => item.optionId), ["OFFLINE_EVENT", "WECHAT_FRIEND"]);

  assessmentSourceSurvey.saveConfiguration(data, {
    assessmentType: "GUT_REGULARITY",
    status: "PAUSED",
    options: [],
    operatorId: "channel-admin",
  });
  assert.equal(assessmentSourceSurvey.gate(data, "root_source_001", "assessment_source_001").reason, "CONFIG_PAUSED");
});

test("safety results bypass the survey and normal confirmations are immutable", () => {
  const data = createStore();
  data.healthAssessmentAttempts.push(
    completedAttempt(),
    completedAttempt({ assessment_id: "assessment_safety_001", status: "SAFETY_STOPPED" }),
  );
  const config = activeConfig(data);
  assert.equal(
    assessmentSourceSurvey.gate(data, "root_source_001", "assessment_safety_001").reason,
    "SAFETY_RESULT_PRIORITY",
  );

  const result = assessmentSourceSurvey.confirm(data, "root_source_001", "assessment_source_001", {
    optionId: "OFFLINE_EVENT",
    configVersion: config.configVersion,
  }, { now: "2026-08-30T12:00:00.000Z" });
  assert.equal(result.created, true);
  assert.equal(result.confirmation.label, "线下活动");
  assert.equal(
    assessmentSourceSurvey.confirm(data, "root_source_001", "assessment_source_001", {
      optionId: "OFFLINE_EVENT",
      configVersion: config.configVersion,
    }).created,
    false,
  );
  assert.throws(
    () => assessmentSourceSurvey.confirm(data, "root_source_001", "assessment_source_001", {
      optionId: "WECHAT_FRIEND",
      configVersion: config.configVersion,
    }),
    (error) => error.code === "ASSESSMENT_SOURCE_ALREADY_CONFIRMED",
  );
});

test("option identity and config version are validated", () => {
  const data = createStore();
  data.healthAssessmentAttempts.push(completedAttempt());
  const config = activeConfig(data);
  assert.throws(
    () => assessmentSourceSurvey.confirm(data, "root_source_001", "assessment_source_001", {
      optionId: "OFFLINE_EVENT",
      configVersion: config.configVersion - 1,
    }),
    (error) => error.code === "ASSESSMENT_SOURCE_CONFIG_STALE",
  );
  assert.throws(
    () => assessmentSourceSurvey.saveConfiguration(data, {
      status: "ACTIVE",
      options: [
        { optionId: "DUPLICATE", label: "线下活动" },
        { optionId: "DUPLICATE", label: "朋友推荐" },
      ],
    }),
    (error) => error.code === "ASSESSMENT_SOURCE_OPTION_DUPLICATE",
  );
});

test("more than ten configured options stay ordered and selectable", () => {
  const data = createStore();
  data.healthAssessmentAttempts.push(completedAttempt());
  const options = Array.from({ length: 12 }, (_, index) => ({
    optionId: `CHANNEL_${String(index + 1).padStart(2, "0")}`,
    label: `渠道 ${index + 1}`,
    sortOrder: (index + 1) * 10,
  }));
  activeConfig(data, options);
  const gate = assessmentSourceSurvey.gate(data, "root_source_001", "assessment_source_001");
  assert.equal(gate.required, true);
  assert.equal(gate.config.options.length, 12);
  assert.deepEqual(gate.config.options.map((item) => item.optionId), options.map((item) => item.optionId));
});
