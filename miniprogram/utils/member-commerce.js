const { request } = require("./request");
const {
  readMemberCommerceCache,
  writeMemberCommerceCache,
} = require("./member-commerce-cache");
const { formatProductSyncedAt } = require("./product-display");

function presentSummary(data = {}) {
  const ready = data.status === "READY";
  const orders = ready ? data.orders || {} : {};
  const coupons = ready ? data.coupons || {} : {};
  const pendingOrders = Number(orders.pendingCount || 0);
  const totalOrders = Number(orders.totalCount || 0);
  const availableCoupons = Number(coupons.availableCount || 0);
  const expiringSoonCoupons = coupons.expiringSoonCount === null || coupons.expiringSoonCount === undefined
    ? null
    : Number(coupons.expiringSoonCount || 0);
  const syncedAtText = ready ? formatProductSyncedAt(data.priceSync && data.priceSync.syncedAt) : "";
  return {
    ...data,
    ready,
    syncedAtText,
    orderHint: ready
      ? pendingOrders > 0 ? `待处理 ${pendingOrders} · 共 ${totalOrders}` : totalOrders > 0 ? `共 ${totalOrders} 笔` : "暂无订单"
      : "前往会员中心",
    couponHint: ready
      ? expiringSoonCoupons > 0
        ? `可用 ${availableCoupons} · 近到期 ${expiringSoonCoupons}`
        : `${availableCoupons} 张可用`
      : "前往会员中心",
    syncHint: ready
      ? syncedAtText ? `会员摘要更新于 ${syncedAtText}` : "会员摘要已同步"
      : "会员摘要暂未同步，可前往会员中心查看",
  };
}

async function getMemberCommerceSummary() {
  const raw = await request({ url: "/api/v1/member-commerce/summary" });
  writeMemberCommerceCache(raw);
  return presentSummary(raw);
}

function readMemberCommerceSummary() {
  const cached = readMemberCommerceCache();
  return cached ? presentSummary(cached.value) : null;
}

function readMemberCommerceSummaryEntry() {
  const cached = readMemberCommerceCache();
  return cached ? { ...cached, value: presentSummary(cached.value) } : null;
}

module.exports = {
  getMemberCommerceSummary,
  presentSummary,
  readMemberCommerceSummary,
  readMemberCommerceSummaryEntry,
};
