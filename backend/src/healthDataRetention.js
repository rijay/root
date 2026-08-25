const auditLog = require("./auditLog");
const { createCloudbaseObjectStorageAdapter } = require("./cloudbaseObjectStorageAdapter");
const { addDays, nowISO } = require("./dates");
const { consentConfig } = require("./privacyConsent");

const DEFAULT_CLEANUP_LIMIT = 50;
const MAX_CLEANUP_LIMIT = 200;
const SENSITIVE_OPERATION_TASK_TYPES = new Set(["CONSULTATION_FOLLOW", "FEEDBACK_FOLLOW", "QUESTIONNAIRE_FOLLOW"]);
const SENSITIVE_AUDIT_TARGET_TYPES = new Set(["OPERATION_TASK", "WEWORK_TOUCH_JOB"]);
const OPERATION_TASK_METADATA_ALLOWLIST = new Set([
  "assignedAdvisorId",
  "assignedAdvisorName",
  "assignedAdvisorRole",
  "assignedAt",
  "assignmentId",
  "assignmentMode",
  "campaignId",
  "consultationType",
  "externalContactId",
  "questionnaireAnswerId",
  "questionnaireId",
  "rootUserId",
  "sessionId",
  "sourceChannel",
  "sourceId",
  "sourceType",
  "taskEventId",
]);
const AUDIT_METADATA_ALLOWLIST = new Set([
  "adapterType",
  "advisorId",
  "assignmentId",
  "assignmentMode",
  "requestId",
  "status",
  "taskId",
  "writebackId",
]);

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function readList(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function recordDate(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isExpired(value, cutoffDate) {
  const date = recordDate(value);
  return Boolean(date && date < cutoffDate);
}

function normalizedNow(value) {
  const requested = text(value);
  if (!requested) return nowISO();
  const date = recordDate(requested);
  const dateValue = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const normalizedDate = Number.isFinite(dateValue) ? new Date(dateValue).toISOString().slice(0, 10) : "";
  if (!date || normalizedDate !== date || !Number.isFinite(Date.parse(requested))) {
    const error = new Error("health data retention cleanup now 必须是有效 ISO 日期时间");
    error.code = 400;
    throw error;
  }
  return requested;
}

function publicCandidate(candidate) {
  return {
    kind: candidate.kind,
    recordId: candidate.recordId,
    occurredAt: candidate.occurredAt,
    mediaCount: new Set(candidate.mediaRefs).size,
    cleanupAction: candidate.remove ? "DELETE_RECORD" : "REDACT_HEALTH_DATA",
  };
}

function mediaRefs(values) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => text(value)).filter((value) => /^(cloud:\/\/|https:\/\/)/i.test(value));
}

function deepMediaRefs(value, results = [], seen = new Set()) {
  if (typeof value === "string") {
    if (/^(cloud:\/\/|https:\/\/)/i.test(value)) results.push(value);
    return results;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return results;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => deepMediaRefs(item, results, seen));
  else Object.values(value).forEach((item) => deepMediaRefs(item, results, seen));
  return results;
}

function allowlistedObject(value, allowlist) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowlist.has(key)));
}

function safeResultToken(value) {
  const result = text(value);
  return /^[A-Z0-9_:-]{1,64}$/.test(result) ? result : "";
}

function markRedaction(item, redactedAt, pendingMediaRefs = []) {
  if (pendingMediaRefs.length) {
    delete item.health_data_redacted_at;
    item.health_data_redaction_pending_at = item.health_data_redaction_pending_at || redactedAt;
    item.health_data_redaction_last_attempt_at = redactedAt;
    return;
  }
  item.health_data_redacted_at = redactedAt;
  delete item.health_data_redaction_pending_at;
  delete item.health_data_redaction_last_attempt_at;
  delete item.health_data_pending_media_refs;
}

function markDerivedRedaction(item, redactedAt, pendingMediaRefs = []) {
  if (pendingMediaRefs.length) {
    item.health_data_pending_media_refs = Array.from(new Set(pendingMediaRefs));
  } else {
    delete item.health_data_pending_media_refs;
  }
  markRedaction(item, redactedAt, pendingMediaRefs);
}

function candidateSpecs() {
  return [
    {
      kind: "USER_PROFILE",
      collection: "profiles",
      id: (item) => item.profile_id || item.user_id,
      time: (item) => item.submitted_at || item.updated_at || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.join_reasons = [];
        item.gut_health_status = "";
        item.improvement_methods = [];
        item.stool_type = "";
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "QUESTIONNAIRE_ANSWER",
      collection: "questionnaireAnswers",
      id: (item) => item.questionnaire_answer_id,
      time: (item) => item.submitted_at || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.answers_json = {};
        item.needs_follow = false;
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "QUESTIONNAIRE_RESPONSE",
      collection: "questionnaireResponses",
      id: (item) => item.response_id,
      time: (item) => item.submitted_at || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.answers = {};
        item.needs_follow = false;
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "HEALTH_SCALE_RESPONSE",
      collection: "healthScaleResponses",
      id: (item) => item.health_scale_response_id,
      time: (item) => item.submitted_at || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.answers_json = {};
        item.result_json = {};
        item.score = null;
        item.result_level_id = "";
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "HEALTH_ASSESSMENT_ATTEMPT",
      collection: "healthAssessmentAttempts",
      id: (item) => item.assessment_id,
      time: (item) => item.completed_at || item.updated_at || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.answers_json = {};
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "CHECKIN_RECORD",
      collection: "checkinRecords",
      id: (item) => item.record_id,
      time: (item) => item.checked_in_at || item.checkin_date || item.created_at,
      media: (item) => mediaRefs(item.image_urls),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.had_stool = false;
        item.stool_type = "";
        item.feedback = "";
        item.image_urls = Array.from(new Set(pendingMediaRefs));
        markRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "DAILY_CHECKIN_RECORD",
      collection: "dailyCheckinRecords",
      id: (item) => item.record_id,
      time: (item) => item.checked_in_at || item.checkin_date || item.created_at,
      media: () => [],
      redact(item, redactedAt) {
        item.had_stool = false;
        item.stool_type = "";
        item.feedback = "";
        markRedaction(item, redactedAt);
      },
    },
    {
      kind: "HEALTH_FOLLOWUP_TASK",
      collection: "operationTasks",
      filter: (item) => SENSITIVE_OPERATION_TASK_TYPES.has(text(item.task_type).toUpperCase()),
      id: (item) => item.task_id,
      time: (item) => item.completed_at || item.updated_at || item.created_at || item.task_date,
      media: (item) => deepMediaRefs([item.reason, item.suggested_action, item.suggested_script, item.note, item.result, item.metadata, item.health_data_pending_media_refs]),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.reason = "健康反馈跟进事实已按保存期限脱敏";
        item.suggested_action = "";
        item.suggested_script = "";
        item.note = "";
        item.result = safeResultToken(item.result);
        item.metadata = allowlistedObject(item.metadata, OPERATION_TASK_METADATA_ALLOWLIST);
        markDerivedRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "WEWORK_TOUCH_COPY",
      collection: "weworkTouchJobs",
      filter: (item) => SENSITIVE_OPERATION_TASK_TYPES.has(text(item.task_type).toUpperCase()),
      id: (item) => item.wework_touch_job_id,
      time: (item) => item.delivered_at || item.updated_at || item.created_at || item.due_at,
      media: (item) => deepMediaRefs([item.message, item.last_error, item.payload_json, item.health_data_pending_media_refs]),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.message = "";
        item.last_error = "";
        item.payload_json = { retentionRedacted: true };
        markDerivedRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "CONSULTATION_WRITEBACK_COPY",
      collection: "consultationWeworkWritebacks",
      id: (item) => item.writeback_id,
      time: (item) => item.delivered_at || item.created_at,
      media: (item) => deepMediaRefs([item.message, item.note, item.payload_json, item.health_data_pending_media_refs]),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.message = "";
        item.note = "";
        item.payload_json = { retentionRedacted: true };
        markDerivedRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "CONSULTATION_ASSIGNMENT_COPY",
      collection: "consultationAdvisorAssignments",
      id: (item) => item.assignment_id,
      time: (item) => item.replaced_at || item.created_at,
      media: (item) => deepMediaRefs([item.reason, item.health_data_pending_media_refs]),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.reason = "咨询顾问分配事实已按健康数据保存期限脱敏";
        markDerivedRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "HEALTH_OPERATION_AUDIT_DETAIL",
      collection: "auditLogs",
      filter: (item) => SENSITIVE_AUDIT_TARGET_TYPES.has(text(item.target_type).toUpperCase()),
      id: (item) => item.audit_id || item.audit_log_id,
      time: (item) => item.created_at,
      media: (item) => deepMediaRefs([item.reason, item.before, item.after, item.metadata, item.health_data_pending_media_refs]),
      redact(item, redactedAt, pendingMediaRefs = []) {
        item.reason = "健康相关操作审计详情已按保存期限脱敏";
        item.before = null;
        item.after = { retentionRedacted: true };
        item.metadata = allowlistedObject(item.metadata, AUDIT_METADATA_ALLOWLIST);
        markDerivedRedaction(item, redactedAt, pendingMediaRefs);
      },
    },
    {
      kind: "UPLOAD_REFERENCE",
      collection: "uploads",
      id: (item) => item.upload_id,
      time: (item) => item.created_at,
      media: (item) => mediaRefs(item.url),
      remove: true,
    },
  ];
}

function resolveHealthDataRetentionConfig(context = {}) {
  const env = context.env || process.env;
  const consent = consentConfig({ env });
  return {
    ...consent,
    cleanupEnabled: enabled(env.ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED),
    retentionConfigured: Boolean(
      consent.required && consent.controllerName && consent.contact && consent.retentionDays
    ),
    cleanupLimit: clampInteger(
      env.ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT,
      DEFAULT_CLEANUP_LIMIT,
      1,
      MAX_CLEANUP_LIMIT,
    ),
  };
}

function normalizeOptions(body = {}, context = {}) {
  const config = resolveHealthDataRetentionConfig(context);
  const now = normalizedNow(body.now);
  const cutoffDate = config.retentionDays
    ? addDays(recordDate(now) || recordDate(nowISO()), -config.retentionDays)
    : "";
  const dryRun = body.execute !== true;
  return {
    config,
    now,
    cutoffDate,
    dryRun,
    limit: clampInteger(
      body.limit || body.cleanupLimit || body.cleanup_limit,
      config.cleanupLimit,
      1,
      MAX_CLEANUP_LIMIT,
    ),
    objectCleanup: body.objectCleanup === undefined && body.object_cleanup === undefined
      ? true
      : enabled(body.objectCleanup === undefined ? body.object_cleanup : body.objectCleanup),
    requestId: text(body.requestId || body.request_id || context.requestId || context.request_id),
    operatorId: text(body.operatorId || body.operator_id || context.operatorId || context.operator_id, "system"),
    reason: text(body.reason, "健康敏感数据保存期限到期清理"),
  };
}

function requireConfigured(options) {
  if (!options.config.retentionConfigured) {
    const error = new Error("健康敏感信息保存期限尚未完成生产配置");
    error.code = 45102;
    throw error;
  }
  if (!options.dryRun && !options.config.cleanupEnabled) {
    const error = new Error("健康敏感数据到期清理尚未启用");
    error.code = 45105;
    throw error;
  }
  if (!options.dryRun && !options.requestId) {
    const error = new Error("health data retention cleanup request_id 必填");
    error.code = 400;
    throw error;
  }
}

function collectCandidates(data, options) {
  const rows = [];
  for (const spec of candidateSpecs()) {
    for (const item of readList(data, spec.collection)) {
      if (!item || item.health_data_redacted_at) continue;
      if (spec.filter && !spec.filter(item)) continue;
      const occurredAt = text(spec.time(item));
      if (!isExpired(occurredAt, options.cutoffDate)) continue;
      rows.push({
        spec,
        kind: spec.kind,
        collection: spec.collection,
        record: item,
        recordId: text(spec.id(item), spec.kind + ":" + (rows.length + 1)),
        occurredAt,
        mediaRefs: spec.media(item),
        remove: spec.remove === true,
      });
    }
  }
  rows.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.kind.localeCompare(right.kind));
  return {
    eligible: rows,
    selected: rows.slice(0, options.limit),
  };
}

function collectCloudReferenceCounts(value, counts = new Map(), seen = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("cloud://")) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return counts;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectCloudReferenceCounts(item, counts, seen));
  } else {
    Object.values(value).forEach((item) => collectCloudReferenceCounts(item, counts, seen));
  }
  return counts;
}

function selectedCloudReferenceCounts(candidates) {
  const counts = new Map();
  candidates.forEach((candidate) => {
    candidate.mediaRefs.filter((ref) => ref.startsWith("cloud://")).forEach((ref) => {
      counts.set(ref, (counts.get(ref) || 0) + 1);
    });
  });
  return counts;
}

function resolveObjectStorageAdapter(context = {}) {
  if (context.objectStorageAdapter) return context.objectStorageAdapter;
  const env = context.env || process.env;
  return createCloudbaseObjectStorageAdapter({
    provider: "CLOUDBASE",
    envId: env.ROOT_CLOUDBASE_ENV_ID || env.CLOUDBASE_ENV_ID || env.TCB_ENV_ID,
  }, context);
}

function notFoundError(error) {
  return /(not[ _-]?found|nonexist|does not exist|不存在)/i.test(String((error && error.code) || "") + " " + String((error && error.message) || ""));
}

async function deleteCandidateMedia(candidate, mediaContext) {
  const failedRefs = [];
  const retainedSharedRefs = [];
  const unmanagedHttpsRefs = [];
  for (const ref of new Set(candidate.mediaRefs)) {
    if (ref.startsWith("https://")) {
      unmanagedHttpsRefs.push(ref);
      mediaContext.unmanagedHttpsRefs.add(ref);
      continue;
    }
    const shared = (mediaContext.totalCounts.get(ref) || 0) > (mediaContext.selectedCounts.get(ref) || 0);
    if (shared) {
      retainedSharedRefs.push(ref);
      mediaContext.sharedRefs.add(ref);
      continue;
    }
    if (!mediaContext.objectCleanup || !mediaContext.adapter) {
      if (!mediaContext.deletionState.has(ref)) {
        mediaContext.deletionState.set(ref, { ok: false, status: "UNAVAILABLE" });
      }
      failedRefs.push(ref);
      continue;
    }
    let state = mediaContext.deletionState.get(ref);
    if (!state) {
      try {
        const result = await mediaContext.adapter.deleteObject({ externalRef: ref, fileId: ref, objectKey: "" });
        state = result && result.deleted !== false
          ? { ok: true, status: "DELETED" }
          : { ok: false, status: "FAILED_RESPONSE" };
      } catch (error) {
        state = notFoundError(error)
          ? { ok: true, status: "ALREADY_MISSING" }
          : { ok: false, status: "FAILED", error: text(error && error.message, "object delete failed").slice(0, 180) };
      }
      mediaContext.deletionState.set(ref, state);
    }
    if (!state.ok) failedRefs.push(ref);
  }
  return {
    failed: failedRefs.length > 0,
    failedRefs,
    retainedSharedRefs,
    unmanagedHttpsRefs,
  };
}

function kindCounts(results, key) {
  const counts = {};
  results.filter((item) => item[key]).forEach((item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  });
  return counts;
}

function appendCleanupAudit(data, options, result) {
  return auditLog.appendAuditLog(data, {
    action: "HEALTH_DATA_RETENTION_CLEANUP",
    targetType: "HEALTH_SENSITIVE_DATA",
    targetId: options.cutoffDate,
    operatorId: options.operatorId,
    reason: options.reason,
    before: null,
    after: {
      redactedCount: result.redactedCount,
      partialRedactedCount: result.partialRedactedCount,
      removedCount: result.removedCount,
      failedCount: result.failedCount,
      objectDeletedCount: result.objectDeletedCount,
      objectAlreadyMissingCount: result.objectAlreadyMissingCount,
      objectSharedCount: result.objectSharedCount,
      objectFailedCount: result.objectFailedCount,
      unmanagedHttpsCount: result.unmanagedHttpsCount,
    },
    metadata: {
      requestId: options.requestId,
      retentionDays: options.config.retentionDays,
      cutoffDate: options.cutoffDate,
      selectedCount: result.selectedCount,
      eligibleCount: result.eligibleCount,
      redactedByKind: kindCounts(result.results, "redacted"),
      partialRedactedByKind: kindCounts(result.results, "partialRedacted"),
      failedByKind: kindCounts(result.results, "failed"),
    },
  });
}

async function cleanupExpiredHealthData(data, body = {}, context = {}) {
  const options = normalizeOptions(body, context);
  requireConfigured(options);
  const planned = collectCandidates(data, options);
  const result = {
    dryRun: options.dryRun,
    executed: false,
    now: options.now,
    retentionDays: options.config.retentionDays,
    cutoffDate: options.cutoffDate,
    limit: options.limit,
    objectCleanup: options.objectCleanup,
    eligibleCount: planned.eligible.length,
    selectedCount: planned.selected.length,
    pendingCount: Math.max(0, planned.eligible.length - planned.selected.length),
    redactedCount: 0,
    partialRedactedCount: 0,
    removedCount: 0,
    failedCount: 0,
    objectDeletedCount: 0,
    objectAlreadyMissingCount: 0,
    objectSharedCount: 0,
    objectFailedCount: 0,
    unmanagedHttpsCount: 0,
    candidates: planned.selected.map(publicCandidate),
    results: [],
    auditId: "",
  };
  if (options.dryRun) return result;

  const totalCounts = collectCloudReferenceCounts(data);
  const selectedCounts = selectedCloudReferenceCounts(planned.selected);
  let adapter = null;
  if (planned.selected.some((candidate) => candidate.mediaRefs.some((ref) => ref.startsWith("cloud://")))) {
    try {
      adapter = resolveObjectStorageAdapter(context);
    } catch (_) {
      adapter = null;
    }
  }
  const mediaContext = {
    adapter,
    objectCleanup: options.objectCleanup,
    totalCounts,
    selectedCounts,
    deletionState: new Map(),
    sharedRefs: new Set(),
    unmanagedHttpsRefs: new Set(),
  };
  const removeRecordsByCollection = new Map();
  for (const candidate of planned.selected) {
    const media = await deleteCandidateMedia(candidate, mediaContext);
    if (media.failed) {
      result.failedCount += 1;
      if (candidate.remove) {
        candidate.record.health_data_redaction_pending_at = candidate.record.health_data_redaction_pending_at || options.now;
        candidate.record.health_data_redaction_last_attempt_at = options.now;
      } else {
        candidate.spec.redact(candidate.record, options.now, media.failedRefs);
        result.partialRedactedCount += 1;
      }
      result.results.push({
        kind: candidate.kind,
        recordId: candidate.recordId,
        redacted: false,
        partialRedacted: !candidate.remove,
        removed: false,
        failed: true,
        mediaSummary: {
          total: new Set(candidate.mediaRefs).size,
          failed: media.failedRefs.length,
          shared: media.retainedSharedRefs.length,
          unmanagedHttps: media.unmanagedHttpsRefs.length,
        },
        error: candidate.remove
          ? "CloudBase 图片删除未确认，保留上传引用等待重试"
          : "CloudBase 图片删除未确认，已脱敏健康内容并仅保留失败引用等待重试",
      });
      continue;
    }
    if (candidate.remove) {
      if (!removeRecordsByCollection.has(candidate.collection)) removeRecordsByCollection.set(candidate.collection, new Set());
      removeRecordsByCollection.get(candidate.collection).add(candidate.record);
      result.removedCount += 1;
    } else {
      candidate.spec.redact(candidate.record, options.now);
      result.redactedCount += 1;
    }
    result.results.push({
      kind: candidate.kind,
      recordId: candidate.recordId,
      redacted: !candidate.remove,
      partialRedacted: false,
      removed: candidate.remove,
      failed: false,
      mediaSummary: {
        total: new Set(candidate.mediaRefs).size,
        deleted: new Set(candidate.mediaRefs.filter((ref) => (mediaContext.deletionState.get(ref) || {}).status === "DELETED")).size,
        alreadyMissing: new Set(candidate.mediaRefs.filter((ref) => (mediaContext.deletionState.get(ref) || {}).status === "ALREADY_MISSING")).size,
        shared: media.retainedSharedRefs.length,
        unmanagedHttps: media.unmanagedHttpsRefs.length,
      },
      error: "",
    });
  }

  for (const [collection, records] of removeRecordsByCollection.entries()) {
    data[collection] = ensureList(data, collection).filter((item) => !records.has(item));
  }
  const objectStates = Array.from(mediaContext.deletionState.values());
  result.objectDeletedCount = objectStates.filter((state) => state.status === "DELETED").length;
  result.objectAlreadyMissingCount = objectStates.filter((state) => state.status === "ALREADY_MISSING").length;
  result.objectFailedCount = objectStates.filter((state) => !state.ok).length;
  result.objectSharedCount = mediaContext.sharedRefs.size;
  result.unmanagedHttpsCount = mediaContext.unmanagedHttpsRefs.size;
  result.executed = true;
  const audit = appendCleanupAudit(data, options, result);
  result.auditId = audit.audit_log_id || "";
  return result;
}

module.exports = {
  MAX_CLEANUP_LIMIT,
  cleanupExpiredHealthData,
  collectCandidates,
  normalizeOptions,
  resolveHealthDataRetentionConfig,
};
