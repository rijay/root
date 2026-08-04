const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return response.json();
}

function seedAdminWrites(data) {
  data.contentAssets.push({
    content_asset_id: "content_asset_admin_auth_guard",
    scope: "welcome-1",
    name: "welcome.png",
    mime_type: "image/png",
    byte_size: 68,
    width: 1,
    height: 1,
    data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    state: "AUTHORIZED",
    created_at: "2026-08-04T08:00:00.000Z",
    created_by: "test",
  });
}

test("production and cloud runtimes cannot disable configured Admin authentication", async (t) => {
  const cases = [
    {
      name: "production ignores ROOT_REQUIRE_ADMIN_TOKEN=false",
      env: {
        NODE_ENV: "production",
        ROOT_REQUIRE_ADMIN_TOKEN: "false",
      },
    },
    {
      name: "production ignores ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS=true",
      env: {
        NODE_ENV: "production",
        ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS: "true",
      },
    },
    {
      name: "cloud ignores ROOT_REQUIRE_ADMIN_TOKEN=false",
      env: {
        TCB_ENV: "myroot-cloud",
        ROOT_REQUIRE_ADMIN_TOKEN: "false",
      },
    },
    {
      name: "cloud ignores ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS=true",
      env: {
        TCB_ENV: "myroot-cloud",
        ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS: "true",
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async (t) => {
      const server = createApp({ env: testCase.env });
      seedAdminWrites(server.store);
      const baseUrl = await listen(server);
      t.after(() => server.close());

      const identityResult = await request(baseUrl, "/api/v1/admin/me");
      assert.equal(identityResult.code, 40101);

      const writeResult = await request(baseUrl, "/api/v1/admin/content/welcome/draft", {
        method: "POST",
        headers: {
          "X-Request-Id": `fail-close-${testCase.name}`,
          "X-Idempotency-Key": `fail-close-${testCase.name}`,
        },
        body: JSON.stringify({ slot: 1, copy: "不得保存", assetId: "content_asset_admin_auth_guard" }),
      });
      assert.equal(writeResult.code, 40101);
      assert.equal(server.store.contentVersions.length, 0);
    });
  }
});

test("formal content writes enforce capability, request identity, idempotency and audit", async (t) => {
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        operator: { token: "operator-secret", role: "operator" },
      }),
    },
  });
  seedAdminWrites(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const viewer = { "X-Admin-Token": "viewer-secret" };
  const operator = { "X-Admin-Token": "operator-secret" };
  const path = "/api/v1/admin/content/welcome/draft";
  const requestId = "admin-content-write-1";
  const body = { slot: 1, copy: "正式内容权限校验", assetId: "content_asset_admin_auth_guard", operatorId: "spoofed-operator" };
  const denied = await request(baseUrl, path, {
    method: "POST",
    headers: { ...viewer, "X-Request-Id": `viewer-${requestId}`, "X-Idempotency-Key": `viewer-${requestId}` },
    body: JSON.stringify(body),
  });
  assert.equal(denied.code, 40301);
  assert.equal(server.store.contentVersions.length, 0);

  const missingRequestId = await request(baseUrl, path, { method: "POST", headers: operator, body: JSON.stringify(body) });
  assert.equal(missingRequestId.code, 400);
  assert.equal(server.store.contentVersions.length, 0);

  const command = {
    method: "POST",
    headers: { ...operator, "X-Request-Id": requestId, "X-Idempotency-Key": requestId },
    body: JSON.stringify(body),
  };
  const authorized = await request(baseUrl, path, command);
  const repeated = await request(baseUrl, path, command);
  assert.equal(authorized.code, 0);
  assert.equal(server.store.contentVersions.length, 1);
  assert.equal(repeated.data.audit.audit_log_id, authorized.data.audit.audit_log_id);
  const matchingAudits = server.store.auditLogs.filter((item) => item.action === "CONTENT_WELCOME_DRAFT_SAVE");
  assert.equal(matchingAudits.length, 1);
  assert.equal(matchingAudits[0].operator_id, "operator");
  assert.equal(matchingAudits[0].metadata.requestId, requestId);
});
