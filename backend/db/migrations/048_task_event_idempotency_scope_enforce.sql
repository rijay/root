-- Fail before permanent DDL if staged task-event state cannot satisfy the
-- scoped uniqueness and all-or-none digest invariants.
DROP TEMPORARY TABLE IF EXISTS migration_048_task_event_idempotency_preflight;

CREATE TEMPORARY TABLE migration_048_task_event_idempotency_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_048_task_event_idempotency_preflight (guard_id)
VALUES (1);

INSERT INTO migration_048_task_event_idempotency_preflight (guard_id)
SELECT 1
FROM task_event
WHERE idempotency_operation IS NULL
   OR idempotency_operation <> 'RECORD_TASK_EVENT:v1'
   OR idempotency_key NOT REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
   OR (
     occurred_at_client_supplied IS NOT NULL
     AND occurred_at_client_supplied NOT IN (0, 1)
   )
   OR NOT (
     (
       request_canonical_version IS NULL
       AND request_digest IS NULL
       AND request_digest_scheme IS NULL
       AND request_digest_key_id IS NULL
     )
     OR (
       request_canonical_version IS NOT NULL
       AND request_digest IS NOT NULL
       AND request_digest_scheme IS NOT NULL
       AND request_digest_key_id IS NOT NULL
       AND request_canonical_version = 'canonical-json:v1'
       AND request_digest REGEXP '^[0-9a-f]{64}$'
       AND request_digest_scheme = 'hmac-sha256:v1'
       AND request_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     )
   )
LIMIT 1;

INSERT INTO migration_048_task_event_idempotency_preflight (guard_id)
SELECT 1
FROM task_event
GROUP BY root_user_id, idempotency_operation, idempotency_key
HAVING COUNT(*) > 1
LIMIT 1;

DROP TEMPORARY TABLE migration_048_task_event_idempotency_preflight;

ALTER TABLE task_event
  MODIFY COLUMN idempotency_key VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN idempotency_operation VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RECORD_TASK_EVENT:v1',
  MODIFY COLUMN occurred_at_client_supplied TINYINT(1) NULL,
  DROP INDEX uk_task_event_idempotency,
  ADD UNIQUE KEY uk_task_event_idempotency_scope (
    root_user_id,
    idempotency_operation,
    idempotency_key
  ),
  ADD KEY idx_task_event_request_digest_crypto (
    request_digest_scheme,
    request_digest_key_id,
    task_event_id
  ),
  ADD CONSTRAINT chk_task_event_idempotency_operation
    CHECK (idempotency_operation = 'RECORD_TASK_EVENT:v1'),
  ADD CONSTRAINT chk_task_event_request_digest_metadata
    CHECK (
      (
        request_canonical_version IS NULL
        AND request_digest IS NULL
        AND request_digest_scheme IS NULL
        AND request_digest_key_id IS NULL
      )
      OR (
        request_canonical_version IS NOT NULL
        AND request_digest IS NOT NULL
        AND request_digest_scheme IS NOT NULL
        AND request_digest_key_id IS NOT NULL
        AND request_canonical_version = 'canonical-json:v1'
        AND request_digest REGEXP '^[0-9a-f]{64}$'
        AND request_digest_scheme = 'hmac-sha256:v1'
        AND request_digest_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      )
    ),
  ADD CONSTRAINT chk_task_event_occurred_at_provenance
    CHECK (
      occurred_at_client_supplied IS NULL
      OR occurred_at_client_supplied IN (0, 1)
    );
