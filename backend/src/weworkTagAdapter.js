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
    throw adapterError(400, `企业微信标签 Adapter 配置不是合法 JSON：${error.message}`);
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
  const fieldMap = parseJsonEnv(env.WEWORK_TAG_RESULT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function leadForGrant(data, grant = {}) {
  const leads = Array.isArray(data && data.leadProfiles) ? data.leadProfiles : [];
  return leads.find((lead) => {
    return lead.user_id && (lead.user_id === grant.root_user_id || lead.root_user_id === grant.root_user_id);
  }) || null;
}

function tagPayloadFor(grant = {}, body = {}, context = {}) {
  const payload = objectValue(grant.payload_json || grant.payload || {});
  const bodyPayload = objectValue(body.payload || body.payload_json);
  const lead = leadForGrant(context.data, grant);
  const externalContactId = text(
    body.externalContactId
      || body.external_contact_id
      || bodyPayload.externalContactId
      || bodyPayload.external_contact_id
      || payload.externalContactId
      || payload.external_contact_id
      || (lead && lead.external_contact_id)
  );
  const tagId = text(
    body.tagId
      || body.tag_id
      || bodyPayload.tagId
      || bodyPayload.tag_id
      || payload.tagId
      || payload.tag_id
      || payload.tagKey
      || payload.tag_key
      || grant.reward_key
      || (context.env && context.env.WEWORK_TAG_DEFAULT_ID)
  );
  const tagName = text(
    body.tagName
      || body.tag_name
      || bodyPayload.tagName
      || bodyPayload.tag_name
      || payload.tagName
      || payload.tag_name
      || grant.title
  );
  return {
    ...payload,
    ...bodyPayload,
    rewardGrantId: grant.reward_grant_id || "",
    rootUserId: grant.root_user_id || "",
    campaignId: grant.campaign_id || "",
    rewardType: grant.reward_type || "",
    rewardKey: grant.reward_key || "",
    externalContactId,
    external_userid: externalContactId,
    tagId,
    tag_id: tagId,
    tagName,
    tag_name: tagName,
  };
}

function applyToken(env, url, headers, params) {
  const token = env.WEWORK_TAG_ACCESS_TOKEN || env.WEWORK_ACCESS_TOKEN || env.WEWORK_CONTACT_ACCESS_TOKEN || "";
  const tokenParam = env.WEWORK_TAG_ACCESS_TOKEN_PARAM || env.WEWORK_ACCESS_TOKEN_PARAM || "access_token";
  const location = String(env.WEWORK_TAG_ACCESS_TOKEN_LOCATION || env.WEWORK_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
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
  const url = new URL(env.WEWORK_TAG_APPLY_URL);
  const method = normalizeMethod(env.WEWORK_TAG_APPLY_METHOD);
  const headers = { Accept: "application/json" };
  const payload = tagPayloadFor(context.grant || {}, context.body || {}, context);
  const extra = parseJsonEnv(env.WEWORK_TAG_APPLY_EXTRA_PARAMS, {});
  const officialMarkTag = isOfficialWeworkUrl(url, "/externalcontact/mark_tag");
  const params = officialMarkTag ? {
    ...extra,
    userid: text(env.WEWORK_TAG_USERID || env.WEWORK_CONTACT_USERID || extra.userid),
    external_userid: payload.externalContactId,
    add_tag: [payload.tagId],
    remove_tag: Array.isArray(extra.remove_tag) ? extra.remove_tag : [],
  } : { ...extra, ...payload };
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
    throw adapterError(502, `企业微信标签响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `企业微信标签写入失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeWeworkTagResult(payload, env, fieldMap) {
  const status = String(valueFor(payload, fieldMap, "status", [
    env.WEWORK_TAG_RESULT_STATUS_PATH,
    "data.status",
    "data.errcode",
    "response.status",
    "status",
    "errcode",
    "code",
  ].filter(Boolean)) || "SUCCESS").toUpperCase();
  const successValues = String(env.WEWORK_TAG_SUCCESS_VALUES || "SUCCESS,OK,0,200,TRUE")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const externalRef = text(valueFor(payload, fieldMap, "externalRef", [
    env.WEWORK_TAG_RESULT_REF_PATH,
    "data.job_id",
    "data.jobId",
    "data.tag_apply_id",
    "data.tagApplyId",
    "response.job_id",
    "job_id",
    "jobId",
    "id",
  ].filter(Boolean)));
  const message = text(valueFor(payload, fieldMap, "message", [
    env.WEWORK_TAG_RESULT_MESSAGE_PATH,
    "data.message",
    "data.errmsg",
    "response.message",
    "message",
    "errmsg",
    "msg",
  ].filter(Boolean)), "企业微信标签写入完成");
  const ok = successValues.includes(status);
  return {
    ok,
    status: ok ? "DELIVERED" : "FAILED",
    message,
    externalRef,
    payload,
  };
}

function createWeworkTagImplementation(options = {}) {
  return async function applyWeworkTag(context = {}) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.WEWORK_TAG_APPLY_URL) throw adapterError(400, "企业微信标签 Adapter 缺少 WEWORK_TAG_APPLY_URL");
    if (!env.WEWORK_TAG_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN
      && !(env.WEWORK_CORP_ID && env.WEWORK_CONTACT_SECRET)) {
      throw adapterError(400, "企业微信标签 Adapter 缺少 AccessToken 或 WEWORK_CORP_ID + WEWORK_CONTACT_SECRET");
    }
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const officialMarkTag = isOfficialWeworkUrl(env.WEWORK_TAG_APPLY_URL, "/externalcontact/mark_tag");
    const runtimeEnv = officialMarkTag && !env.WEWORK_TAG_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN && !env.WEWORK_CONTACT_ACCESS_TOKEN
      ? { ...env, WEWORK_TAG_ACCESS_TOKEN: await resolveWeworkAccessToken(env, { fetchImpl }) }
      : env;
    const requestPayload = tagPayloadFor(context.grant || {}, context.body || {}, { ...context, env: runtimeEnv });
    if (!requestPayload.externalContactId) throw adapterError(400, "企业微信标签 Adapter 缺少 externalContactId");
    if (!requestPayload.tagId) throw adapterError(400, "企业微信标签 Adapter 缺少 tagId");
    if (officialMarkTag && !text(runtimeEnv.WEWORK_TAG_USERID || runtimeEnv.WEWORK_CONTACT_USERID)) {
      throw adapterError(400, "企业微信标签 Adapter 缺少 WEWORK_TAG_USERID");
    }

    const fieldMap = normalizeFieldMap(runtimeEnv);
    const request = buildRequest(runtimeEnv, { ...context, env: runtimeEnv });
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeWeworkTagResult(payload, runtimeEnv, fieldMap);
  };
}

module.exports = {
  buildRequest,
  createWeworkTagImplementation,
  normalizeWeworkTagResult,
  tagPayloadFor,
};
