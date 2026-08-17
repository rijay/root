CREATE TABLE IF NOT EXISTS channel_definition (
  channel_definition_id VARCHAR(32) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  signature_key_id VARCHAR(48) NOT NULL,
  allowed_target_pages_json JSON NOT NULL,
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_channel_definition_channel (channel_id),
  KEY idx_channel_definition_campaign_status (campaign_id, status, start_at, end_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_attribution (
  channel_attribution_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  channel_definition_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  target_page VARCHAR(240) NOT NULL,
  signature_key_id VARCHAR(48) NOT NULL,
  signature_scheme VARCHAR(32) NOT NULL,
  attributed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_channel_attribution_first_touch (root_user_id),
  KEY idx_channel_attribution_channel_time (channel_id, attributed_at),
  CONSTRAINT fk_channel_attribution_definition
    FOREIGN KEY (channel_definition_id)
    REFERENCES channel_definition (channel_definition_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_attribution_attempt (
  channel_attribution_attempt_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  requested_channel_id VARCHAR(64) NULL,
  requested_campaign_id VARCHAR(64) NULL,
  requested_target_page VARCHAR(240) NULL,
  result VARCHAR(32) NOT NULL,
  reason VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_channel_attribution_attempt_user_time (root_user_id, occurred_at),
  KEY idx_channel_attribution_attempt_result_time (result, occurred_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_popup_receipt (
  campaign_popup_receipt_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  login_session_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  popup_id VARCHAR(64) NOT NULL,
  popup_version INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  action_type VARCHAR(24) NULL,
  claimed_at DATETIME(3) NOT NULL,
  viewed_at DATETIME(3) NULL,
  acted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_campaign_popup_receipt_session (login_session_id),
  KEY idx_campaign_popup_receipt_campaign_time (campaign_id, claimed_at),
  KEY idx_campaign_popup_receipt_user_time (root_user_id, claimed_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
