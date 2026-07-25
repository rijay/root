-- Complete the v1 Activity P0 content model and make cancellation policy
-- independent from registration close. Existing local-only rows are backfilled
-- conservatively; runtime validation still rejects empty formal content.

-- MySQL DDL commits implicitly. Detect historical business-time duplicates
-- before the first permanent ALTER so a failed unique-key addition can never
-- leave this migration partially applied.
DROP TEMPORARY TABLE IF EXISTS migration_040_activity_session_business_time_preflight;

CREATE TEMPORARY TABLE migration_040_activity_session_business_time_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_040_activity_session_business_time_preflight (guard_id)
VALUES (1);

INSERT INTO migration_040_activity_session_business_time_preflight (guard_id)
SELECT 1
FROM activity_session
GROUP BY activity_version_id, session_start_at
HAVING COUNT(*) > 1
LIMIT 1;

DROP TEMPORARY TABLE migration_040_activity_session_business_time_preflight;

ALTER TABLE activity_definition_version
  ADD COLUMN objective VARCHAR(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER summary,
  ADD COLUMN audience VARCHAR(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER objective,
  ADD COLUMN agenda VARCHAR(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER audience,
  ADD COLUMN organizer VARCHAR(256) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER agenda,
  ADD COLUMN fee_description VARCHAR(256) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER organizer,
  ADD COLUMN bring_items VARCHAR(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER fee_description,
  ADD COLUMN cancel_policy VARCHAR(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER bring_items,
  ADD COLUMN privacy_notice_text VARCHAR(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER cancel_policy,
  ADD COLUMN photography_notice_text VARCHAR(2048) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER privacy_notice_text,
  ADD COLUMN contact_display VARCHAR(256) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''
    AFTER photography_notice_text,
  ADD COLUMN prebound_task_definition_version VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER prebound_task_definition_id;
