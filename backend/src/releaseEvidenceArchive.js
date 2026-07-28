const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureArchives(data) {
  if (!Array.isArray(data.releaseEvidenceArchives)) data.releaseEvidenceArchives = [];
  return data.releaseEvidenceArchives;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function archiveSummary(record) {
  return {
    archiveId: record.archive_id,
    target: record.target,
    status: record.status,
    baseUrl: record.base_url,
    operatorId: record.operator_id,
    requestId: record.request_id,
    note: record.note,
    generatedAt: record.generated_at,
    archivedAt: record.archived_at,
    summary: record.summary || {},
    validation: record.validation || {},
  };
}

function listReleaseEvidenceArchives(data, query = {}) {
  const target = text(query.target);
  const limit = Math.max(1, Math.min(Number(query.limit || 20), 100));
  return ensureArchives(data)
    .filter((record) => !target || record.target === target)
    .slice(0, limit)
    .map(archiveSummary);
}

function getReleaseEvidenceArchive(data, archiveId) {
  const id = text(archiveId);
  return ensureArchives(data).find((record) => record.archive_id === id) || null;
}

function saveReleaseEvidenceArchive(data, input = {}) {
  const pack = input.pack || {};
  const validation = input.validation || {};
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("release evidence archive request_id 必填"), { code: 400 });
  const existing = ensureArchives(data).find((record) => record.request_id === requestId);
  if (existing) {
    return { archive: archiveSummary(existing), audit: null, idempotent: true };
  }
  const record = {
    archive_id: createId("rel_evd"),
    target: text(pack.target || input.target, "production"),
    status: text(pack.status, "UNKNOWN"),
    base_url: text(pack.baseUrl || input.baseUrl),
    operator_id: text(input.operatorId || input.operator_id, "system"),
    request_id: requestId,
    note: text(input.note),
    generated_at: text(pack.generatedAt),
    archived_at: nowISO(),
    summary: pack.summary || {},
    validation,
    pack,
  };
  ensureArchives(data).unshift(record);
  data.releaseEvidenceArchives = ensureArchives(data).slice(0, 200);
  const audit = auditLog.appendAuditLog(data, {
    action: "RELEASE_EVIDENCE_ARCHIVE_CREATE",
    targetType: "RELEASE_EVIDENCE_ARCHIVE",
    targetId: record.archive_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: archiveSummary(record),
    metadata: {
      requestId,
      target: record.target,
      status: record.status,
      blockerCount: record.summary.blockerCount || 0,
      warningCount: record.summary.warningCount || 0,
    },
  });
  return { archive: archiveSummary(record), audit };
}

module.exports = {
  archiveSummary,
  getReleaseEvidenceArchive,
  listReleaseEvidenceArchives,
  saveReleaseEvidenceArchive,
};
