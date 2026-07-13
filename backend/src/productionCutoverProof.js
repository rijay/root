const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");
const { CUTOVER_ITEMS } = require("./productionCutoverReadiness");

const ITEM_BY_ID = CUTOVER_ITEMS.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

function ensureProductionCutoverProofs(data) {
  if (!Array.isArray(data.productionCutoverProofs)) data.productionCutoverProofs = [];
  return data.productionCutoverProofs;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(value) {
  return value === "gray" ? "gray" : "production";
}

function normalizeStatus(value) {
  const status = text(value).toUpperCase();
  if (["VERIFIED", "REJECTED"].includes(status)) return status;
  return "";
}

function redact(value) {
  return text(value)
    .replace(/(token|secret|password|access_token|key)=([^&\s]+)/gi, "$1=***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***");
}

function sanitizeEvidenceRef(value) {
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

function proofSummary(record) {
  return {
    proofId: record.proof_id,
    target: record.target,
    itemId: record.item_id,
    itemLabel: record.item_label,
    status: record.status,
    proofScope: record.proof_scope || "ENVIRONMENT",
    releaseVersion: record.release_version || "",
    releaseId: record.release_id || "",
    releaseIdConfigured: record.release_id_configured === true,
    operatorId: record.operator_id,
    evidenceRef: record.evidence_ref,
    requestId: record.request_id,
    note: record.note,
    recordedAt: record.recorded_at,
  };
}

function listProductionCutoverProofs(data, query = {}) {
  const target = text(query.target);
  const itemId = text(query.itemId || query.item_id);
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureProductionCutoverProofs(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !itemId || record.item_id === itemId)
    .slice(0, limit)
    .map(proofSummary);
}

function latestProductionCutoverProofs(data, query = {}) {
  const target = normalizeTarget(query.target);
  const rows = ensureProductionCutoverProofs(data).filter((record) => record.target === target);
  return CUTOVER_ITEMS.map((item) => {
    const record = rows.find((entry) => entry.item_id === item.id);
    return record ? proofSummary(record) : {
      proofId: "",
      target,
      itemId: item.id,
      itemLabel: item.label,
      status: "PENDING",
      proofScope: item.proofScope || "ENVIRONMENT",
      releaseVersion: "",
      releaseId: "",
      releaseIdConfigured: false,
      operatorId: "",
      evidenceRef: "",
      requestId: "",
      note: item.action,
      recordedAt: "",
    };
  });
}

function createProductionCutoverProof(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("production cutover proof request_id 必填"), { code: 400 });
  const existing = ensureProductionCutoverProofs(data).find((record) => record.request_id === requestId);
  if (existing) return { proof: proofSummary(existing), audit: null, idempotent: true };

  const itemId = text(input.itemId || input.item_id);
  const item = ITEM_BY_ID[itemId];
  if (!item) throw Object.assign(new Error("生产切换证明项不存在"), { code: 400 });
  const status = normalizeStatus(input.status);
  if (!status) throw Object.assign(new Error("生产切换证明状态只能是 VERIFIED 或 REJECTED"), { code: 400 });
  const target = normalizeTarget(input.target);
  const proofScope = item.proofScope || "ENVIRONMENT";
  const releaseVersion = text(input.releaseVersion || input.release_version);
  const releaseId = text(input.releaseId || input.release_id);
  const releaseIdConfigured = input.releaseIdConfigured === true || input.release_id_configured === true;
  const evidenceRef = sanitizeEvidenceRef(input.evidenceRef || input.evidence_ref);
  const note = redact(input.note);
  if (status === "VERIFIED" && !evidenceRef) {
    throw Object.assign(new Error("VERIFIED 生产切换证明必须提供 evidence_ref"), { code: 400 });
  }
  if (status === "REJECTED" && !evidenceRef && !note) {
    throw Object.assign(new Error("REJECTED 生产切换证明必须提供 evidence_ref 或备注"), { code: 400 });
  }
  if (target === "production" && proofScope === "RELEASE" && status === "VERIFIED" && (!releaseVersion || !releaseId || !releaseIdConfigured)) {
    throw Object.assign(new Error("发布级 VERIFIED 生产切换证明必须由服务端绑定 release_version 与显式 ROOT_RELEASE_ID"), { code: 400 });
  }

  const record = {
    proof_id: createId("cutover"),
    target,
    item_id: item.id,
    item_label: item.label,
    status,
    proof_scope: proofScope,
    release_version: releaseVersion,
    release_id: releaseId,
    release_id_configured: releaseIdConfigured,
    operator_id: text(input.operatorId || input.operator_id, "system"),
    evidence_ref: evidenceRef,
    request_id: requestId,
    note,
    recorded_at: nowISO(),
  };
  ensureProductionCutoverProofs(data).unshift(record);
  data.productionCutoverProofs = ensureProductionCutoverProofs(data).slice(0, 500);
  const audit = auditLog.appendAuditLog(data, {
    action: "PRODUCTION_CUTOVER_PROOF_RECORD",
    targetType: "PRODUCTION_CUTOVER_PROOF",
    targetId: record.proof_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: proofSummary(record),
    metadata: {
      requestId,
      target: record.target,
      itemId: record.item_id,
      status: record.status,
      proofScope: record.proof_scope,
      releaseVersion: record.release_version,
      releaseId: record.release_id,
      releaseIdConfigured: record.release_id_configured,
    },
  });
  return { proof: proofSummary(record), audit };
}

module.exports = {
  createProductionCutoverProof,
  ensureProductionCutoverProofs,
  latestProductionCutoverProofs,
  listProductionCutoverProofs,
  proofSummary,
};
