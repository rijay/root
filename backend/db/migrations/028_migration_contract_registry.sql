-- Static per-fact migration contract identity. Runtime can only materialize the
-- registered TASK_SHARE synthetic scope; this migration performs no data copy.

CREATE TABLE IF NOT EXISTS migration_contract_registry (
  contract_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  registry_version INT UNSIGNED NOT NULL,
  registry_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authoritative_source VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_query_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_query_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_adapter_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_adapter_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parity_adapter_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parity_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cursor_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inclusive TINYINT(1) NOT NULL,
  maximum_batch_size INT UNSIGNED NOT NULL,
  allows_network TINYINT(1) NOT NULL,
  allows_outbox TINYINT(1) NOT NULL,
  contract_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (contract_id, contract_version),
  UNIQUE KEY uk_migration_contract_identity (
    contract_id, contract_version, contract_digest
  ),
  CONSTRAINT chk_migration_contract_registered_scope
    CHECK (
      contract_id = 'TASK_SHARE_SYNTHETIC_V1'
      AND contract_version = 1
      AND registry_version = 1
      AND fact_type = 'TASK_SHARE'
      AND authoritative_source = 'LEGACY_TASK_EVENT'
      AND source_type = 'LEGACY_TASK_EVENT'
      AND source_query_id = 'task_share_legacy_succeeded_by_occurred_at_v1'
      AND source_adapter_id = 'task-share-legacy-source-reader-v1'
      AND target_type = 'TASK_SHARE_MIGRATION_PROJECTION'
      AND target_schema_version = 'TASK_SHARE_MIGRATION_V1'
      AND target_adapter_id = 'task-share-migration-target-writer-v1'
      AND parity_adapter_id = 'task-share-migration-parity-v1'
      AND cursor_type = 'OCCURRED_AT_TASK_EVENT_ID_V1'
      AND inclusive = 0
      AND maximum_batch_size = 100
      AND allows_network = 0
      AND allows_outbox = 0
      AND status = 'ACTIVE'
    ),
  CONSTRAINT chk_migration_contract_digest_shape
    CHECK (
      registry_digest REGEXP '^[0-9a-f]{64}$'
      AND source_query_digest REGEXP '^[0-9a-f]{64}$'
      AND source_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND target_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND parity_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND contract_digest REGEXP '^[0-9a-f]{64}$'
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
