const ADMIN_TOKEN_KEY = "ROOT_ADMIN_TOKEN";
export const ADMIN_READ_TIMEOUT_MS = 8000;
export const ADMIN_WRITE_TIMEOUT_MS = 15000;
export const MAX_CONCURRENT_ADMIN_READS = 4;

let sessionAdminToken = "";
let activeAdminReads = 0;
const pendingAdminReads = [];
const inflightAdminReads = new Map();

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

function abortedError(isRead) {
  const error = new Error(isRead ? "后台读取已取消" : "后台请求已取消，写入结果待确认");
  error.code = "ADMIN_ABORTED";
  error.status = 0;
  error.outcomeUnknown = !isRead;
  return error;
}

function drainAdminReads() {
  while (activeAdminReads < MAX_CONCURRENT_ADMIN_READS && pendingAdminReads.length) {
    const queued = pendingAdminReads.shift();
    activeAdminReads += 1;
    Promise.resolve()
      .then(queued.task)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeAdminReads -= 1;
        drainAdminReads();
      });
  }
}

function scheduleAdminRead(task) {
  return new Promise((resolve, reject) => {
    pendingAdminReads.push({ task, resolve, reject });
    drainAdminReads();
  });
}

function readRequestKey(path, method, adminToken, timeoutMs, requestOptions) {
  const headers = Object.entries(requestOptions.headers || {})
    .map(([key, value]) => [String(key).toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([method, path, adminToken, timeoutMs || "DEFAULT", requestOptions.body || "", headers]);
}

function observeRead(record, externalSignal) {
  if (externalSignal?.aborted) return Promise.reject(abortedError(true));
  record.subscriberCount += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      externalSignal?.removeEventListener("abort", abortSubscriber);
      record.subscriberCount -= 1;
      callback(value);
    };
    const abortSubscriber = () => {
      finish(reject, abortedError(true));
      if (record.subscriberCount === 0) {
        inflightAdminReads.delete(record.key);
        record.controller.abort();
      }
    };
    externalSignal?.addEventListener("abort", abortSubscriber, { once: true });
    record.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

async function executeAdminRequest(path, options, isRead, adminToken, requestSignal) {
  const {
    readOnly: _,
    timeoutMs: __,
    signal: ___,
    ...requestOptions
  } = options;
  if (requestSignal?.aborted) throw abortedError(isRead);
  const isFormBody = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : isRead ? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (requestSignal?.aborted) controller.abort();
  else requestSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abortFromCaller);
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
    if (requestSignal?.aborted) throw abortedError(isRead);
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
    if (requestSignal?.aborted) throw abortedError(isRead);
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

export function adminRequest(path, options = {}) {
  const adminToken = getAdminToken();
  const method = String(options.method || "GET").toUpperCase();
  const isRead = options.readOnly === true || method === "GET";
  const externalSignal = options.signal;
  if (!isRead) return executeAdminRequest(path, options, false, adminToken, externalSignal);

  const { signal: _, readOnly: __, timeoutMs: ___, ...requestOptions } = options;
  const key = readRequestKey(path, method, adminToken, options.timeoutMs, requestOptions);
  let record = inflightAdminReads.get(key);
  if (!record) {
    const controller = new AbortController();
    record = { key, controller, subscriberCount: 0, promise: null };
    record.promise = scheduleAdminRead(() => executeAdminRequest(path, options, true, adminToken, controller.signal));
    inflightAdminReads.set(key, record);
    record.promise.finally(() => {
      if (inflightAdminReads.get(key) === record) inflightAdminReads.delete(key);
    }).catch(() => {});
  }
  return observeRead(record, externalSignal);
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
