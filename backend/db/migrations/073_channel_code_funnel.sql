ALTER TABLE health_assessment_attempt
  ADD COLUMN source_campaign_id VARCHAR(64) NULL AFTER source_channel,
  ADD COLUMN source_qr_code_id VARCHAR(32) NULL AFTER source_campaign_id,
  ADD COLUMN source_visit_id VARCHAR(32) NULL AFTER source_qr_code_id,
  ADD KEY idx_health_assessment_attempt_channel_source
    (source_campaign_id, source_qr_code_id, completed_at);

CREATE TABLE IF NOT EXISTS channel_qr_code (
  channel_qr_code_id VARCHAR(32) PRIMARY KEY,
  channel_definition_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  short_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  target_page VARCHAR(240) NOT NULL,
  status VARCHAR(16) NOT NULL,
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  env_version VARCHAR(16) NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_channel_qr_code_short_code (short_code),
  KEY idx_channel_qr_code_campaign_status (campaign_id, channel_id, status),
  CONSTRAINT fk_channel_qr_code_definition
    FOREIGN KEY (channel_definition_id)
    REFERENCES channel_definition (channel_definition_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_funnel_visit (
  channel_funnel_visit_id VARCHAR(32) PRIMARY KEY,
  client_visit_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_qr_code_id VARCHAR(32) NOT NULL,
  short_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_definition_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  target_page VARCHAR(240) NOT NULL,
  root_user_id VARCHAR(32) NULL,
  assessment_id VARCHAR(32) NULL,
  opened_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_channel_funnel_visit_client (client_visit_id),
  KEY idx_channel_funnel_visit_code_time (channel_qr_code_id, opened_at),
  KEY idx_channel_funnel_visit_user_time (root_user_id, opened_at),
  CONSTRAINT fk_channel_funnel_visit_code
    FOREIGN KEY (channel_qr_code_id)
    REFERENCES channel_qr_code (channel_qr_code_id),
  CONSTRAINT fk_channel_funnel_visit_root_user
    FOREIGN KEY (root_user_id)
    REFERENCES root_user (root_user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_funnel_event (
  channel_funnel_event_id VARCHAR(32) PRIMARY KEY,
  channel_funnel_visit_id VARCHAR(32) NOT NULL,
  channel_qr_code_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  root_user_id VARCHAR(32) NULL,
  assessment_id VARCHAR(32) NULL,
  stage VARCHAR(32) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_channel_funnel_event_stage
    (channel_funnel_visit_id, stage, assessment_id),
  KEY idx_channel_funnel_event_campaign_stage_time
    (campaign_id, channel_id, stage, occurred_at),
  KEY idx_channel_funnel_event_code_stage_time
    (channel_qr_code_id, stage, occurred_at),
  CONSTRAINT fk_channel_funnel_event_visit
    FOREIGN KEY (channel_funnel_visit_id)
    REFERENCES channel_funnel_visit (channel_funnel_visit_id),
  CONSTRAINT fk_channel_funnel_event_code
    FOREIGN KEY (channel_qr_code_id)
    REFERENCES channel_qr_code (channel_qr_code_id),
  CONSTRAINT fk_channel_funnel_event_root_user
    FOREIGN KEY (root_user_id)
    REFERENCES root_user (root_user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
