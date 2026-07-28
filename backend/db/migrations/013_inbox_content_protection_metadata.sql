-- Durable Inbox content must be encrypted before any production receipt is
-- accepted. Earlier migrations are still unreleased and require the table to
-- be empty, so this migration fails closed instead of inventing metadata for
-- plaintext or historically ambiguous rows.

DROP TEMPORARY TABLE IF EXISTS migration_013_inbox_content_protection_preflight;

CREATE TEMPORARY TABLE migration_013_inbox_content_protection_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_013_inbox_content_protection_preflight (guard_id) VALUES (1);

INSERT INTO migration_013_inbox_content_protection_preflight (guard_id)
SELECT 1
FROM inbox_receipt
LIMIT 1;

DROP TEMPORARY TABLE migration_013_inbox_content_protection_preflight;

ALTER TABLE inbox_receipt
  ADD COLUMN payload_codec_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER payload_json,
  ADD COLUMN payload_key_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER payload_codec_version,
  ADD COLUMN payload_digest_scheme VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    AFTER payload_key_id,
  ADD COLUMN result_codec_version VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_json,
  ADD COLUMN result_key_id VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_codec_version,
  ADD COLUMN result_digest_scheme VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER result_key_id,
  ADD COLUMN completion_manifest_digest_scheme VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER completion_manifest_digest,
  ADD CONSTRAINT chk_inbox_payload_protection_metadata
    CHECK (
      payload_codec_version = 'A256GCM:v1'
      AND payload_digest_scheme = 'hmac-sha256:v1'
      AND payload_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      AND payload_digest REGEXP '^[0-9a-f]{64}$'
      AND JSON_TYPE(payload_json) = 'OBJECT'
      AND JSON_LENGTH(payload_json) = 10
      AND JSON_CONTAINS_PATH(
        payload_json,
        'all',
        '$.bindingDigest', '$.ciphertext', '$.codecVersion', '$.contentDigest',
        '$.digestScheme', '$.iv', '$.keyId', '$.protection', '$.purpose', '$.tag'
      ) = 1
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.protection')) = 'A256GCM'
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.codecVersion')) = payload_codec_version
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.keyId')) = payload_key_id
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.digestScheme')) = payload_digest_scheme
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.contentDigest')) = payload_digest
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.purpose')) = 'PAYLOAD'
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.bindingDigest')) REGEXP '^[0-9a-f]{64}$'
      AND JSON_TYPE(JSON_EXTRACT(payload_json, '$.ciphertext')) = 'STRING'
      AND JSON_TYPE(JSON_EXTRACT(payload_json, '$.iv')) = 'STRING'
      AND JSON_TYPE(JSON_EXTRACT(payload_json, '$.tag')) = 'STRING'
    ),
  ADD CONSTRAINT chk_inbox_result_protection_metadata
    CHECK (
      (
        status = 'SUCCEEDED'
        AND result_codec_version = 'A256GCM:v1'
        AND result_digest_scheme = 'hmac-sha256:v1'
        AND completion_manifest_digest_scheme = 'hmac-sha256:v1'
        AND result_key_id REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        AND result_digest REGEXP '^[0-9a-f]{64}$'
        AND completion_manifest_digest REGEXP '^[0-9a-f]{64}$'
        AND JSON_TYPE(result_json) = 'OBJECT'
        AND JSON_LENGTH(result_json) = 10
        AND JSON_CONTAINS_PATH(
          result_json,
          'all',
          '$.bindingDigest', '$.ciphertext', '$.codecVersion', '$.contentDigest',
          '$.digestScheme', '$.iv', '$.keyId', '$.protection', '$.purpose', '$.tag'
        ) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.protection')) = 'A256GCM'
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.codecVersion')) = result_codec_version
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.keyId')) = result_key_id
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.digestScheme')) = result_digest_scheme
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.contentDigest')) = result_digest
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.purpose')) = 'RESULT'
        AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.bindingDigest')) REGEXP '^[0-9a-f]{64}$'
        AND JSON_TYPE(JSON_EXTRACT(result_json, '$.ciphertext')) = 'STRING'
        AND JSON_TYPE(JSON_EXTRACT(result_json, '$.iv')) = 'STRING'
        AND JSON_TYPE(JSON_EXTRACT(result_json, '$.tag')) = 'STRING'
      )
      OR
      (
        status <> 'SUCCEEDED'
        AND result_codec_version IS NULL
        AND result_key_id IS NULL
        AND result_digest_scheme IS NULL
        AND completion_manifest_digest_scheme IS NULL
      )
    ),
  ADD KEY idx_inbox_payload_key_inventory (payload_codec_version, payload_key_id, status),
  ADD KEY idx_inbox_result_key_inventory (result_codec_version, result_key_id, status);
