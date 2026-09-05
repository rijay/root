const budgets = require("../config/performance-runtime-budgets");

const EVENT_NAMES = new Set([
  "app_launch",
  "page",
  "request",
  "image",
  "subpackage",
  "critical_write",
  "long_task",
  "memory_warning",
  "crash",
]);

const CRITICAL_EVENT_NAMES = new Set([
  "memory_warning",
  "crash",
  "critical_write",
]);

const ALLOWED_EVENT_FIELDS = new Set([
  "eventId",
  "name",
  "occurredAt",
  "version",
  "platform",
  "osVersion",
  "wechatVersion",
  "baseLibraryVersion",
  "deviceTier",
  "networkType",
  "entry",
  "packageState",
  "page",
  "route",
  "method",
  "durationMs",
  "sizeBytes",
  "status",
  "errorCode",
]);

const SENSITIVE_FIELD_PATTERN = /(phone|mobile|nickname|avatar|openid|unionid|token|password|secret|health|answer|diagnosis|member|coupon|balance|points|order)/i;
const SENSITIVE_VALUE_PATTERN = /(?:\b1[3-9]\d{9}\b|Bearer\s+|\b(?:openid|unionid|token|password|secret)=)/i;

function stableIdentifier(value, maximum = 120) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._:/-]+$/.test(normalized) ? normalized.slice(0, maximum) : "";
}

function createEventId(now, random) {
  return `perf-${now().toString(36)}-${Math.floor(random() * 0x100000000).toString(36)}`;
}

function createSessionId(now, random) {
  return `perf-session-${now().toString(36)}-${Math.floor(random() * 0x100000000).toString(36)}`;
}

function validateEventInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "EVENT_INVALID" };
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_EVENT_FIELDS.has(key) || SENSITIVE_FIELD_PATTERN.test(key)) {
      return { ok: false, reason: "EVENT_FIELD_FORBIDDEN", field: key };
    }
  }
  if (!EVENT_NAMES.has(input.name)) return { ok: false, reason: "EVENT_NAME_INVALID" };
  if (Object.values(input).some((value) => typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value))) {
    return { ok: false, reason: "EVENT_VALUE_FORBIDDEN" };
  }
  return { ok: true };
}

function normalizeEvent(input, context, now, random) {
  const occurredAt = input.occurredAt || new Date(now()).toISOString();
  const result = {
    eventId: stableIdentifier(input.eventId || createEventId(now, random)),
    name: input.name,
    occurredAt,
  };
  const merged = { ...(context || {}), ...input };
  for (const key of ALLOWED_EVENT_FIELDS) {
    if (["eventId", "name", "occurredAt"].includes(key)) continue;
    const value = merged[key];
    if (value === undefined || value === null || value === "") continue;
    if (["durationMs", "sizeBytes"].includes(key)) {
      if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
      continue;
    }
    const normalized = stableIdentifier(value, key === "page" || key === "route" ? 160 : 80);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function createPerformanceMonitor(options = {}) {
  const envVersion = String(options.envVersion || "develop");
  const now = options.now || Date.now;
  const random = options.random || Math.random;
  const context = Object.freeze({ ...(options.context || {}) });
  const queue = [];
  const sessionId = options.sessionId || createSessionId(now, random);
  const sampleRate = envVersion === "release"
    ? budgets.collection.releaseOrdinarySampleRate
    : budgets.collection.candidateSampleRate;
  let uploadEnabled = typeof options.enabled === "boolean"
    ? options.enabled
    : envVersion !== "release";
  let uploader = typeof options.uploader === "function" ? options.uploader : null;
  let nativeObserver = null;
  let flushTimer = null;

  function scheduleFlush() {
    if (!uploadEnabled || !uploader || flushTimer || typeof setTimeout !== "function") return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 5000);
  }

  function record(input) {
    const validation = validateEventInput(input);
    if (!validation.ok) return { accepted: false, ...validation };
    const critical = CRITICAL_EVENT_NAMES.has(input.name)
      || String(input.status || "").toUpperCase() === "FAILED"
      || String(input.status || "").toUpperCase() === "RESULT_UNKNOWN";
    if (!critical && random() >= sampleRate) return { accepted: false, reason: "SAMPLED_OUT" };
    const event = normalizeEvent(input, context, now, random);
    if (!event.eventId) return { accepted: false, reason: "EVENT_ID_INVALID" };
    queue.push(event);
    while (queue.length > budgets.collection.maxQueuedEvents) queue.shift();
    if (queue.length >= budgets.collection.maxBatchEvents) {
      Promise.resolve().then(flush);
    } else {
      scheduleFlush();
    }
    return { accepted: true, eventId: event.eventId };
  }

  function recordRequest(input = {}) {
    const status = input.status || "SUCCESS";
    return record({
      eventId: input.eventId,
      name: input.write && status !== "SUCCESS" ? "critical_write" : "request",
      route: String(input.route || "").split("?")[0],
      method: String(input.method || "GET").toUpperCase(),
      durationMs: input.durationMs,
      sizeBytes: input.sizeBytes,
      status,
      errorCode: input.errorCode || "",
    });
  }

  function recordPageMetric(input = {}) {
    return record({
      name: "page",
      page: input.page,
      entry: input.entry,
      durationMs: input.durationMs,
      status: input.status || "OBSERVED",
      errorCode: input.errorCode || "",
    });
  }

  function recordImageResult(input = {}) {
    return record({
      name: "image",
      page: input.page,
      entry: input.entry,
      durationMs: input.durationMs,
      status: input.status === "LOAD_FAILED" ? "LOAD_FAILED" : "LOAD_SUCCESS",
      errorCode: input.errorCode || "",
    });
  }

  async function flush() {
    if (flushTimer && typeof clearTimeout === "function") clearTimeout(flushTimer);
    flushTimer = null;
    if (!uploadEnabled) return { ok: false, reason: "UPLOAD_DISABLED", queued: queue.length };
    if (!uploader) return { ok: false, reason: "UPLOADER_UNAVAILABLE", queued: queue.length };
    if (!queue.length) return { ok: true, uploaded: 0, queued: 0 };
    const events = queue.slice(0, budgets.collection.maxBatchEvents);
    try {
      await uploader({ schemaVersion: 1, sessionId, events });
      queue.splice(0, events.length);
      return { ok: true, uploaded: events.length, queued: queue.length };
    } catch (error) {
      return { ok: false, reason: "UPLOAD_FAILED", queued: queue.length };
    }
  }

  function configureUploader(nextUploader) {
    uploader = typeof nextUploader === "function" ? nextUploader : null;
    if (uploader && queue.length) scheduleFlush();
  }

  function setUploadEnabled(enabled) {
    uploadEnabled = enabled === true;
    if (!uploadEnabled && flushTimer && typeof clearTimeout === "function") {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (uploadEnabled && queue.length) scheduleFlush();
  }

  function startNativeObservation(wxApi = typeof wx !== "undefined" ? wx : null) {
    if (!wxApi || typeof wxApi.getPerformance !== "function") {
      return { started: false, reason: "WX_PERFORMANCE_UNAVAILABLE" };
    }
    const performance = wxApi.getPerformance();
    if (!performance || typeof performance.createObserver !== "function") {
      return { started: false, reason: "WX_PERFORMANCE_OBSERVER_UNAVAILABLE" };
    }
    nativeObserver = performance.createObserver((entries) => {
      const list = entries && typeof entries.getEntries === "function" ? entries.getEntries() : [];
      list.forEach((entry) => {
        if (!entry || !Number.isFinite(entry.duration)) return;
        record({
          name: "page",
          entry: stableIdentifier(entry.entryType || entry.name || "native"),
          durationMs: entry.duration,
          status: "OBSERVED",
        });
      });
    });
    if (nativeObserver && typeof nativeObserver.observe === "function") {
      nativeObserver.observe({ entryTypes: ["navigation", "render", "script"] });
    }
    return { started: true };
  }

  function stopNativeObservation() {
    if (nativeObserver && typeof nativeObserver.disconnect === "function") nativeObserver.disconnect();
    nativeObserver = null;
  }

  function getSnapshot() {
    return Object.freeze({
      envVersion,
      sessionId,
      sampleRate,
      uploadEnabled,
      queueLength: queue.length,
    });
  }

  return Object.freeze({
    configureUploader,
    flush,
    getSnapshot,
    record,
    recordImageResult,
    recordPageMetric,
    recordRequest,
    setUploadEnabled,
    startNativeObservation,
    stopNativeObservation,
  });
}

let detectedEnvVersion = "develop";
try {
  detectedEnvVersion = require("../config/env").envVersion || "develop";
} catch (error) {
  detectedEnvVersion = "develop";
}

const performanceMonitor = createPerformanceMonitor({ envVersion: detectedEnvVersion });

module.exports = {
  ALLOWED_EVENT_FIELDS,
  CRITICAL_EVENT_NAMES,
  EVENT_NAMES,
  createPerformanceMonitor,
  performanceMonitor,
  validateEventInput,
};
