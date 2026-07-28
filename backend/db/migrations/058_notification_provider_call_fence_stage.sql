-- Stage persistent provider-call ownership without inventing evidence for
-- existing attempts. This migration owns exactly one permanent ALTER because
-- MySQL DDL implicitly commits.

ALTER TABLE notification_send_attempt
  ADD COLUMN provider_call_state VARCHAR(24)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER request_digest,
  ADD COLUMN provider_call_owner VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER provider_call_state,
  ADD COLUMN provider_call_lease_expires_at DATETIME(3) NULL
    AFTER provider_call_owner,
  ADD COLUMN provider_call_generation BIGINT UNSIGNED NULL
    AFTER provider_call_lease_expires_at,
  ADD COLUMN provider_call_started_at DATETIME(3) NULL
    AFTER provider_call_generation;
