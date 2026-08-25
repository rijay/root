const assert = require("node:assert/strict");
const { presentSummary } = require("../utils/member-commerce");

assert.deepEqual(presentSummary({ status: "UNAVAILABLE" }), {
  status: "UNAVAILABLE",
  ready: false,
  orderHint: "会员中心",
  couponHint: "会员中心",
});

const ready = presentSummary({
  status: "READY",
  orders: { totalCount: 4, pendingCount: 1 },
  coupons: { availableCount: 2 },
});
assert.equal(ready.ready, true);
assert.equal(ready.orderHint, "1 笔待处理");
assert.equal(ready.couponHint, "2 张可用");

console.log("member commerce presentation tests passed");
