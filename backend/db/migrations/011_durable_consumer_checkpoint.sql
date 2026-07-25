-- The consumer checkpoint is independent permanent authority. Keep its DDL in
-- a dedicated migration so a failure cannot implicitly commit only part of the
-- durable Inbox authority set. Historical checkpoints lack sufficient evidence
-- for a deterministic upgrade and therefore fail closed before permanent DDL.

DROP TEMPORARY TABLE IF EXISTS migration_011_consumer_checkpoint_preflight;

CREATE TEMPORARY TABLE migration_011_consumer_checkpoint_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_011_consumer_checkpoint_preflight (guard_id) VALUES (1);

INSERT INTO migration_011_consumer_checkpoint_preflight (guard_id)
SELECT 1
FROM consumer_checkpoint
LIMIT 1;

DROP TEMPORARY TABLE migration_011_consumer_checkpoint_preflight;

ALTER TABLE consumer_checkpoint
  MODIFY COLUMN consumer_checkpoint_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN consumer_name VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN partition_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN gap_status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN last_event_id VARCHAR(64)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  MODIFY COLUMN last_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN state_generation BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER high_watermark_position,
  ADD COLUMN checkpoint_transition_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER state_generation,
  ADD COLUMN gap_reason_code VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER gap_to_position,
  ADD COLUMN blocked_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER gap_reason_code,
  ADD CONSTRAINT chk_checkpoint_position_order
    CHECK (last_contiguous_position <= high_watermark_position),
  ADD CONSTRAINT chk_checkpoint_last_receipt_shape
    CHECK (
      (
        last_contiguous_position = 0
        AND last_event_id IS NULL
        AND last_receipt_id IS NULL
      )
      OR
      (
        last_contiguous_position > 0
        AND last_event_id IS NOT NULL
        AND last_receipt_id IS NOT NULL
      )
    ),
  ADD CONSTRAINT chk_checkpoint_gap_shape
    CHECK (
      (
        gap_status = 'CLEAR'
        AND gap_from_position IS NULL
        AND gap_to_position IS NULL
        AND gap_reason_code IS NULL
        AND blocked_receipt_id IS NULL
      )
      OR
      (
        gap_status = 'MISSING'
        AND gap_from_position IS NOT NULL
        AND gap_to_position IS NOT NULL
        AND gap_from_position = last_contiguous_position + 1
        AND gap_from_position <= gap_to_position
        AND gap_to_position <= high_watermark_position
        AND gap_reason_code IS NOT NULL
        AND blocked_receipt_id IS NULL
      )
      OR
      (
        gap_status = 'BLOCKED_DEAD_LETTER'
        AND gap_from_position IS NOT NULL
        AND gap_to_position IS NOT NULL
        AND gap_from_position = last_contiguous_position + 1
        AND gap_to_position = gap_from_position
        AND gap_to_position <= high_watermark_position
        AND gap_reason_code IS NOT NULL
        AND blocked_receipt_id IS NOT NULL
      )
      OR
      (
        gap_status = 'REVIEW_REQUIRED'
        AND gap_from_position IS NOT NULL
        AND gap_to_position IS NOT NULL
        AND gap_from_position = last_contiguous_position + 1
        AND gap_from_position <= gap_to_position
        AND gap_to_position <= high_watermark_position
        AND gap_reason_code IS NOT NULL
      )
    ),
  ADD KEY idx_checkpoint_dispatch (
    gap_status,
    consumer_name,
    source_name,
    partition_key
  ),
  ADD KEY idx_checkpoint_handler (
    handler_version,
    gap_status,
    updated_at
  ),
  ADD KEY idx_checkpoint_transition (
    checkpoint_transition_id,
    consumer_checkpoint_id
  );
