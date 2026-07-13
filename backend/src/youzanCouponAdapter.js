const { assertYouzanBusinessSuccess } = require("./youzanResponse");
const { assertYouzanTokenReady } = require("./youzanTokenPolicy");
const { isOfficialYouzanUrl } = require("./youzanOpenRequest");

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
    throw adapterError(400, `有赞优惠券 Adapter 配置不是合法 JSON：${error.message}`);
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function positiveIntegerText(value) {
  const normalized = text(value);
  return /^[1-9]\d*$/.test(normalized) ? normalized : "";
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
  const fieldMap = parseJsonEnv(env.YOUZAN_COUPON_RESULT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function couponPayloadFor(grant = {}, body = {}) {
  const payload = objectValue(grant.payload_json || grant.payload || {});
  return {
    ...payload,
    ...objectValue(body.payload || body.payload_json),
    rewardGrantId: grant.reward_grant_id || "",
    rootUserId: grant.root_user_id || "",
    campaignId: grant.campaign_id || "",
    rewardType: grant.reward_type || "",
    rewardKey: grant.reward_key || "",
    title: grant.title || "",
  };
}

function officialCouponPayloadFor(payload = {}, recipientYzOpenId = "") {
  const fields = {
    activity_id: firstDefined(payload, ["activity_id", "activityId"]),
    yz_open_id: recipientYzOpenId,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function assertOfficialCouponPayload(payload) {
  if (!/^[1-9]\d*$/.test(String(payload.activity_id || "").trim())) {
    throw adapterError(400, "有赞官方发券 Interface 的 activity_id 必须是正整数");
  }
  if (!payload.yz_open_id) throw adapterError(400, "有赞官方发券 Interface 缺少唯一补链的 yz_open_id");
}

function linkedYouzanRecipients(data = {}, rootUserId = "") {
  const recipients = Array.isArray(data.youzanCustomers) ? data.youzanCustomers : [];
  return Array.from(new Set(recipients
    .filter((customer) => customer.root_user_id && customer.root_user_id === rootUserId)
    .map((customer) => String(customer.youzan_yz_uid || "").trim())
    .filter(Boolean)));
}

function applyToken(env, url, headers, params) {
  const token = env.YOUZAN_COUPON_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN || "";
  const tokenParam = env.YOUZAN_COUPON_ACCESS_TOKEN_PARAM || env.YOUZAN_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.YOUZAN_COUPON_ACCESS_TOKEN_LOCATION || env.YOUZAN_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
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

function buildRequest(env, context = {}) {
  const url = new URL(env.YOUZAN_COUPON_SEND_URL);
  const official = isOfficialYouzanUrl(url, "youzan.ump.voucheractivity.send");
  const method = official ? "POST" : normalizeMethod(env.YOUZAN_COUPON_SEND_METHOD);
  const headers = { Accept: "application/json" };
  const grant = context.grant || {};
  const job = context.job || {};
  const body = context.body || {};
  const extra = parseJsonEnv(env.YOUZAN_COUPON_SEND_EXTRA_PARAMS, {});
  const payload = couponPayloadFor(grant, body);
  const grantPayload = objectValue(grant.payload_json || grant.payload || {});
  const recipients = official ? linkedYouzanRecipients(context.data, grant.root_user_id) : [];
  if (official && recipients.length !== 1) {
    const reason = recipients.length
      ? "有赞官方发券 Interface 匹配到多个 yz_open_id，请先完成身份冲突复核"
      : "有赞官方发券 Interface 未找到唯一补链的 yz_open_id，请先完成有赞客户身份对账";
    throw adapterError(400, reason);
  }
  const params = official ? {
    ...officialCouponPayloadFor({ ...extra, ...grantPayload }, recipients[0]),
  } : {
    ...extra,
    ...payload,
    deliveryJobId: job.reward_delivery_job_id || "",
    requestId: body.requestId || body.request_id || "",
  };
  if (official) assertOfficialCouponPayload(params);
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
    throw adapterError(502, `有赞优惠券发放响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞优惠券发放失败：HTTP ${response.status}`, payload);
  }
  return assertYouzanBusinessSuccess(payload, "有赞优惠券发放", adapterError);
}

function normalizeCouponResult(payload, env, fieldMap) {
  const official = isOfficialYouzanUrl(env.YOUZAN_COUPON_SEND_URL, "youzan.ump.voucheractivity.send");
  const status = String(valueFor(payload, fieldMap, "status", [
    env.YOUZAN_COUPON_RESULT_STATUS_PATH,
    "data.status",
    "response.status",
    "status",
    "code",
  ].filter(Boolean)) || "SUCCESS").toUpperCase();
  const successValues = String(env.YOUZAN_COUPON_SUCCESS_VALUES || "SUCCESS,OK,0,200,TRUE")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const externalRef = official
    ? positiveIntegerText(firstDefined(payload, ["data.voucher_identity.coupon_id", "data.coupon_id"]))
    : text(valueFor(payload, fieldMap, "externalRef", [
    env.YOUZAN_COUPON_RESULT_REF_PATH,
    "data.voucher_identity.coupon_id",
    "data.coupon_id",
    "data.verify_code",
    "data.code_value",
    "data.coupon_code",
    "data.couponCode",
    "data.coupon_no",
    "data.couponNo",
    "data.id",
    "response.coupon_code",
    "response.couponCode",
    "coupon_code",
    "couponCode",
    "id",
  ].filter(Boolean)));
  const message = text(valueFor(payload, fieldMap, "message", [
    env.YOUZAN_COUPON_RESULT_MESSAGE_PATH,
    "data.message",
    "response.message",
    "message",
    "msg",
    "error_msg",
  ].filter(Boolean)), "有赞优惠券发放完成");
  const ok = official || successValues.includes(status);
  const requiresReview = official && ok && !externalRef;
  return {
    ok,
    status: ok ? "DELIVERED" : "FAILED",
    message: requiresReview ? "有赞优惠券发放完成，缺少券 ID，需人工核对" : message,
    externalRef,
    requiresReview,
    reviewCode: requiresReview ? "YOUZAN_COUPON_ID_MISSING" : "",
    payload,
  };
}

function createYouzanCouponImplementation(options = {}) {
  return async function sendYouzanCoupon(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.YOUZAN_COUPON_SEND_URL) throw adapterError(400, "有赞优惠券 Adapter 缺少 YOUZAN_COUPON_SEND_URL");
    if (!env.YOUZAN_COUPON_ACCESS_TOKEN && !env.YOUZAN_ACCESS_TOKEN) {
      throw adapterError(400, "有赞优惠券 Adapter 缺少 YOUZAN_COUPON_ACCESS_TOKEN 或 YOUZAN_ACCESS_TOKEN");
    }
    assertYouzanTokenReady(env, {
      expiryNames: env.YOUZAN_COUPON_ACCESS_TOKEN ? ["YOUZAN_COUPON_ACCESS_TOKEN_EXPIRES_AT"] : [],
    });
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeCouponResult(payload, env, fieldMap);
  };
}

module.exports = {
  assertOfficialCouponPayload,
  buildRequest,
  createYouzanCouponImplementation,
  linkedYouzanRecipients,
  normalizeCouponResult,
  officialCouponPayloadFor,
};
