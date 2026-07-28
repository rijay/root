-- Derive an event's generation from the count of ENROLL operations at or before
-- its event_sequence. The temporary tables make the derivation stable across the
-- validation and update statements. Replaying this migration is idempotent.

DROP TEMPORARY TABLE IF EXISTS migration_037_activity_event_generation_guard;

DROP TEMPORARY TABLE IF EXISTS migration_037_activity_event_generation_derived;

DROP TEMPORARY TABLE IF EXISTS migration_037_activity_event_generation_stream;

CREATE TEMPORARY TABLE migration_037_activity_event_generation_derived (
  activity_enrollment_event_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_enrollment_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  activity_session_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  root_user_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  expected_sequence INT UNSIGNED NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_to_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  stored_generation INT UNSIGNED NULL,
  derived_generation INT UNSIGNED NOT NULL,
  PRIMARY KEY (activity_enrollment_event_id),
  KEY idx_migration_037_enrollment (activity_enrollment_id, derived_generation)
) ENGINE=InnoDB;

INSERT INTO migration_037_activity_event_generation_derived (
  activity_enrollment_event_id,
  activity_enrollment_id,
  activity_session_id,
  root_user_id,
  event_sequence,
  expected_sequence,
  operation,
  from_status,
  to_status,
  previous_to_status,
  stored_generation,
  derived_generation
)
SELECT
  activity_enrollment_event_id,
  activity_enrollment_id,
  activity_session_id,
  root_user_id,
  event_sequence,
  ROW_NUMBER() OVER (
    PARTITION BY activity_enrollment_id
    ORDER BY event_sequence
  ) AS expected_sequence,
  operation,
  from_status,
  to_status,
  LAG(to_status) OVER (
    PARTITION BY activity_enrollment_id
    ORDER BY event_sequence
  ) AS previous_to_status,
  attempt_generation,
  SUM(CASE WHEN operation = 'ENROLL' THEN 1 ELSE 0 END) OVER (
    PARTITION BY activity_enrollment_id
    ORDER BY event_sequence
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS derived_generation
FROM activity_enrollment_event;

-- MySQL cannot reopen the same temporary table from both an outer query and a
-- derived subquery. Materialize the per-enrollment terminal generation in a
-- distinct temporary table so every statement opens each temporary table once.
CREATE TEMPORARY TABLE migration_037_activity_event_generation_stream (
  activity_enrollment_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  final_generation INT UNSIGNED NOT NULL,
  PRIMARY KEY (activity_enrollment_id)
) ENGINE=InnoDB;

INSERT INTO migration_037_activity_event_generation_stream (
  activity_enrollment_id,
  final_generation
)
SELECT
  activity_enrollment_id,
  MAX(derived_generation)
FROM migration_037_activity_event_generation_derived
GROUP BY activity_enrollment_id;

CREATE TEMPORARY TABLE migration_037_activity_event_generation_guard (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE=InnoDB;

INSERT INTO migration_037_activity_event_generation_guard (guard_id) VALUES (1);

-- A duplicate guard_id aborts before the permanent UPDATE when any history is
-- ambiguous, cross-bound, already conflicting, or incomplete.
INSERT INTO migration_037_activity_event_generation_guard (guard_id)
SELECT 1
FROM migration_037_activity_event_generation_derived AS derived
JOIN activity_enrollment AS enrollment
  ON enrollment.activity_enrollment_id = derived.activity_enrollment_id
JOIN migration_037_activity_event_generation_stream AS stream
  ON stream.activity_enrollment_id = derived.activity_enrollment_id
WHERE derived.derived_generation < 1
   OR derived.event_sequence <> derived.expected_sequence
   OR derived.activity_session_id <> enrollment.activity_session_id
   OR derived.root_user_id <> enrollment.root_user_id
   OR (
     derived.event_sequence = 1
     AND (derived.operation <> 'ENROLL' OR derived.from_status IS NOT NULL)
   )
   OR (
     derived.event_sequence > 1
     AND NOT (derived.from_status <=> derived.previous_to_status)
   )
   OR (
     derived.operation = 'ENROLL'
     AND (
       (derived.derived_generation = 1 AND derived.from_status IS NOT NULL)
       OR (derived.derived_generation > 1 AND derived.from_status <> 'CANCELED')
       OR derived.to_status NOT IN ('PENDING', 'CONFIRMED')
     )
   )
   OR (
     derived.operation = 'REVIEW'
     AND (
       derived.from_status <> 'PENDING'
       OR derived.to_status NOT IN ('CONFIRMED', 'REJECTED')
     )
   )
   OR (
     derived.operation = 'REVIEW_TIMEOUT'
     AND (derived.from_status <> 'PENDING' OR derived.to_status <> 'REJECTED')
   )
   OR (
     derived.operation IN ('CANCEL', 'SESSION_CANCEL')
     AND (
       derived.from_status NOT IN ('PENDING', 'CONFIRMED')
       OR derived.to_status <> 'CANCELED'
     )
   )
   OR (
     derived.stored_generation IS NOT NULL
     AND derived.stored_generation <> derived.derived_generation
   )
   OR stream.final_generation <> enrollment.attempt_generation
LIMIT 1;

-- A durable enrollment without an initial ENROLL fact cannot be assigned a
-- generation without inference, even when every existing event stream is valid.
INSERT INTO migration_037_activity_event_generation_guard (guard_id)
SELECT 1
FROM activity_enrollment AS enrollment
LEFT JOIN migration_037_activity_event_generation_derived AS derived
  ON derived.activity_enrollment_id = enrollment.activity_enrollment_id
WHERE derived.activity_enrollment_event_id IS NULL
LIMIT 1;

UPDATE activity_enrollment_event AS event
JOIN migration_037_activity_event_generation_derived AS derived
  ON derived.activity_enrollment_event_id = event.activity_enrollment_event_id
SET event.attempt_generation = derived.derived_generation
WHERE event.attempt_generation IS NULL;

-- Validate the durable readback before the migration ledger can be written.
INSERT INTO migration_037_activity_event_generation_guard (guard_id)
SELECT 1
FROM activity_enrollment_event AS event
JOIN migration_037_activity_event_generation_derived AS derived
  ON derived.activity_enrollment_event_id = event.activity_enrollment_event_id
WHERE event.attempt_generation IS NULL
   OR event.attempt_generation <> derived.derived_generation
LIMIT 1;

DROP TEMPORARY TABLE migration_037_activity_event_generation_guard;

DROP TEMPORARY TABLE migration_037_activity_event_generation_stream;

DROP TEMPORARY TABLE migration_037_activity_event_generation_derived;
