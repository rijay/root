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

function invalidResponseEnvelope(isRead, status) {
  const error = new Error(isRead ? "后台返回无法校验" : "后台返回无法校验，结果待确认");
  error.code = "ADMIN_RESPONSE_INVALID";
  error.status = status;
  error.outcomeUnknown = !isRead;
  return error;
}

export async function adminRequest(path, options = {}) {
  const adminToken = getAdminToken();
  const method = String(options.method || "GET").toUpperCase();
  const isRead = options.readOnly === true || method === "GET";
  const {
    readOnly: _,
    timeoutMs: __,
    signal: externalSignal,
    ...requestOptions
  } = options;
  const isFormBody = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  };
  let response;
  try {
    response = await fetch(path, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        ...(isFormBody ? {} : { "Content-Type": "application/json" }),
        ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
        ...(requestOptions.headers || {}),
      },
    });
  } catch (_) {
    cleanup();
    if (externalSignal?.aborted) {
      const error = new Error("后台读取已取消");
      error.code = "ADMIN_ABORTED";
      error.status = 0;
      error.outcomeUnknown = false;
      throw error;
    }
    const error = new Error(isRead ? "后台连接失败" : "后台写入结果待确认，请先刷新权威记录");
    error.code = "ADMIN_NETWORK_ERROR";
    error.status = 0;
    error.outcomeUnknown = !isRead;
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    cleanup();
    if (externalSignal?.aborted) {
      const error = new Error("后台读取已取消");
      error.code = "ADMIN_ABORTED";
      error.status = 0;
      error.outcomeUnknown = false;
      throw error;
    }
    throw invalidResponseEnvelope(isRead, response.status);
  }
  cleanup();
  if (!payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || !Object.prototype.hasOwnProperty.call(payload, "code")
    || typeof payload.code !== "number") {
    throw invalidResponseEnvelope(isRead, response.status);
  }
  if (!response.ok && payload.code === 0) {
    const error = new Error(isRead ? "后台读取失败" : "后台写入未获有效确认");
    error.code = "ADMIN_HTTP_ERROR";
    error.status = response.status;
    error.outcomeUnknown = !isRead && response.status >= 500;
    throw error;
  }
  if (payload.code !== 0) {
    const error = new Error(payload.message || "后台 Interface 返回异常");
    error.code = payload.code;
    error.status = response.status;
    error.outcomeUnknown = !isRead && response.status >= 500;
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

export function postAdminRead(path, body, options = {}) {
  return adminRequest(path, {
    ...options,
    method: "POST",
    readOnly: true,
    headers: options.headers || {},
    body: JSON.stringify(body || {}),
  });
}

export function postAdminForm(path, body, options = {}) {
  return adminRequest(path, {
    ...options,
    method: "POST",
    headers: options.headers || {},
    body,
  });
}
