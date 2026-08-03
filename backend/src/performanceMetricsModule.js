const MAX_BATCH_BYTES = 32 * 1024;
const MAX_BATCH_EVENTS = 20;
const DEFAULT_MAX_EVENTS_PER_MINUTE = 120;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

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

const EVENT_FIELDS = new Set([
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

function metricsError(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

function stableText(value, maximum, field) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || SENSITIVE_VALUE_PATTERN.test(text)) {
    throw metricsError("PERFORMANCE_EVENT_VALUE_INVALID", `${field} is invalid`, 400);
  }
  if (!/^[A-Za-z0-9._:/-]+$/.test(text)) {
    throw metricsError("PERFORMANCE_EVENT_VALUE_INVALID", `${field} is invalid`, 400);
  }
  return text;
}

function stableSessionId(value) {
  const sessionId = String(value || "").trim();
  if (!/^perf-[A-Za-z0-9._-]{4,72}$/.test(sessionId) || SENSITIVE_VALUE_PATTERN.test(sessionId)) {
    throw metricsError("PERFORMANCE_SESSION_INVALID", "performance session is invalid", 400);
  }
  return sessionId;
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw metricsError("PERFORMANCE_EVENT_INVALID", "performance event is invalid", 400);
  }
  for (const field of Object.keys(input)) {
    if (!EVENT_FIELDS.has(field) || SENSITIVE_FIELD_PATTERN.test(field)) {
      throw metricsError("PERFORMANCE_EVENT_FIELD_FORBIDDEN", `performance field is forbidden: ${field}`, 400);
    }
  }
  if (!EVENT_NAMES.has(input.name)) {
    throw metricsError("PERFORMANCE_EVENT_NAME_INVALID", "performance event name is invalid", 400);
  }
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw metricsError("PERFORMANCE_EVENT_VALUE_INVALID", "occurredAt is invalid", 400);
  }
  const event = {
    eventId: stableText(input.eventId, 120, "eventId"),
    name: input.name,
    occurredAt: occurredAt.toISOString(),
  };
  for (const field of EVENT_FIELDS) {
    if (["eventId", "name", "occurredAt"].includes(field)) continue;
    const value = input[field];
    if (value === undefined || value === null || value === "") continue;
    if (["durationMs", "sizeBytes"].includes(field)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
        throw metricsError("PERFORMANCE_EVENT_VALUE_INVALID", `${field} is invalid`, 400);
      }
      event[field] = value;
      continue;
    }
    event[field] = stableText(value, field === "page" || field === "route" ? 160 : 80, field);
  }
  return Object.freeze(event);
}

function createPerformanceMetricsModule(options = {}) {
  const logger = options.logger || console;
  const now = options.now || Date.now;
  const maxEventsPerMinute = options.maxEventsPerMinute || DEFAULT_MAX_EVENTS_PER_MINUTE;
  const duplicateEvents = new Map();
  const sessionWindows = new Map();
  let globalWindow = [];

  function cleanup(at) {
    for (const [eventId, seenAt] of duplicateEvents) {
      if (at - seenAt > DUPLICATE_WINDOW_MS) duplicateEvents.delete(eventId);
    }
    for (const [sessionId, timestamps] of sessionWindows) {
      const active = timestamps.filter((timestamp) => at - timestamp < 60_000);
      if (active.length) sessionWindows.set(sessionId, active);
      else sessionWindows.delete(sessionId);
    }
    globalWindow = globalWindow.filter((timestamp) => at - timestamp < 60_000);
  }

  function acceptBatch(input, context = {}) {
    let encoded;
    try {
      encoded = JSON.stringify(input);
    } catch (error) {
      throw metricsError("PERFORMANCE_BATCH_INVALID", "performance batch is invalid", 400);
    }
    if (Buffer.byteLength(encoded) > MAX_BATCH_BYTES) {
      throw metricsError("PERFORMANCE_BATCH_TOO_LARGE", "performance batch is too large", 413);
    }
    if (!input || input.schemaVersion !== 1 || !Array.isArray(input.events)) {
      throw metricsError("PERFORMANCE_BATCH_INVALID", "performance batch is invalid", 400);
    }
    for (const field of Object.keys(input)) {
      if (!["schemaVersion", "events"].includes(field)) {
        throw metricsError("PERFORMANCE_BATCH_FIELD_FORBIDDEN", `performance batch field is forbidden: ${field}`, 400);
      }
    }
    if (!input.events.length || input.events.length > MAX_BATCH_EVENTS) {
      throw metricsError("PERFORMANCE_BATCH_SIZE_INVALID", "performance batch size is invalid", 400);
    }
    const sessionId = stableSessionId(context.sessionId);
    const at = now();
    cleanup(at);
    const events = input.events.map(normalizeEvent);
    for (const event of events) {
      if (duplicateEvents.has(event.eventId)) {
        throw metricsError("PERFORMANCE_EVENT_DUPLICATE", "performance event is duplicated", 409);
      }
    }
    const recent = sessionWindows.get(sessionId) || [];
    if (recent.length + events.length > maxEventsPerMinute) {
      throw metricsError("PERFORMANCE_RATE_LIMITED", "performance event rate is too high", 429);
    }
    if (globalWindow.length + events.length > maxEventsPerMinute * 20) {
      throw metricsError("PERFORMANCE_GLOBAL_RATE_LIMITED", "global performance event rate is too high", 429);
    }

    events.forEach((event) => {
      duplicateEvents.set(event.eventId, at);
      recent.push(at);
      globalWindow.push(at);
      logger.info("MYROOT_PERFORMANCE_EVENT", Object.freeze({
        schemaVersion: 1,
        receivedAt: new Date(at).toISOString(),
        sessionId,
        ...event,
      }));
    });
    sessionWindows.set(sessionId, recent);
    return Object.freeze({
      acceptedCount: events.length,
      receivedAt: new Date(at).toISOString(),
    });
  }

  return Object.freeze({ acceptBatch });
}

module.exports = {
  EVENT_FIELDS,
  EVENT_NAMES,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  createPerformanceMetricsModule,
  normalizeEvent,
};
