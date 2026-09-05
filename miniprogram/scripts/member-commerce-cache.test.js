const assert = require("node:assert/strict");

const storage = new Map();
let sessionId = "session-a";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};
require.cache[require.resolve("../utils/login-session")] = {
  exports: {
    currentLoginSession() { return { sessionId }; },
  },
};

const {
  MEMBER_COMMERCE_CACHE_KEY,
  clearMemberCommerceCache,
  readMemberCommerceCache,
  writeMemberCommerceCache,
} = require("../utils/member-commerce-cache");

const summary = {
  status: "READY",
  reason: "",
  orders: { totalCount: 4, pendingCount: 1, rawOrders: [{ phone: "13800138000" }] },
  coupons: { availableCount: 2, expiringSoonCount: 1 },
  priceSync: { syncedAt: "2026-08-31T10:00:00.000Z" },
  customer: { phone: "13800138000" },
};

assert.equal(writeMemberCommerceCache(summary, 1000), true);
const fresh = readMemberCommerceCache(1001);
assert.equal(fresh.fresh, true);
assert.deepEqual(fresh.value.orders, { totalCount: 4, pendingCount: 1 });
assert.equal(JSON.stringify(storage.get(MEMBER_COMMERCE_CACHE_KEY)).includes("13800138000"), false);
assert.equal(readMemberCommerceCache(5 * 60 * 1000 + 1001).fresh, false);
assert.equal(readMemberCommerceCache(24 * 60 * 60 * 1000 + 1001), null);

sessionId = "session-b";
assert.equal(readMemberCommerceCache(1002), null, "不同登录会话不得复用会员摘要");
clearMemberCommerceCache();
assert.equal(storage.has(MEMBER_COMMERCE_CACHE_KEY), false);
delete global.wx;
console.log("member commerce persistent cache tests passed");
