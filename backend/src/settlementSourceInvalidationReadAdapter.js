const crypto = require("node:crypto");

const SOURCE_TYPE = "TASK_SOURCE_INVALIDATION";
const HANDLER_VERSION = "settlement-source-invalidation-v1";
const STOP_REVIEW_TYPE = "SETTLEMENT_STOP_CANDIDATE";
const RECALC_REVIEW_TYPE = "SETTLEMENT_RECALC_CANDIDATE";
const SOURCE_EVENT_TYPE = "activity.enrollment.canceled.v1";
const SOURCE_CONFIRMED_EVENT_TYPE = "activity.enrollment.confirmed.v1";
const MYSQL_SCOPE_PAGE_SIZE = 64;
const MAX_REQUEST_SCOPES = 256;
const SETTLED_STATUSES = Object.freeze([
  "QUALIFIED",
  "UNQUALIFIED",
  "NOT_QUALIFIED",
  "ADJUSTED",
  "REVIEW_REQUIRED",
]);
const CANDIDATE_COLUMNS = Object.freeze([
  "manual_review_item_id",
  "root_user_id",
  "campaign_id",
  "review_type",
  "source_type",
  "source_id",
  "reason",
  "status",
  "priority",
  "metadata",
  "idempotency_key",
  "operator_id",
  "resolved_at",
  "resolution",
  "created_at",
  "updated_at",
]);
const EVIDENCE_COLUMNS = Object.freeze([
  "source_invalidation_id",
  "source_assignment_id",
  "source_event_id",
  "source_event_type",
  "source_reason_code",
  "source_occurred_at",
  "source_root_user_id",
  "source_task_definition_id",
  "source_task_definition_version",
  "source_activity_enrollment_id",
  "source_activity_session_id",
  "source_initial_status",
  "source_confirmed_event_id",
  "source_confirmed_event_type",
  "source_confirmed_at",
  "source_campaign_id",
  "rule_campaign_rule_version_id",
  "rule_campaign_id",
  "rule_version",
  "rule_status",
  "rule_published_at",
  "settlement_record_id",
  "settlement_root_user_id",
  "settlement_campaign_id",
  "settlement_rule_version",
  "settlement_campaign_rule_version_id",
  "settlement_status",
  "settlement_evaluated_at",
  "settlement_created_at",
]);
const METADATA_KEYS = Object.freeze([
  "contractVersion",
  "handlerVersion",
  "candidateKind",
  "decision",
  "appendOnly",
  "taskSourceInvalidationEventId",
  "taskActivityAssignmentId",
  "rootUserId",
  "campaignId",
  "taskDefinitionId",
  "taskDefinitionVersion",
  "activityEnrollmentId",
  "activitySessionId",
  "sourceConfirmedEventId",
  "sourceEventId",
  "sourceEventType",
  "sourceCancellationReasonCode",
  "reasonCode",
  "sourceInvalidatedAt",
  "campaignRuleVersionId",
  "ruleVersion",
  "originalSettlementRecordId",
  "originalSettlementStatus",
  "originalSettlementEvaluatedAt",
]);
const WORKFLOW_METADATA_KEYS = Object.freeze(["publicNote", "resolutionNote"]);

const ACQUIRE_AUTHORITY_SQL = `/* settlement_source_invalidation_read:authority */
INSERT INTO settlement_source_authority (
  root_user_id, campaign_id, created_at, updated_at
) VALUES (?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE root_user_id = VALUES(root_user_id)`;

const CANDIDATE_EVIDENCE_SELECT = `SELECT
  candidate.manual_review_item_id,
  candidate.root_user_id,
  candidate.campaign_id,
  candidate.review_type,
  candidate.source_type,
  candidate.source_id,
  candidate.reason,
  candidate.status,
  candidate.priority,
  candidate.metadata,
  candidate.idempotency_key,
  candidate.operator_id,
  candidate.resolved_at,
  candidate.resolution,
  candidate.created_at,
  candidate.updated_at,
  invalidation.task_source_invalidation_event_id AS source_invalidation_id,
  invalidation.task_activity_assignment_id AS source_assignment_id,
  invalidation.source_event_id AS source_event_id,
  invalidation.source_event_type AS source_event_type,
  invalidation.reason_code AS source_reason_code,
  invalidation.occurred_at AS source_occurred_at,
  assignment.root_user_id AS source_root_user_id,
  assignment.task_definition_id AS source_task_definition_id,
  assignment.task_definition_version AS source_task_definition_version,
  assignment.activity_enrollment_id AS source_activity_enrollment_id,
  assignment.activity_session_id AS source_activity_session_id,
  assignment.initial_status AS source_initial_status,
  assignment.source_confirmed_event_id AS source_confirmed_event_id,
  assignment.source_confirmed_event_type AS source_confirmed_event_type,
  assignment.source_confirmed_at AS source_confirmed_at,
  definition.campaign_id AS source_campaign_id,
  rule_version.campaign_rule_version_id AS rule_campaign_rule_version_id,
  rule_version.campaign_id AS rule_campaign_id,
  rule_version.version AS rule_version,
  rule_version.status AS rule_status,
  rule_version.published_at AS rule_published_at,
  settlement.settlement_record_id AS settlement_record_id,
  settlement.root_user_id AS settlement_root_user_id,
  settlement.campaign_id AS settlement_campaign_id,
  settlement.rule_version AS settlement_rule_version,
  settlement.campaign_rule_version_id AS settlement_campaign_rule_version_id,
  settlement.status AS settlement_status,
  settlement.evaluated_at AS settlement_evaluated_at,
  settlement.created_at AS settlement_created_at
FROM manual_review_item AS candidate
LEFT JOIN task_source_invalidation_event AS invalidation
  ON invalidation.task_source_invalidation_event_id = candidate.source_id
LEFT JOIN task_activity_assignment AS assignment
  ON assignment.task_activity_assignment_id = invalidation.task_activity_assignment_id
LEFT JOIN task_definition AS definition
  ON definition.task_definition_id = assignment.task_definition_id
LEFT JOIN campaign_rule_version AS rule_version
  ON rule_version.campaign_rule_version_id = JSON_UNQUOTE(
    JSON_EXTRACT(candidate.metadata, '$.campaignRuleVersionId')
  )
LEFT JOIN settlement_record AS settlement
  ON settlement.settlement_record_id = JSON_UNQUOTE(
    JSON_EXTRACT(candidate.metadata, '$.originalSettlementRecordId')
  )`;

const READ_MYSQL_SCOPE_FIRST_SQL = `/* settlement_source_invalidation_read:scope_first */
${CANDIDATE_EVIDENCE_SELECT}
WHERE candidate.source_type = ?
  AND candidate.root_user_id = ?
  AND candidate.campaign_id = ?
ORDER BY candidate.created_at, candidate.manual_review_item_id
LIMIT ${MYSQL_SCOPE_PAGE_SIZE}
FOR SHARE`;

const READ_MYSQL_SCOPE_NEXT_SQL = `/* settlement_source_invalidation_read:scope_next */
${CANDIDATE_EVIDENCE_SELECT}
WHERE candidate.source_type = ?
  AND candidate.root_user_id = ?
  AND candidate.campaign_id = ?
  AND (
    candidate.created_at > ?
    OR (
      candidate.created_at = ?
      AND candidate.manual_review_item_id > ?
    )
  )
ORDER BY candidate.created_at, candidate.manual_review_item_id
LIMIT ${MYSQL_SCOPE_PAGE_SIZE}
FOR SHARE`;

const READ_MYSQL_CANDIDATE_FOR_UPDATE_SQL = `/* settlement_source_invalidation_read:candidate_for_update */
${CANDIDATE_EVIDENCE_SELECT}
WHERE candidate.source_type = ?
  AND candidate.manual_review_item_id = ?
  AND candidate.root_user_id = ?
  AND candidate.campaign_id = ?
LIMIT 2
FOR UPDATE`;

function readError(code = "SETTLEMENT_SOURCE_INVALIDATION_READ_STATE_INVALID") {
  const error = new Error("Settlement source invalidation read state is unavailable");
  error.code = code;
  error.status = 503;
  return error;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { throw readError(); }
}

function exactKeys(value, expected) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function empty(value) {
  return value === null || value === undefined || value === "";
}

function mysqlComparisonKey(value) {
  return typeof value === "string"
    ? value.trimEnd().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    : value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function metadataValue(value) {
  if (record(value)) return value;
  if (typeof value !== "string") throw readError();
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw readError(); }
  if (!record(parsed)) throw readError();
  return parsed;
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

function digest(domain, ...parts) {
  const hash = crypto.createHash("sha256").update(`${domain}\0`, "utf8");
  for (const part of parts) hash.update(String(part), "utf8").update("\0", "utf8");
  return hash.digest("hex");
}

function candidateId(metadata) {
  return `mri_${digest(
    "myroot:settlement-source-invalidation-candidate:v1",
    metadata.taskSourceInvalidationEventId,
    metadata.campaignRuleVersionId,
    metadata.ruleVersion
  ).slice(0, 28)}`;
}

function invalidationId(metadata) {
  const value = crypto.createHash("sha256")
    .update(
      `myroot:task-source-invalidation:v1:${metadata.taskActivityAssignmentId}\0${metadata.sourceEventId}`,
      "utf8"
    )
    .digest("hex");
  return `task_invalid_${value.slice(0, 51)}`;
}

function immutableMetadata(value) {
  const metadata = metadataValue(value);
  const keys = Object.keys(metadata);
  if (METADATA_KEYS.some((key) => !keys.includes(key))
    || keys.some((key) => !METADATA_KEYS.includes(key)
      && !WORKFLOW_METADATA_KEYS.includes(key))) throw readError();
  const base = {};
  for (const key of METADATA_KEYS) base[key] = metadata[key];
  return { metadata, base };
}

function assertMetadataShape(base) {
  if (base.contractVersion !== 1
    || base.handlerVersion !== HANDLER_VERSION
    || base.appendOnly !== true
    || !exactText(base.taskSourceInvalidationEventId, 64)
    || !exactText(base.taskActivityAssignmentId, 64)
    || !exactText(base.rootUserId, 32)
    || !exactText(base.campaignId, 64)
    || !exactText(base.taskDefinitionId, 32)
    || !exactText(base.taskDefinitionVersion, 64)
    || !exactText(base.activityEnrollmentId, 64)
    || !exactText(base.activitySessionId, 64)
    || !exactText(base.sourceConfirmedEventId, 64)
    || !exactText(base.sourceEventId, 64)
    || base.sourceEventType !== SOURCE_EVENT_TYPE
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(
      base.sourceCancellationReasonCode
    )
    || base.reasonCode !== "SOURCE_CANCELED"
    || dateInstant(base.sourceInvalidatedAt) === null
    || !exactText(base.campaignRuleVersionId, 32)
    || !Number.isSafeInteger(base.ruleVersion)
    || base.ruleVersion < 1
    || base.taskSourceInvalidationEventId !== invalidationId(base)) throw readError();
}

function assertLifecycle(row, metadata) {
  if (!["OPEN", "RESOLVED"].includes(row.status)
    || row.priority !== "HIGH"
    || dateInstant(row.created_at) === null
    || dateInstant(row.updated_at) === null) throw readError();
  if (row.status === "OPEN") {
    if (!empty(row.operator_id)
      || !empty(row.resolved_at)
      || !empty(row.resolution)
      || !sameDate(row.updated_at, row.created_at)
      || Object.hasOwn(metadata, "publicNote")
      || Object.hasOwn(metadata, "resolutionNote")) throw readError();
    return;
  }
  if (!exactText(row.operator_id, 64)
    || dateInstant(row.resolved_at) === null
    || dateInstant(row.resolved_at) < dateInstant(row.created_at)
    || !sameDate(row.updated_at, row.resolved_at)
    || !exactText(row.resolution, 8_192)
    || !Object.hasOwn(metadata, "resolutionNote")
    || typeof metadata.resolutionNote !== "string"
    || (Object.hasOwn(metadata, "publicNote")
      && typeof metadata.publicNote !== "string")) throw readError();
}

function assertCandidateKind(row, base) {
  const originalId = base.originalSettlementRecordId;
  const originalStatus = base.originalSettlementStatus;
  const originalEvaluatedAt = base.originalSettlementEvaluatedAt;
  if (originalId === null) {
    if (originalStatus !== null || originalEvaluatedAt !== null) throw readError();
  } else if (!exactText(originalId, 32)
    || !["PENDING", ...SETTLED_STATUSES].includes(originalStatus)
    || dateInstant(originalEvaluatedAt) === null) throw readError();

  if (row.review_type === STOP_REVIEW_TYPE) {
    if (base.candidateKind !== "STOP_OR_CANCEL"
      || base.decision !== "STOP_AUTOMATIC_SETTLEMENT"
      || ![null, "PENDING"].includes(originalStatus)) throw readError();
    return;
  }
  if (row.review_type !== RECALC_REVIEW_TYPE
    || base.candidateKind !== "ADJUSTMENT_OR_RECALCULATION"
    || base.decision !== "RECALCULATION_REQUIRED"
    || !SETTLED_STATUSES.includes(originalStatus)) throw readError();
}

function assertSnapshotEvidence(snapshot, base) {
  const rules = Array.isArray(snapshot.campaignRuleVersions)
    ? snapshot.campaignRuleVersions
    : [];
  const matchingRules = rules.filter((rule) => (
    rule
    && rule.campaign_rule_version_id === base.campaignRuleVersionId
    && rule.campaign_id === base.campaignId
    && Number(rule.version) === base.ruleVersion
  ));
  if (matchingRules.length !== 1 || matchingRules[0].status !== "PUBLISHED") {
    throw readError();
  }
  const settlements = Array.isArray(snapshot.settlementRecords)
    ? snapshot.settlementRecords
    : [];
  const sourceSettlements = settlements.filter((settlement) => (
    settlement
    && settlement.root_user_id === base.rootUserId
    && settlement.campaign_id === base.campaignId
  )).sort((left, right) => {
    const evaluated = dateInstant(right.evaluated_at || right.created_at)
      - dateInstant(left.evaluated_at || left.created_at);
    if (evaluated !== 0) return evaluated;
    const created = dateInstant(right.created_at) - dateInstant(left.created_at);
    if (created !== 0) return created;
    return String(left.settlement_record_id || "").localeCompare(
      String(right.settlement_record_id || "")
    );
  });
  if (base.originalSettlementRecordId === null) {
    if (sourceSettlements.length !== 0) throw readError();
    return;
  }
  const matchingSettlements = settlements.filter((settlement) => (
    settlement
    && settlement.settlement_record_id === base.originalSettlementRecordId
  ));
  if (matchingSettlements.length !== 1) throw readError();
  const settlement = matchingSettlements[0];
  if (settlement.root_user_id !== base.rootUserId
    || settlement.campaign_id !== base.campaignId
    || settlement.campaign_rule_version_id !== base.campaignRuleVersionId
    || Number(settlement.rule_version) !== base.ruleVersion
    || settlement.status !== base.originalSettlementStatus
    || sourceSettlements[0] !== settlement
    || !sameDate(
      settlement.evaluated_at || settlement.created_at,
      base.originalSettlementEvaluatedAt
    )) throw readError();
}

function assertMysqlEvidence(row, base) {
  if (row.source_invalidation_id !== base.taskSourceInvalidationEventId
    || row.source_assignment_id !== base.taskActivityAssignmentId
    || row.source_event_id !== base.sourceEventId
    || row.source_event_type !== SOURCE_EVENT_TYPE
    || row.source_reason_code !== base.sourceCancellationReasonCode
    || !sameDate(row.source_occurred_at, base.sourceInvalidatedAt)
    || row.source_root_user_id !== base.rootUserId
    || row.source_task_definition_id !== base.taskDefinitionId
    || row.source_task_definition_version !== base.taskDefinitionVersion
    || row.source_activity_enrollment_id !== base.activityEnrollmentId
    || row.source_activity_session_id !== base.activitySessionId
    || row.source_initial_status !== "AVAILABLE"
    || row.source_confirmed_event_id !== base.sourceConfirmedEventId
    || row.source_confirmed_event_type !== SOURCE_CONFIRMED_EVENT_TYPE
    || dateInstant(row.source_confirmed_at) === null
    || dateInstant(row.source_confirmed_at) > dateInstant(base.sourceInvalidatedAt)
    || row.source_campaign_id !== base.campaignId
    || row.rule_campaign_rule_version_id !== base.campaignRuleVersionId
    || row.rule_campaign_id !== base.campaignId
    || Number(row.rule_version) !== base.ruleVersion
    || row.rule_status !== "PUBLISHED"
    || dateInstant(row.rule_published_at) === null) {
    throw readError();
  }

  if (base.originalSettlementRecordId === null) {
    if (EVIDENCE_COLUMNS.slice(21).some((key) => !empty(row[key]))) throw readError();
    return;
  }
  if (row.settlement_record_id !== base.originalSettlementRecordId
    || row.settlement_root_user_id !== base.rootUserId
    || row.settlement_campaign_id !== base.campaignId
    || Number(row.settlement_rule_version) !== base.ruleVersion
    || row.settlement_campaign_rule_version_id !== base.campaignRuleVersionId
    || row.settlement_status !== base.originalSettlementStatus
    || !sameDate(row.settlement_evaluated_at, base.originalSettlementEvaluatedAt)
    || dateInstant(row.settlement_created_at) === null) throw readError();
}

function normalizeCandidate(row, snapshot, options = {}) {
  const expectedKeys = options.mysql === true
    ? [...CANDIDATE_COLUMNS, ...EVIDENCE_COLUMNS]
    : CANDIDATE_COLUMNS;
  if (!exactKeys(row, expectedKeys)) throw readError();
  const { metadata, base } = immutableMetadata(row.metadata);
  assertMetadataShape(base);
  if (!exactText(row.manual_review_item_id, 32)
    || row.manual_review_item_id !== candidateId(base)
    || row.root_user_id !== base.rootUserId
    || row.campaign_id !== base.campaignId
    || ![STOP_REVIEW_TYPE, RECALC_REVIEW_TYPE].includes(row.review_type)
    || row.source_type !== SOURCE_TYPE
    || row.source_id !== base.taskSourceInvalidationEventId
    || row.reason !== "TASK_SOURCE_INVALIDATED"
    || row.idempotency_key !== [
      "task-source-invalidation",
      base.taskSourceInvalidationEventId,
      "rule",
      base.campaignRuleVersionId,
      base.ruleVersion,
    ].join(":")
    || !sameDate(row.created_at, base.sourceInvalidatedAt)) throw readError();
  assertLifecycle(row, metadata);
  assertCandidateKind(row, base);
  assertSnapshotEvidence(snapshot, base);
  if (options.mysql === true) assertMysqlEvidence(row, base);
  const candidate = {};
  for (const key of CANDIDATE_COLUMNS) candidate[key] = clone(row[key]);
  candidate.metadata = clone(metadata);
  return candidate;
}

function handlerOwnedRows(snapshot) {
  if (!record(snapshot) || !Array.isArray(snapshot.manualReviewItems)) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_INPUT_INVALID");
  }
  const reservedSourceRows = snapshot.manualReviewItems.filter((row) => (
    row
    && mysqlComparisonKey(row.source_type) === mysqlComparisonKey(SOURCE_TYPE)
  ));
  if (reservedSourceRows.some((row) => row.source_type !== SOURCE_TYPE)) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT");
  }
  return reservedSourceRows;
}

function assertUnique(candidates, ordinaryRows = []) {
  const dimensions = [
    "manual_review_item_id",
    "source_id",
    "idempotency_key",
  ];
  for (const key of dimensions) {
    const candidateValues = new Set();
    for (const row of candidates) {
      const value = row[key];
      if (!exactText(value, key === "idempotency_key" ? 160 : 64)
        || candidateValues.has(mysqlComparisonKey(value))) {
        throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_DUPLICATE");
      }
      candidateValues.add(mysqlComparisonKey(value));
    }
    for (const row of ordinaryRows) {
      const value = row && row[key];
      if (!empty(value) && candidateValues.has(mysqlComparisonKey(value))) {
        throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_DUPLICATE");
      }
    }
  }
}

function normalizeCandidates(rows, snapshot, options = {}) {
  if (!Array.isArray(rows)) throw readError();
  const candidates = rows.map((row) => normalizeCandidate(row, snapshot, options));
  const ordinary = snapshot.manualReviewItems.filter((row) => (
    !row || row.source_type !== SOURCE_TYPE
  ));
  assertUnique(candidates, ordinary);
  return candidates;
}

function candidateFingerprint(candidates) {
  return canonicalJson([...candidates].sort((left, right) => (
    left.manual_review_item_id.localeCompare(right.manual_review_item_id)
  )));
}

function normalizedScopes(input) {
  if (!Array.isArray(input) || input.length > MAX_REQUEST_SCOPES) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
  }
  const scopes = input.map((scope) => {
    if (!exactKeys(scope, ["rootUserId", "campaignId"])
      || !exactText(scope.rootUserId, 32)
      || !exactText(scope.campaignId, 64)) {
      throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
    }
    return Object.freeze({
      rootUserId: scope.rootUserId,
      campaignId: scope.campaignId,
    });
  }).sort((left, right) => Buffer.compare(
    Buffer.from(`${left.rootUserId}\0${left.campaignId}`, "utf8"),
    Buffer.from(`${right.rootUserId}\0${right.campaignId}`, "utf8")
  ));
  const keys = scopes.map((scope) => `${scope.rootUserId}\0${scope.campaignId}`);
  if (new Set(keys).size !== keys.length) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
  }
  return scopes;
}

function scopeKey(scope) {
  return `${scope.rootUserId}\0${scope.campaignId}`;
}

function candidateScopeKey(candidate) {
  return `${candidate.root_user_id}\0${candidate.campaign_id}`;
}

function storedCandidate(row) {
  if (!exactKeys(row, CANDIDATE_COLUMNS)) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT");
  }
  const candidate = {};
  for (const key of CANDIDATE_COLUMNS) candidate[key] = clone(row[key]);
  candidate.metadata = clone(metadataValue(row.metadata));
  return candidate;
}

function storedCandidateFingerprint(rows) {
  try {
    return candidateFingerprint(rows.map(storedCandidate));
  } catch {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT");
  }
}

function stripHandlerCandidates(snapshot) {
  const prepared = clone(snapshot);
  handlerOwnedRows(prepared);
  prepared.manualReviewItems = prepared.manualReviewItems.filter((row) => (
    !row || row.source_type !== SOURCE_TYPE
  ));
  return prepared;
}

function selectedRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw readError();
  return result[0];
}

async function safeExecute(connection, sql, parameters) {
  try {
    return await connection.execute(sql, parameters);
  } catch (error) {
    if (error && String(error.code || "").startsWith(
      "SETTLEMENT_SOURCE_INVALIDATION_READ_"
    )) throw error;
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_PERSISTENCE_FAILED");
  }
}

async function acquireAuthorities(connection, scopes) {
  for (const scope of scopes) {
    const result = await safeExecute(connection, ACQUIRE_AUTHORITY_SQL, [
      scope.rootUserId,
      scope.campaignId,
    ]);
    const affected = Number(result && result[0] && result[0].affectedRows);
    if (!Number.isSafeInteger(affected) || affected < 0 || affected > 1) {
      throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_PERSISTENCE_FAILED");
    }
  }
}

function assertPageCursor(row, previous) {
  const createdAt = row && row.created_at;
  const itemId = row && row.manual_review_item_id;
  const instant = dateInstant(createdAt);
  if (instant === null || !exactText(itemId, 32)) throw readError();
  if (previous) {
    const previousInstant = dateInstant(previous.createdAt);
    if (instant < previousInstant
      || (instant === previousInstant
        && Buffer.compare(Buffer.from(itemId), Buffer.from(previous.itemId)) <= 0)) {
      throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_CURSOR_INVALID");
    }
  }
  return Object.freeze({ createdAt, itemId });
}

async function readScopeCandidates(connection, snapshot, scope) {
  const candidates = [];
  let cursor = null;
  while (true) {
    const parameters = cursor
      ? [
        SOURCE_TYPE,
        scope.rootUserId,
        scope.campaignId,
        cursor.createdAt,
        cursor.createdAt,
        cursor.itemId,
      ]
      : [SOURCE_TYPE, scope.rootUserId, scope.campaignId];
    const rows = selectedRows(await safeExecute(
      connection,
      cursor ? READ_MYSQL_SCOPE_NEXT_SQL : READ_MYSQL_SCOPE_FIRST_SQL,
      parameters
    ));
    if (rows.length > MYSQL_SCOPE_PAGE_SIZE) throw readError();
    for (const row of rows) {
      cursor = assertPageCursor(row, cursor);
      const candidate = normalizeCandidate(row, snapshot, { mysql: true });
      if (candidate.root_user_id !== scope.rootUserId
        || candidate.campaign_id !== scope.campaignId) throw readError();
      candidates.push(candidate);
    }
    if (rows.length < MYSQL_SCOPE_PAGE_SIZE) break;
  }
  assertUnique(candidates, snapshot.manualReviewItems);
  return candidates;
}

async function readScopedCandidates(connection, snapshot, scopes) {
  const candidates = [];
  for (const scope of scopes) {
    candidates.push(...await readScopeCandidates(connection, snapshot, scope));
  }
  assertUnique(candidates, snapshot.manualReviewItems);
  return candidates;
}

function createMemorySettlementSourceInvalidationReadAdapter(data) {
  if (!record(data)) {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    async hydrateRequestState(snapshotInput = data, scopesInput = null) {
      const snapshot = clone(snapshotInput);
      const candidates = normalizeCandidates(handlerOwnedRows(snapshot), snapshot);
      if (scopesInput !== null) {
        const scopeKeys = new Set(normalizedScopes(scopesInput).map(scopeKey));
        normalizeCandidates(candidates.filter((candidate) => (
          scopeKeys.has(candidateScopeKey(candidate))
        )), snapshot);
      }
      return Object.freeze({
        data: snapshot,
        candidateCount: candidates.length,
      });
    },
    async assertCurrentScopesAvailable(snapshotInput = data, scopesInput = []) {
      const snapshot = clone(snapshotInput);
      const scopeKeys = new Set(normalizedScopes(scopesInput).map(scopeKey));
      const candidates = normalizeCandidates(handlerOwnedRows(snapshot), snapshot)
        .filter((candidate) => scopeKeys.has(candidateScopeKey(candidate)));
      return Object.freeze({ candidates: clone(candidates), candidateCount: candidates.length });
    },
    async readCandidateForUpdate(snapshotInput = data, input = {}) {
      if (!exactKeys(input, ["candidateId", "rootUserId", "campaignId"])) {
        throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
      }
      const scope = normalizedScopes([{
        rootUserId: input.rootUserId,
        campaignId: input.campaignId,
      }])[0];
      if (!exactText(input.candidateId, 32)) {
        throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
      }
      const snapshot = clone(snapshotInput);
      const candidates = normalizeCandidates(handlerOwnedRows(snapshot), snapshot);
      return clone(candidates.find((candidate) => (
        candidate.manual_review_item_id === input.candidateId
        && candidateScopeKey(candidate) === scopeKey(scope)
      )) || null);
    },
    prepareSnapshotForPersistence(snapshot) {
      const prepared = clone(snapshot);
      normalizeCandidates(handlerOwnedRows(prepared), prepared);
      return prepared;
    },
  });
}

function createMysqlSettlementSourceInvalidationReadAdapter(connection) {
  if (!connection || typeof connection.execute !== "function") {
    throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_CONFIGURATION_INVALID");
  }
  let baselineCandidates = [];
  function assertTrackedCandidates(snapshot) {
    const candidates = handlerOwnedRows(snapshot);
    if (storedCandidateFingerprint(candidates)
      !== storedCandidateFingerprint(baselineCandidates)) {
      throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT");
    }
    const ordinary = snapshot.manualReviewItems.filter((row) => (
      !row || row.source_type !== SOURCE_TYPE
    ));
    assertUnique(baselineCandidates, ordinary);
    return ordinary;
  }
  return Object.freeze({
    async hydrateRequestState(snapshotInput, scopesInput = []) {
      const snapshot = clone(snapshotInput);
      const ordinary = assertTrackedCandidates(snapshot);
      const scopes = normalizedScopes(scopesInput);
      const persisted = stripHandlerCandidates(snapshot);
      await acquireAuthorities(connection, scopes);
      const refreshed = await readScopedCandidates(connection, persisted, scopes);
      const refreshedScopeKeys = new Set(scopes.map(scopeKey));
      const retained = baselineCandidates.filter((candidate) => (
        !refreshedScopeKeys.has(candidateScopeKey(candidate))
      ));
      const candidates = [...retained, ...refreshed];
      assertUnique(candidates, ordinary);
      baselineCandidates = clone(candidates);
      snapshot.manualReviewItems = [
        ...ordinary,
        ...clone(candidates),
      ];
      return Object.freeze({
        data: snapshot,
        candidateCount: candidates.length,
        loadedScopeCount: scopes.length,
      });
    },
    async assertCurrentScopesAvailable(snapshotInput, scopesInput = []) {
      const scopes = normalizedScopes(scopesInput);
      const snapshot = stripHandlerCandidates(snapshotInput);
      await acquireAuthorities(connection, scopes);
      const candidates = await readScopedCandidates(connection, snapshot, scopes);
      return Object.freeze({
        candidates: clone(candidates),
        candidateCount: candidates.length,
        lockedScopeCount: scopes.length,
      });
    },
    async readCandidateForUpdate(snapshotInput, input = {}) {
      if (!exactKeys(input, ["candidateId", "rootUserId", "campaignId"])
        || !exactText(input.candidateId, 32)) {
        throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID");
      }
      const scope = normalizedScopes([{
        rootUserId: input.rootUserId,
        campaignId: input.campaignId,
      }])[0];
      const snapshot = stripHandlerCandidates(snapshotInput);
      await acquireAuthorities(connection, [scope]);
      const rows = selectedRows(await safeExecute(
        connection,
        READ_MYSQL_CANDIDATE_FOR_UPDATE_SQL,
        [SOURCE_TYPE, input.candidateId, scope.rootUserId, scope.campaignId]
      ));
      if (rows.length > 1) throw readError("SETTLEMENT_SOURCE_INVALIDATION_READ_DUPLICATE");
      return rows.length ? normalizeCandidate(rows[0], snapshot, { mysql: true }) : null;
    },
    prepareSnapshotForPersistence(snapshotInput) {
      const snapshot = clone(snapshotInput);
      snapshot.manualReviewItems = assertTrackedCandidates(snapshot);
      return snapshot;
    },
  });
}

module.exports = Object.freeze({
  MAX_REQUEST_SCOPES,
  MYSQL_SCOPE_PAGE_SIZE,
  SOURCE_TYPE,
  createMemorySettlementSourceInvalidationReadAdapter,
  createMysqlSettlementSourceInvalidationReadAdapter,
});
