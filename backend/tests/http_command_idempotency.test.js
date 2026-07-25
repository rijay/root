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

function seedTask(data) {
  data.users.push({
    user_id: "usr_http_command_idempotency",
    root_user_id: "usr_http_command_idempotency",
    phone: "",
    nickname: "HTTP 幂等测试用户",
    state: "REGISTERED",
  });
  data.operationTasks.push({
    task_id: "tsk_http_command_idempotency",
    task_type: "FEEDBACK_FOLLOW",
    user_id: "usr_http_command_idempotency",
    order_id: "",
    task_date: "2026-07-15",
    status: "OPEN",
    reason: "验证 HTTP 命令幂等",
    metadata: {},
    created_at: "2026-07-15T08:00:00.000Z",
    completed_at: "",
    result: "",
    note: "",
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
  seedTask(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const pathname = "/api/v1/admin/tasks/tsk_http_command_idempotency/complete";
  const headers = {
    "X-Admin-Token": "operator-http-idempotency-secret",
    "X-Request-Id": "http-command-idempotency-001",
  };
  const command = {
    method: "POST",
    headers,
    body: JSON.stringify({ status: "DONE", note: "首次完成" }),
  };

  const first = await request(baseUrl, pathname, command);
  const repeated = await request(baseUrl, pathname, command);
  const conflict = await request(baseUrl, pathname, {
    ...command,
    body: JSON.stringify({ status: "DONE", note: "相同键但不同请求" }),
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.code, 0);
  assert.deepEqual(repeated.body, first.body);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 40901);

  assert.equal(server.store.commandIdempotencyRecords.length, 1);
  const [record] = server.store.commandIdempotencyRecords;
  assert.equal(record.commandName, "TASK_COMPLETE");
  assert.equal(record.actorId, "admin:operator");
  assert.equal(record.idempotencyKey, headers["X-Request-Id"]);
  assert.equal(record.attempts, 1);
  assert.equal(record.status, "SUCCEEDED");
  assert.equal(record.result.protection, "A256GCM");
  assert.doesNotMatch(JSON.stringify(record), /首次完成/);
  assert.equal(server.store.auditLogs.filter((item) => item.action === "OPERATION_TASK_COMPLETE").length, 1);
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
  seedTask(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const response = await request(baseUrl, "/api/v1/admin/tasks/tsk_http_command_idempotency/complete", {
    method: "POST",
    headers: {
      "X-Admin-Token": "operator-missing-result-key-secret",
      "X-Request-Id": "missing-command-result-key-001",
    },
    body: JSON.stringify({ status: "DONE", note: "不得落库的结果" }),
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.code, "COMMAND_RESULT_KEY_REQUIRED");
  assert.equal(server.store.operationTasks.find((item) => item.task_id === "tsk_http_command_idempotency").status, "OPEN");
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

  const pathname = "/api/v1/user/display-profile";
  const commandBody = JSON.stringify({ nickname: "稳定主体", avatarUrl: "" });
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
