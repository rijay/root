-- Append-only, cycle-bound alert evidence. The deterministic dedupe digest
-- makes ACK-unknown readback and caller replay safe without mutable free text.

CREATE TABLE IF NOT EXISTS v1_runtime_alert (
  runtime_alert_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  runtime_cycle_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schedule_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alert_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  severity VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dedupe_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (runtime_alert_id),
  UNIQUE KEY uk_v1_runtime_alert_dedupe (runtime_cycle_id, dedupe_digest),
  KEY idx_v1_runtime_alert_open (
    environment_id, severity, observed_at, runtime_alert_id
  ),
  KEY fk_v1_runtime_alert_cycle (
    runtime_cycle_id, environment_id, schedule_id, input_digest
  ),
  CONSTRAINT fk_v1_runtime_alert_cycle
    FOREIGN KEY (runtime_cycle_id, environment_id, schedule_id, input_digest)
    REFERENCES v1_runtime_cycle (
      runtime_cycle_id, environment_id, schedule_id, input_digest
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_v1_runtime_alert_severity
    CHECK (severity IN ('BLOCKER', 'WARNING')),
  CONSTRAINT chk_v1_runtime_alert_digest_shape
    CHECK (
      runtime_alert_id REGEXP '^[0-9a-f]{64}$'
      AND input_digest REGEXP '^[0-9a-f]{64}$'
      AND dedupe_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_v1_runtime_alert_code
    CHECK (alert_code REGEXP '^[A-Z][A-Z0-9_]{0,63}$')
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
