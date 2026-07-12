const { assertYouzanBusinessSuccess } = require("./youzanResponse");
const { assertYouzanTokenReady } = require("./youzanTokenPolicy");

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMethod(value) {
  const method = String(value || "GET").toUpperCase();
  return method === "POST" ? "POST" : "GET";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw adapterError(400, `有赞优惠券状态 Adapter 配置不是合法 JSON：${error.message}`);
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
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

function normalizeFieldMap(env) {
  const fieldMap = parseJsonEnv(env.YOUZAN_COUPON_STATUS_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function applyToken(env, url, headers, params) {
  const token = env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN || env.YOUZAN_COUPON_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN || "";
  const tokenParam = env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN_PARAM || env.YOUZAN_COUPON_ACCESS_TOKEN_PARAM || env.YOUZAN_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN_LOCATION || env.YOUZAN_COUPON_ACCESS_TOKEN_LOCATION || env.YOUZAN_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
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

function statusPayloadFor(context = {}) {
  const grant = context.grant || {};
  const job = context.job || {};
  const body = context.body || {};
  const payload = objectValue(grant.payload_json || grant.payload || {});
  const externalRef = text(body.externalRef || body.external_ref || body.couponNo || body.coupon_no || grant.external_ref || job.external_ref);
  return {
    ...payload,
    ...objectValue(body.payload || body.payload_json),
    rewardGrantId: grant.reward_grant_id || "",
    deliveryJobId: job.reward_delivery_job_id || "",
    rootUserId: grant.root_user_id || "",
    campaignId: grant.campaign_id || "",
    rewardType: grant.reward_type || "",
    rewardKey: grant.reward_key || "",
    externalRef,
  };
}

function buildRequest(env, context = {}) {
  const url = new URL(env.YOUZAN_COUPON_STATUS_URL);
  const method = normalizeMethod(env.YOUZAN_COUPON_STATUS_METHOD);
  const headers = { Accept: "application/json" };
  const params = {
    ...parseJsonEnv(env.YOUZAN_COUPON_STATUS_EXTRA_PARAMS, {}),
    ...statusPayloadFor(context),
  };
  const refParam = env.YOUZAN_COUPON_STATUS_REF_PARAM || "coupon_no";
  if (params.externalRef) params[refParam] = params.externalRef;
  applyToken(env, url, headers, params);

  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
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
    throw adapterError(502, `有赞优惠券状态响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞优惠券状态查询失败：HTTP ${response.status}`, payload);
  }
  return assertYouzanBusinessSuccess(payload, "有赞优惠券状态查询", adapterError);
}

function normalizeExternalStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "UNKNOWN";
  if (["2", "USED", "CONSUMED", "WRITE_OFF", "WRITEOFF", "核销", "已核销", "已使用", "使用"].includes(raw)) return "USED";
  if (["3", "EXPIRED", "TIMEOUT", "过期", "已过期"].includes(raw)) return "EXPIRED";
  if (["CANCELLED", "CANCELED", "INVALID", "VOID", "作废", "已作废", "已失效", "失效"].includes(raw)) return "CANCELLED";
  if (["NOT_FOUND", "NOTFOUND", "404", "不存在", "未找到"].includes(raw)) return "NOT_FOUND";
  if (["1", "ISSUED", "CLAIMED", "UNUSED", "AVAILABLE", "VALID", "DELIVERED", "SUCCESS", "已发放", "已领取", "未使用", "可使用"].includes(raw)) return "ISSUED";
  return raw;
}

function grantStatusForExternalStatus(status, fallbackStatus = "") {
  if (status === "USED") return "USED";
  if (status === "EXPIRED") return "EXPIRED";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "NOT_FOUND") return "DELIVERY_EXCEPTION";
  if (status === "ISSUED") return "DELIVERED";
  return fallbackStatus || "DELIVERED";
}

function normalizeCouponStatusResult(payload, env, fieldMap, context = {}) {
  const rawStatus = valueFor(payload, fieldMap, "externalStatus", [
    env.YOUZAN_COUPON_STATUS_PATH,
    "data.coupon_status",
    "data.couponStatus",
    "data.use_status",
    "data.useStatus",
    "data.status",
    "response.coupon_status",
    "response.status",
    "coupon_status",
    "couponStatus",
    "use_status",
    "useStatus",
    "status",
    "state",
  ].filter(Boolean));
  const externalStatus = normalizeExternalStatus(rawStatus);
  const externalRef = text(valueFor(payload, fieldMap, "externalRef", [
    env.YOUZAN_COUPON_STATUS_REF_PATH,
    "data.coupon_no",
    "data.couponNo",
    "data.coupon_code",
    "data.couponCode",
    "coupon_no",
    "couponNo",
    "coupon_code",
    "couponCode",
    "id",
  ].filter(Boolean)), context.grant && context.grant.external_ref);
  const usedAt = text(valueFor(payload, fieldMap, "usedAt", [
    env.YOUZAN_COUPON_STATUS_USED_AT_PATH,
    "data.used_at",
    "data.usedAt",
    "used_at",
    "usedAt",
  ].filter(Boolean)));
  const expiredAt = text(valueFor(payload, fieldMap, "expiredAt", [
    env.YOUZAN_COUPON_STATUS_EXPIRED_AT_PATH,
    "data.expired_at",
    "data.expiredAt",
    "expired_at",
    "expiredAt",
  ].filter(Boolean)));
  const message = text(valueFor(payload, fieldMap, "message", [
    env.YOUZAN_COUPON_STATUS_MESSAGE_PATH,
    "data.message",
    "response.message",
    "message",
    "msg",
    "error_msg",
  ].filter(Boolean)), "有赞优惠券状态查询完成");

  return {
    ok: externalStatus !== "UNKNOWN",
    externalStatus,
    grantStatus: grantStatusForExternalStatus(externalStatus, context.grant && context.grant.status),
    message: externalStatus === "UNKNOWN" ? "有赞优惠券状态无法识别" : message,
    externalRef,
    usedAt,
    expiredAt,
    payload,
  };
}

function createYouzanCouponStatusImplementation(options = {}) {
  return async function queryYouzanCouponStatus(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.YOUZAN_COUPON_STATUS_URL) throw adapterError(400, "有赞优惠券状态 Adapter 缺少 YOUZAN_COUPON_STATUS_URL");
    if (!env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN && !env.YOUZAN_COUPON_ACCESS_TOKEN && !env.YOUZAN_ACCESS_TOKEN) {
      throw adapterError(400, "有赞优惠券状态 Adapter 缺少 YOUZAN_COUPON_STATUS_ACCESS_TOKEN、YOUZAN_COUPON_ACCESS_TOKEN 或 YOUZAN_ACCESS_TOKEN");
    }
    assertYouzanTokenReady(env, {
      expiryNames: env.YOUZAN_COUPON_STATUS_ACCESS_TOKEN
        ? ["YOUZAN_COUPON_STATUS_ACCESS_TOKEN_EXPIRES_AT"]
        : env.YOUZAN_COUPON_ACCESS_TOKEN ? ["YOUZAN_COUPON_ACCESS_TOKEN_EXPIRES_AT"] : [],
    });
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeCouponStatusResult(payload, env, fieldMap, context);
  };
}

module.exports = {
  buildRequest,
  createYouzanCouponStatusImplementation,
  grantStatusForExternalStatus,
  normalizeCouponStatusResult,
  normalizeExternalStatus,
};
