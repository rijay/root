CREATE TABLE IF NOT EXISTS root_user (
  root_user_id VARCHAR(32) PRIMARY KEY,
  unionid VARCHAR(64) NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  source_channel VARCHAR(64) NULL,
  unionid_status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_root_user_unionid (unionid),
  KEY idx_root_user_lifecycle_status (lifecycle_status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wechat_identity (
  wechat_identity_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  app_code VARCHAR(32) NOT NULL,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64) NULL,
  unionid_status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_wechat_identity_app_openid (app_code, openid),
  KEY idx_wechat_identity_root_user (root_user_id),
  KEY idx_wechat_identity_unionid (unionid)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_contact_method (
  contact_method_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  contact_type VARCHAR(24) NOT NULL,
  phone_masked VARCHAR(24) NULL,
  phone_hash VARCHAR(128) NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_user_contact_method_type (root_user_id, contact_type),
  KEY idx_user_contact_method_phone_hash (phone_hash)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_lifecycle_event (
  lifecycle_event_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  source_channel VARCHAR(64) NULL,
  app_code VARCHAR(32) NULL,
  metadata JSON NULL,
  occurred_at DATETIME(3) NOT NULL,
  KEY idx_user_lifecycle_event_user_time (root_user_id, occurred_at),
  KEY idx_user_lifecycle_event_type_time (event_type, occurred_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_definition (
  campaign_id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL,
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  config_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_campaign_definition_status_time (status, start_at, end_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_participant (
  campaign_participant_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  status VARCHAR(24) NOT NULL,
  source_channel VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_campaign_participant_user (campaign_id, root_user_id),
  KEY idx_campaign_participant_user_status (root_user_id, status),
  KEY idx_campaign_participant_campaign_joined (campaign_id, joined_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_definition (
  task_definition_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  task_type VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 10,
  status VARCHAR(24) NOT NULL,
  config_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_task_definition_campaign_status (campaign_id, status, display_order)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_event (
  task_event_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  task_definition_id VARCHAR(32) NOT NULL,
  task_type VARCHAR(32) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  task_date DATE NOT NULL,
  payload_json JSON NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL,
  source_channel VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_task_event_idempotency (idempotency_key),
  KEY idx_task_event_user_campaign_date (root_user_id, campaign_id, task_date),
  KEY idx_task_event_campaign_type_date (campaign_id, task_type, task_date)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_progress_snapshot (
  task_progress_snapshot_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  computed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_task_progress_user_campaign (root_user_id, campaign_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questionnaire_answer (
  questionnaire_answer_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  questionnaire_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  answers_json JSON NOT NULL,
  submitted_at DATETIME(3) NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  UNIQUE KEY uk_questionnaire_answer_idempotency (idempotency_key),
  KEY idx_questionnaire_answer_user_campaign (root_user_id, campaign_id, questionnaire_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_template (
  notification_template_id VARCHAR(32) PRIMARY KEY,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NULL,
  template_version VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  page VARCHAR(128) NULL,
  reminder_hour INT NOT NULL DEFAULT 9,
  miniprogram_state VARCHAR(24) NULL,
  lang VARCHAR(16) NULL,
  status VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL,
  data_schema_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_notification_template_version (template_key, template_version)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_subscription (
  notification_subscription_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result VARCHAR(32) NULL,
  subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  `trigger` VARCHAR(64) NULL,
  campaign_id VARCHAR(64) NULL,
  raw_result_json JSON NULL,
  setting_json JSON NULL,
  source_channel VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_notification_subscription_user_template (root_user_id, template_key, template_id, template_version),
  KEY idx_notification_subscription_campaign_status (campaign_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_job (
  notification_job_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  reminder_date DATE NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  page VARCHAR(128) NULL,
  miniprogram_state VARCHAR(24) NULL,
  lang VARCHAR(16) NULL,
  data_json JSON NULL,
  status VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  source_channel VARCHAR(64) NULL,
  sent_at DATETIME(3) NULL,
  skipped_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_notification_job_idempotency (idempotency_key),
  KEY idx_notification_job_due (status, scheduled_at),
  KEY idx_notification_job_user_date (root_user_id, reminder_date)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_delivery (
  notification_delivery_id VARCHAR(32) PRIMARY KEY,
  notification_job_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  request_json JSON NULL,
  response_json JSON NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_notification_delivery_job (notification_job_id),
  KEY idx_notification_delivery_user_status (root_user_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_rule_version (
  campaign_rule_version_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  conditions_json JSON NOT NULL,
  rewards_json JSON NOT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_campaign_rule_version (campaign_id, version),
  KEY idx_campaign_rule_status (campaign_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_record (
  settlement_record_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  rule_version INT NOT NULL,
  campaign_rule_version_id VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  result_json JSON NOT NULL,
  rewards_json JSON NULL,
  evaluated_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_settlement_user_campaign_rule (root_user_id, campaign_id, rule_version),
  KEY idx_settlement_campaign_status (campaign_id, status, evaluated_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_inventory_pool (
  reward_inventory_pool_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96) NOT NULL,
  quota_limit INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_reward_inventory_pool_quota (campaign_id, quota_key)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_inventory_reservation (
  reward_inventory_reservation_id VARCHAR(32) PRIMARY KEY,
  reward_inventory_pool_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  reward_type VARCHAR(32) NOT NULL,
  reward_key VARCHAR(64) NOT NULL,
  settlement_record_id VARCHAR(32) NOT NULL,
  reward_grant_id VARCHAR(32) NULL,
  status VARCHAR(24) NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  release_reason TEXT NULL,
  reserved_at DATETIME(3) NOT NULL,
  released_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_reward_inventory_reservation_idempotency (idempotency_key),
  KEY idx_reward_inventory_reservation_pool_status (reward_inventory_pool_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_grant (
  reward_grant_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  settlement_record_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NULL,
  reward_type VARCHAR(32) NOT NULL,
  reward_key VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96) NULL,
  quota_limit INT NOT NULL DEFAULT 0,
  inventory_reservation_id VARCHAR(32) NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL,
  payload_json JSON NULL,
  external_ref VARCHAR(128) NULL,
  external_status VARCHAR(32) NULL,
  external_status_checked_at DATETIME(3) NULL,
  external_status_json JSON NULL,
  used_at DATETIME(3) NULL,
  expired_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  recovery_status VARCHAR(32) NULL,
  recovery_reason TEXT NULL,
  recovery_record_id VARCHAR(32) NULL,
  recovered_at DATETIME(3) NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_reward_grant_idempotency (idempotency_key),
  KEY idx_reward_grant_user_campaign_status (root_user_id, campaign_id, status),
  KEY idx_reward_grant_settlement (settlement_record_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_recovery_record (
  reward_recovery_record_id VARCHAR(32) PRIMARY KEY,
  reward_grant_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(32) NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  recovery_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  inventory_released BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NULL,
  metadata_json JSON NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_reward_recovery_idempotency (idempotency_key),
  KEY idx_reward_recovery_grant_status (reward_grant_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_delivery_job (
  reward_delivery_job_id VARCHAR(32) PRIMARY KEY,
  reward_grant_id VARCHAR(32) NOT NULL,
  adapter_type VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  next_retry_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  status_checked_at DATETIME(3) NULL,
  request_id VARCHAR(128) NULL,
  external_result_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_reward_delivery_job_grant_adapter (reward_grant_id, adapter_type),
  KEY idx_reward_delivery_job_due (status, next_retry_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manual_review_item (
  manual_review_item_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NULL,
  review_type VARCHAR(32) NOT NULL,
  source_type VARCHAR(32) NULL,
  source_id VARCHAR(64) NULL,
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL,
  priority VARCHAR(24) NOT NULL,
  metadata JSON NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  operator_id VARCHAR(64) NULL,
  resolved_at DATETIME(3) NULL,
  resolution TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_manual_review_idempotency (idempotency_key),
  KEY idx_manual_review_status_priority (status, priority, created_at),
  KEY idx_manual_review_user_campaign (root_user_id, campaign_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
