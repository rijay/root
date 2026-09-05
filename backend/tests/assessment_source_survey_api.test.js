const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createStore } = require("../src/domain");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, payload: await response.json() };
}

test("admin config controls the post-assessment source-confirmation contract", async (t) => {
  const data = createStore();
  data.users.push({ user_id: "user_source_api", root_user_id: "root_source_api" });
  data.sessions.push({
    session_id: "session_source_api",
    user_id: "user_source_api",
    token: "source-api-token",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  data.healthAssessmentAttempts.push({
    assessment_id: "assessment_source_api",
    root_user_id: "root_source_api",
    assessment_type: "GUT_REGULARITY",
    status: "COMPLETED",
    updated_at: "2026-08-30T00:00:00.000Z",
  });
  const server = createApp({
    store: data,
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({ channel_admin: { token: "channel-admin-secret", role: "admin" } }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const userHeaders = { Authorization: "Bearer source-api-token" };
  const noConfig = await jsonRequest(baseUrl, "/api/v1/health/assessments/assessment_source_api/source-confirmation", {
    headers: userHeaders,
  });
  assert.equal(noConfig.payload.data.required, false);
  assert.equal(noConfig.payload.data.reason, "NOT_CONFIGURED");

  const configured = await jsonRequest(baseUrl, "/api/v1/admin/assessment-source-survey", {
    method: "POST",
    headers: {
      "X-Admin-Token": "channel-admin-secret",
      "X-Request-Id": "source-config-request",
      "X-Idempotency-Key": "source-config-intent",
    },
    body: JSON.stringify({
      assessmentType: "GUT_REGULARITY",
      status: "ACTIVE",
      options: [
        { optionId: "OFFLINE_EVENT", label: "线下活动" },
        { optionId: "WECHAT_FRIEND", label: "微信好友推荐" },
      ],
    }),
  });
  assert.equal(configured.payload.code, 0);
  assert.equal(configured.payload.data.config.options.length, 2);

  const gate = await jsonRequest(baseUrl, "/api/v1/health/assessments/assessment_source_api/source-confirmation", {
    headers: userHeaders,
  });
  assert.equal(gate.payload.data.required, true);

  const confirmed = await jsonRequest(baseUrl, "/api/v1/health/assessments/assessment_source_api/source-confirmation", {
    method: "POST",
    headers: { ...userHeaders, "X-Idempotency-Key": "source-confirm-api" },
    body: JSON.stringify({
      optionId: "OFFLINE_EVENT",
      configVersion: gate.payload.data.config.configVersion,
    }),
  });
  assert.equal(confirmed.payload.code, 0);
  assert.equal(confirmed.payload.data.confirmation.label, "线下活动");

  const alreadyConfirmed = await jsonRequest(baseUrl, "/api/v1/health/assessments/assessment_source_api/source-confirmation", {
    headers: userHeaders,
  });
  assert.equal(alreadyConfirmed.payload.data.required, false);
  assert.equal(alreadyConfirmed.payload.data.reason, "ALREADY_CONFIRMED");
});
