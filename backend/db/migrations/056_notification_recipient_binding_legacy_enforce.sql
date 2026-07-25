-- Enforce all-or-none recipient binding metadata on the legacy grant table.
-- This migration owns exactly one permanent ALTER because MySQL DDL
-- implicitly commits.
DROP TEMPORARY TABLE IF EXISTS migration_056_notification_recipient_legacy_preflight;

CREATE TEMPORARY TABLE migration_056_notification_recipient_legacy_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_056_notification_recipient_legacy_preflight (guard_id) VALUES (1);

INSERT INTO migration_056_notification_recipient_legacy_preflight (guard_id)
SELECT 1
FROM notification_subscription_grant
WHERE recipient_binding_status IS NULL
   OR recipient_binding_status NOT IN ('VERIFIED', 'UNVERIFIED')
   OR NOT (
     (
       recipient_binding_status = 'UNVERIFIED'
       AND recipient_wechat_identity_id IS NULL
       AND recipient_app_code IS NULL
       AND recipient_binding_canonical_version IS NULL
       AND recipient_binding_digest IS NULL
       AND recipient_binding_digest_scheme IS NULL
       AND recipient_binding_key_id IS NULL
       AND status = 'REVIEW_REQUIRED'
     )
     OR (
       recipient_binding_status = 'VERIFIED'
       AND recipient_wechat_identity_id IS NOT NULL
       AND recipient_app_code IS NOT NULL
       AND recipient_app_code = 'MYROOT'
       AND recipient_binding_canonical_version IS NOT NULL
       AND recipient_binding_canonical_version = 'canonical-json:v1'
       AND recipient_binding_digest IS NOT NULL
       AND recipient_binding_digest REGEXP '^[0-9a-f]{64}$'
       AND recipient_binding_digest_scheme IS NOT NULL
       AND recipient_binding_digest_scheme = 'hmac-sha256:v1'
       AND recipient_binding_key_id IS NOT NULL
       AND recipient_binding_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     )
   )
LIMIT 1;

DROP TEMPORARY TABLE migration_056_notification_recipient_legacy_preflight;

ALTER TABLE notification_subscription_grant
  MODIFY COLUMN recipient_binding_status VARCHAR(16)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UNVERIFIED',
  ADD KEY idx_notification_recipient_binding_crypto (
    recipient_binding_digest_scheme,
    recipient_binding_key_id,
    notification_subscription_grant_id
  ),
  ADD KEY idx_notification_recipient_identity (
    recipient_wechat_identity_id,
    recipient_binding_status,
    notification_subscription_grant_id
  ),
  ADD CONSTRAINT chk_notification_recipient_binding
    CHECK (
      (
        recipient_binding_status = 'UNVERIFIED'
        AND recipient_wechat_identity_id IS NULL
        AND recipient_app_code IS NULL
        AND recipient_binding_canonical_version IS NULL
        AND recipient_binding_digest IS NULL
        AND recipient_binding_digest_scheme IS NULL
        AND recipient_binding_key_id IS NULL
        AND status = 'REVIEW_REQUIRED'
      )
      OR (
        recipient_binding_status = 'VERIFIED'
        AND recipient_wechat_identity_id IS NOT NULL
        AND recipient_app_code IS NOT NULL
        AND recipient_app_code = 'MYROOT'
        AND recipient_binding_canonical_version IS NOT NULL
        AND recipient_binding_canonical_version = 'canonical-json:v1'
        AND recipient_binding_digest IS NOT NULL
        AND recipient_binding_digest REGEXP '^[0-9a-f]{64}$'
        AND recipient_binding_digest_scheme IS NOT NULL
        AND recipient_binding_digest_scheme = 'hmac-sha256:v1'
        AND recipient_binding_key_id IS NOT NULL
        AND recipient_binding_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      )
    );
