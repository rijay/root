const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const formalHealthModule = require("../src/formalHealthModule");
const healthOperations = require("../src/healthOperationsModule");
const profileModule = require("../src/profileModule");
const { createSeedData } = require("../src/seed");

const consentEnv = {
  ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true",
  ROOT_REQUIRE_HEALTH_CONSENT: "true",
  ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
  ROOT_PRIVACY_CONTACT: "privacy@example.com",
  ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
  ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
};

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

function fixture() {
  const data = createSeedData();
  const user = {
    user_id: "usr_root4u",
    root_user_id: "usr_root4u",
    phone: "13800138000",
    state: "REGISTERED_IDLE",
  };
  data.users.push(user);
  profileModule.save(data, user, { birthDate: "1990-08-03", gender: "FEMALE", nickname: "Root用户" });
  return { data, user, profile: profileModule.read(data, user).profile };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

test("Root4U initial assessment uses all 12 required questions and produces three tips", () => {
  const { data, user, profile } = fixture();
  const definition = formalHealthModule.getDefinition(data, profile, { today: "2026-08-03" }).definition;
  assert.equal(definition.questions.length, 12);

  const submitted = formalHealthModule.submit(data, user, profile, { answers: answers() }, {
    today: "2026-08-03",
    now: "2026-08-03T08:00:00.000Z",
  });
  assert.equal(submitted.result.categoryTitle, "肠道规律关注型");
  assert.equal(submitted.result.tips.length, 3);
  assert.deepEqual(submitted.result.tags, ["饮水偏少"]);
  assert.equal(data.questionnaireAnswers[0].campaign_id, "ROOT4U");
  assert.throws(
    () => formalHealthModule.submit(data, user, profile, { answers: answers() }, { today: "2026-08-03" }),
    (error) => error.code === "FORMAL_HEALTH_ALREADY_COMPLETED",
  );
});

test("Root4U fails closed for minors, missing answers and safety signals", () => {
  const { data, user, profile } = fixture();
  assert.throws(
    () => formalHealthModule.getDefinition(data, { ...profile, birthDate: "2010-08-04" }, { today: "2026-08-03" }),
    (error) => error.code === "FORMAL_HEALTH_AGE_RESTRICTED",
  );
  assert.throws(
    () => formalHealthModule.submit(data, user, profile, { answers: answers({ primary_goal: "" }) }, { today: "2026-08-03" }),
    (error) => error.code === "FORMAL_HEALTH_ANSWER_REQUIRED",
  );
  const safetyResult = formalHealthModule.resultFor(answers({ safety: ["self_harm"] }));
  assert.equal(safetyResult.safetyStatus, "PROFESSIONAL_SUPPORT_RECOMMENDED");
  assert.equal(safetyResult.recommendations.length, 0);
  assert.match(safetyResult.categoryTitle, /不继续生成/);
});

test("every published safety signal reaches fixed guidance through the formal Module", () => {
  const signals = [
    "pregnancy", "medical_diet", "major_treatment", "recent_acute",
    "blood_stool", "acute_digestive", "weight_loss", "self_harm",
  ];
  for (const signal of signals) {
    const result = formalHealthModule.resultFor(answers({ safety: [signal] }));
    assert.equal(result.adviceSource, "FIXED_SAFETY_CONTENT", signal);
    assert.equal(result.recommendations.length, 0, signal);
  }
});

test("Root4U persists versioned scoring only after safety passes", () => {
  const standard = fixture();
  formalHealthModule.submit(
    standard.data,
    standard.user,
    standard.profile,
    { answers: answers() },
    { today: "2026-08-03", now: "2026-08-03T08:00:00.000Z" },
  );
  const standardTrace = standard.data.questionnaireAnswers[0].answers_json.evaluation;
  assert.equal(standardTrace.safety.status, "STANDARD_GUIDANCE");
  assert.equal(standardTrace.assessment.scoringVersion, 1);
  assert.equal(standardTrace.assessment.categoryCode, "BOWEL");

  const risk = fixture();
  const submitted = formalHealthModule.submit(
    risk.data,
    risk.user,
    risk.profile,
    { answers: answers({ safety: ["blood_stool"] }) },
    { today: "2026-08-03", now: "2026-08-03T08:00:00.000Z" },
  );
  const riskTrace = risk.data.questionnaireAnswers[0].answers_json.evaluation;
  assert.equal(riskTrace.safety.status, "PROFESSIONAL_SUPPORT_RECOMMENDED");
  assert.equal(riskTrace.assessment, null);
  assert.equal(submitted.result.adviceSource, "FIXED_SAFETY_CONTENT");
  assert.equal(submitted.result.recommendations.length, 0);
});

test("Root4U submission freezes published recommendation versions into the user result", () => {
  const { data, user, profile } = fixture();
  const operationsContext = { now: "2026-08-03T08:00:00.000Z", operatorId: "health-publisher" };
  const scaleDraft = healthOperations.saveScaleDraft(data, {
    name: "Root 肠道规律评测",
    questionSummary: "12 道单选题；预计 3 分钟完成",
    scoringSummary: "总分 0–24；分为三个结果层级",
    audience: "ADULT_18_PLUS",
    questionCount: 12,
    resultLevelCount: 3,
    questions: [{
      id: "bowel_rhythm",
      title: "过去一周，你的排便节律稳定吗？",
      type: "SINGLE",
      required: true,
      options: [
        { value: "steady", label: "比较稳定", score: 0 },
        { value: "variable", label: "有些波动", score: 1 },
      ],
    }],
    resultLevels: [
      { id: "steady", minScore: 0, maxScore: 0, title: "节律较稳", summary: "目前节律相对稳定。", tips: ["继续保持记录"] },
      { id: "variable", minScore: 1, maxScore: 1, title: "留意波动", summary: "近期节律有一些波动。", tips: ["观察饮水与作息"] },
    ],
    adviceVersionId: "ROOT4U_FIXED_CONTENT_V1",
    approver: "健康内容负责人",
    effectiveAt: "2026-08-03T00:00:00.000Z",
  }, operationsContext).version;
  const scale = healthOperations.publishScale(data, {
    versionId: scaleDraft.versionId,
    expectedRevision: scaleDraft.revision,
    confirmed: true,
    confirmationText: "确认发布",
  }, operationsContext).version;
  const ruleDraft = healthOperations.saveRecommendationRuleDraft(data, {
    primaryCategory: "BOWEL",
    auxiliaryTags: ["饮水偏少"],
    matchSummary: "肠道规律且饮水偏少时继续完成专项评测",
    priority: 10,
    matchMode: "ALL",
    maxRecommendations: 1,
    scaleVersionId: scale.versionId,
    effectiveAt: "2026-08-03T00:00:00.000Z",
  }, operationsContext).version;
  const rule = healthOperations.publishRecommendationRule(data, {
    versionId: ruleDraft.versionId,
    expectedRevision: ruleDraft.revision,
    confirmed: true,
    confirmationText: "确认发布",
  }, operationsContext).version;
  const policyDraft = healthOperations.saveLifestyleAdviceDraft(data, {
    name: "Root4U 首发固定建议策略",
    modelConfigurationId: "FIXED_ONLY",
    minimumFields: ["PRIMARY_CATEGORY", "AUXILIARY_TAGS", "ASSESSMENT_RESULTS"],
    regenerationTrigger: "PROFILE_OR_ASSESSMENT_CHANGED",
    rotationSize: 3,
    validation: { structure: "REQUIRED", prohibitedLanguage: "REQUIRED", healthSafety: "REQUIRED" },
    fallbackContentVersionId: "ROOT4U_FIXED_CONTENT_V1",
    approver: "健康内容负责人",
    effectiveAt: "2026-08-03T00:00:00.000Z",
  }, operationsContext).version;
  const policy = healthOperations.publishLifestyleAdvice(data, {
    versionId: policyDraft.versionId,
    expectedRevision: policyDraft.revision,
    confirmed: true,
    confirmationText: "确认发布",
  }, operationsContext).version;

  const submitted = formalHealthModule.submit(data, user, profile, { answers: answers() }, {
    today: "2026-08-03",
    now: "2026-08-03T08:30:00.000Z",
  });
  assert.equal(submitted.result.recommendations.length, 1);
  assert.equal(submitted.result.recommendations[0].title, "Root 肠道规律评测");
  assert.equal(submitted.result.recommendations[0].availability, "PUBLISHED");
  assert.equal(submitted.result.recommendations[0].scaleVersionId, scale.versionId);
  assert.equal(submitted.result.recommendations[0].recommendationRuleVersionId, rule.versionId);
  assert.equal(submitted.result.advicePolicyVersionId, policy.versionId);
  assert.equal(submitted.result.adviceContentVersionId, "ROOT4U_FIXED_CONTENT_V1");
  assert.equal(submitted.result.adviceMode, "FIXED_ONLY");
  assert.deepEqual(data.questionnaireAnswers[0].answers_json.result.recommendations, submitted.result.recommendations);
});

test("Root4U production writes stay closed until explicitly enabled", () => {
  const blocked = fixture();
  assert.throws(
    () => formalHealthModule.submit(
      blocked.data,
      blocked.user,
      blocked.profile,
      { answers: answers() },
      { today: "2026-08-03", env: { NODE_ENV: "production" } },
    ),
    { code: "FORMAL_HEALTH_WRITES_DISABLED", status: 503 },
  );
  assert.equal(blocked.data.questionnaireAnswers.length, 0);

  const enabled = fixture();
  const submitted = formalHealthModule.submit(
    enabled.data,
    enabled.user,
    enabled.profile,
    { answers: answers() },
    {
      today: "2026-08-03",
      env: { NODE_ENV: "production", ROOT_FORMAL_HEALTH_WRITES_ENABLED: "true" },
    },
  );
  assert.equal(submitted.success, true);
});

test("Root4U admin initialization projection is bounded and never includes user answers", () => {
  const page = formalHealthModule.adminInitializationDefinition({ page: 1, pageSize: 20 });
  assert.equal(page.items.length, 12);
  assert.equal(page.pagination.total, 12);
  assert.equal(page.items[2].routing, "SAFETY");
  assert.equal(page.items[2].status, "CANDIDATE");
  assert.equal(page.items[2].optionCount, 9);
  assert.equal(JSON.stringify(page).includes("answers_json"), false);
  assert.equal(formalHealthModule.adminInitializationDefinition({ keyword: "安全" }).items.length, 1);
  assert.throws(
    () => formalHealthModule.adminInitializationDefinition({ pageSize: 51 }),
    (error) => error.code === "FORMAL_HEALTH_ADMIN_QUERY_INVALID" && error.status === 400,
  );
});

test("Root4U HTTP Interface requires consent and returns only derived result on bootstrap", async (t) => {
  const server = createApp({ env: consentEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000884", flowVersion: "FORMAL_LAUNCH_V1" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ nickname: "Root4U用户", birthDate: "1990-08-03", gender: "FEMALE" }),
  });

  const bootstrapBefore = await request(baseUrl, "/api/v1/health/root4u", { headers: auth });
  const adminInitialization = await request(baseUrl, "/api/v1/admin/formal-health/initialization?keyword=%E5%AE%89%E5%85%A8");
  const blocked = await request(baseUrl, "/api/v1/health/root4u/initial-assessment", { headers: auth });
  const consent = await request(baseUrl, "/api/v1/privacy/health-consent", { headers: auth });
  await request(baseUrl, "/api/v1/privacy/health-consent", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ decision: "GRANTED", policyVersion: consent.data.notice.policyVersion }),
  });
  const definition = await request(baseUrl, "/api/v1/health/root4u/initial-assessment", { headers: auth });
  const submitted = await request(baseUrl, "/api/v1/health/root4u/initial-assessment", {
    method: "POST",
    headers: { ...auth, "X-Idempotency-Key": "root4u-http-initial-1" },
    body: JSON.stringify({ answers: answers(), idempotencyKey: "root4u-http-initial-1" }),
  });
  const bootstrapAfter = await request(baseUrl, "/api/v1/health/root4u", { headers: auth });

  assert.equal(bootstrapBefore.data.consentRequired, true);
  assert.equal(adminInitialization.data.items.length, 1);
  assert.equal(adminInitialization.data.items[0].routing, "SAFETY");
  assert.equal(JSON.stringify(adminInitialization.data).includes("13800000884"), false);
  assert.equal(blocked.code, 45101);
  assert.equal(definition.data.definition.questions.length, 12);
  assert.equal(submitted.data.result.tips.length, 3);
  assert.equal(bootstrapAfter.data.assessmentState, "COMPLETED");
  assert.equal(bootstrapAfter.data.result.categoryTitle, "肠道规律关注型");
  assert.equal(Object.hasOwn(bootstrapAfter.data.result, "answers"), false);
});
