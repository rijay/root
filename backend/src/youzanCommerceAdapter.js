const crypto = require("node:crypto");

const API = Object.freeze({
  userByUnionId: "https://open.youzanyun.com/api/youzan.users.info.query/1.0.1",
  orders: "https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4",
  coupons: "https://open.youzanyun.com/api/youzan.ump.voucher.query/3.0.0",
  product: "https://open.youzanyun.com/api/youzan.item.detail.get/1.0.0",
});
const PENDING_ORDER_STATUSES = Object.freeze([
  "WAIT_BUYER_PAY",
  "WAIT_SELLER_SEND_GOODS",
  "WAIT_BUYER_CONFIRM_GOODS",
  "TRADE_PAID",
]);
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_IDENTITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRODUCT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 2;
const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function adapterError(code) {
  const error = new Error("有赞会员信息暂时不可用");
  error.code = code;
  return error;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNowISO(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function assertOfficialEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.hostname !== "open.youzanyun.com" || !parsed.pathname.startsWith("/api/")) {
    throw adapterError("YOUZAN_ENDPOINT_REJECTED");
  }
  return parsed;
}

function createCache(nowMs = () => Date.now()) {
  const values = new Map();
  const inflight = new Map();
  return async function cached(key, ttlMs, loader) {
    const current = values.get(key);
    const timestamp = nowMs();
    if (current && current.expiresAt > timestamp) return current.value;
    if (inflight.has(key)) return inflight.get(key);
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        values.set(key, { expiresAt: nowMs() + ttlMs, value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}

function createConcurrencyLimiter(maxConcurrent) {
  let active = 0;
  const queued = [];

  function startNext() {
    while (active < maxConcurrent && queued.length) {
      const entry = queued.shift();
      active += 1;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          startNext();
        });
    }
  }

  return function limit(task) {
    return new Promise((resolve, reject) => {
      queued.push({ task, resolve, reject });
      startNext();
    });
  };
}

function responseSucceeded(body) {
  const source = asObject(body);
  if (source.gw_err_resp || source.error_response || source.success !== true) return false;
  return Number(source.code) === 200;
}

function extractYzOpenId(body) {
  const data = asObject(asObject(body).data);
  const users = asArray(data.user_list || data.userList || (Array.isArray(asObject(body).data) ? asObject(body).data : []));
  const ids = [...new Set(users.map((item) => String(
    asObject(item).yz_open_id
      || asObject(asObject(item).primitive_info).yz_open_id
      || asObject(asObject(item).primitiveInfo).yzOpenId
      || "",
  ).trim()).filter(Boolean))];
  if (ids.length === 0) throw adapterError("YOUZAN_IDENTITY_NOT_FOUND");
  if (ids.length !== 1) throw adapterError("YOUZAN_IDENTITY_AMBIGUOUS");
  return ids[0];
}

function orderRows(body) {
  return asArray(asObject(asObject(body).data).full_order_info_list)
    .map((item) => asObject(asObject(item).full_order_info || item));
}

function orderStatus(order) {
  return String(asObject(asObject(order).order_info).status || "").trim();
}

function orderTotal(body) {
  return nonNegativeInteger(asObject(asObject(body).data).total_results, orderRows(body).length);
}

function couponRows(body) {
  return asArray(asObject(body).data);
}

function couponTotal(body) {
  return nonNegativeInteger(asObject(body).total, couponRows(body).length);
}

function timestampMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function expiringSoonCount(rows, nowMs) {
  const boundary = nowMs + EXPIRING_SOON_WINDOW_MS;
  return rows.reduce((count, item) => {
    const expiresAt = timestampMs(asObject(item).valid_end_time);
    return count + (expiresAt > nowMs && expiresAt <= boundary ? 1 : 0);
  }, 0);
}

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

function priceText(value) {
  const amount = cents(value);
  if (amount === null) return "";
  return `¥${(amount / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function imageUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" || !/(^|\.)yzcdn\.cn$/i.test(parsed.hostname)) return "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function stockStatus(sku) {
  const quantity = Number(asObject(sku).quantity ?? asObject(sku).stock_num ?? asObject(sku).stockNum);
  if (!Number.isFinite(quantity)) return "UNKNOWN";
  return quantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
}

function skuName(source) {
  const direct = String(source.properties_name || source.propertiesName || source.sku_name || source.skuName || source.title || source.name || "").trim();
  if (direct) return direct;
  let properties = source.properties_name_json || source.propertiesNameJson;
  if (typeof properties === "string") {
    try {
      properties = JSON.parse(properties);
    } catch (error) {
      properties = null;
    }
  }
  const values = asArray(properties).map((item) => String(
    asObject(item).v
      || asObject(item).prop_value_name
      || asObject(item).propValueName
      || asObject(item).value_name
      || "",
  ).trim()).filter(Boolean);
  if (values.length) return values.join(" / ");
  const skuValues = asArray(source.sku_value_props || source.skuValueProps)
    .map((item) => String(asObject(item).prop_value_name || asObject(item).propValueName || "").trim())
    .filter(Boolean);
  if (skuValues.length) return skuValues.join(" / ");
  return values.join(" / ") || "默认规格";
}

function normalizedSku(sku, index) {
  const source = asObject(sku);
  const rawPrice = source.price ?? asObject(source.item_price_param || source.itemPriceParam).price;
  return {
    skuId: String(source.sku_id || source.skuId || `sku-${index + 1}`),
    skuName: skuName(source),
    price: cents(rawPrice),
    priceText: priceText(rawPrice) || "会员中心实时价格",
    stockStatus: stockStatus(source),
  };
}

function normalizedProduct(body, requestedProductId, syncedAt) {
  const data = asObject(asObject(body).data);
  const item = asObject(data.item || asObject(body).item || data);
  const productId = String(item.item_id || item.itemId || "").trim();
  if (!productId || productId !== String(requestedProductId)) throw adapterError("YOUZAN_PRODUCT_MISMATCH");
  const skus = asArray(item.skus || item.sku_list || item.skuList).map(normalizedSku);
  const itemPrice = item.price ?? asObject(item.item_price_param || item.itemPriceParam).price;
  const firstImage = asObject(asArray(item.images || item.image_list || item.imageList)[0]);
  return {
    productId,
    imageUrl: imageUrl(item.pic_url || item.picUrl || item.pic_thumb_url || item.image_url || firstImage.image_url || firstImage.imageUrl),
    price: cents(itemPrice),
    priceText: priceText(itemPrice) || (skus[0] && skus[0].priceText) || "会员中心实时价格",
    skus,
    syncedAt,
  };
}

function createEnvironmentYouzanCommerceAdapter(env = process.env, options = {}) {
  const fixedToken = String(env.ROOT_YOUZAN_ACCESS_TOKEN || "").trim();
  const accessTokenProvider = typeof options.accessTokenProvider === "function"
    ? options.accessTokenProvider
    : fixedToken
      ? async () => fixedToken
      : null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Boolean(accessTokenProvider && typeof fetchImpl === "function");
  const timeoutMs = boundedNumber(options.timeoutMs ?? env.ROOT_YOUZAN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 500, 30_000);
  const summaryCacheTtlMs = boundedNumber(
    options.summaryCacheTtlMs ?? env.ROOT_YOUZAN_SUMMARY_CACHE_TTL_MS,
    DEFAULT_SUMMARY_CACHE_TTL_MS,
    0,
    10 * 60 * 1000,
  );
  const identityCacheTtlMs = boundedNumber(
    options.identityCacheTtlMs ?? env.ROOT_YOUZAN_IDENTITY_CACHE_TTL_MS,
    DEFAULT_IDENTITY_CACHE_TTL_MS,
    60 * 1000,
    7 * 24 * 60 * 60 * 1000,
  );
  const productCacheTtlMs = boundedNumber(
    options.productCacheTtlMs ?? env.ROOT_YOUZAN_PRODUCT_CACHE_TTL_MS,
    DEFAULT_PRODUCT_CACHE_TTL_MS,
    0,
    30 * 60 * 1000,
  );
  const now = options.now || (() => new Date());
  const nowMs = options.nowMs || (() => Date.now());
  const kdtId = String(options.kdtId ?? env.ROOT_YOUZAN_KDT_ID ?? env.YOUZAN_GRANT_ID ?? "").trim();
  const cached = createCache(nowMs);
  const maxConcurrentRequests = boundedNumber(
    options.maxConcurrentRequests ?? env.ROOT_YOUZAN_MAX_CONCURRENT_REQUESTS,
    DEFAULT_MAX_CONCURRENT_REQUESTS,
    1,
    4,
  );
  const limitRequest = createConcurrencyLimiter(maxConcurrentRequests);

  async function call(endpoint, body) {
    if (!configured) throw adapterError("YOUZAN_NOT_CONFIGURED");
    const execute = async () => {
      let token;
      try {
        token = String(await accessTokenProvider()).trim();
      } catch (error) {
        throw adapterError("YOUZAN_TOKEN_UNAVAILABLE");
      }
      if (token.length < 16 || /\s/.test(token)) throw adapterError("YOUZAN_TOKEN_INVALID");
      const url = assertOfficialEndpoint(endpoint);
      url.searchParams.set("access_token", token);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        });
        if (!response || response.ok !== true) throw adapterError("YOUZAN_HTTP_FAILED");
        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw adapterError("YOUZAN_RESPONSE_INVALID");
        }
        if (!responseSucceeded(payload)) throw adapterError("YOUZAN_BUSINESS_FAILED");
        return payload;
      } catch (error) {
        if (error && String(error.code || "").startsWith("YOUZAN_")) throw error;
        throw adapterError(controller.signal.aborted ? "YOUZAN_TIMEOUT" : "YOUZAN_REQUEST_FAILED");
      } finally {
        clearTimeout(timeout);
      }
    };
    return limitRequest(execute);
  }

  async function resolveYzOpenId(unionid) {
    const normalized = String(unionid || "").trim();
    if (!normalized) throw adapterError("YOUZAN_UNIONID_REQUIRED");
    return cached(`identity:${digest(normalized)}`, identityCacheTtlMs, async () => {
      const result = await call(API.userByUnionId, {
        weixin_union_id: normalized,
        result_type_list: [0, 1, 2, 9],
      });
      return extractYzOpenId(result);
    });
  }

  async function readOrders(yzOpenId) {
    const first = await call(API.orders, { yz_open_id: yzOpenId, page_no: 1, page_size: 100 });
    const rows = orderRows(first);
    const totalCount = orderTotal(first);
    let pendingCount = rows.filter((order) => PENDING_ORDER_STATUSES.includes(orderStatus(order))).length;
    if (totalCount > rows.length) {
      const pending = await Promise.all(PENDING_ORDER_STATUSES.map(async (status) => orderTotal(await call(API.orders, {
        yz_open_id: yzOpenId,
        status,
        page_no: 1,
        page_size: 1,
      }))));
      pendingCount = pending.reduce((total, value) => total + value, 0);
    }
    return { totalCount, pendingCount };
  }

  async function readCoupons(yzOpenId) {
    const result = await call(API.coupons, {
      activity_type_group: 1,
      status: 1,
      yz_open_id: yzOpenId,
      page_num: 1,
      page_size: 200,
    });
    const rows = couponRows(result);
    const total = couponTotal(result);
    return {
      availableCount: total,
      expiringSoonCount: total <= rows.length ? expiringSoonCount(rows, nowMs()) : null,
    };
  }

  async function readSummary({ unionid } = {}) {
    const normalized = String(unionid || "").trim();
    if (!normalized) throw adapterError("YOUZAN_UNIONID_REQUIRED");
    return cached(`summary:${digest(normalized)}`, summaryCacheTtlMs, async () => {
      const yzOpenId = await resolveYzOpenId(normalized);
      const [orders, coupons] = await Promise.all([readOrders(yzOpenId), readCoupons(yzOpenId)]);
      return { orders, coupons, priceSync: { syncedAt: safeNowISO(now) } };
    });
  }

  async function readProductSnapshots({ productIds } = {}) {
    const ids = [...new Set(asArray(productIds).map((value) => String(value || "").trim()).filter(Boolean))];
    if (ids.length === 0) return { products: [], syncedAt: "" };
    if (!/^\d{1,20}$/.test(kdtId)) throw adapterError("YOUZAN_KDT_ID_REQUIRED");
    const cacheKey = `products:${digest(ids.slice().sort().join(","))}`;
    return cached(cacheKey, productCacheTtlMs, async () => {
      const syncedAt = safeNowISO(now);
      const products = await Promise.all(ids.map(async (productId) => normalizedProduct(
        await call(API.product, { kdt_id: Number(kdtId), item_id: Number(productId) || productId }),
        productId,
        syncedAt,
      )));
      return { products, syncedAt };
    });
  }

  return Object.freeze({
    configured,
    readProductSnapshots,
    readSummary,
  });
}

module.exports = Object.freeze({
  API,
  PENDING_ORDER_STATUSES,
  createEnvironmentYouzanCommerceAdapter,
  priceText,
});
