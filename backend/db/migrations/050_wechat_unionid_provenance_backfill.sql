-- No historical UnionID has durable provenance. Never infer trust from the
-- former LINKED flag or from the legacy root_user summary.

UPDATE wechat_identity
SET unionid_trust_status = 'UNVERIFIED',
    unionid_status = 'PENDING',
    unionid_provenance_source = NULL,
    unionid_verified_at = NULL,
    unionid_provenance_canonical_version = NULL,
    unionid_provenance_digest = NULL,
    unionid_provenance_digest_scheme = NULL,
    unionid_provenance_key_id = NULL
WHERE unionid_trust_status IS NULL;

UPDATE root_user
SET unionid = NULL,
    unionid_status = 'PENDING'
WHERE unionid IS NOT NULL
   OR unionid_status <> 'PENDING';
