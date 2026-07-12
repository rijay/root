CREATE TABLE IF NOT EXISTS root_store_snapshot (
  store_key VARCHAR(128) PRIMARY KEY,
  schema_version INT NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  payload_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
