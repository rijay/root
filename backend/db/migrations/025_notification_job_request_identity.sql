-- A schedule request identity cannot be reconstructed from historical rows.
-- Any existing Job requires a separately approved data migration.
DROP TEMPORARY TABLE IF EXISTS migration_025_notification_job_preflight;

CREATE TEMPORARY TABLE migration_025_notification_job_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_025_notification_job_preflight (guard_id) VALUES (1);

INSERT INTO migration_025_notification_job_preflight (guard_id)
SELECT 1 FROM notification_job_v1 LIMIT 1;

DROP TEMPORARY TABLE migration_025_notification_job_preflight;

ALTER TABLE notification_job_v1
  ADD COLUMN idempotency_key VARCHAR(191)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER due_at,
  ADD COLUMN request_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER idempotency_key,
  ADD CONSTRAINT chk_notification_job_v1_request_digest
    CHECK (request_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_notification_job_v1_stable_error
    CHECK (
      (status IN ('SCHEDULED', 'SENDING', 'PROVIDER_ACCEPTED', 'CANCELED') AND stable_error_code IS NULL)
      OR (status = 'SKIPPED' AND stable_error_code IS NOT NULL AND stable_error_code IN ('ALREADY_CHECKED_IN', 'NO_SUBSCRIPTION', 'NO_GRANT'))
      OR (status = 'FAILED' AND stable_error_code IS NOT NULL AND stable_error_code IN (
        'WECHAT_NO_GRANT',
        'WECHAT_REJECTED',
        'PROVIDER_CONFIRMED_NOT_SENT',
        'SEND_FAILED',
        'WECHAT_SEND_FAILED',
        'PROVIDER_REQUEST_INVALID'
      ))
      OR (status = 'OUTCOME_UNKNOWN' AND stable_error_code IS NOT NULL AND stable_error_code IN (
        'PROVIDER_RESULT_UNKNOWN',
        'HTTP_OUTCOME_UNKNOWN',
        'NETWORK_OUTCOME_UNKNOWN',
        'NON_JSON_OUTCOME_UNKNOWN'
      ))
    ),
  ADD UNIQUE KEY uk_notification_job_v1_idempotency (idempotency_key);
