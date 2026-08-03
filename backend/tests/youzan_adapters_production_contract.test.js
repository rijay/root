const assert = require("node:assert/strict");
const test = require("node:test");
const { createYouzanOrderImplementation } = require("../src/youzanOpenAdapter");
const { createYouzanCustomerImplementation } = require("../src/youzanCustomerAdapter");
const { isOfficialYouzanUrl } = require("../src/youzanOpenRequest");

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test("official Youzan URL recognition requires the exact method and version path", () => {
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4",
    "youzan.trades.sold.get"
  ), true);
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/proxy/api/youzan.trades.sold.get/4.0.4",
    "youzan.trades.sold.get"
  ), false);
  assert.equal(isOfficialYouzanUrl(
    "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4/extra",
    "youzan.trades.sold.get"
  ), false);
  assert.equal(isOfficialYouzanUrl(
    "https://example.com/api/youzan.trades.sold.get/4.0.4",
    "youzan.trades.sold.get"
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
