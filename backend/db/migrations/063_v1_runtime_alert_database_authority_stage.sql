-- AUTHORITY_STAGE: the repository migration runner and Structure Guard parse
-- DELIMITER-aware compound routines.  Runtime registration still fails closed
-- until an environment-specific authority row and least-privilege principals
-- are provisioned and independently verified.
-- Environment authority rows, principals, roles and grants are deliberately
-- provisioned outside this schema migration.  An empty authority table is the
-- fail-closed initial state.

DELIMITER $$

CREATE TABLE IF NOT EXISTS v1_runtime_alert_registration_authority (
  environment_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authority_generation BIGINT UNSIGNED NOT NULL,
  registration_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_authority_version VARCHAR(48)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_ref VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest_scheme VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receiver_binding_digest_key_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activated_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (environment_id),
  KEY idx_v1_runtime_alert_registration_authority_status (
    status, registration_mode, environment_id
  ),
  KEY idx_v1_runtime_alert_registration_authority_crypto (
    receiver_binding_digest_key_id, environment_id
  ),
  CONSTRAINT chk_v1_runtime_alert_registration_authority_generation
    CHECK (authority_generation >= 1),
  CONSTRAINT chk_v1_runtime_alert_registration_authority_mode
    CHECK (registration_mode IN ('DRY_RUN', 'CONTROLLED')),
  CONSTRAINT chk_v1_runtime_alert_registration_authority_binding
    CHECK (
      receiver_binding_authority_version = 'runtime-alert-receiver-authority:v1'
      AND receiver_binding_ref REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND receiver_binding_digest REGEXP '^[0-9a-f]{64}$'
      AND receiver_binding_digest_scheme = 'hmac-sha256:v1'
      AND receiver_binding_digest_key_id
        REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  CONSTRAINT chk_v1_runtime_alert_registration_authority_status
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT chk_v1_runtime_alert_registration_authority_time
    CHECK (activated_at <= updated_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_register_dry_run$$
CREATE PROCEDURE v1_runtime_alert_delivery_register_dry_run (
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_runtime_alert_id CHAR(64),
  IN p_environment_id VARCHAR(96),
  IN p_payload_digest CHAR(64),
  IN p_payload_digest_key_id VARCHAR(64),
  IN p_slo_class VARCHAR(32),
  IN p_slo_target_seconds INT UNSIGNED,
  IN p_maximum_attempts TINYINT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  INSERT INTO v1_runtime_alert_delivery (
    runtime_alert_delivery_id, runtime_alert_id, environment_id,
    registration_mode, receiver_binding_authority_version,
    receiver_binding_ref, receiver_binding_digest,
    receiver_binding_digest_scheme, receiver_binding_digest_key_id,
    payload_schema_version, payload_canonical_version, payload_digest,
    payload_digest_scheme, payload_digest_key_id, slo_class,
    slo_target_seconds, retry_policy_version, maximum_attempts,
    status, attempt_count, available_at, lease_generation,
    created_at, updated_at
  )
  SELECT
    p_runtime_alert_delivery_id, p_runtime_alert_id, p_environment_id,
    authority.registration_mode,
    authority.receiver_binding_authority_version,
    authority.receiver_binding_ref,
    authority.receiver_binding_digest,
    authority.receiver_binding_digest_scheme,
    authority.receiver_binding_digest_key_id,
    'myroot.runtime-alert.delivery.v1', 'canonical-json:v1',
    p_payload_digest, 'hmac-sha256:v1', p_payload_digest_key_id,
    p_slo_class, p_slo_target_seconds, 'pre-provider-exponential:v1',
    p_maximum_attempts, 'PENDING', 0, CURRENT_TIMESTAMP(3), 0,
    CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM v1_runtime_alert_registration_authority AS authority
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_alert_id = p_runtime_alert_id
   AND runtime_alert.environment_id = p_environment_id
  WHERE authority.environment_id = p_environment_id
    AND authority.status = 'ACTIVE'
    AND authority.registration_mode = 'DRY_RUN';
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_register_controlled$$
CREATE PROCEDURE v1_runtime_alert_delivery_register_controlled (
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_runtime_alert_id CHAR(64),
  IN p_environment_id VARCHAR(96),
  IN p_payload_digest CHAR(64),
  IN p_payload_digest_key_id VARCHAR(64),
  IN p_slo_class VARCHAR(32),
  IN p_slo_target_seconds INT UNSIGNED,
  IN p_maximum_attempts TINYINT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  INSERT INTO v1_runtime_alert_delivery (
    runtime_alert_delivery_id, runtime_alert_id, environment_id,
    registration_mode, receiver_binding_authority_version,
    receiver_binding_ref, receiver_binding_digest,
    receiver_binding_digest_scheme, receiver_binding_digest_key_id,
    payload_schema_version, payload_canonical_version, payload_digest,
    payload_digest_scheme, payload_digest_key_id, slo_class,
    slo_target_seconds, retry_policy_version, maximum_attempts,
    status, attempt_count, available_at, lease_generation,
    created_at, updated_at
  )
  SELECT
    p_runtime_alert_delivery_id, p_runtime_alert_id, p_environment_id,
    authority.registration_mode,
    authority.receiver_binding_authority_version,
    authority.receiver_binding_ref,
    authority.receiver_binding_digest,
    authority.receiver_binding_digest_scheme,
    authority.receiver_binding_digest_key_id,
    'myroot.runtime-alert.delivery.v1', 'canonical-json:v1',
    p_payload_digest, 'hmac-sha256:v1', p_payload_digest_key_id,
    p_slo_class, p_slo_target_seconds, 'pre-provider-exponential:v1',
    p_maximum_attempts, 'PENDING', 0, CURRENT_TIMESTAMP(3), 0,
    CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM v1_runtime_alert_registration_authority AS authority
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_alert_id = p_runtime_alert_id
   AND runtime_alert.environment_id = p_environment_id
  WHERE authority.environment_id = p_environment_id
    AND authority.status = 'ACTIVE'
    AND authority.registration_mode = 'CONTROLLED';
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_claim$$
CREATE PROCEDURE v1_runtime_alert_delivery_claim (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_receiver_binding_ref VARCHAR(128),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_seconds INT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'CLAIMED',
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = TIMESTAMPADD(SECOND, p_lease_seconds, CURRENT_TIMESTAMP(3)),
      lease_generation = lease_generation + 1,
      stable_error_code = NULL,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND registration_mode = 'CONTROLLED'
    AND receiver_binding_authority_version = 'runtime-alert-receiver-authority:v1'
    AND receiver_binding_ref = p_receiver_binding_ref
    AND status IN ('PENDING', 'RETRY_WAIT')
    AND available_at <= CURRENT_TIMESTAMP(3)
    AND attempt_count < maximum_attempts;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_CLAIM_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_mark_provider_started$$
CREATE PROCEDURE v1_runtime_alert_delivery_mark_provider_started (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'STARTED',
      provider_started_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'CLAIMED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3);
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_START_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_complete_delivered$$
CREATE PROCEDURE v1_runtime_alert_delivery_complete_delivered (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_receipt_digest CHAR(64),
  IN p_receipt_digest_scheme VARCHAR(32),
  IN p_receipt_digest_key_id VARCHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'DELIVERED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_completed_at = CURRENT_TIMESTAMP(3),
      receipt_digest = p_receipt_digest,
      receipt_digest_scheme = p_receipt_digest_scheme,
      receipt_digest_key_id = p_receipt_digest_key_id,
      stable_error_code = NULL,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'STARTED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3);
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_COMPLETE_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_fail_before_provider_retry$$
CREATE PROCEDURE v1_runtime_alert_delivery_fail_before_provider_retry (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_backoff_seconds INT UNSIGNED,
  IN p_stable_error_code VARCHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'RETRY_WAIT',
      available_at = TIMESTAMPADD(SECOND, p_backoff_seconds, CURRENT_TIMESTAMP(3)),
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      stable_error_code = p_stable_error_code,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'CLAIMED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3)
    AND provider_started_at IS NULL
    AND attempt_count < maximum_attempts;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_RETRY_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_fail_before_provider_dead$$
CREATE PROCEDURE v1_runtime_alert_delivery_fail_before_provider_dead (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_stable_error_code VARCHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'DEAD_LETTER',
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      provider_completed_at = CURRENT_TIMESTAMP(3),
      stable_error_code = p_stable_error_code,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'CLAIMED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3)
    AND provider_started_at IS NULL;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_DEAD_LETTER_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_mark_unknown$$
CREATE PROCEDURE v1_runtime_alert_delivery_mark_unknown (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_stable_error_code VARCHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'UNKNOWN',
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      provider_completed_at = CURRENT_TIMESTAMP(3),
      stable_error_code = p_stable_error_code,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'STARTED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND provider_started_at IS NOT NULL;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_UNKNOWN_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_started_unknown$$
CREATE PROCEDURE v1_runtime_alert_delivery_recover_started_unknown (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'UNKNOWN',
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      provider_completed_at = CURRENT_TIMESTAMP(3),
      stable_error_code = 'PROVIDER_ACK_UNKNOWN',
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'STARTED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at <= CURRENT_TIMESTAMP(3)
    AND provider_started_at IS NOT NULL;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_RECOVER_STARTED_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_claim_retry$$
CREATE PROCEDURE v1_runtime_alert_delivery_recover_claim_retry (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_backoff_seconds INT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'RETRY_WAIT',
      available_at = TIMESTAMPADD(SECOND, p_backoff_seconds, CURRENT_TIMESTAMP(3)),
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      stable_error_code = 'CLAIM_EXPIRED_BEFORE_PROVIDER',
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'CLAIMED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at <= CURRENT_TIMESTAMP(3)
    AND provider_started_at IS NULL
    AND attempt_count < maximum_attempts;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_RECOVER_RETRY_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_claim_dead$$
CREATE PROCEDURE v1_runtime_alert_delivery_recover_claim_dead (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_delivery_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_alert_delivery
  SET status = 'DEAD_LETTER',
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      provider_completed_at = CURRENT_TIMESTAMP(3),
      stable_error_code = 'CLAIM_EXPIRED_BEFORE_PROVIDER',
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_alert_delivery_id = p_runtime_alert_delivery_id
    AND status = 'CLAIMED'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at <= CURRENT_TIMESTAMP(3)
    AND provider_started_at IS NULL
    AND attempt_count >= maximum_attempts;
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_ALERT_DELIVERY_RECOVER_DEAD_FENCED';
  END IF;
  SELECT v_affected_rows AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_inspect$$
CREATE PROCEDURE v1_runtime_alert_delivery_inspect (
  IN p_environment_id VARCHAR(96),
  IN p_receiver_binding_authority_version VARCHAR(48),
  IN p_receiver_binding_ref VARCHAR(128)
)
SQL SECURITY DEFINER
READS SQL DATA
SELECT COUNT(*) AS total_count,
       COALESCE(SUM(registration_mode = 'DRY_RUN'), 0) AS dry_run_recorded_count,
       COALESCE(SUM(registration_mode = 'CONTROLLED'), 0) AS controlled_count,
       COALESCE(SUM(
         registration_mode = 'CONTROLLED'
         AND status IN ('PENDING', 'RETRY_WAIT', 'CLAIMED', 'STARTED')
         AND (
           receiver_binding_authority_version
             <> p_receiver_binding_authority_version
           OR receiver_binding_ref <> p_receiver_binding_ref
         )
       ), 0) AS authority_mismatch_count,
       COALESCE(SUM(status = 'PENDING'), 0) AS pending_count,
       COALESCE(SUM(status = 'CLAIMED'), 0) AS claimed_count,
       COALESCE(SUM(status = 'RETRY_WAIT'), 0) AS retry_wait_count,
       COALESCE(SUM(status = 'STARTED'), 0) AS started_count,
       COALESCE(SUM(status = 'DELIVERED'), 0) AS delivered_count,
       COALESCE(SUM(status = 'DEAD_LETTER'), 0) AS dead_letter_count,
       COALESCE(SUM(status = 'UNKNOWN'), 0) AS unknown_count,
       MIN(CASE
         WHEN registration_mode = 'CONTROLLED'
          AND receiver_binding_authority_version
            = p_receiver_binding_authority_version
          AND receiver_binding_ref = p_receiver_binding_ref
          AND status IN ('PENDING', 'RETRY_WAIT')
         THEN available_at
         ELSE NULL
       END) AS oldest_available_at,
       CURRENT_TIMESTAMP(3) AS db_now
FROM v1_runtime_alert_delivery
WHERE environment_id = p_environment_id$$

DELIMITER ;
