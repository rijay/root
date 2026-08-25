const assert = require("node:assert/strict");
const test = require("node:test");

const {
  API,
  createEnvironmentYouzanCommerceAdapter,
  priceText,
} = require("../src/youzanCommerceAdapter");

const TOKEN = "youzan-test-access-token-1234567890";
const NOW = "2026-08-25T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function success(payload = {}) {
  return response({ code: 200, success: true, ...payload });
}

test("Youzan Adapter resolves a verified unionid and returns only minimized order and coupon counts", async () => {
  const calls = [];
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    now: () => new Date(NOW),
    nowMs: () => NOW_MS,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      const body = JSON.parse(options.body);
      calls.push({ pathname: parsed.pathname, token: parsed.searchParams.get("access_token"), body });
      if (parsed.pathname.includes("youzan.users.info.query")) {
        return success({ data: { user_list: [
          { primitive_info: { yz_open_id: "yz-open-member" }, private_info: { mobile: "不得返回" } },
          { primitive_info: { yz_open_id: "yz-open-member" } },
        ] } });
      }
      if (parsed.pathname.includes("youzan.trades.sold.get")) {
        return success({ data: {
          total_results: 3,
          full_order_info_list: [
            { full_order_info: { order_info: { status: "WAIT_BUYER_PAY", tid: "不得返回" } } },
            { full_order_info: { order_info: { status: "TRADE_SUCCESS" } } },
            { full_order_info: { order_info: { status: "WAIT_BUYER_CONFIRM_GOODS" } } },
          ],
        } });
      }
      if (parsed.pathname.includes("youzan.ump.voucher.query")) {
        return success({
          total: 2,
          data: [
            { valid_end_time: NOW_MS + 2 * 24 * 60 * 60 * 1000, verify_code: "不得返回" },
            { valid_end_time: NOW_MS + 20 * 24 * 60 * 60 * 1000 },
          ],
        });
      }
      throw new Error("unexpected endpoint");
    },
  });

  const [left, right] = await Promise.all([
    adapter.readSummary({ unionid: "unionid-member" }),
    adapter.readSummary({ unionid: "unionid-member" }),
  ]);
  assert.deepEqual(left, {
    orders: { totalCount: 3, pendingCount: 2 },
    coupons: { availableCount: 2, expiringSoonCount: 1 },
    priceSync: { syncedAt: NOW },
  });
  assert.deepEqual(right, left);
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.token === TOKEN), true);
  assert.deepEqual(calls[0].body, { weixin_union_id: "unionid-member", result_type_list: [0, 1, 2, 9] });
  assert.equal(calls.slice(1).every((call) => call.body.yz_open_id === "yz-open-member"), true);
  assert.equal(JSON.stringify(left).includes("unionid-member"), false);
  assert.equal(JSON.stringify(left).includes("yz-open-member"), false);
  assert.equal(JSON.stringify(left).includes("不得返回"), false);

  await adapter.readSummary({ unionid: "unionid-member" });
  assert.equal(calls.length, 3);
});

test("Youzan Adapter fails closed when a unionid maps to zero or multiple accounts", async () => {
  for (const [users, expectedCode] of [
    [[], "YOUZAN_IDENTITY_NOT_FOUND"],
    [[
      { primitive_info: { yz_open_id: "yz-open-a" } },
      { primitive_info: { yz_open_id: "yz-open-b" } },
    ], "YOUZAN_IDENTITY_AMBIGUOUS"],
  ]) {
    const adapter = createEnvironmentYouzanCommerceAdapter({}, {
      accessTokenProvider: async () => TOKEN,
      fetchImpl: async () => success({ data: { user_list: users } }),
    });
    await assert.rejects(
      adapter.readSummary({ unionid: "unionid-member" }),
      (error) => error.code === expectedCode,
    );
  }
});

test("Youzan Adapter computes exact pending counts for order histories larger than one page", async () => {
  const statusTotals = new Map([
    ["WAIT_BUYER_PAY", 2],
    ["WAIT_SELLER_SEND_GOODS", 1],
    ["WAIT_BUYER_CONFIRM_GOODS", 3],
    ["TRADE_PAID", 0],
  ]);
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    async fetchImpl(url, options) {
      const pathname = new URL(url).pathname;
      const body = JSON.parse(options.body);
      if (pathname.includes("youzan.users.info.query")) {
        return success({ data: { user_list: [{ primitive_info: { yz_open_id: "yz-open-member" } }] } });
      }
      if (pathname.includes("youzan.trades.sold.get")) {
        if (body.status) return success({ data: { total_results: statusTotals.get(body.status), full_order_info_list: [] } });
        return success({ data: {
          total_results: 101,
          full_order_info_list: [{ full_order_info: { order_info: { status: "TRADE_SUCCESS" } } }],
        } });
      }
      return success({ total: 0, data: [] });
    },
  });
  const summary = await adapter.readSummary({ unionid: "unionid-member" });
  assert.deepEqual(summary.orders, { totalCount: 101, pendingCount: 6 });
});

test("Youzan Adapter exposes live price and SKU snapshots without trusting remote titles or jump paths", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    now: () => new Date(NOW),
    async fetchImpl(url, options) {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      assert.equal(new URL(url).origin, "https://open.youzanyun.com");
      assert.equal(new URL(url).pathname, new URL(API.product).pathname);
      assert.deepEqual(JSON.parse(options.body), { item_id: 4749049439 });
      const result = success({ data: { item: {
        item_id: 4749049439,
        title: "远端标题不得覆盖官方标题",
        detail_url: "https://example.invalid/不得使用",
        pic_url: "https://img01.yzcdn.cn/product.jpg",
        price: 19900,
        skus: [
          { sku_id: 101, properties_name_json: JSON.stringify([{ k: "规格", v: "14袋" }]), price: 19900, quantity: 8 },
          { sku_id: 102, properties_name: "28袋", price: 36900, quantity: 0 },
        ],
      } } });
      await Promise.resolve();
      active -= 1;
      return result;
    },
  });

  const first = await adapter.readProductSnapshots({ productIds: ["4749049439", "4749049439"] });
  const second = await adapter.readProductSnapshots({ productIds: ["4749049439"] });
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(first, {
    products: [{
      productId: "4749049439",
      imageUrl: "https://img01.yzcdn.cn/product.jpg",
      price: 19900,
      priceText: "¥199",
      skus: [
        { skuId: "101", skuName: "14袋", price: 19900, priceText: "¥199", stockStatus: "IN_STOCK" },
        { skuId: "102", skuName: "28袋", price: 36900, priceText: "¥369", stockStatus: "OUT_OF_STOCK" },
      ],
      syncedAt: NOW,
    }],
    syncedAt: NOW,
  });
});

test("Youzan Adapter serializes multi-product live reads to avoid gateway bursts", async () => {
  let active = 0;
  let maximumActive = 0;
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    async fetchImpl(_url, options) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const itemId = JSON.parse(options.body).item_id;
      return success({ data: { item: { item_id: itemId, price: 19900, skus: [] } } });
    },
  });
  const result = await adapter.readProductSnapshots({ productIds: ["4749049439", "4875324599"] });
  assert.equal(result.products.length, 2);
  assert.equal(maximumActive, 1);
});

test("Youzan Adapter never forwards credential-bearing upstream errors", async () => {
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    fetchImpl: async () => { throw new Error(`upstream leaked ${TOKEN}`); },
  });
  await assert.rejects(adapter.readSummary({ unionid: "unionid-member" }), (error) => {
    assert.equal(error.code, "YOUZAN_REQUEST_FAILED");
    assert.equal(String(error.message).includes(TOKEN), false);
    assert.equal(String(error.stack).includes(TOKEN), false);
    return true;
  });
});

test("Youzan Adapter rejects gateway error envelopes even when HTTP status is 200", async () => {
  const adapter = createEnvironmentYouzanCommerceAdapter({}, {
    accessTokenProvider: async () => TOKEN,
    fetchImpl: async () => response({ gw_err_resp: { err_code: 4007, err_msg: "gateway rejected" } }),
  });
  await assert.rejects(
    adapter.readProductSnapshots({ productIds: ["4749049439"] }),
    (error) => error.code === "YOUZAN_BUSINESS_FAILED",
  );
});

test("Youzan price formatter treats API amounts as cents", () => {
  assert.equal(priceText(19900), "¥199");
  assert.equal(priceText(19950), "¥199.50");
  assert.equal(priceText("invalid"), "");
});
