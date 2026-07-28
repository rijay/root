const MYSQL_SESSION_TIME_ZONE = "+08:00";

const READ_BY_ROOT_USER_SQL = `/* activity_task_read:list_by_root_user */
SELECT
  assignment.task_activity_assignment_id,
  assignment.root_user_id,
  assignment.task_definition_id,
  assignment.task_definition_version,
  assignment.activity_enrollment_id,
  assignment.activity_session_id,
  assignment.initial_status,
  assignment.source_confirmed_event_id,
  assignment.source_confirmed_at,
  invalidation.task_source_invalidation_event_id,
  invalidation.reason_code AS source_invalidation_reason_code,
  invalidation.occurred_at AS source_invalidated_at
FROM task_activity_assignment AS assignment
LEFT JOIN task_source_invalidation_event AS invalidation
  ON invalidation.task_activity_assignment_id = assignment.task_activity_assignment_id
WHERE assignment.root_user_id = ?
ORDER BY assignment.source_confirmed_at, assignment.task_activity_assignment_id`;

function readError(code = "ACTIVITY_TASK_READ_FAILED") {
  const error = new Error("Activity task read model is unavailable");
  error.code = code;
  error.status = 503;
  return error;
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function mysqlDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)) {
    return `${text.replace(" ", "T")}+08:00`;
  }
  return Number.isNaN(Date.parse(text)) ? "" : text;
}

function normalizeFact(row, expectedRootUserId) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || !exactText(row.task_activity_assignment_id, 64)
    || !exactText(row.root_user_id, 32)
    || row.root_user_id !== expectedRootUserId
    || !exactText(row.task_definition_id, 32)
    || !exactText(row.task_definition_version, 64)
    || !exactText(row.activity_enrollment_id, 64)
    || !exactText(row.activity_session_id, 64)
    || row.initial_status !== "AVAILABLE"
    || !exactText(row.source_confirmed_event_id, 64)
    || !mysqlDate(row.source_confirmed_at)) throw readError("ACTIVITY_TASK_READ_MODEL_INVALID");
  const invalidationId = row.task_source_invalidation_event_id || "";
  const invalidated = Boolean(invalidationId);
  if (invalidated && (
    !exactText(invalidationId, 64)
    || !["USER_CANCELED", "SESSION_CANCELED"].includes(row.source_invalidation_reason_code)
    || !mysqlDate(row.source_invalidated_at)
  )) throw readError("ACTIVITY_TASK_READ_MODEL_INVALID");
  if (!invalidated && (row.source_invalidation_reason_code || row.source_invalidated_at)) {
    throw readError("ACTIVITY_TASK_READ_MODEL_INVALID");
  }
  return Object.freeze({
    taskActivityAssignmentId: row.task_activity_assignment_id,
    rootUserId: row.root_user_id,
    taskDefinitionId: row.task_definition_id,
    taskDefinitionVersion: row.task_definition_version,
    activityEnrollmentId: row.activity_enrollment_id,
    activitySessionId: row.activity_session_id,
    sourceConfirmedEventId: row.source_confirmed_event_id,
    sourceConfirmedAt: mysqlDate(row.source_confirmed_at),
    sourceInvalidationEventId: invalidationId,
    sourceInvalidationReason: invalidated ? "SOURCE_CANCELED" : "",
    sourceCancellationReasonCode: invalidated ? row.source_invalidation_reason_code : "",
    sourceInvalidatedAt: invalidated ? mysqlDate(row.source_invalidated_at) : "",
  });
}

function normalizeFacts(rows, rootUserId) {
  if (!exactText(rootUserId, 32) || !Array.isArray(rows)) throw readError("ACTIVITY_TASK_READ_INPUT_INVALID");
  const seen = new Set();
  const facts = rows.map((row) => normalizeFact(row, rootUserId));
  facts.forEach((fact) => {
    if (seen.has(fact.taskActivityAssignmentId)) throw readError("ACTIVITY_TASK_READ_MODEL_INVALID");
    seen.add(fact.taskActivityAssignmentId);
  });
  return Object.freeze(facts);
}

function createMemoryActivityTaskReadAdapter(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw readError("ACTIVITY_TASK_READ_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    async listByRootUser(rootUserId) {
      const assignments = Array.isArray(data.taskActivityAssignments) ? data.taskActivityAssignments : [];
      const invalidations = Array.isArray(data.taskSourceInvalidationEvents) ? data.taskSourceInvalidationEvents : [];
      const rows = assignments
        .filter((row) => row.root_user_id === rootUserId)
        .map((assignment) => {
          const invalidation = invalidations.find((row) => (
            row.task_activity_assignment_id === assignment.task_activity_assignment_id
          ));
          return {
            ...assignment,
            task_source_invalidation_event_id: invalidation && invalidation.task_source_invalidation_event_id,
            source_invalidation_reason_code: invalidation && invalidation.reason_code,
            source_invalidated_at: invalidation && invalidation.occurred_at,
          };
        });
      return normalizeFacts(rows, rootUserId);
    },
  });
}

function createMysqlActivityTaskReadAdapter(connection) {
  if (!connection || typeof connection.execute !== "function") {
    throw readError("ACTIVITY_TASK_READ_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    async listByRootUser(rootUserId) {
      if (!exactText(rootUserId, 32)) throw readError("ACTIVITY_TASK_READ_INPUT_INVALID");
      try {
        await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
        const result = await connection.execute(READ_BY_ROOT_USER_SQL, [rootUserId]);
        if (!Array.isArray(result) || !Array.isArray(result[0])) throw readError();
        return normalizeFacts(result[0], rootUserId);
      } catch (error) {
        if (error && String(error.code || "").startsWith("ACTIVITY_TASK_READ_")) throw error;
        throw readError();
      }
    },
  });
}

module.exports = Object.freeze({
  createMemoryActivityTaskReadAdapter,
  createMysqlActivityTaskReadAdapter,
  normalizeFacts,
});
