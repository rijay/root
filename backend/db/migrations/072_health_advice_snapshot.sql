CREATE TABLE IF NOT EXISTS health_advice_snapshot (
  health_advice_snapshot_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  initial_assessment_id VARCHAR(32) NOT NULL,
  gut_assessment_id VARCHAR(32) NOT NULL,
  states_json JSON NOT NULL,
  advice_json JSON NOT NULL,
  advice_source VARCHAR(32) NOT NULL,
  adapter_id VARCHAR(80) NOT NULL,
  model_name VARCHAR(128) NULL,
  prompt_version VARCHAR(80) NOT NULL,
  content_version VARCHAR(80) NOT NULL,
  rule_version VARCHAR(80) NOT NULL,
  generated_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_health_advice_snapshot_inputs (
    root_user_id,
    initial_assessment_id,
    gut_assessment_id,
    prompt_version
  ),
  KEY idx_health_advice_snapshot_user_time (root_user_id, generated_at),
  CONSTRAINT fk_health_advice_snapshot_initial
    FOREIGN KEY (initial_assessment_id)
    REFERENCES health_assessment_attempt (assessment_id),
  CONSTRAINT fk_health_advice_snapshot_gut
    FOREIGN KEY (gut_assessment_id)
    REFERENCES health_assessment_attempt (assessment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
