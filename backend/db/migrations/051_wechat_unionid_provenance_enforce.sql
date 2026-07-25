-- Fail before permanent DDL if any row cannot satisfy provenance and
-- one-identity-per-root/application invariants.
DROP TEMPORARY TABLE IF EXISTS migration_051_wechat_identity_preflight;

CREATE TEMPORARY TABLE migration_051_wechat_identity_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_051_wechat_identity_preflight (guard_id) VALUES (1);

INSERT INTO migration_051_wechat_identity_preflight (guard_id)
SELECT 1
FROM wechat_identity
WHERE unionid_trust_status IS NULL
   OR unionid_trust_status NOT IN ('VERIFIED', 'UNVERIFIED')
   OR NOT (
     (
       unionid_trust_status = 'UNVERIFIED'
       AND unionid_status IS NOT NULL
       AND unionid_status = 'PENDING'
       AND unionid_provenance_source IS NULL
       AND unionid_verified_at IS NULL
       AND unionid_provenance_canonical_version IS NULL
       AND unionid_provenance_digest IS NULL
       AND unionid_provenance_digest_scheme IS NULL
       AND unionid_provenance_key_id IS NULL
     )
     OR (
       unionid_trust_status = 'VERIFIED'
       AND unionid IS NOT NULL
       AND unionid_status IS NOT NULL
       AND unionid_status = 'LINKED'
       AND unionid_provenance_source IS NOT NULL
       AND unionid_provenance_source IN ('CLOUDBASE', 'WECHAT_GATEWAY', 'WECHAT_CODE2SESSION')
       AND unionid_verified_at IS NOT NULL
       AND unionid_provenance_canonical_version IS NOT NULL
       AND unionid_provenance_canonical_version = 'canonical-json:v1'
       AND unionid_provenance_digest IS NOT NULL
       AND unionid_provenance_digest REGEXP '^[0-9a-f]{64}$'
       AND unionid_provenance_digest_scheme IS NOT NULL
       AND unionid_provenance_digest_scheme = 'hmac-sha256:v1'
       AND unionid_provenance_key_id IS NOT NULL
       AND unionid_provenance_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     )
   )
LIMIT 1;

INSERT INTO migration_051_wechat_identity_preflight (guard_id)
SELECT 1
FROM wechat_identity
GROUP BY root_user_id, app_code
HAVING COUNT(*) > 1
LIMIT 1;

DROP TEMPORARY TABLE migration_051_wechat_identity_preflight;

ALTER TABLE wechat_identity
  MODIFY COLUMN unionid_trust_status VARCHAR(16)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UNVERIFIED',
  ADD UNIQUE KEY uk_wechat_identity_root_app (root_user_id, app_code),
  ADD KEY idx_wechat_identity_unionid_authority (
    unionid,
    unionid_trust_status,
    root_user_id
  ),
  ADD KEY idx_wechat_identity_provenance_crypto (
    unionid_provenance_digest_scheme,
    unionid_provenance_key_id,
    wechat_identity_id
  ),
  ADD CONSTRAINT chk_wechat_identity_unionid_provenance
    CHECK (
      (
        unionid_trust_status = 'UNVERIFIED'
        AND unionid_status IS NOT NULL
        AND unionid_status = 'PENDING'
        AND unionid_provenance_source IS NULL
        AND unionid_verified_at IS NULL
        AND unionid_provenance_canonical_version IS NULL
        AND unionid_provenance_digest IS NULL
        AND unionid_provenance_digest_scheme IS NULL
        AND unionid_provenance_key_id IS NULL
      )
      OR (
        unionid_trust_status = 'VERIFIED'
        AND unionid IS NOT NULL
        AND unionid_status IS NOT NULL
        AND unionid_status = 'LINKED'
        AND unionid_provenance_source IS NOT NULL
        AND unionid_provenance_source IN ('CLOUDBASE', 'WECHAT_GATEWAY', 'WECHAT_CODE2SESSION')
        AND unionid_verified_at IS NOT NULL
        AND unionid_provenance_canonical_version IS NOT NULL
        AND unionid_provenance_canonical_version = 'canonical-json:v1'
        AND unionid_provenance_digest IS NOT NULL
        AND unionid_provenance_digest REGEXP '^[0-9a-f]{64}$'
        AND unionid_provenance_digest_scheme IS NOT NULL
        AND unionid_provenance_digest_scheme = 'hmac-sha256:v1'
        AND unionid_provenance_key_id IS NOT NULL
        AND unionid_provenance_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      )
    );
