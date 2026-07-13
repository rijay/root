const assert = require("node:assert/strict");
const test = require("node:test");
const { createYouzanOrderImplementation } = require("../src/youzanOpenAdapter");
const { createYouzanCustomerImplementation } = require("../src/youzanCustomerAdapter");
const { createYouzanCouponImplementation } = require("../src/youzanCouponAdapter");
const { createYouzanCouponStatusImplementation, normalizeExternalStatus } = require("../src/youzanCouponStatusAdapter");
const { isOfficialYouzanUrl } = require("../src/youzanOpenRequest");
const rewardDelivery = require("../src/rewardDelivery");

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test("official Youzan URL recognition requires the exact method and version path", () => {
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
    "youzan.ump.voucheractivity.send"
  ), true);
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/proxy/api/youzan.ump.voucheractivity.send/3.0.1",
    "youzan.ump.voucheractivity.send"
  ), false);
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1/extra",
    "youzan.ump.voucheractivity.send"
  ), false);
  assert.equal(isOfficialYouzanUrl(
    "https://example.com/api/youzan.ump.voucheractivity.send/3.0.1",
    "youzan.ump.voucheractivity.send"
  ), false);
});

test("Youzan order Adapter reads the official full_order_info_list and derives page cursor", async () => {
  let requestBody = null;
  const implementation = createYouzanOrderImplementation({
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return response({
        code: 200,
        success: true,
        data: {
          paginator: { total_count: 3, page: 1, page_size: 2 },
          full_order_info_list: [
            {
              full_order_info: {
                order_info: { tid: "E20260711001", status: "WAIT_SELLER_SEND_GOODS" },
                buyer_info: { buyer_id: "yz_1", unionid: "union_1" },
                pay_info: { payment: 9900, pay_time: "2026-07-11 10:00:00" },
                orders: [{ item_id: 6725166, title: "ROOT益生元 7天身体重启计划" }],
              },
            },
            {
              full_order_info: {
                order_info: { tid: "E20260711002", status: "TRADE_SUCCESS" },
                buyer_info: { buyer_id: "yz_2" },
                orders: [{ item_id: 6725166, title: "ROOT益生元 7天身体重启计划" }],
              },
            },
          ],
        },
      });
    },
  });
  const result = await implementation({
    cursor: "1",
    limit: 2,
    env: {
      YOUZAN_ORDER_LIST_URL: "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
  });

  assert.equal(requestBody.page_no, "1");
  assert.equal(requestBody.page_size, 2);
  assert.equal(result.externalCount, 2);
  assert.equal(result.samples[0].youzanOrderNo, "E20260711001");
  assert.equal(result.samples[0].productId, 6725166);
  assert.equal(result.nextCursor, "2");
  assert.equal(result.hasMore, true);
});

test("Youzan customer Adapter reads record_list and derives page cursor", async () => {
  let requestBody = null;
  const implementation = createYouzanCustomerImplementation({
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return response({
        code: 200,
        success: true,
        data: {
          total: 3,
          page_no: 1,
          page_size: 2,
          record_list: [
            { yz_open_id: "yz_open_1001", mobile: "13800000000", show_name: "ROOT A" },
            { yz_open_id: "yz_open_1002", mobile: "13900000000", show_name: "ROOT B" },
          ],
        },
      });
    },
  });
  const result = await implementation({
    cursor: "1",
    limit: 2,
    env: {
      YOUZAN_CUSTOMER_LIST_URL: "https://open.youzanyun.com/api/youzan.scrm.customer.list/1.0.0",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
  });

  assert.equal(requestBody.page_no, "1");
  assert.equal(requestBody.page_size, 2);
  assert.equal(result.externalCount, 2);
  assert.equal(result.samples[0].youzanYzUid, "yz_open_1001");
  assert.equal(result.samples[0].nickname, "ROOT A");
  assert.equal(result.nextCursor, "2");
  assert.equal(result.hasMore, true);
});

test("Youzan Adapters reject business errors returned with HTTP 200", async () => {
  const implementation = createYouzanOrderImplementation({
    fetchImpl: async () => response({ code: 4201, success: false, message: "非法的请求凭证" }),
  });

  await assert.rejects(() => implementation({
    limit: 1,
    env: {
      YOUZAN_ORDER_LIST_URL: "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4",
      YOUZAN_ACCESS_TOKEN: "expired",
    },
  }), (error) => {
    assert.equal(error.code, 4201);
    assert.match(error.message, /非法的请求凭证/);
    return true;
  });
});

test("Youzan coupon numeric use status maps to lifecycle reward status", () => {
  assert.equal(normalizeExternalStatus(1), "ISSUED");
  assert.equal(normalizeExternalStatus(2), "USED");
  assert.equal(normalizeExternalStatus(3), "EXPIRED");
});

test("official Youzan coupon Adapter sends only native voucheractivity fields", async () => {
  let calledUrl = "";
  let calledMethod = "";
  let requestBody = null;
  const implementation = createYouzanCouponImplementation({
    fetchImpl: async (url, init) => {
      calledUrl = String(url);
      calledMethod = init.method;
      requestBody = JSON.parse(init.body);
      return response({
        code: 200,
        success: true,
        data: {
          activity_id: 32550082,
          coupon_id: 18789010589,
          coupon_type: 0,
          code_value: "ROOT-CODE-001",
          status: 1,
          yz_open_id: "yz-open-sensitive",
        },
      });
    },
  });
  const result = await implementation({
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_COUPON_SEND_METHOD: "GET",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: {
      reward_grant_id: "grant-internal",
      root_user_id: "root-1001",
      campaign_id: "campaign-internal",
      reward_type: "YOUZAN_COUPON",
      reward_key: "coupon-internal",
      payload_json: { activity_id: 32550082, mobile: "13800000000", yz_open_id: "wrong-static-user" },
    },
    job: { reward_delivery_job_id: "job-internal" },
    body: { requestId: "request-internal", payload: { activity_id: 99999999, yz_open_id: "wrong-body-user" } },
    data: {
      youzanCustomers: [{ root_user_id: "root-1001", youzan_yz_uid: "yz-open-1001" }],
    },
  });

  assert.equal(new URL(calledUrl).searchParams.get("access_token"), "masked");
  assert.equal(calledMethod, "POST");
  assert.deepEqual(requestBody, { activity_id: 32550082, yz_open_id: "yz-open-1001" });
  assert.equal(result.externalRef, "18789010589");
  assert.equal(result.status, "DELIVERED");
});

test("official Youzan coupon Adapter rejects a grant without a recipient identity", async () => {
  let called = false;
  const implementation = createYouzanCouponImplementation({
    fetchImpl: async () => {
      called = true;
      return response({ code: 200, success: true });
    },
  });

  await assert.rejects(() => implementation({
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { root_user_id: "root-without-youzan", payload_json: { activity_id: 32550082 } },
    data: { youzanCustomers: [] },
  }), /身份对账/);
  assert.equal(called, false);
});

test("official Youzan coupon Adapter rejects ambiguous linked recipients", async () => {
  let called = false;
  const implementation = createYouzanCouponImplementation({
    fetchImpl: async () => {
      called = true;
      return response({ code: 200, success: true });
    },
  });

  await assert.rejects(() => implementation({
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { root_user_id: "root-ambiguous", payload_json: { activity_id: 32550082 } },
    data: {
      youzanCustomers: [
        { root_user_id: "root-ambiguous", youzan_yz_uid: "yz-open-a" },
        { root_user_id: "root-ambiguous", youzan_yz_uid: "yz-open-b" },
      ],
    },
  }), /多个 yz_open_id/);
  assert.equal(called, false);
});

test("official Youzan coupon Adapter rejects a non-numeric activity before sending", async () => {
  let called = false;
  const implementation = createYouzanCouponImplementation({
    fetchImpl: async () => {
      called = true;
      return response({ code: 200, success: true });
    },
  });

  await assert.rejects(() => implementation({
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { root_user_id: "root-invalid-activity", payload_json: { activity_id: "campaign-code" } },
    data: { youzanCustomers: [{ root_user_id: "root-invalid-activity", youzan_yz_uid: "yz-open-valid" }] },
  }), /activity_id 必须是正整数/);
  assert.equal(called, false);
});

test("official Youzan coupon success without coupon id is delivered once and creates review work", async () => {
  let callCount = 0;
  const data = {
    rewardDeliveryJobs: [{
      reward_delivery_job_id: "job-review-001",
      reward_grant_id: "grant-review-001",
      adapter_type: "YOUZAN_COUPON",
      status: "PENDING",
      attempt_count: 0,
      last_error: "",
      next_retry_at: "",
    }],
    rewardGrants: [{
      reward_grant_id: "grant-review-001",
      root_user_id: "root-review-001",
      reward_type: "YOUZAN_COUPON",
      status: "PENDING_DELIVERY",
      payload_json: { activity_id: 32550082 },
    }],
    youzanCustomers: [{ root_user_id: "root-review-001", youzan_yz_uid: "yz-open-review-001" }],
    operationTasks: [],
    auditLogs: [],
  };
  const context = {
    data,
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    fetchImpl: async () => {
      callCount += 1;
      return response({ code: 200, success: true, data: { status: 1, code_value: "not-a-coupon-id" } });
    },
  };

  const first = await rewardDelivery.executeDeliveryBatch(data, {
    deliveryJobIds: ["job-review-001"],
    confirmRisk: true,
    requestId: "request-review-001",
  }, context);
  const second = await rewardDelivery.executeDeliveryBatch(data, {
    deliveryJobIds: ["job-review-001"],
    confirmRisk: true,
    requestId: "request-review-002",
  }, context);

  assert.equal(first.summary.delivered, 1);
  assert.equal(second.summary.skipped, 1);
  assert.equal(callCount, 1);
  assert.equal(data.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(data.rewardDeliveryJobs[0].next_retry_at, "");
  assert.equal(data.rewardGrants[0].external_ref, "");
  assert.equal(data.operationTasks.length, 1);
  assert.equal(data.operationTasks[0].task_type, "YOUZAN_COUPON_DELIVERY_REVIEW_REQUIRED");
  assert.equal(data.operationTasks[0].dedupe_key, "job-review-001");
});

test("official Youzan coupon success with a non-numeric coupon reference requires review", async () => {
  const implementation = createYouzanCouponImplementation({
    fetchImpl: async () => response({
      code: 200,
      success: true,
      data: { status: 1, coupon_id: "voucher-code-not-id", code_value: "voucher-code" },
    }),
  });
  const result = await implementation({
    env: {
      YOUZAN_COUPON_SEND_URL: "https://open.youzanyun.com/api/youzan.ump.voucheractivity.send/3.0.1",
      YOUZAN_ACCESS_TOKEN: "masked",
      YOUZAN_COUPON_RESULT_FIELD_MAP: JSON.stringify({ externalRef: "data.code_value" }),
    },
    grant: { root_user_id: "root-review-invalid-ref", payload_json: { activity_id: 32550082 } },
    data: { youzanCustomers: [{ root_user_id: "root-review-invalid-ref", youzan_yz_uid: "yz-open-valid" }] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.externalRef, "");
  assert.equal(result.requiresReview, true);
});

test("official Youzan coupon status Adapter posts coupon identity fields", async () => {
  let calledUrl = "";
  let calledMethod = "";
  let requestBody = null;
  const implementation = createYouzanCouponStatusImplementation({
    fetchImpl: async (url, init) => {
      calledUrl = String(url);
      calledMethod = init.method;
      requestBody = JSON.parse(init.body);
      return response({
        code: 200,
        success: true,
        data: {
          status: 2,
          voucher_identity: { coupon_id: 18789010589, coupon_type: 0 },
          user_identity: { mobile: "13800000000", yz_open_id: "yz-open-sensitive" },
        },
      });
    },
  });
  const result = await implementation({
    env: {
      YOUZAN_COUPON_STATUS_URL: "https://open.youzanyun.com/api/youzan.ump.voucher.query.detail/1.0.0",
      YOUZAN_COUPON_STATUS_METHOD: "GET",
      YOUZAN_COUPON_STATUS_EXTRA_PARAMS: JSON.stringify({ leaked: "must-not-send", coupon_id: "999" }),
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { external_ref: "18789010589", payload_json: { coupon_id: "999" } },
    body: { externalRef: "888", payload: { coupon_id: "777" } },
  });

  assert.equal(new URL(calledUrl).searchParams.get("access_token"), "masked");
  assert.equal(calledMethod, "POST");
  assert.deepEqual(requestBody, { coupon_id: "18789010589", coupon_type: 0 });
  assert.equal(result.externalStatus, "USED");
  assert.equal(result.externalRef, "18789010589");
});

test("official Youzan coupon status Adapter rejects a non-numeric persisted coupon id", async () => {
  let called = false;
  const implementation = createYouzanCouponStatusImplementation({
    fetchImpl: async () => {
      called = true;
      return response({ code: 200, success: true });
    },
  });

  await assert.rejects(() => implementation({
    env: {
      YOUZAN_COUPON_STATUS_URL: "https://open.youzanyun.com/api/youzan.ump.voucher.query.detail/1.0.0",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { external_ref: "voucher-code-not-id", payload_json: {} },
  }), /coupon_id 必须是正整数/);
  assert.equal(called, false);
});

test("official Youzan coupon status Adapter rejects a mismatched response coupon id", async () => {
  const implementation = createYouzanCouponStatusImplementation({
    fetchImpl: async () => response({
      code: 200,
      success: true,
      data: { status: 1, voucher_identity: { coupon_id: 18789010590, coupon_type: 0 } },
    }),
  });

  await assert.rejects(() => implementation({
    env: {
      YOUZAN_COUPON_STATUS_URL: "https://open.youzanyun.com/api/youzan.ump.voucher.query.detail/1.0.0",
      YOUZAN_ACCESS_TOKEN: "masked",
    },
    grant: { external_ref: "18789010589", payload_json: {} },
  }), /coupon_id 与请求不一致/);
});
