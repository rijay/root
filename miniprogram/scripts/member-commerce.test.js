const assert = require("node:assert/strict");
const { presentSummary } = require("../utils/member-commerce");

assert.deepEqual(presentSummary({ status: "UNAVAILABLE" }), {
  status: "UNAVAILABLE",
  ready: false,
  syncedAtText: "",
  orderHint: "前往会员中心",
  couponHint: "前往会员中心",
  syncHint: "会员摘要暂未同步，可前往会员中心查看",
});

const ready = presentSummary({
  status: "READY",
  orders: { totalCount: 4, pendingCount: 1 },
  coupons: { availableCount: 2, expiringSoonCount: 1 },
  priceSync: { syncedAt: "2026-08-25T13:28:24Z" },
});
assert.equal(ready.ready, true);
assert.equal(ready.orderHint, "待处理 1 · 共 4");
assert.equal(ready.couponHint, "可用 2 · 近到期 1");
assert.equal(ready.syncHint, "会员摘要更新于 2026.08.25 21:28");

console.log("member commerce presentation tests passed");
