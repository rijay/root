CREATE TABLE IF NOT EXISTS notification_subscription_grant (
  notification_subscription_grant_id VARCHAR(32) PRIMARY KEY,
  notification_subscription_id VARCHAR(32) NOT NULL,
  root_user_id VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(64) NULL,
  template_key VARCHAR(64) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  grant_request_id VARCHAR(96) NOT NULL,
  status VARCHAR(32) NOT NULL,
  notification_job_id VARCHAR(32) NULL,
  last_notification_job_id VARCHAR(32) NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  source_channel VARCHAR(64) NULL,
  granted_at DATETIME(3) NOT NULL,
  reserved_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  released_at DATETIME(3) NULL,
  invalidated_at DATETIME(3) NULL,
  review_required_at DATETIME(3) NULL,
  release_reason VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_notification_subscription_grant_idempotency (idempotency_key),
  KEY idx_notification_subscription_grant_available (root_user_id, template_key, template_version, campaign_id, status),
  KEY idx_notification_subscription_grant_job (notification_job_id),
  KEY idx_notification_subscription_grant_review (status, updated_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE notification_job
  ADD COLUMN notification_subscription_grant_id VARCHAR(32) NULL AFTER template_version;

ALTER TABLE notification_delivery
  ADD COLUMN notification_subscription_grant_id VARCHAR(32) NULL AFTER template_version,
  ADD COLUMN external_error_code VARCHAR(64) NULL AFTER error_code,
  ADD COLUMN delivery_outcome VARCHAR(32) NULL AFTER error_message;
