CREATE TABLE IF NOT EXISTS notification_subscription_attempt_v1 (
  notification_subscription_attempt_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  root_user_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_occurrence_date DATE NOT NULL,
  template_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grant_request_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  native_decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decided_at DATETIME(3) NOT NULL,
  release_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (notification_subscription_attempt_id),
  CONSTRAINT chk_notification_subscription_attempt_v1_decision
    CHECK (native_decision IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN')),
  UNIQUE KEY uk_notification_subscription_attempt_v1_grant_request (grant_request_id),
  UNIQUE KEY uk_notification_subscription_attempt_v1_occurrence
    (root_user_id, task_id, task_occurrence_date, template_version),
  UNIQUE KEY uk_notification_subscription_attempt_v1_idempotency (idempotency_key)
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
