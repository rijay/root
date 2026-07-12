const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureAdminLegacyDeprecationDecisions(data) {
  if (!Array.isArray(data.adminLegacyDeprecationDecisions)) data.adminLegacyDeprecationDecisions = [];
  return data.adminLegacyDeprecationDecisions;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(value) {
  return value === "production" ? "production" : "gray";
}

function normalizeStatus(value) {
  const status = text(value).toUpperCase();
  if (["APPROVED", "REJECTED"].includes(status)) return status;
  return "";
}

function redact(value) {
  return text(value)
    .replace(/(token|secret|password|access_token|key|openid|unionid|phone|mobile)=([^&\s]+)/gi, "$1=***")
    .replace(/(openid|unionid|phone|mobile)\s*[:：]\s*([A-Za-z0-9_-]+)/gi, "$1=***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***")
    .replace(/\b1[3-9]\d{9}\b/g, "1**********");
}

function sanitizeRef(value) {
  const raw = redact(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return raw.replace(/\?.*$/, "").replace(/#.*/, "");
  }
}

function decisionSummary(record) {
  return {
    decisionId: record.decision_id,
    target: record.target,
    status: record.status,
    approved: record.status === "APPROVED",
    operatorId: record.operator_id,
    evidenceRef: record.evidence_ref,
    rollbackRef: record.rollback_ref,
    requestId: record.request_id,
    note: record.note,
    decidedAt: record.decided_at,
  };
}

function listAdminLegacyDeprecationDecisions(data, query = {}) {
  const target = text(query.target);
  const status = text(query.status).toUpperCase();
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureAdminLegacyDeprecationDecisions(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !status || record.status === status)
    .slice(0, limit)
    .map(decisionSummary);
}

function latestAdminLegacyDeprecationDecisions(data, query = {}) {
  const target = normalizeTarget(query.target);
  const rows = ensureAdminLegacyDeprecationDecisions(data).filter((record) => record.target === target);
  return rows.length ? [decisionSummary(rows[0])] : [];
}

function createAdminLegacyDeprecationDecision(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("旧静态后台下线决策 request_id 必填"), { code: 400 });
  const existing = ensureAdminLegacyDeprecationDecisions(data).find((record) => record.request_id === requestId);
  if (existing) return { decision: decisionSummary(existing), audit: null, idempotent: true };

  const status = normalizeStatus(input.status);
  if (!status) throw Object.assign(new Error("旧静态后台下线决策状态只能是 APPROVED 或 REJECTED"), { code: 400 });

  const evidenceRef = sanitizeRef(input.evidenceRef || input.evidence_ref);
  const rollbackRef = sanitizeRef(input.rollbackRef || input.rollback_ref);
  if (status === "APPROVED" && !evidenceRef) {
    throw Object.assign(new Error("APPROVED 旧静态后台下线决策必须填写证据引用"), { code: 400 });
  }
  if (status === "APPROVED" && !rollbackRef) {
    throw Object.assign(new Error("APPROVED 旧静态后台下线决策必须填写回滚引用"), { code: 400 });
  }

  const record = {
    decision_id: createId("admin_legacy"),
    target: normalizeTarget(input.target),
    status,
    operator_id: text(input.operatorId || input.operator_id, "system"),
    evidence_ref: evidenceRef,
    rollback_ref: rollbackRef,
    request_id: requestId,
    note: redact(input.note),
    decided_at: nowISO(),
  };
  ensureAdminLegacyDeprecationDecisions(data).unshift(record);
  data.adminLegacyDeprecationDecisions = ensureAdminLegacyDeprecationDecisions(data).slice(0, 500);
  const audit = auditLog.appendAuditLog(data, {
    action: "ADMIN_LEGACY_DEPRECATION_DECISION_RECORD",
    targetType: "ADMIN_LEGACY_DEPRECATION_DECISION",
    targetId: record.decision_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: decisionSummary(record),
    metadata: {
      requestId,
      target: record.target,
      status: record.status,
    },
  });
  return { decision: decisionSummary(record), audit };
}

module.exports = {
  createAdminLegacyDeprecationDecision,
  decisionSummary,
  ensureAdminLegacyDeprecationDecisions,
  latestAdminLegacyDeprecationDecisions,
  listAdminLegacyDeprecationDecisions,
};
