const { assertYouzanBusinessSuccess } = require("./youzanResponse");
const { assertYouzanTokenReady } = require("./youzanTokenPolicy");

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return objectValue(parsed);
  } catch (error) {
    throw adapterError(400, `有赞身份查询配置不是合法 JSON：${error.message}`);
  }
}

function parseResultTypes(value) {
  if (!value) return [0, 1, 2, 9];
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = value.split(",");
    }
  }
  const values = (Array.isArray(parsed) ? parsed : [parsed])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && [0, 1, 2, 9].includes(item));
  return Array.from(new Set(values.length ? values : [0, 1, 2, 9]));
}

function accessToken(env) {
  return text(env.YOUZAN_USER_QUERY_ACCESS_TOKEN || env.YOUZAN_CUSTOMER_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN);
}

function applyToken(env, url, headers, params) {
  const token = accessToken(env);
  const tokenParam = text(
    env.YOUZAN_USER_QUERY_ACCESS_TOKEN_PARAM || env.YOUZAN_ACCESS_TOKEN_PARAM,
    "access_token"
  );
  const location = text(
    env.YOUZAN_USER_QUERY_ACCESS_TOKEN_LOCATION || env.YOUZAN_ACCESS_TOKEN_LOCATION,
    "query"
  ).toLowerCase();
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

function buildRequest(env, unionid) {
  const url = new URL(env.YOUZAN_USER_QUERY_URL);
  const method = text(env.YOUZAN_USER_QUERY_METHOD, "POST").toUpperCase() === "GET" ? "GET" : "POST";
  const headers = { Accept: "application/json" };
  const params = {
    ...parseJsonObject(env.YOUZAN_USER_QUERY_EXTRA_PARAMS),
    weixin_union_id: unionid,
    result_type_list: parseResultTypes(env.YOUZAN_USER_QUERY_RESULT_TYPES),
  };
  applyToken(env, url, headers, params);
  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    });
    return { url, init: { method, headers } };
  }
  headers["Content-Type"] = "application/json";
  return { url, init: { method, headers, body: JSON.stringify(params) } };
}

async function readResponseJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw adapterError(502, `有赞身份查询响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞身份查询失败：HTTP ${response.status}`, payload);
  }
  return assertYouzanBusinessSuccess(payload, "有赞身份查询", adapterError);
}

function identityFromRecord(record, latestInfo = {}) {
  return {
    youzanYzUid: text(firstDefined(record, [
      "primitive_info.yz_open_id",
      "yz_open_id",
      "yzOpenId",
      "user.yz_open_id",
    ])),
    responseUnionid: text(firstDefined(record, [
      "platform_info.union_id",
      "platform_info.unionid",
      "platform_info.weixin_union_id",
      "wechat_info.union_id",
      "wechat_info.unionid",
      "union_id",
      "unionid",
    ])),
    phone: text(firstDefined(record, ["mobile_info.mobile", "mobile", "phone"])),
    nickname: text(firstDefined(record, [
      "primitive_info.nick_name",
      "primitive_info.nickname",
      "nick_name",
      "nickname",
    ]), latestInfo.nick_name || latestInfo.nickname || ""),
  };
}

function normalizeIdentityResult(payload, requestedUnionid) {
  const records = firstArray(payload, ["data.user_list", "response.user_list", "user_list"]);
  const latestInfo = objectValue(firstDefined(payload, ["data.latest_info", "response.latest_info", "latest_info"]));
  const identities = [];
  let rejectedCount = 0;
  for (const record of records) {
    const identity = identityFromRecord(record, latestInfo);
    if (!identity.youzanYzUid) {
      rejectedCount += 1;
      continue;
    }
    if (identity.responseUnionid && identity.responseUnionid !== requestedUnionid) {
      rejectedCount += 1;
      continue;
    }
    if (!identities.some((item) => item.youzanYzUid === identity.youzanYzUid)) identities.push(identity);
  }
  const status = identities.length ? "RESOLVED" : rejectedCount ? "UNIONID_MISMATCH" : "NOT_FOUND";
  return {
    status,
    identities,
    externalCount: records.length,
    rejectedCount,
  };
}

function createYouzanIdentityImplementation(options = {}) {
  return async function resolveYouzanIdentity(context = {}) {
    const env = context.env || {};
    const unionid = text(context.unionid || context.unionId || context.union_id);
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!unionid) throw adapterError(400, "有赞身份查询缺少 unionid");
    if (!env.YOUZAN_USER_QUERY_URL) throw adapterError(400, "有赞身份查询缺少 YOUZAN_USER_QUERY_URL");
    if (!accessToken(env)) throw adapterError(400, "有赞身份查询缺少 access token");
    assertYouzanTokenReady(env, {
      expiryNames: env.YOUZAN_USER_QUERY_ACCESS_TOKEN
        ? ["YOUZAN_USER_QUERY_ACCESS_TOKEN_EXPIRES_AT"]
        : env.YOUZAN_CUSTOMER_ACCESS_TOKEN ? ["YOUZAN_CUSTOMER_ACCESS_TOKEN_EXPIRES_AT"] : [],
    });
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const request = buildRequest(env, unionid);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeIdentityResult(payload, unionid);
  };
}

module.exports = {
  buildRequest,
  createYouzanIdentityImplementation,
  normalizeIdentityResult,
  parseResultTypes,
};
