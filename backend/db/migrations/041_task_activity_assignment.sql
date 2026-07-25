-- Task Module projection created only from a persisted, confirmed Activity
-- enrollment event. The source binding version is frozen in the event payload;
-- an unversioned Activity binding must fail closed before this table is written.

CREATE TABLE IF NOT EXISTS task_activity_assignment (
  task_activity_assignment_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  task_definition_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  task_definition_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_enrollment_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  initial_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_confirmed_event_id VARCHAR(64) COLLATE utf8mb4_0900_bin NOT NULL,
  source_confirmed_event_type VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_confirmed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (task_activity_assignment_id),
  UNIQUE KEY uk_task_activity_assignment_source (
    activity_enrollment_id,
    task_definition_id,
    task_definition_version
  ),
  UNIQUE KEY uk_task_activity_assignment_confirmed_event (source_confirmed_event_id),
  KEY idx_task_activity_assignment_user_status (root_user_id, initial_status, updated_at),
  KEY idx_task_activity_assignment_session (activity_session_id, initial_status),
  CONSTRAINT fk_task_activity_assignment_user
    FOREIGN KEY (root_user_id) REFERENCES root_user (root_user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_task_activity_assignment_definition
    FOREIGN KEY (task_definition_id) REFERENCES task_definition (task_definition_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_task_activity_assignment_enrollment
    FOREIGN KEY (activity_enrollment_id) REFERENCES activity_enrollment (activity_enrollment_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_task_activity_assignment_session
    FOREIGN KEY (activity_session_id) REFERENCES activity_session (activity_session_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_task_activity_assignment_initial_status CHECK (
    initial_status = 'AVAILABLE'
  ),
  CONSTRAINT chk_task_activity_assignment_confirmed_contract CHECK (
    source_confirmed_event_type = 'activity.enrollment.confirmed.v1'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
