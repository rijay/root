CREATE TABLE IF NOT EXISTS analytics_event (
  analytics_event_id VARCHAR(32) PRIMARY KEY,
  root_user_id VARCHAR(32) NULL,
  event_name VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  source VARCHAR(32) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_analytics_event_name_time (event_name, occurred_at),
  KEY idx_analytics_event_user_time (root_user_id, occurred_at),
  CONSTRAINT fk_analytics_event_root_user
    FOREIGN KEY (root_user_id)
    REFERENCES root_user (root_user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
