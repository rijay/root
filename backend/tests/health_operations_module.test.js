const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../src/app");
const healthOperations = require("../src/healthOperationsModule");
const { createSeedData } = require("../src/seed");
const { createJsonFileStore } = require("../src/store");

const NOW = "2026-08-04T08:00:00.000Z";

function context(operatorId = "health-operator") {
  return { now: NOW, operatorId };
}

function publishInput(version, overrides = {}) {
  return {
    versionId: version.versionId,
    expectedRevision: version.revision,
    confirmed: true,
    confirmationText: "确认发布",
    ...overrides,
  };
}

function scaleInput(overrides = {}) {
  return {
    name: "Root 睡眠状态评测",
    questionSummary: "12 道单选题；每组最多 20 题；预计 3 分钟完成",
    scoringSummary: "总分 0–24；按 0–7、8–15、16–24 分为三层",
    audience: "ADULT_18_PLUS",
    questionCount: 12,
    resultLevelCount: 3,
    questions: [
      {
        id: "sleep_quality",
        title: "过去一周，你通常觉得睡眠恢复程度如何？",
        type: "SINGLE",
        required: true,
        options: [
          { value: "good", label: "恢复较好", score: 0 },
          { value: "fair", label: "一般", score: 1 },
          { value: "poor", label: "恢复较差", score: 2 },
        ],
      },
      {
        id: "sleep_rhythm",
        title: "过去一周，你的入睡和起床时间规律吗？",
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
      { id: "steady", minScore: 0, maxScore: 1, title: "节律较稳", summary: "目前的睡眠节律相对稳定。", tips: ["继续保持固定起床时间"] },
      { id: "watch", minScore: 2, maxScore: 2, title: "留意波动", summary: "近期睡眠状态有一些波动。", tips: ["先记录一周睡眠时间"] },
      { id: "adjust", minScore: 3, maxScore: 4, title: "优先调整", summary: "可以优先从作息节律开始调整。", tips: ["逐步固定入睡与起床时间"] },
    ],
    adviceVersionId: "ROOT4U_FIXED_CONTENT_V1",
    approver: "健康内容负责人",
    effectiveAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

test("initialization draft preserves 12 questions, detects conflicts and becomes the published runtime definition", () => {
  const data = createSeedData();
  const baseline = healthOperations.listInitialization(data, { page: 1, pageSize: 20 });
  assert.equal(baseline.items.length, 12);
  assert.equal(baseline.currentStatus, "CANDIDATE");
  assert.throws(
    () => healthOperations.saveInitializationDraft(data, {
      questionId: "unknown-question",
      title: "无效题目",
      options: ["无效选项"],
      hitAction: "不应写入",
      guidanceVersionId: "ROOT4U_FIXED_SAFETY_V1",
    }, context()),
    { code: "HEALTH_CONTENT_INPUT_INVALID" },
  );
  assert.equal(data.healthContentVersions.length, 0);

  const copied = healthOperations.saveInitializationDraft(data, {
    action: "COPY_VERSION",
    sourceVersion: baseline.currentVersion,
  }, context()).version;
  const safetyQuestion = baseline.items.find((item) => item.id === "safety");
  const edited = healthOperations.saveInitializationDraft(data, {
    versionId: copied.versionId,
    expectedRevision: copied.revision,
    questionId: "safety",
    title: safetyQuestion.title,
    options: safetyQuestion.options.map((item) => item.label),
    routing: { risk: "RISK", special: "SPECIAL", standard: "STANDARD" },
    hitAction: "停止普通建议，展示固定安全指引",
    guidanceVersionId: "ROOT4U_FIXED_SAFETY_V1",
  }, context()).version;

  assert.throws(
    () => healthOperations.saveInitializationDraft(data, {
      versionId: copied.versionId,
      expectedRevision: copied.revision,
      questionId: "safety",
      title: safetyQuestion.title,
      options: safetyQuestion.options.map((item) => item.label),
      hitAction: "stale write",
      guidanceVersionId: "ROOT4U_FIXED_SAFETY_V1",
    }, context("second-operator")),
    { code: "HEALTH_CONTENT_REVISION_CONFLICT" },
  );
  assert.throws(
    () => healthOperations.publishInitialization(data, publishInput(edited, { confirmed: false }), context()),
    { code: "HEALTH_CONTENT_PUBLISH_CONFIRMATION_REQUIRED" },
  );

  const published = healthOperations.publishInitialization(data, publishInput(edited), context()).version;
  const definition = healthOperations.resolveInitializationDefinition(data, { gender: "FEMALE" });
  assert.equal(published.status, "PUBLISHED");
  assert.equal(definition.questions.length, 12);
  assert.equal(definition.version, published.version);
  assert.equal(definition.questions[2].options.some((item) => item.value === "pregnancy"), true);
});

test("scale publishing validates complete metadata and published versions are immutable", () => {
  const data = createSeedData();
  const incomplete = healthOperations.saveScaleDraft(data, scaleInput({ approver: "" }), context()).version;
  assert.throws(
    () => healthOperations.publishScale(data, publishInput(incomplete), context()),
    { code: "HEALTH_CONTENT_VALIDATION_FAILED" },
  );

  const completed = healthOperations.saveScaleDraft(data, {
    ...scaleInput(),
    versionId: incomplete.versionId,
    expectedRevision: incomplete.revision,
  }, context()).version;
  const published = healthOperations.publishScale(data, publishInput(completed), context()).version;
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.questionCount, 2);
  assert.equal(published.resultLevelCount, 3);
  assert.equal(healthOperations.listScales(data, { status: "PUBLISHED" }).items.length, 1);
  assert.throws(
    () => healthOperations.saveScaleDraft(data, {
      ...scaleInput(),
      versionId: published.versionId,
      expectedRevision: published.revision,
    }, context()),
    { code: "HEALTH_CONTENT_PUBLISHED_IMMUTABLE" },
  );
});

test("scale publishing rejects gaps, overlaps and incomplete real question definitions", () => {
  const data = createSeedData();
  const missingQuestions = healthOperations.saveScaleDraft(data, scaleInput({ questions: [] }), context()).version;
  assert.throws(
    () => healthOperations.publishScale(data, publishInput(missingQuestions), context()),
    (error) => error.code === "HEALTH_CONTENT_VALIDATION_FAILED" && /至少包含 1 道真实题目/.test(error.message),
  );

  const invalidLevels = healthOperations.saveScaleDraft(data, scaleInput({
    resultLevels: [
      { id: "low", minScore: 0, maxScore: 1, title: "较稳", summary: "状态较稳。", tips: [] },
      { id: "high", minScore: 3, maxScore: 4, title: "需调整", summary: "建议开始调整。", tips: [] },
    ],
  }), context()).version;
  assert.throws(
    () => healthOperations.publishScale(data, publishInput(invalidLevels), context()),
    (error) => error.code === "HEALTH_CONTENT_VALIDATION_FAILED" && /连续且不重叠/.test(error.message),
  );
});

test("recommendation rules publish only against a published scale version", () => {
  const data = createSeedData();
  const scaleDraft = healthOperations.saveScaleDraft(data, scaleInput(), context()).version;
  const ruleDraft = healthOperations.saveRecommendationRuleDraft(data, {
    primaryCategory: "SLEEP",
    auxiliaryTags: ["睡眠不足或不规律"],
    matchSummary: "优先推荐睡眠状态评测",
    priority: 10,
    matchMode: "ANY",
    maxRecommendations: 2,
    scaleVersionId: scaleDraft.versionId,
    effectiveAt: "2026-08-05T00:00:00.000Z",
  }, context()).version;
  assert.throws(
    () => healthOperations.publishRecommendationRule(data, publishInput(ruleDraft), context()),
    { code: "HEALTH_CONTENT_VALIDATION_FAILED" },
  );

  const scale = healthOperations.publishScale(data, publishInput(scaleDraft), context()).version;
  const updatedRule = healthOperations.saveRecommendationRuleDraft(data, {
    versionId: ruleDraft.versionId,
    expectedRevision: ruleDraft.revision,
    primaryCategory: "SLEEP",
    auxiliaryTags: ["睡眠不足或不规律"],
    matchSummary: "优先推荐睡眠状态评测",
    priority: 10,
    matchMode: "ANY",
    maxRecommendations: 2,
    scaleVersionId: scale.versionId,
    effectiveAt: "2026-08-05T00:00:00.000Z",
  }, context()).version;
  const published = healthOperations.publishRecommendationRule(data, publishInput(updatedRule), context()).version;
  assert.equal(published.status, "PUBLISHED");
  assert.equal(healthOperations.listRecommendationRules(data, {}).items[0].scaleName, scaleInput().name);
});

test("published recommendation rules resolve deterministic, versioned scale cards", () => {
  const data = createSeedData();
  const scale = healthOperations.publishScale(data, publishInput(
    healthOperations.saveScaleDraft(data, scaleInput({ effectiveAt: "2026-08-03T00:00:00.000Z" }), context()).version,
  ), context()).version;
  const rule = healthOperations.publishRecommendationRule(data, publishInput(
    healthOperations.saveRecommendationRuleDraft(data, {
      primaryCategory: "BOWEL",
      auxiliaryTags: ["饮水偏少"],
      matchSummary: "饮水偏少时推荐睡眠状态评测用于继续观察",
      priority: 10,
      matchMode: "ALL",
      maxRecommendations: 1,
      scaleVersionId: scale.versionId,
      effectiveAt: "2026-08-03T00:00:00.000Z",
    }, context()).version,
  ), context()).version;
  const preferredRule = healthOperations.publishRecommendationRule(data, publishInput(
    healthOperations.saveRecommendationRuleDraft(data, {
      primaryCategory: "BOWEL",
      auxiliaryTags: ["饮水偏少"],
      matchSummary: "同一量表的更高优先级规则",
      priority: 5,
      matchMode: "ALL",
      maxRecommendations: 1,
      scaleVersionId: scale.versionId,
      effectiveAt: "2026-08-03T00:00:00.000Z",
    }, context()).version,
  ), context()).version;

  assert.deepEqual(
    healthOperations.resolvePublishedRecommendations(data, {
      categoryCode: "BOWEL",
      tags: ["饮水偏少"],
    }, context()),
    [{
      title: scale.name,
      availability: "PUBLISHED",
      scaleVersionId: scale.versionId,
      scaleVersionLabel: scale.versionLabel,
      recommendationRuleVersionId: preferredRule.versionId,
      recommendationRuleVersionLabel: preferredRule.versionLabel,
      questionCount: 2,
      estimatedMinutes: 1,
      audienceLabel: "18 岁及以上",
    }],
  );
  assert.notEqual(rule.versionId, preferredRule.versionId);
  assert.deepEqual(healthOperations.resolvePublishedRecommendations(data, {
    categoryCode: "BOWEL",
    tags: [],
  }, context()), []);
});

test("lifestyle policy supports fixed-only launch without model credentials", () => {
  const data = createSeedData();
  const draft = healthOperations.saveLifestyleAdviceDraft(data, {
    name: "Root4U 首发固定建议策略",
    modelConfigurationId: "FIXED_ONLY",
    minimumFields: ["PRIMARY_CATEGORY", "AUXILIARY_TAGS", "ASSESSMENT_RESULTS"],
    regenerationTrigger: "PROFILE_OR_ASSESSMENT_CHANGED",
    rotationSize: 3,
    validation: { structure: "REQUIRED", prohibitedLanguage: "REQUIRED", healthSafety: "REQUIRED" },
    fallbackContentVersionId: "ROOT4U_FIXED_CONTENT_V1",
    approver: "健康内容负责人",
    effectiveAt: "2026-08-05T00:00:00.000Z",
  }, context()).version;
  const published = healthOperations.publishLifestyleAdvice(data, publishInput(draft), context()).version;
  const page = healthOperations.listLifestyleAdvice(data, {});

  assert.equal(published.status, "ACTIVE");
  assert.equal(page.items[0].status, "ACTIVE");
  assert.deepEqual(page.modelConfigurations, [{ id: "FIXED_ONLY", label: "首发固定内容（不调用模型）" }]);
  assert.equal(JSON.stringify(page).includes("secret"), false);
  assert.equal(healthOperations.resolvePublishedLifestylePolicy(data, context()), null);
  assert.deepEqual(healthOperations.resolvePublishedLifestylePolicy(data, {
    now: "2026-08-06T08:00:00.000Z",
    operatorId: "health-operator",
  }), {
    advicePolicyVersionId: published.versionId,
    advicePolicyVersionLabel: published.versionLabel,
    adviceContentVersionId: "ROOT4U_FIXED_CONTENT_V1",
    adviceMode: "FIXED_ONLY",
  });
});

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

test("health operations HTTP Interface separates read, draft and publish capabilities and writes safe audit facts", async (t) => {
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-health-secret", role: "viewer" },
        operator: { token: "operator-health-secret", role: "operator" },
        publisher: { token: "publisher-health-secret", role: "admin" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const viewer = { "X-Admin-Token": "viewer-health-secret" };
  const operator = { "X-Admin-Token": "operator-health-secret" };
  const publisher = { "X-Admin-Token": "publisher-health-secret" };

  const read = await request(baseUrl, "/api/v1/admin/formal-health/scales", { headers: viewer });
  assert.equal(read.status, 200);
  const saved = await request(baseUrl, "/api/v1/admin/formal-health/scales/draft", {
    method: "POST",
    headers: { ...operator, "X-Request-Id": "health-scale-save-http", "X-Idempotency-Key": "health-scale-save-http" },
    body: JSON.stringify(scaleInput()),
  });
  assert.equal(saved.status, 200);
  const blocked = await request(baseUrl, "/api/v1/admin/formal-health/scales/publish", {
    method: "POST",
    headers: { ...operator, "X-Request-Id": "health-scale-publish-operator", "X-Idempotency-Key": "health-scale-publish-operator" },
    body: JSON.stringify(publishInput(saved.body.data.version)),
  });
  assert.equal(blocked.status, 403);
  const published = await request(baseUrl, "/api/v1/admin/formal-health/scales/publish", {
    method: "POST",
    headers: { ...publisher, "X-Request-Id": "health-scale-publish-http", "X-Idempotency-Key": "health-scale-publish-http" },
    body: JSON.stringify(publishInput(saved.body.data.version)),
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.data.version.status, "PUBLISHED");
  assert.equal(server.store.auditLogs.some((item) => item.action === "HEALTH_SCALE_PUBLISH"), true);
  assert.equal(JSON.stringify(server.store.auditLogs).includes("answers_json"), false);
});

test("health operation writes survive a persistent store reload", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-health-operations-"));
  const storePath = path.join(tempDir, "store.json");
  try {
    const firstStore = createJsonFileStore(storePath, { seedSampleData: false });
    const server = createApp({
      storeAdapter: firstStore,
      env: { ROOT_ADMIN_TOKENS: JSON.stringify({ publisher: { token: "persistent-health-secret", role: "admin" } }) },
    });
    const baseUrl = await listen(server);
    const saved = await request(baseUrl, "/api/v1/admin/formal-health/scales/draft", {
      method: "POST",
      headers: {
        "X-Admin-Token": "persistent-health-secret",
        "X-Request-Id": "persistent-health-scale-save",
        "X-Idempotency-Key": "persistent-health-scale-save",
      },
      body: JSON.stringify(scaleInput()),
    });
    assert.equal(saved.status, 200);
    await new Promise((resolve) => server.close(resolve));

    const reloaded = createJsonFileStore(storePath, { seedSampleData: false });
    assert.equal(reloaded.data.healthContentVersions.length, 1);
    assert.equal(reloaded.data.healthContentVersions[0].content_json.name, scaleInput().name);
    assert.equal(reloaded.validateSnapshot().valid, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
