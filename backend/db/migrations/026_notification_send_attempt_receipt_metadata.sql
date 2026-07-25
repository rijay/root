-- A legacy digest cannot be assigned an HMAC scheme or key id by inference.
-- Existing attempts therefore require explicit review before this ALTER.
DROP TEMPORARY TABLE IF EXISTS migration_026_notification_attempt_preflight;

CREATE TEMPORARY TABLE migration_026_notification_attempt_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_026_notification_attempt_preflight (guard_id) VALUES (1);

INSERT INTO migration_026_notification_attempt_preflight (guard_id)
SELECT 1 FROM notification_send_attempt LIMIT 1;

DROP TEMPORARY TABLE migration_026_notification_attempt_preflight;

ALTER TABLE notification_send_attempt
  DROP CHECK chk_notification_send_attempt_accepted_receipt,
  ADD COLUMN provider_receipt_digest_scheme VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL AFTER provider_receipt_digest,
  ADD COLUMN provider_receipt_digest_key_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL AFTER provider_receipt_digest_scheme,
  ADD CONSTRAINT chk_notification_send_attempt_receipt_digest
    CHECK (provider_receipt_digest IS NULL OR provider_receipt_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_notification_send_attempt_accepted_receipt
    CHECK (
      (
        status = 'ACCEPTED'
        AND provider_receipt_digest IS NOT NULL
        AND provider_receipt_digest_scheme IS NOT NULL
        AND provider_receipt_digest_scheme = 'hmac-sha256:v1'
        AND provider_receipt_digest_key_id IS NOT NULL
        AND provider_receipt_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      )
      OR (
        status <> 'ACCEPTED'
        AND provider_receipt_digest IS NULL
        AND provider_receipt_digest_scheme IS NULL
        AND provider_receipt_digest_key_id IS NULL
      )
    ),
  ADD CONSTRAINT chk_notification_send_attempt_stable_error
    CHECK (
      (status IN ('REQUESTED', 'ACCEPTED') AND stable_error_code IS NULL)
      OR (status = 'REJECTED' AND stable_error_code IS NOT NULL AND stable_error_code IN (
        'WECHAT_NO_GRANT',
        'WECHAT_REJECTED',
        'PROVIDER_CONFIRMED_NOT_SENT'
      ))
      OR (status = 'FAILED' AND stable_error_code IS NOT NULL AND stable_error_code IN (
        'SEND_FAILED',
        'WECHAT_SEND_FAILED',
        'PROVIDER_REQUEST_INVALID'
      ))
      OR (status = 'UNKNOWN' AND stable_error_code IS NOT NULL AND stable_error_code IN (
        'PROVIDER_RESULT_UNKNOWN',
        'HTTP_OUTCOME_UNKNOWN',
        'NETWORK_OUTCOME_UNKNOWN',
        'NON_JSON_OUTCOME_UNKNOWN'
      ))
    );
