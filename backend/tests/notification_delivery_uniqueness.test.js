// The notification Core captures this at module load so production callers cannot
// enable deterministic identifier entropy through constructor options.
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  NATIVE_DECISION_STATUS,
  PROVIDER_OUTCOME_STATUS,
  SEND_ATTEMPT_STATUS,
  createProviderReceiptDigestCodec,
  normalizeCompleteAttempt,
  normalizeDecision,
  normalizeStartProviderCall,
} = require("../src/notificationDeliveryUniqueness");
const {
  createMysqlNotificationDeliveryCore,
} = require("../src/mysqlNotificationDeliveryCore");

const RECEIPT_HMAC_SECRET = "test-only-notification-receipt-hmac-key-2026-07";
const RECEIPT_HMAC_KEY_ID = "notification-test-key-v1";
const ENABLED_ENV = Object.freeze({
  MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "true",
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY: RECEIPT_HMAC_SECRET,
  ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: RECEIPT_HMAC_KEY_ID,
});
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const DIGEST_E = "e".repeat(64);
const DIGEST_F = "f".repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return Object.freeze({ promise, resolve, reject });
}
const RELEASE_ID = "release-v1.0.0-local";

function duplicateError() {
  return Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY", errno: 1062 });
}

function createFakeConnection(sharedState) {
  const state = sharedState || {
    decisions: [],
    identities: [],
    grants: [],
    jobs: [],
    attempts: [],
    transitions: [],
    calls: [],
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
    destroyCount: 0,
    beginFailures: [],
    commitFailures: [],
    rollbackFailures: [],
    releaseFailures: [],
    now: "2026-07-18 01:00:00.000",
  };
  let retired = false;
  let transactionSnapshot = null;
  const localCalls = [];
  const authorityCollections = ["decisions", "identities", "grants", "jobs", "attempts", "transitions"];
  function snapshotAuthority() {
    return Object.fromEntries(authorityCollections.map((key) => [
      key,
      state[key].map((item) => ({ ...item })),
    ]));
  }
  function restoreAuthority(snapshot) {
    if (!snapshot) return;
    for (const key of authorityCollections) {
      state[key].splice(0, state[key].length, ...snapshot[key].map((item) => ({ ...item })));
    }
  }
  function success(affectedRows = 1) {
    return [{ affectedRows }, []];
  }
  function rows(items) {
    return [items.map((item) => ({ ...item })), []];
  }
  const connection = {
    state,
    localCalls,
    async query(sql) {
      if (retired) throw new Error("retired connection reused");
      const call = { sql, values: [] };
      state.calls.push(call);
      localCalls.push(call);
      if (sql === "SET SESSION time_zone = '+08:00'"
        || sql === "SET TRANSACTION READ ONLY") return [{ affectedRows: 0 }, []];
      throw new Error(`unexpected query: ${sql}`);
    },
    async beginTransaction() {
      if (retired) throw new Error("retired connection reused");
      state.beginCount += 1;
      if (state.beginFailures.length) throw state.beginFailures.shift();
      transactionSnapshot = snapshotAuthority();
    },
    async commit() {
      if (retired) throw new Error("retired connection reused");
      state.commitCount += 1;
      if (state.commitFailures.length) {
        const error = state.commitFailures.shift();
        if (error.transactionApplied === false) restoreAuthority(transactionSnapshot);
        transactionSnapshot = null;
        if (typeof state.afterCommitAcknowledgementLoss === "function") {
          const afterCommitAcknowledgementLoss = state.afterCommitAcknowledgementLoss;
          state.afterCommitAcknowledgementLoss = null;
          await afterCommitAcknowledgementLoss({ state, error });
        }
        throw error;
      }
      transactionSnapshot = null;
    },
    async rollback() {
      if (retired) throw new Error("retired connection reused");
      state.rollbackCount += 1;
      if (state.rollbackFailures.length) throw state.rollbackFailures.shift();
      restoreAuthority(transactionSnapshot);
      transactionSnapshot = null;
    },
    release() {
      if (retired) throw new Error("retired connection released");
      if (state.releaseFailures.length) throw state.releaseFailures.shift();
      state.releaseCount += 1;
    },
    destroy() {
      if (retired) return;
      retired = true;
      state.destroyCount += 1;
    },
    async execute(sql, values = []) {
      if (retired) throw new Error("retired connection reused");
      const call = { sql, values: [...values] };
      state.calls.push(call);
      localCalls.push(call);
      if (sql.includes("notification-delivery:select-decision")) {
        const [grantRequestId, rootUserId, taskId, date, version] = values;
        const matches = state.decisions.filter((item) => item.grant_request_id === grantRequestId
          || (item.root_user_id === rootUserId
            && item.task_id === taskId
            && item.task_occurrence_date === date
            && item.template_version === version));
        return rows(matches.slice(0, 2).map((item) => {
          const grant = state.grants.find((candidate) => {
            return candidate.notification_subscription_attempt_id === item.notification_subscription_attempt_id;
          });
          return {
            ...item,
            notification_subscription_grant_id: grant ? grant.notification_subscription_grant_id : null,
            grant_root_user_id: grant ? grant.root_user_id : null,
            grant_task_id: grant ? grant.task_id : null,
            grant_task_occurrence_date: grant ? grant.task_occurrence_date : null,
            grant_template_version: grant ? grant.template_version : null,
            grant_grant_request_id: grant ? grant.grant_request_id : null,
            grant_release_id: grant ? grant.release_id : null,
            grant_status: grant ? grant.status : null,
            grant_recipient_binding_status: grant ? grant.recipient_binding_status : null,
            grant_recipient_wechat_identity_id: grant ? grant.recipient_wechat_identity_id : null,
            grant_recipient_app_code: grant ? grant.recipient_app_code : null,
            grant_recipient_binding_canonical_version: grant ? grant.recipient_binding_canonical_version : null,
            grant_recipient_binding_digest: grant ? grant.recipient_binding_digest : null,
            grant_recipient_binding_digest_scheme: grant ? grant.recipient_binding_digest_scheme : null,
            grant_recipient_binding_key_id: grant ? grant.recipient_binding_key_id : null,
          };
        }));
      }
      if (sql.includes("notification-delivery:insert-decision")) {
        const [id, rootUserId, taskId, date, version, grantRequestId, decision, reasonCode, idempotencyKey, decidedAt, releaseId] = values;
        if (state.decisions.some((item) => item.grant_request_id === grantRequestId
          || item.idempotency_key === idempotencyKey
          || (item.root_user_id === rootUserId
            && item.task_id === taskId
            && item.task_occurrence_date === date
            && item.template_version === version))) throw duplicateError();
        state.decisions.push({
          notification_subscription_attempt_id: id,
          root_user_id: rootUserId,
          task_id: taskId,
          task_occurrence_date: date,
          template_version: version,
          grant_request_id: grantRequestId,
          native_decision: decision,
          reason_code: reasonCode,
          idempotency_key: idempotencyKey,
          decided_at: decidedAt,
          release_id: releaseId,
        });
        return success();
      }
      if (sql.includes("notification-delivery:insert-grant")) {
        const [
          id, attemptId, rootUserId, taskId, date, version, grantRequestId, grantedAt,
          recipientWechatIdentityId, recipientAppCode, recipientBindingCanonicalVersion,
          recipientBindingDigest, recipientBindingDigestScheme, recipientBindingKeyId, releaseId,
        ] = values;
        if (state.grants.some((item) => item.notification_subscription_attempt_id === attemptId
          || item.grant_request_id === grantRequestId
          || (item.root_user_id === rootUserId
            && item.task_id === taskId
            && item.task_occurrence_date === date
            && item.template_version === version))) throw duplicateError();
        state.grants.push({
          notification_subscription_grant_id: id,
          notification_subscription_attempt_id: attemptId,
          root_user_id: rootUserId,
          task_id: taskId,
          task_occurrence_date: date,
          template_version: version,
          grant_request_id: grantRequestId,
          status: "AVAILABLE",
          recipient_binding_status: "VERIFIED",
          reserved_job_id: null,
          status_reason_code: null,
          granted_at: grantedAt,
          recipient_wechat_identity_id: recipientWechatIdentityId,
          recipient_app_code: recipientAppCode,
          recipient_binding_canonical_version: recipientBindingCanonicalVersion,
          recipient_binding_digest: recipientBindingDigest,
          recipient_binding_digest_scheme: recipientBindingDigestScheme,
          recipient_binding_key_id: recipientBindingKeyId,
          release_id: releaseId,
        });
        if (!state.identities.some((item) => item.wechat_identity_id === recipientWechatIdentityId)) {
          state.identities.push({
            wechat_identity_id: recipientWechatIdentityId,
            root_user_id: rootUserId,
            app_code: recipientAppCode,
            openid: `${recipientWechatIdentityId}_openid`,
          });
        }
        return success();
      }
      if (sql.includes("notification-delivery:select-grant")) {
        return rows(state.grants.filter((item) => item.notification_subscription_grant_id === values[0]).slice(0, 1));
      }
      if (sql.includes("notification-delivery:select-job-conflict")) {
        const [grantId, rootUserId, taskId, date, version] = values;
        return rows(state.jobs.filter((item) => item.notification_subscription_grant_id === grantId
          || (item.root_user_id === rootUserId
            && item.task_id === taskId
            && item.task_occurrence_date === date
            && item.template_version === version)).slice(0, 2));
      }
      if (sql.includes("notification-delivery:insert-job")) {
        const [id, grantId, rootUserId, taskId, date, version, dueAt, idempotencyKey, requestDigest, releaseId] = values;
        if (state.jobs.some((item) => item.notification_subscription_grant_id === grantId
          || (item.root_user_id === rootUserId
            && item.task_id === taskId
            && item.task_occurrence_date === date
            && item.template_version === version))) throw duplicateError();
        state.jobs.push({
          notification_job_id: id,
          notification_subscription_grant_id: grantId,
          root_user_id: rootUserId,
          task_id: taskId,
          task_occurrence_date: date,
          template_version: version,
          status: "SCHEDULED",
          due_at: dueAt,
          idempotency_key: idempotencyKey,
          request_digest: requestDigest,
          send_attempt_id: null,
          stable_error_code: null,
          release_id: releaseId,
        });
        return success();
      }
      if (sql.includes("notification-delivery:bind-grant-job")) {
        const [jobId, grantId] = values;
        const grant = state.grants.find((item) => item.notification_subscription_grant_id === grantId);
        if (!grant || grant.status !== "AVAILABLE" || grant.reserved_job_id !== null) return success(0);
        grant.reserved_job_id = jobId;
        return success();
      }
      if (sql.includes("notification-delivery:select-job-for-attempt")) {
        const job = state.jobs.find((item) => item.notification_job_id === values[0]);
        if (!job) return rows([]);
        const grant = state.grants.find((item) => item.notification_subscription_grant_id === job.notification_subscription_grant_id);
        return rows([{
          ...job,
          grant_status: grant.status,
          reserved_job_id: grant.reserved_job_id,
          grant_status_reason_code: grant.status_reason_code === undefined ? null : grant.status_reason_code,
          grant_recipient_binding_status: grant.recipient_binding_status,
          grant_release_id: grant.release_id,
          grant_recipient_wechat_identity_id: grant.recipient_wechat_identity_id,
          grant_recipient_app_code: grant.recipient_app_code,
          grant_recipient_binding_canonical_version: grant.recipient_binding_canonical_version,
          grant_recipient_binding_digest: grant.recipient_binding_digest,
          grant_recipient_binding_digest_scheme: grant.recipient_binding_digest_scheme,
          grant_recipient_binding_key_id: grant.recipient_binding_key_id,
        }]);
      }
      if (sql.includes("notification-delivery:select-attempt-by-job")) {
        return rows(state.attempts.filter((item) => item.notification_job_id === values[0]).slice(0, 1).map((item) => {
          const transition = state.transitions.find((candidate) => (
            candidate.notification_send_attempt_id === item.notification_send_attempt_id
              && candidate.transition_number === item.transition_version
          ));
          return {
            ...item,
            current_transition_number: transition && transition.transition_number,
            current_transition_from_status: transition && transition.from_status,
            current_transition_to_status: transition && transition.to_status,
            current_transition_fence_digest: transition && transition.transition_fence_digest,
            current_transition_provider_receipt_digest: transition && transition.provider_receipt_digest,
            current_transition_provider_receipt_digest_scheme: transition && transition.provider_receipt_digest_scheme,
            current_transition_provider_receipt_digest_key_id: transition && transition.provider_receipt_digest_key_id,
            current_transition_stable_error_code: transition && transition.stable_error_code,
            current_transition_release_id: transition && transition.release_id,
          };
        }));
      }
      if (sql.includes("notification-delivery:insert-attempt")) {
        const [id, jobId, fence, requestDigest, startedAt, releaseId] = values;
        if (state.attempts.some((item) => item.notification_job_id === jobId
          || item.transition_fence_digest === fence)) throw duplicateError();
        state.attempts.push({
          notification_send_attempt_id: id,
          notification_job_id: jobId,
          attempt_number: 1,
          provider: "WECHAT",
          status: "REQUESTED",
          transition_version: 1,
          transition_fence_digest: fence,
          request_digest: requestDigest,
          provider_call_state: "AVAILABLE",
          provider_call_owner: null,
          provider_call_lease_expires_at: null,
          provider_call_generation: 0,
          provider_call_started_at: null,
          provider_receipt_digest: null,
          provider_receipt_digest_scheme: null,
          provider_receipt_digest_key_id: null,
          stable_error_code: null,
          started_at: startedAt,
          completed_at: null,
          release_id: releaseId,
        });
        return success();
      }
      if (sql.includes("notification-delivery:insert-transition")) {
        const [id, attemptId, number, fromStatus, toStatus, fence, receipt, digestScheme, digestKeyId, errorCode, releaseId] = values;
        if (state.transitions.some((item) => item.transition_fence_digest === fence
          || (item.notification_send_attempt_id === attemptId && item.transition_number === number))) throw duplicateError();
        state.transitions.push({
          notification_send_attempt_transition_id: id,
          notification_send_attempt_id: attemptId,
          transition_number: number,
          from_status: fromStatus,
          to_status: toStatus,
          transition_fence_digest: fence,
          provider_receipt_digest: receipt,
          provider_receipt_digest_scheme: digestScheme,
          provider_receipt_digest_key_id: digestKeyId,
          stable_error_code: errorCode,
          release_id: releaseId,
        });
        return success();
      }
      if (sql.includes("notification-delivery:activate-attempt-job")) {
        const [attemptId, jobId] = values;
        const job = state.jobs.find((item) => item.notification_job_id === jobId);
        if (!job || job.status !== "SCHEDULED" || job.send_attempt_id !== null) return success(0);
        job.status = "SENDING";
        job.send_attempt_id = attemptId;
        return success();
      }
      if (sql.includes("notification-delivery:reserve-attempt-grant")) {
        const [grantId, jobId] = values;
        const grant = state.grants.find((item) => item.notification_subscription_grant_id === grantId);
        if (!grant || grant.status !== "AVAILABLE" || grant.reserved_job_id !== jobId) return success(0);
        grant.status = "RESERVED";
        return success();
      }
      if (sql.includes("notification-delivery:select-attempt */")
        || sql.includes("notification-delivery:inspect-attempt */")) {
        const attempt = state.attempts.find((item) => item.notification_send_attempt_id === values[0]);
        if (!attempt) return rows([]);
        const job = state.jobs.find((item) => item.notification_job_id === attempt.notification_job_id);
        const grant = state.grants.find((item) => item.notification_subscription_grant_id === job.notification_subscription_grant_id);
        const recipientIdentity = state.identities.find((item) => {
          return item.wechat_identity_id === grant.recipient_wechat_identity_id;
        });
        const transition = state.transitions.find((item) => {
          return item.notification_send_attempt_id === attempt.notification_send_attempt_id
            && item.transition_number === attempt.transition_version;
        });
        return rows([{
          ...attempt,
          notification_subscription_grant_id: grant.notification_subscription_grant_id,
          job_root_user_id: job.root_user_id,
          job_send_attempt_id: job.send_attempt_id,
          job_release_id: job.release_id,
          job_status: job.status,
          job_stable_error_code: job.stable_error_code,
          grant_reserved_job_id: grant.reserved_job_id,
          grant_root_user_id: grant.root_user_id,
          grant_release_id: grant.release_id,
          grant_status: grant.status,
          grant_status_reason_code: grant.status_reason_code,
          grant_recipient_binding_status: grant.recipient_binding_status,
          grant_recipient_wechat_identity_id: grant.recipient_wechat_identity_id,
          grant_recipient_app_code: grant.recipient_app_code,
          grant_recipient_binding_canonical_version: grant.recipient_binding_canonical_version,
          grant_recipient_binding_digest: grant.recipient_binding_digest,
          grant_recipient_binding_digest_scheme: grant.recipient_binding_digest_scheme,
          grant_recipient_binding_key_id: grant.recipient_binding_key_id,
          current_recipient_wechat_identity_id: recipientIdentity && recipientIdentity.wechat_identity_id,
          current_recipient_root_user_id: recipientIdentity && recipientIdentity.root_user_id,
          current_recipient_app_code: recipientIdentity && recipientIdentity.app_code,
          current_recipient_openid: recipientIdentity && recipientIdentity.openid,
          current_transition_number: transition && transition.transition_number,
          current_transition_from_status: transition && transition.from_status,
          current_transition_to_status: transition && transition.to_status,
          current_transition_fence_digest: transition && transition.transition_fence_digest,
          current_transition_provider_receipt_digest: transition && transition.provider_receipt_digest,
          current_transition_provider_receipt_digest_scheme: transition && transition.provider_receipt_digest_scheme,
          current_transition_provider_receipt_digest_key_id: transition && transition.provider_receipt_digest_key_id,
          current_transition_stable_error_code: transition && transition.stable_error_code,
          current_transition_release_id: transition && transition.release_id,
        }]);
      }
      if (sql.includes("notification-delivery:claim-provider-call")) {
        const [owner, durationMicros, attemptId, releaseId] = values;
        const attempt = state.attempts.find((item) => item.notification_send_attempt_id === attemptId);
        if (!attempt
          || attempt.status !== "REQUESTED"
          || attempt.release_id !== releaseId
          || !(attempt.provider_call_state === "AVAILABLE"
            || (attempt.provider_call_state === "LEASED"
              && attempt.provider_call_lease_expires_at <= state.now))) return success(0);
        attempt.provider_call_state = "LEASED";
        attempt.provider_call_owner = owner;
        attempt.provider_call_generation += 1;
        attempt.provider_call_started_at = null;
        const now = Date.parse(`${state.now.replace(" ", "T")}+08:00`);
        const expires = new Date(now + (durationMicros / 1000));
        const shanghai = new Date(expires.getTime() + (8 * 60 * 60 * 1000));
        attempt.provider_call_lease_expires_at = shanghai.toISOString().replace("T", " ").replace("Z", "");
        return success();
      }
      if (sql.includes("notification-delivery:start-provider-call")) {
        const [
          attemptId,
          owner,
          generation,
          requestDigest,
          releaseId,
          jobReleaseId,
          grantReleaseId,
          recipientBindingDigest,
          recipientWechatIdentityId,
          recipientRootUserId,
          recipientAppCode,
          recipientOpenid,
        ] = values;
        const attempt = state.attempts.find((item) => item.notification_send_attempt_id === attemptId);
        const job = attempt && state.jobs.find((item) => {
          return item.notification_job_id === attempt.notification_job_id;
        });
        const grant = job && state.grants.find((item) => {
          return item.notification_subscription_grant_id === job.notification_subscription_grant_id;
        });
        const recipientIdentity = grant && state.identities.find((item) => {
          return item.wechat_identity_id === grant.recipient_wechat_identity_id;
        });
        if (typeof state.beforeStartProviderCallUpdate === "function") {
          const beforeStartProviderCallUpdate = state.beforeStartProviderCallUpdate;
          state.beforeStartProviderCallUpdate = null;
          await beforeStartProviderCallUpdate({ state, attempt, job, grant, recipientIdentity });
        }
        if (!attempt
          || !job
          || !grant
          || !recipientIdentity
          || attempt.status !== "REQUESTED"
          || attempt.provider_call_state !== "LEASED"
          || attempt.provider_call_owner !== owner
          || attempt.provider_call_generation !== generation
          || attempt.provider_call_lease_expires_at <= state.now
          || attempt.request_digest !== requestDigest
          || attempt.release_id !== releaseId
          || job.status !== "SENDING"
          || job.send_attempt_id !== attemptId
          || job.release_id !== jobReleaseId
          || grant.status !== "RESERVED"
          || grant.reserved_job_id !== attempt.notification_job_id
          || grant.release_id !== grantReleaseId
          || grant.recipient_binding_status !== "VERIFIED"
          || grant.recipient_app_code !== "MYROOT"
          || grant.recipient_binding_canonical_version !== "canonical-json:v1"
          || grant.recipient_binding_digest !== recipientBindingDigest
          || grant.recipient_binding_digest_scheme !== "hmac-sha256:v1"
          || job.root_user_id !== grant.root_user_id
          || grant.root_user_id !== recipientIdentity.root_user_id
          || grant.recipient_app_code !== recipientIdentity.app_code
          || recipientIdentity.wechat_identity_id !== recipientWechatIdentityId
          || recipientIdentity.root_user_id !== recipientRootUserId
          || recipientIdentity.app_code !== recipientAppCode
          || recipientIdentity.openid !== recipientOpenid) return success(0);
        attempt.provider_call_state = "STARTED";
        attempt.provider_call_started_at = state.now;
        return success();
      }
      if (sql.includes("notification-delivery:recover-provider-call")) {
        const [recoveryFence, attemptId, expectedVersion, expectedFence, releaseId] = values;
        const attempt = state.attempts.find((item) => item.notification_send_attempt_id === attemptId);
        if (!attempt
          || attempt.status !== "REQUESTED"
          || attempt.transition_version !== expectedVersion
          || attempt.transition_fence_digest !== expectedFence
          || attempt.provider_call_state !== "STARTED"
          || attempt.provider_call_lease_expires_at > state.now
          || attempt.release_id !== releaseId) return success(0);
        attempt.status = "UNKNOWN";
        attempt.transition_version += 1;
        attempt.transition_fence_digest = recoveryFence;
        attempt.stable_error_code = "PROVIDER_RESULT_UNKNOWN";
        attempt.completed_at = state.now;
        attempt.provider_call_state = "COMPLETED";
        return success();
      }
      if (sql.includes("notification-delivery:complete-attempt")) {
        const [outcome, nextFence, receipt, digestScheme, digestKeyId, errorCode, completedAt, attemptId, expectedVersion, expectedFence, owner, generation, releaseId] = values;
        if (receipt && state.attempts.some((item) => {
          return item.notification_send_attempt_id !== attemptId && item.provider_receipt_digest === receipt;
        })) throw duplicateError();
        const attempt = state.attempts.find((item) => item.notification_send_attempt_id === attemptId);
        if (!attempt
          || attempt.status !== "REQUESTED"
          || attempt.transition_version !== expectedVersion
          || attempt.transition_fence_digest !== expectedFence
          || attempt.provider_call_state !== "STARTED"
          || attempt.provider_call_owner !== owner
          || attempt.provider_call_generation !== generation
          || attempt.release_id !== releaseId) return success(0);
        attempt.status = outcome;
        attempt.transition_version += 1;
        attempt.transition_fence_digest = nextFence;
        attempt.provider_receipt_digest = receipt;
        attempt.provider_receipt_digest_scheme = digestScheme;
        attempt.provider_receipt_digest_key_id = digestKeyId;
        attempt.stable_error_code = errorCode;
        attempt.completed_at = completedAt;
        attempt.provider_call_state = "COMPLETED";
        return success();
      }
      if (sql.includes("notification-delivery:complete-job")) {
        const [status, errorCode, jobId, attemptId] = values;
        const job = state.jobs.find((item) => item.notification_job_id === jobId);
        if (!job || job.status !== "SENDING" || job.send_attempt_id !== attemptId) return success(0);
        job.status = status;
        job.stable_error_code = errorCode;
        return success();
      }
      if (sql.includes("notification-delivery:complete-grant")) {
        const [status, errorCode, , , , grantId] = values;
        const grant = state.grants.find((item) => item.notification_subscription_grant_id === grantId);
        if (!grant || grant.status !== "RESERVED") return success(0);
        grant.status = status;
        grant.status_reason_code = errorCode;
        return success();
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return connection;
}

function deterministicRandomBytes() {
  let counter = 0;
  return function randomBytes(size) {
    counter += 1;
    return Buffer.alloc(size, counter);
  };
}

function receiptDigestCodec(secret = RECEIPT_HMAC_SECRET, keyId = RECEIPT_HMAC_KEY_ID) {
  return createProviderReceiptDigestCodec({ secret, keyId, env: {} });
}

function sequentialPool(...connections) {
  let index = 0;
  return {
    getConnectionCount: 0,
    async getConnection() {
      this.getConnectionCount += 1;
      const connection = connections[index];
      index += 1;
      if (!connection) throw new Error("no fresh connection available");
      return connection;
    },
  };
}

function core(connectionOrPool = createFakeConnection(), env = ENABLED_ENV) {
  const pool = typeof connectionOrPool.getConnection === "function"
    ? connectionOrPool
    : { async getConnection() { return connectionOrPool; } };
  return createMysqlNotificationDeliveryCore(pool, {
    env,
    randomBytes: deterministicRandomBytes(),
  });
}

function decisionInput(overrides = {}) {
  const input = {
    rootUserId: "root_user_1",
    taskId: "task_1",
    taskOccurrenceDate: "2026-07-18",
    templateVersion: "tpl-v1",
    grantRequestId: "grant-request-1",
    nativeDecision: NATIVE_DECISION_STATUS.ACCEPTED,
    reasonCode: null,
    idempotencyKey: "decision-idem-1",
    decidedAt: "2026-07-17T10:00:00.000Z",
    releaseId: RELEASE_ID,
    recipientWechatIdentityId: "wxi_recipient_1",
    recipientAppCode: "MYROOT",
    recipientBindingCanonicalVersion: "canonical-json:v1",
    recipientBindingDigest: DIGEST_F,
    recipientBindingDigestScheme: "hmac-sha256:v1",
    recipientBindingKeyId: "recipient-binding-v1",
    ...overrides,
  };
  if (input.nativeDecision !== NATIVE_DECISION_STATUS.ACCEPTED) {
    input.recipientWechatIdentityId = null;
    input.recipientAppCode = null;
    input.recipientBindingCanonicalVersion = null;
    input.recipientBindingDigest = null;
    input.recipientBindingDigestScheme = null;
    input.recipientBindingKeyId = null;
  }
  return input;
}

function scheduleInput(grantId, overrides = {}) {
  return {
    grantId,
    rootUserId: "root_user_1",
    taskId: "task_1",
    taskOccurrenceDate: "2026-07-18",
    templateVersion: "tpl-v1",
    dueAt: "2026-07-18T01:00:00.000Z",
    idempotencyKey: "schedule-idem-1",
    releaseId: RELEASE_ID,
    ...overrides,
  };
}

async function preparedAttempt(options = {}) {
  const connection = createFakeConnection();
  const implementation = core(connection);
  const decision = await implementation.recordDecision(decisionInput(options.decision));
  const job = await implementation.schedule(scheduleInput(decision.grantId, options.schedule));
  const attempt = await implementation.beginSendAttempt({
    jobId: job.jobId,
    requestDigest: options.requestDigest || DIGEST_A,
    transitionFenceDigest: options.fence || DIGEST_B,
    startedAt: "2026-07-18T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  return { connection, implementation, decision, job, attempt };
}

function currentRecipientFacts(connection, attempt) {
  const persistedAttempt = connection.state.attempts.find((item) => {
    return item.notification_send_attempt_id === attempt.attemptId;
  });
  const job = persistedAttempt && connection.state.jobs.find((item) => {
    return item.notification_job_id === persistedAttempt.notification_job_id;
  });
  const grant = job && connection.state.grants.find((item) => {
    return item.notification_subscription_grant_id === job.notification_subscription_grant_id;
  });
  const identity = grant && connection.state.identities.find((item) => {
    return item.wechat_identity_id === grant.recipient_wechat_identity_id;
  });
  assert.ok(identity);
  return {
    recipientWechatIdentityId: identity.wechat_identity_id,
    recipientRootUserId: identity.root_user_id,
    recipientAppCode: identity.app_code,
    recipientOpenid: identity.openid,
  };
}

async function preparedStartedProviderCall(options = {}) {
  const prepared = await preparedAttempt(options);
  const claim = await prepared.implementation.claimProviderCall({
    attemptId: prepared.attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(claim.leaseAcquired, true);
  const attempt = await prepared.implementation.startProviderCall({
    attemptId: prepared.attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    requestDigest: prepared.attempt.requestDigest,
    recipientBindingDigest: prepared.attempt.recipientBindingDigest,
    ...currentRecipientFacts(prepared.connection, prepared.attempt),
    releaseId: RELEASE_ID,
  });
  assert.equal(attempt.providerCallStarted, true);
  return { ...prepared, attempt, claim };
}

test("migrations 018 through 060 freeze identity, receipts, and provider-call fencing", () => {
  const createMigrations = [
    "018_notification_subscription_attempt.sql",
    "019_notification_subscription_grant.sql",
    "020_notification_job.sql",
    "021_notification_send_attempt.sql",
    "022_notification_send_attempt_transition.sql",
  ].map((migrationName) => fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", migrationName),
    "utf8"
  ));
  const alterMigrations = [
    "024_notification_native_decision_contract.sql",
    "025_notification_job_request_identity.sql",
    "026_notification_send_attempt_receipt_metadata.sql",
    "027_notification_send_transition_receipt_metadata.sql",
  ].map((migrationName) => fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", migrationName),
    "utf8"
  ));
  const providerFenceMigrations = [
    "058_notification_provider_call_fence_stage.sql",
    "059_notification_provider_call_fence_backfill.sql",
    "060_notification_provider_call_fence_enforce.sql",
  ].map((migrationName) => fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", migrationName),
    "utf8"
  ));
  assert.equal(createMigrations.every((sql) => (sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length === 1), true);
  assert.equal(alterMigrations.every((sql) => (sql.match(/ALTER TABLE/g) || []).length === 1), true);
  assert.equal(alterMigrations.every((sql) => sql.split(";").filter((part) => part.trim()).length === 6), true);
  for (const [sql, preflightName, authorityTable] of [
    [alterMigrations[0], "migration_024_notification_native_preflight", "notification_subscription_attempt_v1"],
    [alterMigrations[1], "migration_025_notification_job_preflight", "notification_job_v1"],
    [alterMigrations[2], "migration_026_notification_attempt_preflight", "notification_send_attempt"],
    [alterMigrations[3], "migration_027_notification_transition_preflight", "notification_send_attempt_transition"],
  ]) {
    assert.match(sql, new RegExp(`CREATE TEMPORARY TABLE ${preflightName}`));
    assert.match(sql, new RegExp(`INSERT INTO ${preflightName} \\(guard_id\\)\\s+SELECT 1 FROM ${authorityTable} LIMIT 1`));
    assert.match(sql, new RegExp(`DROP TEMPORARY TABLE ${preflightName}`));
  }
  assert.equal((providerFenceMigrations[0].match(/ALTER TABLE/g) || []).length, 1);
  assert.equal((providerFenceMigrations[1].match(/\bUPDATE notification_send_attempt\b/g) || []).length, 1);
  assert.equal((providerFenceMigrations[1].match(/ALTER TABLE/g) || []).length, 0);
  assert.equal((providerFenceMigrations[2].match(/ALTER TABLE/g) || []).length, 1);
  assert.match(providerFenceMigrations[0], /provider_call_owner VARCHAR\(32\)[\s\S]*provider_call_generation BIGINT UNSIGNED NULL/);
  assert.match(providerFenceMigrations[1], /status = 'REQUESTED' THEN 'REVIEW_REQUIRED'/);
  assert.match(providerFenceMigrations[2], /provider_call_state = 'STARTED'[\s\S]*provider_call_started_at < provider_call_lease_expires_at/);
  assert.match(providerFenceMigrations[2], /provider_call_state = 'COMPLETED'[\s\S]*status <> 'REQUESTED'/);
  assert.match(providerFenceMigrations[2], /idx_notification_provider_call_recovery/);
  assert.match(providerFenceMigrations[2], /idx_notification_provider_call_owner/);
  const sql = [...createMigrations, ...alterMigrations, ...providerFenceMigrations].join("\n");
  assert.match(sql, /UNIQUE KEY uk_notification_subscription_attempt_v1_grant_request \(grant_request_id\)/);
  assert.match(sql, /UNIQUE KEY uk_notification_subscription_attempt_v1_occurrence\s*\(root_user_id, task_id, task_occurrence_date, template_version\)/);
  assert.match(sql, /UNIQUE KEY uk_notification_job_v1_grant \(notification_subscription_grant_id\)/);
  assert.match(sql, /UNIQUE KEY uk_notification_send_attempt_job \(notification_job_id\)/);
  assert.match(sql, /UNIQUE KEY uk_notification_send_attempt_provider_receipt \(provider_receipt_digest\)/);
  assert.match(sql, /CHECK \(status IN \('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN'\)\)/);
  assert.match(sql, /native_decision = 'REJECTED' AND reason_code IS NOT NULL AND reason_code = 'USER_REJECTED'/);
  assert.match(sql, /status = 'FAILED' AND stable_error_code IS NOT NULL AND stable_error_code IN/);
  assert.match(sql, /status = 'ACCEPTED'[\s\S]*provider_receipt_digest IS NOT NULL[\s\S]*provider_receipt_digest_scheme IS NOT NULL[\s\S]*provider_receipt_digest_key_id IS NOT NULL/);
  assert.match(sql, /to_status = 'ACCEPTED'[\s\S]*provider_receipt_digest IS NOT NULL[\s\S]*provider_receipt_digest_scheme IS NOT NULL[\s\S]*provider_receipt_digest_key_id IS NOT NULL/);
  assert.equal((sql.match(/stable_error_code IS NOT NULL AND stable_error_code IN/g) || []).length, 9);
  assert.match(sql, /CONSTRAINT fk_notification_subscription_grant_attempt[\s\S]*REFERENCES notification_subscription_attempt_v1/);
  assert.match(sql, /CONSTRAINT fk_notification_job_grant[\s\S]*REFERENCES notification_subscription_grant_v1/);
  assert.match(sql, /CONSTRAINT fk_notification_send_attempt_job[\s\S]*REFERENCES notification_job_v1/);
  assert.match(sql, /CONSTRAINT fk_notification_send_attempt_transition_attempt[\s\S]*REFERENCES notification_send_attempt/);
  assert.match(sql, /native_decision IN \('ACCEPTED', 'REJECTED', 'PLATFORM_DISABLED', 'OUTCOME_UNKNOWN'\)/);
  assert.match(sql, /ADD COLUMN idempotency_key VARCHAR\(191\)[\s\S]*ADD COLUMN request_digest CHAR\(64\)/);
  assert.match(sql, /UNIQUE KEY uk_notification_job_v1_idempotency \(idempotency_key\)/);
  assert.equal((sql.match(/ADD COLUMN provider_receipt_digest_scheme VARCHAR\(32\)/g) || []).length, 2);
  assert.equal((sql.match(/ADD COLUMN provider_receipt_digest_key_id VARCHAR\(64\)/g) || []).length, 2);
  assert.equal((sql.match(/provider_receipt_digest_scheme = 'hmac-sha256:v1'/g) || []).length, 2);
  assert.doesNotMatch(sql, /\b(openid|phone|mobile|session|access_token|credential)\b/i);
});

test("the Core owns transactions, is disabled by default, and exposes neither sender nor transaction Adapter Interface", () => {
  const connection = createFakeConnection();
  const implementation = core(connection, {});
  assert.deepEqual(Object.keys(implementation), [
    "assertReady",
    "recordDecision",
    "schedule",
    "beginSendAttempt",
    "claimProviderCall",
    "startProviderCall",
    "inspectSendAttempt",
    "completeSendAttempt",
    "recoverProviderCall",
  ]);
  assert.throws(
    () => implementation.assertReady(),
    (error) => error.code === "NOTIFICATION_DELIVERY_FOUNDATION_DISABLED"
  );
  assert.equal(connection.state.calls.length, 0);
  assert.equal("send" in implementation, false);
  const legacyModule = require("../src/mysqlNotificationDeliveryUniquenessAdapter");
  assert.deepEqual(Object.keys(legacyModule), ["createMysqlNotificationDeliveryCore"]);
  assert.equal("createMysqlNotificationDeliveryUniquenessAdapter" in legacyModule, false);
});

test("the Module rejects extra credential and phone fields instead of persisting them", () => {
  assert.throws(
    () => normalizeDecision({ ...decisionInput(), phone: "13800000000" }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.throws(
    () => normalizeCompleteAttempt({
      attemptId: "attempt_1",
      leaseOwner: "npc_test_owner_1",
      leaseGeneration: 1,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_A,
      nextTransitionFenceDigest: DIGEST_B,
      outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
      providerReceiptDigest: null,
      providerReceiptDigestScheme: null,
      providerReceiptDigestKeyId: null,
      stableErrorCode: null,
      completedAt: "2026-07-18T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.throws(
    () => normalizeCompleteAttempt({
      attemptId: "attempt_1",
      leaseOwner: "npc_test_owner_1",
      leaseGeneration: 1,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_A,
      nextTransitionFenceDigest: DIGEST_B,
      outcome: SEND_ATTEMPT_STATUS.FAILED,
      providerReceiptDigest: null,
      providerReceiptDigestScheme: null,
      providerReceiptDigestKeyId: null,
      stableErrorCode: "PROVIDER_CONFIRMED_NOT_SENT",
      completedAt: "2026-07-18T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.equal(
    normalizeCompleteAttempt({
      attemptId: "attempt_1",
      leaseOwner: "npc_test_owner_1",
      leaseGeneration: 1,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_A,
      nextTransitionFenceDigest: DIGEST_B,
      outcome: SEND_ATTEMPT_STATUS.REJECTED,
      providerReceiptDigest: null,
      providerReceiptDigestScheme: null,
      providerReceiptDigestKeyId: null,
      stableErrorCode: "PROVIDER_CONFIRMED_NOT_SENT",
      completedAt: "2026-07-18T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }).outcome,
    SEND_ATTEMPT_STATUS.REJECTED
  );
  assert.throws(
    () => normalizeDecision(decisionInput({ nativeDecision: "REQUESTED" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.throws(
    () => normalizeDecision(decisionInput({ reasonCode: "USER_REJECTED" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.equal(
    normalizeDecision(decisionInput({
      nativeDecision: NATIVE_DECISION_STATUS.PLATFORM_DISABLED,
      reasonCode: "PLATFORM_DISABLED",
    })).nativeDecision,
    NATIVE_DECISION_STATUS.PLATFORM_DISABLED
  );
  assert.equal(
    normalizeDecision(decisionInput({
      nativeDecision: NATIVE_DECISION_STATUS.OUTCOME_UNKNOWN,
      reasonCode: "OUTCOME_UNKNOWN",
    })).nativeDecision,
    NATIVE_DECISION_STATUS.OUTCOME_UNKNOWN
  );
  assert.throws(
    () => normalizeCompleteAttempt({
      attemptId: "attempt_1",
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_A,
      nextTransitionFenceDigest: DIGEST_B,
      outcome: SEND_ATTEMPT_STATUS.UNKNOWN,
      providerReceiptDigest: null,
      providerReceiptDigestScheme: null,
      providerReceiptDigestKeyId: null,
      stableErrorCode: "SEND_FAILED",
      completedAt: "2026-07-18T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
});

test("provider-call START strictly normalizes the current recipient identity facts", () => {
  const valid = {
    attemptId: "attempt_1",
    leaseOwner: "npc_test_owner_1",
    leaseGeneration: 1,
    requestDigest: DIGEST_A,
    recipientBindingDigest: DIGEST_F,
    recipientWechatIdentityId: "wxi_recipient_1",
    recipientRootUserId: "root_user_1",
    recipientAppCode: "MYROOT",
    recipientOpenid: "openid_recipient_1",
    releaseId: RELEASE_ID,
  };
  assert.deepEqual(normalizeStartProviderCall(valid), valid);
  for (const mutation of [
    { recipientWechatIdentityId: " wxi_recipient_1" },
    { recipientRootUserId: "root user 1" },
    { recipientAppCode: "ROOT_MEMBER_CENTER" },
    { recipientOpenid: "openid+recipient" },
    { recipientOpenid: "openid_recipient_1 " },
  ]) {
    assert.throws(
      () => normalizeStartProviderCall({ ...valid, ...mutation }),
      (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
    );
  }
  assert.throws(
    () => normalizeStartProviderCall({ ...valid, phone: "13800000000" }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
});

test("provider receipt evidence uses a purpose-separated keyed HMAC without exposing the key or raw receipt", () => {
  const first = receiptDigestCodec().digest("WECHAT", "wechat-msgid:test-only");
  const repeated = receiptDigestCodec().digest("WECHAT", "wechat-msgid:test-only");
  const rotated = receiptDigestCodec(
    "different-test-notification-receipt-hmac-key-2026-07",
    "notification-test-key-v2"
  ).digest("WECHAT", "wechat-msgid:test-only");
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.digest, repeated.digest);
  assert.notEqual(first.digest, "fddd94e82fa3ca1bf80baccfc3554140eb37786bce26975aba64a5964ec51ac8");
  assert.notEqual(first.digest, rotated.digest);
  assert.equal(first.digestScheme, "hmac-sha256:v1");
  assert.equal(first.keyId, RECEIPT_HMAC_KEY_ID);
  assert.equal(JSON.stringify(first).includes(RECEIPT_HMAC_SECRET), false);
  assert.equal(JSON.stringify(first).includes("wechat-msgid:test-only"), false);
  assert.throws(
    () => createProviderReceiptDigestCodec({ env: {} }),
    (error) => error.code === "NOTIFICATION_RECEIPT_DIGEST_KEY_INVALID"
  );
});

test("timestamps require canonical UTC round-trip and persist as MySQL +08:00 wall time", async () => {
  assert.throws(
    () => normalizeDecision(decisionInput({ decidedAt: "2026-02-30T10:00:00.000Z" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.throws(
    () => normalizeDecision(decisionInput({ decidedAt: "2026-07-17T24:00:00.000Z" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );

  const connection = createFakeConnection();
  const implementation = core(connection);
  const decision = await implementation.recordDecision(decisionInput());
  const job = await implementation.schedule(scheduleInput(decision.grantId));
  await implementation.beginSendAttempt({
    jobId: job.jobId,
    requestDigest: DIGEST_A,
    transitionFenceDigest: DIGEST_B,
    startedAt: "2026-07-18T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  const insertDecision = connection.state.calls.find(({ sql }) => sql.includes("notification-delivery:insert-decision"));
  const insertJob = connection.state.calls.find(({ sql }) => sql.includes("notification-delivery:insert-job"));
  const insertAttempt = connection.state.calls.find(({ sql }) => sql.includes("notification-delivery:insert-attempt"));
  assert.equal(insertDecision.values[9], "2026-07-17 18:00:00.000");
  assert.equal(insertJob.values[6], "2026-07-18 09:00:00.000");
  assert.equal(insertAttempt.values[4], "2026-07-18 08:59:00.000");
});

test("grantRequest and task occurrence conflicts return the original fact or require review", async () => {
  const connection = createFakeConnection();
  const implementation = core(connection);
  const first = await implementation.recordDecision(decisionInput());
  const replay = await implementation.recordDecision(decisionInput());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.attemptId, first.attemptId);
  assert.equal(connection.state.decisions.length, 1);
  assert.equal(connection.state.grants.length, 1);
  await assert.rejects(
    implementation.recordDecision(decisionInput({ taskId: "task_2", idempotencyKey: "decision-idem-2" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  await assert.rejects(
    implementation.recordDecision(decisionInput({ grantRequestId: "grant-request-2", idempotencyKey: "decision-idem-2" })),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
});

test("decision replay verifies the accepted grant identity instead of trusting only its foreign key", async () => {
  for (const damage of [
    (grant) => { grant.root_user_id = "root_user_damaged"; },
    (grant) => { grant.task_id = "task_damaged"; },
    (grant) => { grant.task_occurrence_date = "2026-07-19"; },
    (grant) => { grant.template_version = "tpl-damaged"; },
    (grant) => { grant.grant_request_id = "grant-request-damaged"; },
    (grant) => { grant.release_id = "release-damaged"; },
  ]) {
    const connection = createFakeConnection();
    const implementation = core(connection);
    await implementation.recordDecision(decisionInput());
    damage(connection.state.grants[0]);
    await assert.rejects(
      implementation.recordDecision(decisionInput()),
      (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );
  }
});

test("one grant and one occurrence produce exactly one job", async () => {
  const connection = createFakeConnection();
  const implementation = core(connection);
  const decision = await implementation.recordDecision(decisionInput());
  const first = await implementation.schedule(scheduleInput(decision.grantId));
  connection.state.grants[0].task_occurrence_date = new Date("2026-07-17T16:00:00.000Z");
  connection.state.jobs[0].task_occurrence_date = new Date("2026-07-17T16:00:00.000Z");
  const replay = await implementation.schedule(scheduleInput(decision.grantId));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.jobId, first.jobId);
  assert.equal(connection.state.jobs.length, 1);
  assert.equal(connection.state.grants[0].reserved_job_id, first.jobId);
  for (const divergence of [
    { dueAt: "2026-07-18T01:00:01.000Z" },
    { idempotencyKey: "schedule-idem-divergent" },
  ]) {
    await assert.rejects(
      implementation.schedule(scheduleInput(decision.grantId, divergence)),
      (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );
  }
  assert.throws(
    () => implementation.schedule({ ...scheduleInput(decision.grantId), requestDigest: DIGEST_B }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  connection.state.grants[0].reserved_job_id = "ntj_damaged_projection";
  await assert.rejects(
    implementation.schedule(scheduleInput(decision.grantId)),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
});

test("BEGIN failure before any business write retires the connection and reports persistence failure", async () => {
  const primary = createFakeConnection();
  const pool = sequentialPool(primary);
  primary.state.beginFailures.push(Object.assign(new Error("begin acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const implementation = core(pool);
  await assert.rejects(
    implementation.recordDecision(decisionInput()),
    (error) => error.code === "NOTIFICATION_DELIVERY_PERSISTENCE_FAILED"
  );
  assert.equal(pool.getConnectionCount, 1);
  assert.equal(primary.state.destroyCount, 1);
  assert.equal(primary.state.releaseCount, 0);
  assert.equal(primary.state.rollbackCount, 0);
  assert.equal(primary.state.decisions.length, 0);
  assert.equal(primary.state.grants.length, 0);
  assert.equal(
    primary.state.calls.some(({ sql }) => sql.includes("notification-delivery:insert-")),
    false
  );
  assert.equal(
    primary.state.calls.filter(({ sql }) => sql === "SET SESSION time_zone = '+08:00'").length,
    1
  );
});

test("COMMIT acknowledgement unknown retires the connection and recovers an exact decision", async () => {
  const primary = createFakeConnection();
  const readback = createFakeConnection(primary.state);
  const pool = sequentialPool(primary, readback);
  primary.state.commitFailures.push(Object.assign(new Error("commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const result = await core(pool).recordDecision(decisionInput());
  assert.equal(result.replayed, true);
  assert.equal(result.commitAcknowledgementRecovered, true);
  assert.equal(result.transactionState, "ACKNOWLEDGEMENT_RECOVERED");
  assert.equal(primary.state.decisions.length, 1);
  assert.equal(primary.state.grants.length, 1);
  assert.equal(primary.state.destroyCount, 1);
  assert.equal(primary.state.releaseCount, 1);
  assert.equal(primary.state.rollbackCount, 1);
  assert.equal(pool.getConnectionCount, 2);
});

test("schedule COMMIT acknowledgement recovery requires exact due time and request identity", async () => {
  const seed = createFakeConnection();
  const decision = await core(seed).recordDecision(decisionInput());
  const primary = createFakeConnection(seed.state);
  const readback = createFakeConnection(seed.state);
  const pool = sequentialPool(primary, readback);
  seed.state.commitFailures.push(Object.assign(new Error("commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const result = await core(pool).schedule(scheduleInput(decision.grantId));
  assert.equal(result.replayed, true);
  assert.equal(result.commitAcknowledgementRecovered, true);
  assert.equal(result.transactionState, "ACKNOWLEDGEMENT_RECOVERED");
  assert.equal(seed.state.jobs.length, 1);
  assert.equal(seed.state.jobs[0].due_at, "2026-07-18 09:00:00.000");
  assert.equal(seed.state.jobs[0].idempotency_key, "schedule-idem-1");
  assert.match(seed.state.jobs[0].request_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(seed.state.jobs[0].request_digest, DIGEST_A);
  assert.equal(seed.state.grants[0].reserved_job_id, result.jobId);
  assert.equal(seed.state.destroyCount, 1);
  assert.equal(pool.getConnectionCount, 2);
});

test("the Core commits one attempt but never authorizes a provider call", async () => {
  const { connection, implementation, decision, job, attempt } = await preparedAttempt();
  assert.equal(attempt.status, SEND_ATTEMPT_STATUS.REQUESTED);
  assert.equal(attempt.providerCallAuthorized, false);
  assert.equal(attempt.providerCallCheckpointRequired, true);
  assert.equal(attempt.replayed, false);
  assert.equal(attempt.attemptNumber, 1);
  const replay = await implementation.beginSendAttempt({
    jobId: job.jobId,
    requestDigest: DIGEST_A,
    transitionFenceDigest: DIGEST_B,
    startedAt: "2026-07-18T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  assert.equal(replay.attemptId, attempt.attemptId);
  assert.equal(replay.providerCallAuthorized, false);
  assert.equal(replay.providerCallCheckpointRequired, true);
  assert.equal(replay.replayed, true);
  assert.equal(connection.state.attempts.length, 1);
  assert.equal(connection.state.transitions.length, 1);
  for (const divergence of [
    { transitionFenceDigest: DIGEST_C },
    { startedAt: "2026-07-18T01:00:00.000Z" },
  ]) {
    await assert.rejects(
      implementation.beginSendAttempt({
        jobId: job.jobId,
        requestDigest: DIGEST_A,
        transitionFenceDigest: DIGEST_B,
        startedAt: "2026-07-18T00:59:00.000Z",
        releaseId: RELEASE_ID,
        ...divergence,
      }),
      (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );
  }
  const scheduleReplay = await implementation.schedule(scheduleInput(decision.grantId));
  assert.equal(scheduleReplay.jobId, job.jobId);
  assert.equal(scheduleReplay.replayed, true);
});

test("provider-call claim is single-owner and expired LEASED takeover increments generation", async () => {
  const { connection, implementation, attempt } = await preparedAttempt();
  const first = await implementation.claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  const competing = await core(createFakeConnection(connection.state)).claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(first.leaseAcquired, true);
  assert.equal(first.leaseGeneration, 1);
  assert.equal(first.leaseOwner.length, 32);
  assert.match(first.leaseOwner, /^npc_[0-9a-f]{28}$/);
  assert.equal(competing.leaseAcquired, false);

  connection.state.now = connection.state.attempts[0].provider_call_lease_expires_at;
  const takeover = await core(createFakeConnection(connection.state)).claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(takeover.leaseAcquired, true);
  assert.equal(takeover.leaseGeneration, 2);
  assert.equal(takeover.leaseOwner.length, 32);
  assert.notEqual(takeover.leaseOwner, first.leaseOwner);

  const oldOwnerStart = await implementation.startProviderCall({
    attemptId: attempt.attemptId,
    leaseOwner: first.leaseOwner,
    leaseGeneration: first.leaseGeneration,
    requestDigest: attempt.requestDigest,
    recipientBindingDigest: attempt.recipientBindingDigest,
    ...currentRecipientFacts(connection, attempt),
    releaseId: RELEASE_ID,
  });
  assert.equal(oldOwnerStart.providerCallStarted, false);
  assert.equal(oldOwnerStart.fenced, true);

  const currentOwnerStart = await implementation.startProviderCall({
    attemptId: attempt.attemptId,
    leaseOwner: takeover.leaseOwner,
    leaseGeneration: takeover.leaseGeneration,
    requestDigest: attempt.requestDigest,
    recipientBindingDigest: attempt.recipientBindingDigest,
    ...currentRecipientFacts(connection, attempt),
    releaseId: RELEASE_ID,
  });
  assert.equal(currentOwnerStart.providerCallStarted, true);
  assert.equal(currentOwnerStart.providerCallState, "STARTED");

  const ordinaryReplay = await core(createFakeConnection(connection.state)).startProviderCall({
    attemptId: attempt.attemptId,
    leaseOwner: takeover.leaseOwner,
    leaseGeneration: takeover.leaseGeneration,
    requestDigest: attempt.requestDigest,
    recipientBindingDigest: attempt.recipientBindingDigest,
    ...currentRecipientFacts(connection, attempt),
    releaseId: RELEASE_ID,
  });
  assert.equal(ordinaryReplay.providerCallStarted, false);
  assert.equal(ordinaryReplay.providerCallAlreadyStarted, true);
  assert.equal(ordinaryReplay.fenced, true);
  assert.equal(ordinaryReplay.replayed, true);
  assert.equal(ordinaryReplay.commitAcknowledgementRecovered, false);
  assert.equal(connection.state.attempts[0].provider_call_state, "STARTED");

  await assert.rejects(
    implementation.completeSendAttempt({
      attemptId: attempt.attemptId,
      leaseOwner: first.leaseOwner,
      leaseGeneration: first.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_C,
      outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
      providerReceipt: "wechat-msgid:fenced-old-owner",
      stableErrorCode: null,
      completedAt: "2026-07-18T01:00:31.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  assert.equal(connection.state.attempts[0].status, SEND_ATTEMPT_STATUS.REQUESTED);
  assert.equal(connection.state.attempts[0].provider_call_state, "STARTED");
});

test("atomic START fences cross-instance recipient-binding drift after authoritative readback", async () => {
  const { connection, implementation, attempt } = await preparedAttempt();
  const claim = await implementation.claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  const competingInstance = createFakeConnection(connection.state);
  connection.state.beforeStartProviderCallUpdate = ({ grant }) => {
    assert.equal(grant.recipient_binding_digest, attempt.recipientBindingDigest);
    competingInstance.state.grants.find((item) => {
      return item.notification_subscription_grant_id === grant.notification_subscription_grant_id;
    }).recipient_binding_digest = DIGEST_E;
  };
  const recipientFacts = currentRecipientFacts(connection, attempt);

  const fenced = await core(createFakeConnection(connection.state)).startProviderCall({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    requestDigest: attempt.requestDigest,
    recipientBindingDigest: attempt.recipientBindingDigest,
    ...recipientFacts,
    releaseId: RELEASE_ID,
  });

  assert.equal(fenced.providerCallStarted, false);
  assert.equal(fenced.fenced, true);
  assert.equal(connection.state.attempts[0].provider_call_state, "LEASED");
  assert.equal(connection.state.grants[0].recipient_binding_digest, DIGEST_E);
  const startCall = connection.state.calls.find((call) => {
    return call.sql.includes("notification-delivery:start-provider-call");
  });
  assert.ok(startCall);
  assert.match(startCall.sql, /attempt\.provider_call_generation = \?/);
  assert.match(startCall.sql, /grant\.recipient_binding_digest = \?/);
  assert.match(startCall.sql, /grant\.reserved_job_id = attempt\.notification_job_id/);
  assert.match(startCall.sql, /INNER JOIN wechat_identity AS recipient_identity/);
  assert.match(startCall.sql, /BINARY recipient_identity\.wechat_identity_id = BINARY \?/);
  assert.match(startCall.sql, /BINARY recipient_identity\.root_user_id = BINARY \?/);
  assert.match(startCall.sql, /BINARY recipient_identity\.app_code = BINARY \?/);
  assert.match(startCall.sql, /BINARY recipient_identity\.openid = BINARY \?/);
  assert.match(
    startCall.sql,
    /BINARY job\.root_user_id = BINARY subscription_grant\.root_user_id/
  );
  assert.match(
    startCall.sql,
    /BINARY subscription_grant\.root_user_id = BINARY recipient_identity\.root_user_id/
  );
  assert.match(
    startCall.sql,
    /BINARY subscription_grant\.recipient_app_code = BINARY recipient_identity\.app_code/
  );
  assert.deepEqual(startCall.values, [
    attempt.attemptId,
    claim.leaseOwner,
    claim.leaseGeneration,
    attempt.requestDigest,
    RELEASE_ID,
    RELEASE_ID,
    RELEASE_ID,
    attempt.recipientBindingDigest,
    recipientFacts.recipientWechatIdentityId,
    recipientFacts.recipientRootUserId,
    recipientFacts.recipientAppCode,
    recipientFacts.recipientOpenid,
  ]);
});

test("atomic START fences same-id current WeChat identity drift across instances", async (t) => {
  for (const scenario of [
    { name: "openid", field: "openid", value: "openid_changed_after_checkpoint" },
    { name: "root", field: "root_user_id", value: "root_user_changed" },
    { name: "app", field: "app_code", value: "ROOT_MEMBER_CENTER" },
  ]) {
    await t.test(scenario.name, async () => {
      const { connection, implementation, attempt } = await preparedAttempt();
      const claim = await implementation.claimProviderCall({
        attemptId: attempt.attemptId,
        releaseId: RELEASE_ID,
      });
      const expectedRecipientFacts = currentRecipientFacts(connection, attempt);
      const competingInstance = createFakeConnection(connection.state);
      const identitySelected = deferred();
      const allowStartUpdate = deferred();
      connection.state.beforeStartProviderCallUpdate = async ({ recipientIdentity }) => {
        identitySelected.resolve(recipientIdentity.wechat_identity_id);
        await allowStartUpdate.promise;
      };

      const startPromise = core(createFakeConnection(connection.state)).startProviderCall({
        attemptId: attempt.attemptId,
        leaseOwner: claim.leaseOwner,
        leaseGeneration: claim.leaseGeneration,
        requestDigest: attempt.requestDigest,
        recipientBindingDigest: attempt.recipientBindingDigest,
        ...expectedRecipientFacts,
        releaseId: RELEASE_ID,
      });
      assert.equal(await identitySelected.promise, expectedRecipientFacts.recipientWechatIdentityId);
      const competingIdentity = competingInstance.state.identities.find((item) => {
        return item.wechat_identity_id === expectedRecipientFacts.recipientWechatIdentityId;
      });
      competingIdentity[scenario.field] = scenario.value;
      allowStartUpdate.resolve();
      const fenced = await startPromise;

      assert.equal(fenced.providerCallStarted, false);
      assert.equal(fenced.fenced, true);
      assert.equal(connection.state.attempts[0].provider_call_state, "LEASED");
      assert.equal(connection.state.identities[0].wechat_identity_id,
        expectedRecipientFacts.recipientWechatIdentityId);
      assert.equal(connection.state.identities[0][scenario.field], scenario.value);
    });
  }
});

test("ordinary STARTED replay cannot become authorized through a lost COMMIT acknowledgement", async () => {
  const { connection, attempt, claim } = await preparedStartedProviderCall();
  const startUpdateCount = connection.state.calls.filter((call) => {
    return call.sql.includes("notification-delivery:start-provider-call");
  }).length;
  connection.state.commitFailures.push(Object.assign(new Error("replay commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));

  await assert.rejects(
    core(createFakeConnection(connection.state)).startProviderCall({
      attemptId: attempt.attemptId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      requestDigest: attempt.requestDigest,
      recipientBindingDigest: attempt.recipientBindingDigest,
      ...currentRecipientFacts(connection, attempt),
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN"
  );

  assert.equal(connection.state.attempts[0].provider_call_state, "STARTED");
  assert.equal(connection.state.calls.filter((call) => {
    return call.sql.includes("notification-delivery:start-provider-call");
  }).length, startUpdateCount);
});

test("STARTED is never taken over; expiry recovery persists UNKNOWN and fences late completion", async () => {
  const { connection, implementation, attempt, claim } = await preparedStartedProviderCall();
  connection.state.now = connection.state.attempts[0].provider_call_lease_expires_at;

  const forbiddenTakeover = await core(createFakeConnection(connection.state)).claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(forbiddenTakeover.leaseAcquired, false);

  const recovered = await core(createFakeConnection(connection.state)).recoverProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(recovered.providerCallRecoveredUnknown, true);
  assert.equal(recovered.status, SEND_ATTEMPT_STATUS.UNKNOWN);
  assert.equal(connection.state.attempts[0].provider_call_state, "COMPLETED");
  assert.equal(connection.state.jobs[0].status, "OUTCOME_UNKNOWN");
  assert.equal(connection.state.grants[0].status, "REVIEW_REQUIRED");

  await assert.rejects(
    implementation.completeSendAttempt({
      attemptId: attempt.attemptId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_C,
      outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
      providerReceipt: "wechat-msgid:late-owner",
      stableErrorCode: null,
      completedAt: "2026-07-18T01:00:31.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  assert.equal(connection.state.attempts[0].status, SEND_ATTEMPT_STATUS.UNKNOWN);
});

test("independent Core instances derive one stable recovery fence and replay UNKNOWN", async () => {
  const { connection, implementation, attempt } = await preparedStartedProviderCall();
  connection.state.now = connection.state.attempts[0].provider_call_lease_expires_at;

  const first = await implementation.recoverProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  const persistedFence = connection.state.attempts[0].transition_fence_digest;
  const second = await core(createFakeConnection(connection.state)).recoverProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });

  assert.equal(first.providerCallRecoveredUnknown, true);
  assert.equal(first.replayed, false);
  assert.equal(second.providerCallRecoveredUnknown, true);
  assert.equal(second.replayed, true);
  assert.equal(second.transitionFenceDigest, persistedFence);
  assert.match(persistedFence, /^[0-9a-f]{64}$/);
  assert.equal(connection.state.transitions.length, 2);
  assert.equal(connection.state.transitions[1].transition_fence_digest, persistedFence);
});

test("current STARTED owner may complete after lease expiry when recovery has not won", async () => {
  const { connection, implementation, attempt, claim } = await preparedStartedProviderCall();
  connection.state.now = connection.state.attempts[0].provider_call_lease_expires_at;
  const completed = await implementation.completeSendAttempt({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
    providerReceipt: "wechat-msgid:late-but-owned",
    stableErrorCode: null,
    completedAt: "2026-07-18T01:00:31.000Z",
    releaseId: RELEASE_ID,
  });
  assert.equal(completed.status, SEND_ATTEMPT_STATUS.ACCEPTED);
  assert.equal(connection.state.jobs[0].status, "PROVIDER_ACCEPTED");
});

test("claim and STARTED checkpoint COMMIT acknowledgement recovery preserves one owner generation", async () => {
  const { connection, attempt } = await preparedAttempt();
  connection.state.commitFailures.push(Object.assign(new Error("claim commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const claim = await core(sequentialPool(
    createFakeConnection(connection.state),
    createFakeConnection(connection.state)
  )).claimProviderCall({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(claim.leaseAcquired, true);
  assert.equal(claim.commitAcknowledgementRecovered, true);
  assert.equal(connection.state.attempts[0].provider_call_owner, claim.leaseOwner);
  assert.equal(connection.state.attempts[0].provider_call_generation, claim.leaseGeneration);

  connection.state.commitFailures.push(Object.assign(new Error("start commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const started = await core(sequentialPool(
    createFakeConnection(connection.state),
    createFakeConnection(connection.state)
  )).startProviderCall({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    requestDigest: attempt.requestDigest,
    recipientBindingDigest: attempt.recipientBindingDigest,
    ...currentRecipientFacts(connection, attempt),
    releaseId: RELEASE_ID,
  });
  assert.equal(started.providerCallStarted, true);
  assert.equal(started.replayed, true);
  assert.equal(started.commitAcknowledgementRecovered, true);
  assert.equal(started.leaseOwner, claim.leaseOwner);
  assert.equal(started.leaseGeneration, claim.leaseGeneration);
  assert.equal("recipientOpenid" in started, false);
  assert.equal(JSON.stringify(started).includes(
    currentRecipientFacts(connection, attempt).recipientOpenid
  ), false);
});

test("START COMMIT acknowledgement readback re-fences current WeChat identity drift", async (t) => {
  for (const scenario of [
    { name: "openid", field: "openid", value: "openid_changed_before_readback" },
    { name: "root", field: "root_user_id", value: "root_user_changed" },
    { name: "app", field: "app_code", value: "ROOT_MEMBER_CENTER" },
  ]) {
    await t.test(scenario.name, async () => {
      const { connection, implementation, attempt } = await preparedAttempt();
      const claim = await implementation.claimProviderCall({
        attemptId: attempt.attemptId,
        releaseId: RELEASE_ID,
      });
      const expectedRecipientFacts = currentRecipientFacts(connection, attempt);
      connection.state.commitFailures.push(Object.assign(new Error("start commit acknowledgement lost"), {
        code: "PROTOCOL_CONNECTION_LOST",
      }));
      connection.state.afterCommitAcknowledgementLoss = ({ state }) => {
        const identity = state.identities.find((item) => {
          return item.wechat_identity_id === expectedRecipientFacts.recipientWechatIdentityId;
        });
        identity[scenario.field] = scenario.value;
      };

      const fenced = await core(sequentialPool(
        createFakeConnection(connection.state),
        createFakeConnection(connection.state)
      )).startProviderCall({
        attemptId: attempt.attemptId,
        leaseOwner: claim.leaseOwner,
        leaseGeneration: claim.leaseGeneration,
        requestDigest: attempt.requestDigest,
        recipientBindingDigest: attempt.recipientBindingDigest,
        ...expectedRecipientFacts,
        releaseId: RELEASE_ID,
      });

      assert.equal(fenced.providerCallStarted, false);
      assert.equal(fenced.currentRecipientIdentityFenced, true);
      assert.equal(fenced.fenced, true);
      assert.equal(fenced.commitAcknowledgementRecovered, true);
      assert.equal(connection.state.attempts[0].provider_call_state, "STARTED");
      assert.equal(connection.state.identities[0].wechat_identity_id,
        expectedRecipientFacts.recipientWechatIdentityId);
      assert.equal(connection.state.identities[0][scenario.field], scenario.value);
    });
  }
});

test("read-only inspection validates attempt, job, grant, and current transition without raw receipt", async () => {
  const { connection, implementation, attempt, claim } = await preparedStartedProviderCall();
  const requested = await implementation.inspectSendAttempt({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(requested.status, SEND_ATTEMPT_STATUS.REQUESTED);
  assert.equal(requested.inspected, true);
  assert.equal(requested.transactionState, "READ_ONLY_ROLLBACK");
  assert.equal(requested.providerCallAuthorized, false);
  assert.equal(requested.providerCallCheckpointRequired, true);
  assert.equal("providerReceipt" in requested, false);
  assert.equal("recipientOpenid" in requested, false);
  assert.equal(JSON.stringify(requested).includes(
    currentRecipientFacts(connection, attempt).recipientOpenid
  ), false);

  await implementation.completeSendAttempt({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: SEND_ATTEMPT_STATUS.UNKNOWN,
    providerReceipt: null,
    stableErrorCode: "PROVIDER_RESULT_UNKNOWN",
    completedAt: "2026-07-18T01:00:01.000Z",
    releaseId: RELEASE_ID,
  });
  const terminal = await implementation.inspectSendAttempt({
    attemptId: attempt.attemptId,
    releaseId: RELEASE_ID,
  });
  assert.equal(terminal.status, SEND_ATTEMPT_STATUS.UNKNOWN);
  assert.equal(terminal.stableErrorCode, "PROVIDER_RESULT_UNKNOWN");
  assert.equal(terminal.providerReceiptDigest, null);
  assert.equal("providerReceipt" in terminal, false);
  assert.equal(connection.state.jobs[0].status, "OUTCOME_UNKNOWN");
  assert.equal(connection.state.grants[0].status, "REVIEW_REQUIRED");
  assert.equal(
    connection.state.calls.filter(({ sql }) => sql === "SET TRANSACTION READ ONLY").length,
    2
  );

  connection.state.jobs[0].status = "FAILED";
  await assert.rejects(
    implementation.inspectSendAttempt({ attemptId: attempt.attemptId, releaseId: RELEASE_ID }),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
});

test("begin attempt COMMIT acknowledgement recovery requires the exact three-layer projection", async () => {
  const connection = createFakeConnection();
  const implementation = core(connection);
  const decision = await implementation.recordDecision(decisionInput());
  const job = await implementation.schedule(scheduleInput(decision.grantId));
  const primary = createFakeConnection(connection.state);
  const readback = createFakeConnection(connection.state);
  const pool = sequentialPool(primary, readback);
  connection.state.commitFailures.push(Object.assign(new Error("commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const attempt = await core(pool).beginSendAttempt({
    jobId: job.jobId,
    requestDigest: DIGEST_A,
    transitionFenceDigest: DIGEST_B,
    startedAt: "2026-07-18T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  assert.equal(attempt.replayed, true);
  assert.equal(attempt.commitAcknowledgementRecovered, true);
  assert.equal(attempt.transactionState, "ACKNOWLEDGEMENT_RECOVERED");
  assert.equal(connection.state.attempts.length, 1);
  assert.equal(connection.state.jobs[0].send_attempt_id, attempt.attemptId);
  assert.equal(connection.state.grants[0].status, "RESERVED");
  assert.equal(connection.state.destroyCount, 1);
  assert.equal(pool.getConnectionCount, 2);
});

test("begin replay rejects damaged job and grant projections", async () => {
  for (const damage of [
    ({ job }) => { job.status = "SCHEDULED"; },
    ({ job }) => { job.send_attempt_id = null; },
    ({ grant }) => { grant.status = "AVAILABLE"; },
    ({ grant }) => { grant.reserved_job_id = "ntj_damaged_projection"; },
    ({ grant }) => { grant.release_id = "release-damaged"; },
    ({ grant }) => { grant.status_reason_code = "PROVIDER_RESULT_UNKNOWN"; },
    ({ attempt }) => { attempt.transition_fence_digest = DIGEST_C; },
    ({ attempt }) => { attempt.started_at = "2026-07-18 09:00:00.000"; },
    ({ attempt }) => { attempt.completed_at = "2026-07-18 09:00:00.000"; },
    ({ transition }) => { transition.to_status = SEND_ATTEMPT_STATUS.ACCEPTED; },
    ({ transition }) => { transition.transition_fence_digest = DIGEST_C; },
  ]) {
    const { connection, implementation, job } = await preparedAttempt();
    damage({
      job: connection.state.jobs[0],
      grant: connection.state.grants[0],
      attempt: connection.state.attempts[0],
      transition: connection.state.transitions[0],
    });
    await assert.rejects(
      implementation.beginSendAttempt({
        jobId: job.jobId,
        requestDigest: DIGEST_A,
        transitionFenceDigest: DIGEST_B,
        startedAt: "2026-07-18T00:59:00.000Z",
        releaseId: RELEASE_ID,
      }),
      (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );
  }
});

test("first begin rejects a damaged AVAILABLE grant before creating attempt state", async () => {
  for (const damage of [
    (grant) => { grant.release_id = "release-damaged"; },
    (grant) => { grant.status_reason_code = "PROVIDER_RESULT_UNKNOWN"; },
  ]) {
    const connection = createFakeConnection();
    const implementation = core(connection);
    const decision = await implementation.recordDecision(decisionInput());
    const job = await implementation.schedule(scheduleInput(decision.grantId));
    damage(connection.state.grants[0]);
    await assert.rejects(
      implementation.beginSendAttempt({
        jobId: job.jobId,
        requestDigest: DIGEST_A,
        transitionFenceDigest: DIGEST_B,
        startedAt: "2026-07-18T00:59:00.000Z",
        releaseId: RELEASE_ID,
      }),
      (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
    );
    assert.equal(connection.state.attempts.length, 0);
    assert.equal(connection.state.transitions.length, 0);
    assert.equal(connection.state.jobs[0].status, "SCHEDULED");
  }
});

test("provider ACCEPTED is auditable but never projected as device delivered", async () => {
  const { connection, implementation, attempt, claim } = await preparedStartedProviderCall();
  const completed = await implementation.completeSendAttempt({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: PROVIDER_OUTCOME_STATUS.ACCEPTED,
    providerReceipt: "wechat-msgid:accepted-1",
    stableErrorCode: null,
    completedAt: "2026-07-18T01:00:01.000Z",
    releaseId: RELEASE_ID,
  });
  assert.equal(completed.status, SEND_ATTEMPT_STATUS.ACCEPTED);
  assert.equal(completed.providerAccepted, true);
  assert.equal(completed.deviceDeliveryStatus, "NOT_VERIFIED");
  assert.equal(completed.providerCallAuthorized, false);
  assert.equal(completed.providerCallCheckpointRequired, false);
  assert.equal(connection.state.jobs[0].status, "PROVIDER_ACCEPTED");
  assert.equal(connection.state.grants[0].status, "CONSUMED");
  assert.equal(connection.state.grants[0].recipient_binding_status, "VERIFIED");
  assert.equal(connection.state.grants[0].recipient_wechat_identity_id, "wxi_recipient_1");
  assert.equal(connection.state.grants[0].recipient_binding_digest, DIGEST_F);
  assert.equal(connection.state.transitions.length, 2);
  assert.match(connection.state.attempts[0].provider_receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(connection.state.attempts[0].provider_receipt_digest_scheme, "hmac-sha256:v1");
  assert.equal(connection.state.attempts[0].provider_receipt_digest_key_id, RECEIPT_HMAC_KEY_ID);
  assert.equal(completed.providerReceiptDigestScheme, "hmac-sha256:v1");
  assert.equal(completed.providerReceiptDigestKeyId, RECEIPT_HMAC_KEY_ID);
  assert.notEqual(connection.state.attempts[0].provider_receipt_digest, DIGEST_D);
  const replay = await implementation.completeSendAttempt({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: PROVIDER_OUTCOME_STATUS.ACCEPTED,
    providerReceipt: "wechat-msgid:accepted-1",
    stableErrorCode: null,
    completedAt: "2026-07-18T01:00:01.000Z",
    releaseId: RELEASE_ID,
  });
  assert.equal(replay.replayed, true);
  assert.equal(connection.state.transitions.length, 2);
});

test("terminal COMMIT acknowledgement loss without a durable commit never lets readback write or report recovery", async () => {
  const { connection, attempt, claim } = await preparedStartedProviderCall();
  const primary = createFakeConnection(connection.state);
  const readback = createFakeConnection(connection.state);
  const pool = sequentialPool(primary, readback);
  connection.state.commitFailures.push(Object.assign(new Error("commit acknowledgement lost before apply"), {
    code: "PROTOCOL_CONNECTION_LOST",
    transactionApplied: false,
  }));
  await assert.rejects(
    core(pool).completeSendAttempt({
      attemptId: attempt.attemptId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_C,
      outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
      providerReceipt: "wechat-msgid:not-durably-applied",
      stableErrorCode: null,
      completedAt: "2026-07-18T01:00:01.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN"
  );
  assert.equal(connection.state.attempts[0].status, SEND_ATTEMPT_STATUS.REQUESTED);
  assert.equal(connection.state.jobs[0].status, "SENDING");
  assert.equal(connection.state.grants[0].status, "RESERVED");
  assert.equal(connection.state.transitions.length, 1);
  assert.equal(primary.state.destroyCount, 1);
  assert.equal(readback.localCalls.some(({ sql }) => (
    sql.includes("notification-delivery:complete-attempt")
      || sql.includes("notification-delivery:insert-transition")
      || sql.includes("notification-delivery:complete-job")
      || sql.includes("notification-delivery:complete-grant")
  )), false);
});

test("terminal COMMIT acknowledgement recovery verifies attempt, job, and grant together", async () => {
  const { connection, attempt, claim } = await preparedStartedProviderCall();
  const state = connection.state;
  const primary = createFakeConnection(state);
  const readback = createFakeConnection(state);
  const pool = sequentialPool(primary, readback);
  state.commitFailures.push(Object.assign(new Error("commit acknowledgement lost"), {
    code: "PROTOCOL_CONNECTION_LOST",
  }));
  const completion = {
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
    providerReceipt: "wechat-msgid:ack-recovery-1",
    stableErrorCode: null,
    completedAt: "2026-07-18T01:00:01.000Z",
    releaseId: RELEASE_ID,
  };
  const recovered = await core(pool).completeSendAttempt(completion);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.commitAcknowledgementRecovered, true);
  assert.equal(recovered.transactionState, "ACKNOWLEDGEMENT_RECOVERED");
  assert.equal(state.attempts[0].status, SEND_ATTEMPT_STATUS.ACCEPTED);
  assert.equal(state.jobs[0].status, "PROVIDER_ACCEPTED");
  assert.equal(state.grants[0].status, "CONSUMED");
  assert.equal(state.destroyCount, 1);
  assert.equal(JSON.stringify(state.calls).includes(completion.providerReceipt), false);

  state.jobs[0].status = "FAILED";
  await assert.rejects(
    core(createFakeConnection(state)).completeSendAttempt(completion),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  state.jobs[0].status = "PROVIDER_ACCEPTED";
  state.transitions[1].provider_receipt_digest_key_id = "notification-corrupted-key";
  await assert.rejects(
    core(createFakeConnection(state)).completeSendAttempt(completion),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  state.transitions[1].provider_receipt_digest_key_id = RECEIPT_HMAC_KEY_ID;
  state.jobs[0].send_attempt_id = null;
  await assert.rejects(
    core(createFakeConnection(state)).completeSendAttempt(completion),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  state.jobs[0].send_attempt_id = attempt.attemptId;
  state.grants[0].reserved_job_id = "ntj_damaged_projection";
  await assert.rejects(
    core(createFakeConnection(state)).completeSendAttempt(completion),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
});

test("UNKNOWN, REJECTED and FAILED remain distinct terminal outcomes", async () => {
  for (const [outcome, expectedJob, expectedGrant, errorCode] of [
    [SEND_ATTEMPT_STATUS.UNKNOWN, "OUTCOME_UNKNOWN", "REVIEW_REQUIRED", "PROVIDER_RESULT_UNKNOWN"],
    [SEND_ATTEMPT_STATUS.REJECTED, "FAILED", "INVALID", "WECHAT_REJECTED"],
    [SEND_ATTEMPT_STATUS.FAILED, "FAILED", "REVIEW_REQUIRED", "SEND_FAILED"],
  ]) {
    const { connection, implementation, attempt, claim } = await preparedStartedProviderCall();
    const completed = await implementation.completeSendAttempt({
      attemptId: attempt.attemptId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_C,
      outcome,
      providerReceipt: null,
      stableErrorCode: errorCode,
      completedAt: "2026-07-18T01:00:01.000Z",
      releaseId: RELEASE_ID,
    });
    assert.equal(completed.status, outcome);
    assert.equal(completed.providerAccepted, false);
    assert.equal(completed.deviceDeliveryStatus, "NOT_VERIFIED");
    assert.equal(connection.state.jobs[0].status, expectedJob);
    assert.equal(connection.state.grants[0].status, expectedGrant);
    assert.deepEqual({
      recipient_binding_status: connection.state.grants[0].recipient_binding_status,
      recipient_wechat_identity_id: connection.state.grants[0].recipient_wechat_identity_id,
      recipient_app_code: connection.state.grants[0].recipient_app_code,
      recipient_binding_canonical_version: connection.state.grants[0].recipient_binding_canonical_version,
      recipient_binding_digest: connection.state.grants[0].recipient_binding_digest,
      recipient_binding_digest_scheme: connection.state.grants[0].recipient_binding_digest_scheme,
      recipient_binding_key_id: connection.state.grants[0].recipient_binding_key_id,
    }, {
      recipient_binding_status: "VERIFIED",
      recipient_wechat_identity_id: "wxi_recipient_1",
      recipient_app_code: "MYROOT",
      recipient_binding_canonical_version: "canonical-json:v1",
      recipient_binding_digest: DIGEST_F,
      recipient_binding_digest_scheme: "hmac-sha256:v1",
      recipient_binding_key_id: "recipient-binding-v1",
    });
  }
});

test("a divergent terminal replay is fenced for review", async () => {
  const { implementation, attempt, claim } = await preparedStartedProviderCall();
  await implementation.completeSendAttempt({
    attemptId: attempt.attemptId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: SEND_ATTEMPT_STATUS.UNKNOWN,
    providerReceipt: null,
    stableErrorCode: "PROVIDER_RESULT_UNKNOWN",
    completedAt: "2026-07-18T01:00:01.000Z",
    releaseId: RELEASE_ID,
  });
  await assert.rejects(
    implementation.completeSendAttempt({
      attemptId: attempt.attemptId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_D,
      outcome: SEND_ATTEMPT_STATUS.FAILED,
      providerReceipt: null,
      stableErrorCode: "SEND_FAILED",
      completedAt: "2026-07-18T01:00:02.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
});

test("the same provider receipt digest cannot be accepted by two jobs", async () => {
  const connection = createFakeConnection();
  const implementation = core(connection);
  const firstDecision = await implementation.recordDecision(decisionInput());
  const firstJob = await implementation.schedule(scheduleInput(firstDecision.grantId));
  const firstAttempt = await implementation.beginSendAttempt({
    jobId: firstJob.jobId,
    requestDigest: DIGEST_A,
    transitionFenceDigest: DIGEST_B,
    startedAt: "2026-07-18T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  const firstClaim = await implementation.claimProviderCall({
    attemptId: firstAttempt.attemptId,
    releaseId: RELEASE_ID,
  });
  await implementation.startProviderCall({
    attemptId: firstAttempt.attemptId,
    leaseOwner: firstClaim.leaseOwner,
    leaseGeneration: firstClaim.leaseGeneration,
    requestDigest: DIGEST_A,
    recipientBindingDigest: DIGEST_F,
    ...currentRecipientFacts(connection, firstAttempt),
    releaseId: RELEASE_ID,
  });
  await implementation.completeSendAttempt({
    attemptId: firstAttempt.attemptId,
    leaseOwner: firstClaim.leaseOwner,
    leaseGeneration: firstClaim.leaseGeneration,
    expectedTransitionVersion: 1,
    expectedTransitionFenceDigest: DIGEST_B,
    nextTransitionFenceDigest: DIGEST_C,
    outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
    providerReceipt: "wechat-msgid:shared-receipt",
    stableErrorCode: null,
    completedAt: "2026-07-18T01:00:00.000Z",
    releaseId: RELEASE_ID,
  });

  const secondDecisionInput = decisionInput({
    rootUserId: "root_user_2",
    taskId: "task_2",
    taskOccurrenceDate: "2026-07-19",
    grantRequestId: "grant-request-2",
    idempotencyKey: "decision-idem-2",
    recipientWechatIdentityId: "wxi_recipient_2",
  });
  const secondDecision = await implementation.recordDecision(secondDecisionInput);
  const secondJob = await implementation.schedule(scheduleInput(secondDecision.grantId, {
    rootUserId: secondDecisionInput.rootUserId,
    taskId: secondDecisionInput.taskId,
    taskOccurrenceDate: secondDecisionInput.taskOccurrenceDate,
    dueAt: "2026-07-19T01:00:00.000Z",
    idempotencyKey: "schedule-idem-2",
  }));
  const secondAttempt = await implementation.beginSendAttempt({
    jobId: secondJob.jobId,
    requestDigest: DIGEST_E,
    transitionFenceDigest: DIGEST_F,
    startedAt: "2026-07-19T00:59:00.000Z",
    releaseId: RELEASE_ID,
  });
  const secondClaim = await implementation.claimProviderCall({
    attemptId: secondAttempt.attemptId,
    releaseId: RELEASE_ID,
  });
  await implementation.startProviderCall({
    attemptId: secondAttempt.attemptId,
    leaseOwner: secondClaim.leaseOwner,
    leaseGeneration: secondClaim.leaseGeneration,
    requestDigest: DIGEST_E,
    recipientBindingDigest: DIGEST_F,
    ...currentRecipientFacts(connection, secondAttempt),
    releaseId: RELEASE_ID,
  });
  await assert.rejects(
    implementation.completeSendAttempt({
      attemptId: secondAttempt.attemptId,
      leaseOwner: secondClaim.leaseOwner,
      leaseGeneration: secondClaim.leaseGeneration,
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_F,
      nextTransitionFenceDigest: DIGEST_E,
      outcome: SEND_ATTEMPT_STATUS.ACCEPTED,
      providerReceipt: "wechat-msgid:shared-receipt",
      stableErrorCode: null,
      completedAt: "2026-07-19T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED"
  );
  assert.equal(connection.state.attempts[1].status, SEND_ATTEMPT_STATUS.REQUESTED);
  assert.equal(connection.state.jobs[1].status, "SENDING");
  assert.equal(connection.state.grants[1].status, "RESERVED");
});

test("Core readiness reports the transaction and digest policy without adding a sender Interface", () => {
  const implementation = core();
  assert.deepEqual(implementation.assertReady(), {
    enabled: true,
    provider: "WECHAT",
    networkEnabled: false,
    ownsTransactions: true,
    sessionTimeZone: "+08:00",
    receiptDigestScheme: "hmac-sha256:v1",
    receiptDigestKeyId: RECEIPT_HMAC_KEY_ID,
    providerCallLeaseMs: 30000,
  });
  assert.equal("send" in implementation, false);
});

test("a pool release failure retires the committed session", async () => {
  const connection = createFakeConnection();
  connection.state.releaseFailures.push(new Error("pool release failed"));
  const result = await core(connection).recordDecision(decisionInput());
  assert.equal(result.nativeDecision, NATIVE_DECISION_STATUS.ACCEPTED);
  assert.equal(connection.state.releaseCount, 0);
  assert.equal(connection.state.destroyCount, 1);
});

test("disabled Core fails closed before loading receipt keys or opening a MySQL session", async () => {
  let getConnectionCount = 0;
  const implementation = createMysqlNotificationDeliveryCore({
    async getConnection() {
      getConnectionCount += 1;
      throw new Error("disabled Core must not request a connection");
    },
  }, {
    env: {},
    randomBytes: deterministicRandomBytes(),
  });

  assert.throws(
    () => implementation.assertReady(),
    (error) => error.code === "NOTIFICATION_DELIVERY_FOUNDATION_DISABLED"
  );
  await assert.rejects(
    implementation.recordDecision(decisionInput()),
    (error) => error.code === "NOTIFICATION_DELIVERY_FOUNDATION_DISABLED"
  );
  assert.equal(getConnectionCount, 0);
});

test("invalid public inputs fail before the Core opens a transaction", async () => {
  const pool = sequentialPool();
  const implementation = core(pool);
  await assert.rejects(
    implementation.recordDecision({ ...decisionInput(), phone: "13800000000" }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  await assert.rejects(
    implementation.beginSendAttempt({
      jobId: "ntj_missing",
      requestDigest: "not-a-digest",
      transitionFenceDigest: DIGEST_B,
      startedAt: "2026-07-18T00:59:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.throws(
    () => implementation.completeSendAttempt({
      attemptId: "nsp_missing",
      expectedTransitionVersion: 1,
      expectedTransitionFenceDigest: DIGEST_B,
      nextTransitionFenceDigest: DIGEST_C,
      outcome: SEND_ATTEMPT_STATUS.FAILED,
      providerReceipt: null,
      stableErrorCode: "WECHAT_REJECTED",
      completedAt: "2026-07-18T01:00:00.000Z",
      releaseId: RELEASE_ID,
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_INPUT_INVALID"
  );
  assert.equal(pool.getConnectionCount, 0);
});

test("Core rejects injected receipt codecs so provider evidence always uses configured key material", () => {
  assert.throws(
    () => createMysqlNotificationDeliveryCore({ async getConnection() {} }, {
      env: ENABLED_ENV,
      receiptDigestCodec: receiptDigestCodec(),
    }),
    (error) => error.code === "NOTIFICATION_DELIVERY_PERSISTENCE_FAILED"
  );
});

test("production Core rejects caller-controlled identifier entropy", () => {
  const modulePath = path.resolve(__dirname, "../src/mysqlNotificationDeliveryCore.js");
  const script = `
    const { createMysqlNotificationDeliveryCore } = require(${JSON.stringify(modulePath)});
    try {
      createMysqlNotificationDeliveryCore({ async getConnection() {} }, {
        env: {},
        randomBytes: (size) => Buffer.alloc(size, 7),
      });
      process.exitCode = 2;
    } catch (error) {
      if (!error || error.code !== "NOTIFICATION_DELIVERY_PERSISTENCE_FAILED") {
        console.error(error && error.code ? error.code : String(error));
        process.exitCode = 3;
      }
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
