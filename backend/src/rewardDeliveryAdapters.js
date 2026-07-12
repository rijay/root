const { createYouzanCouponImplementation } = require("./youzanCouponAdapter");
const { createYouzanCouponStatusImplementation } = require("./youzanCouponStatusAdapter");
const { createWeworkTagImplementation } = require("./weworkTagAdapter");

function createDefaultRewardDeliveryAdapters(env = process.env, options = {}) {
  const adapters = { ...(options.rewardDeliveryAdapters || {}) };
  if (
    !adapters.YOUZAN_COUPON
    && env.YOUZAN_COUPON_SEND_URL
    && (env.YOUZAN_COUPON_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN)
  ) {
    adapters.YOUZAN_COUPON = createYouzanCouponImplementation({ fetchImpl: options.fetchImpl });
  }
  if (
    !adapters.WEWORK_TAG
    && env.WEWORK_TAG_APPLY_URL
    && (env.WEWORK_TAG_ACCESS_TOKEN || env.WEWORK_ACCESS_TOKEN || env.WEWORK_CONTACT_ACCESS_TOKEN)
  ) {
    adapters.WEWORK_TAG = createWeworkTagImplementation({ fetchImpl: options.fetchImpl });
  }
  return adapters;
}

function createDefaultRewardStatusAdapters(env = process.env, options = {}) {
  const adapters = { ...(options.rewardStatusAdapters || {}) };
  if (
    !adapters.YOUZAN_COUPON
    && env.YOUZAN_COUPON_STATUS_URL
    && (env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN || env.YOUZAN_COUPON_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN)
  ) {
    adapters.YOUZAN_COUPON = createYouzanCouponStatusImplementation({ fetchImpl: options.fetchImpl });
  }
  return adapters;
}

module.exports = {
  createDefaultRewardDeliveryAdapters,
  createDefaultRewardStatusAdapters,
};
