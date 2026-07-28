-- Activity publication is authorized by a trusted Adapter. This migration owns
-- one permanent DDL statement so an acknowledgement loss can be reconciled from
-- the exact information_schema postcondition before any replay is attempted.

ALTER TABLE activity_definition_version
  ADD COLUMN publication_authorization_adapter_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER publish_owner_signer_ref,
  ADD COLUMN publication_authorization_decision_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER publication_authorization_adapter_id,
  ADD COLUMN publication_authorized_principal_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER publication_authorization_decision_ref,
  ADD COLUMN controlled_approval_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER publication_authorized_principal_ref,
  ADD COLUMN content_authorization_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER controlled_approval_ref,
  ADD COLUMN ued_acceptance_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER content_authorization_digest,
  ADD COLUMN photography_authorization_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ued_acceptance_digest,
  ADD COLUMN artifact_provenance_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER photography_authorization_digest,
  ADD COLUMN authorization_verified_at DATETIME(3) NULL AFTER artifact_provenance_digest,
  ADD UNIQUE KEY uk_activity_definition_publication_decision (
    publication_authorization_adapter_id, publication_authorization_decision_ref
  ),
  ADD CONSTRAINT chk_activity_definition_authorization_shape CHECK (
    (
      status = 'PUBLISHED'
      AND publication_authorization_adapter_id IS NOT NULL
      AND publication_authorization_decision_ref IS NOT NULL
      AND publication_authorized_principal_ref IS NOT NULL
      AND controlled_approval_ref IS NOT NULL
      AND controlled_approval_ref = content_approval_ref
      AND content_authorization_digest IS NOT NULL
      AND content_authorization_digest REGEXP '^[a-f0-9]{64}$'
      AND ued_acceptance_digest IS NOT NULL
      AND ued_acceptance_digest REGEXP '^[a-f0-9]{64}$'
      AND photography_authorization_digest IS NOT NULL
      AND photography_authorization_digest REGEXP '^[a-f0-9]{64}$'
      AND artifact_provenance_digest IS NOT NULL
      AND artifact_provenance_digest REGEXP '^[a-f0-9]{64}$'
      AND authorization_verified_at IS NOT NULL
    )
    OR status <> 'PUBLISHED'
  );
