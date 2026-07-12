const { assertYouzanBusinessSuccess, derivePageCursor } = require("./youzanResponse");
const { assertYouzanTokenReady } = require("./youzanTokenPolicy");

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMethod(value) {
  return String(value || "POST").toUpperCase() === "GET" ? "GET" : "POST";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw adapterError(400, `有赞客户 Adapter 配置不是合法 JSON：${error.message}`);
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

function normalizeFieldMap(env) {
  const fieldMap = parseJsonEnv(env.YOUZAN_CUSTOMER_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function mapYouzanCustomer(record, fieldMap) {
  return {
    youzanYzUid: valueFor(record, fieldMap, "youzanYzUid", ["youzanYzUid", "youzan_yz_uid", "yzOpenId", "yz_open_id", "yzUid", "yz_uid", "buyer_id", "buyerId", "fans_id", "fansId", "customer_id", "id"]),
    unionid: valueFor(record, fieldMap, "unionid", ["unionid", "union_id", "unionId", "wechat.unionid", "profile.unionid"]),
    phone: valueFor(record, fieldMap, "phone", ["phone", "mobile", "buyer_phone", "buyerPhone", "profile.mobile"]),
    nickname: valueFor(record, fieldMap, "nickname", ["nickname", "nick_name", "nickName", "show_name", "showName", "name", "buyer_name", "buyerName", "profile.nickname"]),
    rawPayload: record,
  };
}

function applyToken(env, url, headers, params) {
  const token = env.YOUZAN_CUSTOMER_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN || "";
  const tokenParam = env.YOUZAN_CUSTOMER_ACCESS_TOKEN_PARAM || env.YOUZAN_ACCESS_TOKEN_PARAM || "access_token";
  const tokenLocation = String(env.YOUZAN_CUSTOMER_ACCESS_TOKEN_LOCATION || env.YOUZAN_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
  if (tokenLocation === "header") {
    headers.Authorization = `Bearer ${token}`;
    return;
  }
  if (tokenLocation === "body") {
    params[tokenParam] = token;
    return;
  }
  url.searchParams.set(tokenParam, token);
}

function buildRequest(env, cursor, limit) {
  const url = new URL(env.YOUZAN_CUSTOMER_LIST_URL);
  const method = normalizeMethod(env.YOUZAN_CUSTOMER_LIST_METHOD);
  const limitParam = env.YOUZAN_CUSTOMER_LIST_LIMIT_PARAM || "page_size";
  const cursorParam = env.YOUZAN_CUSTOMER_LIST_CURSOR_PARAM || "page_no";
  const params = {
    ...parseJsonEnv(env.YOUZAN_CUSTOMER_LIST_EXTRA_PARAMS, {}),
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
    throw adapterError(502, `有赞客户响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞客户拉取失败：HTTP ${response.status}`, payload);
  }
  return assertYouzanBusinessSuccess(payload, "有赞客户拉取", adapterError);
}

function normalizeCustomerPayload(payload, env, fieldMap, currentCursor, limit) {
  const records = firstArray(payload, [
    env.YOUZAN_CUSTOMER_LIST_DATA_PATH,
    "data.record_list",
    "data.items",
    "data.list",
    "data.customers",
    "response.items",
    "response.customers",
    "items",
    "customers",
    "list",
    "records",
    "data",
  ].filter(Boolean));
  const cursorPaths = [
    env.YOUZAN_CUSTOMER_LIST_CURSOR_PATH,
    "data.next_cursor",
    "data.nextCursor",
    "data.next_page_token",
    "response.next_cursor",
    "next_cursor",
    "nextCursor",
    "cursor",
  ].filter(Boolean);
  const cursorAfter = derivePageCursor(payload, currentCursor, limit, {
    cursor: cursorPaths,
    total: [
      "data.paginator.total_count",
      "response.paginator.total_count",
      "paginator.total_count",
      "data.total",
      "data.total_count",
      "data.total_results",
      "response.total",
      "total",
      "total_count",
      "total_results",
    ],
    page: [
      "data.paginator.page",
      "response.paginator.page",
      "paginator.page",
      "data.page_no",
      "data.page",
      "response.page_no",
      "response.page",
      "page_no",
      "page",
    ],
    pageSize: [
      "data.paginator.page_size",
      "response.paginator.page_size",
      "paginator.page_size",
      "data.page_size",
      "response.page_size",
      "page_size",
    ],
  });
  const hasMoreValue = firstDefined(payload, [
    env.YOUZAN_CUSTOMER_LIST_HAS_MORE_PATH,
    "data.has_more",
    "data.hasMore",
    "response.has_more",
    "has_more",
    "hasMore",
  ].filter(Boolean));
  return {
    samples: records.map((record) => mapYouzanCustomer(record, fieldMap)),
    externalCount: records.length,
    nextCursor: cursorAfter,
    hasMore: hasMoreValue === undefined ? Boolean(cursorAfter) : Boolean(hasMoreValue),
  };
}

function createYouzanCustomerImplementation(options = {}) {
  return async function fetchYouzanCustomers(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.YOUZAN_CUSTOMER_LIST_URL) throw adapterError(400, "有赞客户 Adapter 缺少 YOUZAN_CUSTOMER_LIST_URL");
    if (!env.YOUZAN_CUSTOMER_ACCESS_TOKEN && !env.YOUZAN_ACCESS_TOKEN) {
      throw adapterError(400, "有赞客户 Adapter 缺少 YOUZAN_CUSTOMER_ACCESS_TOKEN 或 YOUZAN_ACCESS_TOKEN");
    }
    assertYouzanTokenReady(env, {
      expiryNames: env.YOUZAN_CUSTOMER_ACCESS_TOKEN ? ["YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT"] : [],
    });
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context.cursor, context.limit);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeCustomerPayload(payload, env, fieldMap, context.cursor, context.limit);
  };
}

module.exports = {
  buildRequest,
  createYouzanCustomerImplementation,
  mapYouzanCustomer,
};
