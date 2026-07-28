-- Replay output is isolated from the generation-1 serving projection. A
-- composite foreign key binds every shadow fact to one governed SHADOW_REBUILD
-- run and to that run's generation; VERIFY_ONLY runs have no generation and
-- therefore cannot own shadow rows.

CREATE TABLE IF NOT EXISTS task_share_completion_shadow_projection (
  shadow_projection_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replay_run_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  projection_generation BIGINT UNSIGNED NOT NULL,
  source_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
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
  source_handler_registration_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_handler_id VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (shadow_projection_id),
  UNIQUE KEY uk_task_share_shadow_receipt (
    replay_run_id,
    source_receipt_id
  ),
  UNIQUE KEY uk_task_share_shadow_task_event (
    projection_generation,
    task_event_id
  ),
  UNIQUE KEY uk_task_share_shadow_source_event (
    projection_generation,
    source_event_id
  ),
  CONSTRAINT chk_task_share_shadow_generation
    CHECK (projection_generation >= 2),
  CONSTRAINT chk_task_share_shadow_source_contract
    CHECK (
      source_event_type = 'task.event.recorded.v1'
      AND source_schema_version = '1'
      AND source_name = 'myroot-api'
      AND source_partition_key = CONCAT('task_event:', task_event_id)
      AND source_partition_position = 1
      AND source_aggregate_version = 1
    ),
  CONSTRAINT chk_task_share_shadow_outcome_contract
    CHECK (
      task_type = 'SHARE'
      AND completion_event_type = 'SHARE_COMPLETED'
    ),
  CONSTRAINT chk_task_share_shadow_handler_identity
    CHECK (
      source_handler_registration_digest REGEXP '^[0-9a-f]{64}$'
      AND execution_handler_id = 'task-share-completion-shadow-v1'
      AND execution_handler_version = 'task-share-shadow-v1'
    ),
  CONSTRAINT fk_task_share_shadow_replay_generation
    FOREIGN KEY (replay_run_id, projection_generation)
    REFERENCES inbox_replay_run (replay_run_id, shadow_generation)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT fk_task_share_shadow_source_receipt
    FOREIGN KEY (source_receipt_id)
    REFERENCES inbox_receipt (inbox_receipt_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
