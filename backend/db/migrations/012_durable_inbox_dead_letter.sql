-- Inbox dead-letter fencing is independent permanent authority. Keep its DDL
-- isolated from receipt and checkpoint changes so each migration has exactly
-- one atomic ALTER TABLE. Existing OUTBOX dead letters remain valid, while an
-- historical INBOX dead letter fails closed before permanent DDL.

DROP TEMPORARY TABLE IF EXISTS migration_012_inbox_dead_letter_preflight;

CREATE TEMPORARY TABLE migration_012_inbox_dead_letter_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_012_inbox_dead_letter_preflight (guard_id) VALUES (1);

INSERT INTO migration_012_inbox_dead_letter_preflight (guard_id)
SELECT 1
FROM event_dead_letter
WHERE direction = 'INBOX'
LIMIT 1;

DROP TEMPORARY TABLE migration_012_inbox_dead_letter_preflight;

ALTER TABLE event_dead_letter
  MODIFY COLUMN event_dead_letter_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN direction VARCHAR(16)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN source_record_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN consumer_name VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  MODIFY COLUMN event_id VARCHAR(64)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN event_type VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN reason_code VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN replay_request_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN source_lease_generation BIGINT UNSIGNED NULL
    AFTER source_record_id,
  ADD COLUMN source_transition_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER source_lease_generation,
  ADD CONSTRAINT chk_dead_letter_direction_supported
    CHECK (direction IN ('OUTBOX', 'INBOX')),
  ADD CONSTRAINT chk_dead_letter_inbox_metadata
    CHECK (
      direction <> 'INBOX'
      OR
      (
        consumer_name IS NOT NULL
        AND source_lease_generation IS NOT NULL
        AND source_transition_id IS NOT NULL
        AND payload_json IS NULL
      )
    ),
  ADD KEY idx_dead_letter_source_transition (
    direction,
    source_transition_id,
    source_record_id
  ),
  ADD KEY idx_dead_letter_inbox_open (
    direction,
    consumer_name,
    status,
    created_at
  );
