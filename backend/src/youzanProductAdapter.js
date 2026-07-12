const { assertYouzanTokenReady } = require("./youzanTokenPolicy");

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMethod(value) {
  const method = String(value || "POST").toUpperCase();
  return method === "GET" ? "GET" : "POST";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw adapterError(400, `有赞商品 Adapter 配置不是合法 JSON：${error.message}`);
  }
}

function getPath(source, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function firstDefined(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstArray(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeFieldMap(env, key) {
  const fieldMap = parseJsonEnv(env[key], {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function mapSku(record, productId, fieldMap, index = 0) {
  return {
    skuId: valueFor(record, fieldMap, "skuId", ["skuId", "sku_id", "youzanSkuId", "youzan_sku_id", "id", "sku_no"]) || `${productId}_SKU_${index + 1}`,
    skuName: valueFor(record, fieldMap, "skuName", ["skuName", "sku_name", "name", "title", "spec", "spec_name"]) || "默认规格",
    price: valueFor(record, fieldMap, "price", ["price", "sale_price", "salePrice", "retail_price", "retailPrice"]),
    priceText: valueFor(record, fieldMap, "priceText", ["priceText", "price_text"]),
    stockStatus: valueFor(record, fieldMap, "stockStatus", ["stockStatus", "stock_status", "stockStatusText", "inventory_status", "status"]) || "UNKNOWN",
    rawPayload: record,
  };
}

function statusFor(record, fieldMap) {
  const value = String(valueFor(record, fieldMap, "status", ["status", "item_status", "display_status", "state"]) || "ACTIVE").toUpperCase();
  if (["HIDDEN", "SOLD_OUT", "ARCHIVED"].includes(value)) return value;
  if (["下架", "隐藏", "DISABLED"].includes(value)) return "HIDDEN";
  if (["售罄", "SOLDOUT"].includes(value)) return "SOLD_OUT";
  return "ACTIVE";
}

function mapProduct(record, productFieldMap, skuFieldMap, env = {}) {
  const productId = valueFor(record, productFieldMap, "productId", ["productId", "product_id", "youzanProductId", "youzan_product_id", "item_id", "goods_id", "id"]);
  const skus = firstArray(record, [
    env.YOUZAN_PRODUCT_SKUS_PATH,
    "skus",
    "sku_list",
    "skuList",
    "specs",
    "models",
    "items",
  ].filter(Boolean));
  return {
    youzanProductId: productId,
    title: valueFor(record, productFieldMap, "title", ["title", "name", "goods_name", "item_name"]),
    subtitle: valueFor(record, productFieldMap, "subtitle", ["subtitle", "sub_title", "selling_point"]),
    summary: valueFor(record, productFieldMap, "summary", ["summary", "desc", "description_short"]),
    description: valueFor(record, productFieldMap, "description", ["description", "detail", "body"]),
    imageUrl: valueFor(record, productFieldMap, "imageUrl", ["imageUrl", "image_url", "cover", "cover_url", "pic_url", "picture", "images.0"]),
    priceText: valueFor(record, productFieldMap, "priceText", ["priceText", "price_text"]),
    status: statusFor(record, productFieldMap),
    badge: valueFor(record, productFieldMap, "badge", ["badge", "tag", "label"]),
    youzanAppId: valueFor(record, productFieldMap, "youzanAppId", ["youzanAppId", "youzan_app_id", "app_id"]),
    youzanPath: valueFor(record, productFieldMap, "youzanPath", ["youzanPath", "youzan_path", "mini_path", "path", "url"]),
    displayOrder: valueFor(record, productFieldMap, "displayOrder", ["displayOrder", "display_order", "sort", "weight"]),
    rawPayload: record,
    skus: skus.map((sku, index) => mapSku(sku, productId, skuFieldMap, index)),
  };
}

function applyToken(env, url, headers, params) {
  const token = env.YOUZAN_PRODUCT_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN || "";
  const tokenParam = env.YOUZAN_PRODUCT_ACCESS_TOKEN_PARAM || env.YOUZAN_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.YOUZAN_PRODUCT_ACCESS_TOKEN_LOCATION || env.YOUZAN_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
  if (location === "header") {
    headers.Authorization = `Bearer ${token}`;
    return;
  }
  if (location === "body") {
    params[tokenParam] = token;
    return;
  }
  url.searchParams.set(tokenParam, token);
}

function buildRequest(env, cursor, limit) {
  const url = new URL(env.YOUZAN_PRODUCT_LIST_URL);
  const method = normalizeMethod(env.YOUZAN_PRODUCT_LIST_METHOD);
  const limitParam = env.YOUZAN_PRODUCT_LIST_LIMIT_PARAM || "page_size";
  const cursorParam = env.YOUZAN_PRODUCT_LIST_CURSOR_PARAM || "cursor";
  const params = {
    ...parseJsonEnv(env.YOUZAN_PRODUCT_LIST_EXTRA_PARAMS, {}),
    [limitParam]: limit,
  };
  if (cursor) params[cursorParam] = cursor;

  const headers = { Accept: "application/json" };
  applyToken(env, url, headers, params);
  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return { url, init: { method, headers } };
  }
  headers["Content-Type"] = "application/json";
  return { url, init: { method, headers, body: JSON.stringify(params) } };
}

async function readResponseJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw adapterError(502, `有赞商品响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞商品拉取失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeProductPayload(payload, env, productFieldMap, skuFieldMap) {
  const records = firstArray(payload, [
    env.YOUZAN_PRODUCT_LIST_DATA_PATH,
    "data.items",
    "data.goods",
    "data.list",
    "response.items",
    "response.goods",
    "items",
    "goods",
    "list",
    "records",
    "data",
  ].filter(Boolean));
  const cursorAfter = firstDefined(payload, [
    env.YOUZAN_PRODUCT_LIST_CURSOR_PATH,
    "data.next_cursor",
    "data.nextCursor",
    "data.next_page_token",
    "response.next_cursor",
    "next_cursor",
    "nextCursor",
    "cursor",
  ].filter(Boolean)) || "";
  const hasMoreValue = firstDefined(payload, [
    env.YOUZAN_PRODUCT_LIST_HAS_MORE_PATH,
    "data.has_more",
    "data.hasMore",
    "response.has_more",
    "has_more",
    "hasMore",
  ].filter(Boolean));
  return {
    products: records.map((record) => mapProduct(record, productFieldMap, skuFieldMap, env)),
    externalCount: records.length,
    nextCursor: cursorAfter,
    hasMore: hasMoreValue === undefined ? Boolean(cursorAfter) : Boolean(hasMoreValue),
  };
}

function createYouzanProductImplementation(options = {}) {
  return async function fetchYouzanProducts(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.YOUZAN_PRODUCT_LIST_URL) throw adapterError(400, "有赞商品 Adapter 缺少 YOUZAN_PRODUCT_LIST_URL");
    if (!env.YOUZAN_PRODUCT_ACCESS_TOKEN && !env.YOUZAN_ACCESS_TOKEN) {
      throw adapterError(400, "有赞商品 Adapter 缺少 YOUZAN_PRODUCT_ACCESS_TOKEN 或 YOUZAN_ACCESS_TOKEN");
    }
    assertYouzanTokenReady(env, {
      expiryNames: env.YOUZAN_PRODUCT_ACCESS_TOKEN ? ["YOUZAN_PRODUCT_ACCESS_TOKEN_EXPIRES_AT"] : [],
    });
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const productFieldMap = normalizeFieldMap(env, "YOUZAN_PRODUCT_FIELD_MAP");
    const skuFieldMap = normalizeFieldMap(env, "YOUZAN_SKU_FIELD_MAP");
    const request = buildRequest(env, context.cursor, context.limit);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeProductPayload(payload, env, productFieldMap, skuFieldMap);
  };
}

module.exports = {
  buildRequest,
  createYouzanProductImplementation,
  mapProduct,
  mapSku,
};
