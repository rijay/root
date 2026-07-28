-- Durable inbox processing requires the complete event envelope and a fenced
-- receipt state machine. Migration 006 never had a relational Inbox Adapter,
-- so no historical receipt can be upgraded without authoritative envelope and
-- handler-outcome evidence. This migration owns only inbox_receipt permanent
-- DDL so MySQL cannot leave later authority tables partially upgraded.

DROP TEMPORARY TABLE IF EXISTS migration_010_durable_inbox_preflight;

CREATE TEMPORARY TABLE migration_010_durable_inbox_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_010_durable_inbox_preflight (guard_id) VALUES (1);

INSERT INTO migration_010_durable_inbox_preflight (guard_id)
SELECT 1
FROM inbox_receipt
LIMIT 1;

DROP TEMPORARY TABLE migration_010_durable_inbox_preflight;

ALTER TABLE inbox_receipt
  MODIFY COLUMN inbox_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN consumer_name VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN partition_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN event_id VARCHAR(64)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN event_type VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN schema_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN aggregate_type VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN aggregate_id VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN payload_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN occurred_at DATETIME(3) NOT NULL
    AFTER aggregate_version,
  ADD COLUMN producer_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER occurred_at,
  ADD COLUMN correlation_id VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL
    AFTER producer_version,
  ADD COLUMN causation_id VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL
    AFTER correlation_id,
  ADD COLUMN idempotency_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL
    AFTER causation_id,
  ADD COLUMN max_attempts INT UNSIGNED NOT NULL DEFAULT 5
    AFTER attempt_count,
  ADD COLUMN retry_policy_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'inbox-retry-v1'
    AFTER max_attempts,
  ADD COLUMN next_retry_at DATETIME(3) NULL
    AFTER retry_policy_version,
  ADD COLUMN lease_owner VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER next_retry_at,
  ADD COLUMN lease_expires_at DATETIME(3) NULL
    AFTER lease_owner,
  ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER lease_expires_at,
  ADD COLUMN inbox_transition_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER lease_generation,
  ADD COLUMN result_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_json,
  ADD COLUMN completion_manifest_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_digest,
  ADD COLUMN dead_lettered_at DATETIME(3) NULL
    AFTER failed_at,
  ADD CONSTRAINT chk_inbox_receipt_status_supported
    CHECK (status IN (
      'RECEIVED',
      'CLAIMED',
      'RETRY_PENDING',
      'SUCCEEDED',
      'DEAD_LETTER',
      'REVIEW_REQUIRED'
    )),
  ADD CONSTRAINT chk_inbox_partition_position_positive
    CHECK (partition_position >= 1),
  ADD CONSTRAINT chk_inbox_attempt_bounds
    CHECK (max_attempts >= 1 AND attempt_count <= max_attempts),
  ADD CONSTRAINT chk_inbox_lease_shape
    CHECK (
      (
        status = 'CLAIMED'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND inbox_transition_id IS NOT NULL
      )
      OR
      (
        status <> 'CLAIMED'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  ADD CONSTRAINT chk_inbox_retry_shape
    CHECK (
      (status = 'RETRY_PENDING' AND next_retry_at IS NOT NULL)
      OR
      (status <> 'RETRY_PENDING' AND next_retry_at IS NULL)
    ),
  ADD CONSTRAINT chk_inbox_completion_shape
    CHECK (
      (
        status = 'SUCCEEDED'
        AND completed_at IS NOT NULL
        AND result_json IS NOT NULL
        AND result_digest IS NOT NULL
        AND completion_manifest_digest IS NOT NULL
        AND inbox_transition_id IS NOT NULL
      )
      OR
      (
        status <> 'SUCCEEDED'
        AND completed_at IS NULL
        AND result_json IS NULL
        AND result_digest IS NULL
        AND completion_manifest_digest IS NULL
      )
    ),
  ADD CONSTRAINT chk_inbox_dead_letter_shape
    CHECK (
      (
        status = 'DEAD_LETTER'
        AND dead_lettered_at IS NOT NULL
        AND inbox_transition_id IS NOT NULL
      )
      OR
      (status <> 'DEAD_LETTER' AND dead_lettered_at IS NULL)
    ),
  ADD KEY idx_inbox_retry_due (
    status,
    retry_policy_version,
    next_retry_at,
    inbox_receipt_id
  ),
  ADD KEY idx_inbox_lease_recovery (
    status,
    lease_expires_at,
    inbox_receipt_id
  ),
  ADD KEY idx_inbox_lease_owner (
    lease_owner,
    status,
    lease_generation
  ),
  ADD KEY idx_inbox_transition (
    inbox_transition_id,
    inbox_receipt_id
  ),
  ADD KEY idx_inbox_partition_head (
    consumer_name,
    source_name,
    partition_key,
    partition_position,
    status
  ),
  ADD KEY idx_inbox_idempotency (
    consumer_name,
    idempotency_key,
    event_id
  );
