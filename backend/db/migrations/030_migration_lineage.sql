-- Item-level lineage. MIGRATION is the unique base event for a source and
-- target schema. Replay, conflict, quarantine and reversal are append-only
-- events: the base checksum is never overwritten.

CREATE TABLE IF NOT EXISTS migration_lineage (
  migration_lineage_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_lineage_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lineage_identity VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lineage_event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_sequence BIGINT UNSIGNED NOT NULL,
  migration_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  fact_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_revision VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cursor_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cursor_value VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tie_breaker VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inclusive TINYINT(1) NOT NULL,
  target_schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  replayed_at DATETIME(3) NULL,
  reversed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (migration_lineage_id),
  UNIQUE KEY uk_migration_lineage_base (base_lineage_identity),
  UNIQUE KEY uk_migration_lineage_sequence (lineage_identity, event_sequence),
  UNIQUE KEY uk_migration_lineage_request (
    migration_run_id, batch_id, source_id, lineage_event_type, request_id
  ),
  KEY idx_migration_lineage_run_status (
    migration_run_id, status, cursor_value, tie_breaker
  ),
  KEY idx_migration_lineage_source_target (
    contract_id, source_type, source_id, target_schema_version
  ),
  CONSTRAINT fk_migration_lineage_run
    FOREIGN KEY (migration_run_id)
    REFERENCES migration_run (migration_run_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_migration_lineage_event_type
    CHECK (lineage_event_type IN (
      'MIGRATION', 'APPLY_AFTER_DRY_RUN', 'IDEMPOTENT_RETRY',
      'FORWARD_REPLAY', 'CONFLICT', 'QUARANTINE', 'REVERSAL'
    )),
  CONSTRAINT chk_migration_lineage_status
    CHECK (status IN (
      'MIGRATED', 'IDEMPOTENT', 'DRY_RUN_VERIFIED', 'FORWARD_REPLAYED',
      'CONFLICT', 'QUARANTINED', 'REVIEW_REQUIRED', 'REVERSED'
    )),
  CONSTRAINT chk_migration_lineage_identity_shape
    CHECK (
      lineage_identity REGEXP '^[0-9a-f]{64}$'
      AND (
        (
          lineage_event_type = 'MIGRATION'
          AND base_lineage_identity = lineage_identity
          AND event_sequence = 1
        )
        OR (
          lineage_event_type <> 'MIGRATION'
          AND base_lineage_identity IS NULL
          AND event_sequence >= 1
        )
      )
    ),
  CONSTRAINT chk_migration_lineage_checksum_shape
    CHECK (
      source_checksum REGEXP '^[0-9a-f]{64}$'
      AND target_checksum REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_migration_lineage_cursor_shape
    CHECK (
      cursor_type = 'OCCURRED_AT_TASK_EVENT_ID_V1'
      AND cursor_value IS NOT NULL
      AND tie_breaker IS NOT NULL
      AND inclusive = 0
    ),
  CONSTRAINT chk_migration_lineage_temporal_shape
    CHECK (
      (
        (lineage_event_type = 'FORWARD_REPLAY' OR status = 'FORWARD_REPLAYED')
        AND replayed_at IS NOT NULL
        AND reversed_at IS NULL
      )
      OR (lineage_event_type = 'REVERSAL' AND replayed_at IS NULL AND reversed_at IS NOT NULL)
      OR (
        lineage_event_type NOT IN ('FORWARD_REPLAY', 'REVERSAL')
        AND status <> 'FORWARD_REPLAYED'
        AND replayed_at IS NULL
        AND reversed_at IS NULL
      )
    ),
  CONSTRAINT chk_migration_lineage_error_shape
    CHECK (
      (
        status IN ('CONFLICT', 'QUARANTINED', 'REVIEW_REQUIRED')
        AND error_code IS NOT NULL
        AND error_code IN ('TARGET_CONFLICT', 'TARGET_QUARANTINED', 'PARITY_MISMATCH', 'IDENTITY_DRIFT')
      )
      OR (
        status NOT IN ('CONFLICT', 'QUARANTINED', 'REVIEW_REQUIRED')
        AND error_code IS NULL
      )
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
