const POLICY_VERSION = "outbox-retry-v1";
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 300_000;
const MAX_UNSIGNED_INT = 0xFFFFFFFF;

// outbox-retry-v1 is deliberately deterministic: attempt 1 waits 5 seconds,
// each later completed attempt doubles that delay, and every delay is capped
// at 5 minutes. Any change to these values requires a new policy version.
const OUTBOX_RETRY_POLICY_V1 = Object.freeze({
  policyVersion: POLICY_VERSION,
  baseDelayMs: BASE_DELAY_MS,
  maxDelayMs: MAX_DELAY_MS,
});

const SAFE_REASON_CODES = new Set([
  "OUTBOX_DISPATCH_FAILED",
  "OUTBOX_LEASE_EXPIRED",
  "OUTBOX_PAYLOAD_INVALID",
  "OUTBOX_SCHEMA_UNSUPPORTED",
]);

function retryPolicyError() {
  const error = new Error("outbox retry policy is invalid");
  error.code = "OUTBOX_RETRY_POLICY_INVALID";
  return error;
}

function retryDecisionError() {
  const error = new Error("outbox retry decision is invalid");
  error.code = "OUTBOX_RETRY_DECISION_INVALID";
  return error;
}

function isPlainDataRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string"
      && Object.prototype.hasOwnProperty.call(descriptor, "value")
      && descriptor.enumerable;
  });
}

function hasExactKeys(value, expected) {
  const keys = Reflect.ownKeys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validateOutboxRetryPolicy(policy) {
  if (
    !isPlainDataRecord(policy)
    || !hasExactKeys(policy, ["baseDelayMs", "maxDelayMs", "policyVersion"])
    || policy.policyVersion !== POLICY_VERSION
    || !Number.isSafeInteger(policy.baseDelayMs)
    || !Number.isSafeInteger(policy.maxDelayMs)
    || policy.baseDelayMs <= 0
    || policy.maxDelayMs < policy.baseDelayMs
    || policy.baseDelayMs !== BASE_DELAY_MS
    || policy.maxDelayMs !== MAX_DELAY_MS
  ) {
    throw retryPolicyError();
  }
  return OUTBOX_RETRY_POLICY_V1;
}

function persistedAttemptCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_UNSIGNED_INT) {
    throw retryDecisionError();
  }
  return value;
}

function persistedMaxAttempts(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_UNSIGNED_INT) {
    throw retryDecisionError();
  }
  return value;
}

function retryDelayMs(attemptCount, policy = OUTBOX_RETRY_POLICY_V1) {
  const current = validateOutboxRetryPolicy(policy);
  const attempts = persistedAttemptCount(attemptCount);
  let delayMs = current.baseDelayMs;
  let remainingSteps = attempts - 1;

  // The loop is bounded by the number of doublings needed to reach the cap,
  // not by an untrusted persisted attempt count.
  while (remainingSteps > 0 && delayMs < current.maxDelayMs) {
    if (delayMs > Math.floor(current.maxDelayMs / 2)) return current.maxDelayMs;
    delayMs *= 2;
    remainingSteps -= 1;
  }
  const bounded = Math.min(delayMs, current.maxDelayMs);
  if (!Number.isSafeInteger(bounded) || bounded < 0) throw retryDecisionError();
  return bounded;
}

function safeReasonCode(value) {
  return typeof value === "string" && SAFE_REASON_CODES.has(value)
    ? value
    : "OUTBOX_DISPATCH_FAILED";
}

function decideOutboxFailure(input, policy = OUTBOX_RETRY_POLICY_V1) {
  const current = validateOutboxRetryPolicy(policy);
  if (!isPlainDataRecord(input)) throw retryDecisionError();
  const keys = Object.keys(input);
  if (
    !["attemptCount", "maxAttempts", "retryable"].every((key) => keys.includes(key))
    || keys.some((key) => !["attemptCount", "maxAttempts", "retryable", "reasonCode"].includes(key))
    || typeof input.retryable !== "boolean"
  ) {
    throw retryDecisionError();
  }

  const attemptCount = persistedAttemptCount(input.attemptCount);
  const maxAttempts = persistedMaxAttempts(input.maxAttempts);
  if (attemptCount > maxAttempts) throw retryDecisionError();
  const shouldRetry = input.retryable && attemptCount < maxAttempts;
  const delayMs = shouldRetry ? retryDelayMs(attemptCount, current) : 0;
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw retryDecisionError();

  return Object.freeze({
    kind: shouldRetry ? "RETRY" : "DEAD_LETTER",
    delayMs,
    reasonCode: safeReasonCode(input.reasonCode),
    policyVersion: current.policyVersion,
  });
}

function createOutboxRetryPolicy(policy = OUTBOX_RETRY_POLICY_V1) {
  const current = validateOutboxRetryPolicy(policy);
  const decide = Object.freeze((input) => decideOutboxFailure(input, current));
  return Object.freeze({
    policyVersion: current.policyVersion,
    decide,
  });
}

module.exports = {
  OUTBOX_RETRY_POLICY_V1,
  createOutboxRetryPolicy,
  decideOutboxFailure,
  retryDelayMs,
  validateOutboxRetryPolicy,
};
