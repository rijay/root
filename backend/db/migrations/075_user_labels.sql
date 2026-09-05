CREATE TABLE IF NOT EXISTS user_label_mapping (
  user_label_mapping_id VARCHAR(32) PRIMARY KEY,
  source_type VARCHAR(24) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_version INT NOT NULL,
  mapping_version INT NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  attributes_json JSON NOT NULL,
  reason VARCHAR(200) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_user_label_mapping_version (source_type, source_id, source_version, mapping_version),
  UNIQUE KEY uk_user_label_mapping_time (source_type, source_id, source_version, effective_from)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_label_sync_state (
  user_label_sync_state_id VARCHAR(32) PRIMARY KEY,
  target_key VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  record_id VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  pending_json JSON NOT NULL,
  last_error_code VARCHAR(64) NULL,
  synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_user_label_sync_target_user (target_key, root_user_id),
  KEY idx_user_label_sync_status (target_key, status),
  CONSTRAINT fk_user_label_sync_user FOREIGN KEY (root_user_id) REFERENCES root_user (root_user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
