const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function seedContentAsset(data) {
  data.contentAssets.push({
    content_asset_id: "content_asset_http_idempotency",
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

test("HTTP write seam scopes idempotency by command, trusted actor and request digest", async (t) => {
  const server = createApp({
    env: {
      NODE_ENV: "production",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        operator: { token: "operator-http-idempotency-secret", role: "operator" },
      }),
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "http-command-result-key-with-at-least-32-characters",
      ROOT_COMMAND_RESULT_KEY_ID: "http-command-result-v1",
    },
  });
  seedContentAsset(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const pathname = "/api/v1/admin/content/welcome/draft";
  const headers = {
    "X-Admin-Token": "operator-http-idempotency-secret",
    "X-Request-Id": "http-command-idempotency-001",
  };
  const command = {
    method: "POST",
    headers,
    body: JSON.stringify({ slot: 1, copy: "首次完成", assetId: "content_asset_http_idempotency" }),
  };

  const first = await request(baseUrl, pathname, command);
  const repeated = await request(baseUrl, pathname, command);
  const conflict = await request(baseUrl, pathname, {
    ...command,
    body: JSON.stringify({ slot: 1, copy: "相同键但不同请求", assetId: "content_asset_http_idempotency" }),
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.code, 0);
  assert.deepEqual(repeated.body, first.body);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 40901);

  assert.equal(server.store.commandIdempotencyRecords.length, 1);
  const [record] = server.store.commandIdempotencyRecords;
  assert.equal(record.commandName, "CONTENT_WELCOME_DRAFT_SAVE");
  assert.equal(record.actorId, "admin:operator");
  assert.equal(record.idempotencyKey, headers["X-Request-Id"]);
  assert.equal(record.attempts, 1);
  assert.equal(record.status, "SUCCEEDED");
  assert.equal(record.result.protection, "A256GCM");
  assert.doesNotMatch(JSON.stringify(record), /首次完成/);
  assert.equal(server.store.auditLogs.filter((item) => item.action === "CONTENT_WELCOME_DRAFT_SAVE").length, 1);
  assert.equal(JSON.stringify(record).includes("operator-http-idempotency-secret"), false);
});

test("protected runtime refuses an unprotected command result and rolls back business state", async (t) => {
  const server = createApp({
    env: {
      NODE_ENV: "production",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        operator: { token: "operator-missing-result-key-secret", role: "operator" },
      }),
    },
  });
  seedContentAsset(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const response = await request(baseUrl, "/api/v1/admin/content/welcome/draft", {
    method: "POST",
    headers: {
      "X-Admin-Token": "operator-missing-result-key-secret",
      "X-Request-Id": "missing-command-result-key-001",
    },
    body: JSON.stringify({ slot: 1, copy: "不得落库的结果", assetId: "content_asset_http_idempotency" }),
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.code, "COMMAND_RESULT_KEY_REQUIRED");
  assert.equal(server.store.contentVersions.length, 0);
  assert.equal(server.store.commandIdempotencyRecords[0].status, "FAILED");
  assert.deepEqual(server.store.commandIdempotencyRecords[0].error, {
    code: "COMMAND_RESULT_KEY_REQUIRED",
    message: "command failed",
  });
  assert.doesNotMatch(JSON.stringify(server.store.commandIdempotencyRecords[0]), /不得落库的结果/);
});

test("login responses never persist bearer tokens in command replay state", async (t) => {
  const server = createApp({ env: { ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "X-Request-Id": "login-must-not-be-cached" },
    body: JSON.stringify({ phone: "13800001234" }),
  });

  assert.equal(login.body.code, 0);
  assert.ok(login.body.data.token);
  assert.equal(server.store.commandIdempotencyRecords.length, 0);
  assert.equal(JSON.stringify(server.store.idempotency).includes(login.body.data.token), false);
});

test("authenticated command scope follows the stable Root user across session rotation", async (t) => {
  const server = createApp({ env: { ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const loginOptions = {
    method: "POST",
    body: JSON.stringify({ phone: "13800004321" }),
  };
  const firstLogin = await request(baseUrl, "/api/v1/auth/login", loginOptions);
  const secondLogin = await request(baseUrl, "/api/v1/auth/login", loginOptions);
  assert.notEqual(firstLogin.body.data.token, secondLogin.body.data.token);

  const pathname = "/api/v1/user/formal-profile";
  const commandBody = JSON.stringify({ nickname: "稳定主体", avatarUrl: "", birthDate: "1990-01-01", gender: "MALE" });
  const first = await request(baseUrl, pathname, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firstLogin.body.data.token}`,
      "X-Request-Id": "stable-root-user-command-001",
    },
    body: commandBody,
  });
  const replayed = await request(baseUrl, pathname, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secondLogin.body.data.token}`,
      "X-Request-Id": "stable-root-user-command-001",
    },
    body: commandBody,
  });

  assert.equal(first.body.code, 0);
  assert.deepEqual(replayed.body, first.body);
  assert.equal(server.store.commandIdempotencyRecords.length, 1);
  assert.equal(
    server.store.commandIdempotencyRecords[0].actorId,
    `user:${firstLogin.body.data.user.rootUserId}`
  );
});
