ALTER TABLE health_assessment_attempt
  ADD COLUMN discovery_channel_option_id VARCHAR(48) NULL AFTER source_visit_id,
  ADD COLUMN discovery_channel_option_label VARCHAR(40) NULL AFTER discovery_channel_option_id,
  ADD COLUMN discovery_channel_config_version INT NULL AFTER discovery_channel_option_label,
  ADD COLUMN discovery_channel_confirmed_at DATETIME(3) NULL AFTER discovery_channel_config_version,
  ADD KEY idx_health_assessment_discovery_channel
    (discovery_channel_option_id, discovery_channel_confirmed_at);

CREATE TABLE IF NOT EXISTS assessment_source_survey_config (
  assessment_source_config_id VARCHAR(32) PRIMARY KEY,
  assessment_type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  title VARCHAR(80) NOT NULL,
  subtitle VARCHAR(180) NOT NULL,
  options_json JSON NOT NULL,
  config_version INT NOT NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_assessment_source_survey_type (assessment_type),
  KEY idx_assessment_source_survey_status (status, updated_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
