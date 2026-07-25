-- Governed, default-disabled migration execution run. Lease fencing and exact
-- contract identity prevent two workers or drifted adapters from advancing the
-- same contiguous cursor.

CREATE TABLE IF NOT EXISTS migration_run (
  migration_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registry_version INT UNSIGNED NOT NULL,
  registry_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  contract_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  migration_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_revision VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_at DATETIME(3) NOT NULL,
  source_query_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_query_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parity_adapter_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replay_source_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  replay_source_result_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  replay_through_cursor_value VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  replay_through_tie_breaker VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cursor_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cursor_value VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cursor_tie_breaker VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  inclusive TINYINT(1) NOT NULL,
  last_contiguous_cursor_value VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_contiguous_tie_breaker VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  transition_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  processed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  migrated_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  idempotent_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quarantined_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  review_required_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  batch_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  result_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  opened_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (migration_run_id),
  UNIQUE KEY uk_migration_run_request (contract_id, request_id),
  KEY idx_migration_run_dispatch (status, lease_expires_at, migration_run_id),
  KEY idx_migration_run_snapshot (contract_id, snapshot_id, snapshot_revision),
  KEY fk_migration_run_contract (contract_id, contract_version, contract_digest),
  KEY idx_migration_run_replay_source (replay_source_run_id),
  CONSTRAINT fk_migration_run_contract
    FOREIGN KEY (contract_id, contract_version, contract_digest)
    REFERENCES migration_contract_registry (
      contract_id, contract_version, contract_digest
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_migration_run_replay_source
    FOREIGN KEY (replay_source_run_id)
    REFERENCES migration_run (migration_run_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_migration_run_mode
    CHECK (migration_mode IN ('DRY_RUN', 'APPLY', 'FORWARD_REPLAY')),
  CONSTRAINT chk_migration_run_status
    CHECK (status IN (
      'OPEN', 'RUNNING', 'PARITY_PENDING', 'VERIFIED',
      'REVIEW_REQUIRED', 'FAILED', 'ACK_UNKNOWN'
    )),
  CONSTRAINT chk_migration_run_digest_shape
    CHECK (
      registry_digest REGEXP '^[0-9a-f]{64}$'
      AND contract_digest REGEXP '^[0-9a-f]{64}$'
      AND source_query_digest REGEXP '^[0-9a-f]{64}$'
      AND source_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND target_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND parity_adapter_digest REGEXP '^[0-9a-f]{64}$'
      AND (result_digest IS NULL OR result_digest REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT chk_migration_run_cursor_shape
    CHECK (
      cursor_type = 'OCCURRED_AT_TASK_EVENT_ID_V1'
      AND inclusive = 0
      AND (
        (cursor_value IS NULL AND cursor_tie_breaker IS NULL)
        OR (cursor_value IS NOT NULL AND cursor_tie_breaker IS NOT NULL)
      )
      AND (
        (last_contiguous_cursor_value IS NULL AND last_contiguous_tie_breaker IS NULL)
        OR (
          last_contiguous_cursor_value IS NOT NULL
          AND last_contiguous_tie_breaker IS NOT NULL
          AND last_contiguous_cursor_value = cursor_value
          AND last_contiguous_tie_breaker = cursor_tie_breaker
        )
      )
    ),
  CONSTRAINT chk_migration_run_replay_binding
    CHECK (
      (
        migration_mode = 'FORWARD_REPLAY'
        AND replay_source_run_id IS NOT NULL
        AND replay_source_result_digest IS NOT NULL
        AND replay_source_result_digest REGEXP '^[0-9a-f]{64}$'
        AND replay_through_cursor_value IS NOT NULL
        AND replay_through_tie_breaker IS NOT NULL
        AND cursor_value IS NOT NULL
        AND cursor_tie_breaker IS NOT NULL
        AND (
          cursor_value < replay_through_cursor_value
          OR (
            cursor_value = replay_through_cursor_value
            AND cursor_tie_breaker <= replay_through_tie_breaker
          )
        )
      )
      OR (
        migration_mode <> 'FORWARD_REPLAY'
        AND replay_source_run_id IS NULL
        AND replay_source_result_digest IS NULL
        AND replay_through_cursor_value IS NULL
        AND replay_through_tie_breaker IS NULL
      )
    ),
  CONSTRAINT chk_migration_run_lease_shape
    CHECK (
      (
        status = 'RUNNING'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_generation > 0
        AND transition_id IS NOT NULL
      )
      OR (
        status <> 'RUNNING'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  CONSTRAINT chk_migration_run_count_shape
    CHECK (
      processed_count = migrated_count + idempotent_count
        + conflict_count + quarantined_count + review_required_count
      AND conflict_count + quarantined_count + review_required_count <= 1
    ),
  CONSTRAINT chk_migration_run_terminal_shape
    CHECK (
      (status = 'VERIFIED' AND verified_at IS NOT NULL AND completed_at IS NOT NULL)
      OR (status <> 'VERIFIED' AND verified_at IS NULL)
    ),
  CONSTRAINT chk_migration_run_error_code
    CHECK (
      (last_error_code IS NULL)
      OR (last_error_code IN (
        'SOURCE_DRIFT', 'TARGET_CONFLICT', 'TARGET_QUARANTINED',
        'PARITY_MISMATCH', 'IDENTITY_DRIFT', 'LEASE_EXPIRED',
        'PERSISTENCE_FAILED', 'ACK_UNKNOWN'
      ))
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
