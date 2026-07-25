-- Append-only relational outbox dispatcher metadata. The producer envelope
-- remains compatible because every new column has a safe default or is NULL.
-- Identity and lease comparisons are byte-exact before dispatcher code is
-- allowed to claim or advance these facts.

ALTER TABLE outbox_event
  MODIFY COLUMN topic VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN dedupe_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN partition_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN payload_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN lease_owner VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN retry_policy_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'outbox-retry-v1'
    AFTER max_attempts,
  ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER lease_expires_at,
  ADD COLUMN dispatch_transition_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER lease_generation,
  ADD CONSTRAINT chk_outbox_partition_position_positive
    CHECK (partition_position >= 1),
  ADD KEY idx_outbox_lease_owner (
    lease_owner,
    status,
    lease_generation
  ),
  ADD KEY idx_outbox_transition (
    dispatch_transition_id,
    outbox_event_id
  ),
  ADD KEY idx_outbox_lease_recovery (
    status,
    lease_expires_at,
    outbox_event_id
  ),
  ADD KEY idx_outbox_pending_due (
    status,
    retry_policy_version,
    available_at,
    outbox_event_id
  ),
  ADD KEY idx_outbox_retry_due (
    status,
    retry_policy_version,
    next_retry_at,
    outbox_event_id
  ),
  ADD KEY idx_outbox_partition_head (
    source_name,
    partition_key,
    partition_position,
    status
  );

ALTER TABLE event_dead_letter
  MODIFY COLUMN source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN partition_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN payload_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
