const test = require("node:test");
const assert = require("node:assert/strict");

const { atomicWriteFailure } = require("../src/atomicWriteError");
const { createMysqlCommandRecovery } = require("../src/mysqlCommandRecovery");

function descriptor() {
  return {
    commandName: "POST:/api/v1/activities/enrollments",
    actorId: "user:usr_recovery",
    idempotencyKey: "recovery-request-001",
    request: { body: { activityVersionId: "activity-version-recovery" } },
  };
}

function createHarness(options = {}) {
  const calls = [];
  const data = {
    activityEnrollmentEvents: [],
    commandIdempotencyRecords: options.legacyRecord ? [options.legacyRecord] : [],
  };
  let generation = 1;
  const claim = {
    recordId: "cmdidem_recovery",
    leaseOwner: "lease-owner-1",
    leaseGeneration: 1,
  };
  const adapter = {
    async claim(input, context) {
      calls.push(["claim", generation, input, context.legacyRecord || null]);
      if (options.claimError) throw options.claimError;
      if (options.replay) {
        return { kind: "REPLAY", outcome: { result: options.replay, replayed: true } };
      }
      return { kind: "CLAIMED", claim };
    },
    async lockOwnedAttempt(input) {
      calls.push(["lock", generation, input]);
      if (options.lockError) throw options.lockError;
    },
    async completeOwnedAttempt(input, result) {
      calls.push(["complete", generation, input, result]);
      if (options.completeError) throw options.completeError;
      return { result, replayed: false, record: { status: "SUCCEEDED" } };
    },
    async failOwnedAttempt(input, error) {
      calls.push(["fail", generation, input, error.code || error.message]);
      if (options.failError) throw options.failError;
    },
  };
  const recovery = createMysqlCommandRecovery({
    data,
    writable: options.writable !== false,
    getAdapter: () => adapter,
    async checkpoint() {
      calls.push(["checkpoint", generation]);
      if (options.checkpointError) throw options.checkpointError;
    },
    async resume() {
      calls.push(["resume", generation]);
      if (options.resumeError) throw options.resumeError;
      generation += 1;
    },
  });
  return { adapter, calls, claim, data, recovery };
}

test("durable claim checkpoints before a new generation owns and completes business work", async () => {
  const harness = createHarness();
  let actionGeneration = 0;

  const outcome = await harness.recovery.execute(harness.data, descriptor(), async () => {
    actionGeneration = 2;
    harness.calls.push(["action", actionGeneration]);
    harness.data.activityEnrollmentEvents.push({ activity_enrollment_event_id: "aee_recovery" });
    return { code: 0, data: { eventId: "aee_recovery" } };
  });

  assert.equal(outcome.replayed, false);
  assert.deepEqual(
    harness.calls.map((call) => call[0]),
    ["claim", "checkpoint", "resume", "lock", "action", "complete"]
  );
  assert.deepEqual(harness.calls.find((call) => call[0] === "claim").slice(0, 2), ["claim", 1]);
  assert.deepEqual(harness.calls.find((call) => call[0] === "lock").slice(0, 2), ["lock", 2]);
  assert.equal(harness.data.activityEnrollmentEvents.length, 1);
  assert.equal(harness.data.commandIdempotencyRecords.length, 0);
});

test("relational replay skips checkpoint, resume and action", async () => {
  const harness = createHarness({ replay: { code: 0, data: { eventId: "tev_existing" } } });
  let actionCalls = 0;
  const outcome = await harness.recovery.execute(harness.data, descriptor(), () => {
    actionCalls += 1;
  });

  assert.equal(outcome.replayed, true);
  assert.equal(actionCalls, 0);
  assert.deepEqual(harness.calls.map((call) => call[0]), ["claim"]);
});

test("legacy snapshot record is passed read-only to the relational claim", async () => {
  const input = descriptor();
  const legacyRecord = {
    recordId: "cmdidem_legacy",
    commandName: input.commandName,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    requestDigest: "a".repeat(64),
    status: "SUCCEEDED",
  };
  const harness = createHarness({ legacyRecord, replay: { code: 0 } });

  await harness.recovery.execute(harness.data, input, () => assert.fail("must not execute"));

  assert.equal(harness.calls[0][3], legacyRecord);
  assert.deepEqual(harness.data.commandIdempotencyRecords, [legacyRecord]);
});

test("business failure restores mutations, writes safe FAILED through the owner, and rethrows", async () => {
  const harness = createHarness();
  const error = Object.assign(new Error("sensitive failure detail"), { code: "ACTIVITY_REJECTED", status: 409 });

  await assert.rejects(
    harness.recovery.execute(harness.data, descriptor(), () => {
      harness.data.activityEnrollmentEvents.push({ activity_enrollment_event_id: "must_rollback" });
      throw error;
    }),
    (candidate) => candidate === error
  );

  assert.deepEqual(harness.data.activityEnrollmentEvents, []);
  assert.deepEqual(harness.calls.map((call) => call[0]), ["claim", "checkpoint", "resume", "lock", "fail"]);
  assert.equal(harness.calls.at(-1)[3], "ACTIVITY_REJECTED");
});

test("result completion persistence failure restores business data and leaves claim recoverable", async () => {
  const persistenceFailure = atomicWriteFailure(new Error("simulated SQL failure"));
  const harness = createHarness({ completeError: persistenceFailure });

  await assert.rejects(
    harness.recovery.execute(harness.data, descriptor(), () => {
      harness.data.activityEnrollmentEvents.push({ activity_enrollment_event_id: "must_rollback" });
      return { code: 0 };
    }),
    (error) => error.code === "ATOMIC_WRITE_FAILED"
  );

  assert.deepEqual(harness.data.activityEnrollmentEvents, []);
  assert.equal(harness.calls.some((call) => call[0] === "fail"), false);
});

test("claim checkpoint, resume and owned-lock failures are atomic", async () => {
  for (const option of ["checkpointError", "resumeError", "lockError"]) {
    const harness = createHarness({ [option]: new Error(`${option} sensitive detail`) });
    await assert.rejects(
      harness.recovery.execute(harness.data, descriptor(), () => assert.fail("must not execute")),
      (error) => error.code === "ATOMIC_WRITE_FAILED" && error.message === "atomic write failed"
    );
  }
});

test("snapshot command dual-write fails closed and restores all business changes", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.recovery.execute(harness.data, descriptor(), () => {
      harness.data.activityEnrollmentEvents.push({ activity_enrollment_event_id: "must_rollback" });
      harness.data.commandIdempotencyRecords.push({ recordId: "forbidden" });
      return { code: 0 };
    }),
    (error) => error.code === "ATOMIC_WRITE_FAILED"
      && error.cause.code === "STORE_COMMAND_SNAPSHOT_DUAL_WRITE_FORBIDDEN"
  );

  assert.deepEqual(harness.data.activityEnrollmentEvents, []);
  assert.deepEqual(harness.data.commandIdempotencyRecords, []);
  assert.equal(harness.calls.some((call) => call[0] === "fail"), false);
});

test("read-only and nested recovery calls fail closed", async () => {
  const readOnly = createHarness({ writable: false });
  await assert.rejects(
    readOnly.recovery.execute(readOnly.data, descriptor(), () => null),
    (error) => error.code === "STORE_COMMAND_RECOVERY_READ_ONLY"
  );

  const nested = createHarness();
  await assert.rejects(
    nested.recovery.execute(nested.data, descriptor(), () => nested.recovery.execute(
      nested.data,
      { ...descriptor(), idempotencyKey: "nested" },
      () => null
    )),
    (error) => error.code === "STORE_COMMAND_RECOVERY_ALREADY_ACTIVE"
  );
  assert.deepEqual(nested.data.activityEnrollmentEvents, []);
  assert.equal(nested.calls.some((call) => call[0] === "fail"), true);
});
