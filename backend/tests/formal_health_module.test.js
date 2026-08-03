const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const formalHealthModule = require("../src/formalHealthModule");
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
  const definition = formalHealthModule.getDefinition(profile, { today: "2026-08-03" }).definition;
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
    () => formalHealthModule.getDefinition({ ...profile, birthDate: "2010-08-04" }, { today: "2026-08-03" }),
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
