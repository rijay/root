const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { fixture, fakeAdapter } = require("./fixtures/userLabelsFixture");

test("labels HTTP Interface isolates health permission, requires export permission and does not cache raw health results", async (t) => {
  const data = fixture(), adapter = fakeAdapter(); adapter.writesEnabled = false;
  const server = createApp({ store: data, labelSyncAdapter: adapter, env: { ROOT_REQUIRE_ADMIN_TOKEN: "true",
    ROOT_ADMIN_TOKENS: JSON.stringify(Object.fromEntries(["viewer", "operator", "admin"].map((role) => [role, { token: `demo-${role}`, role }]))),
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(path, body, role = "admin") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/user-labels/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": `demo-${role}`, "X-Request-Id": "label-request", "X-Idempotency-Key": "label-intent" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request("query", {}, "viewer")).status, 403);
  assert.equal((await request("query", { includeHealth: true }, "operator")).status, 403);
  assert.equal((await request("query", { healthStatus: "已完成" }, "operator")).status, 403);
  assert.equal((await request("query", {}, "operator")).body.data.rows[0].health, undefined);
  assert.equal((await request("query", { includeHealth: true })).body.data.rows[0].health.baseline.resultCode, "SENSITIVE");
  assert.equal((await request("sync/preview", { userIds: ["usr_labels_demo"] }, "operator")).status, 403);
  const preview = (await request("sync/preview", { userIds: ["usr_labels_demo"] })).body.data;
  assert.equal(preview.summary.create, 1);
  assert.equal((await request("sync/execute", preview)).body.code, "LABEL_SYNC_WRITE_DISABLED");
  assert.equal(adapter.writes, 0);
  assert.doesNotMatch(JSON.stringify(data.auditLogs), /Q3|SENSITIVE|肠道较敏感/);
  assert.doesNotMatch(JSON.stringify(data.commandIdempotencyRecords), /Q3|SENSITIVE|肠道较敏感/);
});
