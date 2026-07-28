-- Governed Replay authority is created only after a selection has been sealed
-- and two distinct principals have authorized the run. This table stores no
-- event payload, member identity, health content, free-form reason, or error
-- detail. Runtime execution is intentionally outside this migration.

CREATE TABLE IF NOT EXISTS inbox_replay_run (
  replay_run_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replay_mode VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_registry_version INT UNSIGNED NOT NULL,
  policy_registry_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_id VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version INT UNSIGNED NOT NULL,
  policy_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consumer_name VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_name VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  event_type VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  schema_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aggregate_type VARCHAR(96)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_receipt_status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_handler_id VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_handler_registry_version INT UNSIGNED NOT NULL,
  source_handler_descriptor_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_handler_source_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_handler_registration_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_consumer_name VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_handler_id VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_handler_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_projection_policy VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shadow_generation BIGINT UNSIGNED NULL,
  cursor_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_query_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_query_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_after_first_received_at DATETIME(3) NULL,
  selection_after_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  selection_through_first_received_at DATETIME(3) NOT NULL,
  selection_through_receipt_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_snapshot_at DATETIME(3) NOT NULL,
  selection_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  maximum_selected_count INT UNSIGNED NOT NULL,
  selected_receipt_count BIGINT UNSIGNED NOT NULL,
  requested_by_actor_id VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  authorized_by_actor_id VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  authorized_at DATETIME(3) NOT NULL,
  authorization_ticket_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  maximum_authorization_ttl_seconds INT UNSIGNED NOT NULL,
  authorization_expires_at DATETIME(3) NOT NULL,
  lease_owner VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  replay_transition_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  processed_receipt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  verified_receipt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  shadow_inserted_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  shadow_replayed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_receipt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  result_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error_code VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (replay_run_id),
  UNIQUE KEY uk_inbox_replay_scope_generation (
    consumer_name,
    source_name,
    source_handler_id,
    shadow_generation
  ),
  UNIQUE KEY uk_inbox_replay_run_generation (
    replay_run_id,
    shadow_generation
  ),
  UNIQUE KEY uk_inbox_replay_execution_consumer (
    execution_consumer_name
  ),
  CONSTRAINT chk_inbox_replay_mode_supported
    CHECK (replay_mode IN ('VERIFY_ONLY', 'SHADOW_REBUILD')),
  CONSTRAINT chk_inbox_replay_status_supported
    CHECK (status IN (
      'APPROVED',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'EXPIRED',
      'REVIEW_REQUIRED'
    )),
  CONSTRAINT chk_inbox_replay_reason_supported
    CHECK (
      (
        policy_id = 'TASK_SHARE_VERIFY_V1'
        AND reason_code IN (
          'INCIDENT_VERIFICATION',
          'MIGRATION_PARITY_REVIEW'
        )
      )
      OR
      (
        policy_id = 'TASK_SHARE_SHADOW_REBUILD_V1'
        AND reason_code IN (
          'HANDLER_UPGRADE_VALIDATION',
          'MIGRATION_PARITY_REVIEW'
        )
      )
    ),
  CONSTRAINT chk_inbox_replay_policy_identity
    CHECK (
      policy_registry_version = 1
      AND policy_registry_digest REGEXP '^[0-9a-f]{64}$'
      AND policy_id IN (
        'TASK_SHARE_SHADOW_REBUILD_V1',
        'TASK_SHARE_VERIFY_V1'
      )
      AND policy_version = 1
      AND policy_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_inbox_replay_source_contract
    CHECK (
      consumer_name = 'task-share-completion-projection'
      AND source_name = 'myroot-api'
      AND event_type = 'task.event.recorded.v1'
      AND schema_version = '1'
      AND aggregate_type = 'TASK_EVENT'
      AND source_receipt_status = 'SUCCEEDED'
    ),
  CONSTRAINT chk_inbox_replay_handler_identity
    CHECK (
      source_handler_id = 'task-share-completion-projection-v1'
      AND source_handler_version = 'task-share-completion-v1'
      AND source_handler_registry_version = 1
      AND source_handler_descriptor_digest REGEXP '^[0-9a-f]{64}$'
      AND source_handler_source_digest REGEXP '^[0-9a-f]{64}$'
      AND source_handler_registration_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_inbox_replay_selection_query
    CHECK (
      cursor_version = 'FIRST_RECEIVED_AT_RECEIPT_ID_V1'
      AND selection_query_id = 'task_share_succeeded_receipts_by_received_at_v1'
      AND selection_query_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_inbox_replay_mode_generation
    CHECK (
      (
        replay_mode = 'VERIFY_ONLY'
        AND policy_id = 'TASK_SHARE_VERIFY_V1'
        AND execution_handler_id = 'task-share-completion-verify-v1'
        AND execution_handler_version = 'task-share-verify-v1'
        AND execution_consumer_name REGEXP '^task-share-verify-v1:[0-9a-f]{32}$'
        AND target_projection_policy = 'PRODUCTION_GENERATION_1_READ_ONLY'
        AND shadow_generation IS NULL
      )
      OR
      (
        replay_mode = 'SHADOW_REBUILD'
        AND policy_id = 'TASK_SHARE_SHADOW_REBUILD_V1'
        AND execution_handler_id = 'task-share-completion-shadow-v1'
        AND execution_handler_version = 'task-share-shadow-v1'
        AND execution_consumer_name REGEXP '^task-share-shadow-rebuild-v1:[0-9a-f]{32}$'
        AND target_projection_policy = 'SHADOW_GENERATION_GE_2'
        AND shadow_generation >= 2
      )
    ),
  CONSTRAINT chk_inbox_replay_cursor_contract
    CHECK (
      cursor_version = 'FIRST_RECEIVED_AT_RECEIPT_ID_V1'
      AND (
        (
          selection_after_first_received_at IS NULL
          AND selection_after_receipt_id IS NULL
        )
        OR
        (
          selection_after_first_received_at IS NOT NULL
          AND selection_after_receipt_id IS NOT NULL
          AND (
            selection_after_first_received_at < selection_through_first_received_at
            OR
            (
              selection_after_first_received_at = selection_through_first_received_at
              AND selection_after_receipt_id < selection_through_receipt_id
            )
          )
        )
      )
    ),
  CONSTRAINT chk_inbox_replay_selection_sealed
    CHECK (
      selection_digest REGEXP '^[0-9a-f]{64}$'
      AND maximum_selected_count = 10000
      AND selected_receipt_count BETWEEN 1 AND maximum_selected_count
      AND authorized_at <= selection_snapshot_at
      AND selection_snapshot_at < authorization_expires_at
    ),
  CONSTRAINT chk_inbox_replay_two_person_authorization
    CHECK (
      requested_by_actor_id <> authorized_by_actor_id
      AND requested_at <= authorized_at
      AND authorization_ticket_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_inbox_replay_authorization_ttl
    CHECK (
      maximum_authorization_ttl_seconds = 3600
      AND authorization_expires_at >= TIMESTAMPADD(
        SECOND,
        60,
        authorized_at
      )
      AND authorization_expires_at <= TIMESTAMPADD(
        SECOND,
        maximum_authorization_ttl_seconds,
        authorized_at
      )
    ),
  CONSTRAINT chk_inbox_replay_count_bounds
    CHECK (
      processed_receipt_count <= selected_receipt_count
      AND verified_receipt_count + failed_receipt_count = processed_receipt_count
      AND (
        (
          replay_mode = 'VERIFY_ONLY'
          AND shadow_inserted_count = 0
          AND shadow_replayed_count = 0
        )
        OR
        (
          replay_mode = 'SHADOW_REBUILD'
          AND shadow_inserted_count + shadow_replayed_count = verified_receipt_count
        )
      )
    ),
  CONSTRAINT chk_inbox_replay_state_shape
    CHECK (
      (
        status = 'APPROVED'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation = 0
        AND replay_transition_id IS NULL
        AND processed_receipt_count = 0
        AND started_at IS NULL
        AND completed_at IS NULL
        AND result_digest IS NULL
        AND last_error_code IS NULL
      )
      OR
      (
        status = 'RUNNING'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_generation >= 1
        AND replay_transition_id IS NOT NULL
        AND started_at IS NOT NULL
        AND completed_at IS NULL
        AND result_digest IS NULL
        AND last_error_code IS NULL
      )
      OR
      (
        status = 'SUCCEEDED'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND replay_transition_id IS NOT NULL
        AND processed_receipt_count = selected_receipt_count
        AND verified_receipt_count = selected_receipt_count
        AND failed_receipt_count = 0
        AND result_digest REGEXP '^[0-9a-f]{64}$'
        AND last_error_code IS NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
      OR
      (
        status IN ('FAILED', 'REVIEW_REQUIRED')
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND replay_transition_id IS NOT NULL
        AND result_digest IS NULL
        AND last_error_code IS NOT NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
      OR
      (
        status = 'EXPIRED'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation = 0
        AND replay_transition_id IS NULL
        AND processed_receipt_count = 0
        AND result_digest IS NULL
        AND last_error_code = 'AUTHORIZATION_EXPIRED'
        AND started_at IS NULL
        AND completed_at IS NOT NULL
      )
    ),
  KEY idx_inbox_replay_dispatch (
    status,
    authorization_expires_at,
    replay_run_id
  ),
  KEY idx_inbox_replay_lease_recovery (
    status,
    lease_expires_at,
    lease_generation,
    replay_run_id
  ),
  KEY idx_inbox_replay_selection (
    consumer_name,
    source_name,
    event_type,
    selection_through_first_received_at,
    selection_through_receipt_id
  ),
  KEY idx_inbox_replay_approval_inventory (
    requested_by_actor_id,
    authorized_by_actor_id,
    authorized_at
  )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
