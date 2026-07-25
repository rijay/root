-- A concrete authority row gives the Store and the Inbox Handler the same
-- deterministic lock.  This removes the absent-row race without depending on
-- transaction isolation defaults or incidental gap locks.

CREATE TABLE IF NOT EXISTS settlement_source_authority (
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  campaign_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (root_user_id, campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Handler-owned resolution evidence is append-only relational authority.  It
-- is deliberately outside root_store_snapshot and its projection registry.

CREATE TABLE IF NOT EXISTS settlement_source_resolution_audit (
  settlement_source_resolution_audit_id CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  manual_review_item_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  campaign_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_id VARCHAR(64) COLLATE utf8mb4_0900_bin NOT NULL,
  resolution VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resolution_note VARCHAR(512) COLLATE utf8mb4_0900_bin NOT NULL,
  public_note VARCHAR(512) COLLATE utf8mb4_0900_bin NULL,
  before_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  after_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_resolved_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (settlement_source_resolution_audit_id),
  UNIQUE KEY uk_settlement_source_resolution_candidate (manual_review_item_id),
  UNIQUE KEY uk_settlement_source_resolution_request (request_id),
  KEY idx_settlement_source_resolution_scope (
    root_user_id, campaign_id, created_at,
    settlement_source_resolution_audit_id
  ),
  CONSTRAINT fk_settlement_source_resolution_candidate
    FOREIGN KEY (manual_review_item_id)
    REFERENCES manual_review_item (manual_review_item_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_settlement_source_resolution_authority
    FOREIGN KEY (root_user_id, campaign_id)
    REFERENCES settlement_source_authority (root_user_id, campaign_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE manual_review_item
  ADD KEY idx_manual_review_source_scope (
    source_type, root_user_id, campaign_id, created_at,
    manual_review_item_id
  );
