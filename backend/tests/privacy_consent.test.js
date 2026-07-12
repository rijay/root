const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createSeedData } = require("../src/seed");
const privacyConsent = require("../src/privacyConsent");

const consentEnv = {
  ROOT_REQUIRE_HEALTH_CONSENT: "true",
  ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
  ROOT_PRIVACY_CONTACT: "privacy@example.com",
  ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
  ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
};

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

test("health consent records grant and withdrawal as append-only decisions", () => {
  const data = createSeedData();
  const rootUserId = "root_privacy_unit";
  const context = { env: consentEnv };

  assert.throws(
    () => privacyConsent.requireHealthConsent(data, rootUserId, context),
    (error) => error.code === 45101
  );
  const granted = privacyConsent.recordHealthConsentDecision(data, rootUserId, {
    decision: "GRANTED",
    policyVersion: privacyConsent.HEALTH_CONSENT_POLICY_VERSION,
  }, context);
  assert.equal(granted.active, true);
  assert.equal(granted.recorded, true);

  const unchanged = privacyConsent.recordHealthConsentDecision(data, rootUserId, {
    decision: "GRANTED",
    policyVersion: privacyConsent.HEALTH_CONSENT_POLICY_VERSION,
  }, context);
  assert.equal(unchanged.recorded, false);
  assert.equal(data.privacyConsentRecords.length, 1);

  const withdrawn = privacyConsent.recordHealthConsentDecision(data, rootUserId, {
    decision: "WITHDRAWN",
    policyVersion: privacyConsent.HEALTH_CONSENT_POLICY_VERSION,
  }, context);
  assert.equal(withdrawn.active, false);
  assert.equal(data.privacyConsentRecords.length, 2);
  assert.deepEqual(data.privacyConsentRecords.map((item) => item.decision), ["GRANTED", "WITHDRAWN"]);
});

test("health consent fails closed when production notice metadata is incomplete", () => {
  const data = createSeedData();
  const context = { env: { ROOT_REQUIRE_HEALTH_CONSENT: "true" } };
  const status = privacyConsent.getHealthConsentStatus(data, "root_privacy_incomplete", context);
  assert.equal(status.configured, false);
  assert.throws(
    () => privacyConsent.recordHealthConsentDecision(data, "root_privacy_incomplete", {
      decision: "GRANTED",
      policyVersion: privacyConsent.HEALTH_CONSENT_POLICY_VERSION,
    }, context),
    (error) => error.code === 45102
  );
});

test("health consent rejects a non-actionable privacy contact", () => {
  const data = createSeedData();
  const status = privacyConsent.getHealthConsentStatus(data, "root-user-1", {
    env: { ...consentEnv, ROOT_PRIVACY_CONTACT: "待确认" },
  });

  assert.equal(status.required, true);
  assert.equal(status.configured, false);
  assert.equal(status.active, false);
});

test("HTTP sensitive writes require current consent while products remain available", async (t) => {
  const server = createApp({ env: consentEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-wx-openid": "privacy_http_openid", "x-wx-unionid": "privacy_http_unionid" },
    body: JSON.stringify({ appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const productsBeforeConsent = await request(baseUrl, "/api/v1/products", { headers: auth });
  const blockedProfile = await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  const status = await request(baseUrl, "/api/v1/privacy/health-consent", { headers: auth });
  const granted = await request(baseUrl, "/api/v1/privacy/health-consent", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      decision: "GRANTED",
      policyVersion: status.data.notice.policyVersion,
      sourceChannel: "PRIVACY_HTTP_TEST",
    }),
  });
  const savedProfile = await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  const withdrawn = await request(baseUrl, "/api/v1/privacy/health-consent", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ decision: "WITHDRAWN", policyVersion: status.data.notice.policyVersion }),
  });
  const blockedAfterWithdrawal = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CHECKIN",
      taskDate: "2026-07-11",
      payload: { hadStool: true, stoolType: "type4" },
      idempotencyKey: "privacy-withdrawal-checkin",
    }),
  });
  const productsAfterWithdrawal = await request(baseUrl, "/api/v1/products", { headers: auth });

  assert.equal(productsBeforeConsent.code, 0);
  assert.equal(blockedProfile.code, 45101);
  assert.equal(status.data.required, true);
  assert.equal(status.data.active, false);
  assert.equal(status.data.notice.retentionDays, 180);
  assert.equal(granted.data.active, true);
  assert.equal(savedProfile.code, 0);
  assert.equal(withdrawn.data.active, false);
  assert.equal(blockedAfterWithdrawal.code, 45101);
  assert.equal(productsAfterWithdrawal.code, 0);
  assert.deepEqual(server.store.privacyConsentRecords.map((item) => item.decision), ["GRANTED", "WITHDRAWN"]);
  assert.equal(server.store.privacyConsentRecords[0].source_channel, "MINIPROGRAM_HEALTH_CONSENT");
});
