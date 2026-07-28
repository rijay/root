-- A governed SHADOW_REBUILD must persist the exact static executor Registry
-- identity that was authorized. Existing replay rows cannot be backfilled from
-- runtime claims, so the migration fails closed when any run already exists.

DROP TEMPORARY TABLE IF EXISTS migration_023_replay_executor_identity_preflight;

CREATE TEMPORARY TABLE migration_023_replay_executor_identity_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_023_replay_executor_identity_preflight (guard_id) VALUES (1);

INSERT INTO migration_023_replay_executor_identity_preflight (guard_id)
SELECT 1
FROM inbox_replay_run
LIMIT 1;

DROP TEMPORARY TABLE migration_023_replay_executor_identity_preflight;

ALTER TABLE inbox_replay_run
  ADD COLUMN execution_executor_registry_version INT UNSIGNED NULL
    AFTER execution_handler_version,
  ADD COLUMN execution_executor_registry_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER execution_executor_registry_version,
  ADD COLUMN execution_executor_descriptor_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER execution_executor_registry_digest,
  ADD COLUMN execution_executor_source_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER execution_executor_descriptor_digest,
  ADD COLUMN execution_executor_registration_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER execution_executor_source_digest,
  ADD CONSTRAINT chk_inbox_replay_executor_identity
    CHECK (
      (
        replay_mode = 'VERIFY_ONLY'
        AND execution_executor_registry_version IS NULL
        AND execution_executor_registry_digest IS NULL
        AND execution_executor_descriptor_digest IS NULL
        AND execution_executor_source_digest IS NULL
        AND execution_executor_registration_digest IS NULL
      )
      OR
      (
        replay_mode = 'SHADOW_REBUILD'
        AND execution_executor_registry_version = 1
        AND execution_executor_registry_digest =
          '9e4ebb37cb7cb07c5c51308826ca0ab50647255a9097c78f136868b67788802f'
        AND execution_executor_descriptor_digest =
          'b6bed52a15aacf6bc75e3ea6fc1aa2ad7b5a2c61ab017f27b11f0b971034e0f3'
        AND execution_executor_source_digest =
          '344558609a1315f3b259766002ab777ce1c3bcdcca8d1d37db0f4ca0ef460046'
        AND execution_executor_registration_digest =
          'c73ffac6b513505bf17b88ae073c9ff5c19d5c5ec63dcf9032c0a8b9b4a60cb7'
      )
    );
