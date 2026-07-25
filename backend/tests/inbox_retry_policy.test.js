const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INBOX_RETRY_POLICY_V1,
  createInboxRetryPolicy,
  decideInboxFailure,
  retryDelayMs,
  validateInboxRetryPolicy,
} = require("../src/inboxRetryPolicy");

test("inbox-retry-v1 freezes a five-second base and five-minute cap", () => {
  assert.deepEqual(INBOX_RETRY_POLICY_V1, {
    policyVersion: "inbox-retry-v1",
    baseDelayMs: 5_000,
    maxDelayMs: 300_000,
  });
  assert.equal(Object.isFrozen(INBOX_RETRY_POLICY_V1), true);
  assert.deepEqual(validateInboxRetryPolicy(INBOX_RETRY_POLICY_V1), INBOX_RETRY_POLICY_V1);
});

test("factory exposes only the frozen inbox retry Interface", () => {
  const policy = createInboxRetryPolicy();
  assert.deepEqual(Object.keys(policy).sort(), ["decide", "policyVersion"]);
  assert.equal(policy.policyVersion, "inbox-retry-v1");
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

test("failure decision reads persisted attempts without incrementing or mutating input", () => {
  const policy = createInboxRetryPolicy();
  const persistedFailure = {
    attemptCount: 2,
    maxAttempts: 3,
    retryable: true,
    reasonCode: "INBOX_LEASE_EXPIRED",
  };
  const beforeDecision = { ...persistedFailure };
  const retry = policy.decide(persistedFailure);

  assert.deepEqual(retry, {
    policyVersion: "inbox-retry-v1",
    kind: "RETRY",
    delayMs: 10_000,
    reasonCode: "INBOX_LEASE_EXPIRED",
  });
  assert.equal(Object.isFrozen(retry), true);
  assert.deepEqual(persistedFailure, beforeDecision);
  assert.equal(Object.hasOwn(retry, "attemptCount"), false);

  const exhausted = policy.decide({
    attemptCount: 3,
    maxAttempts: 3,
    retryable: true,
    reasonCode: "INBOX_HANDLER_FAILED",
  });
  assert.equal(exhausted.kind, "DEAD_LETTER");
  assert.equal(exhausted.delayMs, 0);

  const permanent = policy.decide({
    attemptCount: 1,
    maxAttempts: 5,
    retryable: false,
    reasonCode: "INBOX_PAYLOAD_INVALID",
  });
  assert.equal(permanent.kind, "DEAD_LETTER");
  assert.equal(permanent.delayMs, 0);
});

test("reason classification preserves only the inbox-safe allowlist", () => {
  for (const reasonCode of [
    "INBOX_HANDLER_FAILED",
    "INBOX_LEASE_EXPIRED",
    "INBOX_PAYLOAD_INVALID",
    "INBOX_SCHEMA_UNSUPPORTED",
  ]) {
    const decision = decideInboxFailure({
      attemptCount: 1,
      maxAttempts: 2,
      retryable: true,
      reasonCode,
    });
    assert.equal(decision.reasonCode, reasonCode);
  }

  const sensitiveReason = "UPSTREAM_bearer-secret_phone-13800138000";
  const generic = decideInboxFailure({
    attemptCount: 1,
    maxAttempts: 2,
    retryable: true,
    reasonCode: sensitiveReason,
  });
  assert.equal(generic.reasonCode, "INBOX_HANDLER_FAILED");
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
      () => decideInboxFailure(input),
      (error) => error && error.code === "INBOX_RETRY_DECISION_INVALID"
    );
  }
  for (const attemptCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000]) {
    assert.throws(
      () => retryDelayMs(attemptCount),
      (error) => error && error.code === "INBOX_RETRY_DECISION_INVALID"
    );
  }
});

test("callers cannot inject decision outputs or mutate policy identity", () => {
  const injectedInputs = [
    { attemptCount: 1, maxAttempts: 2, retryable: true, delayMs: 1 },
    { attemptCount: 1, maxAttempts: 2, retryable: true, kind: "RETRY" },
    { attemptCount: 1, maxAttempts: 2, retryable: true, policyVersion: "inbox-retry-v2" },
    { attemptCount: 1, maxAttempts: 2, retryable: true, unexpected: true },
  ];

  for (const input of injectedInputs) {
    assert.throws(
      () => decideInboxFailure(input),
      (error) => error && error.code === "INBOX_RETRY_DECISION_INVALID"
    );
  }

  assert.equal(Reflect.set(INBOX_RETRY_POLICY_V1, "baseDelayMs", 1), false);
  assert.equal(INBOX_RETRY_POLICY_V1.baseDelayMs, 5_000);
  assert.equal(INBOX_RETRY_POLICY_V1.policyVersion, "inbox-retry-v1");
});

test("policy validation rejects drift, unsafe values, accessors and extra fields", () => {
  const invalidPolicies = [
    null,
    [],
    {},
    { ...INBOX_RETRY_POLICY_V1, policyVersion: "outbox-retry-v1" },
    { ...INBOX_RETRY_POLICY_V1, policyVersion: "inbox-retry-v2" },
    { ...INBOX_RETRY_POLICY_V1, baseDelayMs: 1_000 },
    { ...INBOX_RETRY_POLICY_V1, maxDelayMs: 600_000 },
    { ...INBOX_RETRY_POLICY_V1, baseDelayMs: 300_001, maxDelayMs: 300_000 },
    { ...INBOX_RETRY_POLICY_V1, baseDelayMs: Number.MAX_SAFE_INTEGER },
    { ...INBOX_RETRY_POLICY_V1, unexpected: true },
  ];
  const symbolPolicy = { ...INBOX_RETRY_POLICY_V1 };
  symbolPolicy[Symbol("unexpected")] = true;
  invalidPolicies.push(symbolPolicy);
  const accessorPolicy = { ...INBOX_RETRY_POLICY_V1 };
  Object.defineProperty(accessorPolicy, "baseDelayMs", {
    enumerable: true,
    get() {
      throw new Error("sensitive-policy-value");
    },
  });
  invalidPolicies.push(accessorPolicy);

  for (const policy of invalidPolicies) {
    assert.throws(
      () => validateInboxRetryPolicy(policy),
      (error) => error
        && error.code === "INBOX_RETRY_POLICY_INVALID"
        && !error.message.includes("sensitive-policy-value")
    );
    assert.throws(
      () => createInboxRetryPolicy(policy),
      (error) => error
        && error.code === "INBOX_RETRY_POLICY_INVALID"
        && !error.message.includes("sensitive-policy-value")
    );
  }
});

test("invalid decisions fail with a generic error that does not disclose caller input", () => {
  const sensitive = "bearer-secret_phone-13800138000";
  const invalid = {
    attemptCount: sensitive,
    maxAttempts: 2,
    retryable: true,
  };

  assert.throws(
    () => decideInboxFailure(invalid),
    (error) => error
      && error.code === "INBOX_RETRY_DECISION_INVALID"
      && error.message === "inbox retry decision is invalid"
      && !JSON.stringify({ code: error.code, message: error.message }).includes(sensitive)
  );

  const accessorInput = {
    maxAttempts: 2,
    retryable: true,
  };
  Object.defineProperty(accessorInput, "attemptCount", {
    enumerable: true,
    get() {
      throw new Error(sensitive);
    },
  });
  const hostileInput = new Proxy({}, {
    getPrototypeOf() {
      throw new Error(sensitive);
    },
  });

  for (const input of [accessorInput, hostileInput]) {
    assert.throws(
      () => decideInboxFailure(input),
      (error) => error
        && error.code === "INBOX_RETRY_DECISION_INVALID"
        && error.message === "inbox retry decision is invalid"
        && !error.message.includes(sensitive)
    );
  }
});

test("hostile policy objects cannot disclose trap errors", () => {
  const sensitive = "policy-key-material";
  const hostilePolicy = new Proxy({}, {
    getPrototypeOf() {
      throw new Error(sensitive);
    },
  });

  assert.throws(
    () => validateInboxRetryPolicy(hostilePolicy),
    (error) => error
      && error.code === "INBOX_RETRY_POLICY_INVALID"
      && error.message === "inbox retry policy is invalid"
      && !error.message.includes(sensitive)
  );
});
