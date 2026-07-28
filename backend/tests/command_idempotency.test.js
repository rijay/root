const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMMAND_IDEMPOTENCY_STATUS,
  digestCommandRequest,
  executeIdempotentCommand,
} = require("../src/commandIdempotency");
const { createCommandResultCodec } = require("../src/commandResultProtection");

function clock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function descriptor(overrides = {}) {
  return {
    commandName: "REFUND_APPROVE",
    actorId: "finance-001",
    idempotencyKey: "refund-approve-001",
    request: { refundId: "rwi-001", reason: "approved" },
    ...overrides,
  };
}

test("request digest is canonical and can be supplied by a trusted caller", () => {
  const left = digestCommandRequest({ z: 1, nested: { b: true, a: [2, 1] } });
  const right = digestCommandRequest({ nested: { a: [2, 1], b: true }, z: 1 });
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);

  const data = {};
  const result = executeIdempotentCommand(data, descriptor({ request: undefined, requestDigest: left }), () => ({ ok: true }));
  assert.equal(result.record.requestDigest, left);
  assert.equal(data.commandIdempotencyRecords.length, 1);
});

test("scope includes command name, actor id and idempotency key", () => {
  const data = {};
  const calls = [];
  const variants = [
    descriptor(),
    descriptor({ commandName: "COUPON_USE" }),
    descriptor({ actorId: "finance-002" }),
    descriptor({ idempotencyKey: "refund-approve-002" }),
  ];

  variants.forEach((input, index) => {
    const executed = executeIdempotentCommand(data, input, () => {
      calls.push(index);
      return { index };
    });
    assert.equal(executed.replayed, false);
    assert.deepEqual(executed.result, { index });
  });

  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.equal(data.commandIdempotencyRecords.length, 4);
});

test("successful command is cached and replayed as an isolated deterministic value", () => {
  const data = {};
  let calls = 0;
  const now = clock("2026-07-15T08:00:00.000Z", "2026-07-15T08:00:01.000Z");
  const first = executeIdempotentCommand(data, descriptor(), () => {
    calls += 1;
    return { status: "PAID", nested: { amount: 199 } };
  }, { now });
  first.result.nested.amount = 0;

  const replay = executeIdempotentCommand(data, descriptor(), () => {
    calls += 1;
    return { status: "SHOULD_NOT_RUN" };
  });

  assert.equal(calls, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, { status: "PAID", nested: { amount: 199 } });
  assert.equal(replay.record.status, COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED);
  assert.equal(replay.record.attempts, 1);
  assert.equal(replay.record.createdAt, "2026-07-15T08:00:00.000Z");
  assert.equal(replay.record.completedAt, "2026-07-15T08:00:01.000Z");
});

test("same scope with a different request digest fails with 409 and preserves success", () => {
  const data = {};
  executeIdempotentCommand(data, descriptor(), () => ({ status: "PAID" }));

  assert.throws(
    () => executeIdempotentCommand(data, descriptor({ request: { refundId: "rwi-OTHER" } }), () => ({ status: "WRONG" })),
    (error) => error.status === 409 && error.code === 40901
  );
  assert.equal(data.commandIdempotencyRecords[0].status, COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED);
  assert.deepEqual(data.commandIdempotencyRecords[0].result, { status: "PAID" });
});

test("sync failure records the attempt, clears result and permits a clean retry", () => {
  const data = { businessFacts: [] };
  const now = clock(
    "2026-07-15T09:00:00.000Z",
    "2026-07-15T09:00:01.000Z",
    "2026-07-15T09:01:00.000Z",
    "2026-07-15T09:01:01.000Z"
  );
  assert.throws(
    () => executeIdempotentCommand(data, descriptor(), () => {
      data.businessFacts.push({ status: "PARTIAL" });
      const error = new Error("temporary failure");
      error.code = "TEMPORARY";
      throw error;
    }, { now }),
    /temporary failure/
  );

  const failed = data.commandIdempotencyRecords[0];
  assert.equal(failed.status, COMMAND_IDEMPOTENCY_STATUS.FAILED);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.result, null);
  assert.deepEqual(failed.error, { code: "TEMPORARY", message: "command failed" });
  assert.deepEqual(data.businessFacts, []);

  const retried = executeIdempotentCommand(data, descriptor(), () => {
    data.businessFacts.push({ status: "RECOVERED" });
    return { status: "RECOVERED" };
  }, { now });
  assert.equal(retried.replayed, false);
  assert.equal(retried.record.attempts, 2);
  assert.equal(retried.record.status, COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED);
  assert.equal(retried.record.failedAt, "");
  assert.deepEqual(retried.result, { status: "RECOVERED" });
  assert.deepEqual(data.businessFacts, [{ status: "RECOVERED" }]);

  const replay = executeIdempotentCommand(data, descriptor(), () => ({ status: "STALE" }));
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, { status: "RECOVERED" });
});

test("async failure never becomes stale success and a later retry can succeed", async () => {
  const data = { businessFacts: [] };
  await assert.rejects(
    executeIdempotentCommand(data, descriptor(), async () => {
      data.businessFacts.push({ status: "ASYNC_PARTIAL" });
      throw Object.assign(new Error("async temporary failure"), { code: "ASYNC_TEMP" });
    }),
    /async temporary failure/
  );
  assert.equal(data.commandIdempotencyRecords[0].status, COMMAND_IDEMPOTENCY_STATUS.FAILED);
  assert.equal(data.commandIdempotencyRecords[0].result, null);
  assert.deepEqual(data.businessFacts, []);

  const retried = await executeIdempotentCommand(data, descriptor(), async () => {
    data.businessFacts.push({ status: "ASYNC_RECOVERED" });
    return { status: "ASYNC_RECOVERED" };
  });
  assert.equal(retried.replayed, false);
  assert.equal(retried.record.attempts, 2);
  assert.deepEqual(retried.result, { status: "ASYNC_RECOVERED" });
  assert.deepEqual(data.businessFacts, [{ status: "ASYNC_RECOVERED" }]);
});

test("a concurrent duplicate sees IN_PROGRESS and cannot execute twice", async () => {
  const data = {};
  let release;
  let calls = 0;
  const first = executeIdempotentCommand(data, descriptor(), () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });

  assert.equal(data.commandIdempotencyRecords[0].status, COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS);
  assert.throws(
    () => executeIdempotentCommand(data, descriptor(), () => {
      calls += 1;
      return { status: "DUPLICATE" };
    }),
    (error) => error.status === 409 && error.code === 40902
  );

  release({ status: "DONE" });
  const completed = await first;
  assert.equal(calls, 1);
  assert.deepEqual(completed.result, { status: "DONE" });
  assert.equal(completed.record.status, COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED);
});

test("protected command results are encrypted at rest and replay through the codec", () => {
  const data = {};
  const resultCodec = createCommandResultCodec({
    NODE_ENV: "production",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-test-key-with-at-least-32-characters",
    ROOT_COMMAND_RESULT_KEY_ID: "test-key-v1",
  });
  const sensitiveResult = {
    rootUserId: "root-user-001",
    healthAssessment: { bowelStatus: "敏感肠道状态", phone: "13800000000" },
  };

  const first = executeIdempotentCommand(data, descriptor(), () => sensitiveResult, { resultCodec });
  const persisted = JSON.stringify(data.commandIdempotencyRecords[0].result);
  assert.equal(first.replayed, false);
  assert.deepEqual(first.result, sensitiveResult);
  assert.equal(data.commandIdempotencyRecords[0].result.protection, "A256GCM");
  assert.doesNotMatch(persisted, /敏感肠道状态|13800000000|root-user-001/);

  const replay = executeIdempotentCommand(data, descriptor(), () => ({ status: "SHOULD_NOT_RUN" }), { resultCodec });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, sensitiveResult);
});

test("encrypted results cannot be swapped across command scopes", () => {
  const data = {};
  const resultCodec = createCommandResultCodec({
    NODE_ENV: "production",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-scope-binding-key-with-at-least-32-characters",
    ROOT_COMMAND_RESULT_KEY_ID: "scope-binding-v1",
  });
  const firstInput = descriptor({ actorId: "member-a", idempotencyKey: "request-a" });
  const secondInput = descriptor({ actorId: "member-b", idempotencyKey: "request-b" });
  executeIdempotentCommand(data, firstInput, () => ({ health: "member-a-health" }), { resultCodec });
  executeIdempotentCommand(data, secondInput, () => ({ health: "member-b-health" }), { resultCodec });

  const firstStored = data.commandIdempotencyRecords[0].result;
  data.commandIdempotencyRecords[0].result = data.commandIdempotencyRecords[1].result;
  data.commandIdempotencyRecords[1].result = firstStored;

  assert.throws(
    () => executeIdempotentCommand(data, firstInput, () => ({ health: "must-not-run" }), { resultCodec }),
    (error) => error && error.code === "COMMAND_RESULT_BINDING_MISMATCH"
  );
  assert.throws(
    () => executeIdempotentCommand(data, secondInput, () => ({ health: "must-not-run" }), { resultCodec }),
    (error) => error && error.code === "COMMAND_RESULT_BINDING_MISMATCH"
  );
});

test("invalid descriptors and digest mismatches fail before creating a record", () => {
  const data = {};
  assert.throws(
    () => executeIdempotentCommand(data, descriptor({ commandName: "" }), () => ({})),
    (error) => error.status === 400 && error.code === 40001
  );
  assert.throws(
    () => executeIdempotentCommand(data, descriptor({ requestDigest: "0".repeat(64) }), () => ({})),
    (error) => error.status === 400 && error.code === 40002
  );
  for (const invalid of [
    { commandName: "c".repeat(97) },
    { actorId: "a".repeat(129) },
    { idempotencyKey: "k".repeat(192) },
  ]) {
    assert.throws(
      () => executeIdempotentCommand(data, descriptor(invalid), () => ({})),
      (error) => error.status === 400 && error.code === 40001
    );
  }
  assert.equal(data.commandIdempotencyRecords, undefined);
});
