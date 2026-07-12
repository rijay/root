const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const legacyDataMigrationDecision = require("./legacyDataMigrationDecision");
const { createId } = require("./seed");

const ACTIONS = [
  {
    id: "NO_OP_CONFIRMED",
    label: "无旧数据确认",
    policy: "NO_LEGACY_DATA",
    requiresSnapshot: false,
    requiresDryRun: false,
    requiresExecutionRef: false,
  },
  {
    id: "ARCHIVE_CONFIRMED",
    label: "只读归档完成",
    policy: "READ_ONLY_ARCHIVE",
    requiresSnapshot: true,
    requiresDryRun: false,
    requiresExecutionRef: false,
  },
  {
    id: "BACKFILL_EXECUTED",
    label: "选择性补迁完成",
    policy: "SELECTIVE_BACKFILL",
    requiresSnapshot: true,
    requiresDryRun: true,
    requiresExecutionRef: true,
  },
  {
    id: "MANUAL_REVIEW_CONFIRMED",
    label: "人工处理完成",
    policy: "MANUAL_REVIEW",
    requiresSnapshot: true,
    requiresDryRun: false,
    requiresExecutionRef: false,
  },
];

const ACTION_BY_ID = ACTIONS.reduce((acc, action) => {
  acc[action.id] = action;
  return acc;
}, {});

const ACTION_ID_BY_POLICY = ACTIONS.reduce((acc, action) => {
  acc[action.policy] = action.id;
  return acc;
}, {});

function ensureLegacyDataMigrationExecutions(data) {
  if (!Array.isArray(data.legacyDataMigrationExecutions)) data.legacyDataMigrationExecutions = [];
  return data.legacyDataMigrationExecutions;
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
  if (["VERIFIED", "FAILED"].includes(status)) return status;
  return "";
}

function numberValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
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

function executionSummary(record) {
  return {
    executionId: record.execution_id,
    target: record.target,
    decisionId: record.decision_id,
    policy: record.policy,
    policyLabel: record.policy_label,
    action: record.action,
    actionLabel: record.action_label,
    status: record.status,
    snapshotRef: record.snapshot_ref,
    dryRunRef: record.dry_run_ref,
    executionRef: record.execution_ref,
    evidenceRef: record.evidence_ref,
    affectedSessionCount: record.affected_session_count,
    affectedFactCount: record.affected_fact_count,
    operatorId: record.operator_id,
    requestId: record.request_id,
    note: record.note,
    executedAt: record.executed_at,
  };
}

function listLegacyDataMigrationExecutions(data, query = {}) {
  const target = text(query.target);
  const decisionId = text(query.decisionId || query.decision_id);
  const policy = text(query.policy).toUpperCase();
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureLegacyDataMigrationExecutions(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !decisionId || record.decision_id === decisionId)
    .filter((record) => !policy || record.policy === policy)
    .slice(0, limit)
    .map(executionSummary);
}

function latestLegacyDataMigrationExecutions(data, query = {}) {
  const target = normalizeTarget(query.target);
  const decisionId = text(query.decisionId || query.decision_id);
  const rows = ensureLegacyDataMigrationExecutions(data)
    .filter((record) => record.target === target)
    .filter((record) => !decisionId || record.decision_id === decisionId);
  return rows.length ? [executionSummary(rows[0])] : [];
}

function resolveDecision(data, target, input = {}) {
  const decisionId = text(input.decisionId || input.decision_id);
  if (decisionId) {
    return legacyDataMigrationDecision
      .listLegacyDataMigrationDecisions(data, { target, limit: 300 })
      .find((decision) => decision.decisionId === decisionId) || null;
  }
  return legacyDataMigrationDecision.latestLegacyDataMigrationDecisions(data, { target })[0] || null;
}

function expectedActionForPolicy(policy) {
  return ACTION_ID_BY_POLICY[text(policy).toUpperCase()] || "";
}

function createLegacyDataMigrationExecution(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("旧数据迁移执行历史 request_id 必填"), { code: 400 });
  const existing = ensureLegacyDataMigrationExecutions(data).find((record) => record.request_id === requestId);
  if (existing) return { execution: executionSummary(existing), audit: null, idempotent: true };

  const target = normalizeTarget(input.target);
  const decision = resolveDecision(data, target, input);
  if (!decision) throw Object.assign(new Error("旧数据迁移执行历史必须先绑定生产处置决策"), { code: 400 });
  if (decision.status !== "APPROVED") {
    throw Object.assign(new Error("旧数据迁移执行历史只能绑定 APPROVED 决策"), { code: 400 });
  }

  const actionId = text(input.action).toUpperCase();
  const action = ACTION_BY_ID[actionId];
  if (!action) throw Object.assign(new Error("旧数据迁移执行动作不存在"), { code: 400 });
  if (action.id !== expectedActionForPolicy(decision.policy)) {
    throw Object.assign(new Error(`当前决策 ${decision.policy} 需要执行动作 ${expectedActionForPolicy(decision.policy)}`), { code: 400 });
  }

  const status = normalizeStatus(input.status);
  if (!status) throw Object.assign(new Error("旧数据迁移执行状态只能是 VERIFIED 或 FAILED"), { code: 400 });

  const snapshotRef = sanitizeRef(input.snapshotRef || input.snapshot_ref || decision.snapshotRef);
  const dryRunRef = sanitizeRef(input.dryRunRef || input.dry_run_ref || decision.dryRunRef);
  const executionRef = sanitizeRef(input.executionRef || input.execution_ref);
  const evidenceRef = sanitizeRef(input.evidenceRef || input.evidence_ref);
  if (status === "VERIFIED" && !evidenceRef && !executionRef) {
    throw Object.assign(new Error("VERIFIED 旧数据迁移执行历史必须填写执行或证据引用"), { code: 400 });
  }
  if (status === "VERIFIED" && action.requiresSnapshot && !snapshotRef) {
    throw Object.assign(new Error("该旧数据迁移执行历史必须填写生产快照引用"), { code: 400 });
  }
  if (status === "VERIFIED" && action.requiresDryRun && !dryRunRef) {
    throw Object.assign(new Error("选择性补迁执行历史必须填写 dry-run 引用"), { code: 400 });
  }
  if (status === "VERIFIED" && action.requiresExecutionRef && !executionRef) {
    throw Object.assign(new Error("选择性补迁执行历史必须填写真实执行引用"), { code: 400 });
  }

  const record = {
    execution_id: createId("legacy_exec"),
    target,
    decision_id: decision.decisionId,
    policy: decision.policy,
    policy_label: decision.policyLabel,
    action: action.id,
    action_label: action.label,
    status,
    snapshot_ref: snapshotRef,
    dry_run_ref: dryRunRef,
    execution_ref: executionRef,
    evidence_ref: evidenceRef,
    affected_session_count: numberValue(input.affectedSessionCount || input.affected_session_count),
    affected_fact_count: numberValue(input.affectedFactCount || input.affected_fact_count),
    operator_id: text(input.operatorId || input.operator_id, "system"),
    request_id: requestId,
    note: redact(input.note),
    executed_at: nowISO(),
  };
  ensureLegacyDataMigrationExecutions(data).unshift(record);
  data.legacyDataMigrationExecutions = ensureLegacyDataMigrationExecutions(data).slice(0, 500);
  const audit = auditLog.appendAuditLog(data, {
    action: "LEGACY_DATA_MIGRATION_EXECUTION_RECORD",
    targetType: "LEGACY_DATA_MIGRATION_EXECUTION",
    targetId: record.execution_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: executionSummary(record),
    metadata: {
      requestId,
      target: record.target,
      decisionId: record.decision_id,
      action: record.action,
      status: record.status,
    },
  });
  return { execution: executionSummary(record), audit };
}

module.exports = {
  ACTIONS,
  createLegacyDataMigrationExecution,
  ensureLegacyDataMigrationExecutions,
  expectedActionForPolicy,
  latestLegacyDataMigrationExecutions,
  listLegacyDataMigrationExecutions,
  executionSummary,
};
