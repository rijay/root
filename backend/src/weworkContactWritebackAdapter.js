const { isOfficialWeworkUrl, resolveWeworkAccessToken } = require("./weworkAccessToken");

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
    throw adapterError(400, `企微联系回写 Adapter 配置不是合法 JSON：${error.message}`);
  }
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

function normalizeFieldMap(env) {
  const fieldMap = parseJsonEnv(env.WEWORK_CONTACT_WRITEBACK_RESULT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function applyToken(env, url, headers, params) {
  const token = env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN
    || env.WEWORK_CONTACT_ACCESS_TOKEN
    || env.WEWORK_ACCESS_TOKEN
    || "";
  const tokenParam = env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN_PARAM || env.WEWORK_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN_LOCATION || env.WEWORK_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
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

function writebackPayloadFor(context = {}) {
  const body = objectValue(context.body);
  const task = objectValue(context.task);
  return {
    ...parseJsonEnv(context.env && context.env.WEWORK_CONTACT_WRITEBACK_EXTRA_PARAMS, {}),
    taskId: task.task_id || body.taskId || body.task_id || "",
    consultationId: (task.metadata && task.metadata.consultationId) || body.consultationId || body.consultation_id || "",
    rootUserId: (task.metadata && task.metadata.rootUserId) || body.rootUserId || body.root_user_id || "",
    userId: task.user_id || body.userId || body.user_id || "",
    campaignId: (task.metadata && task.metadata.campaignId) || body.campaignId || body.campaign_id || "",
    consultationType: (task.metadata && task.metadata.consultationType) || "",
    externalContactId: text(body.externalContactId || body.external_contact_id || context.externalContactId),
    external_userid: text(body.externalContactId || body.external_contact_id || context.externalContactId),
    result: text(body.result || body.followResult || body.follow_result, "WEWORK_CONTACTED"),
    note: text(body.note || body.followNote || body.follow_note),
    operatorId: text(body.operatorId || body.operator_id),
    source: "MYROOT_CONSULTATION_FOLLOWUP",
  };
}

function buildRequest(env, context = {}) {
  const url = new URL(env.WEWORK_CONTACT_WRITEBACK_URL);
  const method = normalizeMethod(env.WEWORK_CONTACT_WRITEBACK_METHOD);
  const headers = { Accept: "application/json" };
  const payload = writebackPayloadFor({ ...context, env });
  const officialRemark = isOfficialWeworkUrl(url, "/externalcontact/remark");
  const params = officialRemark ? {
    ...parseJsonEnv(env.WEWORK_CONTACT_WRITEBACK_EXTRA_PARAMS, {}),
    userid: text(env.WEWORK_CONTACT_WRITEBACK_USERID || env.WEWORK_CONTACT_USERID),
    external_userid: payload.externalContactId,
    remark: text(payload.result, "myRoot已跟进").slice(0, 20),
    description: text(payload.note || payload.consultationType || "myRoot咨询跟进").slice(0, 150),
  } : payload;
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
    throw adapterError(502, `企微联系回写响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `企微联系回写失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeWeworkContactWritebackResult(payload, env, fieldMap) {
  const status = String(valueFor(payload, fieldMap, "status", [
    env.WEWORK_CONTACT_WRITEBACK_RESULT_STATUS_PATH,
    "data.status",
    "data.errcode",
    "response.status",
    "status",
    "errcode",
    "code",
  ].filter(Boolean)) || "SUCCESS").toUpperCase();
  const successValues = String(env.WEWORK_CONTACT_WRITEBACK_SUCCESS_VALUES || "SUCCESS,OK,0,200,TRUE")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const externalRef = text(valueFor(payload, fieldMap, "externalRef", [
    env.WEWORK_CONTACT_WRITEBACK_RESULT_REF_PATH,
    "data.msgid",
    "data.message_id",
    "data.followup_id",
    "response.id",
    "id",
    "msgid",
  ].filter(Boolean)));
  const message = text(valueFor(payload, fieldMap, "message", [
    env.WEWORK_CONTACT_WRITEBACK_RESULT_MESSAGE_PATH,
    "data.message",
    "data.errmsg",
    "response.message",
    "message",
    "errmsg",
    "msg",
  ].filter(Boolean)), "企微联系回写完成");
  const ok = successValues.includes(status);
  return {
    ok,
    status: ok ? "DELIVERED" : "FAILED",
    message,
    externalRef,
    payload,
  };
}

function createWeworkContactWritebackImplementation(options = {}) {
  return async function writebackWeworkContact(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.WEWORK_CONTACT_WRITEBACK_URL) throw adapterError(400, "企微联系回写 Adapter 缺少 WEWORK_CONTACT_WRITEBACK_URL");
    if (!env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN
      && !(env.WEWORK_CORP_ID && env.WEWORK_CONTACT_SECRET)) {
      throw adapterError(400, "企微联系回写 Adapter 缺少 AccessToken 或 WEWORK_CORP_ID + WEWORK_CONTACT_SECRET");
    }
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const officialRemark = isOfficialWeworkUrl(env.WEWORK_CONTACT_WRITEBACK_URL, "/externalcontact/remark");
    const runtimeEnv = officialRemark && !env.WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN
      ? { ...env, WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN: await resolveWeworkAccessToken(env, { fetchImpl }) }
      : env;
    const requestPayload = writebackPayloadFor({ ...context, env: runtimeEnv });
    if (!requestPayload.externalContactId) throw adapterError(400, "企微联系回写 Adapter 缺少 externalContactId");
    if (officialRemark && !text(runtimeEnv.WEWORK_CONTACT_WRITEBACK_USERID || runtimeEnv.WEWORK_CONTACT_USERID)) {
      throw adapterError(400, "企微联系回写 Adapter 缺少 WEWORK_CONTACT_WRITEBACK_USERID");
    }

    const fieldMap = normalizeFieldMap(runtimeEnv);
    const request = buildRequest(runtimeEnv, { ...context, env: runtimeEnv });
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeWeworkContactWritebackResult(payload, runtimeEnv, fieldMap);
  };
}

module.exports = {
  buildRequest,
  createWeworkContactWritebackImplementation,
  normalizeWeworkContactWritebackResult,
  writebackPayloadFor,
};
