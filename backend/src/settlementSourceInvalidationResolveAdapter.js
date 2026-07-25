const crypto = require("node:crypto");

const SOURCE_TYPE = "TASK_SOURCE_INVALIDATION";
const RESOLUTIONS = Object.freeze([
  "ACKNOWLEDGED",
  "RECALCULATION_REQUIRED",
  "STOP_CONFIRMED",
]);
const AUDIT_COLUMNS = Object.freeze([
  "settlement_source_resolution_audit_id",
  "manual_review_item_id",
  "root_user_id",
  "campaign_id",
  "request_id",
  "operator_id",
  "resolution",
  "resolution_note",
  "public_note",
  "before_status",
  "after_status",
  "candidate_resolved_at",
  "created_at",
]);

const READ_AUDITS_FOR_UPDATE_SQL = `/* settlement_source_invalidation_resolve:audit_for_update */
SELECT
  settlement_source_resolution_audit_id,
  manual_review_item_id,
  root_user_id,
  campaign_id,
  request_id,
  operator_id,
  resolution,
  resolution_note,
  public_note,
  before_status,
  after_status,
  candidate_resolved_at,
  created_at
FROM settlement_source_resolution_audit
WHERE manual_review_item_id = ? OR request_id = ?
ORDER BY settlement_source_resolution_audit_id
LIMIT 3
FOR UPDATE`;

const RESOLVE_WITHOUT_PUBLIC_NOTE_SQL = `/* settlement_source_invalidation_resolve:candidate */
UPDATE manual_review_item
SET status = 'RESOLVED',
    operator_id = ?,
    resolution = ?,
    metadata = JSON_SET(
      JSON_REMOVE(metadata, '$.publicNote'),
      '$.resolutionNote', ?
    ),
    resolved_at = CURRENT_TIMESTAMP(3),
    updated_at = CURRENT_TIMESTAMP(3)
WHERE manual_review_item_id = ?
  AND root_user_id = ?
  AND campaign_id = ?
  AND source_type = 'TASK_SOURCE_INVALIDATION'
  AND status = 'OPEN'`;

const RESOLVE_WITH_PUBLIC_NOTE_SQL = `/* settlement_source_invalidation_resolve:candidate_public */
UPDATE manual_review_item
SET status = 'RESOLVED',
    operator_id = ?,
    resolution = ?,
    metadata = JSON_SET(
      metadata,
      '$.resolutionNote', ?,
      '$.publicNote', ?
    ),
    resolved_at = CURRENT_TIMESTAMP(3),
    updated_at = CURRENT_TIMESTAMP(3)
WHERE manual_review_item_id = ?
  AND root_user_id = ?
  AND campaign_id = ?
  AND source_type = 'TASK_SOURCE_INVALIDATION'
  AND status = 'OPEN'`;

const INSERT_AUDIT_SQL = `/* settlement_source_invalidation_resolve:audit_insert */
INSERT INTO settlement_source_resolution_audit (
  settlement_source_resolution_audit_id,
  manual_review_item_id,
  root_user_id,
  campaign_id,
  request_id,
  operator_id,
  resolution,
  resolution_note,
  public_note,
  before_status,
  after_status,
  candidate_resolved_at,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'RESOLVED', ?, ?)`;

function resolutionError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength, options = {}) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximumLength
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return options.ascii !== true || /^[\x20-\x7e]+$/.test(value);
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength, { ascii: true })
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function dateInstant(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const mysql = text.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/
  );
  const parsed = Date.parse(mysql
    ? `${mysql[1]}T${mysql[2]}.${String(mysql[3] || "0").padEnd(3, "0")}+08:00`
    : text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameDate(left, right) {
  const leftInstant = dateInstant(left);
  return leftInstant !== null && leftInstant === dateInstant(right);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function auditId(candidateId, requestId) {
  return crypto.createHash("sha256")
    .update("myroot:settlement-source-resolution-audit:v1\0", "utf8")
    .update(candidateId, "utf8")
    .update("\0", "utf8")
    .update(requestId, "utf8")
    .update("\0", "utf8")
    .digest("hex");
}

function normalizeInput(input) {
  const keys = [
    "candidateId",
    "rootUserId",
    "campaignId",
    "requestId",
    "operatorId",
    "resolution",
    "resolutionNote",
    "publicNote",
  ];
  if (!exactKeys(input, keys)
    || !opaqueAscii(input.candidateId, 32)
    || !exactText(input.rootUserId, 32)
    || !exactText(input.campaignId, 64)
    || !opaqueAscii(input.requestId, 128)
    || !exactText(input.operatorId, 64)
    || !RESOLUTIONS.includes(input.resolution)
    || !exactText(input.resolutionNote, 512)
    || !(input.publicNote === null || exactText(input.publicNote, 512))) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_INPUT_INVALID",
      "Settlement source resolution input is invalid",
      400
    );
  }
  return Object.freeze({ ...input });
}

function selectedRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_PERSISTENCE_FAILED",
      "Settlement source resolution persistence is unavailable",
      503
    );
  }
  return result[0];
}

function affectedRows(result) {
  const affected = Number(result && result[0] && result[0].affectedRows);
  if (!Number.isSafeInteger(affected) || affected < 0) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_PERSISTENCE_FAILED",
      "Settlement source resolution persistence is unavailable",
      503
    );
  }
  return affected;
}

async function execute(connection, sql, parameters, options = {}) {
  try {
    return await connection.execute(sql, parameters);
  } catch (error) {
    if (error && String(error.code || "").startsWith("SETTLEMENT_SOURCE_")) {
      throw error;
    }
    if (options.duplicateIsConflict === true
      && error
      && (error.code === "ER_DUP_ENTRY" || error.errno === 1062)) {
      throw resolutionError(
        "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT",
        "Settlement source resolution request conflicts with existing audit authority",
        409
      );
    }
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_PERSISTENCE_FAILED",
      "Settlement source resolution persistence is unavailable",
      503
    );
  }
}

function normalizeAudit(row) {
  if (!exactKeys(row, AUDIT_COLUMNS)
    || !/^[0-9a-f]{64}$/.test(row.settlement_source_resolution_audit_id || "")
    || !exactText(row.manual_review_item_id, 32, { ascii: true })
    || !exactText(row.root_user_id, 32)
    || !exactText(row.campaign_id, 64)
    || !exactText(row.request_id, 128, { ascii: true })
    || !exactText(row.operator_id, 64)
    || !RESOLUTIONS.includes(row.resolution)
    || !exactText(row.resolution_note, 512)
    || !(row.public_note === null || exactText(row.public_note, 512))
    || row.before_status !== "OPEN"
    || row.after_status !== "RESOLVED"
    || dateInstant(row.candidate_resolved_at) === null
    || !sameDate(row.candidate_resolved_at, row.created_at)) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_AUDIT_INVALID",
      "Settlement source resolution audit authority is invalid",
      503
    );
  }
  return clone(row);
}

function assertCandidateResolution(candidate, input) {
  const metadata = candidate && candidate.metadata;
  if (!candidate
    || candidate.source_type !== SOURCE_TYPE
    || candidate.manual_review_item_id !== input.candidateId
    || candidate.root_user_id !== input.rootUserId
    || candidate.campaign_id !== input.campaignId
    || candidate.status !== "RESOLVED"
    || candidate.operator_id !== input.operatorId
    || candidate.resolution !== input.resolution
    || !record(metadata)
    || metadata.resolutionNote !== input.resolutionNote
    || (input.publicNote === null
      ? Object.hasOwn(metadata, "publicNote")
      : metadata.publicNote !== input.publicNote)
    || dateInstant(candidate.resolved_at) === null
    || !sameDate(candidate.resolved_at, candidate.updated_at)) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_STATE_CONFLICT",
      "Settlement source resolution state conflicts with the requested decision",
      409
    );
  }
}

function assertResolutionMatchesCandidate(candidate, input) {
  const stop = candidate.review_type === "SETTLEMENT_STOP_CANDIDATE";
  const recalculation = candidate.review_type === "SETTLEMENT_RECALC_CANDIDATE";
  if ((!stop && !recalculation)
    || (input.resolution === "STOP_CONFIRMED" && !stop)
    || (input.resolution === "RECALCULATION_REQUIRED" && !recalculation)) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_DECISION_INVALID",
      "Settlement source resolution does not match the candidate kind",
      409
    );
  }
}

function assertAuditMatches(audit, input, candidate) {
  if (audit.settlement_source_resolution_audit_id
      !== auditId(input.candidateId, input.requestId)
    || audit.manual_review_item_id !== input.candidateId
    || audit.root_user_id !== input.rootUserId
    || audit.campaign_id !== input.campaignId
    || audit.request_id !== input.requestId
    || audit.operator_id !== input.operatorId
    || audit.resolution !== input.resolution
    || audit.resolution_note !== input.resolutionNote
    || audit.public_note !== input.publicNote
    || !sameDate(audit.candidate_resolved_at, candidate.resolved_at)) {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT",
      "Settlement source resolution request conflicts with existing audit authority",
      409
    );
  }
}

function resolutionPayload(candidate, audit, replayed) {
  return Object.freeze({
    candidate: Object.freeze({
      candidateId: candidate.manual_review_item_id,
      rootUserId: candidate.root_user_id,
      campaignId: candidate.campaign_id,
      reviewType: candidate.review_type,
      status: candidate.status,
      operatorId: candidate.operator_id,
      resolution: candidate.resolution,
      resolutionNote: candidate.metadata.resolutionNote,
      publicNote: Object.hasOwn(candidate.metadata, "publicNote")
        ? candidate.metadata.publicNote
        : null,
      resolvedAt: clone(candidate.resolved_at),
    }),
    audit: Object.freeze({
      auditId: audit.settlement_source_resolution_audit_id,
      requestId: audit.request_id,
      createdAt: clone(audit.created_at),
    }),
    replayed,
  });
}

function createMysqlSettlementSourceInvalidationResolveAdapter(
  connection,
  readAdapter
) {
  if (!connection
    || typeof connection.execute !== "function"
    || !readAdapter
    || typeof readAdapter.readCandidateForUpdate !== "function") {
    throw resolutionError(
      "SETTLEMENT_SOURCE_RESOLUTION_CONFIGURATION_INVALID",
      "Settlement source resolution Interface is unavailable",
      503
    );
  }

  async function readAudits(input) {
    const rows = selectedRows(await execute(
      connection,
      READ_AUDITS_FOR_UPDATE_SQL,
      [input.candidateId, input.requestId]
    ));
    if (rows.length > 2) {
      throw resolutionError(
        "SETTLEMENT_SOURCE_RESOLUTION_AUDIT_INVALID",
        "Settlement source resolution audit authority is invalid",
        503
      );
    }
    return rows.map(normalizeAudit);
  }

  return Object.freeze({
    async resolve(snapshot, inputValue) {
      const input = normalizeInput(inputValue);
      let candidate = await readAdapter.readCandidateForUpdate(snapshot, {
        candidateId: input.candidateId,
        rootUserId: input.rootUserId,
        campaignId: input.campaignId,
      });
      if (!candidate) {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_NOT_FOUND",
          "Settlement source invalidation candidate was not found",
          404
        );
      }
      assertResolutionMatchesCandidate(candidate, input);

      const existingAudits = await readAudits(input);
      const candidateAudit = existingAudits.find((audit) => (
        audit.manual_review_item_id === input.candidateId
      ));
      const requestAudit = existingAudits.find((audit) => (
        audit.request_id === input.requestId
      ));

      if (candidate.status === "RESOLVED") {
        if (!candidateAudit) {
          throw resolutionError(
            "SETTLEMENT_SOURCE_RESOLUTION_AUDIT_INVALID",
            "Resolved candidate is missing its exact audit authority",
            503
          );
        }
        if (candidateAudit !== requestAudit) {
          throw resolutionError(
            "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT",
            "Settlement source resolution request conflicts with existing audit authority",
            409
          );
        }
        assertCandidateResolution(candidate, input);
        assertAuditMatches(candidateAudit, input, candidate);
        return resolutionPayload(candidate, candidateAudit, true);
      }
      if (candidate.status !== "OPEN") {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_STATE_CONFLICT",
          "Settlement source invalidation candidate is not open",
          409
        );
      }
      if (candidateAudit || requestAudit) {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT",
          "Settlement source resolution request conflicts with existing audit authority",
          409
        );
      }

      const sql = input.publicNote === null
        ? RESOLVE_WITHOUT_PUBLIC_NOTE_SQL
        : RESOLVE_WITH_PUBLIC_NOTE_SQL;
      const parameters = input.publicNote === null
        ? [
          input.operatorId,
          input.resolution,
          input.resolutionNote,
          input.candidateId,
          input.rootUserId,
          input.campaignId,
        ]
        : [
          input.operatorId,
          input.resolution,
          input.resolutionNote,
          input.publicNote,
          input.candidateId,
          input.rootUserId,
          input.campaignId,
        ];
      const updateResult = await execute(connection, sql, parameters);
      if (affectedRows(updateResult) !== 1) {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_STATE_CONFLICT",
          "Settlement source invalidation candidate changed before resolution",
          409
        );
      }

      candidate = await readAdapter.readCandidateForUpdate(snapshot, {
        candidateId: input.candidateId,
        rootUserId: input.rootUserId,
        campaignId: input.campaignId,
      });
      assertCandidateResolution(candidate, input);
      const id = auditId(input.candidateId, input.requestId);
      const insertResult = await execute(connection, INSERT_AUDIT_SQL, [
        id,
        input.candidateId,
        input.rootUserId,
        input.campaignId,
        input.requestId,
        input.operatorId,
        input.resolution,
        input.resolutionNote,
        input.publicNote,
        candidate.resolved_at,
        candidate.resolved_at,
      ], { duplicateIsConflict: true });
      if (affectedRows(insertResult) !== 1) {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_PERSISTENCE_FAILED",
          "Settlement source resolution audit was not appended",
          503
        );
      }

      const audits = await readAudits(input);
      const audit = audits.find((row) => row.manual_review_item_id === input.candidateId);
      if (!audit || audits.find((row) => row.request_id === input.requestId) !== audit) {
        throw resolutionError(
          "SETTLEMENT_SOURCE_RESOLUTION_AUDIT_INVALID",
          "Settlement source resolution audit readback failed",
          503
        );
      }
      assertAuditMatches(audit, input, candidate);
      return resolutionPayload(candidate, audit, false);
    },
  });
}

module.exports = Object.freeze({
  RESOLUTIONS,
  createMysqlSettlementSourceInvalidationResolveAdapter,
});
