const { verifyWechatUnionIdAuthority } = require("./wechatIdentityAuthority");

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function verifiedIdentity(data, rootUserId, context = {}) {
  const identities = Array.isArray(data.wechatIdentities) ? data.wechatIdentities : [];
  return identities.find((item) => (
    item.root_user_id === rootUserId
    && verifyWechatUnionIdAuthority(item, { env: context.env || {} })
  )) || null;
}

function unavailable(reason) {
  return {
    status: "UNAVAILABLE",
    reason,
    orders: null,
    coupons: null,
    priceSync: null,
  };
}

function normalizeSummary(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: "READY",
    reason: "",
    orders: {
      totalCount: nonNegativeInteger(source.orders && source.orders.totalCount),
      pendingCount: nonNegativeInteger(source.orders && source.orders.pendingCount),
    },
    coupons: {
      availableCount: nonNegativeInteger(source.coupons && source.coupons.availableCount),
      expiringSoonCount: nonNegativeInteger(source.coupons && source.coupons.expiringSoonCount),
    },
    priceSync: {
      syncedAt: String(source.priceSync && source.priceSync.syncedAt || "").trim(),
    },
  };
}

async function summary(data, rootUserId, context = {}) {
  const adapter = context.memberCommerceAdapter;
  if (!adapter || adapter.configured !== true || typeof adapter.readSummary !== "function") {
    return unavailable("LIVE_READ_NOT_CONFIGURED");
  }
  const identity = verifiedIdentity(data, rootUserId, context);
  if (!identity) return unavailable("VERIFIED_UNIONID_REQUIRED");
  try {
    return normalizeSummary(await adapter.readSummary({ unionid: identity.unionid }));
  } catch (error) {
    return unavailable("LIVE_READ_UNAVAILABLE");
  }
}

module.exports = {
  normalizeSummary,
  summary,
  verifiedIdentity,
};
