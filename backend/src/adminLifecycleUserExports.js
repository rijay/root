const { addDays, nowISO } = require("./dates");
const { createId } = require("./seed");
const adminLifecyclePresenter = require("./adminLifecyclePresenter");
const lifecycleExportDelivery = require("./adminLifecycleExportDelivery");
const lifecycleExportPolicy = require("./adminLifecycleExportPolicy");
const auditLog = require("./auditLog");

const DEFAULT_EXPORT_LIMIT = 200;
const DEFAULT_RETENTION_DAYS = 7;
const MAX_EXPORT_LIMIT = 200;
const MAX_RETENTION_DAYS = 90;
const DEFAULT_CLEANUP_LIMIT = 50;
const MAX_CLEANUP_LIMIT = 200;
const DEFAULT_DELIVERY_RETRY_LIMIT = 20;
const MAX_DELIVERY_RETRY_LIMIT = 100;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 3;
const MAX_DELIVERY_MAX_ATTEMPTS = 10;
const DEFAULT_DELIVERY_RETRY_DELAY_SECONDS = 300;
const MIN_DELIVERY_RETRY_DELAY_SECONDS = 60;
const MAX_DELIVERY_RETRY_DELAY_SECONDS = 24 * 60 * 60;
const DEFAULT_DELIVERY_HEALTH_ISSUE_LIMIT = 10;
const MAX_DELIVERY_HEALTH_ISSUE_LIMIT = 50;
const APPROVAL_STATUS = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeBoolean(options, camelKey, snakeKey, fallback = true) {
  if (Object.prototype.hasOwnProperty.call(options, camelKey)) return options[camelKey] === true || String(options[camelKey]).toLowerCase() === "true";
  if (Object.prototype.hasOwnProperty.call(options, snakeKey)) return options[snakeKey] === true || String(options[snakeKey]).toLowerCase() === "true";
  return fallback;
}

function booleanText(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "y"].includes(normalized);
}

function envValue(context = {}, name) {
  return (context.env && context.env[name]) || process.env[name] || "";
}

function epochMillis(value, fallback = Date.now()) {
  const millis = Date.parse(value || "");
  return Number.isFinite(millis) ? millis : fallback;
}

function isoShanghaiFromEpoch(millis) {
  const shifted = new Date(millis + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}

function addSecondsIso(value, seconds) {
  return isoShanghaiFromEpoch(epochMillis(value) + Number(seconds || 0) * 1000);
}

function normalizeFilters(body = {}, context = {}) {
  const rawFilters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
    ? body.filters
    : body;
  const campaignId = text(rawFilters.campaignId || rawFilters.campaign_id || envValue(context, "ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID"));
  const limit = clampNumber(
    rawFilters.limit || rawFilters.exportLimit || rawFilters.export_limit || body.exportLimit || body.export_limit || envValue(context, "ROOT_LIFECYCLE_EXPORT_LIMIT"),
    DEFAULT_EXPORT_LIMIT,
    1,
    MAX_EXPORT_LIMIT,
  );
  return {
    ...rawFilters,
    campaignId,
    limit,
  };
}

function normalizeOptions(body = {}, context = {}) {
  const dryRun = normalizeBoolean(body, "dryRun", "dry_run", true) && body.execute !== true;
  const filters = normalizeFilters(body, context);
  const exportPolicy = lifecycleExportPolicy.resolveLifecycleExportPolicy({
    ...body,
    ...filters,
  }, context);
  const retentionDays = clampNumber(
    body.retentionDays || body.retention_days || envValue(context, "ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS"),
    DEFAULT_RETENTION_DAYS,
    1,
    MAX_RETENTION_DAYS,
  );
  const configuredApprovalRequired = booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED"), false);
  const requestedApprovalRequired = normalizeBoolean(body, "approvalRequired", "approval_required", configuredApprovalRequired);
  const approvalRequired = exportPolicy.sensitivity === lifecycleExportPolicy.EXPORT_SENSITIVITY.RAW || requestedApprovalRequired;
  return {
    dryRun,
    filters,
    exportPolicy,
    deliveryOptions: lifecycleExportDelivery.resolveDeliveryOptions(body, context),
    approvalRequired,
    approvalStatus: approvalRequired ? APPROVAL_STATUS.PENDING : APPROVAL_STATUS.NOT_REQUIRED,
    approvalReason: text(body.approvalReason || body.approval_reason || body.downloadReason || body.download_reason || body.reason, "用户生命周期导出下载审批"),
    retentionDays,
    requestId: text(body.requestId || body.request_id),
    operatorId: text(body.operatorId || body.operator_id),
    reason: text(body.reason, "用户生命周期定时导出"),
    now: text(body.now) || nowISO(),
  };
}

function expiresAt(nowText, retentionDays) {
  const dateText = String(nowText || nowISO()).slice(0, 10);
  return `${addDays(dateText, retentionDays)}T23:59:59+08:00`;
}

function filenameFor(nowText) {
  const stamp = String(nowText || nowISO()).replace(/\D/g, "").slice(0, 12);
  return `root-lifecycle-users-${stamp}.csv`;
}

function isExpired(record, nowText = nowISO()) {
  return Boolean(record.expires_at && String(record.expires_at) < String(nowText));
}

function objectKeyForExport(record) {
  const target = record && record.delivery_target_json ? record.delivery_target_json : {};
  return text(target.objectKey || target.object_key);
}

function requiresObjectCleanup(record) {
  return Boolean(objectKeyForExport(record));
}

function pruneExpiredExports(data, nowText = nowISO()) {
  const list = ensureList(data, "adminLifecycleUserExports");
  const before = list.length;
  data.adminLifecycleUserExports = list.filter((record) => !isExpired(record, nowText) || requiresObjectCleanup(record));
  return before - data.adminLifecycleUserExports.length;
}

function toExportPayload(record, options = {}) {
  if (!record) return null;
  const summary = record.summary_json || {};
  const approvalRequired = Boolean(record.approval_required);
  const payload = {
    exportId: record.export_id,
    source: record.source,
    status: record.status,
    requestId: record.request_id || "",
    operatorId: record.operator_id || "",
    reason: record.reason || "",
    filters: record.filters_json || {},
    summary,
    sensitivity: summary.sensitivity || "UNKNOWN",
    requestedSensitivity: summary.requestedSensitivity || "",
    sensitivityDowngraded: Boolean(summary.sensitivityDowngraded),
    sensitiveFields: Array.isArray(summary.sensitiveFields) ? summary.sensitiveFields : [],
    approvalRequired,
    approvalStatus: record.approval_status || (approvalRequired ? APPROVAL_STATUS.PENDING : APPROVAL_STATUS.NOT_REQUIRED),
    approvalReason: record.approval_reason || "",
    approvalRequestedAt: record.approval_requested_at || "",
    approvalReviewedBy: record.approval_reviewed_by || "",
    approvalReviewedAt: record.approval_reviewed_at || "",
    approvalNote: record.approval_note || "",
    approvalRequestId: record.approval_request_id || "",
    delivery: {
      requested: Boolean(record.delivery_requested),
      channel: record.delivery_channel || lifecycleExportDelivery.DELIVERY_CHANNEL.NONE,
      status: record.delivery_status || lifecycleExportDelivery.DELIVERY_STATUS.NOT_REQUESTED,
      target: record.delivery_target_json || {},
      externalRef: record.delivery_external_ref || "",
      error: record.delivery_error || "",
      deliveredAt: record.delivery_delivered_at || "",
      requestId: record.delivery_request_id || "",
      attemptCount: record.delivery_attempt_count || 0,
      lastAttemptAt: record.delivery_last_attempt_at || "",
      nextRetryAt: record.delivery_next_retry_at || "",
      maxAttempts: record.delivery_max_attempts || 0,
      deadLetterReason: record.delivery_dead_letter_reason || "",
    },
    filename: record.filename,
    contentType: record.content_type,
    downloadCount: record.download_count || 0,
    createdAt: record.created_at,
    expiresAt: record.expires_at || "",
    lastDownloadedAt: record.last_downloaded_at || "",
  };
  if (options.includeCsv) payload.csvText = record.csv_text || "";
  return payload;
}

function normalizeDeliveryHealthOptions(query = {}) {
  return {
    now: text(query.now) || nowISO(),
    issueLimit: clampNumber(
      query.issueLimit || query.issue_limit || query.limit,
      DEFAULT_DELIVERY_HEALTH_ISSUE_LIMIT,
      1,
      MAX_DELIVERY_HEALTH_ISSUE_LIMIT,
    ),
    channel: text(query.channel).toUpperCase(),
  };
}

function deliveryStatus(record) {
  return record.delivery_status || lifecycleExportDelivery.DELIVERY_STATUS.NOT_REQUESTED;
}

function deliveryChannel(record) {
  return record.delivery_channel || lifecycleExportDelivery.DELIVERY_CHANNEL.NONE;
}

function deliveryFailureReason(record) {
  return text(record.delivery_dead_letter_reason || record.delivery_error || deliveryStatus(record), "UNKNOWN");
}

function deliveryRecordTime(record) {
  return record.delivery_last_attempt_at || record.delivery_delivered_at || record.created_at || "";
}

function healthIssuePayload(record, nowText) {
  const status = deliveryStatus(record);
  const nextRetryAt = text(record.delivery_next_retry_at);
  const dueRetry = Boolean(nextRetryAt && epochMillis(nextRetryAt, 0) <= epochMillis(nowText, Date.now()));
  return {
    exportId: record.export_id,
    filename: record.filename || "",
    channel: deliveryChannel(record),
    status,
    dueRetry,
    createdAt: record.created_at || "",
    lastAttemptAt: record.delivery_last_attempt_at || "",
    nextRetryAt,
    attemptCount: Number(record.delivery_attempt_count || 0),
    maxAttempts: Number(record.delivery_max_attempts || 0),
    externalRef: record.delivery_external_ref || "",
    error: record.delivery_error || "",
    deadLetterReason: record.delivery_dead_letter_reason || "",
    targetPreview: record.delivery_target_json?.targetPreview || record.delivery_target_json?.webhookUrlPreview || "",
  };
}

function buildDeliveryHealthStatus(summary) {
  if (!summary.requestedCount) {
    return {
      status: "IDLE",
      message: "暂无外部交付请求",
    };
  }
  if (summary.deadLetterCount > 0) {
    return {
      status: "BLOCKED",
      message: "存在死信交付记录，需要人工处理或修正通道配置",
    };
  }
  if (summary.dueRetryCount > 0 || summary.failedCount > 0 || summary.retryScheduledCount > 0 || summary.skippedCount > 0) {
    return {
      status: "WARNING",
      message: "存在失败、待重试或跳过的交付记录",
    };
  }
  if (summary.readyCount > 0 || summary.pendingApprovalCount > 0) {
    return {
      status: "PENDING",
      message: "存在待交付或待审批记录",
    };
  }
  return {
    status: "HEALTHY",
    message: "外部交付记录均已完成或无需处理",
  };
}

function incrementChannelStats(channelMap, record, nowText) {
  const channel = deliveryChannel(record);
  if (!channelMap.has(channel)) {
    channelMap.set(channel, {
      channel,
      total: 0,
      requested: 0,
      delivered: 0,
      ready: 0,
      pendingApproval: 0,
      failed: 0,
      retryScheduled: 0,
      deadLetter: 0,
      skipped: 0,
      dueRetry: 0,
      latestRecordAt: "",
      latestFailureAt: "",
      latestFailureReason: "",
      successRate: 0,
    });
  }
  const row = channelMap.get(channel);
  const status = deliveryStatus(record);
  const recordTime = deliveryRecordTime(record);
  row.total += 1;
  if (record.delivery_requested) row.requested += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.DELIVERED) row.delivered += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.READY) row.ready += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.PENDING_APPROVAL) row.pendingApproval += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.FAILED) row.failed += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED) row.retryScheduled += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER) row.deadLetter += 1;
  if (status === lifecycleExportDelivery.DELIVERY_STATUS.SKIPPED) row.skipped += 1;
  if (record.delivery_next_retry_at && epochMillis(record.delivery_next_retry_at, 0) <= epochMillis(nowText, Date.now())) row.dueRetry += 1;
  if (!row.latestRecordAt || String(recordTime) > String(row.latestRecordAt)) row.latestRecordAt = recordTime;
  if ([
    lifecycleExportDelivery.DELIVERY_STATUS.FAILED,
    lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED,
    lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER,
    lifecycleExportDelivery.DELIVERY_STATUS.SKIPPED,
  ].includes(status) && (!row.latestFailureAt || String(recordTime) > String(row.latestFailureAt))) {
    row.latestFailureAt = recordTime;
    row.latestFailureReason = deliveryFailureReason(record);
  }
  row.successRate = row.requested ? Math.round((row.delivered / row.requested) * 100) : 0;
}

function incrementReasonStats(reasonMap, record) {
  const status = deliveryStatus(record);
  if (![
    lifecycleExportDelivery.DELIVERY_STATUS.FAILED,
    lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED,
    lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER,
    lifecycleExportDelivery.DELIVERY_STATUS.SKIPPED,
  ].includes(status)) return;
  const reason = deliveryFailureReason(record);
  if (!reasonMap.has(reason)) {
    reasonMap.set(reason, {
      reason,
      count: 0,
      statuses: {},
      channels: {},
      latestAt: "",
    });
  }
  const row = reasonMap.get(reason);
  const channel = deliveryChannel(record);
  const recordTime = deliveryRecordTime(record);
  row.count += 1;
  row.statuses[status] = (row.statuses[status] || 0) + 1;
  row.channels[channel] = (row.channels[channel] || 0) + 1;
  if (!row.latestAt || String(recordTime) > String(row.latestAt)) row.latestAt = recordTime;
}

function getLifecycleExportDeliveryHealth(data, query = {}) {
  const options = normalizeDeliveryHealthOptions(query);
  pruneExpiredExports(data, options.now);
  const statusCounts = Object.values(lifecycleExportDelivery.DELIVERY_STATUS)
    .reduce((result, status) => ({ ...result, [status]: 0 }), {});
  const channelMap = new Map();
  const reasonMap = new Map();
  const issues = [];
  let nextRetryAt = "";
  const records = ensureList(data, "adminLifecycleUserExports")
    .filter((record) => !isExpired(record, options.now))
    .filter((record) => !options.channel || deliveryChannel(record) === options.channel);

  const summary = {
    totalExports: records.length,
    requestedCount: 0,
    deliveredCount: 0,
    readyCount: 0,
    pendingApprovalCount: 0,
    failedCount: 0,
    retryScheduledCount: 0,
    dueRetryCount: 0,
    deadLetterCount: 0,
    skippedCount: 0,
    notRequestedCount: 0,
    actionableCount: 0,
    successRate: 0,
  };

  for (const record of records) {
    const status = deliveryStatus(record);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (record.delivery_requested) summary.requestedCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.NOT_REQUESTED) summary.notRequestedCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.DELIVERED) summary.deliveredCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.READY) summary.readyCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.PENDING_APPROVAL) summary.pendingApprovalCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.FAILED) summary.failedCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED) summary.retryScheduledCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER) summary.deadLetterCount += 1;
    if (status === lifecycleExportDelivery.DELIVERY_STATUS.SKIPPED) summary.skippedCount += 1;

    const issue = healthIssuePayload(record, options.now);
    if (issue.dueRetry) summary.dueRetryCount += 1;
    if (record.delivery_next_retry_at && (!nextRetryAt || String(record.delivery_next_retry_at) < String(nextRetryAt))) {
      nextRetryAt = record.delivery_next_retry_at;
    }
    incrementChannelStats(channelMap, record, options.now);
    incrementReasonStats(reasonMap, record);
    if ([
      lifecycleExportDelivery.DELIVERY_STATUS.FAILED,
      lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED,
      lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER,
      lifecycleExportDelivery.DELIVERY_STATUS.SKIPPED,
    ].includes(status)) {
      issues.push(issue);
    }
  }

  summary.actionableCount = summary.deadLetterCount + summary.dueRetryCount + summary.failedCount + summary.skippedCount;
  summary.successRate = summary.requestedCount ? Math.round((summary.deliveredCount / summary.requestedCount) * 100) : 0;
  return {
    ...buildDeliveryHealthStatus(summary),
    now: options.now,
    channel: options.channel || "",
    summary,
    nextRetryAt,
    statusRows: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    channels: Array.from(channelMap.values()).sort((left, right) => right.requested - left.requested || left.channel.localeCompare(right.channel)),
    failureReasons: Array.from(reasonMap.values()).sort((left, right) => right.count - left.count || String(right.latestAt).localeCompare(String(left.latestAt))).slice(0, options.issueLimit),
    recentIssues: issues
      .sort((left, right) => String(right.lastAttemptAt || right.createdAt).localeCompare(String(left.lastAttemptAt || left.createdAt)))
      .slice(0, options.issueLimit),
  };
}

function buildSummary(workbench, csvText, options) {
  const bytes = Buffer.byteLength(csvText || "", "utf8");
  return {
    total: workbench.total || 0,
    exportedCount: Array.isArray(workbench.users) ? workbench.users.length : 0,
    limit: workbench.filters ? workbench.filters.limit : options.filters.limit,
    truncated: (workbench.total || 0) > (Array.isArray(workbench.users) ? workbench.users.length : 0),
    retentionDays: options.retentionDays,
    bytes,
    sensitivity: options.exportPolicy.sensitivity,
    requestedSensitivity: options.exportPolicy.requestedSensitivity,
    sensitivityDowngraded: options.exportPolicy.downgraded,
    sensitiveFields: options.exportPolicy.sensitiveFields,
    approvalRequired: options.approvalRequired,
    approvalStatus: options.approvalStatus,
    deliveryRequested: options.deliveryOptions.enabled,
    deliveryChannel: options.deliveryOptions.enabled ? options.deliveryOptions.channel : lifecycleExportDelivery.DELIVERY_CHANNEL.NONE,
  };
}

function planLifecycleUserExport(data, body = {}, context = {}) {
  const options = normalizeOptions(body, context);
  const workbench = adminLifecyclePresenter.buildLifecycleWorkbench(data, options.filters);
  const csvText = adminLifecyclePresenter.buildLifecycleUsersCsv(data, options.filters, {
    exportPolicy: options.exportPolicy,
  });
  return {
    dryRun: options.dryRun,
    filters: workbench.filters,
    summary: buildSummary(workbench, csvText, options),
    filename: filenameFor(options.now),
    expiresAt: expiresAt(options.now, options.retentionDays),
    sensitivity: options.exportPolicy.sensitivity,
    requestedSensitivity: options.exportPolicy.requestedSensitivity,
    sensitivityDowngraded: options.exportPolicy.downgraded,
    approvalRequired: options.approvalRequired,
    approvalStatus: options.approvalStatus,
  };
}

function requireExecuteRequestId(options) {
  if (!options.requestId) throw businessError(8031, "用户生命周期定时导出 request_id 必填", 400);
}

function requireCleanupRequestId(options) {
  if (!options.requestId) throw businessError(8039, "用户生命周期导出过期清理 request_id 必填", 400);
}

function appendExportAudit(data, record, action, before = null, after = null) {
  return auditLog.appendAuditLog(data, {
    action,
    targetType: "ADMIN_LIFECYCLE_USER_EXPORT",
    targetId: record.export_id,
    operatorId: record.operator_id || "",
    reason: record.reason || action,
    before,
    after,
    metadata: {
      requestId: record.request_id || "",
      filename: record.filename,
      exportedCount: record.summary_json ? record.summary_json.exportedCount : 0,
      expiresAt: record.expires_at || "",
      sensitivity: record.summary_json ? record.summary_json.sensitivity : "UNKNOWN",
      requestedSensitivity: record.summary_json ? record.summary_json.requestedSensitivity : "",
      sensitivityDowngraded: record.summary_json ? Boolean(record.summary_json.sensitivityDowngraded) : false,
      sensitiveFields: record.summary_json && Array.isArray(record.summary_json.sensitiveFields)
        ? record.summary_json.sensitiveFields
        : [],
      approvalRequired: Boolean(record.approval_required),
      approvalStatus: record.approval_status || "",
      approvalReviewedBy: record.approval_reviewed_by || "",
      approvalRequestId: record.approval_request_id || "",
      deliveryRequested: Boolean(record.delivery_requested),
      deliveryChannel: record.delivery_channel || lifecycleExportDelivery.DELIVERY_CHANNEL.NONE,
      deliveryStatus: record.delivery_status || lifecycleExportDelivery.DELIVERY_STATUS.NOT_REQUESTED,
      deliveryExternalRef: record.delivery_external_ref || "",
      deliveryRequestId: record.delivery_request_id || "",
      deliveryAttemptCount: record.delivery_attempt_count || 0,
      deliveryNextRetryAt: record.delivery_next_retry_at || "",
      deliveryDeadLetterReason: record.delivery_dead_letter_reason || "",
    },
  });
}

function runLifecycleUserExport(data, body = {}, context = {}) {
  const options = normalizeOptions(body, context);
  const plan = planLifecycleUserExport(data, { ...body, dryRun: options.dryRun }, context);
  if (options.dryRun) {
    return {
      ...plan,
      executed: false,
      prunedExpiredCount: 0,
      exportRecord: null,
    };
  }
  requireExecuteRequestId(options);
  const prunedExpiredCount = pruneExpiredExports(data, options.now);
  const workbench = adminLifecyclePresenter.buildLifecycleWorkbench(data, options.filters);
  const csvText = adminLifecyclePresenter.buildLifecycleUsersCsv(data, options.filters, {
    exportPolicy: options.exportPolicy,
  });
  const record = {
    export_id: createId("lue"),
    source: "LIFECYCLE_USERS",
    status: "COMPLETED",
    request_id: options.requestId,
    operator_id: options.operatorId,
    reason: options.reason,
    filters_json: workbench.filters,
    summary_json: buildSummary(workbench, csvText, options),
    filename: filenameFor(options.now),
    content_type: "text/csv; charset=utf-8",
    csv_text: csvText,
    download_count: 0,
    approval_required: options.approvalRequired,
    approval_status: options.approvalStatus,
    approval_reason: options.approvalRequired ? options.approvalReason : "",
    approval_requested_at: options.approvalRequired ? options.now : "",
    approval_reviewed_by: "",
    approval_reviewed_at: "",
    approval_note: "",
    approval_request_id: "",
    created_at: options.now,
    expires_at: expiresAt(options.now, options.retentionDays),
    last_downloaded_at: "",
  };
  Object.assign(record, lifecycleExportDelivery.initialDeliveryState(options.deliveryOptions, record));
  ensureList(data, "adminLifecycleUserExports").unshift(record);
  const payload = toExportPayload(record);
  const audit = appendExportAudit(data, record, "ADMIN_LIFECYCLE_USER_EXPORT_RUN", null, payload);
  return {
    dryRun: false,
    executed: true,
    prunedExpiredCount,
    filters: workbench.filters,
    summary: record.summary_json,
    filename: record.filename,
    expiresAt: record.expires_at,
    exportRecord: payload,
    auditId: audit.audit_log_id || "",
  };
}

function ensureDownloadApproved(record) {
  const approvalRequired = Boolean(record.approval_required);
  if (!approvalRequired) return;
  if (record.approval_status === APPROVAL_STATUS.APPROVED) return;
  throw businessError(8033, record.approval_status === APPROVAL_STATUS.REJECTED
    ? "用户生命周期导出下载审批已拒绝"
    : "用户生命周期导出下载需要审批通过", 403);
}

function listLifecycleUserExports(data, query = {}, context = {}) {
  const nowText = text(query.now) || nowISO();
  pruneExpiredExports(data, nowText);
  const limit = clampNumber(query.limit, 20, 1, 100);
  const status = text(query.status).toUpperCase();
  const operatorId = text(query.operatorId || query.operator_id);
  return ensureList(data, "adminLifecycleUserExports")
    .filter((record) => !isExpired(record, nowText))
    .filter((record) => !status || record.status === status)
    .filter((record) => !operatorId || record.operator_id === operatorId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, limit)
    .map((record) => toExportPayload(record, { context }));
}

function downloadLifecycleUserExport(data, exportId, options = {}) {
  const nowText = text(options.now) || nowISO();
  pruneExpiredExports(data, nowText);
  const record = ensureList(data, "adminLifecycleUserExports").find((item) => item.export_id === exportId);
  if (!record) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  if (isExpired(record, nowText)) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  ensureDownloadApproved(record);
  const before = toExportPayload(record);
  record.download_count = Number(record.download_count || 0) + 1;
  record.last_downloaded_at = nowText;
  const after = toExportPayload(record);
  appendExportAudit(data, record, "ADMIN_LIFECYCLE_USER_EXPORT_DOWNLOAD", before, after);
  return {
    record: after,
    filename: record.filename,
    contentType: record.content_type || "text/csv; charset=utf-8",
    csvText: record.csv_text || "",
  };
}

function signedDownloadError(verification) {
  if (verification.code === "EXPIRED") return businessError(8041, "用户生命周期导出签名链接已过期", 403);
  if (verification.code === "SECRET_MISSING") return businessError(8040, "用户生命周期导出签名下载未配置", 403);
  return businessError(8042, "用户生命周期导出签名链接无效", 403);
}

function downloadLifecycleUserExportBySignature(data, exportId, query = {}, context = {}) {
  const nowText = text(context.now) || nowISO();
  pruneExpiredExports(data, nowText);
  const record = ensureList(data, "adminLifecycleUserExports").find((item) => item.export_id === exportId);
  if (!record) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  if (isExpired(record, nowText)) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  const verification = lifecycleExportDelivery.verifySignedDownload(record, query, { ...context, now: nowText });
  if (!verification.ok) throw signedDownloadError(verification);
  return downloadLifecycleUserExport(data, exportId, {
    ...context,
    now: nowText,
    signedDownload: true,
  });
}

function normalizeApprovalDecision(body = {}) {
  const decision = text(body.decision || body.status || body.approvalStatus || body.approval_status).toUpperCase();
  if (["APPROVE", "APPROVED", "PASS"].includes(decision)) return APPROVAL_STATUS.APPROVED;
  if (["REJECT", "REJECTED", "DENY", "DENIED"].includes(decision)) return APPROVAL_STATUS.REJECTED;
  throw businessError(8034, "请选择导出下载审批结果", 400);
}

function reviewLifecycleUserExportApproval(data, body = {}, context = {}) {
  const exportId = text(body.exportId || body.export_id);
  if (!exportId) throw businessError(8035, "请选择用户生命周期导出记录", 400);
  const nowText = text(body.now) || nowISO();
  pruneExpiredExports(data, nowText);
  const record = ensureList(data, "adminLifecycleUserExports").find((item) => item.export_id === exportId);
  if (!record) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  if (isExpired(record, nowText)) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  if (!record.approval_required) throw businessError(8036, "该用户生命周期导出记录不需要审批", 400);
  const decision = normalizeApprovalDecision(body);
  const before = toExportPayload(record);
  record.approval_status = decision;
  record.approval_reviewed_by = text(body.operatorId || body.operator_id || context.operatorId || context.operator_id);
  record.approval_reviewed_at = nowText;
  record.approval_note = text(body.note || body.approvalNote || body.approval_note || body.reason);
  record.approval_request_id = text(body.requestId || body.request_id || context.requestId || context.request_id);
  lifecycleExportDelivery.applyApprovalDecision(record, decision);
  const after = toExportPayload(record);
  const audit = appendExportAudit(data, record, "ADMIN_LIFECYCLE_USER_EXPORT_APPROVAL", before, after);
  return {
    approved: decision === APPROVAL_STATUS.APPROVED,
    rejected: decision === APPROVAL_STATUS.REJECTED,
    exportRecord: after,
    auditId: audit.audit_log_id || "",
  };
}

function ensureDeliveryApproved(record) {
  if (!record.approval_required) return;
  if (record.approval_status === APPROVAL_STATUS.APPROVED) return;
  throw businessError(8037, record.approval_status === APPROVAL_STATUS.REJECTED
    ? "用户生命周期导出审批已拒绝，不能外部交付"
    : "用户生命周期导出需要审批通过后才能外部交付", 403);
}

function normalizeDeliveryRetryPolicy(body = {}, context = {}) {
  return {
    enabled: normalizeBoolean(
      body,
      "deliveryRetryEnabled",
      "delivery_retry_enabled",
      booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_ENABLED"), false),
    ),
    maxAttempts: clampNumber(
      body.deliveryMaxAttempts ||
        body.delivery_max_attempts ||
        envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS"),
      DEFAULT_DELIVERY_MAX_ATTEMPTS,
      1,
      MAX_DELIVERY_MAX_ATTEMPTS,
    ),
    retryDelaySeconds: clampNumber(
      body.deliveryRetryDelaySeconds ||
        body.delivery_retry_delay_seconds ||
        envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS"),
      DEFAULT_DELIVERY_RETRY_DELAY_SECONDS,
      MIN_DELIVERY_RETRY_DELAY_SECONDS,
      MAX_DELIVERY_RETRY_DELAY_SECONDS,
    ),
  };
}

function retryableDeliveryResult(result = {}) {
  if (result.status !== lifecycleExportDelivery.DELIVERY_STATUS.FAILED) return false;
  const error = text(result.error).toLowerCase();
  const target = result.deliveryTarget || {};
  const statusCode = Number(target.webhookStatusCode || 0);
  if (statusCode === 429 || statusCode >= 500) return true;
  if (error.includes("timeout")) return true;
  if (error.startsWith("http 4")) return false;
  if (error.includes("required")) return false;
  if (error.includes("unavailable")) return false;
  return Boolean(error);
}

function applyDeliveryRetryState(record, result, retryPolicy, nowText) {
  record.delivery_max_attempts = retryPolicy.maxAttempts;
  record.delivery_last_attempt_at = nowText;
  if (result.status !== lifecycleExportDelivery.DELIVERY_STATUS.FAILED) {
    record.delivery_next_retry_at = "";
    record.delivery_dead_letter_reason = "";
    return result.status;
  }
  if (!retryPolicy.enabled) {
    record.delivery_next_retry_at = "";
    return result.status;
  }
  const retryable = retryableDeliveryResult(result);
  if (retryable && Number(record.delivery_attempt_count || 0) < retryPolicy.maxAttempts) {
    record.delivery_next_retry_at = addSecondsIso(nowText, retryPolicy.retryDelaySeconds);
    record.delivery_dead_letter_reason = "";
    return lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED;
  }
  record.delivery_next_retry_at = "";
  record.delivery_dead_letter_reason = retryable
    ? `max attempts reached: ${result.error || "delivery failed"}`
    : result.error || "delivery failed";
  return lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER;
}

async function deliverLifecycleUserExport(data, body = {}, context = {}) {
  const exportId = text(body.exportId || body.export_id);
  if (!exportId) throw businessError(8035, "请选择用户生命周期导出记录", 400);
  const requestId = text(body.requestId || body.request_id || context.requestId || context.request_id);
  if (!requestId) throw businessError(8038, "用户生命周期导出外部交付 request_id 必填", 400);
  const nowText = text(body.now) || nowISO();
  pruneExpiredExports(data, nowText);
  const record = ensureList(data, "adminLifecycleUserExports").find((item) => item.export_id === exportId);
  if (!record) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  if (isExpired(record, nowText)) throw businessError(8032, "用户生命周期导出记录不存在或已过期", 404);
  ensureDeliveryApproved(record);
  const before = toExportPayload(record);
  const retryPolicy = normalizeDeliveryRetryPolicy(body, context);
  record.delivery_requested = true;
  record.delivery_channel = lifecycleExportDelivery.resolveDeliveryOptions({ deliveryEnabled: true, ...body }, context).channel;
  record.delivery_status = lifecycleExportDelivery.DELIVERY_STATUS.READY;
  record.delivery_request_id = requestId;
  record.delivery_attempt_count = Number(record.delivery_attempt_count || 0) + 1;
  record.delivery_error = "";
  let result;
  try {
    result = await lifecycleExportDelivery.deliverLifecycleExportRecord(record, body, { ...context, requestId, now: nowText });
  } catch (error) {
    result = {
      status: lifecycleExportDelivery.DELIVERY_STATUS.FAILED,
      externalRef: "",
      error: error && error.message ? error.message : "delivery failed",
      deliveryTarget: record.delivery_target_json || {},
    };
  }
  record.delivery_status = applyDeliveryRetryState(record, result, retryPolicy, nowText);
  record.delivery_external_ref = result.externalRef || "";
  record.delivery_error = result.error || "";
  record.delivery_target_json = result.deliveryTarget || record.delivery_target_json || {};
  record.delivery_delivered_at = result.status === lifecycleExportDelivery.DELIVERY_STATUS.DELIVERED ? nowText : "";
  const after = toExportPayload(record);
  const audit = appendExportAudit(data, record, "ADMIN_LIFECYCLE_USER_EXPORT_DELIVERY", before, after);
  return {
    delivered: result.status === lifecycleExportDelivery.DELIVERY_STATUS.DELIVERED,
    exportRecord: after,
    delivery: after.delivery,
    auditId: audit.audit_log_id || "",
  };
}

function normalizeDeliveryRetryJobOptions(body = {}, context = {}) {
  const dryRun = normalizeBoolean(body, "dryRun", "dry_run", true) && body.execute !== true;
  const retryPolicy = normalizeDeliveryRetryPolicy({
    deliveryRetryEnabled: true,
    ...body,
  }, context);
  return {
    dryRun,
    now: text(body.now) || nowISO(),
    limit: clampNumber(
      body.limit || body.batchSize || body.batch_size || envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE"),
      DEFAULT_DELIVERY_RETRY_LIMIT,
      1,
      MAX_DELIVERY_RETRY_LIMIT,
    ),
    retryPolicy,
    requestId: text(body.requestId || body.request_id || context.requestId || context.request_id),
    operatorId: text(body.operatorId || body.operator_id || context.operatorId || context.operator_id),
    reason: text(body.reason, "用户生命周期导出交付到期重试"),
  };
}

function requireDeliveryRetryRequestId(options) {
  if (!options.requestId) throw businessError(8043, "用户生命周期导出交付重试 request_id 必填", 400);
}

function deliveryRetryCandidate(record, options) {
  if (!record || isExpired(record, options.now)) return null;
  if (!record.delivery_requested) return null;
  if (![
    lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED,
    lifecycleExportDelivery.DELIVERY_STATUS.FAILED,
  ].includes(record.delivery_status)) return null;
  const nextRetryAt = text(record.delivery_next_retry_at);
  if (!nextRetryAt) return null;
  if (epochMillis(nextRetryAt, 0) > epochMillis(options.now, Date.now())) return null;
  const attemptCount = Number(record.delivery_attempt_count || 0);
  return {
    exportId: record.export_id,
    filename: record.filename || "",
    channel: record.delivery_channel || lifecycleExportDelivery.DELIVERY_CHANNEL.NONE,
    status: record.delivery_status || "",
    requestId: record.delivery_request_id || "",
    attemptCount,
    maxAttempts: record.delivery_max_attempts || options.retryPolicy.maxAttempts,
    nextRetryAt,
    error: record.delivery_error || "",
    target: record.delivery_target_json || {},
    retryAction: attemptCount >= options.retryPolicy.maxAttempts ? "MARK_DEAD_LETTER" : "RETRY_DELIVERY",
  };
}

function deliveryRetryCandidates(data, options) {
  const all = ensureList(data, "adminLifecycleUserExports")
    .map((record) => ({ record, candidate: deliveryRetryCandidate(record, options) }))
    .filter((item) => item.candidate)
    .sort((left, right) => String(left.record.delivery_next_retry_at || "").localeCompare(String(right.record.delivery_next_retry_at || "")));
  return {
    eligible: all,
    selected: all.slice(0, options.limit),
  };
}

function appendDeliveryRetryAudit(data, options, result) {
  return auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_USER_EXPORT_DELIVERY_RETRY",
    targetType: "ADMIN_LIFECYCLE_USER_EXPORT",
    targetId: "LIFECYCLE_USER_EXPORT_DELIVERY_RETRY",
    operatorId: options.operatorId,
    reason: options.reason,
    before: null,
    after: {
      executedCount: result.executedCount,
      deliveredCount: result.deliveredCount,
      rescheduledCount: result.rescheduledCount,
      deadLetterCount: result.deadLetterCount,
      failedCount: result.failedCount,
    },
    metadata: {
      requestId: options.requestId,
      now: options.now,
      selectedCount: result.selectedCount,
      eligibleCount: result.eligibleCount,
      maxAttempts: options.retryPolicy.maxAttempts,
      retryDelaySeconds: options.retryPolicy.retryDelaySeconds,
      exportIds: result.results.map((item) => item.exportId),
    },
  });
}

async function runDueLifecycleExportDeliveries(data, body = {}, context = {}) {
  const options = normalizeDeliveryRetryJobOptions(body, context);
  const planned = deliveryRetryCandidates(data, options);
  const candidates = planned.selected.map((item) => item.candidate);
  const baseResult = {
    dryRun: options.dryRun,
    executed: false,
    now: options.now,
    limit: options.limit,
    maxAttempts: options.retryPolicy.maxAttempts,
    retryDelaySeconds: options.retryPolicy.retryDelaySeconds,
    eligibleCount: planned.eligible.length,
    selectedCount: planned.selected.length,
    pendingCount: Math.max(0, planned.eligible.length - planned.selected.length),
    executedCount: 0,
    deliveredCount: 0,
    rescheduledCount: 0,
    deadLetterCount: 0,
    failedCount: 0,
    candidates,
    results: [],
    auditId: "",
  };
  if (options.dryRun) return baseResult;
  requireDeliveryRetryRequestId(options);
  for (const item of planned.selected) {
    const attemptCount = Number(item.record.delivery_attempt_count || 0);
    if (attemptCount >= options.retryPolicy.maxAttempts) {
      item.record.delivery_status = lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER;
      item.record.delivery_next_retry_at = "";
      item.record.delivery_dead_letter_reason = `max attempts reached: ${item.record.delivery_error || "delivery failed"}`;
      baseResult.deadLetterCount += 1;
      baseResult.results.push({
        exportId: item.record.export_id,
        status: item.record.delivery_status,
        delivered: false,
        attemptCount,
        nextRetryAt: "",
        error: item.record.delivery_error || "",
        action: "MARK_DEAD_LETTER",
      });
      continue;
    }
    const retryRequestId = `${options.requestId}:${item.record.export_id}:${attemptCount + 1}`;
    const deliveryResult = await deliverLifecycleUserExport(data, {
      ...body,
      exportId: item.record.export_id,
      deliveryEnabled: true,
      deliveryChannel: item.record.delivery_channel,
      deliveryRetryEnabled: true,
      deliveryMaxAttempts: options.retryPolicy.maxAttempts,
      deliveryRetryDelaySeconds: options.retryPolicy.retryDelaySeconds,
      requestId: retryRequestId,
      operatorId: options.operatorId,
      reason: options.reason,
      now: options.now,
    }, context);
    baseResult.executedCount += 1;
    if (deliveryResult.delivery.status === lifecycleExportDelivery.DELIVERY_STATUS.DELIVERED) baseResult.deliveredCount += 1;
    else if (deliveryResult.delivery.status === lifecycleExportDelivery.DELIVERY_STATUS.RETRY_SCHEDULED) baseResult.rescheduledCount += 1;
    else if (deliveryResult.delivery.status === lifecycleExportDelivery.DELIVERY_STATUS.DEAD_LETTER) baseResult.deadLetterCount += 1;
    else baseResult.failedCount += 1;
    baseResult.results.push({
      exportId: item.record.export_id,
      status: deliveryResult.delivery.status,
      delivered: deliveryResult.delivered,
      attemptCount: deliveryResult.delivery.attemptCount,
      nextRetryAt: deliveryResult.delivery.nextRetryAt,
      deadLetterReason: deliveryResult.delivery.deadLetterReason,
      externalRef: deliveryResult.delivery.externalRef,
      error: deliveryResult.delivery.error,
      action: "RETRY_DELIVERY",
    });
  }
  baseResult.executed = true;
  const audit = appendDeliveryRetryAudit(data, options, baseResult);
  baseResult.auditId = audit.audit_log_id || "";
  return baseResult;
}

function normalizeCleanupOptions(body = {}, context = {}) {
  const dryRun = normalizeBoolean(body, "dryRun", "dry_run", true) && body.execute !== true;
  return {
    dryRun,
    now: text(body.now) || nowISO(),
    limit: clampNumber(
      body.limit || body.cleanupLimit || body.cleanup_limit || envValue(context, "ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT"),
      DEFAULT_CLEANUP_LIMIT,
      1,
      MAX_CLEANUP_LIMIT,
    ),
    objectCleanup: normalizeBoolean(
      body,
      "objectCleanup",
      "object_cleanup",
      booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED"), true),
    ),
    requestId: text(body.requestId || body.request_id || context.requestId || context.request_id),
    operatorId: text(body.operatorId || body.operator_id || context.operatorId || context.operator_id),
    reason: text(body.reason, "用户生命周期导出过期清理"),
  };
}

function cleanupCandidate(record, nowText) {
  if (!isExpired(record, nowText)) return null;
  const summary = record.summary_json || {};
  const objectKey = objectKeyForExport(record);
  return {
    exportId: record.export_id,
    filename: record.filename || "",
    createdAt: record.created_at || "",
    expiresAt: record.expires_at || "",
    operatorId: record.operator_id || "",
    requestId: record.request_id || "",
    summary: {
      exportedCount: summary.exportedCount || 0,
      bytes: summary.bytes || 0,
      sensitivity: summary.sensitivity || "UNKNOWN",
    },
    delivery: {
      channel: record.delivery_channel || lifecycleExportDelivery.DELIVERY_CHANNEL.NONE,
      status: record.delivery_status || lifecycleExportDelivery.DELIVERY_STATUS.NOT_REQUESTED,
      objectKey,
      externalRef: record.delivery_external_ref || "",
    },
    cleanupAction: objectKey ? "DELETE_OBJECT_AND_RECORD" : "DELETE_RECORD",
    cleanupReason: objectKey ? "导出已过期，需清理对象文件和后台记录" : "导出已过期，仅清理后台记录",
  };
}

function cleanupCandidates(data, options) {
  const all = ensureList(data, "adminLifecycleUserExports")
    .map((record) => ({ record, candidate: cleanupCandidate(record, options.now) }))
    .filter((item) => item.candidate)
    .sort((left, right) => String(left.record.expires_at || "").localeCompare(String(right.record.expires_at || "")));
  return {
    eligible: all,
    selected: all.slice(0, options.limit),
  };
}

function appendCleanupAudit(data, options, result) {
  return auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_USER_EXPORT_CLEANUP",
    targetType: "ADMIN_LIFECYCLE_USER_EXPORT",
    targetId: "LIFECYCLE_USER_EXPORT_CLEANUP",
    operatorId: options.operatorId,
    reason: options.reason,
    before: null,
    after: {
      removedCount: result.removedCount,
      objectDeletedCount: result.objectDeletedCount,
      objectSkippedCount: result.objectSkippedCount,
      objectFailedCount: result.objectFailedCount,
    },
    metadata: {
      requestId: options.requestId,
      now: options.now,
      selectedCount: result.selectedCount,
      eligibleCount: result.eligibleCount,
      objectCleanup: options.objectCleanup,
      removedExportIds: result.results
        .filter((item) => item.ok)
        .map((item) => item.exportId),
      failedExportIds: result.results
        .filter((item) => !item.ok)
        .map((item) => item.exportId),
    },
  });
}

async function cleanupLifecycleUserExports(data, body = {}, context = {}) {
  const options = normalizeCleanupOptions(body, context);
  const planned = cleanupCandidates(data, options);
  const candidates = planned.selected.map((item) => item.candidate);
  const baseResult = {
    dryRun: options.dryRun,
    executed: false,
    now: options.now,
    limit: options.limit,
    objectCleanup: options.objectCleanup,
    eligibleCount: planned.eligible.length,
    selectedCount: planned.selected.length,
    pendingCount: Math.max(0, planned.eligible.length - planned.selected.length),
    removedCount: 0,
    objectDeletedCount: 0,
    objectSkippedCount: 0,
    objectFailedCount: 0,
    candidates,
    results: [],
    auditId: "",
  };
  if (options.dryRun) return baseResult;
  requireCleanupRequestId(options);
  const removeIds = new Set();
  for (const item of planned.selected) {
    const objectKey = item.candidate.delivery.objectKey;
    let objectResult = {
      status: "SKIPPED",
      objectKey,
      externalRef: item.candidate.delivery.externalRef,
      error: objectKey ? "object cleanup disabled" : "",
      adapter: "",
      deleted: false,
    };
    let ok = true;
    let cleanupStatus = "REMOVED";
    if (objectKey) {
      if (!options.objectCleanup) {
        ok = false;
        cleanupStatus = "SKIPPED";
        baseResult.objectSkippedCount += 1;
      } else {
        objectResult = await lifecycleExportDelivery.deleteLifecycleExportObject(item.record, body, {
          ...context,
          requestId: options.requestId,
          now: options.now,
        });
        if (objectResult.status === "FAILED") {
          ok = false;
          cleanupStatus = "FAILED";
          baseResult.objectFailedCount += 1;
        } else if (objectResult.status === "SKIPPED") {
          ok = false;
          cleanupStatus = "SKIPPED";
          baseResult.objectSkippedCount += 1;
        } else {
          baseResult.objectDeletedCount += 1;
        }
      }
    }
    if (ok) {
      removeIds.add(item.record.export_id);
      baseResult.removedCount += 1;
    }
    baseResult.results.push({
      ok,
      exportId: item.record.export_id,
      filename: item.record.filename || "",
      cleanupStatus,
      cleanupAction: item.candidate.cleanupAction,
      object: objectResult,
      error_message: ok ? "" : objectResult.error || "object cleanup skipped",
    });
  }
  if (removeIds.size) {
    data.adminLifecycleUserExports = ensureList(data, "adminLifecycleUserExports")
      .filter((record) => !removeIds.has(record.export_id));
  }
  baseResult.executed = true;
  const audit = appendCleanupAudit(data, options, baseResult);
  baseResult.auditId = audit.audit_log_id || "";
  return baseResult;
}

module.exports = {
  APPROVAL_STATUS,
  cleanupLifecycleUserExports,
  deliverLifecycleUserExport,
  getLifecycleExportDeliveryHealth,
  listLifecycleUserExports,
  planLifecycleUserExport,
  runDueLifecycleExportDeliveries,
  runLifecycleUserExport,
  downloadLifecycleUserExport,
  downloadLifecycleUserExportBySignature,
  reviewLifecycleUserExportApproval,
  pruneExpiredExports,
  toExportPayload,
};
