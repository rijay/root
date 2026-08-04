const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createStore } = require("../src/domain");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    return server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function query(baseUrl, phone, token = "") {
  const response = await fetch(`${baseUrl}/api/v1/admin/formal-users/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Admin-Token": token } : {}),
    },
    body: JSON.stringify({ phone }),
  });
  return { status: response.status, body: await response.json() };
}

test("formal admin user query HTTP Interface requires admin read and returns only minimal fields", async (t) => {
  const store = createStore();
  store.users.push({
    user_id: "usr_http_001",
    root_user_id: "root_http_001",
    phone: "13800138000",
    nickname: "Root用户",
    birth_date: "1990-01-01",
    gender: "FEMALE",
    created_at: "2026-08-01T00:00:00.000Z",
  });
  store.formalProfiles = [{
    profileId: "profile_http_001",
    rootUserId: "root_http_001",
    nickname: "节律体验官",
    complete: true,
  }];
  const server = createApp({
    store,
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({ viewer: { token: "formal-user-viewer", role: "viewer" } }),
      ROOT_REQUIRE_ADMIN_TOKEN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));

  assert.equal((await query(baseUrl, "13800138000")).status, 401);
  const result = await query(baseUrl, "13800138000", "formal-user-viewer");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.user, {
    rootUserId: "root_http_001",
    nickname: "节律体验官",
    maskedPhone: "138****8000",
    profileComplete: true,
    accountStatus: "ACTIVE",
    registeredAt: "2026-08-01T00:00:00.000Z",
    lastLoginAt: "",
  });
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("1990-01-01"), false);
  assert.equal(serialized.includes("FEMALE"), false);

  const partial = await query(baseUrl, "1380", "formal-user-viewer");
  assert.equal(partial.status, 400);
});
