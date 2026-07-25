-- Replace the two mode-specific registration routines with deep, idempotent
-- Modules that return the persisted registration row. Registrar callers no
-- longer need SELECT on v1_runtime_alert_delivery. The caller still owns the
-- transaction shared with Control Ledger alert preparation.

DELIMITER $$

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
  DECLARE v_existing_delivery_id CHAR(64) DEFAULT NULL;
  DECLARE v_outcome VARCHAR(16) DEFAULT 'REPLAY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_existing_delivery_id = NULL;

  SELECT runtime_alert_delivery_id
  INTO v_existing_delivery_id
  FROM v1_runtime_alert_delivery
  WHERE runtime_alert_id = p_runtime_alert_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_delivery_id IS NULL THEN
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
    IF ROW_COUNT() <> 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED';
    END IF;
    SET v_outcome = 'REGISTERED';
  END IF;

  SELECT v_outcome AS operation_outcome,
         runtime_alert_delivery_id, runtime_alert_id, environment_id,
         registration_mode, receiver_binding_authority_version,
         receiver_binding_ref, receiver_binding_digest,
         receiver_binding_digest_scheme, receiver_binding_digest_key_id,
         payload_schema_version, payload_canonical_version, payload_digest,
         payload_digest_scheme, payload_digest_key_id, slo_class,
         slo_target_seconds, retry_policy_version, maximum_attempts, status
  FROM v1_runtime_alert_delivery
  WHERE runtime_alert_id = p_runtime_alert_id
  LIMIT 1
  FOR UPDATE;
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
  DECLARE v_existing_delivery_id CHAR(64) DEFAULT NULL;
  DECLARE v_outcome VARCHAR(16) DEFAULT 'REPLAY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_existing_delivery_id = NULL;

  SELECT runtime_alert_delivery_id
  INTO v_existing_delivery_id
  FROM v1_runtime_alert_delivery
  WHERE runtime_alert_id = p_runtime_alert_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_delivery_id IS NULL THEN
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
    IF ROW_COUNT() <> 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED';
    END IF;
    SET v_outcome = 'REGISTERED';
  END IF;

  SELECT v_outcome AS operation_outcome,
         runtime_alert_delivery_id, runtime_alert_id, environment_id,
         registration_mode, receiver_binding_authority_version,
         receiver_binding_ref, receiver_binding_digest,
         receiver_binding_digest_scheme, receiver_binding_digest_key_id,
         payload_schema_version, payload_canonical_version, payload_digest,
         payload_digest_scheme, payload_digest_key_id, slo_class,
         slo_target_seconds, retry_policy_version, maximum_attempts, status
  FROM v1_runtime_alert_delivery
  WHERE runtime_alert_id = p_runtime_alert_id
  LIMIT 1
  FOR UPDATE;
END$$

DELIMITER ;
