const crypto = require("node:crypto");

const {
  NATIVE_DECISION_STATUS,
  SEND_ATTEMPT_STATUS,
  createProviderReceiptDigestCodec,
  foundationError,
  normalizeBeginAttempt,
  normalizeClaimProviderCall,
  normalizeCompleteAttempt,
  normalizeDecision,
  normalizeInspectSendAttempt,
  normalizeRecoverProviderCall,
  normalizeSchedule,
  normalizeStartProviderCall,
  publicSendAttempt,
} = require("./notificationDeliveryUniqueness");

const ENABLE_FLAG = "MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED";
const CORE_AUTHORITY = Symbol("mysql-notification-delivery-core-authority");
const TEST_RANDOM_BYTES_INJECTION_ALLOWED = process.env.NODE_ENV === "test";
const PROVIDER_CALL_LEASE_MS_FLAG = "ROOT_NOTIFICATION_PROVIDER_CALL_LEASE_MS";
const DEFAULT_PROVIDER_CALL_LEASE_MS = 30_000;

const SELECT_DECISION_SQL = `/* notification-delivery:select-decision */
SELECT
  attempt.*,
  DATE_FORMAT(attempt.decided_at, '%Y-%m-%d %H:%i:%s.%f') AS decided_at_wall_time,
  subscription_grant.notification_subscription_grant_id,
  subscription_grant.root_user_id AS grant_root_user_id,
  subscription_grant.task_id AS grant_task_id,
  subscription_grant.task_occurrence_date AS grant_task_occurrence_date,
  subscription_grant.template_version AS grant_template_version,
  subscription_grant.grant_request_id AS grant_grant_request_id,
  subscription_grant.release_id AS grant_release_id,
  subscription_grant.status AS grant_status,
  subscription_grant.recipient_binding_status AS grant_recipient_binding_status,
  subscription_grant.recipient_wechat_identity_id AS grant_recipient_wechat_identity_id,
  subscription_grant.recipient_app_code AS grant_recipient_app_code,
  subscription_grant.recipient_binding_canonical_version AS grant_recipient_binding_canonical_version,
  subscription_grant.recipient_binding_digest AS grant_recipient_binding_digest,
  subscription_grant.recipient_binding_digest_scheme AS grant_recipient_binding_digest_scheme,
  subscription_grant.recipient_binding_key_id AS grant_recipient_binding_key_id
FROM notification_subscription_attempt_v1 AS attempt
LEFT JOIN notification_subscription_grant_v1 AS subscription_grant
  ON subscription_grant.notification_subscription_attempt_id = attempt.notification_subscription_attempt_id
WHERE attempt.grant_request_id = ?
   OR (
     attempt.root_user_id = ?
     AND attempt.task_id = ?
     AND attempt.task_occurrence_date = ?
     AND attempt.template_version = ?
   )
ORDER BY attempt.notification_subscription_attempt_id
LIMIT 2
FOR UPDATE`;

const INSERT_DECISION_SQL = `/* notification-delivery:insert-decision */
INSERT INTO notification_subscription_attempt_v1 (
  notification_subscription_attempt_id,
  root_user_id,
  task_id,
  task_occurrence_date,
  template_version,
  grant_request_id,
  native_decision,
  reason_code,
  idempotency_key,
  decided_at,
  release_id,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

const INSERT_GRANT_SQL = `/* notification-delivery:insert-grant */
INSERT INTO notification_subscription_grant_v1 (
  notification_subscription_grant_id,
  notification_subscription_attempt_id,
  root_user_id,
  task_id,
  task_occurrence_date,
  template_version,
  grant_request_id,
  status,
  reserved_job_id,
  status_reason_code,
  granted_at,
  reserved_at,
  consumed_at,
  invalidated_at,
  review_required_at,
  recipient_binding_status,
  recipient_wechat_identity_id,
  recipient_app_code,
  recipient_binding_canonical_version,
  recipient_binding_digest,
  recipient_binding_digest_scheme,
  recipient_binding_key_id,
  release_id,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', NULL, NULL, ?, NULL, NULL, NULL, NULL, 'VERIFIED', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

const SELECT_GRANT_SQL = `/* notification-delivery:select-grant */
SELECT *
FROM notification_subscription_grant_v1
WHERE notification_subscription_grant_id = ?
LIMIT 1
FOR UPDATE`;

const SELECT_JOB_CONFLICT_SQL = `/* notification-delivery:select-job-conflict */
SELECT
  job.*,
  DATE_FORMAT(job.due_at, '%Y-%m-%d %H:%i:%s.%f') AS due_at_wall_time
FROM notification_job_v1 AS job
WHERE notification_subscription_grant_id = ?
   OR (
     root_user_id = ?
     AND task_id = ?
     AND task_occurrence_date = ?
     AND template_version = ?
   )
ORDER BY notification_job_id
LIMIT 2
FOR UPDATE`;

const INSERT_JOB_SQL = `/* notification-delivery:insert-job */
INSERT INTO notification_job_v1 (
  notification_job_id,
  notification_subscription_grant_id,
  root_user_id,
  task_id,
  task_occurrence_date,
  template_version,
  status,
  due_at,
  idempotency_key,
  request_digest,
  send_attempt_id,
  stable_error_code,
  release_id,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

const BIND_GRANT_JOB_SQL = `/* notification-delivery:bind-grant-job */
UPDATE notification_subscription_grant_v1
SET reserved_job_id = ?,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_subscription_grant_id = ?
  AND status = 'AVAILABLE'
  AND reserved_job_id IS NULL`;

const SELECT_JOB_FOR_ATTEMPT_SQL = `/* notification-delivery:select-job-for-attempt */
SELECT
  job.*,
  subscription_grant.status AS grant_status,
  subscription_grant.reserved_job_id,
  subscription_grant.status_reason_code AS grant_status_reason_code,
  subscription_grant.recipient_binding_status AS grant_recipient_binding_status,
  subscription_grant.release_id AS grant_release_id,
  subscription_grant.recipient_wechat_identity_id AS grant_recipient_wechat_identity_id,
  subscription_grant.recipient_app_code AS grant_recipient_app_code,
  subscription_grant.recipient_binding_canonical_version AS grant_recipient_binding_canonical_version,
  subscription_grant.recipient_binding_digest AS grant_recipient_binding_digest,
  subscription_grant.recipient_binding_digest_scheme AS grant_recipient_binding_digest_scheme,
  subscription_grant.recipient_binding_key_id AS grant_recipient_binding_key_id
FROM notification_job_v1 AS job
INNER JOIN notification_subscription_grant_v1 AS subscription_grant
  ON subscription_grant.notification_subscription_grant_id = job.notification_subscription_grant_id
WHERE job.notification_job_id = ?
LIMIT 1
FOR UPDATE`;

const SELECT_ATTEMPT_BY_JOB_SQL = `/* notification-delivery:select-attempt-by-job */
SELECT
  attempt.*,
  DATE_FORMAT(attempt.started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at_wall_time,
  current_transition.transition_number AS current_transition_number,
  current_transition.from_status AS current_transition_from_status,
  current_transition.to_status AS current_transition_to_status,
  current_transition.transition_fence_digest AS current_transition_fence_digest,
  current_transition.provider_receipt_digest AS current_transition_provider_receipt_digest,
  current_transition.provider_receipt_digest_scheme AS current_transition_provider_receipt_digest_scheme,
  current_transition.provider_receipt_digest_key_id AS current_transition_provider_receipt_digest_key_id,
  current_transition.stable_error_code AS current_transition_stable_error_code,
  current_transition.release_id AS current_transition_release_id
FROM notification_send_attempt AS attempt
LEFT JOIN notification_send_attempt_transition AS current_transition
  ON current_transition.notification_send_attempt_id = attempt.notification_send_attempt_id
 AND current_transition.transition_number = attempt.transition_version
WHERE attempt.notification_job_id = ?
LIMIT 1
FOR UPDATE`;

const INSERT_ATTEMPT_SQL = `/* notification-delivery:insert-attempt */
INSERT INTO notification_send_attempt (
  notification_send_attempt_id,
  notification_job_id,
  attempt_number,
  provider,
  status,
  transition_version,
  transition_fence_digest,
  request_digest,
  provider_call_state,
  provider_call_owner,
  provider_call_lease_expires_at,
  provider_call_generation,
  provider_call_started_at,
  provider_receipt_digest,
  provider_receipt_digest_scheme,
  provider_receipt_digest_key_id,
  stable_error_code,
  started_at,
  completed_at,
  release_id,
  created_at,
  updated_at
) VALUES (?, ?, 1, 'WECHAT', 'REQUESTED', 1, ?, ?, 'AVAILABLE', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

const CLAIM_PROVIDER_CALL_SQL = `/* notification-delivery:claim-provider-call */
UPDATE notification_send_attempt
SET provider_call_state = 'LEASED',
    provider_call_owner = ?,
    provider_call_lease_expires_at = TIMESTAMPADD(MICROSECOND, ?, CURRENT_TIMESTAMP(3)),
    provider_call_generation = provider_call_generation + 1,
    provider_call_started_at = NULL,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_send_attempt_id = ?
  AND status = 'REQUESTED'
  AND release_id = ?
  AND (
    provider_call_state = 'AVAILABLE'
    OR (
      provider_call_state = 'LEASED'
      AND provider_call_lease_expires_at <= CURRENT_TIMESTAMP(3)
    )
  )`;

const START_PROVIDER_CALL_SQL = `/* notification-delivery:start-provider-call */
UPDATE notification_send_attempt AS attempt
INNER JOIN notification_job_v1 AS job
  ON job.notification_job_id = attempt.notification_job_id
INNER JOIN notification_subscription_grant_v1 AS subscription_grant
  ON subscription_grant.notification_subscription_grant_id = job.notification_subscription_grant_id
INNER JOIN wechat_identity AS recipient_identity
  ON BINARY recipient_identity.wechat_identity_id = BINARY subscription_grant.recipient_wechat_identity_id
SET attempt.provider_call_state = 'STARTED',
    attempt.provider_call_started_at = CURRENT_TIMESTAMP(3),
    attempt.updated_at = CURRENT_TIMESTAMP(3)
WHERE attempt.notification_send_attempt_id = ?
  AND attempt.status = 'REQUESTED'
  AND attempt.provider_call_state = 'LEASED'
  AND attempt.provider_call_owner = ?
  AND attempt.provider_call_generation = ?
  AND attempt.provider_call_lease_expires_at > CURRENT_TIMESTAMP(3)
  AND attempt.request_digest = ?
  AND attempt.release_id = ?
  AND job.status = 'SENDING'
  AND job.send_attempt_id = attempt.notification_send_attempt_id
  AND job.release_id = ?
  AND subscription_grant.status = 'RESERVED'
  AND subscription_grant.reserved_job_id = attempt.notification_job_id
  AND subscription_grant.release_id = ?
  AND subscription_grant.recipient_binding_status = 'VERIFIED'
  AND subscription_grant.recipient_app_code = 'MYROOT'
  AND subscription_grant.recipient_binding_canonical_version = 'canonical-json:v1'
  AND subscription_grant.recipient_binding_digest = ?
  AND subscription_grant.recipient_binding_digest_scheme = 'hmac-sha256:v1'
  AND BINARY job.root_user_id = BINARY subscription_grant.root_user_id
  AND BINARY subscription_grant.root_user_id = BINARY recipient_identity.root_user_id
  AND BINARY subscription_grant.recipient_app_code = BINARY recipient_identity.app_code
  AND BINARY recipient_identity.wechat_identity_id = BINARY ?
  AND BINARY recipient_identity.root_user_id = BINARY ?
  AND BINARY recipient_identity.app_code = BINARY ?
  AND BINARY recipient_identity.openid = BINARY ?`;

const INSERT_TRANSITION_SQL = `/* notification-delivery:insert-transition */
INSERT INTO notification_send_attempt_transition (
  notification_send_attempt_transition_id,
  notification_send_attempt_id,
  transition_number,
  from_status,
  to_status,
  transition_fence_digest,
  provider_receipt_digest,
  provider_receipt_digest_scheme,
  provider_receipt_digest_key_id,
  stable_error_code,
  release_id,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`;

const ACTIVATE_ATTEMPT_JOB_SQL = `/* notification-delivery:activate-attempt-job */
UPDATE notification_job_v1
SET status = 'SENDING',
    send_attempt_id = ?,
    stable_error_code = NULL,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_job_id = ?
  AND status = 'SCHEDULED'
  AND send_attempt_id IS NULL`;

const RESERVE_ATTEMPT_GRANT_SQL = `/* notification-delivery:reserve-attempt-grant */
UPDATE notification_subscription_grant_v1
SET status = 'RESERVED',
    reserved_at = CURRENT_TIMESTAMP(3),
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_subscription_grant_id = ?
  AND status = 'AVAILABLE'
  AND reserved_job_id = ?`;

const SELECT_ATTEMPT_SQL = `/* notification-delivery:select-attempt */
SELECT
  attempt.*,
  DATE_FORMAT(attempt.completed_at, '%Y-%m-%d %H:%i:%s.%f') AS completed_at_wall_time,
  job.notification_subscription_grant_id,
  job.root_user_id AS job_root_user_id,
  job.send_attempt_id AS job_send_attempt_id,
  job.release_id AS job_release_id,
  job.status AS job_status,
  job.stable_error_code AS job_stable_error_code,
  subscription_grant.reserved_job_id AS grant_reserved_job_id,
  subscription_grant.root_user_id AS grant_root_user_id,
  subscription_grant.release_id AS grant_release_id,
  subscription_grant.status AS grant_status,
  subscription_grant.status_reason_code AS grant_status_reason_code,
  subscription_grant.recipient_binding_status AS grant_recipient_binding_status,
  subscription_grant.recipient_wechat_identity_id AS grant_recipient_wechat_identity_id,
  subscription_grant.recipient_app_code AS grant_recipient_app_code,
  subscription_grant.recipient_binding_canonical_version AS grant_recipient_binding_canonical_version,
  subscription_grant.recipient_binding_digest AS grant_recipient_binding_digest,
  subscription_grant.recipient_binding_digest_scheme AS grant_recipient_binding_digest_scheme,
  subscription_grant.recipient_binding_key_id AS grant_recipient_binding_key_id,
  recipient_identity.wechat_identity_id AS current_recipient_wechat_identity_id,
  recipient_identity.root_user_id AS current_recipient_root_user_id,
  recipient_identity.app_code AS current_recipient_app_code,
  recipient_identity.openid AS current_recipient_openid,
  current_transition.transition_number AS current_transition_number,
  current_transition.from_status AS current_transition_from_status,
  current_transition.to_status AS current_transition_to_status,
  current_transition.transition_fence_digest AS current_transition_fence_digest,
  current_transition.provider_receipt_digest AS current_transition_provider_receipt_digest,
  current_transition.provider_receipt_digest_scheme AS current_transition_provider_receipt_digest_scheme,
  current_transition.provider_receipt_digest_key_id AS current_transition_provider_receipt_digest_key_id,
  current_transition.stable_error_code AS current_transition_stable_error_code,
  current_transition.release_id AS current_transition_release_id
FROM notification_send_attempt AS attempt
INNER JOIN notification_job_v1 AS job
  ON job.notification_job_id = attempt.notification_job_id
INNER JOIN notification_subscription_grant_v1 AS subscription_grant
  ON subscription_grant.notification_subscription_grant_id = job.notification_subscription_grant_id
LEFT JOIN wechat_identity AS recipient_identity
  ON BINARY recipient_identity.wechat_identity_id = BINARY subscription_grant.recipient_wechat_identity_id
LEFT JOIN notification_send_attempt_transition AS current_transition
  ON current_transition.notification_send_attempt_id = attempt.notification_send_attempt_id
 AND current_transition.transition_number = attempt.transition_version
WHERE attempt.notification_send_attempt_id = ?
LIMIT 1
FOR UPDATE`;

const INSPECT_ATTEMPT_SQL = SELECT_ATTEMPT_SQL
  .replace("notification-delivery:select-attempt", "notification-delivery:inspect-attempt")
  .replace(/\nFOR UPDATE$/, "");

const COMPLETE_ATTEMPT_SQL = `/* notification-delivery:complete-attempt */
UPDATE notification_send_attempt
SET status = ?,
    transition_version = transition_version + 1,
    transition_fence_digest = ?,
    provider_receipt_digest = ?,
    provider_receipt_digest_scheme = ?,
    provider_receipt_digest_key_id = ?,
    stable_error_code = ?,
    completed_at = ?,
    provider_call_state = 'COMPLETED',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_send_attempt_id = ?
  AND status = 'REQUESTED'
  AND transition_version = ?
  AND transition_fence_digest = ?
  AND provider_call_state = 'STARTED'
  AND provider_call_owner = ?
  AND provider_call_generation = ?
  AND release_id = ?`;

const RECOVER_PROVIDER_CALL_SQL = `/* notification-delivery:recover-provider-call */
UPDATE notification_send_attempt
SET status = 'UNKNOWN',
    transition_version = transition_version + 1,
    transition_fence_digest = ?,
    provider_receipt_digest = NULL,
    provider_receipt_digest_scheme = NULL,
    provider_receipt_digest_key_id = NULL,
    stable_error_code = 'PROVIDER_RESULT_UNKNOWN',
    completed_at = CURRENT_TIMESTAMP(3),
    provider_call_state = 'COMPLETED',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_send_attempt_id = ?
  AND status = 'REQUESTED'
  AND transition_version = ?
  AND transition_fence_digest = ?
  AND provider_call_state = 'STARTED'
  AND provider_call_lease_expires_at <= CURRENT_TIMESTAMP(3)
  AND release_id = ?`;

const COMPLETE_JOB_SQL = `/* notification-delivery:complete-job */
UPDATE notification_job_v1
SET status = ?,
    stable_error_code = ?,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_job_id = ?
  AND status = 'SENDING'
  AND send_attempt_id = ?`;

const COMPLETE_GRANT_SQL = `/* notification-delivery:complete-grant */
UPDATE notification_subscription_grant_v1
SET status = ?,
    status_reason_code = ?,
    consumed_at = CASE WHEN ? = 'CONSUMED' THEN CURRENT_TIMESTAMP(3) ELSE consumed_at END,
    invalidated_at = CASE WHEN ? = 'INVALID' THEN CURRENT_TIMESTAMP(3) ELSE invalidated_at END,
    review_required_at = CASE WHEN ? = 'REVIEW_REQUIRED' THEN CURRENT_TIMESTAMP(3) ELSE review_required_at END,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE notification_subscription_grant_id = ?
  AND status = 'RESERVED'`;

function adapterError(code) {
  return foundationError(code);
}

function persistenceError() {
  return adapterError("NOTIFICATION_DELIVERY_PERSISTENCE_FAILED");
}

function reviewRequiredError() {
  return adapterError("NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED");
}

function commitOutcomeUnknownError() {
  return adapterError("NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN");
}

function disabledError() {
  return adapterError("NOTIFICATION_DELIVERY_FOUNDATION_DISABLED");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rowsFrom(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw persistenceError();
  return result[0];
}

function affectedRowsFrom(result) {
  if (!Array.isArray(result) || !result[0]) throw persistenceError();
  const count = Number(result[0].affectedRows);
  if (!Number.isSafeInteger(count) || count < 0) throw persistenceError();
  return count;
}

function duplicateKey(error) {
  return Boolean(error && (error.code === "ER_DUP_ENTRY" || Number(error.errno) === 1062));
}

function mysqlTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw persistenceError();
  return new Date(timestamp + (8 * 60 * 60 * 1000)).toISOString().slice(0, 23).replace("T", " ");
}

function sameTimestamp(stored, canonicalUtc, mysqlWallTime = null) {
  if (mysqlWallTime !== null && mysqlWallTime !== undefined) {
    return String(mysqlWallTime) === `${mysqlTimestamp(canonicalUtc)}000`;
  }
  if (stored instanceof Date) return stored.toISOString() === canonicalUtc;
  const text = String(stored || "");
  return text === canonicalUtc || text === mysqlTimestamp(canonicalUtc);
}

function sameText(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  return String(left) === String(right);
}

function mysqlDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    return new Date(value.getTime() + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  }
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function sameOccurrence(row, input) {
  return sameText(row.root_user_id, input.rootUserId)
    && sameText(row.task_id, input.taskId)
    && sameText(mysqlDate(row.task_occurrence_date), input.taskOccurrenceDate)
    && sameText(row.template_version, input.templateVersion);
}

function sameRecipientBinding(row, input, prefix = "") {
  return row[`${prefix}recipient_binding_status`] === "VERIFIED"
    && sameText(row[`${prefix}recipient_wechat_identity_id`], input.recipientWechatIdentityId)
    && sameText(row[`${prefix}recipient_app_code`], input.recipientAppCode)
    && sameText(
      row[`${prefix}recipient_binding_canonical_version`],
      input.recipientBindingCanonicalVersion
    )
    && sameText(row[`${prefix}recipient_binding_digest`], input.recipientBindingDigest)
    && sameText(row[`${prefix}recipient_binding_digest_scheme`], input.recipientBindingDigestScheme)
    && sameText(row[`${prefix}recipient_binding_key_id`], input.recipientBindingKeyId);
}

function validPersistedRecipientBinding(row, prefix = "") {
  return row[`${prefix}recipient_binding_status`] === "VERIFIED"
    && typeof row[`${prefix}recipient_wechat_identity_id`] === "string"
    && row[`${prefix}recipient_wechat_identity_id`].length > 0
    && row[`${prefix}recipient_app_code`] === "MYROOT"
    && row[`${prefix}recipient_binding_canonical_version`] === "canonical-json:v1"
    && /^[a-f0-9]{64}$/.test(String(row[`${prefix}recipient_binding_digest`] || ""))
    && row[`${prefix}recipient_binding_digest_scheme`] === "hmac-sha256:v1"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
      String(row[`${prefix}recipient_binding_key_id`] || "")
    );
}

function randomId(prefix, randomBytes) {
  let bytes;
  try {
    bytes = randomBytes(14);
  } catch {
    throw persistenceError();
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== 14) throw persistenceError();
  return `${prefix}_${bytes.toString("hex")}`;
}

function publicDecision(row, replayed) {
  return Object.freeze({
    attemptId: String(row.notification_subscription_attempt_id),
    grantId: row.notification_subscription_grant_id,
    grantRequestId: String(row.grant_request_id),
    nativeDecision: String(row.native_decision),
    grantStatus: row.grant_status,
    recipientBindingStatus: row.grant_recipient_binding_status,
    recipientWechatIdentityId: row.grant_recipient_wechat_identity_id,
    recipientAppCode: row.grant_recipient_app_code,
    recipientBindingCanonicalVersion: row.grant_recipient_binding_canonical_version,
    recipientBindingDigest: row.grant_recipient_binding_digest,
    recipientBindingDigestScheme: row.grant_recipient_binding_digest_scheme,
    recipientBindingKeyId: row.grant_recipient_binding_key_id,
    replayed,
  });
}

function publicJob(row, replayed) {
  return Object.freeze({
    jobId: String(row.notification_job_id),
    grantId: String(row.notification_subscription_grant_id),
    status: String(row.status),
    replayed,
  });
}

function publicProviderCallClaim(row, input, acquired, replayed = false) {
  const attempt = publicSendAttempt(row, { replayed });
  if (acquired && (attempt.providerCallState !== "LEASED"
    || !sameText(row.provider_call_owner, input.leaseOwner)
    || attempt.providerCallGeneration < 1)) throw reviewRequiredError();
  return Object.freeze({
    ...attempt,
    leaseAcquired: acquired,
    leaseOwner: acquired ? input.leaseOwner : null,
    leaseGeneration: acquired ? attempt.providerCallGeneration : null,
  });
}

function publicProviderCallStart(row, input, replayed = false) {
  const attempt = publicSendAttempt(row, { replayed });
  if (attempt.providerCallState !== "STARTED"
    || !sameText(row.provider_call_owner, input.leaseOwner)
    || attempt.providerCallGeneration !== input.leaseGeneration
    || !sameText(attempt.requestDigest, input.requestDigest)
    || !sameText(attempt.recipientBindingDigest, input.recipientBindingDigest)
    || !sameText(attempt.recipientWechatIdentityId, input.recipientWechatIdentityId)
    || !sameText(row.grant_root_user_id, input.recipientRootUserId)
    || !sameText(attempt.recipientAppCode, input.recipientAppCode)) {
    throw reviewRequiredError();
  }
  return Object.freeze({
    ...attempt,
    providerCallStarted: true,
    leaseOwner: input.leaseOwner,
    leaseGeneration: input.leaseGeneration,
  });
}

function publicProviderCallAlreadyStarted(row, input) {
  const started = publicProviderCallStart(row, input, true);
  return Object.freeze({
    ...started,
    providerCallStarted: false,
    providerCallAlreadyStarted: true,
    fenced: true,
  });
}

function sameCurrentRecipientIdentity(row, input) {
  return sameText(row.current_recipient_wechat_identity_id, input.recipientWechatIdentityId)
    && sameText(row.current_recipient_root_user_id, input.recipientRootUserId)
    && sameText(row.current_recipient_app_code, input.recipientAppCode)
    && sameText(row.current_recipient_openid, input.recipientOpenid);
}

function providerCallProjectionValid(row, input) {
  return sameText(row.notification_send_attempt_id, input.attemptId)
    && sameText(row.release_id, input.releaseId)
    && row.status === SEND_ATTEMPT_STATUS.REQUESTED
    && Number(row.transition_version) === 1
    && Number(row.current_transition_number) === 1
    && row.current_transition_from_status === null
    && row.current_transition_to_status === SEND_ATTEMPT_STATUS.REQUESTED
    && sameText(row.current_transition_fence_digest, row.transition_fence_digest)
    && row.current_transition_provider_receipt_digest === null
    && row.current_transition_provider_receipt_digest_scheme === null
    && row.current_transition_provider_receipt_digest_key_id === null
    && row.current_transition_stable_error_code === null
    && sameText(row.current_transition_release_id, input.releaseId)
    && sameText(row.job_send_attempt_id, row.notification_send_attempt_id)
    && sameText(row.job_root_user_id, row.grant_root_user_id)
    && sameText(row.job_release_id, input.releaseId)
    && row.job_status === "SENDING"
    && row.job_stable_error_code === null
    && sameText(row.grant_reserved_job_id, row.notification_job_id)
    && sameText(row.grant_release_id, input.releaseId)
    && validPersistedRecipientBinding(row, "grant_")
    && row.grant_status === "RESERVED"
    && row.grant_status_reason_code === null;
}

function createTransactionAdapter(connection, options = {}) {
  if (!connection || typeof connection.execute !== "function" || !plainRecord(options)) throw persistenceError();
  if (options.authority !== CORE_AUTHORITY) throw persistenceError();
  const env = options.env === undefined ? process.env : options.env;
  if (!plainRecord(env)) throw persistenceError();
  const enabled = env[ENABLE_FLAG] === "true";
  const randomBytes = typeof options.randomBytes === "function" ? options.randomBytes : crypto.randomBytes;
  const readOnly = options.readOnly === true;
  const execute = connection.execute.bind(connection);
  let active = true;

  function assertReady() {
    if (!active) throw persistenceError();
    if (!enabled) throw disabledError();
    return Object.freeze({ enabled: true, provider: "WECHAT", networkEnabled: false });
  }

  async function dbExecute(sql, values) {
    assertReady();
    try {
      return await execute(sql, values);
    } catch (error) {
      if (duplicateKey(error)) throw error;
      throw persistenceError();
    }
  }

  async function selectDecision(input) {
    return rowsFrom(await dbExecute(SELECT_DECISION_SQL, [
      input.grantRequestId,
      input.rootUserId,
      input.taskId,
      input.taskOccurrenceDate,
      input.templateVersion,
    ]));
  }

  function reconcileDecision(rows, input, replayed) {
    if (rows.length !== 1) throw reviewRequiredError();
    const row = rows[0];
    if (!sameOccurrence(row, input)
      || !sameText(row.grant_request_id, input.grantRequestId)
      || !sameText(row.native_decision, input.nativeDecision)
      || !sameText(row.reason_code, input.reasonCode)
      || !sameText(row.idempotency_key, input.idempotencyKey)
      || !sameTimestamp(row.decided_at, input.decidedAt, row.decided_at_wall_time)
      || !sameText(row.release_id, input.releaseId)) throw reviewRequiredError();
    if ((input.nativeDecision === NATIVE_DECISION_STATUS.ACCEPTED
      && (typeof row.notification_subscription_grant_id !== "string"
        || row.notification_subscription_grant_id.length === 0
        || !sameText(row.grant_root_user_id, input.rootUserId)
        || !sameText(row.grant_task_id, input.taskId)
        || !sameText(mysqlDate(row.grant_task_occurrence_date), input.taskOccurrenceDate)
        || !sameText(row.grant_template_version, input.templateVersion)
        || !sameText(row.grant_grant_request_id, input.grantRequestId)
        || !sameText(row.grant_release_id, input.releaseId)
        || row.grant_recipient_binding_status !== "VERIFIED"
        || !sameText(row.grant_recipient_wechat_identity_id, input.recipientWechatIdentityId)
        || !sameText(row.grant_recipient_app_code, input.recipientAppCode)
        || !sameText(row.grant_recipient_binding_canonical_version, input.recipientBindingCanonicalVersion)
        || !sameText(row.grant_recipient_binding_digest, input.recipientBindingDigest)
        || !sameText(row.grant_recipient_binding_digest_scheme, input.recipientBindingDigestScheme)
        || !sameText(row.grant_recipient_binding_key_id, input.recipientBindingKeyId)
        || typeof row.grant_status !== "string"
        || row.grant_status.length === 0))
      || (input.nativeDecision !== NATIVE_DECISION_STATUS.ACCEPTED
        && (row.notification_subscription_grant_id !== null || row.grant_status !== null))) {
      throw reviewRequiredError();
    }
    return publicDecision(row, replayed);
  }

  async function recordDecision(rawInput) {
    const input = normalizeDecision(rawInput);
    let rows = await selectDecision(input);
    if (rows.length) return reconcileDecision(rows, input, true);
    if (readOnly) throw commitOutcomeUnknownError();
    const attemptId = randomId("nsa", randomBytes);
    const grantId = input.nativeDecision === NATIVE_DECISION_STATUS.ACCEPTED ? randomId("nsg", randomBytes) : null;
    try {
      await dbExecute(INSERT_DECISION_SQL, [
        attemptId,
        input.rootUserId,
        input.taskId,
        input.taskOccurrenceDate,
        input.templateVersion,
        input.grantRequestId,
        input.nativeDecision,
        input.reasonCode,
        input.idempotencyKey,
        mysqlTimestamp(input.decidedAt),
        input.releaseId,
      ]);
      if (grantId) {
        await dbExecute(INSERT_GRANT_SQL, [
          grantId,
          attemptId,
          input.rootUserId,
          input.taskId,
          input.taskOccurrenceDate,
          input.templateVersion,
          input.grantRequestId,
          mysqlTimestamp(input.decidedAt),
          input.recipientWechatIdentityId,
          input.recipientAppCode,
          input.recipientBindingCanonicalVersion,
          input.recipientBindingDigest,
          input.recipientBindingDigestScheme,
          input.recipientBindingKeyId,
          input.releaseId,
        ]);
      }
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      rows = await selectDecision(input);
      return reconcileDecision(rows, input, true);
    }
    return Object.freeze({
      attemptId,
      grantId,
      grantRequestId: input.grantRequestId,
      nativeDecision: input.nativeDecision,
      grantStatus: grantId ? "AVAILABLE" : null,
      recipientBindingStatus: grantId ? "VERIFIED" : null,
      recipientWechatIdentityId: grantId ? input.recipientWechatIdentityId : null,
      recipientAppCode: grantId ? input.recipientAppCode : null,
      recipientBindingCanonicalVersion: grantId ? input.recipientBindingCanonicalVersion : null,
      recipientBindingDigest: grantId ? input.recipientBindingDigest : null,
      recipientBindingDigestScheme: grantId ? input.recipientBindingDigestScheme : null,
      recipientBindingKeyId: grantId ? input.recipientBindingKeyId : null,
      replayed: false,
    });
  }

  async function selectJobConflicts(input) {
    return rowsFrom(await dbExecute(SELECT_JOB_CONFLICT_SQL, [
      input.grantId,
      input.rootUserId,
      input.taskId,
      input.taskOccurrenceDate,
      input.templateVersion,
    ]));
  }

  function reconcileJob(rows, input, grant, replayed) {
    if (rows.length !== 1) throw reviewRequiredError();
    const row = rows[0];
    if (!sameOccurrence(row, input)
      || !sameText(row.notification_subscription_grant_id, input.grantId)
      || !sameTimestamp(row.due_at, input.dueAt, row.due_at_wall_time)
      || !sameText(row.idempotency_key, input.idempotencyKey)
      || !sameText(row.request_digest, input.requestDigest)
      || !sameText(row.release_id, input.releaseId)
      || !sameText(grant.reserved_job_id, row.notification_job_id)
      || !validPersistedRecipientBinding(grant)) throw reviewRequiredError();
    return publicJob(row, replayed);
  }

  async function schedule(rawInput) {
    const input = normalizeSchedule(rawInput);
    const grants = rowsFrom(await dbExecute(SELECT_GRANT_SQL, [input.grantId]));
    if (grants.length !== 1) throw reviewRequiredError();
    const grant = grants[0];
    if (!sameOccurrence(grant, input)
      || !sameText(grant.release_id, input.releaseId)
      || !validPersistedRecipientBinding(grant)) throw reviewRequiredError();
    let jobs = await selectJobConflicts(input);
    if (jobs.length) return reconcileJob(jobs, input, grant, true);
    if (readOnly) throw commitOutcomeUnknownError();
    if (grant.status !== "AVAILABLE" || grant.reserved_job_id !== null) throw reviewRequiredError();
    const jobId = randomId("ntj", randomBytes);
    try {
      await dbExecute(INSERT_JOB_SQL, [
        jobId,
        input.grantId,
        input.rootUserId,
        input.taskId,
        input.taskOccurrenceDate,
        input.templateVersion,
        mysqlTimestamp(input.dueAt),
        input.idempotencyKey,
        input.requestDigest,
        input.releaseId,
      ]);
      if (affectedRowsFrom(await dbExecute(BIND_GRANT_JOB_SQL, [jobId, input.grantId])) !== 1) {
        throw reviewRequiredError();
      }
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      jobs = await selectJobConflicts(input);
      const replayGrants = rowsFrom(await dbExecute(SELECT_GRANT_SQL, [input.grantId]));
      if (replayGrants.length !== 1) throw reviewRequiredError();
      return reconcileJob(jobs, input, replayGrants[0], true);
    }
    return Object.freeze({ jobId, grantId: input.grantId, status: "SCHEDULED", replayed: false });
  }

  function reconcileBeginAttempt(job, attempts, input) {
    if (attempts.length !== 1) throw reviewRequiredError();
    const attempt = attempts[0];
    const status = String(attempt.status || "");
    const transitionVersion = Number(attempt.transition_version);
    const commonProjectionValid = Number(attempt.attempt_number) === 1
      && attempt.provider === "WECHAT"
      && Number.isSafeInteger(transitionVersion)
      && transitionVersion >= 1
      && sameText(attempt.request_digest, input.requestDigest)
      && sameTimestamp(attempt.started_at, input.startedAt, attempt.started_at_wall_time)
      && sameText(attempt.release_id, input.releaseId)
      && Number(attempt.current_transition_number) === transitionVersion
      && sameText(attempt.current_transition_to_status, status)
      && sameText(attempt.current_transition_fence_digest, attempt.transition_fence_digest)
      && sameText(
        attempt.current_transition_provider_receipt_digest,
        attempt.provider_receipt_digest
      )
      && sameText(
        attempt.current_transition_provider_receipt_digest_scheme,
        attempt.provider_receipt_digest_scheme
      )
      && sameText(
        attempt.current_transition_provider_receipt_digest_key_id,
        attempt.provider_receipt_digest_key_id
      )
      && sameText(attempt.current_transition_stable_error_code, attempt.stable_error_code)
      && sameText(attempt.current_transition_release_id, input.releaseId)
      && sameText(job.send_attempt_id, attempt.notification_send_attempt_id)
      && sameText(job.grant_release_id, input.releaseId)
      && validPersistedRecipientBinding(job, "grant_")
      && sameText(job.reserved_job_id, input.jobId);
    if (!commonProjectionValid) throw reviewRequiredError();

    if (status === SEND_ATTEMPT_STATUS.REQUESTED) {
      if (transitionVersion !== 1
        || !sameText(attempt.transition_fence_digest, input.transitionFenceDigest)
        || attempt.completed_at !== null
        || attempt.current_transition_from_status !== null
        || attempt.provider_receipt_digest !== null
        || attempt.provider_receipt_digest_scheme !== null
        || attempt.provider_receipt_digest_key_id !== null
        || attempt.stable_error_code !== null
        || job.status !== "SENDING"
        || job.stable_error_code !== null
        || job.grant_status !== "RESERVED"
        || job.grant_status_reason_code !== null) throw reviewRequiredError();
    } else {
      const projection = terminalProjection(status);
      if (transitionVersion !== 2
        || attempt.completed_at === null
        || attempt.current_transition_from_status !== SEND_ATTEMPT_STATUS.REQUESTED
        || job.status !== projection.jobStatus
        || !sameText(job.stable_error_code, attempt.stable_error_code)
        || job.grant_status !== projection.grantStatus
        || !sameText(job.grant_status_reason_code, attempt.stable_error_code)) {
        throw reviewRequiredError();
      }
    }
    try {
      return publicSendAttempt({
        ...attempt,
        grant_recipient_binding_status: job.grant_recipient_binding_status,
        grant_recipient_wechat_identity_id: job.grant_recipient_wechat_identity_id,
        grant_recipient_app_code: job.grant_recipient_app_code,
        grant_recipient_binding_canonical_version: job.grant_recipient_binding_canonical_version,
        grant_recipient_binding_digest: job.grant_recipient_binding_digest,
        grant_recipient_binding_digest_scheme: job.grant_recipient_binding_digest_scheme,
        grant_recipient_binding_key_id: job.grant_recipient_binding_key_id,
      }, { replayed: true });
    } catch {
      throw reviewRequiredError();
    }
  }

  async function beginSendAttempt(rawInput) {
    const input = normalizeBeginAttempt(rawInput);
    let jobs = rowsFrom(await dbExecute(SELECT_JOB_FOR_ATTEMPT_SQL, [input.jobId]));
    if (jobs.length !== 1) throw reviewRequiredError();
    const job = jobs[0];
    if (!sameText(job.release_id, input.releaseId)
      || !validPersistedRecipientBinding(job, "grant_")) throw reviewRequiredError();
    let attempts = rowsFrom(await dbExecute(SELECT_ATTEMPT_BY_JOB_SQL, [input.jobId]));
    if (attempts.length) return reconcileBeginAttempt(job, attempts, input);
    if (readOnly) throw commitOutcomeUnknownError();
    if (job.status !== "SCHEDULED"
      || job.grant_status !== "AVAILABLE"
      || !sameText(job.reserved_job_id, input.jobId)
      || job.grant_status_reason_code !== null
      || !sameText(job.grant_release_id, input.releaseId)) throw reviewRequiredError();
    const attemptId = randomId("nsp", randomBytes);
    const transitionId = randomId("nst", randomBytes);
    try {
      await dbExecute(INSERT_ATTEMPT_SQL, [
        attemptId,
        input.jobId,
        input.transitionFenceDigest,
        input.requestDigest,
        mysqlTimestamp(input.startedAt),
        input.releaseId,
      ]);
      await dbExecute(INSERT_TRANSITION_SQL, [
        transitionId,
        attemptId,
        1,
        null,
        SEND_ATTEMPT_STATUS.REQUESTED,
        input.transitionFenceDigest,
        null,
        null,
        null,
        null,
        input.releaseId,
      ]);
      if (affectedRowsFrom(await dbExecute(ACTIVATE_ATTEMPT_JOB_SQL, [attemptId, input.jobId])) !== 1) {
        throw reviewRequiredError();
      }
      if (affectedRowsFrom(await dbExecute(RESERVE_ATTEMPT_GRANT_SQL, [
        job.notification_subscription_grant_id,
        input.jobId,
      ])) !== 1) throw reviewRequiredError();
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      jobs = rowsFrom(await dbExecute(SELECT_JOB_FOR_ATTEMPT_SQL, [input.jobId]));
      attempts = rowsFrom(await dbExecute(SELECT_ATTEMPT_BY_JOB_SQL, [input.jobId]));
      if (jobs.length !== 1) throw reviewRequiredError();
      return reconcileBeginAttempt(jobs[0], attempts, input);
    }
    return publicSendAttempt({
      notification_send_attempt_id: attemptId,
      notification_job_id: input.jobId,
      attempt_number: 1,
      provider: "WECHAT",
      status: SEND_ATTEMPT_STATUS.REQUESTED,
      transition_version: 1,
      transition_fence_digest: input.transitionFenceDigest,
      request_digest: input.requestDigest,
      provider_call_state: "AVAILABLE",
      provider_call_owner: null,
      provider_call_lease_expires_at: null,
      provider_call_generation: 0,
      provider_call_started_at: null,
      provider_receipt_digest: null,
      provider_receipt_digest_scheme: null,
      provider_receipt_digest_key_id: null,
      stable_error_code: null,
      release_id: input.releaseId,
      grant_recipient_binding_status: job.grant_recipient_binding_status,
      grant_recipient_wechat_identity_id: job.grant_recipient_wechat_identity_id,
      grant_recipient_app_code: job.grant_recipient_app_code,
      grant_recipient_binding_canonical_version: job.grant_recipient_binding_canonical_version,
      grant_recipient_binding_digest: job.grant_recipient_binding_digest,
      grant_recipient_binding_digest_scheme: job.grant_recipient_binding_digest_scheme,
      grant_recipient_binding_key_id: job.grant_recipient_binding_key_id,
    }, { replayed: false });
  }

  async function claimProviderCall(rawInput) {
    const input = normalizeClaimProviderCall(rawInput);
    let rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1 || !providerCallProjectionValid(rows[0], input)) {
      throw reviewRequiredError();
    }
    let row = rows[0];
    if (row.provider_call_state === "LEASED"
      && sameText(row.provider_call_owner, input.leaseOwner)) {
      return publicProviderCallClaim(row, input, true, true);
    }
    if (!["AVAILABLE", "LEASED"].includes(row.provider_call_state)) {
      return publicProviderCallClaim(row, input, false, true);
    }
    if (readOnly) throw commitOutcomeUnknownError();
    const claimed = await dbExecute(CLAIM_PROVIDER_CALL_SQL, [
      input.leaseOwner,
      input.leaseDurationMicros,
      input.attemptId,
      input.releaseId,
    ]);
    rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1 || !providerCallProjectionValid(rows[0], input)) {
      throw reviewRequiredError();
    }
    row = rows[0];
    if (affectedRowsFrom(claimed) !== 1) {
      return publicProviderCallClaim(row, input, false, true);
    }
    return publicProviderCallClaim(row, input, true, false);
  }

  async function startProviderCall(rawInput) {
    const input = normalizeStartProviderCall(rawInput);
    let rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1 || !providerCallProjectionValid(rows[0], input)) {
      throw reviewRequiredError();
    }
    let row = rows[0];
    if (row.provider_call_state === "STARTED"
      && sameText(row.provider_call_owner, input.leaseOwner)
      && Number(row.provider_call_generation) === input.leaseGeneration) {
      if (!sameCurrentRecipientIdentity(row, input)) {
        return Object.freeze({
          attemptId: input.attemptId,
          providerCallStarted: false,
          currentRecipientIdentityFenced: true,
          fenced: true,
        });
      }
      return readOnly
        ? publicProviderCallStart(row, input, true)
        : publicProviderCallAlreadyStarted(row, input);
    }
    if (row.provider_call_state !== "LEASED"
      || !sameText(row.provider_call_owner, input.leaseOwner)
      || Number(row.provider_call_generation) !== input.leaseGeneration
      || !sameText(row.request_digest, input.requestDigest)
      || !sameText(row.grant_recipient_binding_digest, input.recipientBindingDigest)
      || !sameText(row.grant_recipient_wechat_identity_id, input.recipientWechatIdentityId)
      || !sameText(row.grant_root_user_id, input.recipientRootUserId)
      || !sameText(row.grant_recipient_app_code, input.recipientAppCode)
      || !sameCurrentRecipientIdentity(row, input)) {
      return Object.freeze({
        attemptId: input.attemptId,
        providerCallStarted: false,
        fenced: true,
      });
    }
    if (readOnly) throw commitOutcomeUnknownError();
    const started = await dbExecute(START_PROVIDER_CALL_SQL, [
      input.attemptId,
      input.leaseOwner,
      input.leaseGeneration,
      input.requestDigest,
      input.releaseId,
      input.releaseId,
      input.releaseId,
      input.recipientBindingDigest,
      input.recipientWechatIdentityId,
      input.recipientRootUserId,
      input.recipientAppCode,
      input.recipientOpenid,
    ]);
    rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1 || !providerCallProjectionValid(rows[0], input)) {
      throw reviewRequiredError();
    }
    row = rows[0];
    if (affectedRowsFrom(started) !== 1 || !sameCurrentRecipientIdentity(row, input)) {
      return Object.freeze({
        attemptId: input.attemptId,
        providerCallStarted: false,
        fenced: true,
      });
    }
    return publicProviderCallStart(row, input, false);
  }

  function terminalProjection(outcome) {
    if (outcome === SEND_ATTEMPT_STATUS.ACCEPTED) {
      return { jobStatus: "PROVIDER_ACCEPTED", grantStatus: "CONSUMED" };
    }
    if (outcome === SEND_ATTEMPT_STATUS.REJECTED) {
      return { jobStatus: "FAILED", grantStatus: "INVALID" };
    }
    if (outcome === SEND_ATTEMPT_STATUS.UNKNOWN) {
      return { jobStatus: "OUTCOME_UNKNOWN", grantStatus: "REVIEW_REQUIRED" };
    }
    return { jobStatus: "FAILED", grantStatus: "REVIEW_REQUIRED" };
  }

  function sameTerminal(row, input) {
    const projection = terminalProjection(input.outcome);
    return sameText(row.status, input.outcome)
      && Number(row.transition_version) === input.expectedTransitionVersion + 1
      && sameText(row.transition_fence_digest, input.nextTransitionFenceDigest)
      && sameText(row.provider_receipt_digest, input.providerReceiptDigest)
      && sameText(row.provider_receipt_digest_scheme, input.providerReceiptDigestScheme)
      && sameText(row.provider_receipt_digest_key_id, input.providerReceiptDigestKeyId)
      && sameText(row.stable_error_code, input.stableErrorCode)
      && row.provider_call_state === "COMPLETED"
      && sameText(row.provider_call_owner, input.leaseOwner)
      && Number(row.provider_call_generation) === input.leaseGeneration
      && sameTimestamp(row.completed_at, input.completedAt, row.completed_at_wall_time)
      && Number(row.current_transition_number) === input.expectedTransitionVersion + 1
      && sameText(row.current_transition_from_status, SEND_ATTEMPT_STATUS.REQUESTED)
      && sameText(row.current_transition_to_status, input.outcome)
      && sameText(row.current_transition_fence_digest, input.nextTransitionFenceDigest)
      && sameText(row.current_transition_provider_receipt_digest, input.providerReceiptDigest)
      && sameText(row.current_transition_provider_receipt_digest_scheme, input.providerReceiptDigestScheme)
      && sameText(row.current_transition_provider_receipt_digest_key_id, input.providerReceiptDigestKeyId)
      && sameText(row.current_transition_stable_error_code, input.stableErrorCode)
      && sameText(row.current_transition_release_id, input.releaseId)
      && sameText(row.job_send_attempt_id, row.notification_send_attempt_id)
      && sameText(row.job_release_id, input.releaseId)
      && sameText(row.job_status, projection.jobStatus)
      && sameText(row.job_stable_error_code, input.stableErrorCode)
      && sameText(row.grant_reserved_job_id, row.notification_job_id)
      && sameText(row.grant_release_id, input.releaseId)
      && validPersistedRecipientBinding(row, "grant_")
      && sameText(row.grant_status, projection.grantStatus)
      && sameText(row.grant_status_reason_code, input.stableErrorCode)
      && sameText(row.release_id, input.releaseId);
  }

  async function inspectSendAttempt(rawInput) {
    const input = normalizeInspectSendAttempt(rawInput);
    const rows = rowsFrom(await dbExecute(INSPECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1) throw reviewRequiredError();
    const row = rows[0];
    const status = String(row.status || "");
    const transitionVersion = Number(row.transition_version);
    if (!sameText(row.notification_send_attempt_id, input.attemptId)
      || !sameText(row.release_id, input.releaseId)
      || !Number.isSafeInteger(transitionVersion)
      || transitionVersion < 1
      || Number(row.current_transition_number) !== transitionVersion
      || !sameText(row.current_transition_to_status, status)
      || !sameText(row.current_transition_fence_digest, row.transition_fence_digest)
      || !sameText(
        row.current_transition_provider_receipt_digest,
        row.provider_receipt_digest
      )
      || !sameText(
        row.current_transition_provider_receipt_digest_scheme,
        row.provider_receipt_digest_scheme
      )
      || !sameText(
        row.current_transition_provider_receipt_digest_key_id,
        row.provider_receipt_digest_key_id
      )
      || !sameText(row.current_transition_stable_error_code, row.stable_error_code)
      || !sameText(row.current_transition_release_id, input.releaseId)
      || !sameText(row.job_send_attempt_id, row.notification_send_attempt_id)
      || !sameText(row.job_release_id, input.releaseId)
      || !sameText(row.grant_reserved_job_id, row.notification_job_id)
      || !sameText(row.grant_release_id, input.releaseId)) throw reviewRequiredError();
    if (!validPersistedRecipientBinding(row, "grant_")) throw reviewRequiredError();

    if (status === SEND_ATTEMPT_STATUS.REQUESTED) {
      if (transitionVersion !== 1
        || row.completed_at !== null
        || row.current_transition_from_status !== null
        || row.job_status !== "SENDING"
        || row.job_stable_error_code !== null
        || row.grant_status !== "RESERVED"
        || row.grant_status_reason_code !== null) throw reviewRequiredError();
    } else {
      const projection = terminalProjection(status);
      if (transitionVersion !== 2
        || row.completed_at === null
        || row.current_transition_from_status !== SEND_ATTEMPT_STATUS.REQUESTED
        || row.job_status !== projection.jobStatus
        || !sameText(row.job_stable_error_code, row.stable_error_code)
        || row.grant_status !== projection.grantStatus
        || !sameText(row.grant_status_reason_code, row.stable_error_code)) {
        throw reviewRequiredError();
      }
    }
    try {
      return publicSendAttempt(row, { replayed: true });
    } catch {
      throw reviewRequiredError();
    }
  }

  async function completeSendAttempt(rawInput) {
    const input = normalizeCompleteAttempt(rawInput);
    const rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1) throw readOnly ? commitOutcomeUnknownError() : reviewRequiredError();
    const row = rows[0];
    if (!sameText(row.release_id, input.releaseId)) throw reviewRequiredError();
    if (row.status !== SEND_ATTEMPT_STATUS.REQUESTED) {
      if (!sameTerminal(row, input)) throw reviewRequiredError();
      return publicSendAttempt(row, { replayed: true });
    }
    if (Number(row.transition_version) !== input.expectedTransitionVersion
      || !sameText(row.transition_fence_digest, input.expectedTransitionFenceDigest)
      || Number(row.current_transition_number) !== input.expectedTransitionVersion
      || row.current_transition_from_status !== null
      || row.current_transition_to_status !== SEND_ATTEMPT_STATUS.REQUESTED
      || !sameText(row.current_transition_fence_digest, input.expectedTransitionFenceDigest)
      || row.current_transition_provider_receipt_digest !== null
      || row.current_transition_provider_receipt_digest_scheme !== null
      || row.current_transition_provider_receipt_digest_key_id !== null
      || row.current_transition_stable_error_code !== null
      || !sameText(row.current_transition_release_id, input.releaseId)
      || !sameText(row.job_send_attempt_id, row.notification_send_attempt_id)
      || !sameText(row.job_release_id, input.releaseId)
      || row.job_status !== "SENDING"
      || row.job_stable_error_code !== null
      || !sameText(row.grant_reserved_job_id, row.notification_job_id)
      || !sameText(row.grant_release_id, input.releaseId)
      || !validPersistedRecipientBinding(row, "grant_")
      || row.grant_status_reason_code !== null
      || row.grant_status !== "RESERVED"
      || row.provider_call_state !== "STARTED"
      || !sameText(row.provider_call_owner, input.leaseOwner)
      || Number(row.provider_call_generation) !== input.leaseGeneration) throw reviewRequiredError();
    if (readOnly) throw commitOutcomeUnknownError();
    const projection = terminalProjection(input.outcome);
    const transitionId = randomId("nst", randomBytes);
    try {
      const completed = await dbExecute(COMPLETE_ATTEMPT_SQL, [
        input.outcome,
        input.nextTransitionFenceDigest,
        input.providerReceiptDigest,
        input.providerReceiptDigestScheme,
        input.providerReceiptDigestKeyId,
        input.stableErrorCode,
        mysqlTimestamp(input.completedAt),
        input.attemptId,
        input.expectedTransitionVersion,
        input.expectedTransitionFenceDigest,
        input.leaseOwner,
        input.leaseGeneration,
        input.releaseId,
      ]);
      if (affectedRowsFrom(completed) !== 1) throw reviewRequiredError();
      await dbExecute(INSERT_TRANSITION_SQL, [
        transitionId,
        input.attemptId,
        input.expectedTransitionVersion + 1,
        SEND_ATTEMPT_STATUS.REQUESTED,
        input.outcome,
        input.nextTransitionFenceDigest,
        input.providerReceiptDigest,
        input.providerReceiptDigestScheme,
        input.providerReceiptDigestKeyId,
        input.stableErrorCode,
        input.releaseId,
      ]);
      if (affectedRowsFrom(await dbExecute(COMPLETE_JOB_SQL, [
        projection.jobStatus,
        input.stableErrorCode,
        row.notification_job_id,
        input.attemptId,
      ])) !== 1) throw reviewRequiredError();
      const grantResult = await dbExecute(COMPLETE_GRANT_SQL, [
        projection.grantStatus,
        input.stableErrorCode,
        projection.grantStatus,
        projection.grantStatus,
        projection.grantStatus,
        row.notification_subscription_grant_id,
      ]);
      if (affectedRowsFrom(grantResult) !== 1) throw reviewRequiredError();
    } catch (error) {
      if (duplicateKey(error)) throw reviewRequiredError();
      throw error;
    }
    return publicSendAttempt({
      ...row,
      status: input.outcome,
      transition_version: input.expectedTransitionVersion + 1,
      transition_fence_digest: input.nextTransitionFenceDigest,
      provider_receipt_digest: input.providerReceiptDigest,
      provider_receipt_digest_scheme: input.providerReceiptDigestScheme,
      provider_receipt_digest_key_id: input.providerReceiptDigestKeyId,
      stable_error_code: input.stableErrorCode,
      provider_call_state: "COMPLETED",
    }, { replayed: false });
  }

  async function recoverProviderCall(rawInput) {
    const input = normalizeRecoverProviderCall(rawInput);
    let rows = rowsFrom(await dbExecute(SELECT_ATTEMPT_SQL, [input.attemptId]));
    if (rows.length !== 1) throw readOnly ? commitOutcomeUnknownError() : reviewRequiredError();
    let row = rows[0];
    if (!sameText(row.release_id, input.releaseId)) throw reviewRequiredError();
    if (row.status !== SEND_ATTEMPT_STATUS.REQUESTED) {
      if (row.status !== SEND_ATTEMPT_STATUS.UNKNOWN
        || row.provider_call_state !== "COMPLETED"
        || !sameText(row.transition_fence_digest, input.recoveryFenceDigest)
        || row.stable_error_code !== "PROVIDER_RESULT_UNKNOWN") throw reviewRequiredError();
      return Object.freeze({
        ...publicSendAttempt(row, { replayed: true }),
        providerCallRecoveredUnknown: true,
      });
    }
    if (!providerCallProjectionValid(row, input)) throw reviewRequiredError();
    if (row.provider_call_state !== "STARTED") {
      return Object.freeze({
        ...publicSendAttempt(row, { replayed: true }),
        providerCallRecoveredUnknown: false,
      });
    }
    if (readOnly) throw commitOutcomeUnknownError();
    const transitionId = randomId("nst", randomBytes);
    const recovered = await dbExecute(RECOVER_PROVIDER_CALL_SQL, [
      input.recoveryFenceDigest,
      input.attemptId,
      Number(row.transition_version),
      row.transition_fence_digest,
      input.releaseId,
    ]);
    if (affectedRowsFrom(recovered) !== 1) {
      return Object.freeze({
        ...publicSendAttempt(row, { replayed: true }),
        providerCallRecoveredUnknown: false,
      });
    }
    await dbExecute(INSERT_TRANSITION_SQL, [
      transitionId,
      input.attemptId,
      Number(row.transition_version) + 1,
      SEND_ATTEMPT_STATUS.REQUESTED,
      SEND_ATTEMPT_STATUS.UNKNOWN,
      input.recoveryFenceDigest,
      null,
      null,
      null,
      "PROVIDER_RESULT_UNKNOWN",
      input.releaseId,
    ]);
    if (affectedRowsFrom(await dbExecute(COMPLETE_JOB_SQL, [
      "OUTCOME_UNKNOWN",
      "PROVIDER_RESULT_UNKNOWN",
      row.notification_job_id,
      input.attemptId,
    ])) !== 1) throw reviewRequiredError();
    if (affectedRowsFrom(await dbExecute(COMPLETE_GRANT_SQL, [
      "REVIEW_REQUIRED",
      "PROVIDER_RESULT_UNKNOWN",
      "REVIEW_REQUIRED",
      "REVIEW_REQUIRED",
      "REVIEW_REQUIRED",
      row.notification_subscription_grant_id,
    ])) !== 1) throw reviewRequiredError();
    return Object.freeze({
      ...publicSendAttempt({
        ...row,
        status: SEND_ATTEMPT_STATUS.UNKNOWN,
        transition_version: Number(row.transition_version) + 1,
        transition_fence_digest: input.recoveryFenceDigest,
        provider_call_state: "COMPLETED",
        provider_receipt_digest: null,
        provider_receipt_digest_scheme: null,
        provider_receipt_digest_key_id: null,
        stable_error_code: "PROVIDER_RESULT_UNKNOWN",
      }, { replayed: false }),
      providerCallRecoveredUnknown: true,
    });
  }

  function discard() {
    active = false;
  }

  return Object.freeze({
    assertReady,
    recordDecision,
    schedule,
    beginSendAttempt,
    claimProviderCall,
    startProviderCall,
    inspectSendAttempt,
    completeSendAttempt,
    recoverProviderCall,
    discard,
  });
}

const CORE_COMPLETE_INPUT_KEYS = Object.freeze([
  "attemptId",
  "leaseOwner",
  "leaseGeneration",
  "expectedTransitionVersion",
  "expectedTransitionFenceDigest",
  "nextTransitionFenceDigest",
  "outcome",
  "providerReceipt",
  "stableErrorCode",
  "completedAt",
  "releaseId",
]);

const CORE_CLAIM_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
  "attemptId",
  "releaseId",
]);

const CORE_START_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
  "attemptId",
  "leaseOwner",
  "leaseGeneration",
  "requestDigest",
  "recipientBindingDigest",
  "recipientWechatIdentityId",
  "recipientRootUserId",
  "recipientAppCode",
  "recipientOpenid",
  "releaseId",
]);

const CORE_RECOVER_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
  "attemptId",
  "releaseId",
]);

const CORE_SCHEDULE_INPUT_KEYS = Object.freeze([
  "grantId",
  "rootUserId",
  "taskId",
  "taskOccurrenceDate",
  "templateVersion",
  "dueAt",
  "idempotencyKey",
  "releaseId",
]);
const SCHEDULE_REQUEST_DIGEST_DOMAIN = "myroot:notification:schedule-request:v1";
const RECOVERY_FENCE_DIGEST_DOMAIN = "myroot:notification:provider-recovery-fence:v1";

function exactInputKeys(value, expected) {
  return plainRecord(value)
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function providerCallLeaseMs(env) {
  const configured = env[PROVIDER_CALL_LEASE_MS_FLAG];
  if (configured === undefined || configured === null || configured === "") {
    return DEFAULT_PROVIDER_CALL_LEASE_MS;
  }
  if (!/^\d+$/.test(String(configured))) throw persistenceError();
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw persistenceError();
  }
  return value;
}

function deriveLengthFramedDigest(values) {
  const hash = crypto.createHash("sha256");
  for (const value of values) {
    if (typeof value !== "string") throw persistenceError();
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function deriveScheduleRequestDigest(input) {
  return deriveLengthFramedDigest([
    SCHEDULE_REQUEST_DIGEST_DOMAIN,
    input.grantId,
    input.rootUserId,
    input.taskId,
    input.taskOccurrenceDate,
    input.templateVersion,
    input.dueAt,
    input.idempotencyKey,
    input.releaseId,
  ]);
}

function deriveRecoveryFenceDigest(input) {
  return deriveLengthFramedDigest([
    RECOVERY_FENCE_DIGEST_DOMAIN,
    input.attemptId,
    input.releaseId,
  ]);
}

function publicCoreResult(result, recovered) {
  return Object.freeze({
    ...result,
    commitAcknowledgementRecovered: recovered,
    transactionState: recovered ? "ACKNOWLEDGEMENT_RECOVERED" : "COMMITTED",
  });
}

function createMysqlNotificationDeliveryCore(pool, options = {}) {
  if (!pool || typeof pool.getConnection !== "function"
    || !plainRecord(options)) throw persistenceError();
  const hasRandomBytesOverride = Object.prototype.hasOwnProperty.call(options, "randomBytes");
  if (Object.keys(options).some((key) => !["env", "randomBytes"].includes(key))
    || (hasRandomBytesOverride && !TEST_RANDOM_BYTES_INJECTION_ALLOWED)
    || (hasRandomBytesOverride && typeof options.randomBytes !== "function")) throw persistenceError();
  const env = options.env === undefined ? process.env : options.env;
  if (!plainRecord(env)) throw persistenceError();
  const randomBytes = hasRandomBytesOverride ? options.randomBytes : crypto.randomBytes;
  let receiptDigestCodec = null;
  let receiptDigestStatus = null;
  let configuredProviderCallLeaseMs = null;

  function loadReceiptDigestCodec() {
    if (!receiptDigestCodec) receiptDigestCodec = createProviderReceiptDigestCodec({ env });
    if (typeof receiptDigestCodec.digest !== "function"
      || typeof receiptDigestCodec.getStatus !== "function") throw persistenceError();
    if (!receiptDigestStatus) receiptDigestStatus = receiptDigestCodec.getStatus();
    if (!receiptDigestStatus
      || receiptDigestStatus.ready !== true
      || receiptDigestStatus.provider !== "WECHAT"
      || receiptDigestStatus.digestScheme !== "hmac-sha256:v1") throw persistenceError();
    return receiptDigestCodec;
  }

  function assertReady() {
    if (env[ENABLE_FLAG] !== "true") throw disabledError();
    loadReceiptDigestCodec();
    if (configuredProviderCallLeaseMs === null) {
      configuredProviderCallLeaseMs = providerCallLeaseMs(env);
    }
    return Object.freeze({
      enabled: true,
      provider: "WECHAT",
      networkEnabled: false,
      ownsTransactions: true,
      sessionTimeZone: "+08:00",
      receiptDigestScheme: receiptDigestStatus.digestScheme,
      receiptDigestKeyId: receiptDigestStatus.keyId,
      providerCallLeaseMs: configuredProviderCallLeaseMs,
    });
  }

  async function rollbackQuietly(connection) {
    if (!connection || typeof connection.rollback !== "function") return false;
    try {
      await connection.rollback();
      return true;
    } catch {
      return false;
    }
  }

  function releaseQuietly(connection) {
    if (!connection || typeof connection.release !== "function") return;
    try { connection.release(); } catch { retireQuietly(connection); }
  }

  function retireQuietly(connection) {
    if (!connection || typeof connection.destroy !== "function") return;
    try { connection.destroy(); } catch {}
  }

  async function openConnection(options = {}) {
    assertReady();
    let connection;
    try {
      connection = await pool.getConnection();
      if (!connection
        || typeof connection.execute !== "function"
        || typeof connection.query !== "function"
        || typeof connection.beginTransaction !== "function"
        || typeof connection.commit !== "function"
        || typeof connection.rollback !== "function"
        || typeof connection.destroy !== "function"
        || typeof connection.release !== "function") throw persistenceError();
      await connection.query("SET SESSION time_zone = '+08:00'");
      if (options.readOnly === true) await connection.query("SET TRANSACTION READ ONLY");
      await connection.beginTransaction();
      return connection;
    } catch {
      retireQuietly(connection);
      throw persistenceError();
    }
  }

  async function inspectAuthoritative(input) {
    let connection;
    try {
      connection = await openConnection({ readOnly: true });
    } catch {
      throw persistenceError();
    }
    const adapter = createTransactionAdapter(connection, {
      authority: CORE_AUTHORITY,
      env,
      randomBytes,
      readOnly: true,
    });
    let result;
    try {
      result = await adapter.inspectSendAttempt(input);
    } catch (error) {
      const rollbackSucceeded = await rollbackQuietly(connection);
      adapter.discard();
      if (rollbackSucceeded) releaseQuietly(connection);
      else retireQuietly(connection);
      throw error;
    }
    if (!(await rollbackQuietly(connection))) {
      adapter.discard();
      retireQuietly(connection);
      throw persistenceError();
    }
    adapter.discard();
    releaseQuietly(connection);
    return Object.freeze({
      ...result,
      inspected: true,
      transactionState: "READ_ONLY_ROLLBACK",
    });
  }

  async function authoritativeReadback(operation, input) {
    let connection;
    try {
      connection = await openConnection();
    } catch {
      throw commitOutcomeUnknownError();
    }
    const adapter = createTransactionAdapter(connection, {
      authority: CORE_AUTHORITY,
      env,
      randomBytes,
      readOnly: true,
    });
    let result;
    try {
      result = await adapter[operation](input);
    } catch (error) {
      const rollbackSucceeded = await rollbackQuietly(connection);
      adapter.discard();
      if (rollbackSucceeded) releaseQuietly(connection);
      else retireQuietly(connection);
      if (error && error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED") throw error;
      throw commitOutcomeUnknownError();
    }
    if (!(await rollbackQuietly(connection))) {
      adapter.discard();
      retireQuietly(connection);
      throw commitOutcomeUnknownError();
    }
    adapter.discard();
    releaseQuietly(connection);
    return publicCoreResult(result, true);
  }

  async function execute(operation, input) {
    assertReady();
    let connection;
    try {
      connection = await openConnection();
    } catch {
      throw persistenceError();
    }
    const adapter = createTransactionAdapter(connection, {
      authority: CORE_AUTHORITY,
      env,
      randomBytes,
      readOnly: false,
    });
    let result;
    try {
      result = await adapter[operation](input);
    } catch (error) {
      adapter.discard();
      if (await rollbackQuietly(connection)) {
        releaseQuietly(connection);
        throw error;
      }
      retireQuietly(connection);
      if (operation === "startProviderCall") throw commitOutcomeUnknownError();
      return authoritativeReadback(operation, input);
    }
    try {
      await connection.commit();
    } catch {
      adapter.discard();
      retireQuietly(connection);
      if (operation === "startProviderCall"
        && (!result
          || result.providerCallStarted !== true
          || result.replayed !== false)) throw commitOutcomeUnknownError();
      return authoritativeReadback(operation, input);
    }
    adapter.discard();
    releaseQuietly(connection);
    return publicCoreResult(result, false);
  }

  function recordDecision(input) {
    try {
      assertReady();
      return execute("recordDecision", normalizeDecision(input));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function schedule(input) {
    assertReady();
    if (!exactInputKeys(input, CORE_SCHEDULE_INPUT_KEYS)) {
      throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
    }
    const normalized = normalizeSchedule({
      ...input,
      requestDigest: "0".repeat(64),
    });
    return execute("schedule", {
      ...normalized,
      requestDigest: deriveScheduleRequestDigest(normalized),
    });
  }

  function beginSendAttempt(input) {
    try {
      assertReady();
      return execute("beginSendAttempt", normalizeBeginAttempt(input));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function claimProviderCall(input) {
    try {
      assertReady();
      if (!exactInputKeys(input, CORE_CLAIM_PROVIDER_CALL_INPUT_KEYS)) {
        throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
      }
      const normalized = normalizeClaimProviderCall({
        ...input,
        leaseOwner: randomId("npc", randomBytes),
        leaseDurationMicros: configuredProviderCallLeaseMs * 1_000,
      });
      return execute("claimProviderCall", normalized);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function startProviderCall(input) {
    try {
      assertReady();
      if (!exactInputKeys(input, CORE_START_PROVIDER_CALL_INPUT_KEYS)) {
        throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
      }
      return execute("startProviderCall", normalizeStartProviderCall(input));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function inspectSendAttempt(input) {
    try {
      assertReady();
      return inspectAuthoritative(normalizeInspectSendAttempt(input));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function completeSendAttempt(input) {
    assertReady();
    if (!exactInputKeys(input, CORE_COMPLETE_INPUT_KEYS)) throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
    let providerReceiptDigest = null;
    let providerReceiptDigestScheme = null;
    let providerReceiptDigestKeyId = null;
    if (input.outcome === SEND_ATTEMPT_STATUS.ACCEPTED) {
      const receiptEvidence = loadReceiptDigestCodec().digest("WECHAT", input.providerReceipt);
      providerReceiptDigest = receiptEvidence.digest;
      providerReceiptDigestScheme = receiptEvidence.digestScheme;
      providerReceiptDigestKeyId = receiptEvidence.keyId;
    } else if (input.providerReceipt !== null) {
      throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
    }
    const internalInput = normalizeCompleteAttempt({
      attemptId: input.attemptId,
      leaseOwner: input.leaseOwner,
      leaseGeneration: input.leaseGeneration,
      expectedTransitionVersion: input.expectedTransitionVersion,
      expectedTransitionFenceDigest: input.expectedTransitionFenceDigest,
      nextTransitionFenceDigest: input.nextTransitionFenceDigest,
      outcome: input.outcome,
      providerReceiptDigest,
      providerReceiptDigestScheme,
      providerReceiptDigestKeyId,
      stableErrorCode: input.stableErrorCode,
      completedAt: input.completedAt,
      releaseId: input.releaseId,
    });
    return execute("completeSendAttempt", internalInput);
  }

  function recoverProviderCall(input) {
    try {
      assertReady();
      if (!exactInputKeys(input, CORE_RECOVER_PROVIDER_CALL_INPUT_KEYS)) {
        throw foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
      }
      const normalized = normalizeRecoverProviderCall({
        ...input,
        recoveryFenceDigest: "0".repeat(64),
      });
      return execute("recoverProviderCall", Object.freeze({
        ...normalized,
        recoveryFenceDigest: deriveRecoveryFenceDigest(normalized),
      }));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return Object.freeze({
    assertReady,
    recordDecision,
    schedule,
    beginSendAttempt,
    claimProviderCall,
    startProviderCall,
    inspectSendAttempt,
    completeSendAttempt,
    recoverProviderCall,
  });
}

module.exports = {
  createMysqlNotificationDeliveryCore,
};
