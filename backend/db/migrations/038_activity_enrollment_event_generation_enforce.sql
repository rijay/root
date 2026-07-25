-- Fail before the only permanent DDL if the deterministic backfill did not
-- populate every existing event.

DROP TEMPORARY TABLE IF EXISTS migration_038_activity_event_generation_guard;

CREATE TEMPORARY TABLE migration_038_activity_event_generation_guard (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE=InnoDB;

INSERT INTO migration_038_activity_event_generation_guard (guard_id) VALUES (1);

INSERT INTO migration_038_activity_event_generation_guard (guard_id)
SELECT 1
FROM activity_enrollment_event
WHERE attempt_generation IS NULL OR attempt_generation < 1
LIMIT 1;

DROP TEMPORARY TABLE migration_038_activity_event_generation_guard;

ALTER TABLE activity_enrollment_event
  MODIFY COLUMN attempt_generation INT UNSIGNED NOT NULL,
  ADD CONSTRAINT chk_activity_enrollment_event_generation CHECK (attempt_generation > 0);
