const ADMIN_TOKEN_KEY = "ROOT_ADMIN_TOKEN";
let sessionAdminToken = "";

function adminTokenStorage() {
  try { return window.sessionStorage; } catch (_) { return null; }
}

export function getAdminToken() {
  const storage = adminTokenStorage();
  if (!storage) return sessionAdminToken;
  try {
    const stored = storage.getItem(ADMIN_TOKEN_KEY) || "";
    sessionAdminToken = stored;
    return stored;
  } catch (_) {
    return sessionAdminToken;
  }
}

export function setAdminToken(token) {
  const value = String(token || "").trim();
  sessionAdminToken = value;
  const storage = adminTokenStorage();
  if (!storage) return;
  try {
    if (value) storage.setItem(ADMIN_TOKEN_KEY, value);
    else storage.removeItem(ADMIN_TOKEN_KEY);
  } catch (_) {
    // The current page keeps a session-only token when persistent storage is blocked.
  }
}

function invalidResponseEnvelope(method, status) {
  const error = new Error(method === "GET" ? "后台返回无法校验" : "后台返回无法校验，结果待确认");
  error.code = "ADMIN_RESPONSE_INVALID";
  error.status = status;
  error.outcomeUnknown = method !== "GET";
  return error;
}

export async function adminRequest(path, options = {}) {
  const adminToken = getAdminToken();
  const method = String(options.method || "GET").toUpperCase();
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (_) {
    clearTimeout(timeout);
    const error = new Error(method === "GET" ? "后台连接失败" : "后台写入结果待确认，请先刷新权威记录");
    error.code = "ADMIN_NETWORK_ERROR";
    error.status = 0;
    error.outcomeUnknown = method !== "GET";
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    clearTimeout(timeout);
    throw invalidResponseEnvelope(method, response.status);
  }
  clearTimeout(timeout);
  if (!payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || !Object.prototype.hasOwnProperty.call(payload, "code")
    || typeof payload.code !== "number") {
    throw invalidResponseEnvelope(method, response.status);
  }
  if (!response.ok && payload.code === 0) {
    const error = new Error(method === "GET" ? "后台读取失败" : "后台写入未获有效确认");
    error.code = "ADMIN_HTTP_ERROR";
    error.status = response.status;
    error.outcomeUnknown = method !== "GET" && response.status >= 500;
    throw error;
  }
  if (payload.code !== 0) {
    const error = new Error(payload.message || "后台 Interface 返回异常");
    error.code = payload.code;
    error.status = response.status;
    error.outcomeUnknown = method !== "GET" && response.status >= 500;
    throw error;
  }
  return payload.data;
}

export function fetchAdminProfile() {
  return adminRequest("/api/v1/admin/me");
}

export function postAdminJson(path, body, options = {}) {
  return adminRequest(path, {
    ...options,
    method: "POST",
    headers: options.headers || {},
    body: JSON.stringify(body || {}),
  });
}
