-- Stage cryptographically verifiable UnionID provenance. Historical rows stay
-- nullable until migration 050 truthfully marks them UNVERIFIED.

ALTER TABLE wechat_identity
  ADD COLUMN unionid_trust_status VARCHAR(16)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_status,
  ADD COLUMN unionid_provenance_source VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_trust_status,
  ADD COLUMN unionid_verified_at DATETIME(3) NULL
    AFTER unionid_provenance_source,
  ADD COLUMN unionid_provenance_canonical_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_verified_at,
  ADD COLUMN unionid_provenance_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_provenance_canonical_version,
  ADD COLUMN unionid_provenance_digest_scheme VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_provenance_digest,
  ADD COLUMN unionid_provenance_key_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER unionid_provenance_digest_scheme;
