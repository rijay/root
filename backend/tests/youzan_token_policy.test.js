const assert = require("node:assert/strict");
const test = require("node:test");
const { createYouzanOrderImplementation } = require("../src/youzanOpenAdapter");
const {
  assertYouzanTokenReady,
  buildYouzanTokenPolicyStatus,
} = require("../src/youzanTokenPolicy");

function productionPolicy(overrides = {}) {
  return {
    NODE_ENV: "production",
    YOUZAN_CLIENT_ID: "client-id-must-not-leak",
    YOUZAN_GRANT_ID: "12345678",
    YOUZAN_ACCESS_TOKEN: "access-token-must-not-leak",
    YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "2026-07-20T12:00:00+08:00",
    YOUZAN_TOKEN_MANAGEMENT_MODE: "STATIC_ROTATION",
    YOUZAN_TOKEN_ROTATION_OWNER: "root-ops",
    ...overrides,
  };
}

test("Youzan token policy is advisory outside production", () => {
  const status = assertYouzanTokenReady({ YOUZAN_ACCESS_TOKEN: "local-token" }, {
    now: "2026-07-11T12:00:00+08:00",
  });

  assert.equal(status.enforced, false);
  assert.equal(status.ready, false);
});

test("Youzan token policy accepts a complete unexpired production rotation contract", () => {
  const status = buildYouzanTokenPolicyStatus(productionPolicy(), {
    now: "2026-07-11T12:00:00+08:00",
    minRemainingMinutes: 1440,
  });

  assert.equal(status.enforced, true);
  assert.equal(status.ready, true);
  assert.equal(status.mode, "STATIC_ROTATION");
  assert.ok(status.remainingMinutes > 1440);
  assert.equal(JSON.stringify(status).includes("access-token-must-not-leak"), false);
});

test("Youzan static rotation does not require the client secret in the runtime container", () => {
  const status = buildYouzanTokenPolicyStatus(productionPolicy({
    YOUZAN_CLIENT_SECRET: "",
  }), {
    now: "2026-07-11T12:00:00+08:00",
  });

  assert.equal(status.ready, true);
  assert.equal(status.issues.includes("YOUZAN_CLIENT_SECRET"), false);
});

test("Youzan token policy rejects expired or incomplete production credentials before fetch", async () => {
  let fetched = false;
  const implementation = createYouzanOrderImplementation({
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(
    () => implementation({
      env: productionPolicy({
        YOUZAN_ORDER_LIST_URL: "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4",
        YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00+08:00",
      }),
      limit: 1,
    }),
    (error) => error.code === 503 && /token 生产策略未就绪/.test(error.message)
  );

  assert.equal(fetched, false);
});

test("Youzan token policy uses scope expiry before the global expiry", () => {
  const status = buildYouzanTokenPolicyStatus(productionPolicy({
    YOUZAN_CUSTOMER_ACCESS_TOKEN: "customer-access-token-must-not-leak",
    YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00+08:00",
  }), {
    now: "2026-07-11T12:00:00+08:00",
    expiryNames: ["YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT"],
  });

  assert.equal(status.ready, false);
  assert.equal(status.expirySource, "YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT");
  assert.ok(status.remainingMinutes < 0);
});

test("Youzan customer Adapter ignores stale scope expiry when using the global token", async () => {
  const { createYouzanCustomerImplementation } = require("../src/youzanCustomerAdapter");
  let fetched = false;
  const implementation = createYouzanCustomerImplementation({
    fetchImpl: async () => {
      fetched = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, success: true, data: { record_list: [] } }),
      };
    },
  });

  await implementation({
    env: productionPolicy({
      YOUZAN_CUSTOMER_LIST_URL: "https://open.youzanyun.com/api/youzan.scrm.customer.list/1.0.0",
      YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00+08:00",
    }),
    limit: 1,
  });

  assert.equal(fetched, true);
});
