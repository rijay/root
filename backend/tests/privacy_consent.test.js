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
  assert.match(privacyConsent.HEALTH_CONSENT_POLICY_VERSION, /2026-08-26-v3$/);
  assert.ok(data.privacyConsentRecords[0].purposes_json.some((item) => item.includes("腾讯云 CloudBase AI")));
  assert.ok(data.privacyConsentRecords[0].data_categories_json.some((item) => item.includes("原始问卷答案")));

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

test("health consent notice discloses minimum model processing and invalidates the previous policy version", () => {
  const data = createSeedData();
  data.privacyConsentRecords.push({
    privacy_consent_record_id: "old-model-policy-consent",
    root_user_id: "root-user-model-policy",
    consent_type: privacyConsent.HEALTH_CONSENT_TYPE,
    policy_version: "root4u-health-sensitive-2026-08-25-v2",
    decision: "GRANTED",
  });

  const status = privacyConsent.getHealthConsentStatus(data, "root-user-model-policy", { env: consentEnv });
  assert.equal(status.active, false, "新增模型受托处理说明后必须重新单独同意");
  assert.match(status.notice.modelProcessingText, /腾讯云 CloudBase AI/);
  assert.match(status.notice.modelProcessingText, /评测类型、问卷版本、结果代码、状态标题和安全分流标记/);
  assert.match(status.notice.modelProcessingText, /不发送姓名、手机号、微信身份标识、原始问卷答案或自由文本/);
  assert.match(status.notice.modelProcessingText, /自动改用经审核固定建议/);
});
