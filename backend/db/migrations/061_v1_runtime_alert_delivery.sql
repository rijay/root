-- This is a new, empty delivery ledger, so no historical rows exist to stage
-- or backfill. One CREATE is safer than a staged ALTER: alert insertion and
-- delivery registration can become atomic from the first row. The exact
-- Structure Guard rejects a pre-existing table with any weaker shape.

CREATE TABLE IF NOT EXISTS v1_runtime_alert_delivery (
  runtime_alert_delivery_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  runtime_alert_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_authority_version VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_ref VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest_scheme VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_schema_version VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_canonical_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_digest_scheme VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_digest_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slo_class VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slo_target_seconds INT UNSIGNED NOT NULL,
  retry_policy_version VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  maximum_attempts TINYINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  lease_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  provider_started_at DATETIME(3) NULL,
  provider_completed_at DATETIME(3) NULL,
  receipt_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  receipt_digest_scheme VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  receipt_digest_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  stable_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (runtime_alert_delivery_id),
  UNIQUE KEY uk_v1_runtime_alert_delivery_alert_authority (runtime_alert_id),
  KEY idx_v1_runtime_alert_delivery_due (
    environment_id, registration_mode, receiver_binding_ref,
    receiver_binding_authority_version, status, available_at, slo_target_seconds,
    runtime_alert_delivery_id
  ),
  KEY idx_v1_runtime_alert_delivery_recovery (
    environment_id, registration_mode, receiver_binding_ref,
    receiver_binding_authority_version, status, lease_expires_at,
    runtime_alert_delivery_id
  ),
  KEY idx_v1_runtime_alert_delivery_crypto (
    receiver_binding_digest_key_id, payload_digest_key_id,
    receipt_digest_key_id, runtime_alert_delivery_id
  ),
  CONSTRAINT fk_v1_runtime_alert_delivery_alert
    FOREIGN KEY (runtime_alert_id)
    REFERENCES v1_runtime_alert (runtime_alert_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_v1_runtime_alert_delivery_status
    CHECK (status IN (
      'PENDING', 'CLAIMED', 'RETRY_WAIT', 'STARTED',
      'DELIVERED', 'DEAD_LETTER', 'UNKNOWN'
    )),
  CONSTRAINT chk_v1_runtime_alert_delivery_identity
    CHECK (
      runtime_alert_delivery_id REGEXP '^[0-9a-f]{64}$'
      AND runtime_alert_id REGEXP '^[0-9a-f]{64}$'
      AND receiver_binding_ref REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND receiver_binding_digest REGEXP '^[0-9a-f]{64}$'
      AND receiver_binding_digest_scheme = 'hmac-sha256:v1'
      AND receiver_binding_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_authority
    CHECK (
      registration_mode IN ('DRY_RUN', 'CONTROLLED')
      AND receiver_binding_authority_version = 'runtime-alert-receiver-authority:v1'
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_payload
    CHECK (
      payload_schema_version = 'myroot.runtime-alert.delivery.v1'
      AND payload_canonical_version = 'canonical-json:v1'
      AND payload_digest REGEXP '^[0-9a-f]{64}$'
      AND payload_digest_scheme = 'hmac-sha256:v1'
      AND payload_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_slo
    CHECK (
      (slo_class = 'BLOCKER_IMMEDIATE' AND slo_target_seconds = 300)
      OR (slo_class = 'WARNING_STANDARD' AND slo_target_seconds = 1800)
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_attempts
    CHECK (
      retry_policy_version = 'pre-provider-exponential:v1'
      AND maximum_attempts BETWEEN 1 AND 5
      AND attempt_count <= maximum_attempts
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_receipt
    CHECK (
      (
        status = 'DELIVERED'
        AND receipt_digest IS NOT NULL
        AND receipt_digest REGEXP '^[0-9a-f]{64}$'
        AND receipt_digest_scheme IS NOT NULL
        AND receipt_digest_scheme = 'hmac-sha256:v1'
        AND receipt_digest_key_id IS NOT NULL
        AND receipt_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      )
      OR (
        status <> 'DELIVERED'
        AND receipt_digest IS NULL
        AND receipt_digest_scheme IS NULL
        AND receipt_digest_key_id IS NULL
      )
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_error
    CHECK (
      (
        status IN ('PENDING', 'CLAIMED', 'STARTED', 'DELIVERED')
        AND stable_error_code IS NULL
      )
      OR (
        status IN ('RETRY_WAIT', 'DEAD_LETTER', 'UNKNOWN')
        AND stable_error_code IS NOT NULL
        AND stable_error_code REGEXP '^[A-Z][A-Z0-9_]{0,63}$'
      )
    ),
  CONSTRAINT chk_v1_runtime_alert_delivery_state
    CHECK (
      (
        status = 'PENDING'
        AND attempt_count = 0
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation = 0
        AND provider_started_at IS NULL
        AND provider_completed_at IS NULL
      )
      OR (
        status = 'CLAIMED'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_generation >= 1
        AND provider_started_at IS NULL
        AND provider_completed_at IS NULL
      )
      OR (
        status = 'RETRY_WAIT'
        AND attempt_count >= 1
        AND attempt_count < maximum_attempts
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND provider_started_at IS NULL
        AND provider_completed_at IS NULL
      )
      OR (
        status = 'STARTED'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_generation >= 1
        AND provider_started_at IS NOT NULL
        AND provider_started_at < lease_expires_at
        AND provider_completed_at IS NULL
      )
      OR (
        status = 'DELIVERED'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND provider_started_at IS NOT NULL
        AND provider_completed_at IS NOT NULL
        AND provider_started_at <= provider_completed_at
      )
      OR (
        status = 'DEAD_LETTER'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND provider_started_at IS NULL
        AND provider_completed_at IS NOT NULL
      )
      OR (
        status = 'UNKNOWN'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_generation >= 1
        AND provider_started_at IS NOT NULL
        AND provider_completed_at IS NOT NULL
        AND provider_started_at <= provider_completed_at
      )
    )
) ENGINE = InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
