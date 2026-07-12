const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("admin CloudBase object storage probe uploads, deletes, audits, and stays idempotent", async (t) => {
  const calls = [];
  const server = createApp({
    env: {
      NODE_ENV: "production",
      ROOT_ADMIN_TOKEN: "probe-admin-token",
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      ROOT_RELEASE_ID: "myroot-api-017",
    },
    objectStorageAdapter: {
      async putObject(payload) {
        calls.push({ action: "put", ...payload });
        return {
          objectKey: payload.objectKey,
          fileId: `cloud://myroot-prod.bucket/${payload.objectKey}`,
          externalRef: `cloud://myroot-prod.bucket/${payload.objectKey}`,
        };
      },
      async deleteObject(payload) {
        calls.push({ action: "delete", ...payload });
        return { ...payload, deleted: true };
      },
    },
  });
  await server.readyPromise;
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const request = () => fetch(`${baseUrl}/api/v1/admin/cloudbase-object-storage/probe`, {
    method: "POST",
    headers: {
      Authorization: "Bearer probe-admin-token",
      "Content-Type": "application/json",
      "X-Request-Id": "object-probe-1",
    },
    body: JSON.stringify({ requestId: "object-probe-1" }),
  }).then((response) => response.json());

  const first = await request();
  const repeated = await request();
  assert.equal(first.code, 0);
  assert.equal(first.data.probe.status, "VERIFIED");
  assert.equal(first.data.probe.uploadConfirmed, true);
  assert.equal(first.data.probe.deleteConfirmed, true);
  assert.equal(first.data.probe.releaseId, "myroot-api-017");
  assert.equal(repeated.data.probe.requestId, first.data.probe.requestId);
  assert.deepEqual(calls.map((item) => item.action), ["put", "delete"]);
  assert.equal(server.store.auditLogs.filter((item) => item.action === "CLOUDBASE_OBJECT_STORAGE_PROBE").length, 1);
});
