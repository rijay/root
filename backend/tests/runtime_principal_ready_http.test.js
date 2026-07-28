const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createMemoryStore } = require("../src/store");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function readyResponse(health) {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  const storeAdapter = {
    ...base,
    kind: "mysql",
    async checkHealth() { return health; },
  };
  const server = createApp({ storeAdapter, env: {} });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/ready`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function baseHealth(overrides = {}) {
  return {
    ok: true,
    migrationVersion: "065_v1_runtime_alert_registration_return_row.sql",
    revision: 19,
    leastPrivilegeReady: true,
    privilegeScope: "SCHEMA",
    privilegePolicyEnforced: true,
    runtimeAlertDeliveryEnabled: true,
    runtimePrincipalReady: true,
    runtimePrincipalRequiredRoleCount: 3,
    runtimePrincipalVerifiedRoleCount: 3,
    runtimePrincipalRequiredRoutineCount: 21,
    runtimePrincipalVerifiedRoutineCount: 21,
    runtimePrincipalIssueCount: 0,
    ...overrides,
  };
}

test("ready exposes only the safe runtime principal aggregate", async () => {
  const response = await readyResponse(baseHealth());
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.deepEqual({
    runtimeAlertDeliveryEnabled: response.body.data.store.runtimeAlertDeliveryEnabled,
    runtimePrincipalReady: response.body.data.store.runtimePrincipalReady,
    runtimePrincipalRequiredRoleCount:
      response.body.data.store.runtimePrincipalRequiredRoleCount,
    runtimePrincipalVerifiedRoleCount:
      response.body.data.store.runtimePrincipalVerifiedRoleCount,
    runtimePrincipalRequiredRoutineCount:
      response.body.data.store.runtimePrincipalRequiredRoutineCount,
    runtimePrincipalVerifiedRoutineCount:
      response.body.data.store.runtimePrincipalVerifiedRoutineCount,
    runtimePrincipalIssueCount: response.body.data.store.runtimePrincipalIssueCount,
  }, {
    runtimeAlertDeliveryEnabled: true,
    runtimePrincipalReady: true,
    runtimePrincipalRequiredRoleCount: 3,
    runtimePrincipalVerifiedRoleCount: 3,
    runtimePrincipalRequiredRoutineCount: 21,
    runtimePrincipalVerifiedRoutineCount: 21,
    runtimePrincipalIssueCount: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /registrar|worker-user|inspector-user|SHOW GRANTS|PROCEDURE|CURRENT_USER/i
  );
});

test("ready fails closed for missing, partial, or inconsistent authority proof", async () => {
  for (const drift of [
    { runtimePrincipalReady: false, runtimePrincipalIssueCount: 1 },
    { runtimePrincipalVerifiedRoleCount: 2 },
    { runtimePrincipalVerifiedRoutineCount: 20 },
    { runtimePrincipalIssueCount: 1 },
    {
      runtimePrincipalRequiredRoleCount: undefined,
      runtimePrincipalVerifiedRoleCount: undefined,
      runtimePrincipalRequiredRoutineCount: undefined,
      runtimePrincipalVerifiedRoutineCount: undefined,
    },
  ]) {
    const response = await readyResponse(baseHealth(drift));
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 50306);
    assert.equal(response.body.data.store.runtimePrincipalReady, false);
  }
});

test("disabled alert delivery does not require runtime role evidence", async () => {
  const response = await readyResponse(baseHealth({
    runtimeAlertDeliveryEnabled: false,
    runtimePrincipalReady: true,
    runtimePrincipalRequiredRoleCount: 0,
    runtimePrincipalVerifiedRoleCount: 0,
    runtimePrincipalRequiredRoutineCount: 0,
    runtimePrincipalVerifiedRoutineCount: 0,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.store.runtimeAlertDeliveryEnabled, false);
});
