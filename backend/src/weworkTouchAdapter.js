const { isOfficialWeworkUrl, resolveWeworkAccessToken } = require("./weworkAccessToken");

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

function normalizeMethod(value) {
  return String(value || "POST").toUpperCase() === "GET" ? "GET" : "POST";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw adapterError(400, `企微自动触达 Adapter 配置不是合法 JSON：${error.message}`);
  }
}

function applyToken(env, url, headers, params) {
  const token = env.WEWORK_TOUCH_ACCESS_TOKEN
    || env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN
    || env.WEWORK_CONTACT_ACCESS_TOKEN
    || env.WEWORK_ACCESS_TOKEN
    || "";
  const tokenParam = env.WEWORK_TOUCH_ACCESS_TOKEN_PARAM || env.WEWORK_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.WEWORK_TOUCH_ACCESS_TOKEN_LOCATION || env.WEWORK_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
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

function touchPayloadFor(context = {}) {
  const job = context.job || {};
  return {
    ...parseJsonEnv(context.env && context.env.WEWORK_TOUCH_EXTRA_PARAMS, {}),
    source: "MYROOT_WEWORK_TOUCH",
    touchJobId: job.wework_touch_job_id || "",
    taskId: job.task_id || "",
    rootUserId: job.root_user_id || "",
    userId: job.user_id || "",
    campaignId: job.campaign_id || "",
    taskType: job.task_type || "",
    touchType: job.touch_type || "",
    templateKey: job.template_key || "",
    externalContactId: job.external_contact_id || "",
    external_userid: job.external_contact_id || "",
    message: job.message || "",
  };
}

function buildRequest(env, context = {}) {
  const url = new URL(env.WEWORK_TOUCH_SEND_URL);
  const method = normalizeMethod(env.WEWORK_TOUCH_SEND_METHOD);
  const headers = { Accept: "application/json" };
  const params = touchPayloadFor({ ...context, env });
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
    throw adapterError(502, `企微自动触达响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `企微自动触达失败：HTTP ${response.status}`, payload);
  }
  return payload;
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
  const fieldMap = parseJsonEnv(env.WEWORK_TOUCH_RESULT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function normalizeWeworkTouchResult(payload, env, fieldMap) {
  const status = String(valueFor(payload, fieldMap, "status", [
    env.WEWORK_TOUCH_RESULT_STATUS_PATH,
    "data.status",
    "data.errcode",
    "status",
    "errcode",
    "code",
  ].filter(Boolean)) || "SUCCESS").toUpperCase();
  const successValues = String(env.WEWORK_TOUCH_SUCCESS_VALUES || "SUCCESS,OK,0,200,TRUE")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const externalRef = text(valueFor(payload, fieldMap, "externalRef", [
    env.WEWORK_TOUCH_RESULT_REF_PATH,
    "data.msgid",
    "data.message_id",
    "data.followup_id",
    "id",
    "msgid",
  ].filter(Boolean)));
  const message = text(valueFor(payload, fieldMap, "message", [
    env.WEWORK_TOUCH_RESULT_MESSAGE_PATH,
    "data.message",
    "data.errmsg",
    "message",
    "errmsg",
    "msg",
  ].filter(Boolean)), "企微自动触达完成");
  const ok = successValues.includes(status);
  return {
    ok,
    status: ok ? "DELIVERED" : "FAILED",
    message,
    externalRef,
    payload,
  };
}

function createWeworkTouchImplementation(options = {}) {
  return async function sendWeworkTouch(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.WEWORK_TOUCH_SEND_URL) throw adapterError(400, "企微自动触达 Adapter 缺少 WEWORK_TOUCH_SEND_URL");
    if (!env.WEWORK_TOUCH_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN
      && !(env.WEWORK_CORP_ID && env.WEWORK_CONTACT_SECRET)) {
      throw adapterError(400, "企微自动触达 Adapter 缺少 AccessToken 或 WEWORK_CORP_ID + WEWORK_CONTACT_SECRET");
    }
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");
    if (!context.job || !context.job.external_contact_id) throw adapterError(400, "企微自动触达缺少 externalContactId");

    const official = isOfficialWeworkUrl(env.WEWORK_TOUCH_SEND_URL);
    const runtimeEnv = official && !env.WEWORK_TOUCH_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN
      ? { ...env, WEWORK_TOUCH_ACCESS_TOKEN: await resolveWeworkAccessToken(env, { fetchImpl }) }
      : env;
    const fieldMap = normalizeFieldMap(runtimeEnv);
    const request = buildRequest(runtimeEnv, { ...context, env: runtimeEnv });
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeWeworkTouchResult(payload, runtimeEnv, fieldMap);
  };
}

module.exports = {
  buildRequest,
  createWeworkTouchImplementation,
  normalizeWeworkTouchResult,
  touchPayloadFor,
};
