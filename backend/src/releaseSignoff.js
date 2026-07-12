const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const RELEASE_SIGNOFF_ROLES = [
  { role: "PRODUCT", label: "产品", note: "确认流程和风险提示" },
  { role: "OPERATIONS", label: "运营", note: "确认企业微信触达、免单和样本导入" },
  { role: "ENGINEERING", label: "研发", note: "确认 production-env 矩阵、数据仓库 Adapter、CloudBase Job 和回滚路径" },
];

const ROLE_ALIASES = RELEASE_SIGNOFF_ROLES.reduce((acc, item) => {
  acc[item.role] = item;
  acc[item.label] = item;
  return acc;
}, {});

function ensureReleaseSignoffs(data) {
  if (!Array.isArray(data.releaseSignoffs)) data.releaseSignoffs = [];
  return data.releaseSignoffs;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeRole(value) {
  const key = text(value).toUpperCase();
  return ROLE_ALIASES[key] || ROLE_ALIASES[text(value)] || null;
}

function normalizeStatus(value) {
  const status = text(value).toUpperCase();
  if (["APPROVED", "REJECTED"].includes(status)) return status;
  return "";
}

function signoffSummary(record) {
  return {
    signoffId: record.signoff_id,
    target: record.target,
    role: record.role,
    roleLabel: record.role_label,
    status: record.status,
    operatorId: record.operator_id,
    archiveId: record.archive_id,
    requestId: record.request_id,
    note: record.note,
    signedAt: record.signed_at,
  };
}

function listReleaseSignoffs(data, query = {}) {
  const target = text(query.target);
  const archiveId = text(query.archiveId || query.archive_id);
  const limit = Math.max(1, Math.min(Number(query.limit || 50), 200));
  return ensureReleaseSignoffs(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !archiveId || record.archive_id === archiveId)
    .slice(0, limit)
    .map(signoffSummary);
}

function latestReleaseSignoffs(data, query = {}) {
  const target = text(query.target, "production");
  const records = ensureReleaseSignoffs(data).filter((record) => record.target === target);
  return RELEASE_SIGNOFF_ROLES.map((roleConfig) => {
    const record = records.find((item) => item.role === roleConfig.role);
    if (record) return signoffSummary(record);
    return {
      role: roleConfig.role,
      roleLabel: roleConfig.label,
      operatorId: "",
      status: "PENDING",
      note: roleConfig.note,
      archiveId: "",
      requestId: "",
      signedAt: "",
    };
  });
}

function buildReleaseSignoffGate(data, query = {}) {
  const target = text(query.target, "production");
  const signoffs = latestReleaseSignoffs(data, { target });
  const rejected = signoffs.filter((item) => item.status === "REJECTED");
  const pending = signoffs.filter((item) => item.status !== "APPROVED" && item.status !== "REJECTED");
  const approved = signoffs.filter((item) => item.status === "APPROVED");
  const grayTarget = target === "gray";
  const blockers = rejected.map((item) => `发布签字 ${item.roleLabel} 已拒绝，需要重新留档或补充说明后再签字`);
  const warnings = pending.map((item) => `发布签字 ${item.roleLabel} 待完成`);
  const status = blockers.length
    ? "BLOCKED"
    : pending.length
      ? grayTarget ? "NEEDS_REVIEW" : "BLOCKED"
      : "READY";
  return {
    status,
    target,
    requiredRoles: RELEASE_SIGNOFF_ROLES.map((item) => item.role),
    summary: {
      requiredCount: RELEASE_SIGNOFF_ROLES.length,
      approvedCount: approved.length,
      pendingCount: pending.length,
      rejectedCount: rejected.length,
      allApproved: approved.length === RELEASE_SIGNOFF_ROLES.length,
    },
    approvedRoles: approved.map((item) => item.role),
    pendingRoles: pending.map((item) => item.role),
    rejectedRoles: rejected.map((item) => item.role),
    blockers,
    warnings,
    signoffs,
    message: blockers[0] || warnings[0] || "产品、运营、研发签字已完成",
  };
}

function createReleaseSignoff(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("release signoff request_id 必填"), { code: 400 });
  const existing = ensureReleaseSignoffs(data).find((record) => record.request_id === requestId);
  if (existing) return { signoff: signoffSummary(existing), audit: null, idempotent: true };

  const roleConfig = normalizeRole(input.role || input.roleLabel || input.role_label);
  if (!roleConfig) throw Object.assign(new Error("发布签字角色只能是 产品、运营或研发"), { code: 400 });
  const status = normalizeStatus(input.status || input.decision);
  if (!status) throw Object.assign(new Error("发布签字状态只能是 APPROVED 或 REJECTED"), { code: 400 });
  const target = text(input.target, "production");
  const archiveId = text(input.archiveId || input.archive_id);
  if (!archiveId) throw Object.assign(new Error("发布签字必须绑定 archiveId"), { code: 400 });
  const archive = (data.releaseEvidenceArchives || []).find((item) => item.archive_id === archiveId);
  if (!archive) throw Object.assign(new Error("发布签字绑定的证据包留档不存在"), { code: 404, status: 404 });
  if (archive.target !== target) throw Object.assign(new Error("发布签字 target 与证据包留档不一致"), { code: 400 });

  const record = {
    signoff_id: createId("rel_sig"),
    target,
    role: roleConfig.role,
    role_label: roleConfig.label,
    status,
    operator_id: text(input.operatorId || input.operator_id, "system"),
    archive_id: archiveId,
    request_id: requestId,
    note: text(input.note),
    signed_at: nowISO(),
  };
  ensureReleaseSignoffs(data).unshift(record);
  data.releaseSignoffs = ensureReleaseSignoffs(data).slice(0, 300);
  const audit = auditLog.appendAuditLog(data, {
    action: "RELEASE_SIGNOFF_RECORD",
    targetType: "RELEASE_SIGNOFF",
    targetId: record.signoff_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: signoffSummary(record),
    metadata: {
      requestId,
      target: record.target,
      role: record.role,
      status: record.status,
      archiveId: record.archive_id,
    },
  });
  return { signoff: signoffSummary(record), audit };
}

module.exports = {
  RELEASE_SIGNOFF_ROLES,
  buildReleaseSignoffGate,
  createReleaseSignoff,
  latestReleaseSignoffs,
  listReleaseSignoffs,
  signoffSummary,
};
