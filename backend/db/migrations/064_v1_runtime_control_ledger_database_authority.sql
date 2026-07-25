-- Narrow SQL SECURITY DEFINER Interface for the V1 runtime control ledger.
--
-- These routines deliberately do not start, commit, or roll back a
-- transaction. The caller owns the transaction so alert preparation and the
-- existing delivery-registration routine can remain one atomic write. Runtime
-- principals receive EXECUTE only; direct base-table access is reserved for a
-- locked, non-login definer principal provisioned outside this migration.

DELIMITER $$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_cycle_by_schedule$$
CREATE PROCEDURE v1_runtime_control_ledger_read_cycle_by_schedule (
  IN p_environment_id VARCHAR(96),
  IN p_schedule_id VARCHAR(128)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.schedule_id = p_schedule_id
  LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_cycle_by_id$$
CREATE PROCEDURE v1_runtime_control_ledger_read_cycle_by_id (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.runtime_cycle_id = p_runtime_cycle_id
  LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_alert$$
CREATE PROCEDURE v1_runtime_control_ledger_read_alert (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64),
  IN p_dedupe_digest CHAR(64)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT runtime_alert.*
  FROM v1_runtime_alert AS runtime_alert
  WHERE runtime_alert.environment_id = p_environment_id
    AND runtime_alert.runtime_cycle_id = p_runtime_cycle_id
    AND runtime_alert.dedupe_digest = p_dedupe_digest
  LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_claim_cycle$$
CREATE PROCEDURE v1_runtime_control_ledger_claim_cycle (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64),
  IN p_schedule_id VARCHAR(128),
  IN p_scheduled_at DATETIME(3),
  IN p_input_digest CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_seconds INT UNSIGNED,
  IN p_claim_digest CHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_existing_cycle_id CHAR(64) DEFAULT NULL;
  DECLARE v_found BOOLEAN DEFAULT TRUE;
  DECLARE v_outcome VARCHAR(16) DEFAULT 'REPLAY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;

  SELECT runtime_cycle_id
  INTO v_existing_cycle_id
  FROM v1_runtime_cycle
  WHERE environment_id = p_environment_id
    AND schedule_id = p_schedule_id
  LIMIT 1
  FOR UPDATE;

  IF v_found = FALSE THEN
    INSERT INTO v1_runtime_cycle (
      runtime_cycle_id, environment_id, schedule_id, scheduled_at, input_digest,
      status, lease_owner, lease_expires_at, lease_generation, claim_digest,
      blocker_count, claimed_at, created_at, updated_at
    ) VALUES (
      p_runtime_cycle_id, p_environment_id, p_schedule_id, p_scheduled_at,
      p_input_digest, 'RUNNING', p_lease_owner,
      TIMESTAMPADD(SECOND, p_lease_seconds, CURRENT_TIMESTAMP(3)), 1,
      p_claim_digest, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3),
      CURRENT_TIMESTAMP(3)
    );
    SET v_existing_cycle_id = p_runtime_cycle_id;
    SET v_outcome = 'CLAIMED';
  END IF;

  SELECT v_outcome AS operation_outcome,
         runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.runtime_cycle_id = v_existing_cycle_id
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_renew_cycle$$
CREATE PROCEDURE v1_runtime_control_ledger_renew_cycle (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_lease_seconds INT UNSIGNED
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  UPDATE v1_runtime_cycle
  SET lease_expires_at = TIMESTAMPADD(SECOND, p_lease_seconds, CURRENT_TIMESTAMP(3)),
      lease_generation = lease_generation + 1,
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
    AND status = 'RUNNING'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3);
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_LEASE_FENCED';
  END IF;
  SELECT 'RENEWED' AS operation_outcome,
         runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.runtime_cycle_id = p_runtime_cycle_id
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_finalize_cycle$$
CREATE PROCEDURE v1_runtime_control_ledger_finalize_cycle (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64),
  IN p_lease_owner VARCHAR(128),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_status VARCHAR(32),
  IN p_finalization_digest CHAR(64),
  IN p_result_digest CHAR(64),
  IN p_blocker_count BIGINT UNSIGNED,
  IN p_error_code VARCHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  DECLARE v_persisted_status VARCHAR(32) DEFAULT NULL;
  DECLARE v_persisted_finalization_digest CHAR(64) DEFAULT NULL;
  DECLARE v_found BOOLEAN DEFAULT TRUE;
  DECLARE v_outcome VARCHAR(16) DEFAULT 'FINALIZED';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;

  UPDATE v1_runtime_cycle
  SET status = p_status,
      lease_owner = NULL,
      lease_expires_at = NULL,
      finalization_digest = p_finalization_digest,
      result_digest = p_result_digest,
      blocker_count = p_blocker_count,
      error_code = p_error_code,
      completed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
    AND status = 'RUNNING'
    AND lease_owner = p_lease_owner
    AND lease_generation = p_lease_generation
    AND lease_expires_at > CURRENT_TIMESTAMP(3);
  SET v_affected_rows = ROW_COUNT();

  IF v_affected_rows = 0 THEN
    SELECT status, finalization_digest
    INTO v_persisted_status, v_persisted_finalization_digest
    FROM v1_runtime_cycle
    WHERE environment_id = p_environment_id
      AND runtime_cycle_id = p_runtime_cycle_id
    LIMIT 1
    FOR UPDATE;
    IF v_found = FALSE THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_CONFLICT';
    ELSEIF v_persisted_status = 'RUNNING' THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_LEASE_FENCED';
    ELSEIF NOT (v_persisted_finalization_digest <=> p_finalization_digest) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_CONFLICT';
    END IF;
    SET v_outcome = 'REPLAY';
  END IF;

  SELECT v_outcome AS operation_outcome,
         runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.runtime_cycle_id = p_runtime_cycle_id
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_prepare_alert$$
CREATE PROCEDURE v1_runtime_control_ledger_prepare_alert (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_alert_id CHAR(64),
  IN p_runtime_cycle_id CHAR(64),
  IN p_alert_code VARCHAR(64),
  IN p_severity VARCHAR(16),
  IN p_dedupe_digest CHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_cycle_status VARCHAR(32) DEFAULT NULL;
  DECLARE v_existing_alert_id CHAR(64) DEFAULT NULL;
  DECLARE v_found BOOLEAN DEFAULT TRUE;
  DECLARE v_outcome VARCHAR(16) DEFAULT 'REPLAY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;

  SELECT status
  INTO v_cycle_status
  FROM v1_runtime_cycle
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
  LIMIT 1
  FOR UPDATE;
  IF v_found = FALSE OR v_cycle_status = 'RUNNING' THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_CONFLICT';
  END IF;

  SET v_found = TRUE;
  SELECT runtime_alert_id
  INTO v_existing_alert_id
  FROM v1_runtime_alert
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
    AND dedupe_digest = p_dedupe_digest
  LIMIT 1
  FOR UPDATE;

  IF v_found = FALSE THEN
    INSERT INTO v1_runtime_alert (
      runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
      input_digest, alert_code, severity, dedupe_digest, observed_at, created_at
    )
    SELECT p_runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
           input_digest, p_alert_code, p_severity, p_dedupe_digest,
           CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
    FROM v1_runtime_cycle
    WHERE environment_id = p_environment_id
      AND runtime_cycle_id = p_runtime_cycle_id
      AND status <> 'RUNNING';
    IF ROW_COUNT() <> 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_PERSISTENCE_FAILED';
    END IF;
    SET v_outcome = 'RECORDED';
  END IF;

  SELECT v_outcome AS operation_outcome, runtime_alert.*
  FROM v1_runtime_alert AS runtime_alert
  WHERE runtime_alert.environment_id = p_environment_id
    AND runtime_alert.runtime_cycle_id = p_runtime_cycle_id
    AND runtime_alert.dedupe_digest = p_dedupe_digest
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_lock_stale_cycles$$
CREATE PROCEDURE v1_runtime_control_ledger_lock_stale_cycles (
  IN p_environment_id VARCHAR(96),
  IN p_limit INT UNSIGNED
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_INPUT_INVALID';
  END IF;
  SELECT runtime_cycle.*, CURRENT_TIMESTAMP(3) AS db_now
  FROM v1_runtime_cycle AS runtime_cycle
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.status = 'RUNNING'
    AND runtime_cycle.lease_expires_at <= CURRENT_TIMESTAMP(3)
  ORDER BY runtime_cycle.lease_expires_at, runtime_cycle.runtime_cycle_id
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_recover_stale_cycle_prepare_alert$$
CREATE PROCEDURE v1_runtime_control_ledger_recover_stale_cycle_prepare_alert (
  IN p_environment_id VARCHAR(96),
  IN p_runtime_cycle_id CHAR(64),
  IN p_lease_generation BIGINT UNSIGNED,
  IN p_finalization_digest CHAR(64),
  IN p_result_digest CHAR(64),
  IN p_runtime_alert_id CHAR(64),
  IN p_dedupe_digest CHAR(64)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_affected_rows INT DEFAULT 0;
  DECLARE v_existing_alert_id CHAR(64) DEFAULT NULL;
  DECLARE v_found BOOLEAN DEFAULT TRUE;
  DECLARE v_alert_outcome VARCHAR(16) DEFAULT 'REPLAY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;

  UPDATE v1_runtime_cycle
  SET status = 'REVIEW_REQUIRED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      lease_generation = lease_generation + 1,
      finalization_digest = p_finalization_digest,
      result_digest = p_result_digest,
      blocker_count = 1,
      error_code = 'V1_RUNTIME_CYCLE_STALE',
      completed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
    AND status = 'RUNNING'
    AND lease_generation = p_lease_generation
    AND lease_expires_at <= CURRENT_TIMESTAMP(3);
  SET v_affected_rows = ROW_COUNT();
  IF v_affected_rows <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MYSQL_ERRNO = 1644,
          MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_LEASE_FENCED';
  END IF;

  SELECT runtime_alert_id
  INTO v_existing_alert_id
  FROM v1_runtime_alert
  WHERE environment_id = p_environment_id
    AND runtime_cycle_id = p_runtime_cycle_id
    AND dedupe_digest = p_dedupe_digest
  LIMIT 1
  FOR UPDATE;
  IF v_found = FALSE THEN
    INSERT INTO v1_runtime_alert (
      runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
      input_digest, alert_code, severity, dedupe_digest, observed_at, created_at
    )
    SELECT p_runtime_alert_id, runtime_cycle_id, environment_id, schedule_id,
           input_digest, 'V1_RUNTIME_CYCLE_STALE', 'BLOCKER', p_dedupe_digest,
           CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
    FROM v1_runtime_cycle
    WHERE environment_id = p_environment_id
      AND runtime_cycle_id = p_runtime_cycle_id
      AND status = 'REVIEW_REQUIRED'
      AND lease_generation = p_lease_generation + 1;
    IF ROW_COUNT() <> 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'V1_RUNTIME_LEDGER_PERSISTENCE_FAILED';
    END IF;
    SET v_alert_outcome = 'RECORDED';
  END IF;

  SELECT v_alert_outcome AS operation_outcome,
         runtime_cycle.runtime_cycle_id,
         runtime_cycle.environment_id,
         runtime_cycle.schedule_id,
         runtime_cycle.input_digest,
         runtime_cycle.status,
         runtime_cycle.lease_generation,
         runtime_cycle.finalization_digest,
         runtime_cycle.result_digest,
         runtime_cycle.blocker_count,
         runtime_cycle.error_code,
         runtime_cycle.completed_at,
         runtime_alert.runtime_alert_id,
         runtime_alert.alert_code,
         runtime_alert.severity,
         runtime_alert.dedupe_digest,
         runtime_alert.observed_at,
         runtime_alert.created_at
  FROM v1_runtime_cycle AS runtime_cycle
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_cycle_id = runtime_cycle.runtime_cycle_id
   AND runtime_alert.environment_id = runtime_cycle.environment_id
  WHERE runtime_cycle.environment_id = p_environment_id
    AND runtime_cycle.runtime_cycle_id = p_runtime_cycle_id
    AND runtime_alert.dedupe_digest = p_dedupe_digest
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_inspect_snapshot$$
CREATE PROCEDURE v1_runtime_control_ledger_inspect_snapshot (
  IN p_environment_id VARCHAR(96)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT
    (
      SELECT runtime_cycle_id FROM v1_runtime_cycle
      WHERE environment_id = p_environment_id AND status = 'SUCCEEDED'
      ORDER BY completed_at DESC, runtime_cycle_id DESC LIMIT 1
    ) AS latest_safe_cycle_id,
    (
      SELECT completed_at FROM v1_runtime_cycle
      WHERE environment_id = p_environment_id AND status = 'SUCCEEDED'
      ORDER BY completed_at DESC, runtime_cycle_id DESC LIMIT 1
    ) AS latest_safe_completed_at,
    (
      SELECT runtime_cycle_id FROM v1_runtime_cycle
      WHERE environment_id = p_environment_id AND status <> 'RUNNING'
      ORDER BY completed_at DESC, scheduled_at DESC, runtime_cycle_id DESC LIMIT 1
    ) AS latest_terminal_cycle_id,
    (
      SELECT status FROM v1_runtime_cycle
      WHERE environment_id = p_environment_id AND status <> 'RUNNING'
      ORDER BY completed_at DESC, scheduled_at DESC, runtime_cycle_id DESC LIMIT 1
    ) AS latest_terminal_status,
    (
      SELECT completed_at FROM v1_runtime_cycle
      WHERE environment_id = p_environment_id AND status <> 'RUNNING'
      ORDER BY completed_at DESC, scheduled_at DESC, runtime_cycle_id DESC LIMIT 1
    ) AS latest_terminal_completed_at,
    (
      SELECT COUNT(*)
      FROM v1_runtime_alert AS runtime_alert
      INNER JOIN v1_runtime_cycle AS alerted_cycle
        ON alerted_cycle.runtime_cycle_id = runtime_alert.runtime_cycle_id
       AND alerted_cycle.environment_id = runtime_alert.environment_id
      WHERE runtime_alert.environment_id = p_environment_id
        AND alerted_cycle.status <> 'RUNNING'
        AND alerted_cycle.completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM v1_runtime_cycle AS succeeding_cycle
          WHERE succeeding_cycle.environment_id = runtime_alert.environment_id
            AND succeeding_cycle.status = 'SUCCEEDED'
            AND succeeding_cycle.completed_at > alerted_cycle.completed_at
        )
    ) AS total_count,
    (
      SELECT COUNT(*)
      FROM v1_runtime_alert AS runtime_alert
      INNER JOIN v1_runtime_cycle AS alerted_cycle
        ON alerted_cycle.runtime_cycle_id = runtime_alert.runtime_cycle_id
       AND alerted_cycle.environment_id = runtime_alert.environment_id
      WHERE runtime_alert.environment_id = p_environment_id
        AND runtime_alert.severity = 'BLOCKER'
        AND alerted_cycle.status <> 'RUNNING'
        AND alerted_cycle.completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM v1_runtime_cycle AS succeeding_cycle
          WHERE succeeding_cycle.environment_id = runtime_alert.environment_id
            AND succeeding_cycle.status = 'SUCCEEDED'
            AND succeeding_cycle.completed_at > alerted_cycle.completed_at
        )
    ) AS blocker_count,
    (
      SELECT COUNT(*)
      FROM v1_runtime_alert AS runtime_alert
      INNER JOIN v1_runtime_cycle AS alerted_cycle
        ON alerted_cycle.runtime_cycle_id = runtime_alert.runtime_cycle_id
       AND alerted_cycle.environment_id = runtime_alert.environment_id
      WHERE runtime_alert.environment_id = p_environment_id
        AND runtime_alert.severity = 'WARNING'
        AND alerted_cycle.status <> 'RUNNING'
        AND alerted_cycle.completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM v1_runtime_cycle AS succeeding_cycle
          WHERE succeeding_cycle.environment_id = runtime_alert.environment_id
            AND succeeding_cycle.status = 'SUCCEEDED'
            AND succeeding_cycle.completed_at > alerted_cycle.completed_at
        )
    ) AS warning_count,
    (
      SELECT MAX(runtime_alert.observed_at)
      FROM v1_runtime_alert AS runtime_alert
      INNER JOIN v1_runtime_cycle AS alerted_cycle
        ON alerted_cycle.runtime_cycle_id = runtime_alert.runtime_cycle_id
       AND alerted_cycle.environment_id = runtime_alert.environment_id
      WHERE runtime_alert.environment_id = p_environment_id
        AND alerted_cycle.status <> 'RUNNING'
        AND alerted_cycle.completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM v1_runtime_cycle AS succeeding_cycle
          WHERE succeeding_cycle.environment_id = runtime_alert.environment_id
            AND succeeding_cycle.status = 'SUCCEEDED'
            AND succeeding_cycle.completed_at > alerted_cycle.completed_at
        )
    ) AS latest_observed_at,
    (
      SELECT COUNT(*)
      FROM v1_runtime_cycle AS review_cycle
      WHERE review_cycle.environment_id = p_environment_id
        AND review_cycle.status = 'REVIEW_REQUIRED'
        AND NOT EXISTS (
          SELECT 1 FROM v1_runtime_cycle AS succeeding_cycle
          WHERE succeeding_cycle.environment_id = review_cycle.environment_id
            AND succeeding_cycle.status = 'SUCCEEDED'
            AND succeeding_cycle.completed_at > review_cycle.completed_at
        )
    ) AS review_required_count,
    CURRENT_TIMESTAMP(3) AS db_now;
END$$

DELIMITER ;
