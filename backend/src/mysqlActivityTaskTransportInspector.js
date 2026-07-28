const MYSQL_SESSION_TIME_ZONE = "+08:00";

const INSPECT_SQL = `/* activity_task_transport:inspect */
SELECT
  (SELECT COUNT(*) FROM outbox_event AS o
    WHERE o.topic = 'activity.enrollment.events'
      AND o.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND o.status IN ('PENDING', 'CLAIMED')) AS outbox_active_count,
  (SELECT COUNT(*) FROM outbox_event AS o
    WHERE o.topic = 'activity.enrollment.events'
      AND o.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND o.status = 'RETRY_PENDING') AS outbox_retry_pending_count,
  (SELECT COUNT(*) FROM outbox_event AS o
    WHERE o.topic = 'activity.enrollment.events'
      AND o.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND o.status = 'DEAD_LETTER') AS outbox_dead_letter_count,
  (SELECT COUNT(*) FROM inbox_receipt AS r
    WHERE r.consumer_name = 'activity-task-source-projection'
      AND r.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND r.status IN ('RECEIVED', 'CLAIMED')) AS inbox_active_count,
  (SELECT COUNT(*) FROM inbox_receipt AS r
    WHERE r.consumer_name = 'activity-task-source-projection'
      AND r.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND r.status = 'RETRY_PENDING') AS inbox_retry_pending_count,
  (SELECT COUNT(*) FROM inbox_receipt AS r
    WHERE r.consumer_name = 'activity-task-source-projection'
      AND r.event_type IN (
        'activity.enrollment.confirmed.v1',
        'activity.enrollment.canceled.v1'
      )
      AND r.status IN ('DEAD_LETTER', 'REVIEW_REQUIRED')) AS inbox_terminal_attention_count,
  (SELECT COUNT(*) FROM event_dead_letter AS d
    WHERE d.status = 'OPEN'
      AND (
        (d.direction = 'INBOX' AND d.consumer_name = 'activity-task-source-projection')
        OR (
          d.direction = 'OUTBOX'
          AND EXISTS (
            SELECT 1 FROM outbox_event AS source
            WHERE source.outbox_event_id = d.source_record_id
              AND source.topic = 'activity.enrollment.events'
              AND source.event_type IN (
                'activity.enrollment.confirmed.v1',
                'activity.enrollment.canceled.v1'
              )
          )
        )
      )) AS open_dead_letter_count,
  (SELECT COUNT(*) FROM consumer_checkpoint AS c
    WHERE c.consumer_name = 'activity-task-source-projection'
      AND c.gap_status <> 'CLEAR') AS blocked_checkpoint_count,
  (SELECT COUNT(*) FROM inbox_receipt AS mismatch
    WHERE mismatch.consumer_name = 'activity-task-source-projection'
      AND (
        (mismatch.event_type = 'activity.enrollment.confirmed.v1'
          AND mismatch.handler_id <> 'activity-enrollment-confirmed-task-v1')
        OR
        (mismatch.event_type = 'activity.enrollment.canceled.v1'
          AND mismatch.handler_id <> 'activity-enrollment-canceled-task-v1')
      )) AS registration_mismatch_count`;

const COUNT_KEYS = Object.freeze([
  "outbox_active_count",
  "outbox_retry_pending_count",
  "outbox_dead_letter_count",
  "inbox_active_count",
  "inbox_retry_pending_count",
  "inbox_terminal_attention_count",
  "open_dead_letter_count",
  "blocked_checkpoint_count",
  "registration_mismatch_count",
]);

function inspectorError(code) {
  const error = new Error("activity task transport inspection failed");
  error.code = code;
  return error;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw inspectorError("ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED");
  }
  const counts = {};
  for (const key of COUNT_KEYS) {
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw inspectorError("ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED");
    }
    counts[key] = value;
  }
  const attentionCount = counts.outbox_retry_pending_count
    + counts.outbox_dead_letter_count
    + counts.inbox_retry_pending_count
    + counts.inbox_terminal_attention_count
    + counts.open_dead_letter_count
    + counts.blocked_checkpoint_count
    + counts.registration_mismatch_count;
  return Object.freeze({
    status: attentionCount === 0 ? "HEALTHY" : "ATTENTION_REQUIRED",
    counts: Object.freeze(counts),
  });
}

function createMysqlActivityTaskTransportInspector(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "pool")
    || !options.pool || typeof options.pool.getConnection !== "function") {
    throw inspectorError("ACTIVITY_TASK_TRANSPORT_CONFIGURATION_INVALID");
  }
  const pool = options.pool;

  async function inspect() {
    let connection;
    let destroy = false;
    try {
      connection = await pool.getConnection();
      if (!connection
        || typeof connection.execute !== "function"
        || typeof connection.release !== "function"
        || typeof connection.destroy !== "function") {
        throw inspectorError("ACTIVITY_TASK_TRANSPORT_CONFIGURATION_INVALID");
      }
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
      const result = await connection.execute(INSPECT_SQL);
      if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length !== 1) {
        throw inspectorError("ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED");
      }
      return normalizeRow(result[0][0]);
    } catch (error) {
      destroy = true;
      if (error && [
        "ACTIVITY_TASK_TRANSPORT_CONFIGURATION_INVALID",
        "ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED",
      ].includes(error.code)) throw error;
      throw inspectorError("ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED");
    } finally {
      if (connection) {
        try {
          if (destroy) connection.destroy();
          else connection.release();
        } catch {}
      }
    }
  }

  return Object.freeze({ inspect });
}

module.exports = Object.freeze({
  createMysqlActivityTaskTransportInspector,
});
