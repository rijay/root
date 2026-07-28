CREATE TABLE IF NOT EXISTS notification_job_v1 (
  notification_job_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_subscription_grant_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  root_user_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_occurrence_date DATE NOT NULL,
  template_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  due_at DATETIME(3) NOT NULL,
  send_attempt_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  stable_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  release_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (notification_job_id),
  CONSTRAINT chk_notification_job_v1_status
    CHECK (status IN ('SCHEDULED', 'SENDING', 'PROVIDER_ACCEPTED', 'SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELED')),
  UNIQUE KEY uk_notification_job_v1_grant (notification_subscription_grant_id),
  UNIQUE KEY uk_notification_job_v1_occurrence
    (root_user_id, task_id, task_occurrence_date, template_version),
  UNIQUE KEY uk_notification_job_v1_send_attempt (send_attempt_id),
  KEY idx_notification_job_v1_due (status, due_at),
  CONSTRAINT fk_notification_job_grant
    FOREIGN KEY (notification_subscription_grant_id)
    REFERENCES notification_subscription_grant_v1 (notification_subscription_grant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
