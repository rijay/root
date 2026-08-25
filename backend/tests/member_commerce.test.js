const assert = require("node:assert/strict");
const test = require("node:test");

const memberCommerce = require("../src/memberCommerce");
const { createSeedData } = require("../src/seed");
const { stampVerifiedWechatUnionId } = require("../src/wechatIdentityAuthority");

const ACTIVE_ENV = Object.freeze({
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "member-commerce-unionid-authority-secret-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "member-commerce-unionid-v1",
});

function verifiedIdentity() {
  return stampVerifiedWechatUnionId({
    wechat_identity_id: "wxi-member-commerce",
    root_user_id: "root-member-commerce",
    app_code: "MYROOT",
    openid: "openid-member-commerce",
    unionid: "unionid-member-commerce",
  }, {
    source: "CLOUDBASE",
    verifiedAt: "2026-08-25T10:00:00.000Z",
  }, { env: ACTIVE_ENV });
}

test("member commerce fails closed without a verified live Adapter", async () => {
  const result = await memberCommerce.summary(createSeedData(), "root-member-commerce", { env: ACTIVE_ENV });
  assert.deepEqual(result, {
    status: "UNAVAILABLE",
    reason: "LIVE_READ_NOT_CONFIGURED",
    orders: null,
    coupons: null,
    priceSync: null,
  });
});

test("member commerce passes only a verified unionid and returns a minimized summary", async () => {
  const data = createSeedData();
  data.wechatIdentities.push(verifiedIdentity());
  let received;
  const result = await memberCommerce.summary(data, "root-member-commerce", {
    env: ACTIVE_ENV,
    memberCommerceAdapter: {
      configured: true,
      async readSummary(input) {
        received = input;
        return {
          orders: { totalCount: 4, pendingCount: 1, rawOrders: [{ address: "不得返回" }] },
          coupons: { availableCount: 2, expiringSoonCount: 1 },
          priceSync: { syncedAt: "2026-08-25T10:30:00.000Z" },
          customer: { phone: "13800138000" },
        };
      },
    },
  });
  assert.deepEqual(received, { unionid: "unionid-member-commerce" });
  assert.deepEqual(result, {
    status: "READY",
    reason: "",
    orders: { totalCount: 4, pendingCount: 1 },
    coupons: { availableCount: 2, expiringSoonCount: 1 },
    priceSync: { syncedAt: "2026-08-25T10:30:00.000Z" },
  });
  assert.equal(JSON.stringify(result).includes("13800138000"), false);
  assert.equal(JSON.stringify(result).includes("不得返回"), false);
});

test("member commerce never calls the Adapter for an unverified legacy unionid", async () => {
  const data = createSeedData();
  data.wechatIdentities.push({
    root_user_id: "root-member-commerce",
    unionid: "legacy-unionid",
    unionid_status: "LINKED",
    unionid_trust_status: "UNVERIFIED",
  });
  let calls = 0;
  const result = await memberCommerce.summary(data, "root-member-commerce", {
    env: ACTIVE_ENV,
    memberCommerceAdapter: {
      configured: true,
      async readSummary() { calls += 1; return {}; },
    },
  });
  assert.equal(result.reason, "VERIFIED_UNIONID_REQUIRED");
  assert.equal(calls, 0);
});

test("member commerce preserves an unknown expiring-soon count instead of reporting a false zero", () => {
  assert.equal(memberCommerce.normalizeSummary({
    orders: { totalCount: 0, pendingCount: 0 },
    coupons: { availableCount: 201, expiringSoonCount: null },
    priceSync: { syncedAt: "2026-08-25T12:00:00.000Z" },
  }).coupons.expiringSoonCount, null);
});
