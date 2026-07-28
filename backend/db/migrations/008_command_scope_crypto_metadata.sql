-- Make command scope equality byte-exact and record the cryptographic and
-- retention metadata needed for safe replay, key rotation and tombstoning.
-- Existing rows retain truthful compatibility defaults for the digest and
-- retention implementations already used before this migration.

ALTER TABLE command_idempotency
  MODIFY COLUMN command_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN actor_id VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN idempotency_key VARCHAR(191)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN request_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD COLUMN request_digest_scheme VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'sha256:v0'
    AFTER request_digest,
  ADD COLUMN request_digest_key_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER request_digest_scheme,
  ADD COLUMN result_codec_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_ref,
  ADD COLUMN result_key_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_codec_version,
  ADD COLUMN retention_policy_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'command-retention-v1'
    AFTER retain_until,
  ADD COLUMN tombstone_reason VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER tombstoned_at,
  ADD KEY idx_command_idempotency_digest_crypto (
    request_digest_scheme,
    request_digest_key_id,
    command_idempotency_id
  ),
  ADD KEY idx_command_idempotency_result_crypto (
    result_codec_version,
    result_key_id,
    command_idempotency_id
  ),
  ADD KEY idx_command_idempotency_retention_policy (
    retention_policy_version,
    retain_until,
    tombstoned_at
  ),
  ADD KEY idx_command_idempotency_tombstone (
    tombstoned_at,
    tombstone_reason,
    command_idempotency_id
  );
