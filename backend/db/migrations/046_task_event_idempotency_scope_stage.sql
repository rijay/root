-- Stage the durable task-event idempotency scope and keyed request digest.
-- Digest columns remain nullable so historical rows are represented truthfully
-- until an equal replay upgrades them with the active request-digest key.
-- Historical rows may have used either a server-generated or client-supplied
-- occurred_at. NULL is the only truthful backfill until durable provenance
-- exists; runtime must fail closed rather than guess.

ALTER TABLE task_event
  ADD COLUMN idempotency_operation VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT 'RECORD_TASK_EVENT:v1'
    AFTER idempotency_key,
  ADD COLUMN request_canonical_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER idempotency_operation,
  ADD COLUMN request_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER request_canonical_version,
  ADD COLUMN request_digest_scheme VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER request_digest,
  ADD COLUMN request_digest_key_id VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER request_digest_scheme,
  ADD COLUMN occurred_at_client_supplied TINYINT(1) NULL
    AFTER request_digest_key_id;
