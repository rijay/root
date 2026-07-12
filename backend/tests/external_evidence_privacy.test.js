const assert = require("node:assert/strict");
const test = require("node:test");
const externalAdapterSamples = require("../src/externalAdapterSamples");
const { createSeedData } = require("../src/seed");
const { normalizeStoreData } = require("../src/store");
const { upsertYouzanCustomer } = require("../src/youzanCustomerMirror");

test("persisted adapter reviews redact personal values while preserving calibration fields", () => {
  const data = createSeedData();
  const result = externalAdapterSamples.previewExternalSamples(data, "YOUZAN_ORDER", [{
    youzanOrderNo: "E202607120001",
    buyerUnionId: "oUnionIdMustNotPersist",
    receiverName: "测试用户",
    receiverPhone: "13800138000",
    rawAddressText: "杭州市测试路 1 号",
    productName: "ROOT 益生元",
    amount: 199,
    orderStatus: "PAID",
    deliveryStatus: "SHIPPED",
  }]);

  const review = externalAdapterSamples.recordExternalSampleReview(data, "ADAPTER_PREVIEW", result);
  const serialized = JSON.stringify(review);

  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("oUnionIdMustNotPersist"), false);
  assert.equal(serialized.includes("杭州市测试路 1 号"), false);
  assert.equal(serialized.includes("测试用户"), false);
  assert.equal(serialized.includes("ROOT 益生元"), true);
  assert.equal(serialized.includes("SHIPPED"), true);
  assert.match(serialized, /已脱敏/);
});

test("Youzan customer mirror stores only raw response field paths", () => {
  const data = createSeedData();
  const rawPayload = {
    primitive_info: {
      yz_open_id: "yz-open-id-must-not-persist",
      nick_name: "客户昵称",
    },
    mobile_info: {
      mobile: "13800138000",
    },
  };

  const result = upsertYouzanCustomer(data, {
    youzanYzUid: "yz-customer-1",
    rawPayload,
  });
  const serialized = JSON.stringify(result.customer.raw_payload);

  assert.deepEqual(result.customer.raw_payload.field_paths, [
    "mobile_info.mobile",
    "primitive_info.nick_name",
    "primitive_info.yz_open_id",
  ]);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("yz-open-id-must-not-persist"), false);
  assert.equal(serialized.includes("客户昵称"), false);
});

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
