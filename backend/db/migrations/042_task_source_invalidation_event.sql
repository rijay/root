-- Immutable Task source-invalidated fact. It is appended for every confirmed
-- Activity task cancellation, including when the task was already completed.
-- A later Settlement consumer may replay this fact without deleting history.

CREATE TABLE IF NOT EXISTS task_source_invalidation_event (
  task_source_invalidation_event_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_activity_assignment_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id VARCHAR(64) COLLATE utf8mb4_0900_bin NOT NULL,
  source_event_type VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (task_source_invalidation_event_id),
  UNIQUE KEY uk_task_source_invalidation_source_event (source_event_id),
  UNIQUE KEY uk_task_source_invalidation_assignment (
    task_activity_assignment_id,
    source_event_id
  ),
  KEY idx_task_source_invalidation_occurred (occurred_at, task_activity_assignment_id),
  CONSTRAINT fk_task_source_invalidation_assignment
    FOREIGN KEY (task_activity_assignment_id)
      REFERENCES task_activity_assignment (task_activity_assignment_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_task_source_invalidation_event_type CHECK (
    source_event_type = 'activity.enrollment.canceled.v1'
  ),
  CONSTRAINT chk_task_source_invalidation_reason CHECK (
    reason_code IN ('USER_CANCELED', 'SESSION_CANCELED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
