-- Freeze the exact MYROOT identity on each legacy subscription grant. The
-- OpenID is not duplicated; a keyed digest binds its current value to the
-- durable grant. This migration owns exactly one permanent ALTER because
-- MySQL DDL implicitly commits.

ALTER TABLE notification_subscription_grant
  ADD COLUMN recipient_binding_status VARCHAR(16)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER source_channel,
  ADD COLUMN recipient_wechat_identity_id VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_binding_status,
  ADD COLUMN recipient_app_code VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_wechat_identity_id,
  ADD COLUMN recipient_binding_canonical_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_app_code,
  ADD COLUMN recipient_binding_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_binding_canonical_version,
  ADD COLUMN recipient_binding_digest_scheme VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_binding_digest,
  ADD COLUMN recipient_binding_key_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER recipient_binding_digest_scheme;
