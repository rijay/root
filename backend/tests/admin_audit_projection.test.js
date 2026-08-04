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

test("admin audit HTTP Interface exposes a paged allowlist without raw before/after or sensitive metadata", async (t) => {
  const store = createStore();
  store.auditLogs = Array.from({ length: 21 }, (_, index) => ({
    audit_log_id: `audit-safe-${index}`,
    action: "CONTENT_HOME_DRAFT_SAVE",
    target_type: "CONTENT_HOME_VERSION",
    target_id: `content-${index}`,
    operator_id: "operator-1",
    reason: "维护正式内容草稿",
    before: { phone: "13800138000", healthAnswer: "private-answer" },
    after: {
      versionId: `version-${index}`,
      version: index + 1,
      revision: 2,
      status: "DRAFT",
      apiSecret: "raw-secret-after",
    },
    metadata: {
      requestId: `request-${index}`,
      accessToken: "raw-secret-metadata",
    },
    created_at: "2026-08-04T00:00:00.000Z",
  }));
  const server = createApp({
    store,
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({ viewer: { token: "audit-viewer", role: "viewer" } }),
      ROOT_REQUIRE_ADMIN_TOKEN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/api/v1/admin/audit-logs?page=1&pageSize=20`, {
    headers: { "X-Admin-Token": "audit-viewer" },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.auditLogs.length, 20);
  assert.deepEqual(payload.data.pagination, { page: 1, pageSize: 20, total: 21, totalPages: 2 });
  assert.deepEqual(Object.keys(payload.data.auditLogs[0]).sort(), [
    "action", "audit_log_id", "created_at", "operator_id", "outcome_unknown",
    "request_id", "result", "summary", "target_id", "target_type", "version",
  ].sort());
  assert.equal(payload.data.auditLogs[0].result, "SUCCESS");
  assert.equal(payload.data.auditLogs[0].request_id, "request-0");
  assert.equal(payload.data.auditLogs[0].version, 1);
  const serialized = JSON.stringify(payload);
  ["13800138000", "private-answer", "raw-secret-after", "raw-secret-metadata", "apiSecret", "accessToken", "维护正式内容草稿"]
    .forEach((sensitive) => assert.equal(serialized.includes(sensitive), false, sensitive));
});

test("admin audit projection preserves failure and outcome-unknown states without exposing raw payloads", () => {
  const { presentAuditLog } = require("../src/auditLog");
  assert.equal(presentAuditLog({
    after: { status: "FAILED", error: "sensitive provider error" },
    metadata: { status: "FAILED" },
  }).result, "FAILURE");
  const unknown = presentAuditLog({
    after: { status: "FAILED", error: "sensitive provider error" },
    metadata: { outcomeUnknown: true },
  });
  assert.equal(unknown.result, "UNKNOWN");
  assert.equal(unknown.outcome_unknown, true);
  assert.equal(JSON.stringify(unknown).includes("sensitive provider error"), false);
});
