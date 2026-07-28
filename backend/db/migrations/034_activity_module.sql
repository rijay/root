-- V1 Activity Module facts. Formal content is versioned and operations-owned;
-- session/user enrollment uniqueness is enforced independently of legacy campaign facts.

CREATE TABLE IF NOT EXISTS activity_definition_version (
  activity_version_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  version INT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  summary VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  detail_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  city VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  venue_summary VARCHAR(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hero_asset_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  privacy_notice_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  photography_notice_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_approval_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_owner_signer_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  review_reason VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL,
  reviewer_signer_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  publish_owner_signer_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  withdraw_owner_signer_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  withdraw_reason VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL,
  archive_owner_signer_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  archive_reason VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_requirement VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL,
  prebound_task_definition_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (activity_version_id),
  UNIQUE KEY uk_activity_definition_version (activity_id, version),
  KEY idx_activity_definition_publish (status, city, activity_type, published_at),
  CONSTRAINT chk_activity_definition_version_positive CHECK (version > 0),
  CONSTRAINT chk_activity_definition_status CHECK (
    status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
  ),
  CONSTRAINT chk_activity_definition_source CHECK (source = 'OPS_BACKEND'),
  CONSTRAINT chk_activity_definition_visibility CHECK (visibility IN ('PUBLIC', 'MEMBER')),
  CONSTRAINT chk_activity_definition_review_reason CHECK (
    review_reason_code IS NULL OR review_reason_code = 'CHANGES_REQUESTED'
  ),
  CONSTRAINT chk_activity_definition_publish_shape CHECK (
    (status = 'PUBLISHED' AND publish_owner_signer_ref IS NOT NULL AND published_at IS NOT NULL)
    OR status <> 'PUBLISHED'
  ),
  CONSTRAINT chk_activity_definition_archive_shape CHECK (
    (status = 'ARCHIVED' AND archive_owner_signer_ref IS NOT NULL AND archive_reason IS NOT NULL)
    OR status <> 'ARCHIVED'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_session (
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_version_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  capacity INT UNSIGNED NOT NULL,
  registration_open_at DATETIME(3) NOT NULL,
  registration_close_at DATETIME(3) NOT NULL,
  review_deadline DATETIME(3) NULL,
  session_start_at DATETIME(3) NOT NULL,
  session_end_at DATETIME(3) NOT NULL,
  allow_reapply TINYINT(1) NOT NULL DEFAULT 0,
  cancel_reason VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancel_reason_detail VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (activity_session_id),
  KEY idx_activity_session_visible (status, session_start_at, activity_version_id),
  KEY idx_activity_session_registration (status, registration_open_at, registration_close_at),
  KEY fk_activity_session_version (activity_version_id),
  CONSTRAINT fk_activity_session_version
    FOREIGN KEY (activity_version_id) REFERENCES activity_definition_version (activity_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_activity_session_status CHECK (
    status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELED', 'ENDED')
  ),
  CONSTRAINT chk_activity_session_approval CHECK (approval_mode IN ('AUTO', 'MANUAL')),
  CONSTRAINT chk_activity_session_capacity CHECK (capacity > 0),
  CONSTRAINT chk_activity_session_time_order CHECK (
    registration_open_at < registration_close_at
    AND registration_close_at <= session_start_at
    AND session_start_at < session_end_at
  ),
  CONSTRAINT chk_activity_session_review_deadline CHECK (
    (approval_mode = 'MANUAL' AND review_deadline IS NOT NULL)
    OR (approval_mode = 'AUTO')
  ),
  CONSTRAINT chk_activity_session_cancel_shape CHECK (
    (status = 'CANCELED' AND cancel_reason IS NOT NULL)
    OR (status <> 'CANCELED' AND cancel_reason IS NULL)
  ),
  CONSTRAINT chk_activity_session_cancel_reason CHECK (
    cancel_reason IS NULL OR cancel_reason IN (
      'OPERATOR_CANCELED', 'WEATHER', 'VENUE', 'FORCE_MAJEURE', 'OTHER'
    )
  ),
  CONSTRAINT chk_activity_session_other_reason CHECK (
    cancel_reason <> 'OTHER' OR cancel_reason_detail IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_enrollment (
  activity_enrollment_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempt_generation INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (activity_enrollment_id),
  UNIQUE KEY uk_activity_enrollment_session_user (activity_session_id, root_user_id),
  KEY idx_activity_enrollment_user_status (root_user_id, status, updated_at),
  KEY idx_activity_enrollment_session_status (activity_session_id, status, updated_at),
  CONSTRAINT fk_activity_enrollment_session
    FOREIGN KEY (activity_session_id) REFERENCES activity_session (activity_session_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_activity_enrollment_user
    FOREIGN KEY (root_user_id) REFERENCES root_user (root_user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_activity_enrollment_status CHECK (
    status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELED')
  ),
  CONSTRAINT chk_activity_enrollment_generation CHECK (attempt_generation > 0),
  CONSTRAINT chk_activity_enrollment_reason CHECK (
    reason_code IS NULL OR reason_code IN (
      'USER_CANCELED', 'SESSION_CANCELED', 'APPROVAL_REJECTED', 'REVIEW_TIMEOUT',
      'CAPACITY_FULL', 'CAPACITY_FULL_AT_REVIEW', 'CUTOFF_PASSED', 'POLICY_BLOCKED',
      'OPERATOR_CORRECTION'
    )
  ),
  CONSTRAINT chk_activity_enrollment_reason_shape CHECK (
    (status IN ('PENDING', 'CONFIRMED') AND reason_code IS NULL)
    OR (status IN ('REJECTED', 'CANCELED') AND reason_code IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_enrollment_event (
  activity_enrollment_event_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_enrollment_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (activity_enrollment_event_id),
  UNIQUE KEY uk_activity_enrollment_event_request (request_id),
  UNIQUE KEY uk_activity_enrollment_event_sequence (activity_enrollment_id, event_sequence),
  KEY idx_activity_enrollment_event_session (activity_session_id, occurred_at),
  KEY idx_activity_enrollment_event_user (root_user_id, occurred_at),
  CONSTRAINT fk_activity_enrollment_event_enrollment
    FOREIGN KEY (activity_enrollment_id) REFERENCES activity_enrollment (activity_enrollment_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_activity_enrollment_event_session
    FOREIGN KEY (activity_session_id) REFERENCES activity_session (activity_session_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_activity_enrollment_event_user
    FOREIGN KEY (root_user_id) REFERENCES root_user (root_user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_activity_enrollment_event_sequence CHECK (event_sequence > 0),
  CONSTRAINT chk_activity_enrollment_event_operation CHECK (
    operation IN ('ENROLL', 'REVIEW', 'REVIEW_TIMEOUT', 'CANCEL', 'SESSION_CANCEL')
  ),
  CONSTRAINT chk_activity_enrollment_event_from_status CHECK (
    from_status IS NULL OR from_status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELED')
  ),
  CONSTRAINT chk_activity_enrollment_event_to_status CHECK (
    to_status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
