CREATE TABLE root_store_snapshot (
  store_key VARCHAR(64) PRIMARY KEY,
  schema_version INT NOT NULL,
  payload_json JSON NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE root_user (
  root_user_id VARCHAR(32) PRIMARY KEY,
  lifecycle_status VARCHAR(32) NOT NULL,
  source_channel VARCHAR(64),
  unionid_status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE wechat_identity (
  wechat_identity_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  app_code VARCHAR(32) NOT NULL,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64),
  unionid_status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  UNIQUE (app_code, openid),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE user_contact_method (
  contact_method_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  contact_type VARCHAR(24) NOT NULL,
  phone_masked VARCHAR(24),
  phone_hash VARCHAR(128),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE privacy_consent_record (
  privacy_consent_record_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  consent_type VARCHAR(48) NOT NULL,
  policy_version VARCHAR(96) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  purposes_json JSON NOT NULL,
  data_categories_json JSON NOT NULL,
  source_channel VARCHAR(64),
  occurred_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE user_lifecycle_event (
  lifecycle_event_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  source_channel VARCHAR(64),
  app_code VARCHAR(32),
  metadata JSON,
  occurred_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE campaign_definition (
  campaign_id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL,
  start_at DATETIME,
  end_at DATETIME,
  config_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE campaign_participant (
  campaign_participant_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  joined_at DATETIME NOT NULL,
  status VARCHAR(24) NOT NULL,
  source_channel VARCHAR(64),
  metadata JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (campaign_id, root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE task_definition (
  task_definition_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  task_type VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 10,
  status VARCHAR(24) NOT NULL,
  config_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE task_event (
  task_event_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  task_definition_id VARCHAR(32) NOT NULL,
  task_type VARCHAR(32) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  task_date DATE NOT NULL,
  payload_json JSON,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  source_channel VARCHAR(64),
  occurred_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id),
  FOREIGN KEY (task_definition_id) REFERENCES task_definition(task_definition_id)
);

CREATE TABLE task_progress_snapshot (
  task_progress_snapshot_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  computed_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (root_user_id, campaign_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE notification_template (
  notification_template_id VARCHAR(32) PRIMARY KEY,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128),
  template_version VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  page VARCHAR(128),
  reminder_hour INT NOT NULL DEFAULT 9,
  miniprogram_state VARCHAR(24),
  lang VARCHAR(16),
  status VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL,
  data_schema_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (template_key, template_version)
);

CREATE TABLE notification_subscription (
  notification_subscription_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result VARCHAR(32),
  subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  trigger VARCHAR(64),
  campaign_id VARCHAR(64),
  raw_result_json JSON,
  setting_json JSON,
  source_channel VARCHAR(64),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (root_user_id, template_key, template_id, template_version),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE notification_job (
  notification_job_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  notification_subscription_grant_id VARCHAR(32),
  reminder_date DATE NOT NULL,
  scheduled_at DATETIME NOT NULL,
  page VARCHAR(128),
  miniprogram_state VARCHAR(24),
  lang VARCHAR(16),
  data_json JSON,
  status VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  source_channel VARCHAR(64),
  sent_at DATETIME,
  skipped_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE notification_delivery (
  notification_delivery_id VARCHAR(32) PRIMARY KEY,
  notification_job_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  notification_subscription_grant_id VARCHAR(32),
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64),
  external_error_code VARCHAR(64),
  error_message TEXT,
  delivery_outcome VARCHAR(32),
  request_json JSON,
  response_json JSON,
  delivered_at DATETIME,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (notification_job_id) REFERENCES notification_job(notification_job_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE notification_subscription_grant (
  notification_subscription_grant_id VARCHAR(32) PRIMARY KEY,
  notification_subscription_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64),
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  grant_request_id VARCHAR(96) NOT NULL,
  status VARCHAR(32) NOT NULL,
  notification_job_id VARCHAR(32),
  last_notification_job_id VARCHAR(32),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  source_channel VARCHAR(64),
  granted_at DATETIME NOT NULL,
  reserved_at DATETIME,
  consumed_at DATETIME,
  released_at DATETIME,
  invalidated_at DATETIME,
  review_required_at DATETIME,
  release_reason VARCHAR(128),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_notification_subscription_grant_available (root_user_id, template_key, template_version, campaign_id, status),
  KEY idx_notification_subscription_grant_job (notification_job_id),
  KEY idx_notification_subscription_grant_review (status, updated_at)
);

CREATE TABLE questionnaire_answer (
  questionnaire_answer_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  questionnaire_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  answers_json JSON NOT NULL,
  submitted_at DATETIME NOT NULL,
  idempotency_key VARCHAR(128),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE campaign_rule_version (
  campaign_rule_version_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  conditions_json JSON NOT NULL,
  rewards_json JSON NOT NULL,
  published_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (campaign_id, version),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE settlement_record (
  settlement_record_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  rule_version INT NOT NULL,
  campaign_rule_version_id VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  result_json JSON NOT NULL,
  rewards_json JSON,
  evaluated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id),
  FOREIGN KEY (campaign_rule_version_id) REFERENCES campaign_rule_version(campaign_rule_version_id)
);

CREATE TABLE reward_inventory_pool (
  reward_inventory_pool_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96) NOT NULL,
  quota_limit INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (campaign_id, quota_key),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE reward_inventory_reservation (
  reward_inventory_reservation_id VARCHAR(32) PRIMARY KEY,
  reward_inventory_pool_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  reward_type VARCHAR(32) NOT NULL,
  reward_key VARCHAR(64) NOT NULL,
  settlement_record_id VARCHAR(32) NOT NULL,
  reward_grant_id VARCHAR(32),
  status VARCHAR(24) NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  release_reason TEXT,
  reserved_at DATETIME NOT NULL,
  released_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (reward_inventory_pool_id) REFERENCES reward_inventory_pool(reward_inventory_pool_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (settlement_record_id) REFERENCES settlement_record(settlement_record_id)
);

CREATE TABLE reward_grant (
  reward_grant_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  settlement_record_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32),
  reward_type VARCHAR(32) NOT NULL,
  reward_key VARCHAR(64) NOT NULL,
  quota_key VARCHAR(96),
  quota_limit INT NOT NULL DEFAULT 0,
  inventory_reservation_id VARCHAR(32),
  title VARCHAR(128) NOT NULL,
  description TEXT,
  status VARCHAR(32) NOT NULL,
  payload_json JSON,
  external_ref VARCHAR(128),
  external_status VARCHAR(32),
  external_status_checked_at DATETIME,
  external_status_json JSON,
  used_at DATETIME,
  expired_at DATETIME,
  delivered_at DATETIME,
  recovery_status VARCHAR(32),
  recovery_reason TEXT,
  recovery_record_id VARCHAR(32),
  recovered_at DATETIME,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id),
  FOREIGN KEY (settlement_record_id) REFERENCES settlement_record(settlement_record_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id),
  FOREIGN KEY (inventory_reservation_id) REFERENCES reward_inventory_reservation(reward_inventory_reservation_id)
);

CREATE TABLE reward_recovery_record (
  reward_recovery_record_id VARCHAR(32) PRIMARY KEY,
  reward_grant_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(32),
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  recovery_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  inventory_released BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  metadata_json JSON,
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (reward_grant_id) REFERENCES reward_grant(reward_grant_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE reward_delivery_job (
  reward_delivery_job_id VARCHAR(32) PRIMARY KEY,
  reward_grant_id VARCHAR(32) NOT NULL,
  adapter_type VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at DATETIME,
  delivered_at DATETIME,
  status_checked_at DATETIME,
  request_id VARCHAR(128),
  external_result_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (reward_grant_id) REFERENCES reward_grant(reward_grant_id)
);

CREATE TABLE manual_review_item (
  manual_review_item_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64),
  review_type VARCHAR(32) NOT NULL,
  source_type VARCHAR(32),
  source_id VARCHAR(64),
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL,
  priority VARCHAR(24) NOT NULL,
  metadata JSON,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  operator_id VARCHAR(64),
  resolved_at DATETIME,
  resolution TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE admin_lifecycle_filter_preset (
  preset_id VARCHAR(32) PRIMARY KEY,
  operator_id VARCHAR(64) NOT NULL,
  title VARCHAR(40) NOT NULL,
  filters_json JSON NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'PERSONAL',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 100,
  status VARCHAR(24) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE admin_lifecycle_settlement_job (
  job_id VARCHAR(32) PRIMARY KEY,
  source VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  operator_id VARCHAR(64),
  reason TEXT,
  batch_size INT NOT NULL DEFAULT 20,
  filters_json JSON NOT NULL,
  selection_json JSON NOT NULL,
  root_user_ids JSON NOT NULL,
  processed_root_user_ids JSON NOT NULL,
  failed_root_user_ids JSON NOT NULL,
  items_json JSON NOT NULL,
  last_run_json JSON,
  cleanup_json JSON,
  total_count INT NOT NULL DEFAULT 0,
  run_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  started_at DATETIME,
  finished_at DATETIME,
  cancelled_at DATETIME,
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE admin_lifecycle_user_export (
  export_id VARCHAR(32) PRIMARY KEY,
  source VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  operator_id VARCHAR(64),
  reason TEXT,
  filters_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  filename VARCHAR(128) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  csv_text LONGTEXT,
  download_count INT NOT NULL DEFAULT 0,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
  approval_reason TEXT,
  approval_requested_at DATETIME,
  approval_reviewed_by VARCHAR(64),
  approval_reviewed_at DATETIME,
  approval_note TEXT,
  approval_request_id VARCHAR(128),
  delivery_requested BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_channel VARCHAR(32) NOT NULL DEFAULT 'NONE',
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUESTED',
  delivery_target_json JSON,
  delivery_external_ref VARCHAR(512),
  delivery_error TEXT,
  delivery_delivered_at DATETIME,
  delivery_request_id VARCHAR(128),
  delivery_attempt_count INT NOT NULL DEFAULT 0,
  delivery_last_attempt_at DATETIME,
  delivery_next_retry_at DATETIME,
  delivery_max_attempts INT NOT NULL DEFAULT 0,
  delivery_dead_letter_reason TEXT,
  created_at DATETIME NOT NULL,
  expires_at DATETIME,
  last_downloaded_at DATETIME
);

CREATE TABLE user (
  user_id VARCHAR(32) PRIMARY KEY,
  openid VARCHAR(64) NOT NULL UNIQUE,
  unionid VARCHAR(64),
  phone VARCHAR(16) NOT NULL UNIQUE,
  nickname VARCHAR(64),
  avatar_url VARCHAR(255),
  state VARCHAR(24) NOT NULL,
  created_at DATETIME NOT NULL,
  registered_at DATETIME,
  activated_at DATETIME,
  completed_at DATETIME,
  total_checkin_days INT NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  longest_streak INT NOT NULL DEFAULT 0,
  last_checkin_date DATE
);

CREATE TABLE user_profile (
  profile_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL UNIQUE,
  join_reasons JSON NOT NULL,
  gut_health_status VARCHAR(24) NOT NULL,
  improvement_methods JSON NOT NULL,
  stool_type VARCHAR(12) NOT NULL,
  submitted_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE lead_profile (
  lead_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  external_contact_id VARCHAR(64),
  wechat_remark_name VARCHAR(64),
  receiver_phone VARCHAR(16),
  source_channel VARCHAR(48),
  offline_event_name VARCHAR(64),
  corp_wechat_status VARCHAR(24) NOT NULL,
  rule_sent_at DATETIME,
  operator_note TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE identity_link (
  identity_link_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  receiver_phone VARCHAR(16) NOT NULL,
  external_contact_id VARCHAR(64),
  wechat_remark_name VARCHAR(64),
  match_confidence VARCHAR(16) NOT NULL,
  warnings JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE youzan_product (
  youzan_product_id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  subtitle VARCHAR(128),
  summary TEXT,
  description TEXT,
  image_url VARCHAR(255),
  price_text VARCHAR(64),
  status VARCHAR(24) NOT NULL,
  badge VARCHAR(48),
  youzan_app_id VARCHAR(64),
  youzan_path VARCHAR(255),
  raw_payload JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  synced_at DATETIME
);

CREATE TABLE youzan_sku (
  youzan_sku_id VARCHAR(64) PRIMARY KEY,
  youzan_product_id VARCHAR(64) NOT NULL,
  sku_name VARCHAR(128) NOT NULL,
  price DECIMAL(10, 2),
  price_text VARCHAR(64),
  stock_status VARCHAR(24) NOT NULL,
  raw_payload JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (youzan_product_id) REFERENCES youzan_product(youzan_product_id)
);

CREATE TABLE campaign_product_relation (
  campaign_product_relation_id VARCHAR(32) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  youzan_product_id VARCHAR(64) NOT NULL,
  display_order INT NOT NULL DEFAULT 10,
  badge VARCHAR(48),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE (campaign_id, youzan_product_id),
  FOREIGN KEY (youzan_product_id) REFERENCES youzan_product(youzan_product_id)
);

CREATE TABLE operational_alert_rule (
  alert_rule_id VARCHAR(64) PRIMARY KEY,
  campaign_id VARCHAR(64),
  title VARCHAR(128) NOT NULL,
  description TEXT,
  target_type VARCHAR(32) NOT NULL,
  target_key VARCHAR(64) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  operator VARCHAR(8) NOT NULL,
  threshold_value DECIMAL(10, 2) NOT NULL,
  critical_threshold_value DECIMAL(10, 2),
  severity VARCHAR(16) NOT NULL,
  channel VARCHAR(24) NOT NULL,
  cooldown_minutes INT NOT NULL DEFAULT 60,
  webhook_url VARCHAR(255),
  owner_role VARCHAR(64),
  owner_name VARCHAR(64),
  owner_contact VARCHAR(128),
  route_key VARCHAR(128),
  status VARCHAR(24) NOT NULL,
  config_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE operational_alert_run (
  operational_alert_run_id VARCHAR(32) PRIMARY KEY,
  request_id VARCHAR(128),
  campaign_id VARCHAR(64),
  date_from DATE,
  date_to DATE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(24) NOT NULL,
  triggered_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  summary_json JSON,
  created_at DATETIME NOT NULL
);

CREATE TABLE operational_alert_notification (
  operational_alert_notification_id VARCHAR(32) PRIMARY KEY,
  alert_rule_id VARCHAR(64) NOT NULL,
  alert_key VARCHAR(128) NOT NULL,
  campaign_id VARCHAR(64),
  severity VARCHAR(16) NOT NULL,
  channel VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  title VARCHAR(128) NOT NULL,
  message TEXT,
  target_key VARCHAR(64),
  owner_role VARCHAR(64),
  owner_name VARCHAR(64),
  owner_contact VARCHAR(128),
  route_key VARCHAR(128),
  payload_json JSON,
  request_id VARCHAR(128),
  external_ref VARCHAR(128),
  error TEXT,
  delivered_at DATETIME,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (alert_rule_id) REFERENCES operational_alert_rule(alert_rule_id)
);

CREATE TABLE release_evidence_archive (
  archive_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  base_url VARCHAR(255),
  operator_id VARCHAR(64),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  generated_at DATETIME,
  archived_at DATETIME NOT NULL,
  summary_json JSON,
  validation_json JSON,
  pack_json JSON NOT NULL
);

CREATE TABLE release_signoff (
  signoff_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  role VARCHAR(32) NOT NULL,
  role_label VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  operator_id VARCHAR(64),
  archive_id VARCHAR(32),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  signed_at DATETIME NOT NULL,
  FOREIGN KEY (archive_id) REFERENCES release_evidence_archive(archive_id)
);

CREATE TABLE admin_legacy_deprecation_decision (
  decision_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  operator_id VARCHAR(64),
  evidence_ref VARCHAR(255),
  rollback_ref VARCHAR(255),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  decided_at DATETIME NOT NULL
);

CREATE TABLE production_cutover_proof (
  proof_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  item_label VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL,
  operator_id VARCHAR(64),
  evidence_ref VARCHAR(255),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  recorded_at DATETIME NOT NULL
);

CREATE TABLE root_member_center_jump_proof (
  proof_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  product_title VARCHAR(128),
  status VARCHAR(24) NOT NULL,
  app_id VARCHAR(64) NOT NULL,
  path VARCHAR(255) NOT NULL,
  operator_id VARCHAR(64),
  evidence_ref VARCHAR(255),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  recorded_at DATETIME NOT NULL
);

CREATE TABLE legacy_data_migration_decision (
  decision_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  policy VARCHAR(48) NOT NULL,
  policy_label VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  snapshot_ref VARCHAR(255),
  dry_run_ref VARCHAR(255),
  evidence_ref VARCHAR(255),
  operator_id VARCHAR(64),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  decided_at DATETIME NOT NULL
);

CREATE TABLE legacy_data_migration_execution (
  execution_id VARCHAR(32) PRIMARY KEY,
  target VARCHAR(24) NOT NULL,
  decision_id VARCHAR(32) NOT NULL,
  policy VARCHAR(48) NOT NULL,
  policy_label VARCHAR(64) NOT NULL,
  action VARCHAR(48) NOT NULL,
  action_label VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  snapshot_ref VARCHAR(255),
  dry_run_ref VARCHAR(255),
  execution_ref VARCHAR(255),
  evidence_ref VARCHAR(255),
  affected_session_count INTEGER DEFAULT 0,
  affected_fact_count INTEGER DEFAULT 0,
  operator_id VARCHAR(64),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  note TEXT,
  executed_at DATETIME NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES legacy_data_migration_decision(decision_id)
);

CREATE TABLE product_jump_log (
  product_jump_log_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  youzan_product_id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64),
  jump_target JSON,
  source_channel VARCHAR(64),
  metadata JSON,
  occurred_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (youzan_product_id) REFERENCES youzan_product(youzan_product_id)
);

CREATE TABLE youzan_customer (
  youzan_yz_uid VARCHAR(64) PRIMARY KEY,
  unionid VARCHAR(64),
  root_user_id VARCHAR(32),
  phone VARCHAR(16),
  nickname VARCHAR(64),
  match_source VARCHAR(32),
  raw_payload JSON,
  linked_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id)
);

CREATE TABLE youzan_order (
  order_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32),
  youzan_yz_uid VARCHAR(64),
  youzan_order_no VARCHAR(64) NOT NULL UNIQUE,
  phone VARCHAR(16) NOT NULL,
  receiver_name VARCHAR(64),
  receiver_phone VARCHAR(16),
  product_name VARCHAR(64),
  product_id VARCHAR(32) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  paid_at DATETIME,
  order_status VARCHAR(24) NOT NULL DEFAULT 'PAID',
  delivery_status VARCHAR(16) NOT NULL,
  after_sales_status VARCHAR(24) NOT NULL DEFAULT 'NONE',
  after_sales_no VARCHAR(64),
  refund_status VARCHAR(24) NOT NULL DEFAULT 'NONE',
  refund_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  after_sales_updated_at DATETIME,
  raw_address_text TEXT,
  matched_at DATETIME,
  match_source VARCHAR(24),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (youzan_yz_uid) REFERENCES youzan_customer(youzan_yz_uid)
);

CREATE TABLE order_after_sales_record (
  order_after_sales_record_id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32),
  youzan_order_no VARCHAR(64) NOT NULL,
  root_user_id VARCHAR(32),
  user_id VARCHAR(32),
  after_sales_no VARCHAR(64) NOT NULL UNIQUE,
  after_sales_type VARCHAR(32) NOT NULL,
  raw_status VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  refund_status VARCHAR(24) NOT NULL,
  refund_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  external_ref VARCHAR(128),
  source_type VARCHAR(32) NOT NULL,
  source_run_id VARCHAR(64),
  payload_json JSON,
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  synced_at DATETIME,
  recovered_at DATETIME,
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE order_fulfillment (
  fulfillment_id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL UNIQUE,
  receiver_name VARCHAR(64),
  receiver_phone VARCHAR(16),
  carrier VARCHAR(32),
  tracking_no VARCHAR(64),
  delivery_status VARCHAR(16) NOT NULL,
  shipped_at DATETIME,
  delivered_at DATETIME,
  last_event_text TEXT,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE operation_task (
  task_id VARCHAR(32) PRIMARY KEY,
  task_type VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  order_id VARCHAR(32),
  task_date DATE NOT NULL,
  dedupe_key VARCHAR(96),
  status VARCHAR(16) NOT NULL,
  reason TEXT,
  suggested_action TEXT,
  suggested_script TEXT,
  metadata JSON,
  created_at DATETIME NOT NULL,
  completed_at DATETIME,
  result TEXT,
  note TEXT,
  UNIQUE (task_type, user_id, order_id, task_date, dedupe_key),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE consultation_wework_writeback (
  writeback_id VARCHAR(32) PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  task_event_id VARCHAR(32),
  root_user_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  campaign_id VARCHAR(64),
  consultation_type VARCHAR(32),
  adapter_type VARCHAR(48) NOT NULL,
  status VARCHAR(24) NOT NULL,
  external_contact_id VARCHAR(64),
  external_ref VARCHAR(128),
  operator_id VARCHAR(64),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  message TEXT,
  note TEXT,
  payload_json JSON,
  created_at DATETIME NOT NULL,
  delivered_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES operation_task(task_id),
  FOREIGN KEY (task_event_id) REFERENCES task_event(task_event_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE consultation_advisor_assignment (
  assignment_id VARCHAR(32) PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  task_event_id VARCHAR(32),
  root_user_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  campaign_id VARCHAR(64),
  consultation_type VARCHAR(32),
  assignment_mode VARCHAR(24) NOT NULL,
  advisor_id VARCHAR(64) NOT NULL,
  advisor_name VARCHAR(64),
  advisor_role VARCHAR(32),
  previous_advisor_id VARCHAR(64),
  previous_advisor_name VARCHAR(64),
  status VARCHAR(24) NOT NULL,
  operator_id VARCHAR(64),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  reason TEXT,
  created_at DATETIME NOT NULL,
  replaced_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES operation_task(task_id),
  FOREIGN KEY (task_event_id) REFERENCES task_event(task_event_id),
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE wework_touch_job (
  wework_touch_job_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  task_id VARCHAR(32) NOT NULL,
  task_type VARCHAR(48) NOT NULL,
  campaign_id VARCHAR(64),
  external_contact_id VARCHAR(128),
  touch_type VARCHAR(32) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL,
  adapter_type VARCHAR(32) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  external_ref VARCHAR(128),
  last_error TEXT,
  request_id VARCHAR(128),
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  due_at DATETIME,
  payload_json JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  delivered_at DATETIME,
  FOREIGN KEY (root_user_id) REFERENCES root_user(root_user_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (task_id) REFERENCES operation_task(task_id),
  FOREIGN KEY (campaign_id) REFERENCES campaign_definition(campaign_id)
);

CREATE TABLE daily_summary (
  date DATE PRIMARY KEY,
  active_sessions INT NOT NULL,
  completed_sessions INT NOT NULL,
  failed_sessions INT NOT NULL,
  due_today INT NOT NULL,
  checked_today INT NOT NULL,
  missed_today INT NOT NULL,
  day4_pending INT NOT NULL,
  day8_pending INT NOT NULL,
  refund_pending INT NOT NULL,
  coupon_unused INT NOT NULL,
  open_tasks INT NOT NULL,
  generated_tasks INT NOT NULL,
  audited_at DATETIME NOT NULL
);

CREATE TABLE checkin_session (
  session_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL,
  miss_count INT NOT NULL DEFAULT 0,
  audited_miss_days JSON,
  refund_status VARCHAR(16),
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE checkin_record (
  record_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  day_index INT NOT NULL,
  checkin_date DATE NOT NULL,
  took_product BOOLEAN NOT NULL,
  had_stool BOOLEAN NOT NULL,
  stool_type VARCHAR(12),
  feedback TEXT,
  image_urls JSON,
  checked_in_at DATETIME NOT NULL,
  is_makeup BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (session_id, day_index),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE questionnaire_definition (
  questionnaire_type VARCHAR(32) NOT NULL,
  version INT NOT NULL,
  questions JSON NOT NULL,
  required_fields JSON NOT NULL,
  skip_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (questionnaire_type, version)
);

CREATE TABLE questionnaire_response (
  response_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  questionnaire_type VARCHAR(32) NOT NULL,
  version INT NOT NULL,
  answers JSON NOT NULL,
  submitted_at DATETIME NOT NULL,
  needs_follow BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key VARCHAR(64),
  UNIQUE (user_id, session_id, questionnaire_type),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id)
);

CREATE TABLE refund_work_item (
  refund_work_item_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL UNIQUE,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  youzan_order_no VARCHAR(64) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  paid_at DATETIME,
  note TEXT,
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE coupon_event (
  coupon_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32),
  coupon_type VARCHAR(32) NOT NULL,
  experiment_group VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason VARCHAR(48),
  title VARCHAR(64),
  description TEXT,
  discount_text VARCHAR(64),
  code VARCHAR(32),
  issued_at DATETIME,
  claimed_at DATETIME,
  used_at DATETIME,
  expires_at DATE,
  repurchase_clicked_at DATETIME,
  created_at DATETIME NOT NULL,
  UNIQUE (session_id, coupon_type),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE refund (
  refund_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  youzan_order_no VARCHAR(64) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  paid_at DATETIME,
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE daily_checkin_record (
  record_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  checkin_date DATE NOT NULL,
  took_product BOOLEAN NOT NULL,
  had_stool BOOLEAN NOT NULL,
  stool_type VARCHAR(12),
  feedback TEXT,
  checked_in_at DATETIME NOT NULL,
  streak_count INT NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE (user_id, checkin_date),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);
