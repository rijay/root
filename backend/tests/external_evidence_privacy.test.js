const assert = require("node:assert/strict");
const test = require("node:test");
const { createSeedData } = require("../src/seed");
const { normalizeStoreData } = require("../src/store");

test("Store normalization minimizes legacy external evidence before the candidate serves traffic", () => {
  const snapshot = createSeedData();
  snapshot.externalSampleReviews.push({
    review_id: "legacy-review",
    rows: [{
      raw: { 收货手机号: "13800138000", 物流状态: "派送失败" },
      mapped: { receiverPhone: "13800138000", deliveryStatus: "派送失败" },
    }],
  });
  snapshot.youzanCustomers.push({
    youzan_yz_uid: "legacy-yz-user",
    raw_payload: { mobile_info: { mobile: "13800138000" } },
  });

  const normalized = normalizeStoreData(snapshot, { seedSampleData: true });
  const serialized = JSON.stringify(normalized);
  const review = normalized.externalSampleReviews.find((item) => item.review_id === "legacy-review");
  const customer = normalized.youzanCustomers.find((item) => item.youzan_yz_uid === "legacy-yz-user");

  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(review.rows[0].raw.物流状态, "派送失败");
  assert.match(review.rows[0].raw.收货手机号, /已脱敏/);
  assert.deepEqual(customer.raw_payload.field_paths, ["mobile_info.mobile"]);
});
