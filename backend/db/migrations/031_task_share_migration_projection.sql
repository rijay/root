-- Isolated synthetic target for V1-T05 Foundation evidence. It is not a
-- serving projection. Writes are INSERT-only and contain no member identity,
-- health content, payload, outbox or provider receipt.

CREATE TABLE IF NOT EXISTS task_share_migration_projection (
  target_record_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_task_event_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  completion_event_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  source_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (target_record_id),
  UNIQUE KEY uk_task_share_migration_source_schema (
    contract_id, source_task_event_id, target_schema_version
  ),
  CONSTRAINT chk_task_share_migration_scope
    CHECK (
      contract_id = 'TASK_SHARE_SYNTHETIC_V1'
      AND target_schema_version = 'TASK_SHARE_MIGRATION_V1'
      AND task_type = 'SHARE'
      AND completion_event_type = 'SHARE_COMPLETED'
    ),
  CONSTRAINT chk_task_share_migration_checksum_shape
    CHECK (
      source_checksum REGEXP '^[0-9a-f]{64}$'
      AND target_checksum REGEXP '^[0-9a-f]{64}$'
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
