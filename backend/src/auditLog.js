const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureAuditLogs(data) {
  if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
  return data.auditLogs;
}

function appendAuditLog(data, entry = {}) {
  const log = {
    audit_log_id: createId("aud"),
    action: entry.action || "UNKNOWN",
    target_type: entry.targetType || entry.target_type || "",
    target_id: entry.targetId || entry.target_id || "",
    operator_id: entry.operatorId || entry.operator_id || "",
    reason: entry.reason || "",
    before: entry.before || null,
    after: entry.after || null,
    metadata: entry.metadata || {},
    created_at: nowISO(),
  };
  ensureAuditLogs(data).unshift(log);
  data.auditLogs = ensureAuditLogs(data).slice(0, 500);
  return log;
}

const SAFE_SUMMARY_FIELDS = Object.freeze([
  "activityId",
  "activityVersionId",
  "assetId",
  "attemptGeneration",
  "byteSize",
  "enrollmentId",
  "height",
  "logicalId",
  "releaseVersion",
  "revision",
  "sessionId",
  "status",
  "version",
  "versionId",
  "width",
]);

function safeSummary(log) {
  const source = log && log.after && typeof log.after === "object" && !Array.isArray(log.after)
    ? log.after
    : {};
  return Object.fromEntries(SAFE_SUMMARY_FIELDS
    .filter((field) => source[field] !== undefined && source[field] !== null && source[field] !== "")
    .map((field) => [field, source[field]]));
}

function presentAuditLog(log) {
  const metadata = log && log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata
    : {};
  const summary = safeSummary(log);
  const outcomeUnknown = metadata.outcomeUnknown === true;
  const sourceAfter = log && log.after && typeof log.after === "object" && !Array.isArray(log.after)
    ? log.after
    : {};
  const status = String(metadata.status || summary.status || "").toUpperCase();
  const failed = Number(sourceAfter.failedCount || 0) > 0
    || Boolean(sourceAfter.error)
    || ["FAIL", "FAILED", "FAILURE", "ERROR", "PARTIAL_FAILURE"].includes(status);
  return {
    audit_log_id: log.audit_log_id || log.audit_id || "",
    action: log.action || "UNKNOWN",
    target_type: log.target_type || "",
    target_id: log.target_id || "",
    operator_id: log.operator_id || "",
    result: outcomeUnknown ? "UNKNOWN" : (failed ? "FAILURE" : "SUCCESS"),
    outcome_unknown: outcomeUnknown,
    request_id: metadata.requestId || metadata.batchRequestId || "",
    version: summary.version || summary.versionId || summary.releaseVersion || "",
    summary,
    created_at: log.created_at || "",
  };
}

function pagination(query = {}) {
  const page = Number(query.page || 1);
  const requestedPageSize = query.pageSize || query.page_size || query.limit || 20;
  const pageSize = Number(requestedPageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    const error = new Error("审计分页参数无效");
    error.code = "AUDIT_QUERY_INVALID";
    error.status = 400;
    throw error;
  }
  return { page, pageSize };
}

function listAuditLogPage(data, query = {}) {
  const targetType = query.targetType || query.target_type || "";
  const targetId = query.targetId || query.target_id || "";
  const action = query.action || "";
  const operatorId = query.operatorId || query.operator_id || "";
  const date = query.date || "";
  const q = String(query.q || "").trim().toLowerCase();
  const { page, pageSize } = pagination(query);
  const items = ensureAuditLogs(data)
    .map(presentAuditLog)
    .filter((log) => !targetType || log.target_type === targetType)
    .filter((log) => !targetId || log.target_id === targetId)
    .filter((log) => !action || log.action === action)
    .filter((log) => !operatorId || log.operator_id === operatorId)
    .filter((log) => !date || String(log.created_at || "").startsWith(date))
    .filter((log) => {
      if (!q) return true;
      const text = [
        log.action,
        log.target_type,
        log.target_id,
        log.operator_id,
        log.request_id,
        log.version,
        JSON.stringify(log.summary),
      ].join(" ").toLowerCase();
      return text.includes(q);
    });
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
    },
  };
}

function listAuditLogs(data, query = {}) {
  return listAuditLogPage(data, query).items;
}

module.exports = {
  appendAuditLog,
  listAuditLogPage,
  listAuditLogs,
  presentAuditLog,
};
