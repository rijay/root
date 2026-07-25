-- A durable receipt must identify the exact static handler Registry entry and
-- the reviewed handler source that produced its outcome. Existing receipts
-- cannot be backfilled from runtime claims, so the migration fails closed when
-- any receipt already exists.

DROP TEMPORARY TABLE IF EXISTS migration_014_inbox_handler_identity_preflight;

CREATE TEMPORARY TABLE migration_014_inbox_handler_identity_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_014_inbox_handler_identity_preflight (guard_id) VALUES (1);

INSERT INTO migration_014_inbox_handler_identity_preflight (guard_id)
SELECT 1
FROM inbox_receipt
LIMIT 1;

DROP TEMPORARY TABLE migration_014_inbox_handler_identity_preflight;

ALTER TABLE inbox_receipt
  ADD COLUMN handler_id VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER handler_version,
  ADD COLUMN handler_registry_version INT UNSIGNED NOT NULL
    AFTER handler_id,
  ADD COLUMN handler_descriptor_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER handler_registry_version,
  ADD COLUMN handler_source_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER handler_descriptor_digest,
  ADD COLUMN handler_registration_digest CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER handler_source_digest,
  ADD CONSTRAINT chk_inbox_handler_id_supported
    CHECK (handler_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'),
  ADD CONSTRAINT chk_inbox_handler_registry_version_positive
    CHECK (handler_registry_version >= 1),
  ADD CONSTRAINT chk_inbox_handler_descriptor_digest_lower_hex
    CHECK (handler_descriptor_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_inbox_handler_source_digest_lower_hex
    CHECK (handler_source_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_inbox_handler_registration_digest_lower_hex
    CHECK (handler_registration_digest REGEXP '^[0-9a-f]{64}$'),
  ADD KEY idx_inbox_handler_inventory (
    handler_registry_version,
    handler_id,
    handler_descriptor_digest,
    handler_source_digest,
    handler_registration_digest,
    status
  );
