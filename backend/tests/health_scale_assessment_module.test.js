const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const healthOperations = require("../src/healthOperationsModule");
const healthScaleAssessment = require("../src/healthScaleAssessmentModule");
const { createSeedData } = require("../src/seed");

const NOW = "2026-08-04T08:00:00.000Z";

function fixture(overrides = {}) {
  const data = createSeedData();
  const user = { user_id: "usr_scale", root_user_id: "usr_scale" };
  const profile = { complete: true, birthDate: "1990-08-03", gender: "FEMALE" };
  const draft = healthOperations.saveScaleDraft(data, {
    name: "Root 睡眠节律评测",
    questionSummary: "2 道必答单选题",
    scoringSummary: "由后端按已发布版本计分",
    audience: "ADULT_18_PLUS",
    questions: [
      {
        id: "quality",
        title: "过去一周，醒来后通常感觉如何？",
        type: "SINGLE",
        required: true,
        options: [
          { value: "rested", label: "比较轻松", score: 0 },
          { value: "average", label: "一般", score: 1 },
          { value: "tired", label: "仍感疲惫", score: 2 },
        ],
      },
      {
        id: "rhythm",
        title: "过去一周，作息时间规律吗？",
        type: "SINGLE",
        required: true,
        options: [
          { value: "regular", label: "大多规律", score: 0 },
          { value: "variable", label: "偶有波动", score: 1 },
          { value: "irregular", label: "经常不规律", score: 2 },
        ],
      },
    ],
    resultLevels: [
      { id: "steady", minScore: 0, maxScore: 1, title: "节律较稳", summary: "目前节律相对稳定。", tips: ["继续保持固定起床时间"] },
      { id: "watch", minScore: 2, maxScore: 2, title: "留意波动", summary: "近期状态有一些波动。", tips: ["先记录一周睡眠时间"] },
      { id: "adjust", minScore: 3, maxScore: 4, title: "优先调整", summary: "可以优先从作息节律开始调整。", tips: ["逐步固定入睡与起床时间"] },
    ],
    adviceVersionId: healthOperations.FIXED_CONTENT_VERSION_ID,
    approver: "健康内容负责人",
    effectiveAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }, { now: NOW, operatorId: "health-operator" }).version;
  const scale = healthOperations.publishScale(data, {
    versionId: draft.versionId,
    expectedRevision: draft.revision,
    confirmed: true,
    confirmationText: "确认发布",
  }, { now: NOW, operatorId: "health-operator" }).version;
  return { data, user, profile, scale };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { status: response.status, body: await response.json() };
}

test("published scale exposes answerable questions without scores or thresholds", () => {
  const { data, profile, scale } = fixture();
  const definition = healthScaleAssessment.getDefinition(data, scale.versionId, profile, {}, { today: "2026-08-04", now: NOW }).definition;
  assert.equal(definition.questions.length, 2);
  assert.equal(definition.versionId, scale.versionId);
  assert.equal(definition.groupSize, 20);
  assert.equal(definition.groupCount, 1);
  assert.equal(JSON.stringify(definition).includes("score"), false);
  assert.equal(JSON.stringify(definition).includes("minScore"), false);
  assert.equal(JSON.stringify(definition).includes("resultLevels"), false);
  assert.throws(
    () => healthScaleAssessment.getDefinition(data, scale.versionId, profile, { group: 2 }, { today: "2026-08-04", now: NOW }),
    { code: "HEALTH_SCALE_GROUP_INVALID" },
  );
});

test("long scales expose at most 20 questions per group", () => {
  const questions = Array.from({ length: 21 }, (_, index) => ({
    id: `question_${index + 1}`,
    title: `第 ${index + 1} 个日常状态问题`,
    type: "SINGLE",
    required: true,
    options: Array.from({ length: 10 }, (_, optionIndex) => ({
      value: `option_${optionIndex + 1}`,
      label: `${optionIndex + 1}-${"日常状态描述".repeat(20)}`,
      score: optionIndex,
    })),
  }));
  const { data, profile, scale } = fixture({
    questions,
    resultLevels: [{ id: "all", minScore: 0, maxScore: 189, title: "状态记录", summary: "用于整理日常状态。", tips: [] }],
  });
  const first = healthScaleAssessment.getDefinition(data, scale.versionId, profile, { group: 1 }, { today: "2026-08-04", now: NOW }).definition;
  const second = healthScaleAssessment.getDefinition(data, scale.versionId, profile, { group: 2 }, { today: "2026-08-04", now: NOW }).definition;
  assert.equal(first.questions.length, 20);
  assert.equal(second.questions.length, 1);
  assert.equal(second.questionOffset, 20);
  assert.equal(JSON.stringify(second).includes("score"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(first), "utf8") < 80 * 1024);
});

test("scale submission validates all answers and calculates from server-owned scores", () => {
  const { data, user, profile, scale } = fixture();
  assert.throws(
    () => healthScaleAssessment.submit(data, user, profile, scale.versionId, { answers: { quality: "tired" } }, { today: "2026-08-04", now: NOW }),
    { code: "HEALTH_SCALE_ANSWER_REQUIRED" },
  );
  assert.throws(
    () => healthScaleAssessment.submit(data, user, profile, scale.versionId, { answers: { quality: "tired", rhythm: "forged", totalScore: 0 } }, { today: "2026-08-04", now: NOW }),
    { code: "HEALTH_SCALE_ANSWER_INVALID" },
  );

  const submitted = healthScaleAssessment.submit(data, user, profile, scale.versionId, {
    answers: { quality: "tired", rhythm: "variable" },
    score: 0,
    idempotencyKey: "scale-submit-1",
  }, { today: "2026-08-04", now: NOW });
  assert.equal(submitted.result.score, 3);
  assert.equal(submitted.result.levelTitle, "优先调整");
  assert.equal(submitted.result.scaleVersionId, scale.versionId);
  assert.equal(Object.hasOwn(submitted.result, "answers"), false);
  assert.deepEqual(data.healthScaleResponses[0].answers_json, { quality: "tired", rhythm: "variable" });
});

test("latest scale result is versioned and production writes remain closed", () => {
  const { data, user, profile, scale } = fixture();
  assert.throws(
    () => healthScaleAssessment.submit(data, user, profile, scale.versionId, {
      answers: { quality: "rested", rhythm: "regular" },
    }, { today: "2026-08-04", now: NOW, env: { NODE_ENV: "production" } }),
    { code: "FORMAL_HEALTH_WRITES_DISABLED", status: 503 },
  );
  assert.equal(data.healthScaleResponses.length, 0);

  const submitted = healthScaleAssessment.submit(data, user, profile, scale.versionId, {
    answers: { quality: "rested", rhythm: "regular" },
  }, { today: "2026-08-04", now: NOW });
  assert.deepEqual(healthScaleAssessment.latestResult(data, user, scale.versionId), submitted.result);
});

test("scale HTTP Interface requires consent, is idempotent and supports result recovery", async (t) => {
  const { data, scale } = fixture();
  const server = createApp({
    store: data,
    env: {
      ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true",
      ROOT_REQUIRE_HEALTH_CONSENT: "true",
      ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
      ROOT_PRIVACY_CONTACT: "privacy@example.com",
      ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
      ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000886", flowVersion: "FORMAL_LAUNCH_V1" }),
  });
  const auth = { Authorization: `Bearer ${login.body.data.token}` };
  await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ nickname: "量表用户", birthDate: "1990-08-03", gender: "FEMALE" }),
  });
  const blocked = await request(baseUrl, `/api/v1/health/root4u/scales/${scale.versionId}`, { headers: auth });
  const consent = await request(baseUrl, "/api/v1/privacy/health-consent", { headers: auth });
  await request(baseUrl, "/api/v1/privacy/health-consent", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ decision: "GRANTED", policyVersion: consent.body.data.notice.policyVersion }),
  });
  const definition = await request(baseUrl, `/api/v1/health/root4u/scales/${scale.versionId}`, { headers: auth });
  const submission = {
    method: "POST",
    headers: { ...auth, "X-Idempotency-Key": "scale-http-1" },
    body: JSON.stringify({ answers: { quality: "tired", rhythm: "variable" }, idempotencyKey: "scale-http-1" }),
  };
  const submitted = await request(baseUrl, `/api/v1/health/root4u/scales/${scale.versionId}/responses`, submission);
  const repeated = await request(baseUrl, `/api/v1/health/root4u/scales/${scale.versionId}/responses`, submission);
  const latest = await request(baseUrl, `/api/v1/health/root4u/scales/${scale.versionId}/responses/latest`, { headers: auth });

  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 45101);
  assert.equal(definition.status, 200, JSON.stringify(definition.body));
  assert.equal(definition.body.data.definition.questions.length, 2);
  assert.equal(JSON.stringify(definition.body.data).includes("score"), false);
  assert.equal(submitted.body.data.result.score, 3);
  assert.equal(repeated.body.data.result.responseId, submitted.body.data.result.responseId);
  assert.equal(latest.body.data.result.responseId, submitted.body.data.result.responseId);
  assert.equal(Object.hasOwn(latest.body.data.result, "answers"), false);
});
