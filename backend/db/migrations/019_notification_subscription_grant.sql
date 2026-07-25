CREATE TABLE IF NOT EXISTS notification_subscription_grant_v1 (
  notification_subscription_grant_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_subscription_attempt_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  root_user_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_occurrence_date DATE NOT NULL,
  template_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grant_request_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reserved_job_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status_reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  granted_at DATETIME(3) NOT NULL,
  reserved_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  invalidated_at DATETIME(3) NULL,
  review_required_at DATETIME(3) NULL,
  release_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (notification_subscription_grant_id),
  CONSTRAINT chk_notification_subscription_grant_v1_status
    CHECK (status IN ('AVAILABLE', 'RESERVED', 'CONSUMED', 'INVALID', 'REVIEW_REQUIRED')),
  UNIQUE KEY uk_notification_subscription_grant_v1_attempt (notification_subscription_attempt_id),
  UNIQUE KEY uk_notification_subscription_grant_v1_grant_request (grant_request_id),
  UNIQUE KEY uk_notification_subscription_grant_v1_occurrence
    (root_user_id, task_id, task_occurrence_date, template_version),
  UNIQUE KEY uk_notification_subscription_grant_v1_reserved_job (reserved_job_id),
  CONSTRAINT fk_notification_subscription_grant_attempt
    FOREIGN KEY (notification_subscription_attempt_id)
    REFERENCES notification_subscription_attempt_v1 (notification_subscription_attempt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
