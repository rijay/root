-- Re-check historical uniqueness immediately before the permanent enforcing
-- ALTER. This also catches duplicates introduced after migration 040.
DROP TEMPORARY TABLE IF EXISTS migration_045_activity_session_business_time_preflight;

CREATE TEMPORARY TABLE migration_045_activity_session_business_time_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_045_activity_session_business_time_preflight (guard_id)
VALUES (1);

INSERT INTO migration_045_activity_session_business_time_preflight (guard_id)
SELECT 1
FROM activity_session
GROUP BY activity_version_id, session_start_at
HAVING COUNT(*) > 1
LIMIT 1;

DROP TEMPORARY TABLE migration_045_activity_session_business_time_preflight;

ALTER TABLE activity_session
  MODIFY COLUMN cancel_close_at DATETIME(3) NOT NULL,
  ADD UNIQUE KEY uk_activity_session_business_time (
    activity_version_id,
    session_start_at
  ),
  ADD CONSTRAINT chk_activity_session_cancel_window
    CHECK (
      registration_open_at < cancel_close_at
      AND cancel_close_at <= session_start_at
    );
