CREATE TABLE IF NOT EXISTS notification_send_attempt (
  notification_send_attempt_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_job_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_version BIGINT UNSIGNED NOT NULL,
  transition_fence_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_receipt_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  stable_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  release_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (notification_send_attempt_id),
  CONSTRAINT chk_notification_send_attempt_number CHECK (attempt_number = 1),
  CONSTRAINT chk_notification_send_attempt_provider CHECK (provider = 'WECHAT'),
  CONSTRAINT chk_notification_send_attempt_status
    CHECK (status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN')),
  CONSTRAINT chk_notification_send_attempt_accepted_receipt
    CHECK (
      (status = 'ACCEPTED' AND provider_receipt_digest IS NOT NULL)
      OR (status <> 'ACCEPTED' AND provider_receipt_digest IS NULL)
    ),
  CONSTRAINT chk_notification_send_attempt_completed
    CHECK (status = 'REQUESTED' OR completed_at IS NOT NULL),
  UNIQUE KEY uk_notification_send_attempt_job (notification_job_id),
  UNIQUE KEY uk_notification_send_attempt_job_number (notification_job_id, attempt_number),
  UNIQUE KEY uk_notification_send_attempt_fence (transition_fence_digest),
  UNIQUE KEY uk_notification_send_attempt_provider_receipt (provider_receipt_digest),
  CONSTRAINT fk_notification_send_attempt_job
    FOREIGN KEY (notification_job_id)
    REFERENCES notification_job_v1 (notification_job_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
