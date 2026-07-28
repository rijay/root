const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OUTBOX_RETRY_POLICY_V1,
  createOutboxRetryPolicy,
  decideOutboxFailure,
  retryDelayMs,
  validateOutboxRetryPolicy,
} = require("../src/outboxRetryPolicy");

test("outbox-retry-v1 freezes a five-second base and five-minute cap", () => {
  assert.deepEqual(OUTBOX_RETRY_POLICY_V1, {
    policyVersion: "outbox-retry-v1",
    baseDelayMs: 5_000,
    maxDelayMs: 300_000,
  });
  assert.equal(Object.isFrozen(OUTBOX_RETRY_POLICY_V1), true);
  assert.deepEqual(validateOutboxRetryPolicy(OUTBOX_RETRY_POLICY_V1), OUTBOX_RETRY_POLICY_V1);
});

test("factory exposes the frozen retry policy interface used by dispatcher core", () => {
  const policy = createOutboxRetryPolicy();
  assert.deepEqual(Object.keys(policy).sort(), ["decide", "policyVersion"]);
  assert.equal(policy.policyVersion, "outbox-retry-v1");
  assert.equal(typeof policy.decide, "function");
  assert.equal(Object.isFrozen(policy), true);
});

test("retry delay is deterministic capped exponential backoff without jitter", () => {
  const cases = [
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [6, 160_000],
    [7, 300_000],
    [8, 300_000],
    [1_000_000, 300_000],
    [0xFFFFFFFF, 300_000],
  ];

  for (const [attemptCount, expectedDelayMs] of cases) {
    const delayMs = retryDelayMs(attemptCount);
    assert.equal(delayMs, expectedDelayMs, `attempt ${attemptCount}`);
    assert.equal(Number.isSafeInteger(delayMs), true);
  }
});

test("failure decision reads persisted attempts without incrementing them", () => {
  const policy = createOutboxRetryPolicy();
  const persistedFailure = {
    attemptCount: 2,
    maxAttempts: 3,
    retryable: true,
    reasonCode: "OUTBOX_LEASE_EXPIRED",
  };
  const beforeDecision = { ...persistedFailure };
  const retry = policy.decide(persistedFailure);
  assert.deepEqual(retry, {
    policyVersion: "outbox-retry-v1",
    kind: "RETRY",
    delayMs: 10_000,
    reasonCode: "OUTBOX_LEASE_EXPIRED",
  });
  assert.equal(Object.isFrozen(retry), true);
  assert.deepEqual(persistedFailure, beforeDecision);
  assert.equal(Object.hasOwn(retry, "attemptCount"), false);

  const exhausted = policy.decide({
    attemptCount: 3,
    maxAttempts: 3,
    retryable: true,
    reasonCode: "OUTBOX_DISPATCH_FAILED",
  });
  assert.equal(exhausted.kind, "DEAD_LETTER");
  assert.equal(exhausted.delayMs, 0);

  const permanent = policy.decide({
    attemptCount: 1,
    maxAttempts: 5,
    retryable: false,
    reasonCode: "OUTBOX_PAYLOAD_INVALID",
  });
  assert.equal(permanent.kind, "DEAD_LETTER");
  assert.equal(permanent.delayMs, 0);
});

test("reason classification preserves only the safe allowlist", () => {
  for (const reasonCode of [
    "OUTBOX_DISPATCH_FAILED",
    "OUTBOX_LEASE_EXPIRED",
    "OUTBOX_PAYLOAD_INVALID",
    "OUTBOX_SCHEMA_UNSUPPORTED",
  ]) {
    const decision = decideOutboxFailure({
      attemptCount: 1,
      maxAttempts: 2,
      retryable: true,
      reasonCode,
    });
    assert.equal(decision.reasonCode, reasonCode);
  }

  const sensitiveReason = "UPSTREAM_bearer-secret_phone-13800138000";
  const generic = decideOutboxFailure({
    attemptCount: 1,
    maxAttempts: 2,
    retryable: true,
    reasonCode: sensitiveReason,
  });
  assert.equal(generic.reasonCode, "OUTBOX_DISPATCH_FAILED");
  assert.equal(JSON.stringify(generic).includes(sensitiveReason), false);
  assert.equal(JSON.stringify(generic).includes("bearer-secret"), false);
  assert.equal(JSON.stringify(generic).includes("13800138000"), false);
});

test("attempt and maximum inputs reject unsafe, inconsistent or overflowing values", () => {
  const invalidCases = [
    { attemptCount: 0, maxAttempts: 1, retryable: true },
    { attemptCount: -1, maxAttempts: 1, retryable: true },
    { attemptCount: 1.5, maxAttempts: 2, retryable: true },
    { attemptCount: Number.NaN, maxAttempts: 2, retryable: true },
    { attemptCount: Number.POSITIVE_INFINITY, maxAttempts: 2, retryable: true },
    { attemptCount: Number.MAX_SAFE_INTEGER, maxAttempts: Number.MAX_SAFE_INTEGER, retryable: true },
    { attemptCount: 0x100000000, maxAttempts: 0x100000000, retryable: true },
    { attemptCount: 2, maxAttempts: 1, retryable: true },
    { attemptCount: 1, maxAttempts: 0, retryable: true },
    { attemptCount: 1, maxAttempts: 2.5, retryable: true },
    { attemptCount: 1, maxAttempts: 2, retryable: "true" },
  ];

  for (const input of invalidCases) {
    assert.throws(
      () => decideOutboxFailure(input),
      (error) => error && error.code === "OUTBOX_RETRY_DECISION_INVALID"
    );
  }
  for (const attemptCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000]) {
    assert.throws(
      () => retryDelayMs(attemptCount),
      (error) => error && error.code === "OUTBOX_RETRY_DECISION_INVALID"
    );
  }
});

test("policy validation rejects drift, unsafe values, accessors and extra fields", () => {
  const invalidPolicies = [
    null,
    [],
    {},
    { ...OUTBOX_RETRY_POLICY_V1, policyVersion: "outbox-retry-v2" },
    { ...OUTBOX_RETRY_POLICY_V1, baseDelayMs: 1_000 },
    { ...OUTBOX_RETRY_POLICY_V1, maxDelayMs: 600_000 },
    { ...OUTBOX_RETRY_POLICY_V1, baseDelayMs: 300_001, maxDelayMs: 300_000 },
    { ...OUTBOX_RETRY_POLICY_V1, baseDelayMs: Number.MAX_SAFE_INTEGER },
    { ...OUTBOX_RETRY_POLICY_V1, unexpected: true },
  ];
  const symbolPolicy = { ...OUTBOX_RETRY_POLICY_V1 };
  symbolPolicy[Symbol("unexpected")] = true;
  invalidPolicies.push(symbolPolicy);
  const accessorPolicy = { ...OUTBOX_RETRY_POLICY_V1 };
  Object.defineProperty(accessorPolicy, "baseDelayMs", {
    enumerable: true,
    get() {
      throw new Error("must not execute policy getters");
    },
  });
  invalidPolicies.push(accessorPolicy);

  for (const policy of invalidPolicies) {
    assert.throws(
      () => validateOutboxRetryPolicy(policy),
      (error) => error && error.code === "OUTBOX_RETRY_POLICY_INVALID"
    );
    assert.throws(
      () => createOutboxRetryPolicy(policy),
      (error) => error && error.code === "OUTBOX_RETRY_POLICY_INVALID"
    );
  }
});
