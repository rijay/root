const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createHttpResponseSecurityPolicy } = require("../src/httpResponseSecurity");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("HTTP response security policy is same-origin by default and rejects unsafe allowlists", () => {
  const policy = createHttpResponseSecurityPolicy({});
  const headers = policy.headersFor({ method: "GET", headers: { origin: "https://attacker.example" } });
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers.Vary, "Origin");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);

  for (const value of [
    '["*"]',
    '["null"]',
    '["http://example.com"]',
    '["https://example.com/"]',
    '["https://example.com","https://example.com"]',
    "not-json",
  ]) {
    assert.throws(
      () => createHttpResponseSecurityPolicy({ ROOT_CORS_ALLOWED_ORIGINS_JSON: value }),
      { code: "HTTP_RESPONSE_SECURITY_CONFIGURATION_INVALID" }
    );
  }
});

test("configured exact Origin receives canonical preflight headers without the legacy admin alias", () => {
  const policy = createHttpResponseSecurityPolicy({
    ROOT_CORS_ALLOWED_ORIGINS_JSON: '["https://ops.root.example","http://127.0.0.1:5173"]',
  });
  const headers = policy.headersFor({
    method: "OPTIONS",
    headers: { origin: "https://ops.root.example" },
  });
  assert.equal(headers["Access-Control-Allow-Origin"], "https://ops.root.example");
  assert.equal(headers["Access-Control-Allow-Methods"], "GET,POST,OPTIONS");
  assert.match(headers["Access-Control-Allow-Headers"], /X-Admin-Token/);
  assert.doesNotMatch(headers["Access-Control-Allow-Headers"], /X-ROOT-ADMIN-TOKEN/);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
});

test("HTTP server never emits wildcard CORS and serves Admin with browser hardening headers", async (t) => {
  const server = createApp({
    env: {
      NODE_ENV: "test",
      ROOT_CORS_ALLOWED_ORIGINS_JSON: '["https://ops.root.example"]',
    },
  });
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const denied = await fetch(`${baseUrl}/health`, {
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("vary"), "Origin");

  const allowed = await fetch(`${baseUrl}/health`, {
    headers: { Origin: "https://ops.root.example" },
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://ops.root.example");
  assert.notEqual(allowed.headers.get("access-control-allow-origin"), "*");

  const admin = await fetch(`${baseUrl}/admin-legacy`);
  assert.equal(admin.headers.get("x-frame-options"), "DENY");
  assert.match(admin.headers.get("content-security-policy"), /default-src 'self'/);
});
