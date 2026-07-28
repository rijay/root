CREATE TABLE IF NOT EXISTS notification_send_attempt_transition (
  notification_send_attempt_transition_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_send_attempt_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_number BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_fence_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_receipt_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  stable_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  release_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (notification_send_attempt_transition_id),
  CONSTRAINT chk_notification_send_attempt_transition_from
    CHECK (from_status IS NULL OR from_status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN')),
  CONSTRAINT chk_notification_send_attempt_transition_to
    CHECK (to_status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN')),
  CONSTRAINT chk_notification_send_attempt_transition_receipt
    CHECK (
      (to_status = 'ACCEPTED' AND provider_receipt_digest IS NOT NULL)
      OR (to_status <> 'ACCEPTED' AND provider_receipt_digest IS NULL)
    ),
  UNIQUE KEY uk_notification_send_attempt_transition_number
    (notification_send_attempt_id, transition_number),
  UNIQUE KEY uk_notification_send_attempt_transition_fence (transition_fence_digest),
  CONSTRAINT fk_notification_send_attempt_transition_attempt
    FOREIGN KEY (notification_send_attempt_id)
    REFERENCES notification_send_attempt (notification_send_attempt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
