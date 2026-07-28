const crypto = require("node:crypto");

const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { createCommandResultCodec } = require("./commandResultProtection");
const {
  COMMAND_RESULT_PROTECTION_POLICY,
} = require("./commandResultProtectionPolicy");
const { createInboxContentCodec } = require("./inboxContentProtection");
const {
  EXPECTED_CHECK_DIGESTS,
  canonicalCheckClauseDigest,
} = require("./keyInventorySchemaAttestation");

const CONTRACT_VERSION = "KEY_INVENTORY_READINESS:v1";
const ENABLE_FLAG = "ROOT_KEY_INVENTORY_READINESS_ENABLED";
const RETIRED_KEYS_ENV = "ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON";
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EXPECTED_CODEC = COMMAND_RESULT_PROTECTION_POLICY.codecVersion;
const EXPECTED_DIGEST_SCHEME = "hmac-sha256:v1";
const MAX_RETIRED_KEYS_PER_DOMAIN = 32;
const MAX_RETIRED_KEYS_JSON_BYTES = 8 * 1024;
const MAX_INVENTORY_GROUPS_PER_SOURCE = 64;
const MAX_AUTHENTICATED_RECORDS_PER_SOURCE = 1000;
const MAX_INBOX_PAYLOAD_CIPHERTEXT_BASE64_BYTES = 4 * Math.ceil((64 * 1024) / 3);
const MAX_INBOX_PAYLOAD_ENVELOPE_BYTES = 90 * 1024;
const MAX_INBOX_RESULT_CIPHERTEXT_BASE64_BYTES = 4 * Math.ceil((96 * 1024) / 3);
const MAX_INBOX_RESULT_ENVELOPE_BYTES = 144 * 1024;
const TARGET_DATABASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/;
const STATEMENT_DEADLINE_MS = 10_000;

const DOMAIN = Object.freeze({
  REQUEST_DIGEST: "REQUEST_DIGEST",
  COMMAND_RESULT: "COMMAND_RESULT",
  INBOX_CONTENT: "INBOX_CONTENT",
  NOTIFICATION_RECEIPT: "NOTIFICATION_RECEIPT",
});

const SOURCE = Object.freeze({
  REQUEST_DIGEST: "command_idempotency.request_digest",
  TASK_EVENT_REQUEST_DIGEST: "task_event.request_digest",
  WECHAT_UNIONID_PROVENANCE: "wechat_identity.unionid_provenance",
  LEGACY_RECIPIENT_BINDING: "notification_subscription_grant.recipient_binding",
  V1_RECIPIENT_BINDING: "notification_subscription_grant_v1.recipient_binding",
  COMMAND_RESULT: "command_idempotency.result",
  INBOX_PAYLOAD: "inbox_receipt.payload",
  INBOX_RESULT: "inbox_receipt.result",
  NOTIFICATION_SEND_ATTEMPT_RECEIPT: "notification_send_attempt.provider_receipt",
  NOTIFICATION_SEND_TRANSITION_RECEIPT:
    "notification_send_attempt_transition.provider_receipt",
});

const COMMAND_ENVELOPE_LIMIT = Object.freeze({
  fields: COMMAND_RESULT_PROTECTION_POLICY.envelopeFields,
  maximumEnvelopeBytes: COMMAND_RESULT_PROTECTION_POLICY.maximumEnvelopeBytes,
  maximumCiphertextBase64Bytes: COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBase64Characters,
});

const INBOX_PAYLOAD_ENVELOPE_LIMIT = Object.freeze({
  fields: Object.freeze([
    "bindingDigest", "ciphertext", "codecVersion", "contentDigest", "digestScheme",
    "iv", "keyId", "protection", "purpose", "tag",
  ]),
  maximumEnvelopeBytes: MAX_INBOX_PAYLOAD_ENVELOPE_BYTES,
  maximumCiphertextBase64Bytes: MAX_INBOX_PAYLOAD_CIPHERTEXT_BASE64_BYTES,
});

const INBOX_RESULT_ENVELOPE_LIMIT = Object.freeze({
  fields: INBOX_PAYLOAD_ENVELOPE_LIMIT.fields,
  maximumEnvelopeBytes: MAX_INBOX_RESULT_ENVELOPE_BYTES,
  maximumCiphertextBase64Bytes: MAX_INBOX_RESULT_CIPHERTEXT_BASE64_BYTES,
});

const EXPECTED_COLUMNS = Object.freeze([
  Object.freeze(["command_idempotency", "request_digest_scheme", "varchar(64)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["command_idempotency", "request_digest_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["command_idempotency", "result_codec_version", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["command_idempotency", "result_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["task_event", "request_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["task_event", "request_digest_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "payload_codec_version", "varchar(32)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "payload_key_id", "varchar(64)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "payload_digest_scheme", "varchar(32)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "result_codec_version", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "result_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "result_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["inbox_receipt", "completion_manifest_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_trust_status", "varchar(16)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_provenance_source", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_verified_at", "datetime(3)", "YES", null, null]),
  Object.freeze(["wechat_identity", "unionid_provenance_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_provenance_digest", "char(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_provenance_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["wechat_identity", "unionid_provenance_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_binding_status", "varchar(16)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_wechat_identity_id", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_app_code", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_binding_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_binding_digest", "char(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_binding_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant", "recipient_binding_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_binding_status", "varchar(16)", "NO", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_wechat_identity_id", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_app_code", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_binding_canonical_version", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_binding_digest", "char(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_binding_digest_scheme", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_subscription_grant_v1", "recipient_binding_key_id", "varchar(128)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt", "provider_receipt_digest", "char(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt", "provider_receipt_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt", "provider_receipt_digest_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt_transition", "provider_receipt_digest", "char(64)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt_transition", "provider_receipt_digest_scheme", "varchar(32)", "YES", "ascii", "ascii_bin"]),
  Object.freeze(["notification_send_attempt_transition", "provider_receipt_digest_key_id", "varchar(64)", "YES", "ascii", "ascii_bin"]),
]);

const EXPECTED_INDEXES = Object.freeze([
  Object.freeze(["command_idempotency", "idx_command_idempotency_digest_crypto", 1, "request_digest_scheme"]),
  Object.freeze(["command_idempotency", "idx_command_idempotency_digest_crypto", 2, "request_digest_key_id"]),
  Object.freeze(["command_idempotency", "idx_command_idempotency_digest_crypto", 3, "command_idempotency_id"]),
  Object.freeze(["command_idempotency", "idx_command_idempotency_result_crypto", 1, "result_codec_version"]),
  Object.freeze(["command_idempotency", "idx_command_idempotency_result_crypto", 2, "result_key_id"]),
  Object.freeze(["command_idempotency", "idx_command_idempotency_result_crypto", 3, "command_idempotency_id"]),
  Object.freeze(["task_event", "idx_task_event_request_digest_crypto", 1, "request_digest_scheme"]),
  Object.freeze(["task_event", "idx_task_event_request_digest_crypto", 2, "request_digest_key_id"]),
  Object.freeze(["task_event", "idx_task_event_request_digest_crypto", 3, "task_event_id"]),
  Object.freeze(["inbox_receipt", "idx_inbox_payload_key_inventory", 1, "payload_codec_version"]),
  Object.freeze(["inbox_receipt", "idx_inbox_payload_key_inventory", 2, "payload_key_id"]),
  Object.freeze(["inbox_receipt", "idx_inbox_payload_key_inventory", 3, "status"]),
  Object.freeze(["inbox_receipt", "idx_inbox_result_key_inventory", 1, "result_codec_version"]),
  Object.freeze(["inbox_receipt", "idx_inbox_result_key_inventory", 2, "result_key_id"]),
  Object.freeze(["inbox_receipt", "idx_inbox_result_key_inventory", 3, "status"]),
  Object.freeze(["wechat_identity", "idx_wechat_identity_provenance_crypto", 1, "unionid_provenance_digest_scheme"]),
  Object.freeze(["wechat_identity", "idx_wechat_identity_provenance_crypto", 2, "unionid_provenance_key_id"]),
  Object.freeze(["wechat_identity", "idx_wechat_identity_provenance_crypto", 3, "wechat_identity_id"]),
  Object.freeze(["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 1, "recipient_binding_digest_scheme"]),
  Object.freeze(["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 2, "recipient_binding_key_id"]),
  Object.freeze(["notification_subscription_grant", "idx_notification_recipient_binding_crypto", 3, "notification_subscription_grant_id"]),
  Object.freeze(["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 1, "recipient_binding_digest_scheme"]),
  Object.freeze(["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 2, "recipient_binding_key_id"]),
  Object.freeze(["notification_subscription_grant_v1", "idx_notification_recipient_binding_v1_crypto", 3, "notification_subscription_grant_id"]),
]);

// Every statement is fixed in this implementation. Callers can provide a MySQL
// pool, but cannot supply SQL, table names, predicates, or a connection factory.
const SQL = Object.freeze({
  setStatementDeadline: `SET SESSION max_execution_time = ${STATEMENT_DEADLINE_MS}`,
  readStatementDeadline: "SELECT @@SESSION.max_execution_time AS statement_deadline_ms",
  resetStatementDeadline: "SET SESSION max_execution_time = 0",
  transactionIsolation: "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  beginReadOnly: "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  databaseName: "SELECT DATABASE() AS database_name",
  columns: `
SELECT
  TABLE_NAME AS table_name,
  COLUMN_NAME AS column_name,
  COLUMN_TYPE AS column_type,
  IS_NULLABLE AS is_nullable,
  CHARACTER_SET_NAME AS character_set_name,
  COLLATION_NAME AS collation_name
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
	    (TABLE_NAME = 'command_idempotency'
      AND COLUMN_NAME IN (
        'request_digest_scheme', 'request_digest_key_id',
        'result_codec_version', 'result_key_id'
	      ))
	    OR
	    (TABLE_NAME = 'task_event'
	      AND COLUMN_NAME IN ('request_digest_scheme', 'request_digest_key_id'))
	    OR
    (TABLE_NAME = 'inbox_receipt'
      AND COLUMN_NAME IN (
        'payload_codec_version', 'payload_key_id', 'payload_digest_scheme',
        'result_codec_version', 'result_key_id', 'result_digest_scheme',
        'completion_manifest_digest_scheme'
      ))
    OR
    (TABLE_NAME = 'wechat_identity'
      AND COLUMN_NAME IN (
        'unionid_trust_status', 'unionid_provenance_source', 'unionid_verified_at',
        'unionid_provenance_canonical_version', 'unionid_provenance_digest',
        'unionid_provenance_digest_scheme', 'unionid_provenance_key_id'
      ))
    OR
    (TABLE_NAME IN ('notification_subscription_grant', 'notification_subscription_grant_v1')
      AND COLUMN_NAME IN (
        'recipient_binding_status', 'recipient_wechat_identity_id', 'recipient_app_code',
        'recipient_binding_canonical_version', 'recipient_binding_digest',
        'recipient_binding_digest_scheme', 'recipient_binding_key_id'
      ))
    OR
    (TABLE_NAME IN ('notification_send_attempt', 'notification_send_attempt_transition')
      AND COLUMN_NAME IN (
        'provider_receipt_digest', 'provider_receipt_digest_scheme',
        'provider_receipt_digest_key_id'
      ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  indexes: `
SELECT
  TABLE_NAME AS table_name,
  INDEX_NAME AS index_name,
  NON_UNIQUE AS non_unique,
  SEQ_IN_INDEX AS seq_in_index,
  COLUMN_NAME AS column_name
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
	    (TABLE_NAME = 'command_idempotency'
      AND INDEX_NAME IN (
        'idx_command_idempotency_digest_crypto',
        'idx_command_idempotency_result_crypto'
	      ))
	    OR
	    (TABLE_NAME = 'task_event'
	      AND INDEX_NAME = 'idx_task_event_request_digest_crypto')
	    OR
    (TABLE_NAME = 'inbox_receipt'
      AND INDEX_NAME IN (
        'idx_inbox_payload_key_inventory',
        'idx_inbox_result_key_inventory'
      ))
    OR
    (TABLE_NAME = 'wechat_identity'
      AND INDEX_NAME = 'idx_wechat_identity_provenance_crypto')
    OR
    (TABLE_NAME = 'notification_subscription_grant'
      AND INDEX_NAME = 'idx_notification_recipient_binding_crypto')
    OR
    (TABLE_NAME = 'notification_subscription_grant_v1'
      AND INDEX_NAME = 'idx_notification_recipient_binding_v1_crypto')
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  checks: `
SELECT
  tc.CONSTRAINT_NAME AS constraint_name,
  tc.ENFORCED AS enforced,
  cc.CHECK_CLAUSE AS check_clause
FROM information_schema.TABLE_CONSTRAINTS AS tc
JOIN information_schema.CHECK_CONSTRAINTS AS cc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
  AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = DATABASE()
  AND tc.CONSTRAINT_TYPE = 'CHECK'
  AND tc.CONSTRAINT_NAME IN (
    'chk_inbox_payload_protection_metadata',
    'chk_inbox_result_protection_metadata',
    'chk_notification_recipient_binding',
    'chk_notification_recipient_binding_v1',
    'chk_notification_send_attempt_accepted_receipt',
    'chk_notification_send_attempt_receipt_digest',
    'chk_notification_send_attempt_transition_digest',
    'chk_notification_send_attempt_transition_receipt',
    'chk_wechat_identity_unionid_provenance'
  )
ORDER BY tc.CONSTRAINT_NAME`,
  commandResults: `
SELECT
  status,
  IF(result_json IS NULL, 0, 1) AS content_present,
  IF(result_ref IS NULL, 0, 1) AS result_ref_present,
  result_key_id AS key_id,
  result_codec_version AS codec_version,
  CASE
    WHEN result_json IS NULL THEN 1
    ELSE IF((
      JSON_TYPE(result_json) = 'OBJECT'
      AND JSON_LENGTH(result_json) = 6
      AND JSON_CONTAINS_PATH(
        result_json,
        'all',
        '$.bindingDigest', '$.ciphertext', '$.iv', '$.keyId', '$.protection', '$.tag'
      ) = 1
      AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.protection')) = 'A256GCM'
      AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.keyId')) = result_key_id
      AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.bindingDigest')) REGEXP '^[0-9a-f]{64}$'
      AND JSON_TYPE(JSON_EXTRACT(result_json, '$.ciphertext')) = 'STRING'
      AND JSON_STORAGE_SIZE(result_json) <= ${COMMAND_ENVELOPE_LIMIT.maximumEnvelopeBytes}
      AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext'))) <= ${COMMAND_ENVELOPE_LIMIT.maximumCiphertextBase64Bytes}
      AND JSON_TYPE(JSON_EXTRACT(result_json, '$.iv')) = 'STRING'
      AND JSON_TYPE(JSON_EXTRACT(result_json, '$.tag')) = 'STRING'
    ), 1, 0)
  END AS envelope_matches,
  COUNT(*) AS reference_count
FROM command_idempotency
GROUP BY status, content_present, result_ref_present, result_key_id, result_codec_version, envelope_matches
ORDER BY status, content_present, result_ref_present, result_key_id, result_codec_version, envelope_matches
LIMIT 65`,
  requestDigests: `
SELECT
  request_digest_key_id AS key_id,
  request_digest_scheme AS digest_scheme,
  IF(
    request_digest REGEXP '^[0-9a-f]{64}$'
    AND (
      (request_digest_scheme = 'hmac-sha256:v1' AND request_digest_key_id IS NOT NULL)
      OR (request_digest_scheme = 'sha256:v0' AND request_digest_key_id IS NULL)
    ),
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM command_idempotency
GROUP BY request_digest_key_id, request_digest_scheme, metadata_matches
ORDER BY request_digest_key_id, request_digest_scheme, metadata_matches
LIMIT 65`,
  taskEventRequestDigests: `
SELECT
  request_digest_key_id AS key_id,
  request_digest_scheme AS digest_scheme,
  IF(
    request_canonical_version = 'canonical-json:v1'
    AND request_digest REGEXP '^[0-9a-f]{64}$'
    AND request_digest_scheme = 'hmac-sha256:v1'
    AND request_digest_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM task_event
WHERE request_canonical_version IS NOT NULL
   OR request_digest IS NOT NULL
   OR request_digest_scheme IS NOT NULL
   OR request_digest_key_id IS NOT NULL
GROUP BY request_digest_key_id, request_digest_scheme, metadata_matches
ORDER BY request_digest_key_id, request_digest_scheme, metadata_matches
LIMIT 65`,
  wechatIdentityProvenanceDigests: `
SELECT
  unionid_provenance_key_id AS key_id,
  unionid_provenance_digest_scheme AS digest_scheme,
  IF(
    unionid_trust_status = 'VERIFIED'
    AND unionid IS NOT NULL
    AND unionid_status = 'LINKED'
    AND unionid_provenance_source IN ('CLOUDBASE', 'WECHAT_GATEWAY', 'WECHAT_CODE2SESSION')
    AND unionid_verified_at IS NOT NULL
    AND unionid_provenance_canonical_version = 'canonical-json:v1'
    AND unionid_provenance_digest REGEXP '^[0-9a-f]{64}$'
    AND unionid_provenance_digest_scheme = 'hmac-sha256:v1'
    AND unionid_provenance_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM wechat_identity
WHERE unionid_trust_status = 'VERIFIED'
   OR unionid_provenance_source IS NOT NULL
   OR unionid_verified_at IS NOT NULL
   OR unionid_provenance_canonical_version IS NOT NULL
   OR unionid_provenance_digest IS NOT NULL
   OR unionid_provenance_digest_scheme IS NOT NULL
   OR unionid_provenance_key_id IS NOT NULL
GROUP BY unionid_provenance_key_id, unionid_provenance_digest_scheme, metadata_matches
ORDER BY unionid_provenance_key_id, unionid_provenance_digest_scheme, metadata_matches
LIMIT 65`,
  legacyRecipientBindingDigests: `
SELECT
  recipient_binding_key_id AS key_id,
  recipient_binding_digest_scheme AS digest_scheme,
  IF(
    recipient_binding_status = 'VERIFIED'
    AND recipient_wechat_identity_id IS NOT NULL
    AND recipient_app_code = 'MYROOT'
    AND recipient_binding_canonical_version = 'canonical-json:v1'
    AND recipient_binding_digest REGEXP '^[0-9a-f]{64}$'
    AND recipient_binding_digest_scheme = 'hmac-sha256:v1'
    AND recipient_binding_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM notification_subscription_grant
WHERE recipient_binding_status = 'VERIFIED'
   OR recipient_wechat_identity_id IS NOT NULL
   OR recipient_app_code IS NOT NULL
   OR recipient_binding_canonical_version IS NOT NULL
   OR recipient_binding_digest IS NOT NULL
   OR recipient_binding_digest_scheme IS NOT NULL
   OR recipient_binding_key_id IS NOT NULL
GROUP BY recipient_binding_key_id, recipient_binding_digest_scheme, metadata_matches
ORDER BY recipient_binding_key_id, recipient_binding_digest_scheme, metadata_matches
LIMIT 65`,
  v1RecipientBindingDigests: `
SELECT
  recipient_binding_key_id AS key_id,
  recipient_binding_digest_scheme AS digest_scheme,
  IF(
    recipient_binding_status = 'VERIFIED'
    AND recipient_wechat_identity_id IS NOT NULL
    AND recipient_app_code = 'MYROOT'
    AND recipient_binding_canonical_version = 'canonical-json:v1'
    AND recipient_binding_digest REGEXP '^[0-9a-f]{64}$'
    AND recipient_binding_digest_scheme = 'hmac-sha256:v1'
    AND recipient_binding_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM notification_subscription_grant_v1
WHERE recipient_binding_status = 'VERIFIED'
   OR recipient_wechat_identity_id IS NOT NULL
   OR recipient_app_code IS NOT NULL
   OR recipient_binding_canonical_version IS NOT NULL
   OR recipient_binding_digest IS NOT NULL
   OR recipient_binding_digest_scheme IS NOT NULL
   OR recipient_binding_key_id IS NOT NULL
GROUP BY recipient_binding_key_id, recipient_binding_digest_scheme, metadata_matches
ORDER BY recipient_binding_key_id, recipient_binding_digest_scheme, metadata_matches
LIMIT 65`,
  notificationAttemptReceiptDigests: `
SELECT
  provider_receipt_digest_key_id AS key_id,
  provider_receipt_digest_scheme AS digest_scheme,
  IF(
    status = 'ACCEPTED'
    AND provider_receipt_digest REGEXP '^[0-9a-f]{64}$'
    AND provider_receipt_digest_scheme = 'hmac-sha256:v1'
    AND provider_receipt_digest_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM notification_send_attempt
WHERE status = 'ACCEPTED'
   OR provider_receipt_digest IS NOT NULL
   OR provider_receipt_digest_scheme IS NOT NULL
   OR provider_receipt_digest_key_id IS NOT NULL
GROUP BY provider_receipt_digest_key_id, provider_receipt_digest_scheme, metadata_matches
ORDER BY provider_receipt_digest_key_id, provider_receipt_digest_scheme, metadata_matches
LIMIT 65`,
  notificationTransitionReceiptDigests: `
SELECT
  provider_receipt_digest_key_id AS key_id,
  provider_receipt_digest_scheme AS digest_scheme,
  IF(
    to_status = 'ACCEPTED'
    AND provider_receipt_digest REGEXP '^[0-9a-f]{64}$'
    AND provider_receipt_digest_scheme = 'hmac-sha256:v1'
    AND provider_receipt_digest_key_id IS NOT NULL,
    1,
    0
  ) AS metadata_matches,
  COUNT(*) AS reference_count
FROM notification_send_attempt_transition
WHERE to_status = 'ACCEPTED'
   OR provider_receipt_digest IS NOT NULL
   OR provider_receipt_digest_scheme IS NOT NULL
   OR provider_receipt_digest_key_id IS NOT NULL
GROUP BY provider_receipt_digest_key_id, provider_receipt_digest_scheme, metadata_matches
ORDER BY provider_receipt_digest_key_id, provider_receipt_digest_scheme, metadata_matches
LIMIT 65`,
  inboxPayloads: `
SELECT
  status,
  payload_key_id AS key_id,
  payload_codec_version AS codec_version,
  payload_digest_scheme AS digest_scheme,
  IF((
    JSON_TYPE(payload_json) = 'OBJECT'
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
    AND JSON_STORAGE_SIZE(payload_json) <= 92160
    AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.ciphertext'))) <= 87384
    AND JSON_TYPE(JSON_EXTRACT(payload_json, '$.iv')) = 'STRING'
    AND JSON_TYPE(JSON_EXTRACT(payload_json, '$.tag')) = 'STRING'
  ), 1, 0) AS envelope_matches,
  COUNT(*) AS reference_count
FROM inbox_receipt
GROUP BY status, payload_key_id, payload_codec_version, payload_digest_scheme, envelope_matches
ORDER BY status, payload_key_id, payload_codec_version, payload_digest_scheme, envelope_matches
LIMIT 65`,
  inboxResults: `
SELECT
  status,
  IF(result_json IS NULL, 0, 1) AS content_present,
  IF(result_digest IS NULL, 0, 1) AS result_digest_present,
  IF(completion_manifest_digest IS NULL, 0, 1) AS completion_manifest_digest_present,
  result_key_id AS key_id,
  result_codec_version AS codec_version,
  result_digest_scheme AS digest_scheme,
  completion_manifest_digest_scheme,
  CASE
    WHEN result_json IS NULL THEN 1
    ELSE IF((
      JSON_TYPE(result_json) = 'OBJECT'
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
      AND JSON_STORAGE_SIZE(result_json) <= 147456
      AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext'))) <= 131072
      AND JSON_TYPE(JSON_EXTRACT(result_json, '$.iv')) = 'STRING'
      AND JSON_TYPE(JSON_EXTRACT(result_json, '$.tag')) = 'STRING'
    ), 1, 0)
  END AS envelope_matches,
  COUNT(*) AS reference_count
FROM inbox_receipt
GROUP BY status, content_present, result_digest_present, completion_manifest_digest_present,
  result_key_id, result_codec_version,
  result_digest_scheme, completion_manifest_digest_scheme, envelope_matches
ORDER BY status, content_present, result_digest_present, completion_manifest_digest_present,
  result_key_id, result_codec_version,
  result_digest_scheme, completion_manifest_digest_scheme, envelope_matches
LIMIT 65`,
  commandWitnesses: `
SELECT
  command_idempotency_id,
  command_name,
  actor_id,
  idempotency_key,
  request_digest,
  result_json,
  JSON_STORAGE_SIZE(result_json) AS result_json_storage_bytes,
  OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext')))
    AS result_ciphertext_base64_bytes,
  result_codec_version,
  result_key_id
FROM command_idempotency
WHERE result_json IS NOT NULL
  AND JSON_STORAGE_SIZE(result_json) <= ${COMMAND_ENVELOPE_LIMIT.maximumEnvelopeBytes}
  AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext'))) <= ${COMMAND_ENVELOPE_LIMIT.maximumCiphertextBase64Bytes}
ORDER BY command_idempotency_id
LIMIT 1001`,
  inboxPayloadWitnesses: `
SELECT
    inbox_receipt_id,
    consumer_name,
    source_name,
    partition_key,
    partition_position,
    event_id,
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    LEFT(DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS occurred_at,
    producer_version,
    correlation_id,
    causation_id,
    idempotency_key,
    handler_version,
    handler_id,
    handler_registry_version,
    handler_descriptor_digest,
    handler_source_digest,
    handler_registration_digest,
    payload_json,
    JSON_STORAGE_SIZE(payload_json) AS payload_json_storage_bytes,
    OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.ciphertext')))
      AS payload_ciphertext_base64_bytes,
    payload_codec_version,
    payload_key_id,
    payload_digest_scheme,
    payload_digest
FROM inbox_receipt
WHERE JSON_STORAGE_SIZE(payload_json) <= 92160
  AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.ciphertext'))) <= 87384
ORDER BY inbox_receipt_id
LIMIT 1001`,
  inboxResultWitnesses: `
SELECT
    inbox_receipt_id,
    consumer_name,
    source_name,
    partition_key,
    partition_position,
    event_id,
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    LEFT(DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s.%f'), 23) AS occurred_at,
    producer_version,
    correlation_id,
    causation_id,
    idempotency_key,
    handler_version,
    handler_id,
    handler_registry_version,
    handler_descriptor_digest,
    handler_source_digest,
    handler_registration_digest,
    lease_generation,
    inbox_transition_id,
    result_json,
    JSON_STORAGE_SIZE(result_json) AS result_json_storage_bytes,
    OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext')))
      AS result_ciphertext_base64_bytes,
    result_codec_version,
    result_key_id,
    result_digest_scheme,
    result_digest,
    completion_manifest_digest,
    completion_manifest_digest_scheme
FROM inbox_receipt
WHERE result_json IS NOT NULL
  AND JSON_STORAGE_SIZE(result_json) <= 147456
  AND OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.ciphertext'))) <= 131072
ORDER BY inbox_receipt_id
LIMIT 1001`,
});

function readinessError(code, status = 503) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataRecord(value) {
  if (!plainRecord(value)) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => Object.prototype.hasOwnProperty.call(descriptor, "value")
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function issue(code, severity = "BLOCKER") {
  return Object.freeze({ code, severity });
}

function disabledReport() {
  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    enabled: false,
    ready: false,
    status: "KEY_INVENTORY_DISABLED",
    configuration: [],
    schema: { ready: false, status: "NOT_INSPECTED" },
    inventory: [],
    previousKeyRetirement: { ready: false, status: "NOT_INSPECTED", referenceCount: 0 },
    issues: [issue("KEY_INVENTORY_DISABLED")],
  });
}

function blockedReport(code, options = {}) {
  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    enabled: true,
    ready: false,
    status: code,
    configuration: options.configuration || [],
    schema: options.schema || { ready: false, status: "NOT_INSPECTED" },
    inventory: options.inventory || [],
    previousKeyRetirement: options.previousKeyRetirement
      || { ready: false, status: "NOT_INSPECTED", referenceCount: 0 },
    issues: options.issues || [issue(code)],
  });
}

function readEnableFlag(env) {
  const value = Object.prototype.hasOwnProperty.call(env, ENABLE_FLAG)
    ? env[ENABLE_FLAG]
    : undefined;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
}

function parsePreviousKeyIds(env, environmentName) {
  const raw = Object.prototype.hasOwnProperty.call(env, environmentName)
    ? env[environmentName]
    : undefined;
  if (raw === undefined) return [];
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 16 * 1024) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID"); }
  if (!ownDataRecord(parsed)) throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  const keyIds = Object.keys(parsed);
  if (keyIds.length > 8 || keyIds.some((keyId) => !KEY_ID_PATTERN.test(keyId))) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  return keyIds.sort();
}

function parseRetiredKeyIds(env) {
  const raw = Object.prototype.hasOwnProperty.call(env, RETIRED_KEYS_ENV)
    ? env[RETIRED_KEYS_ENV]
    : undefined;
  if (raw === undefined) {
    return {
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    };
  }
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_RETIRED_KEYS_JSON_BYTES) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID"); }
  if (!ownDataRecord(parsed)
    || Object.keys(parsed).sort().join(",")
      !== "COMMAND_RESULT,INBOX_CONTENT,NOTIFICATION_RECEIPT,REQUEST_DIGEST") {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  const output = {};
  for (const domain of Object.values(DOMAIN)) {
    const values = parsed[domain];
    if (!Array.isArray(values)
      || values.length > MAX_RETIRED_KEYS_PER_DOMAIN
      || values.some((value) => typeof value !== "string" || !KEY_ID_PATTERN.test(value))
      || new Set(values).size !== values.length) {
      throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
    }
    output[domain] = [...values].sort();
  }
  return output;
}

function targetDatabaseFromEnv(env) {
  const target = Object.prototype.hasOwnProperty.call(env, "MYSQL_DATABASE")
    ? env.MYSQL_DATABASE
    : undefined;
  if (typeof target !== "string" || !TARGET_DATABASE_PATTERN.test(target)) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  return target;
}

function resolveConfiguration(env) {
  const targetDatabase = targetDatabaseFromEnv(env);
  const requestCodec = createCommandRequestDigestCodec(env);
  const commandCodec = createCommandResultCodec(env);
  const inboxCodec = createInboxContentCodec(env);
  const requestStatus = requestCodec.getStatus();
  const commandStatus = commandCodec.getStatus();
  const inboxStatus = inboxCodec.getStatus();
  if (!requestStatus.ready
    || requestStatus.digestVersion !== EXPECTED_DIGEST_SCHEME
    || !commandStatus.ready
    || !commandStatus.enabled
    || !inboxStatus.ready
    || !inboxStatus.enabled) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  const requestCurrent = env.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID;
  const commandCurrent = env.ROOT_COMMAND_RESULT_KEY_ID;
  const inboxCurrent = env.ROOT_INBOX_CONTENT_KEY_ID;
  const notificationReceiptCurrent = env.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID;
  if (!KEY_ID_PATTERN.test(requestCurrent || "")
    || requestStatus.keyId !== requestCurrent
    || !KEY_ID_PATTERN.test(commandCurrent || "")
    || !KEY_ID_PATTERN.test(inboxCurrent || "")
    || !KEY_ID_PATTERN.test(notificationReceiptCurrent || "")) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  const previousRequest = parsePreviousKeyIds(
    env,
    "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON"
  );
  const previousCommand = parsePreviousKeyIds(
    env,
    "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON"
  );
  const previousInbox = parsePreviousKeyIds(env, "ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON");
  const retired = parseRetiredKeyIds(env);
  if (retired.REQUEST_DIGEST.includes(requestCurrent)
    || previousRequest.some((keyId) => retired.REQUEST_DIGEST.includes(keyId))
    || retired.COMMAND_RESULT.includes(commandCurrent)
    || previousCommand.some((keyId) => retired.COMMAND_RESULT.includes(keyId))
    || retired.INBOX_CONTENT.includes(inboxCurrent)
    || previousInbox.some((keyId) => retired.INBOX_CONTENT.includes(keyId))
    || retired.NOTIFICATION_RECEIPT.includes(notificationReceiptCurrent)) {
    throw readinessError("KEY_INVENTORY_CONFIGURATION_INVALID");
  }
  const publicConfiguration = deepFreeze([
    {
      domain: DOMAIN.REQUEST_DIGEST,
      currentKeyId: requestCurrent,
      previousKeyIds: previousRequest,
      retiredKeyIds: retired.REQUEST_DIGEST,
    },
    {
      domain: DOMAIN.COMMAND_RESULT,
      currentKeyId: commandCurrent,
      previousKeyIds: previousCommand,
      retiredKeyIds: retired.COMMAND_RESULT,
    },
    {
      domain: DOMAIN.INBOX_CONTENT,
      currentKeyId: inboxCurrent,
      previousKeyIds: previousInbox,
      retiredKeyIds: retired.INBOX_CONTENT,
    },
    {
      domain: DOMAIN.NOTIFICATION_RECEIPT,
      currentKeyId: notificationReceiptCurrent,
      previousKeyIds: [],
      retiredKeyIds: retired.NOTIFICATION_RECEIPT,
    },
  ]);
  return Object.freeze({
    targetDatabase,
    publicConfiguration,
    commandCodec,
    inboxCodec,
  });
}

function exactText(value) {
  return typeof value === "string" ? value : "";
}

function exactInteger(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function expectedColumnKey(tableName, columnName) {
  return `${tableName}\u0000${columnName}`;
}

function schemaMatches(columnRows, indexRows, checkRows) {
  if (!Array.isArray(columnRows) || !Array.isArray(indexRows) || !Array.isArray(checkRows)) {
    return false;
  }
  const columns = new Map();
  for (const row of columnRows) {
    if (!ownDataRecord(row)) return false;
    const key = expectedColumnKey(row.table_name, row.column_name);
    if (columns.has(key)) return false;
    columns.set(key, row);
  }
  if (columns.size !== EXPECTED_COLUMNS.length) return false;
  for (const [tableName, columnName, columnType, nullable, characterSet, collation] of EXPECTED_COLUMNS) {
    const row = columns.get(expectedColumnKey(tableName, columnName));
    if (!row
      || exactText(row.column_type).toLowerCase() !== columnType
      || row.is_nullable !== nullable
      || row.character_set_name !== characterSet
      || row.collation_name !== collation) return false;
  }
  const indexes = new Map();
  for (const row of indexRows) {
    if (!ownDataRecord(row)) return false;
    const sequence = exactInteger(row.seq_in_index);
    const key = `${row.table_name}\u0000${row.index_name}\u0000${sequence}`;
    if (sequence === null || indexes.has(key)) return false;
    indexes.set(key, row);
  }
  if (indexes.size !== EXPECTED_INDEXES.length) return false;
  for (const [tableName, indexName, sequence, columnName] of EXPECTED_INDEXES) {
    const row = indexes.get(`${tableName}\u0000${indexName}\u0000${sequence}`);
    if (!row || exactInteger(row.non_unique) !== 1 || row.column_name !== columnName) return false;
  }
  const checks = new Map();
  for (const row of checkRows) {
    if (!ownDataRecord(row)
      || typeof row.constraint_name !== "string"
      || checks.has(row.constraint_name)) return false;
    checks.set(row.constraint_name, row);
  }
  if (checks.size !== Object.keys(EXPECTED_CHECK_DIGESTS).length) return false;
  for (const [constraintName, expectedDigest] of Object.entries(EXPECTED_CHECK_DIGESTS)) {
    const row = checks.get(constraintName);
    if (!row
      || row.enforced !== "YES"
      || canonicalCheckClauseDigest(row.check_clause) !== expectedDigest) return false;
  }
  return true;
}

async function executeRows(connection, sql) {
  const result = await connection.execute(sql);
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  return result[0];
}

function validConnection(connection) {
  return connection
    && typeof connection.query === "function"
    && typeof connection.execute === "function"
    && typeof connection.release === "function"
    && typeof connection.destroy === "function";
}

async function setAndVerifyStatementDeadline(connection, sql, expectedMilliseconds) {
  await connection.query(sql);
  const result = await connection.query(SQL.readStatementDeadline);
  if (!Array.isArray(result)
    || !Array.isArray(result[0])
    || result[0].length !== 1
    || !ownDataRecord(result[0][0])
    || exactInteger(result[0][0].statement_deadline_ms) !== expectedMilliseconds) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
}

async function withReadOnlySnapshot(mysqlPool, callback) {
  if (!mysqlPool || typeof mysqlPool.getConnection !== "function") {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  let connection;
  let transactionStarted = false;
  let committed = false;
  try {
    connection = await mysqlPool.getConnection();
    if (!validConnection(connection)) throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    await setAndVerifyStatementDeadline(
      connection,
      SQL.setStatementDeadline,
      STATEMENT_DEADLINE_MS
    );
    await connection.query(SQL.transactionIsolation);
    await connection.query(SQL.beginReadOnly);
    transactionStarted = true;
    const value = await callback(connection);
    await connection.query(SQL.commit);
    committed = true;
    await setAndVerifyStatementDeadline(connection, SQL.resetStatementDeadline, 0);
    connection.release();
    return value;
  } catch {
    if (connection && transactionStarted && !committed) {
      try { await connection.query(SQL.rollback); } catch { /* stable failure below */ }
    }
    if (connection && typeof connection.destroy === "function") {
      try { connection.destroy(); } catch { /* stable failure below */ }
    }
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function policyFor(configuration, domain) {
  return configuration.find((entry) => entry.domain === domain);
}

function inventoryEntryForFact(row, descriptor, configuration, metadataValid) {
  const policy = policyFor(configuration, descriptor.domain);
  const referenceCount = exactInteger(row.reference_count);
  if (referenceCount === null || referenceCount < 1) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  const rawKeyId = row.key_id;
  const validKeyId = typeof rawKeyId === "string" && KEY_ID_PATTERN.test(rawKeyId);
  const missing = rawKeyId === null || rawKeyId === "";
  let classification;
  if (missing) classification = "MISSING";
  else if (validKeyId && rawKeyId === policy.currentKeyId) classification = "CURRENT";
  else if (validKeyId && policy.previousKeyIds.includes(rawKeyId)) classification = "PREVIOUS";
  else if (validKeyId && policy.retiredKeyIds.includes(rawKeyId)) classification = "RETIRED";
  else classification = "UNKNOWN";
  let metadataStatus = "VALID";
  if (missing || row.codec_version === null || row.codec_version === "") metadataStatus = "MISSING";
  else if (row.codec_version !== EXPECTED_CODEC || !metadataValid) metadataStatus = "DRIFTED";
  const trustedKeyId = classification === "CURRENT"
    || classification === "PREVIOUS"
    || classification === "RETIRED";
  return {
    source: descriptor.source,
    domain: descriptor.domain,
    purpose: descriptor.purpose,
    keyId: trustedKeyId ? rawKeyId : null,
    keyIdFingerprint: missing || trustedKeyId ? null : fingerprint(rawKeyId),
    classification,
    codecVersion: row.codec_version === null || row.codec_version === ""
      ? null
      : row.codec_version === EXPECTED_CODEC ? EXPECTED_CODEC : "UNSUPPORTED",
    metadataStatus,
    referenceCount,
  };
}

function normalizeInventoryRows(rows, descriptor, configuration) {
  if (!Array.isArray(rows) || rows.length > MAX_INVENTORY_GROUPS_PER_SOURCE) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  const inventory = [];
  let invariantDrift = false;
  for (const row of rows) {
    if (!ownDataRecord(row)) throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    const referenceCount = exactInteger(row.reference_count);
    const envelopeMatches = exactInteger(row.envelope_matches);
    if (referenceCount === null || referenceCount < 1
      || (envelopeMatches !== 0 && envelopeMatches !== 1)) {
      throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    }

    let contentPresent = 1;
    let statusSupported = true;
    let shapeValid = true;
    let metadataValid = envelopeMatches === 1;
    if (descriptor.source === SOURCE.COMMAND_RESULT) {
      contentPresent = exactInteger(row.content_present);
      const resultRefPresent = exactInteger(row.result_ref_present);
      if ((contentPresent !== 0 && contentPresent !== 1)
        || (resultRefPresent !== 0 && resultRefPresent !== 1)) {
        throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
      }
      statusSupported = ["IN_PROGRESS", "SUCCEEDED", "FAILED"].includes(row.status);
      shapeValid = row.status === "SUCCEEDED"
        ? contentPresent === 1
          && resultRefPresent === 0
          && row.key_id !== null
          && row.codec_version !== null
        : contentPresent === 0
          && resultRefPresent === 0
          && row.key_id === null
          && row.codec_version === null;
    } else if (descriptor.source === SOURCE.INBOX_PAYLOAD) {
      statusSupported = [
        "RECEIVED", "CLAIMED", "RETRY_PENDING", "SUCCEEDED", "DEAD_LETTER", "REVIEW_REQUIRED",
      ].includes(row.status);
      metadataValid = metadataValid && row.digest_scheme === EXPECTED_DIGEST_SCHEME;
    } else {
      contentPresent = exactInteger(row.content_present);
      const resultDigestPresent = exactInteger(row.result_digest_present);
      const manifestDigestPresent = exactInteger(row.completion_manifest_digest_present);
      if ((contentPresent !== 0 && contentPresent !== 1)
        || (resultDigestPresent !== 0 && resultDigestPresent !== 1)
        || (manifestDigestPresent !== 0 && manifestDigestPresent !== 1)) {
        throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
      }
      statusSupported = [
        "RECEIVED", "CLAIMED", "RETRY_PENDING", "SUCCEEDED", "DEAD_LETTER", "REVIEW_REQUIRED",
      ].includes(row.status);
      shapeValid = row.status === "SUCCEEDED"
        ? contentPresent === 1
          && resultDigestPresent === 1
          && manifestDigestPresent === 1
          && row.key_id !== null
          && row.codec_version !== null
          && row.digest_scheme !== null
          && row.completion_manifest_digest_scheme !== null
        : contentPresent === 0
          && resultDigestPresent === 0
          && manifestDigestPresent === 0
          && row.key_id === null
          && row.codec_version === null
          && row.digest_scheme === null
          && row.completion_manifest_digest_scheme === null;
      metadataValid = metadataValid
        && row.digest_scheme === EXPECTED_DIGEST_SCHEME
        && row.completion_manifest_digest_scheme === EXPECTED_DIGEST_SCHEME;
    }
    if (!statusSupported || !shapeValid || !metadataValid) invariantDrift = true;

    const hasReference = descriptor.source === SOURCE.INBOX_PAYLOAD
      || contentPresent === 1
      || row.key_id !== null
      || row.codec_version !== null;
    if (hasReference) {
      inventory.push(inventoryEntryForFact(
        row,
        descriptor,
        configuration,
        metadataValid && statusSupported && shapeValid
      ));
    }
  }
  return { inventory, invariantDrift };
}

function normalizeRequestDigestRows(rows, configuration, source = SOURCE.REQUEST_DIGEST) {
  if (!Array.isArray(rows) || rows.length > MAX_INVENTORY_GROUPS_PER_SOURCE) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  const policy = policyFor(configuration, DOMAIN.REQUEST_DIGEST);
  const inventory = [];
  let invariantDrift = false;
  for (const row of rows) {
    if (!ownDataRecord(row)) throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    const referenceCount = exactInteger(row.reference_count);
    const metadataMatches = exactInteger(row.metadata_matches);
    if (referenceCount === null || referenceCount < 1
      || (metadataMatches !== 0 && metadataMatches !== 1)) {
      throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    }
    const digestScheme = row.digest_scheme;
    const rawKeyId = row.key_id;
    if (digestScheme === "sha256:v0") {
      const metadataValid = metadataMatches === 1 && rawKeyId === null;
      if (!metadataValid) invariantDrift = true;
      inventory.push({
        source,
        domain: DOMAIN.REQUEST_DIGEST,
        purpose: "REQUEST_DIGEST",
        keyId: null,
        keyIdFingerprint: null,
        classification: "LEGACY",
        codecVersion: null,
        digestScheme: "sha256:v0",
        metadataStatus: metadataValid ? "VALID" : "DRIFTED",
        referenceCount,
      });
      continue;
    }
    const validKeyId = typeof rawKeyId === "string" && KEY_ID_PATTERN.test(rawKeyId);
    const missing = rawKeyId === null || rawKeyId === "";
    let classification;
    if (missing) classification = "MISSING";
    else if (validKeyId && rawKeyId === policy.currentKeyId) classification = "CURRENT";
    else if (validKeyId && policy.previousKeyIds.includes(rawKeyId)) classification = "PREVIOUS";
    else if (validKeyId && policy.retiredKeyIds.includes(rawKeyId)) classification = "RETIRED";
    else classification = "UNKNOWN";
    const metadataValid = digestScheme === EXPECTED_DIGEST_SCHEME && metadataMatches === 1;
    if (!metadataValid) invariantDrift = true;
    const trustedKeyId = ["CURRENT", "PREVIOUS", "RETIRED"].includes(classification);
    inventory.push({
      source,
      domain: DOMAIN.REQUEST_DIGEST,
      purpose: "REQUEST_DIGEST",
      keyId: trustedKeyId ? rawKeyId : null,
      keyIdFingerprint: missing || trustedKeyId ? null : fingerprint(rawKeyId),
      classification,
      codecVersion: null,
      digestScheme: digestScheme === EXPECTED_DIGEST_SCHEME ? EXPECTED_DIGEST_SCHEME : "UNSUPPORTED",
      metadataStatus: missing ? "MISSING" : metadataValid ? "VALID" : "DRIFTED",
      referenceCount,
    });
  }
  return { inventory, invariantDrift };
}

function normalizeKeyedDigestRows(rows, descriptor, configuration) {
  if (!Array.isArray(rows) || rows.length > MAX_INVENTORY_GROUPS_PER_SOURCE) {
    throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
  }
  const policy = policyFor(configuration, descriptor.domain);
  const inventory = [];
  let invariantDrift = false;
  for (const row of rows) {
    if (!ownDataRecord(row)) throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    const referenceCount = exactInteger(row.reference_count);
    const metadataMatches = exactInteger(row.metadata_matches);
    if (referenceCount === null || referenceCount < 1
      || (metadataMatches !== 0 && metadataMatches !== 1)) {
      throw readinessError("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE");
    }
    const rawKeyId = row.key_id;
    const missing = rawKeyId === null || rawKeyId === "";
    const validKeyId = typeof rawKeyId === "string" && KEY_ID_PATTERN.test(rawKeyId);
    let classification;
    if (missing) classification = "MISSING";
    else if (validKeyId && rawKeyId === policy.currentKeyId) classification = "CURRENT";
    else if (validKeyId && policy.previousKeyIds.includes(rawKeyId)) classification = "PREVIOUS";
    else if (validKeyId && policy.retiredKeyIds.includes(rawKeyId)) classification = "RETIRED";
    else classification = "UNKNOWN";
    const metadataValid = row.digest_scheme === EXPECTED_DIGEST_SCHEME
      && metadataMatches === 1;
    if (!metadataValid) invariantDrift = true;
    const trustedKeyId = ["CURRENT", "PREVIOUS", "RETIRED"].includes(classification);
    const entry = {
      source: descriptor.source,
      domain: descriptor.domain,
      purpose: descriptor.purpose,
      keyId: trustedKeyId ? rawKeyId : null,
      keyIdFingerprint: missing || trustedKeyId ? null : fingerprint(rawKeyId),
      classification,
      codecVersion: null,
      digestScheme: row.digest_scheme === EXPECTED_DIGEST_SCHEME
        ? EXPECTED_DIGEST_SCHEME
        : "UNSUPPORTED",
      metadataStatus: missing ? "MISSING" : metadataValid ? "VALID" : "DRIFTED",
      referenceCount,
    };
    if (descriptor.domain === DOMAIN.NOTIFICATION_RECEIPT) {
      entry.authenticationStatus = "NOT_AVAILABLE_NO_RAW_RECEIPT";
    }
    inventory.push(entry);
  }
  return { inventory, invariantDrift };
}

function consolidateInventory(entries) {
  const consolidated = new Map();
  for (const entry of entries) {
    const identity = JSON.stringify([
      entry.source,
      entry.domain,
      entry.purpose,
      entry.keyId,
      entry.keyIdFingerprint,
      entry.classification,
      entry.codecVersion,
      entry.digestScheme,
      entry.metadataStatus,
      entry.authenticationStatus,
    ]);
    const current = consolidated.get(identity);
    if (current) current.referenceCount += entry.referenceCount;
    else consolidated.set(identity, { ...entry });
  }
  return [...consolidated.values()]
    .sort((left, right) => {
      const leftKey = `${left.source}\u0000${left.keyId || left.keyIdFingerprint || ""}\u0000${left.codecVersion || ""}`;
      const rightKey = `${right.source}\u0000${right.keyId || right.keyIdFingerprint || ""}\u0000${right.codecVersion || ""}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .map((entry) => Object.freeze(entry));
}

function reportForInventory(configuration, inventory, invariantDrift = false) {
  const classifications = new Set(inventory.map((entry) => entry.classification));
  let status;
  if (classifications.has("MISSING")) status = "KEY_INVENTORY_MISSING_KEY";
  else if (classifications.has("RETIRED")) status = "KEY_INVENTORY_RETIRED_KEY_REFERENCED";
  else if (classifications.has("UNKNOWN")) status = "KEY_INVENTORY_UNKNOWN_KEY";
  else if (invariantDrift || inventory.some((entry) => entry.metadataStatus !== "VALID")) {
    status = "KEY_INVENTORY_METADATA_DRIFT";
  }
  else if (classifications.has("PREVIOUS")) status = "KEY_INVENTORY_READY_WITH_PREVIOUS";
  else if (classifications.has("LEGACY")) status = "KEY_INVENTORY_READY_WITH_LEGACY";
  else status = "KEY_INVENTORY_READY";
  const ready = [
    "KEY_INVENTORY_READY",
    "KEY_INVENTORY_READY_WITH_PREVIOUS",
    "KEY_INVENTORY_READY_WITH_LEGACY",
  ].includes(status);
  const issues = [];
  if (!ready) issues.push(issue(status));
  if (ready && status === "KEY_INVENTORY_READY_WITH_PREVIOUS") {
    issues.push(issue("KEY_INVENTORY_PREVIOUS_KEY_REFERENCES_PRESENT", "WARNING"));
  }
  if (ready && classifications.has("LEGACY")) {
    issues.push(issue("KEY_INVENTORY_LEGACY_REQUEST_DIGEST_REFERENCES_PRESENT", "WARNING"));
  }
  if (inventory.some((entry) => entry.domain === DOMAIN.NOTIFICATION_RECEIPT)) {
    issues.push(issue("KEY_INVENTORY_NOTIFICATION_RECEIPT_METADATA_ONLY", "WARNING"));
  }
  const previousReferenceCount = inventory
    .filter((entry) => entry.classification === "PREVIOUS")
    .reduce((total, entry) => total + entry.referenceCount, 0);
  const unsafeRetirementReferenceCount = inventory
    .filter((entry) => ["MISSING", "RETIRED", "UNKNOWN"].includes(entry.classification))
    .reduce((total, entry) => total + entry.referenceCount, 0);
  const retirementReferenceCount = previousReferenceCount + unsafeRetirementReferenceCount;
  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    enabled: true,
    ready,
    status,
    configuration,
    schema: { ready: true, status: "KEY_INVENTORY_SCHEMA_READY" },
    inventory,
    previousKeyRetirement: {
      ready: retirementReferenceCount === 0,
      status: unsafeRetirementReferenceCount > 0
        ? "KEY_RETIREMENT_BLOCKED_UNSAFE_REFERENCES"
        : previousReferenceCount > 0
          ? "KEY_RETIREMENT_BLOCKED_PREVIOUS_REFERENCES"
          : "KEY_RETIREMENT_REFERENCE_FREE",
      referenceCount: retirementReferenceCount,
    },
    issues,
  });
}

function parseEnvelopeColumn(value, limit) {
  let parsed = value;
  if (Buffer.isBuffer(parsed)) {
    if (parsed.length < 2 || parsed.length > limit.maximumEnvelopeBytes) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    parsed = parsed.toString("utf8");
  }
  if (typeof parsed === "string") {
    if (!parsed || Buffer.byteLength(parsed, "utf8") > limit.maximumEnvelopeBytes) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    try { parsed = JSON.parse(parsed); } catch {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
  }
  if (!ownDataRecord(parsed)) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const fields = Object.keys(parsed).sort();
  if (fields.length !== limit.fields.length
    || fields.some((field, index) => field !== limit.fields[index])) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  let semanticBytes = 2;
  for (const field of fields) {
    const fieldValue = parsed[field];
    if (typeof fieldValue !== "string") {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    const fieldBytes = Buffer.byteLength(fieldValue, "utf8");
    semanticBytes += Buffer.byteLength(field, "utf8") + fieldBytes + 6;
    if (semanticBytes > limit.maximumEnvelopeBytes) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
  }
  const ciphertextBytes = Buffer.byteLength(parsed.ciphertext, "utf8");
  if (ciphertextBytes < 1 || ciphertextBytes > limit.maximumCiphertextBase64Bytes) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const exactByteLengths = [
    ["bindingDigest", 64],
    ["iv", 16],
    ["tag", 24],
  ];
  if (Object.prototype.hasOwnProperty.call(parsed, "contentDigest")) {
    exactByteLengths.push(["contentDigest", 64]);
  }
  if (exactByteLengths.some(
    ([field, expected]) => Buffer.byteLength(parsed[field], "utf8") !== expected
  )
    || Buffer.byteLength(parsed.keyId, "utf8") < 1
    || Buffer.byteLength(parsed.keyId, "utf8") > 64
    || Buffer.byteLength(parsed.protection, "utf8") > 8
    || (Object.prototype.hasOwnProperty.call(parsed, "codecVersion")
      && Buffer.byteLength(parsed.codecVersion, "utf8") > 32)
    || (Object.prototype.hasOwnProperty.call(parsed, "digestScheme")
      && Buffer.byteLength(parsed.digestScheme, "utf8") > 32)
    || (Object.prototype.hasOwnProperty.call(parsed, "purpose")
      && Buffer.byteLength(parsed.purpose, "utf8") > 32)) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  return parsed;
}

function assertEnvelopeSizeAttestation(row, prefix, limit) {
  const storageBytes = exactInteger(row[`${prefix}_json_storage_bytes`]);
  const ciphertextBytes = exactInteger(row[`${prefix}_ciphertext_base64_bytes`]);
  if (storageBytes === null || storageBytes < 1
    || storageBytes > limit.maximumEnvelopeBytes
    || ciphertextBytes === null || ciphertextBytes < 1
    || ciphertextBytes > limit.maximumCiphertextBase64Bytes) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
}

function requiredText(row, field, maximumLength) {
  const value = row[field];
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  return value;
}

function optionalText(row, field, maximumLength) {
  const value = row[field];
  if (value === null) return null;
  return requiredText(row, field, maximumLength);
}

function commandWitnessBinding(row) {
  const requestDigest = requiredText(row, "request_digest", 64);
  if (!/^[a-f0-9]{64}$/.test(requestDigest)) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  // commandIdempotency.resultBinding uses stable key ordering. Keeping this
  // literal in the same lexical order produces the exact persisted AAD input.
  return JSON.stringify({
    actorId: requiredText(row, "actor_id", 128),
    commandName: requiredText(row, "command_name", 96),
    idempotencyKey: requiredText(row, "idempotency_key", 191),
    recordId: requiredText(row, "command_idempotency_id", 64),
    requestDigest,
  });
}

function inboxPayloadBinding(row) {
  const integerFields = [
    ["handler_registry_version", true],
    ["partition_position", true],
    ["aggregate_version", true],
  ];
  const integers = {};
  for (const [field, positive] of integerFields) {
    const value = exactInteger(row[field]);
    if (value === null || (positive && value < 1)) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    integers[field] = value;
  }
  return {
    consumerName: requiredText(row, "consumer_name", 128),
    handlerVersion: requiredText(row, "handler_version", 64),
    handlerId: requiredText(row, "handler_id", 96),
    handlerRegistryVersion: integers.handler_registry_version,
    handlerDescriptorDigest: requiredText(row, "handler_descriptor_digest", 64),
    handlerSourceDigest: requiredText(row, "handler_source_digest", 64),
    handlerRegistrationDigest: requiredText(row, "handler_registration_digest", 64),
    sourceName: requiredText(row, "source_name", 96),
    partitionKey: requiredText(row, "partition_key", 191),
    partitionPosition: integers.partition_position,
    eventId: requiredText(row, "event_id", 64),
    eventType: requiredText(row, "event_type", 128),
    schemaVersion: requiredText(row, "schema_version", 32),
    aggregateType: requiredText(row, "aggregate_type", 96),
    aggregateId: requiredText(row, "aggregate_id", 191),
    aggregateVersion: integers.aggregate_version,
    occurredAt: requiredText(row, "occurred_at", 64),
    producerVersion: requiredText(row, "producer_version", 64),
    correlationId: optionalText(row, "correlation_id", 128),
    causationId: optionalText(row, "causation_id", 128),
    idempotencyKey: requiredText(row, "idempotency_key", 191),
  };
}

function inboxResultBinding(row) {
  const leaseGeneration = exactInteger(row.lease_generation);
  if (leaseGeneration === null || leaseGeneration < 1) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  return {
    ...inboxPayloadBinding(row),
    receiptId: requiredText(row, "inbox_receipt_id", 64),
    leaseGeneration,
    completionTransitionId: requiredText(row, "inbox_transition_id", 128),
  };
}

function expectedWitnessCounts(inventory, source) {
  const expected = new Map();
  let total = 0;
  for (const entry of inventory.filter((candidate) => candidate.source === source)) {
    if (!KEY_ID_PATTERN.test(entry.keyId || "")
      || !Number.isSafeInteger(entry.referenceCount)
      || entry.referenceCount < 1) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    expected.set(entry.keyId, (expected.get(entry.keyId) || 0) + entry.referenceCount);
    total += entry.referenceCount;
    if (!Number.isSafeInteger(total) || total > MAX_AUTHENTICATED_RECORDS_PER_SOURCE) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
  }
  return { expected, total };
}

function observedWitnessCountMatches(observed, expectation) {
  return observed.size === expectation.expected.size
    && [...expectation.expected].every(
      ([keyId, count]) => observed.get(keyId) === count
    );
}

function authenticateCommandWitnesses(rows, inventory, codec) {
  if (!Array.isArray(rows) || rows.length > MAX_AUTHENTICATED_RECORDS_PER_SOURCE) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const expectation = expectedWitnessCounts(inventory, SOURCE.COMMAND_RESULT);
  if (rows.length !== expectation.total) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const observed = new Map();
  for (const row of rows) {
    if (!ownDataRecord(row)) throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    const keyId = row.result_key_id;
    if (!KEY_ID_PATTERN.test(keyId || "") || !expectation.expected.has(keyId)) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    observed.set(keyId, (observed.get(keyId) || 0) + 1);
    assertEnvelopeSizeAttestation(row, "result", COMMAND_ENVELOPE_LIMIT);
    const envelope = parseEnvelopeColumn(row.result_json, COMMAND_ENVELOPE_LIMIT);
    const metadata = codec.inspectEnvelope(envelope);
    if (!metadata
      || metadata.protected !== true
      || metadata.codecVersion !== EXPECTED_CODEC
      || metadata.codecVersion !== row.result_codec_version
      || metadata.keyId !== keyId) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    codec.decode(envelope, { binding: commandWitnessBinding(row) });
  }
  if (!observedWitnessCountMatches(observed, expectation)) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
}

function authenticateInboxWitnesses(rows, inventory, source, codec) {
  if (!Array.isArray(rows) || rows.length > MAX_AUTHENTICATED_RECORDS_PER_SOURCE) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const resultPurpose = source === SOURCE.INBOX_RESULT;
  const expectation = expectedWitnessCounts(inventory, source);
  if (rows.length !== expectation.total) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
  const observed = new Map();
  for (const row of rows) {
    if (!ownDataRecord(row)) throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    const keyField = resultPurpose ? "result_key_id" : "payload_key_id";
    const codecField = resultPurpose ? "result_codec_version" : "payload_codec_version";
    const digestSchemeField = resultPurpose ? "result_digest_scheme" : "payload_digest_scheme";
    const digestField = resultPurpose ? "result_digest" : "payload_digest";
    const jsonField = resultPurpose ? "result_json" : "payload_json";
    const purpose = resultPurpose ? "RESULT" : "PAYLOAD";
    const keyId = row[keyField];
    if (!KEY_ID_PATTERN.test(keyId || "") || !expectation.expected.has(keyId)) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    observed.set(keyId, (observed.get(keyId) || 0) + 1);
    const envelopeLimit = resultPurpose
      ? INBOX_RESULT_ENVELOPE_LIMIT
      : INBOX_PAYLOAD_ENVELOPE_LIMIT;
    const envelopePrefix = resultPurpose ? "result" : "payload";
    assertEnvelopeSizeAttestation(row, envelopePrefix, envelopeLimit);
    const envelope = parseEnvelopeColumn(row[jsonField], envelopeLimit);
    const metadata = codec.inspectEnvelope(envelope);
    if (!metadata
      || metadata.protected !== true
      || metadata.codecVersion !== EXPECTED_CODEC
      || metadata.codecVersion !== row[codecField]
      || metadata.digestScheme !== EXPECTED_DIGEST_SCHEME
      || metadata.digestScheme !== row[digestSchemeField]
      || metadata.keyId !== keyId
      || metadata.purpose !== purpose
      || metadata.contentDigest !== row[digestField]) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    const binding = resultPurpose ? inboxResultBinding(row) : inboxPayloadBinding(row);
    const opened = codec.open(envelope, {
      purpose,
      binding,
    });
    if (!opened
      || opened.protected !== true
      || opened.codecVersion !== EXPECTED_CODEC
      || opened.digestScheme !== EXPECTED_DIGEST_SCHEME
      || opened.keyId !== keyId
      || opened.contentDigest !== row[digestField]) {
      throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
    }
    if (resultPurpose) {
      if (row.completion_manifest_digest_scheme !== EXPECTED_DIGEST_SCHEME
        || typeof row.completion_manifest_digest !== "string"
        || !/^[a-f0-9]{64}$/.test(row.completion_manifest_digest)
        || !ownDataRecord(opened.value)
        || !Object.prototype.hasOwnProperty.call(opened.value, "completionManifest")
        || !codec.verifyDigest(
          opened.value.completionManifest,
          row.completion_manifest_digest,
          { purpose: "MANIFEST", binding, keyId }
        )) {
        throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
      }
    }
  }
  if (!observedWitnessCountMatches(observed, expectation)) {
    throw readinessError("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED");
  }
}

async function inspectEnabled(resolved, mysqlPool) {
  const {
    targetDatabase,
    publicConfiguration: configuration,
    commandCodec,
    inboxCodec,
  } = resolved;
  try {
    return await withReadOnlySnapshot(mysqlPool, async (connection) => {
      const databaseRows = await executeRows(connection, SQL.databaseName);
      if (databaseRows.length !== 1
        || !ownDataRecord(databaseRows[0])
        || databaseRows[0].database_name !== targetDatabase) {
        return blockedReport("KEY_INVENTORY_DATABASE_MISMATCH", { configuration });
      }
      const columns = await executeRows(connection, SQL.columns);
      const indexes = await executeRows(connection, SQL.indexes);
      const checks = await executeRows(connection, SQL.checks);
      if (!schemaMatches(columns, indexes, checks)) {
        return blockedReport("KEY_INVENTORY_SCHEMA_DRIFT", {
          configuration,
          schema: { ready: false, status: "KEY_INVENTORY_SCHEMA_DRIFT" },
        });
      }
      const commandResults = await executeRows(connection, SQL.commandResults);
      const inboxPayloads = await executeRows(connection, SQL.inboxPayloads);
      const inboxResults = await executeRows(connection, SQL.inboxResults);
      const requestDigests = await executeRows(connection, SQL.requestDigests);
      const requestFacts = normalizeRequestDigestRows(requestDigests, configuration);
      const taskEventRequestDigests = await executeRows(connection, SQL.taskEventRequestDigests);
      const taskEventRequestFacts = normalizeRequestDigestRows(
        taskEventRequestDigests,
        configuration,
        SOURCE.TASK_EVENT_REQUEST_DIGEST
      );
      const wechatIdentityProvenanceDigests = await executeRows(
        connection,
        SQL.wechatIdentityProvenanceDigests
      );
      const wechatIdentityProvenanceFacts = normalizeKeyedDigestRows(
        wechatIdentityProvenanceDigests,
        {
          source: SOURCE.WECHAT_UNIONID_PROVENANCE,
          domain: DOMAIN.REQUEST_DIGEST,
          purpose: "REQUEST_DIGEST",
        },
        configuration
      );
      const legacyRecipientBindingDigests = await executeRows(
        connection,
        SQL.legacyRecipientBindingDigests
      );
      const legacyRecipientBindingFacts = normalizeKeyedDigestRows(
        legacyRecipientBindingDigests,
        {
          source: SOURCE.LEGACY_RECIPIENT_BINDING,
          domain: DOMAIN.REQUEST_DIGEST,
          purpose: "REQUEST_DIGEST",
        },
        configuration
      );
      const v1RecipientBindingDigests = await executeRows(
        connection,
        SQL.v1RecipientBindingDigests
      );
      const v1RecipientBindingFacts = normalizeKeyedDigestRows(
        v1RecipientBindingDigests,
        {
          source: SOURCE.V1_RECIPIENT_BINDING,
          domain: DOMAIN.REQUEST_DIGEST,
          purpose: "REQUEST_DIGEST",
        },
        configuration
      );
      const notificationAttemptReceiptDigests = await executeRows(
        connection,
        SQL.notificationAttemptReceiptDigests
      );
      const notificationAttemptReceiptFacts = normalizeKeyedDigestRows(
        notificationAttemptReceiptDigests,
        {
          source: SOURCE.NOTIFICATION_SEND_ATTEMPT_RECEIPT,
          domain: DOMAIN.NOTIFICATION_RECEIPT,
          purpose: "PROVIDER_RECEIPT_DIGEST",
        },
        configuration
      );
      const notificationTransitionReceiptDigests = await executeRows(
        connection,
        SQL.notificationTransitionReceiptDigests
      );
      const notificationTransitionReceiptFacts = normalizeKeyedDigestRows(
        notificationTransitionReceiptDigests,
        {
          source: SOURCE.NOTIFICATION_SEND_TRANSITION_RECEIPT,
          domain: DOMAIN.NOTIFICATION_RECEIPT,
          purpose: "PROVIDER_RECEIPT_DIGEST",
        },
        configuration
      );
      const commandFacts = normalizeInventoryRows(commandResults, {
          source: SOURCE.COMMAND_RESULT,
          domain: DOMAIN.COMMAND_RESULT,
          purpose: "RESULT",
        }, configuration);
      const payloadFacts = normalizeInventoryRows(inboxPayloads, {
          source: SOURCE.INBOX_PAYLOAD,
          domain: DOMAIN.INBOX_CONTENT,
          purpose: "PAYLOAD",
        }, configuration);
      const resultFacts = normalizeInventoryRows(inboxResults, {
          source: SOURCE.INBOX_RESULT,
          domain: DOMAIN.INBOX_CONTENT,
          purpose: "RESULT",
        }, configuration);
      const inventory = consolidateInventory([
        ...requestFacts.inventory,
        ...taskEventRequestFacts.inventory,
        ...wechatIdentityProvenanceFacts.inventory,
        ...legacyRecipientBindingFacts.inventory,
        ...v1RecipientBindingFacts.inventory,
        ...notificationAttemptReceiptFacts.inventory,
        ...notificationTransitionReceiptFacts.inventory,
        ...commandFacts.inventory,
        ...payloadFacts.inventory,
        ...resultFacts.inventory,
      ]);
      const preliminary = reportForInventory(
        configuration,
        inventory,
        requestFacts.invariantDrift
          || taskEventRequestFacts.invariantDrift
          || wechatIdentityProvenanceFacts.invariantDrift
          || legacyRecipientBindingFacts.invariantDrift
          || v1RecipientBindingFacts.invariantDrift
          || notificationAttemptReceiptFacts.invariantDrift
          || notificationTransitionReceiptFacts.invariantDrift
          || commandFacts.invariantDrift
          || payloadFacts.invariantDrift
          || resultFacts.invariantDrift
      );
      if (!preliminary.ready) return preliminary;

      const commandWitnesses = await executeRows(connection, SQL.commandWitnesses);
      const payloadWitnesses = await executeRows(connection, SQL.inboxPayloadWitnesses);
      const resultWitnesses = await executeRows(connection, SQL.inboxResultWitnesses);
      try {
        authenticateCommandWitnesses(commandWitnesses, inventory, commandCodec);
        authenticateInboxWitnesses(payloadWitnesses, inventory, SOURCE.INBOX_PAYLOAD, inboxCodec);
        authenticateInboxWitnesses(resultWitnesses, inventory, SOURCE.INBOX_RESULT, inboxCodec);
      } catch {
        return blockedReport("KEY_INVENTORY_WITNESS_AUTHENTICATION_FAILED", {
          configuration,
          schema: { ready: true, status: "KEY_INVENTORY_SCHEMA_READY" },
          inventory,
        });
      }
      return preliminary;
    });
  } catch {
    return blockedReport("KEY_INVENTORY_PERSISTENCE_UNAVAILABLE", { configuration });
  }
}

function validateConstruction(options) {
  if (!ownDataRecord(options)) throw readinessError("KEY_INVENTORY_CONSTRUCTION_INVALID", 500);
  const keys = Object.keys(options).sort();
  if (keys.some((key) => key !== "env" && key !== "mysqlPool")) {
    throw readinessError("KEY_INVENTORY_CONSTRUCTION_INVALID", 500);
  }
  if (!options.env || typeof options.env !== "object") {
    throw readinessError("KEY_INVENTORY_CONSTRUCTION_INVALID", 500);
  }
}

function createKeyInventoryReadinessFoundation(options = {}) {
  validateConstruction(options);
  const { env, mysqlPool } = options;
  let inspectionInFlight;
  function inspect() {
    if (!inspectionInFlight) {
      const currentInspection = Promise.resolve().then(async () => {
        let enabled;
        try { enabled = readEnableFlag(env); } catch {
          return blockedReport("KEY_INVENTORY_CONFIGURATION_INVALID");
        }
        if (!enabled) return disabledReport();
        let configuration;
        try { configuration = resolveConfiguration(env); } catch {
          return blockedReport("KEY_INVENTORY_CONFIGURATION_INVALID");
        }
        return inspectEnabled(configuration, mysqlPool);
      });
      inspectionInFlight = currentInspection;
      const clearInFlight = () => {
        if (inspectionInFlight === currentInspection) inspectionInFlight = null;
      };
      currentInspection.then(clearInFlight, clearInFlight);
    }
    return inspectionInFlight;
  }
  return Object.freeze({
    inspect,
    async verify() {
      const report = await inspect();
      if (!report.ready) throw readinessError(report.status);
      return report;
    },
  });
}

module.exports = {
  createKeyInventoryReadinessFoundation,
};
