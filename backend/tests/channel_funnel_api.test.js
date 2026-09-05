const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");

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

function adminHeaders(intent) {
  return {
    "X-Admin-Token": "channel-admin-secret",
    "X-Request-Id": `${intent}-request`,
    "X-Idempotency-Key": `${intent}-intent`,
  };
}

test("channel admin, public resolution, funnel report and image download share one contract", async (t) => {
  let generatedCode = null;
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({ channel_admin: { token: "channel-admin-secret", role: "admin" } }),
    },
    wechatCodeGenerator: {
      async generate(code) {
        generatedCode = code;
        return { body: Buffer.from("test-png"), contentType: "image/png" };
      },
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const channel = await jsonRequest(baseUrl, "/api/v1/admin/channels", {
    method: "POST",
    headers: adminHeaders("channel-create"),
    body: JSON.stringify({ channelId: "STORE_QR", campaignId: "GUT_CAMPAIGN", status: "ACTIVE" }),
  });
  assert.equal(channel.payload.code, 0);

  const createdCode = await jsonRequest(baseUrl, "/api/v1/admin/channel-codes", {
    method: "POST",
    headers: adminHeaders("code-create"),
    body: JSON.stringify({ channelId: "STORE_QR", label: "门店桌卡", envVersion: "trial", status: "ACTIVE" }),
  });
  assert.equal(createdCode.payload.code, 0);
  const code = createdCode.payload.data.code;
  assert.match(code.scene, /^q=[A-Z0-9]{8}$/);

  const resolved = await jsonRequest(baseUrl, "/api/v1/channels/resolve", {
    method: "POST",
    headers: { "X-Idempotency-Key": "resolve-visit-001" },
    body: JSON.stringify({ shortCode: code.shortCode, clientVisitId: "client_visit_api_001" }),
  });
  assert.equal(resolved.payload.code, 0);
  assert.equal(resolved.payload.data.targetPage, "/subpkg/campaign/pages/root-with-you/index");

  const intro = await jsonRequest(baseUrl, "/api/v1/channels/funnel", {
    method: "POST",
    headers: { "X-Idempotency-Key": "funnel-intro-001" },
    body: JSON.stringify({ visitId: resolved.payload.data.visitId, stage: "INTRO_VIEW" }),
  });
  assert.equal(intro.payload.data.recorded, true);

  const report = await jsonRequest(baseUrl, "/api/v1/admin/channel-funnel", {
    headers: { "X-Admin-Token": "channel-admin-secret" },
  });
  assert.equal(report.payload.data.totals.SCAN_OPEN, 1);
  assert.equal(report.payload.data.totals.INTRO_VIEW, 1);

  const imageResponse = await fetch(`${baseUrl}/api/v1/admin/channel-codes/${code.channelQrCodeId}/image`, {
    headers: { "X-Admin-Token": "channel-admin-secret" },
  });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await imageResponse.arrayBuffer()).toString(), "test-png");
  assert.equal(generatedCode.scene, code.scene);
  assert.equal(generatedCode.envVersion, "trial");
});
