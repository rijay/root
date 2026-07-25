-- Every session cancellation is projected as an immutable request-scoped fact.
-- Snapshot, relational projections, and command response commit in one Store
-- transaction.

CREATE TABLE IF NOT EXISTS activity_session_event (
  activity_session_event_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  to_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_detail VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (activity_session_event_id),
  UNIQUE KEY uk_activity_session_event_request (request_id),
  UNIQUE KEY uk_activity_session_event_sequence (activity_session_id, event_sequence),
  UNIQUE KEY uk_activity_session_event_operation (activity_session_id, operation),
  KEY idx_activity_session_event_occurred (occurred_at, activity_session_id),
  CONSTRAINT fk_activity_session_event_session
    FOREIGN KEY (activity_session_id) REFERENCES activity_session (activity_session_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_activity_session_event_sequence CHECK (event_sequence > 0),
  CONSTRAINT chk_activity_session_event_operation CHECK (operation = 'SESSION_CANCELED'),
  CONSTRAINT chk_activity_session_event_from_status CHECK (
    from_status IN ('SCHEDULED', 'OPEN', 'CLOSED')
  ),
  CONSTRAINT chk_activity_session_event_to_status CHECK (to_status = 'CANCELED'),
  CONSTRAINT chk_activity_session_event_reason CHECK (
    reason_code IN ('OPERATOR_CANCELED', 'WEATHER', 'VENUE', 'FORCE_MAJEURE', 'OTHER')
  ),
  CONSTRAINT chk_activity_session_event_other_reason CHECK (
    reason_code <> 'OTHER' OR reason_detail IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
