-- Privacy-minimized, rebuildable projection for the v1 SHARE task outcome.
-- It intentionally stores no actor, member identifier, payload, or health
-- content. The projection writer is INSERT-only; deterministic identities and
-- unique source facts make repeated delivery idempotent and conflicting writes
-- fail closed.

CREATE TABLE IF NOT EXISTS task_share_completion_projection (
  projection_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  projection_generation TINYINT UNSIGNED NOT NULL DEFAULT 1,
  task_event_id VARCHAR(64)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_event_id VARCHAR(64)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_event_type VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_schema_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_partition_key VARCHAR(191)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_partition_position BIGINT UNSIGNED NOT NULL,
  source_aggregate_version BIGINT UNSIGNED NOT NULL,
  task_type VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  completion_event_type VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  handler_registration_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (projection_id),
  UNIQUE KEY uk_task_share_projection_task_event (
    projection_generation,
    task_event_id
  ),
  UNIQUE KEY uk_task_share_projection_source_event (
    projection_generation,
    source_event_id
  ),
  CONSTRAINT chk_task_share_projection_generation
    CHECK (projection_generation = 1),
  CONSTRAINT chk_task_share_projection_source_contract
    CHECK (
      source_event_type = 'task.event.recorded.v1'
      AND source_schema_version = '1'
      AND source_name = 'myroot-api'
      AND source_partition_key = CONCAT('task_event:', task_event_id)
      AND source_partition_position = 1
      AND source_aggregate_version = 1
    ),
  CONSTRAINT chk_task_share_projection_outcome_contract
    CHECK (
      task_type = 'SHARE'
      AND completion_event_type = 'SHARE_COMPLETED'
    ),
  CONSTRAINT chk_task_share_projection_handler_version
    CHECK (handler_version = 'task-share-completion-v1'),
  CONSTRAINT chk_task_share_projection_registration_digest
    CHECK (handler_registration_digest REGEXP '^[0-9a-f]{64}$')
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
