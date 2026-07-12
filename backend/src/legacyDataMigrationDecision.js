const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const POLICIES = [
  {
    id: "NO_LEGACY_DATA",
    label: "无旧数据，无需补迁",
    requiresSnapshot: false,
    requiresDryRun: false,
  },
  {
    id: "READ_ONLY_ARCHIVE",
    label: "只读归档",
    requiresSnapshot: true,
    requiresDryRun: false,
  },
  {
    id: "SELECTIVE_BACKFILL",
    label: "选择性补迁",
    requiresSnapshot: true,
    requiresDryRun: true,
  },
  {
    id: "MANUAL_REVIEW",
    label: "人工处理",
    requiresSnapshot: true,
    requiresDryRun: false,
  },
];

const POLICY_BY_ID = POLICIES.reduce((acc, policy) => {
  acc[policy.id] = policy;
  return acc;
}, {});

function ensureLegacyDataMigrationDecisions(data) {
  if (!Array.isArray(data.legacyDataMigrationDecisions)) data.legacyDataMigrationDecisions = [];
  return data.legacyDataMigrationDecisions;
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
    policy: record.policy,
    policyLabel: record.policy_label,
    status: record.status,
    snapshotRef: record.snapshot_ref,
    dryRunRef: record.dry_run_ref,
    evidenceRef: record.evidence_ref,
    operatorId: record.operator_id,
    requestId: record.request_id,
    note: record.note,
    decidedAt: record.decided_at,
  };
}

function listLegacyDataMigrationDecisions(data, query = {}) {
  const target = text(query.target);
  const policy = text(query.policy).toUpperCase();
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureLegacyDataMigrationDecisions(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !policy || record.policy === policy)
    .slice(0, limit)
    .map(decisionSummary);
}

function latestLegacyDataMigrationDecisions(data, query = {}) {
  const target = normalizeTarget(query.target);
  const rows = ensureLegacyDataMigrationDecisions(data).filter((record) => record.target === target);
  return rows.length ? [decisionSummary(rows[0])] : [];
}

function createLegacyDataMigrationDecision(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("旧数据迁移决策 request_id 必填"), { code: 400 });
  const existing = ensureLegacyDataMigrationDecisions(data).find((record) => record.request_id === requestId);
  if (existing) return { decision: decisionSummary(existing), audit: null, idempotent: true };

  const policyId = text(input.policy).toUpperCase();
  const policy = POLICY_BY_ID[policyId];
  if (!policy) throw Object.assign(new Error("旧数据迁移决策 policy 不存在"), { code: 400 });
  const status = normalizeStatus(input.status);
  if (!status) throw Object.assign(new Error("旧数据迁移决策状态只能是 APPROVED 或 REJECTED"), { code: 400 });

  const snapshotRef = sanitizeRef(input.snapshotRef || input.snapshot_ref);
  const dryRunRef = sanitizeRef(input.dryRunRef || input.dry_run_ref);
  const evidenceRef = sanitizeRef(input.evidenceRef || input.evidence_ref);
  if (status === "APPROVED" && !evidenceRef) {
    throw Object.assign(new Error("APPROVED 旧数据迁移决策必须填写证据引用"), { code: 400 });
  }
  if (status === "APPROVED" && policy.requiresSnapshot && !snapshotRef) {
    throw Object.assign(new Error("该旧数据迁移决策必须填写生产快照引用"), { code: 400 });
  }
  if (status === "APPROVED" && policy.requiresDryRun && !dryRunRef) {
    throw Object.assign(new Error("选择性补迁必须填写 dry-run 引用"), { code: 400 });
  }

  const record = {
    decision_id: createId("legacy_mig"),
    target: normalizeTarget(input.target),
    policy: policy.id,
    policy_label: policy.label,
    status,
    snapshot_ref: snapshotRef,
    dry_run_ref: dryRunRef,
    evidence_ref: evidenceRef,
    operator_id: text(input.operatorId || input.operator_id, "system"),
    request_id: requestId,
    note: redact(input.note),
    decided_at: nowISO(),
  };
  ensureLegacyDataMigrationDecisions(data).unshift(record);
  data.legacyDataMigrationDecisions = ensureLegacyDataMigrationDecisions(data).slice(0, 500);
  const audit = auditLog.appendAuditLog(data, {
    action: "LEGACY_DATA_MIGRATION_DECISION_RECORD",
    targetType: "LEGACY_DATA_MIGRATION_DECISION",
    targetId: record.decision_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: decisionSummary(record),
    metadata: {
      requestId,
      target: record.target,
      policy: record.policy,
      status: record.status,
    },
  });
  return { decision: decisionSummary(record), audit };
}

module.exports = {
  POLICIES,
  createLegacyDataMigrationDecision,
  ensureLegacyDataMigrationDecisions,
  latestLegacyDataMigrationDecisions,
  listLegacyDataMigrationDecisions,
  decisionSummary,
};
