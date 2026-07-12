CREATE TABLE IF NOT EXISTS privacy_consent_record (
  privacy_consent_record_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NOT NULL,
  consent_type VARCHAR(48) NOT NULL,
  policy_version VARCHAR(96) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  purposes_json JSON NOT NULL,
  data_categories_json JSON NOT NULL,
  source_channel VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_privacy_consent_user_type_time (root_user_id, consent_type, occurred_at),
  KEY idx_privacy_consent_policy_decision (policy_version, decision)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
