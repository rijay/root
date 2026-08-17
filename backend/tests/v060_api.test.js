const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { sessionTokenDigest } = require("../src/credentialProtection");
const { signChannelAttribution } = require("../src/growthEngagement");
const { createEmptyData, createMemoryStore } = require("../src/store");

const TOKEN = "root_v060_api_test_token";
const ROOT_USER_ID = "root_v060_api_user";
const SESSION_ID = "ses_v060_api_test";
const CHANNEL_KEY_ID = "channel-key-v1";
const CHANNEL_SECRET = "channel-attribution-test-secret-at-least-32-characters";

function approvedInitialDefinition() {
  return {
    assessment_definition_id: "had_v060_initial_v1",
    assessment_type: "INITIAL",
    questionnaire_id: "ROOT_INITIAL_BASELINE",
    questionnaire_version: 1,
    title: "初始状态评测",
    description: "API 集成测试题库，不代表正式题库。",
    estimated_minutes: 1,
    status: "ACTIVE",
    content_review_status: "APPROVED",
    professional_review_status: "APPROVED",
    compliance_review_status: "APPROVED",
    result_copy_version: 1,
    dimensions: [{ key: "daily_state", label: "日常状态", direction: "HIGHER_IS_BETTER" }],
    questions: [{
      field: "stateScore",
      type: "scale",
      title: "测试分值",
      required: true,
      min: 1,
      max: 5,
      dimension_key: "daily_state",
    }],
    result_rules: [],
    safety_rules: [],
    default_result_code: "OBSERVE",
    result_copies: [{
      code: "OBSERVE",
      title: "保持观察",
      summary: "测试文案。",
      risk_notice: "不构成诊断。",
    }],
    created_at: "2026-08-17T08:00:00+08:00",
    updated_at: "2026-08-17T08:00:00+08:00",
  };
}

function fixture() {
  const data = createEmptyData();
  const createdAt = "2026-08-17T08:00:00+08:00";
  data.users.push({
    user_id: ROOT_USER_ID,
    root_user_id: ROOT_USER_ID,
    state: "REGISTERED_IDLE",
    app_code: "MYROOT",
    created_at: createdAt,
    updated_at: createdAt,
  });
  data.rootUsers.push({
    root_user_id: ROOT_USER_ID,
    lifecycle_status: "REGISTERED_IDLE",
    source_channel: "TEST",
    unionid_status: "PENDING",
    created_at: createdAt,
    updated_at: createdAt,
  });
  const tokenHash = sessionTokenDigest(TOKEN);
  data.sessions.push({
    session_id: SESSION_ID,
    token_hash: tokenHash,
    user_id: ROOT_USER_ID,
    created_at: createdAt,
    last_seen_at: createdAt,
    expires_at: "2099-01-01T00:00:00+08:00",
    revoked_at: "",
  });
  data.tokens[tokenHash] = ROOT_USER_ID;
  data.healthAssessmentDefinitions.push(approvedInitialDefinition());
  data.campaignDefinitions.push({
    campaign_id: "ROOT_V060_CAMPAIGN",
    title: "ROOT 近期活动",
    status: "ACTIVE",
    start_at: "2026-01-01T00:00:00+08:00",
    end_at: "2099-01-01T00:00:00+08:00",
    config_json: {
      sessionPopup: {
        popupId: "root-v060-popup",
        version: 1,
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        audienceStates: ["REGISTERED_IDLE"],
        title: "发现适合你的日常补给",
        body: "登录后每个会话只展示一次。",
        action: { type: "OPEN_PRODUCT", target: "4749049439", label: "立即探索" },
      },
    },
  });
  data.channelDefinitions.push({
    channel_definition_id: "chd_v060_api",
    channel_id: "V060_API",
    campaign_id: "ROOT_V060_CAMPAIGN",
    status: "ACTIVE",
    signature_key_id: CHANNEL_KEY_ID,
    allowed_target_pages_json: ["/pages/products/index"],
    start_at: "2026-01-01T00:00:00+08:00",
    end_at: "2099-01-01T00:00:00+08:00",
    created_at: createdAt,
    updated_at: createdAt,
  });
  return data;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { status: response.status, payload: await response.json() };
}

function authenticatedHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

test("v0.6 public product and authenticated assessment Interfaces work end to end", async (t) => {
  const storeAdapter = createMemoryStore(fixture(), { seedSampleData: false });
  const server = createApp({ storeAdapter, env: {} });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const products = await request(baseUrl, "/api/v1/products");
  assert.equal(products.status, 200);
  assert.equal(products.payload.code, 0);
  assert.deepEqual(products.payload.data.products.map((item) => item.productId), [
    "4749049439",
    "4875324599",
  ]);

  const product = await request(baseUrl, "/api/v1/products/4875324599");
  assert.equal(product.payload.data.product.youzan.appId, "wxfb75c0b432670215");
  assert.equal(
    product.payload.data.product.youzan.path,
    "packages/goods/detail/index?alias=3f2cc448cksvnmk&shopAutoEnter=1"
  );

  const jump = await request(baseUrl, "/api/v1/products/jump", {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-product-jump-1" }),
    body: JSON.stringify({ productId: "4875324599", sourceChannel: "PRODUCT_DETAIL" }),
  });
  assert.equal(jump.payload.code, 0);
  assert.equal(jump.payload.data.jumpTarget.path, product.payload.data.product.youzan.path);

  const state = await request(baseUrl, "/api/v1/user/state", { headers: authenticatedHeaders() });
  assert.equal(state.payload.data.session.loginSessionId, SESSION_ID);

  const catalog = await request(baseUrl, "/api/v1/health/assessments/catalog", {
    headers: authenticatedHeaders(),
  });
  assert.equal(catalog.payload.code, 0);
  assert.equal(catalog.payload.data.assessments.find((item) => item.assessmentType === "INITIAL").available, true);

  const started = await request(baseUrl, "/api/v1/health/assessments/start", {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-assessment-start-1" }),
    body: JSON.stringify({ assessmentType: "INITIAL" }),
  });
  assert.equal(started.payload.code, 0);
  const assessmentId = started.payload.data.assessment.assessmentId;

  const completed = await request(baseUrl, `/api/v1/health/assessments/${assessmentId}/complete`, {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-assessment-complete-1" }),
    body: JSON.stringify({ answers: { stateScore: 4 } }),
  });
  assert.equal(completed.payload.data.assessment.status, "COMPLETED");

  const history = await request(baseUrl, "/api/v1/health/assessments/history?assessmentType=INITIAL", {
    headers: authenticatedHeaders(),
  });
  assert.equal(history.payload.data.total, 1);
  assert.equal(history.payload.data.assessments[0].answers, undefined);
});

test("v0.6 popup, first-touch channel and safe analytics Interfaces work end to end", async (t) => {
  const data = fixture();
  const storeAdapter = createMemoryStore(data, { seedSampleData: false });
  const server = createApp({
    storeAdapter,
    env: { ROOT_CHANNEL_ATTRIBUTION_KEYS: JSON.stringify({ [CHANNEL_KEY_ID]: CHANNEL_SECRET }) },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const claimed = await request(baseUrl, "/api/v1/operations/popup/claim", {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-popup-claim-1" }),
    body: "{}",
  });
  assert.equal(claimed.payload.data.popup.popupId, "root-v060-popup");

  const repeated = await request(baseUrl, "/api/v1/operations/popup/claim", {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-popup-claim-2" }),
    body: "{}",
  });
  assert.equal(repeated.payload.data.popup, null);
  assert.equal(repeated.payload.data.reason, "ALREADY_CLAIMED");

  const channelInput = {
    channelId: "V060_API",
    campaignId: "ROOT_V060_CAMPAIGN",
    targetPage: "/pages/products/index?productId=4749049439",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    keyId: CHANNEL_KEY_ID,
  };
  channelInput.signature = signChannelAttribution(channelInput, CHANNEL_SECRET);
  const attributed = await request(baseUrl, "/api/v1/channels/attribution", {
    method: "POST",
    headers: authenticatedHeaders({ "X-Idempotency-Key": "v060-channel-1" }),
    body: JSON.stringify(channelInput),
  });
  assert.equal(attributed.payload.data.result, "ATTRIBUTED");

  const analytics = await request(baseUrl, "/api/v1/event/track", {
    method: "POST",
    body: JSON.stringify({
      eventName: "home_product_banner_click",
      payload: { productId: "4749049439", bannerPosition: "HOME_PRIMARY", loggedIn: false },
    }),
  });
  assert.equal(analytics.payload.data.accepted, true);
  assert.equal(JSON.stringify(storeAdapter.data.analyticsEvents).includes(CHANNEL_SECRET), false);
});
