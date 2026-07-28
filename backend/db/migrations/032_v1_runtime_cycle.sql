-- Persistent V1 runtime cycle ledger. A schedule occurrence has exactly one
-- environment-scoped identity; lease generation fences late finalizers.

CREATE TABLE IF NOT EXISTS v1_runtime_cycle (
  runtime_cycle_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schedule_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  input_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lease_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  claim_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  finalization_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  blocker_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (runtime_cycle_id),
  UNIQUE KEY uk_v1_runtime_cycle_schedule (environment_id, schedule_id),
  UNIQUE KEY uk_v1_runtime_cycle_scope_identity (
    runtime_cycle_id, environment_id, schedule_id, input_digest
  ),
  KEY idx_v1_runtime_cycle_recovery (
    environment_id, status, lease_expires_at, runtime_cycle_id
  ),
  KEY idx_v1_runtime_cycle_attestation (
    environment_id, status, completed_at, runtime_cycle_id
  ),
  CONSTRAINT chk_v1_runtime_cycle_status
    CHECK (status IN (
      'RUNNING', 'SUCCEEDED', 'SKIPPED_BUSY',
      'FAILED_PRECONDITION', 'REVIEW_REQUIRED'
    )),
  CONSTRAINT chk_v1_runtime_cycle_digest_shape
    CHECK (
      runtime_cycle_id REGEXP '^[0-9a-f]{64}$'
      AND input_digest REGEXP '^[0-9a-f]{64}$'
      AND claim_digest REGEXP '^[0-9a-f]{64}$'
      AND (finalization_digest IS NULL OR finalization_digest REGEXP '^[0-9a-f]{64}$')
      AND (result_digest IS NULL OR result_digest REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT chk_v1_runtime_cycle_error_code
    CHECK (
      error_code IS NULL
      OR error_code REGEXP '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  CONSTRAINT chk_v1_runtime_cycle_state_shape
    CHECK (
      (
        status = 'RUNNING'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_generation > 0
        AND finalization_digest IS NULL
        AND result_digest IS NULL
        AND blocker_count = 0
        AND error_code IS NULL
        AND completed_at IS NULL
      )
      OR (
        status <> 'RUNNING'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation > 0
        AND finalization_digest IS NOT NULL
        AND result_digest IS NOT NULL
        AND completed_at IS NOT NULL
        AND (
          (status = 'SUCCEEDED' AND blocker_count = 0 AND error_code IS NULL)
          OR (status = 'SKIPPED_BUSY' AND blocker_count = 0 AND error_code IS NOT NULL)
          OR (
            status IN ('FAILED_PRECONDITION', 'REVIEW_REQUIRED')
            AND blocker_count > 0
            AND error_code IS NOT NULL
          )
        )
      )
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
