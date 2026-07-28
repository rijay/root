const crypto = require("node:crypto");

const NATIVE_DECISION_STATUS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  PLATFORM_DISABLED: "PLATFORM_DISABLED",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
});

const PROVIDER_OUTCOME_STATUS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
});

const SEND_ATTEMPT_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  ...PROVIDER_OUTCOME_STATUS,
});
const TERMINAL_SEND_ATTEMPT_STATUSES = Object.freeze([
  ...Object.values(PROVIDER_OUTCOME_STATUS),
]);

const NATIVE_DECISION_REASON_CODES = Object.freeze({
  ACCEPTED: Object.freeze([null]),
  REJECTED: Object.freeze(["USER_REJECTED"]),
  PLATFORM_DISABLED: Object.freeze(["PLATFORM_DISABLED"]),
  OUTCOME_UNKNOWN: Object.freeze(["OUTCOME_UNKNOWN"]),
});

const PROVIDER_OUTCOME_ERROR_CODES = Object.freeze({
  ACCEPTED: Object.freeze([null]),
  REJECTED: Object.freeze(["WECHAT_NO_GRANT", "WECHAT_REJECTED", "PROVIDER_CONFIRMED_NOT_SENT"]),
  FAILED: Object.freeze([
    "SEND_FAILED",
    "WECHAT_SEND_FAILED",
    "PROVIDER_REQUEST_INVALID",
  ]),
  UNKNOWN: Object.freeze([
    "PROVIDER_RESULT_UNKNOWN",
    "HTTP_OUTCOME_UNKNOWN",
    "NETWORK_OUTCOME_UNKNOWN",
    "NON_JSON_OUTCOME_UNKNOWN",
  ]),
});

const PROVIDER_RECEIPT_DIGEST_SCHEME = "hmac-sha256:v1";
const PROVIDER_RECEIPT_DIGEST_PURPOSE = "myroot:notification:provider-receipt:wechat:v1";

const DECISION_INPUT_KEYS = Object.freeze([
  "rootUserId",
  "taskId",
  "taskOccurrenceDate",
  "templateVersion",
  "grantRequestId",
  "nativeDecision",
  "reasonCode",
  "idempotencyKey",
  "decidedAt",
  "releaseId",
  "recipientWechatIdentityId",
  "recipientAppCode",
  "recipientBindingCanonicalVersion",
  "recipientBindingDigest",
  "recipientBindingDigestScheme",
  "recipientBindingKeyId",
]);

const SCHEDULE_INPUT_KEYS = Object.freeze([
  "grantId",
  "rootUserId",
  "taskId",
  "taskOccurrenceDate",
  "templateVersion",
  "dueAt",
  "idempotencyKey",
  "requestDigest",
  "releaseId",
]);

const BEGIN_ATTEMPT_INPUT_KEYS = Object.freeze([
  "jobId",
  "requestDigest",
  "transitionFenceDigest",
  "startedAt",
  "releaseId",
]);

const CLAIM_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
  "attemptId",
  "leaseOwner",
  "leaseDurationMicros",
  "releaseId",
]);

const START_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
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

const RECOVER_PROVIDER_CALL_INPUT_KEYS = Object.freeze([
  "attemptId",
  "recoveryFenceDigest",
  "releaseId",
]);

const INSPECT_ATTEMPT_INPUT_KEYS = Object.freeze([
  "attemptId",
  "releaseId",
]);

const COMPLETE_ATTEMPT_INPUT_KEYS = Object.freeze([
  "attemptId",
  "leaseOwner",
  "leaseGeneration",
  "expectedTransitionVersion",
  "expectedTransitionFenceDigest",
  "nextTransitionFenceDigest",
  "outcome",
  "providerReceiptDigest",
  "providerReceiptDigestScheme",
  "providerReceiptDigestKeyId",
  "stableErrorCode",
  "completedAt",
  "releaseId",
]);

function foundationError(code) {
  const error = new Error("notification delivery uniqueness operation failed");
  error.code = code;
  return error;
}

function inputError() {
  return foundationError("NOTIFICATION_DELIVERY_INPUT_INVALID");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expectedKeys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactText(value, maximumLength, expression = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && expression.test(value);
}

function nullableExactText(value, maximumLength) {
  return value === null || exactText(value, maximumLength);
}

function allowedCode(code, allowlist) {
  return allowlist.some((candidate) => candidate === code);
}

function sha256Digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizeDecision(input) {
  if (!exactKeys(input, DECISION_INPUT_KEYS)
    || !exactText(input.rootUserId, 32)
    || !exactText(input.taskId, 64)
    || !isoDate(input.taskOccurrenceDate)
    || !exactText(input.templateVersion, 32)
    || !exactText(input.grantRequestId, 96)
    || !Object.hasOwn(NATIVE_DECISION_STATUS, input.nativeDecision)
    || !allowedCode(input.reasonCode, NATIVE_DECISION_REASON_CODES[input.nativeDecision] || [])
    || !exactText(input.idempotencyKey, 160)
    || !isoTimestamp(input.decidedAt)
    || !exactText(input.releaseId, 64)) throw inputError();
  const recipientValues = [
    input.recipientWechatIdentityId,
    input.recipientAppCode,
    input.recipientBindingCanonicalVersion,
    input.recipientBindingDigest,
    input.recipientBindingDigestScheme,
    input.recipientBindingKeyId,
  ];
  if (input.nativeDecision === NATIVE_DECISION_STATUS.ACCEPTED) {
    if (!exactText(input.recipientWechatIdentityId, 32)
      || input.recipientAppCode !== "MYROOT"
      || input.recipientBindingCanonicalVersion !== "canonical-json:v1"
      || !sha256Digest(input.recipientBindingDigest)
      || input.recipientBindingDigestScheme !== "hmac-sha256:v1"
      || !exactText(input.recipientBindingKeyId, 128)) throw inputError();
  } else if (recipientValues.some((value) => value !== null)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeSchedule(input) {
  if (!exactKeys(input, SCHEDULE_INPUT_KEYS)
    || !exactText(input.grantId, 32)
    || !exactText(input.rootUserId, 32)
    || !exactText(input.taskId, 64)
    || !isoDate(input.taskOccurrenceDate)
    || !exactText(input.templateVersion, 32)
    || !isoTimestamp(input.dueAt)
    || !exactText(input.idempotencyKey, 191)
    || !sha256Digest(input.requestDigest)
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeBeginAttempt(input) {
  if (!exactKeys(input, BEGIN_ATTEMPT_INPUT_KEYS)
    || !exactText(input.jobId, 32)
    || !sha256Digest(input.requestDigest)
    || !sha256Digest(input.transitionFenceDigest)
    || !isoTimestamp(input.startedAt)
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeInspectSendAttempt(input) {
  if (!exactKeys(input, INSPECT_ATTEMPT_INPUT_KEYS)
    || !exactText(input.attemptId, 32)
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeClaimProviderCall(input) {
  if (!exactKeys(input, CLAIM_PROVIDER_CALL_INPUT_KEYS)
    || !exactText(input.attemptId, 32)
    || !exactText(input.leaseOwner, 32)
    || !Number.isSafeInteger(input.leaseDurationMicros)
    || input.leaseDurationMicros < 1_000_000
    || input.leaseDurationMicros > 300_000_000
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeStartProviderCall(input) {
  if (!exactKeys(input, START_PROVIDER_CALL_INPUT_KEYS)
    || !exactText(input.attemptId, 32)
    || !exactText(input.leaseOwner, 32)
    || !Number.isSafeInteger(input.leaseGeneration)
    || input.leaseGeneration < 1
    || !sha256Digest(input.requestDigest)
    || !sha256Digest(input.recipientBindingDigest)
    || !exactText(input.recipientWechatIdentityId, 32)
    || !exactText(input.recipientRootUserId, 32)
    || input.recipientAppCode !== "MYROOT"
    || !exactText(input.recipientOpenid, 64, /^[A-Za-z0-9_-]+$/)
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeRecoverProviderCall(input) {
  if (!exactKeys(input, RECOVER_PROVIDER_CALL_INPUT_KEYS)
    || !exactText(input.attemptId, 32)
    || !sha256Digest(input.recoveryFenceDigest)
    || !exactText(input.releaseId, 64)) throw inputError();
  return Object.freeze({ ...input });
}

function normalizeCompleteAttempt(input) {
  if (!exactKeys(input, COMPLETE_ATTEMPT_INPUT_KEYS)
    || !exactText(input.attemptId, 32)
    || !exactText(input.leaseOwner, 32)
    || !Number.isSafeInteger(input.leaseGeneration)
    || input.leaseGeneration < 1
    || !Number.isSafeInteger(input.expectedTransitionVersion)
    || input.expectedTransitionVersion < 1
    || !sha256Digest(input.expectedTransitionFenceDigest)
    || !sha256Digest(input.nextTransitionFenceDigest)
    || input.expectedTransitionFenceDigest === input.nextTransitionFenceDigest
    || !TERMINAL_SEND_ATTEMPT_STATUSES.includes(input.outcome)
    || !(input.providerReceiptDigest === null || sha256Digest(input.providerReceiptDigest))
    || !(input.providerReceiptDigestScheme === null
      || input.providerReceiptDigestScheme === PROVIDER_RECEIPT_DIGEST_SCHEME)
    || !(input.providerReceiptDigestKeyId === null
      || exactText(input.providerReceiptDigestKeyId, 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/))
    || !allowedCode(input.stableErrorCode, PROVIDER_OUTCOME_ERROR_CODES[input.outcome] || [])
    || !isoTimestamp(input.completedAt)
    || !exactText(input.releaseId, 64)) throw inputError();
  if (input.outcome === SEND_ATTEMPT_STATUS.ACCEPTED
    && (input.providerReceiptDigest === null
      || input.providerReceiptDigestScheme === null
      || input.providerReceiptDigestKeyId === null)) throw inputError();
  if (input.outcome !== SEND_ATTEMPT_STATUS.ACCEPTED
    && (input.providerReceiptDigest !== null
      || input.providerReceiptDigestScheme !== null
      || input.providerReceiptDigestKeyId !== null)) throw inputError();
  return Object.freeze({ ...input });
}

function receiptDigestConfigurationError(code) {
  return foundationError(code);
}

function validProviderCallFence(row, status) {
  const state = row.provider_call_state;
  const owner = row.provider_call_owner;
  const expiresAt = row.provider_call_lease_expires_at;
  const generation = Number(row.provider_call_generation);
  const startedAt = row.provider_call_started_at;
  if (!Number.isSafeInteger(generation) || generation < 0) return false;
  if (["AVAILABLE", "REVIEW_REQUIRED"].includes(state)) {
    return status === SEND_ATTEMPT_STATUS.REQUESTED
      && owner === null
      && expiresAt === null
      && generation === 0
      && startedAt === null;
  }
  if (state === "LEASED") {
    return status === SEND_ATTEMPT_STATUS.REQUESTED
      && exactText(owner, 32)
      && expiresAt !== null
      && generation >= 1
      && startedAt === null;
  }
  if (state === "STARTED") {
    return status === SEND_ATTEMPT_STATUS.REQUESTED
      && exactText(owner, 32)
      && expiresAt !== null
      && generation >= 1
      && startedAt !== null;
  }
  if (state !== "COMPLETED" || status === SEND_ATTEMPT_STATUS.REQUESTED) return false;
  return (owner === null && expiresAt === null && generation === 0 && startedAt === null)
    || (exactText(owner, 32) && expiresAt !== null && generation >= 1 && startedAt !== null);
}

function createProviderReceiptDigestCodec(options = {}) {
  if (!plainRecord(options)) throw receiptDigestConfigurationError("NOTIFICATION_RECEIPT_DIGEST_CONFIGURATION_INVALID");
  const env = options.env === undefined ? process.env : options.env;
  if (!plainRecord(env)) throw receiptDigestConfigurationError("NOTIFICATION_RECEIPT_DIGEST_CONFIGURATION_INVALID");
  const secret = options.secret === undefined
    ? env.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY
    : options.secret;
  const keyId = options.keyId === undefined
    ? env.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID
    : options.keyId;
  if (typeof secret !== "string"
    || Buffer.byteLength(secret, "utf8") < 32
    || Buffer.byteLength(secret, "utf8") > 4096
    || secret !== secret.trim()
    || secret.includes("\u0000")
    || new Set(Array.from(secret)).size < 8) {
    throw receiptDigestConfigurationError("NOTIFICATION_RECEIPT_DIGEST_KEY_INVALID");
  }
  if (!exactText(keyId, 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/)) {
    throw receiptDigestConfigurationError("NOTIFICATION_RECEIPT_DIGEST_KEY_ID_INVALID");
  }

  function digest(provider, receipt) {
    if (provider !== "WECHAT"
      || typeof receipt !== "string"
      || receipt.length < 1
      || receipt.length > 512
      || receipt !== receipt.trim()) throw inputError();
    const hmac = crypto.createHmac("sha256", secret);
    for (const value of [
      PROVIDER_RECEIPT_DIGEST_PURPOSE,
      PROVIDER_RECEIPT_DIGEST_SCHEME,
      keyId,
      provider,
      receipt,
    ]) {
      const bytes = Buffer.from(value, "utf8");
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(bytes.length);
      hmac.update(length);
      hmac.update(bytes);
    }
    return Object.freeze({
      digest: hmac.digest("hex"),
      digestScheme: PROVIDER_RECEIPT_DIGEST_SCHEME,
      keyId,
    });
  }

  return Object.freeze({
    digest,
    getStatus() {
      return Object.freeze({
        ready: true,
        provider: "WECHAT",
        digestScheme: PROVIDER_RECEIPT_DIGEST_SCHEME,
        keyId,
      });
    },
  });
}

function publicSendAttempt(row, options = {}) {
  if (!plainRecord(row)) throw foundationError("NOTIFICATION_DELIVERY_PERSISTENCE_INVALID");
  const status = String(row.status || "");
  const transitionVersion = Number(row.transition_version);
  const providerReceiptDigest = row.provider_receipt_digest;
  const providerReceiptDigestScheme = row.provider_receipt_digest_scheme;
  const providerReceiptDigestKeyId = row.provider_receipt_digest_key_id;
  const stableErrorCode = row.stable_error_code;
  const providerCallState = row.provider_call_state;
  const providerCallGeneration = Number(row.provider_call_generation);
  const recipientBindingStatus = row.grant_recipient_binding_status;
  const recipientWechatIdentityId = row.grant_recipient_wechat_identity_id;
  const recipientAppCode = row.grant_recipient_app_code;
  const recipientBindingCanonicalVersion = row.grant_recipient_binding_canonical_version;
  const recipientBindingDigest = row.grant_recipient_binding_digest;
  const recipientBindingDigestScheme = row.grant_recipient_binding_digest_scheme;
  const recipientBindingKeyId = row.grant_recipient_binding_key_id;
  if (!Object.hasOwn(SEND_ATTEMPT_STATUS, status)
    || !exactText(row.notification_send_attempt_id, 32)
    || !exactText(row.notification_job_id, 32)
    || Number(row.attempt_number) !== 1
    || row.provider !== "WECHAT"
    || !Number.isSafeInteger(transitionVersion)
    || transitionVersion < 1
    || !sha256Digest(row.transition_fence_digest)
    || !sha256Digest(row.request_digest)
    || !(providerReceiptDigest === null || sha256Digest(providerReceiptDigest))
    || !(providerReceiptDigestScheme === null
      || providerReceiptDigestScheme === PROVIDER_RECEIPT_DIGEST_SCHEME)
    || !(providerReceiptDigestKeyId === null
      || exactText(providerReceiptDigestKeyId, 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/))
    || !nullableExactText(stableErrorCode, 64)
    || !validProviderCallFence(row, status)
    || recipientBindingStatus !== "VERIFIED"
    || !exactText(recipientWechatIdentityId, 32)
    || recipientAppCode !== "MYROOT"
    || recipientBindingCanonicalVersion !== "canonical-json:v1"
    || !sha256Digest(recipientBindingDigest)
    || recipientBindingDigestScheme !== "hmac-sha256:v1"
    || !exactText(recipientBindingKeyId, 128)
    || (status === SEND_ATTEMPT_STATUS.REQUESTED
      ? stableErrorCode !== null
      : !allowedCode(stableErrorCode, PROVIDER_OUTCOME_ERROR_CODES[status] || []))
    || !exactText(row.release_id, 64)
    || (status === SEND_ATTEMPT_STATUS.ACCEPTED
      && (providerReceiptDigest === null
        || providerReceiptDigestScheme === null
        || providerReceiptDigestKeyId === null))
    || (status !== SEND_ATTEMPT_STATUS.ACCEPTED
      && (providerReceiptDigest !== null
        || providerReceiptDigestScheme !== null
        || providerReceiptDigestKeyId !== null))) {
    throw foundationError("NOTIFICATION_DELIVERY_PERSISTENCE_INVALID");
  }
  return Object.freeze({
    attemptId: String(row.notification_send_attempt_id || ""),
    jobId: String(row.notification_job_id || ""),
    attemptNumber: Number(row.attempt_number),
    provider: String(row.provider || ""),
    status,
    transitionVersion,
    transitionFenceDigest: String(row.transition_fence_digest || ""),
    requestDigest: String(row.request_digest || ""),
    providerReceiptDigest,
    providerReceiptDigestScheme,
    providerReceiptDigestKeyId,
    stableErrorCode,
    providerCallState,
    providerCallGeneration,
    providerCallLeaseExpiresAt: row.provider_call_lease_expires_at || null,
    providerCallStartedAt: row.provider_call_started_at || null,
    recipientBindingStatus,
    recipientWechatIdentityId,
    recipientAppCode,
    recipientBindingCanonicalVersion,
    recipientBindingDigest,
    recipientBindingDigestScheme,
    recipientBindingKeyId,
    releaseId: String(row.release_id || ""),
    providerCallAuthorized: false,
    providerCallCheckpointRequired: status === SEND_ATTEMPT_STATUS.REQUESTED,
    replayed: options.replayed === true,
    providerAccepted: status === SEND_ATTEMPT_STATUS.ACCEPTED,
    deviceDeliveryStatus: "NOT_VERIFIED",
  });
}

module.exports = {
  NATIVE_DECISION_REASON_CODES,
  NATIVE_DECISION_STATUS,
  PROVIDER_OUTCOME_ERROR_CODES,
  PROVIDER_OUTCOME_STATUS,
  PROVIDER_RECEIPT_DIGEST_PURPOSE,
  PROVIDER_RECEIPT_DIGEST_SCHEME,
  SEND_ATTEMPT_STATUS,
  TERMINAL_SEND_ATTEMPT_STATUSES,
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
};
