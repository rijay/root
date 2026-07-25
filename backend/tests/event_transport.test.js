const test = require("node:test");
const assert = require("node:assert/strict");

const {
  claimOutboxEvents,
  completeInboxEvent,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failInboxEvent,
  failOutboxEvent,
  getConsumerCheckpoint,
  receiveInboxEvent,
  retryInboxEvent,
  stageOutboxEnvelope,
} = require("../src/eventTransport");
const { buildTaskEventOutboxEnvelope } = require("../src/taskEventOutbox");

function state() {
  return {};
}

function at(iso) {
  return new Date(iso).toISOString();
}

const SENSITIVE_ERROR_DETAIL = [
  "Authorization: Bearer event-bearer-secret",
  "https://upstream.example/fail?access_token=query-secret&token=other-secret",
  "phone=13800138000",
  "openid=oSensitiveOpenId",
  "unionid=uSensitiveUnionId",
].join(" ");

function assertNoSensitiveErrorDetail(record) {
  const persisted = JSON.stringify(record);
  [
    "event-bearer-secret",
    "query-secret",
    "other-secret",
    "13800138000",
    "oSensitiveOpenId",
    "uSensitiveUnionId",
  ].forEach((secret) => assert.equal(persisted.includes(secret), false, secret));
}

test("outbox enqueue is deterministic per topic and dedupe key", () => {
  const data = state();
  const payload = { memberId: "member-1", nested: { b: 2, a: 1 } };
  const first = enqueueOutboxEvent(data, {
    topic: "member.registered",
    dedupeKey: "member-1:v1",
    aggregateKey: "member-1",
    payload,
    maxAttempts: 3,
  }, { now: "2026-07-15T10:00:00.000Z", idFactory: () => "evt_out_1" });

  payload.nested.a = 99;
  const duplicate = enqueueOutboxEvent(data, {
    topic: "member.registered",
    dedupeKey: "member-1:v1",
    aggregateKey: "member-1",
    payload: { nested: { a: 1, b: 2 }, memberId: "member-1" },
  }, { now: "2026-07-15T10:01:00.000Z", idFactory: () => "must-not-run" });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.event.outbox_event_id, "evt_out_1");
  assert.equal(data.eventOutbox.length, 1);
  assert.equal(data.eventOutbox[0].payload_json.nested.a, 1);
  assert.equal(data.eventOutbox[0].sequence, 1);

  assert.throws(
    () => enqueueOutboxEvent(data, {
      topic: "member.registered",
      dedupeKey: "member-1:v1",
      payload: { memberId: "member-1", changed: true },
    }),
    (error) => error.code === "OUTBOX_DEDUPE_CONFLICT"
  );
});

test("outbox claim uses leases, retry delay and stale-owner protection", () => {
  const data = state();
  enqueueOutboxEvent(data, {
    topic: "assessment.completed",
    dedupeKey: "assessment-1",
    payload: { assessmentId: "assessment-1" },
    maxAttempts: 3,
  }, { now: "2026-07-15T10:00:00.000Z", idFactory: () => "evt_retry" });

  const claimed = claimOutboxEvents(data, {
    workerId: "worker-a",
    limit: 1,
    leaseMs: 30_000,
  }, { now: "2026-07-15T10:00:01.000Z" });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].attempts, 1);
  assert.equal(claimOutboxEvents(data, {
    workerId: "worker-b",
    limit: 1,
    leaseMs: 30_000,
  }, { now: "2026-07-15T10:00:02.000Z" }).length, 0);

  const failed = failOutboxEvent(data, {
    eventId: "evt_retry",
    workerId: "worker-a",
    error: new Error(`temporary upstream timeout ${SENSITIVE_ERROR_DETAIL}`),
    retryable: true,
    retryDelayMs: 60_000,
  }, { now: "2026-07-15T10:00:10.000Z" });
  assert.equal(failed.status, "RETRY_PENDING");
  assert.equal(failed.last_error, "event processing failed");
  assertNoSensitiveErrorDetail(data.eventOutbox[0]);
  assert.equal(failed.available_at, at("2026-07-15T10:01:10.000Z"));
  assert.equal(claimOutboxEvents(data, {
    workerId: "worker-b",
    limit: 1,
  }, { now: "2026-07-15T10:01:09.999Z" }).length, 0);

  const retried = claimOutboxEvents(data, {
    workerId: "worker-b",
    limit: 1,
    leaseMs: 30_000,
  }, { now: "2026-07-15T10:01:10.000Z" });
  assert.equal(retried[0].attempts, 2);
  assert.throws(
    () => completeOutboxEvent(data, {
      eventId: "evt_retry",
      workerId: "worker-a",
    }, { now: "2026-07-15T10:01:11.000Z" }),
    (error) => error.code === "OUTBOX_LEASE_LOST"
  );
  const completed = completeOutboxEvent(data, {
    eventId: "evt_retry",
    workerId: "worker-b",
  }, { now: "2026-07-15T10:01:11.000Z" });
  assert.equal(completed.status, "SUCCEEDED");
});

test("outbox lease-expiry failure injection dead-letters after max attempts", () => {
  const data = state();
  enqueueOutboxEvent(data, {
    topic: "activity.enrolled",
    dedupeKey: "enrollment-1",
    payload: { enrollmentId: "enrollment-1" },
    maxAttempts: 2,
  }, { now: "2026-07-15T10:00:00.000Z", idFactory: () => "evt_dead" });

  claimOutboxEvents(data, {
    workerId: "crashed-worker-1",
    limit: 1,
    leaseMs: 1_000,
  }, { now: "2026-07-15T10:00:01.000Z" });
  const second = claimOutboxEvents(data, {
    workerId: "crashed-worker-2",
    limit: 1,
    leaseMs: 1_000,
  }, { now: "2026-07-15T10:00:02.001Z" });
  assert.equal(second.length, 1);
  assert.equal(second[0].attempts, 2);

  const noThirdClaim = claimOutboxEvents(data, {
    workerId: "worker-3",
    limit: 1,
  }, { now: "2026-07-15T10:00:03.002Z" });
  assert.equal(noThirdClaim.length, 0);
  assert.equal(data.eventOutbox[0].status, "DEAD_LETTER");
  assert.match(data.eventOutbox[0].last_error, /lease expired/i);
  assert.equal(data.eventOutbox[0].lease_owner, "");
});

test("explicit non-retryable failure enters dead letter immediately", () => {
  const data = state();
  enqueueOutboxEvent(data, {
    topic: "reward.granted",
    dedupeKey: "grant-1",
    payload: { grantId: "grant-1" },
    maxAttempts: 5,
  }, { now: "2026-07-15T10:00:00.000Z", idFactory: () => "evt_non_retry" });
  claimOutboxEvents(data, { workerId: "worker-a", limit: 1 }, {
    now: "2026-07-15T10:00:01.000Z",
  });

  const failed = failOutboxEvent(data, {
    eventId: "evt_non_retry",
    workerId: "worker-a",
    error: `invalid recipient ${SENSITIVE_ERROR_DETAIL}`,
    retryable: false,
  }, { now: "2026-07-15T10:00:02.000Z" });

  assert.equal(failed.status, "DEAD_LETTER");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error, "event processing failed");
  assertNoSensitiveErrorDetail(data.eventOutbox[0]);
});

test("legacy dispatcher and complete relational envelopes cannot share one snapshot model", () => {
  const completeData = {};
  stageOutboxEnvelope(completeData, buildTaskEventOutboxEnvelope({
    task_event_id: "tev_model_guard",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    occurred_at: "2026-07-16T10:00:00.000Z",
    created_at: "2026-07-16T10:00:00.000Z",
  }));
  assert.throws(
    () => claimOutboxEvents(completeData, { workerId: "legacy-worker" }),
    (error) => error.code === "OUTBOX_MODEL_MISMATCH"
  );

  const legacyData = {};
  enqueueOutboxEvent(legacyData, {
    topic: "legacy.topic",
    dedupeKey: "legacy-1",
    payload: { safe: true },
  });
  assert.throws(
    () => stageOutboxEnvelope(legacyData, buildTaskEventOutboxEnvelope({
      task_event_id: "tev_model_guard_2",
      task_type: "CHECKIN",
      event_type: "CHECKIN_COMPLETED",
      occurred_at: "2026-07-16T10:00:00.000Z",
      created_at: "2026-07-16T10:00:00.000Z",
    })),
    (error) => error.code === "OUTBOX_MODEL_MISMATCH"
  );
});

test("inbox receipt dedupes exact payload and rejects digest or sequence conflicts", () => {
  const data = state();
  const first = receiveInboxEvent(data, {
    consumer: "health-profile-projector",
    stream: "member-1",
    eventId: "source-event-1",
    sequence: 1,
    topic: "member.registered",
    payload: { memberId: "member-1", tags: ["new"] },
  }, { now: "2026-07-15T10:00:00.000Z", idFactory: () => "inbox-1" });
  const duplicate = receiveInboxEvent(data, {
    consumer: "health-profile-projector",
    stream: "member-1",
    eventId: "source-event-1",
    sequence: 1,
    topic: "member.registered",
    payload: { tags: ["new"], memberId: "member-1" },
  }, { now: "2026-07-15T10:01:00.000Z", idFactory: () => "must-not-run" });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(data.eventInbox.length, 1);
  assert.equal(getConsumerCheckpoint(data, {
    consumer: "health-profile-projector",
    stream: "member-1",
  }).watermark, 1);

  assert.throws(
    () => receiveInboxEvent(data, {
      consumer: "health-profile-projector",
      stream: "member-1",
      eventId: "source-event-1",
      sequence: 1,
      topic: "member.registered",
      payload: { memberId: "member-CHANGED" },
    }),
    (error) => error.code === "INBOX_PAYLOAD_CONFLICT"
  );
  assert.throws(
    () => receiveInboxEvent(data, {
      consumer: "health-profile-projector",
      stream: "member-1",
      eventId: "source-event-other",
      sequence: 1,
      topic: "member.registered",
      payload: { memberId: "member-1" },
    }),
    (error) => error.code === "INBOX_SEQUENCE_CONFLICT"
  );
});

test("per-consumer checkpoint advances only across contiguous successes", () => {
  const data = state();
  const envelope = (sequence) => ({
    consumer: "task-projector",
    stream: "member-1",
    eventId: `source-event-${sequence}`,
    sequence,
    topic: "task.progressed",
    payload: { sequence },
  });
  [1, 2, 3].forEach((sequence) => receiveInboxEvent(data, envelope(sequence), {
    now: `2026-07-15T10:00:0${sequence}.000Z`,
    idFactory: () => `inbox-${sequence}`,
  }));

  completeInboxEvent(data, { receiptId: "inbox-3" }, { now: "2026-07-15T10:01:03.000Z" });
  assert.deepEqual(getConsumerCheckpoint(data, {
    consumer: "task-projector",
    stream: "member-1",
  }), {
    consumer: "task-projector",
    stream: "member-1",
    checkpoint: 0,
    watermark: 3,
    updated_at: "2026-07-15T10:01:03.000Z",
  });

  completeInboxEvent(data, { receiptId: "inbox-1" }, { now: "2026-07-15T10:01:01.000Z" });
  assert.equal(getConsumerCheckpoint(data, {
    consumer: "task-projector",
    stream: "member-1",
  }).checkpoint, 1);

  failInboxEvent(data, {
    receiptId: "inbox-2",
    error: new Error(`projection write failed ${SENSITIVE_ERROR_DETAIL}`),
  }, { now: "2026-07-15T10:01:02.000Z" });
  assert.equal(data.eventInbox[1].last_error, "event processing failed");
  assertNoSensitiveErrorDetail(data.eventInbox[1]);
  assert.equal(getConsumerCheckpoint(data, {
    consumer: "task-projector",
    stream: "member-1",
  }).checkpoint, 1);

  const retried = retryInboxEvent(data, { receiptId: "inbox-2" }, {
    now: "2026-07-15T10:02:00.000Z",
  });
  assert.equal(retried.status, "PROCESSING");
  assert.equal(retried.attempts, 2);
  assert.equal(retried.last_error, "");
  assertNoSensitiveErrorDetail(data.eventInbox[1]);
  completeInboxEvent(data, { receiptId: "inbox-2" }, { now: "2026-07-15T10:02:01.000Z" });

  const finalCheckpoint = getConsumerCheckpoint(data, {
    consumer: "task-projector",
    stream: "member-1",
  });
  assert.equal(finalCheckpoint.checkpoint, 3);
  assert.equal(finalCheckpoint.watermark, 3);

  const otherConsumer = getConsumerCheckpoint(data, {
    consumer: "notification-projector",
    stream: "member-1",
  });
  assert.equal(otherConsumer.checkpoint, 0);
  assert.equal(otherConsumer.watermark, 0);
});
