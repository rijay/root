const { request } = require("./request");
const { readSessionPageCache, writeSessionPageCache } = require("./page-cache");
const { currentLoginSession } = require("./login-session");

function memberCommerceCacheKey() {
  return `profile:member-commerce:${currentLoginSession().sessionId || "guest"}`;
}

function presentSummary(data = {}) {
  const ready = data.status === "READY";
  const orders = ready ? data.orders || {} : {};
  const coupons = ready ? data.coupons || {} : {};
  const pendingOrders = Number(orders.pendingCount || 0);
  const totalOrders = Number(orders.totalCount || 0);
  const availableCoupons = Number(coupons.availableCount || 0);
  return {
    ...data,
    ready,
    orderHint: ready
      ? pendingOrders > 0 ? `${pendingOrders} 笔待处理` : totalOrders > 0 ? `${totalOrders} 笔订单` : "暂无订单"
      : "会员中心",
    couponHint: ready ? `${availableCoupons} 张可用` : "会员中心",
  };
}

async function getMemberCommerceSummary() {
  const cacheKey = memberCommerceCacheKey();
  const summary = presentSummary(await request({ url: "/api/v1/member-commerce/summary" }));
  if (cacheKey === memberCommerceCacheKey()) writeSessionPageCache(cacheKey, summary);
  return summary;
}

function readMemberCommerceSummary() {
  const cached = readSessionPageCache(memberCommerceCacheKey());
  return cached ? cached.value : null;
}

module.exports = { getMemberCommerceSummary, presentSummary, readMemberCommerceSummary };
