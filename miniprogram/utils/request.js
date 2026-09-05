const env = require("../config/env");
const performanceBudgets = require("../config/performance-runtime-budgets");
const { appendCloudRoute } = require("./cloud-route");
const { performanceMonitor } = require("./performance-monitor");
const { clearLoginSession } = require("./login-session");
const { clearProfileCache } = require("./profile-cache");
const { clearMemberCommerceCache } = require("./member-commerce-cache");
const { resolveRuntimeRequestConfig } = require("./runtime-request-adapter");

const MAX_CONCURRENT_REQUESTS = performanceBudgets.network.maxConcurrentRequests;
const READ_TIMEOUT = performanceBudgets.network.readTimeoutMs;
const WRITE_TIMEOUT = performanceBudgets.network.writeTimeoutMs;
const READ_DEDUPE_WINDOW = performanceBudgets.network.sameReadDedupeWindowMs;

let activeRequestCount = 0;
let queuedRequests = [];
const activeRequests = new Set();
const inflightReads = new Map();
const recentReads = new Map();
const scopedRequests = new Map();

function getToken() {
  return wx.getStorageSync("ROOT_TOKEN") || "";
}

function setToken(token) {
  wx.setStorageSync("ROOT_TOKEN", token);
}

function clearToken() {
  wx.removeStorageSync("ROOT_TOKEN");
  clearProfileCache();
  clearMemberCommerceCache();
  clearLoginSession();
}

function stringifyError(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.message && typeof value.message === "string") return value.message;
  if (value.errMsg && typeof value.errMsg === "string") return value.errMsg;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>")
    .replace(/([?&](?:token|secret|password|openid|unionid|code)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/((?:["']?)(?:token|secret|password|openid|unionid|code)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s}&]+)/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted>")
    .replace(/\b1[3-9]\d{9}\b/g, "<redacted-phone>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted>")
    .slice(0, 200);
}

function safeErrorSummary(value) {
  const code = value && (value.errCode || value.errno || value.code);
  return {
    code: code === undefined || code === null ? "" : sanitizeDiagnosticText(code),
    message: sanitizeDiagnosticText(stringifyError(value)),
  };
}

function normalizeErrorCode(value, fallback = "REQUEST_FAILED") {
  if (Number.isInteger(value)) return value;
  const code = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,80}$/.test(code) ? code : fallback;
}

function safeCorrelationId(value) {
  const correlationId = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(correlationId) ? correlationId : "";
}

function createRequestError({ code, message, status = 0, correlationId = "" } = {}) {
  const error = new Error(sanitizeDiagnosticText(message) || "请求失败");
  error.name = "RequestError";
  error.code = normalizeErrorCode(code);
  error.status = Number.isInteger(status) && status >= 0 ? status : 0;
  error.correlationId = safeCorrelationId(correlationId);
  return error;
}

function requestFailMessage(error, adapter) {
  const message = stringifyError(error);
  if (message.includes("timeout") || message.includes("timed out")) return "服务响应较慢，请稍后重试";
  if (adapter === "cloudContainer") {
    const code = error && (error.errCode || error.errno || error.code);
    const codeMatch = message.match(/\b(?:errCode[:：]?\s*)?(-?\d{2,})\b/);
    const cloudCode = code || (codeMatch && codeMatch[1]);
    return cloudCode ? `服务暂时不可用（云托管${cloudCode}）` : "服务暂时不可用，请稍后重试";
  }
  if (message.includes("ERR_CONNECTION_REFUSED")) return "后台服务未连接，请先启动本地后端";
  return "网络连接失败，请确认后台服务已启动";
}

function parseResponse(res) {
  const response = res && typeof res === "object" ? res : {};
  const payload = response.data && typeof response.data === "object" ? response.data : {};
  const status = Number.isInteger(response.statusCode) ? response.statusCode : 0;
  const successfulTransport = status >= 200 && status < 300;
  if (successfulTransport && payload.code === 0) return payload.data;
  if (payload.code === 1003 || status === 401) clearToken();
  const correlationId = payload.data && typeof payload.data === "object"
    ? payload.data.correlationId
    : "";
  throw createRequestError({
    code: !successfulTransport && (payload.code === 0 || payload.code === undefined || payload.code === null)
      ? (status ? `HTTP_${status}` : "REQUEST_FAILED")
      : (payload.code === undefined || payload.code === null
      ? (status ? `HTTP_${status}` : "REQUEST_FAILED")
      : payload.code),
    message: !successfulTransport
      ? (payload.message || `请求失败（HTTP ${status || "unknown"}）`)
      : (payload.message || "请求失败"),
    status,
    correlationId,
  });
}

function buildHeader(token, requestId, idempotencyKey, optionsHeader) {
  return {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(optionsHeader || {}),
  };
}

function isReadMethod(method) {
  return ["GET", "HEAD"].includes(String(method || "GET").toUpperCase());
}

function requestTimeout(options) {
  const defaultTimeout = isReadMethod(options.method) ? READ_TIMEOUT : WRITE_TIMEOUT;
  const requested = Number(options.timeout);
  return Number.isFinite(requested) && requested > 0 ? Math.min(requested, defaultTimeout) : defaultTimeout;
}

function transportError(error, method, adapter) {
  const message = stringifyError(error);
  const timedOut = /timeout|timed out/i.test(message);
  const write = !isReadMethod(method);
  const result = createRequestError({
    code: timedOut
      ? write ? "WRITE_RESULT_UNKNOWN" : "READ_TIMEOUT"
      : adapter === "cloudContainer" ? "CLOUD_CONTAINER_REQUEST_FAILED" : "NETWORK_ERROR",
    message: timedOut && write ? "请求结果确认中，请勿重复操作" : requestFailMessage(error, adapter),
  });
  if (timedOut && write) result.resultUnknown = true;
  return result;
}

function requestByWxRequest(options, token, requestId, idempotencyKey, setAbort, runtimeConfig) {
  return new Promise((resolve, reject) => {
    const apiBaseUrl = String(runtimeConfig && runtimeConfig.apiBaseUrl || "").trim().replace(/\/$/, "");
    if (!apiBaseUrl || /example\.com|\.sh\.run\.tcloudbase\.com/i.test(apiBaseUrl)) {
      reject(createRequestError({
        code: "REQUEST_ENV_UNCONFIGURED",
        message: "请先在 config/env.js 配置已备案的正式环境接口域名",
      }));
      return;
    }
    const task = wx.request({
      url: `${apiBaseUrl}${options.url}`,
      method: options.method || "GET",
      timeout: requestTimeout(options),
      data: options.data || {},
      header: buildHeader(token, requestId, idempotencyKey, options.header),
      success(res) {
        try {
          resolve(parseResponse(res));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        reject(transportError(error, options.method, "wxRequest"));
      },
    });
    if (task && typeof task.abort === "function") setAbort(() => task.abort());
  });
}

function requestByCloudContainer(options, token, requestId, idempotencyKey, setAbort) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callContainer) {
      reject(createRequestError({
        code: "CLOUD_CONTAINER_UNAVAILABLE",
        message: "当前基础库不支持云托管调用，请升级微信开发者工具基础库",
      }));
      return;
    }
    if (!env.cloudEnvId || !env.cloudServiceName) {
      reject(createRequestError({
        code: "CLOUD_CONTAINER_UNCONFIGURED",
        message: "请先在 config/env.js 配置云开发环境和云托管服务名",
      }));
      return;
    }

    const requestPath = appendCloudRoute(options.url, env.envVersion);
    const task = wx.cloud.callContainer({
      config: {
        env: env.cloudEnvId,
      },
      path: requestPath,
      method: options.method || "GET",
      timeout: requestTimeout(options),
      data: options.data || {},
      header: {
        ...buildHeader(token, requestId, idempotencyKey, options.header),
        "X-WX-SERVICE": env.cloudServiceName,
      },
      success(res) {
        try {
          resolve(parseResponse(res));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        console.warn("MYROOT_CLOUD_CONTAINER_FAIL", {
          envVersion: env.envVersion,
          cloudServiceName: env.cloudServiceName,
          path: String(requestPath || "").split("?")[0],
          error: safeErrorSummary(error),
        });
        reject(transportError(error, options.method, "cloudContainer"));
      },
    });
    if (task && typeof task.abort === "function") setAbort(() => task.abort());
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readIdentity(options, token) {
  return stableSerialize({
    method: String(options.method || "GET").toUpperCase(),
    url: String(options.url || ""),
    data: options.data || {},
    header: options.header || {},
    scope: String(options.scope || "").trim(),
    token,
  });
}

function unregisterScopes(entry) {
  for (const scope of entry.scopes) {
    const entries = scopedRequests.get(scope);
    if (!entries) continue;
    entries.delete(entry);
    if (!entries.size) scopedRequests.delete(scope);
  }
  entry.scopes.clear();
}

function registerScope(entry, scope) {
  const normalized = String(scope || "").trim();
  if (!normalized || entry.scopes.has(normalized)) return;
  entry.scopes.add(normalized);
  const entries = scopedRequests.get(normalized) || new Set();
  entries.add(entry);
  scopedRequests.set(normalized, entries);
}

function releaseSlot(entry) {
  if (!entry.started || entry.slotReleased) return;
  entry.slotReleased = true;
  activeRequestCount = Math.max(0, activeRequestCount - 1);
  activeRequests.delete(entry);
}

function finishEntry(entry, outcome, value) {
  if (entry.settled) return;
  entry.settled = true;
  releaseSlot(entry);
  unregisterScopes(entry);
  if (outcome === "resolve") entry.resolve(value);
  else entry.reject(value);
  drainQueue();
}

function cancelEntry(entry, force = false) {
  if (!entry || entry.settled) return false;
  if (!force && !entry.cancellable) return false;
  entry.cancelled = true;
  if (typeof entry.abort === "function") {
    try {
      entry.abort();
    } catch (error) {
      // Cancellation is best-effort; the caller still receives a stable result.
    }
  }
  finishEntry(entry, "reject", createRequestError({
    code: "REQUEST_CANCELLED",
    message: "请求已取消",
  }));
  return true;
}

function drainQueue() {
  while (activeRequestCount < MAX_CONCURRENT_REQUESTS && queuedRequests.length) {
    const entry = queuedRequests.shift();
    if (!entry || entry.cancelled || entry.settled) continue;
    entry.started = true;
    activeRequestCount += 1;
    activeRequests.add(entry);
    Promise.resolve()
      .then(() => entry.run((abort) => { entry.abort = abort; }))
      .then((value) => finishEntry(entry, "resolve", value))
      .catch((error) => finishEntry(entry, "reject", error));
  }
}

function scheduleRequest(run, scope, options = {}) {
  const entry = {
    abort: null,
    cancellable: options.cancellable !== false,
    cancelled: false,
    reject: null,
    resolve: null,
    run,
    scopes: new Set(),
    settled: false,
    slotReleased: false,
    started: false,
  };
  const promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  promise.cancel = () => cancelEntry(entry);
  promise.requestEntry = entry;
  registerScope(entry, scope);
  queuedRequests.push(entry);
  drainQueue();
  return promise;
}

function cancelRequestScope(scope) {
  const entries = scopedRequests.get(String(scope || "").trim());
  if (!entries) return 0;
  let cancelled = 0;
  for (const entry of [...entries]) {
    if (cancelEntry(entry)) cancelled += 1;
  }
  return cancelled;
}

function createScheduledRequest(options, token, requestId, idempotencyKey) {
  const startedAt = Date.now();
  const write = !isReadMethod(options.method);
  return scheduleRequest((setAbort) => {
    const runtimeConfig = resolveRuntimeRequestConfig(env, wx);
    const transport = runtimeConfig.adapter === "cloudContainer"
      ? requestByCloudContainer(options, token, requestId, idempotencyKey, setAbort)
      : requestByWxRequest(options, token, requestId, idempotencyKey, setAbort, runtimeConfig);
    return transport.then((value) => {
      if (!options.skipPerformance) performanceMonitor.recordRequest({
        route: options.url,
        method: options.method || "GET",
        durationMs: Date.now() - startedAt,
        status: "SUCCESS",
        write,
      });
      return value;
    }, (error) => {
      if (!options.skipPerformance) performanceMonitor.recordRequest({
        route: options.url,
        method: options.method || "GET",
        durationMs: Date.now() - startedAt,
        status: error && error.resultUnknown ? "RESULT_UNKNOWN" : "FAILED",
        errorCode: error && error.code,
        write,
      });
      throw error;
    });
  }, write ? "" : options.scope, { cancellable: !write });
}

function request(options = {}) {
  const token = getToken();
  const requestId = String(options.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    .replace(/[^A-Za-z0-9:._-]/g, "")
    .slice(0, 120);
  const idempotencyKey = String(options.idempotencyKey || "")
    .replace(/[^A-Za-z0-9:._-]/g, "")
    .slice(0, 128);
  if (idempotencyKey && idempotencyKey === requestId) {
    return Promise.reject(createRequestError({
      code: "ACTIVITY_COMMAND_IDENTITY_NOT_SEPARATED",
      message: "幂等意图标识不能与当次请求标识相同",
    }));
  }

  if (isReadMethod(options.method) && options.dedupe !== false) {
    const identity = readIdentity(options, token);
    const recent = recentReads.get(identity);
    if (recent && recent.expiresAt > Date.now()) {
      const cached = Promise.resolve(recent.value);
      cached.cancel = () => false;
      return cached;
    }
    if (recent) recentReads.delete(identity);
    const inflight = inflightReads.get(identity);
    if (inflight) {
      registerScope(inflight.requestEntry, options.scope);
      return inflight;
    }
    const scheduled = createScheduledRequest(options, token, requestId, idempotencyKey);
    inflightReads.set(identity, scheduled);
    scheduled.then((value) => {
      recentReads.set(identity, { value, expiresAt: Date.now() + READ_DEDUPE_WINDOW });
    }).finally(() => {
      if (inflightReads.get(identity) === scheduled) inflightReads.delete(identity);
    }).catch(() => {});
    return scheduled;
  }
  return createScheduledRequest(options, token, requestId, idempotencyKey);
}

function requestWithDeadline(options = {}, deadlineMs = 4500) {
  const deadline = Math.max(500, Math.min(Number(deadlineMs) || 4500, requestTimeout(options)));
  const pending = request({ ...options, timeout: deadline });
  let settled = false;
  let timer;
  const bounded = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (typeof pending.cancel === "function") pending.cancel();
      reject(createRequestError({ code: "READ_TIMEOUT", message: "服务响应较慢，请稍后重试" }));
    }, deadline);
    pending.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
  bounded.cancel = () => {
    clearTimeout(timer);
    return typeof pending.cancel === "function" ? pending.cancel() : false;
  };
  return bounded;
}

function resetRequestStateForTests() {
  const entries = [...activeRequests, ...queuedRequests];
  queuedRequests = [];
  for (const entry of entries) cancelEntry(entry, true);
  activeRequestCount = 0;
  activeRequests.clear();
  inflightReads.clear();
  recentReads.clear();
  scopedRequests.clear();
}

performanceMonitor.configureUploader((batch) => request({
  url: "/api/v1/performance/events",
  method: "POST",
  data: { schemaVersion: batch.schemaVersion, events: batch.events },
  header: { "X-Performance-Session": batch.sessionId },
  scope: "performance-monitor",
  skipPerformance: true,
}));

module.exports = {
  buildHeader,
  cancelRequestScope,
  clearToken,
  createRequestError,
  getToken,
  parseResponse,
  request,
  requestWithDeadline,
  resetRequestStateForTests,
  safeErrorSummary,
  setToken,
  stringifyError,
};
