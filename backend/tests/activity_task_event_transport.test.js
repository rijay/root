const assert = require("node:assert/strict");
const test = require("node:test");

const { buildActivityTaskOutboxEnvelope } = require("../src/activityTaskEventOutbox");
const { stageOutboxEnvelope } = require("../src/eventTransport");
const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");

function enrollmentEvent(overrides = {}) {
  return {
    activity_enrollment_event_id: "activity-enrollment-event-confirmed-001",
    activity_enrollment_id: "activity-enrollment-001",
    activity_session_id: "activity-session-001",
    root_user_id: "root-user-001",
    event_sequence: 2,
    operation: "REVIEW",
    from_status: "PENDING",
    to_status: "CONFIRMED",
    reason_code: null,
    occurred_at: "2026-08-01T02:03:04.005Z",
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    taskDefinitionId: "td_activity_followup",
    taskDefinitionVersion: "task-definition-v3",
    ...overrides,
  };
}

function confirmedEnvelope() {
  return buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent(),
    binding: binding(),
  }, {
    producerVersion: "1.0.0-test",
    releaseId: "release-test",
  });
}

function canceledEnvelope(confirmed = confirmedEnvelope()) {
  return buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent({
      activity_enrollment_event_id: "activity-enrollment-event-canceled-001",
      event_sequence: 3,
      operation: "CANCEL",
      from_status: "CONFIRMED",
      to_status: "CANCELED",
      reason_code: "USER_CANCELED",
      occurred_at: "2026-08-02T02:03:04.005Z",
    }),
    binding: binding(),
  }, {
    producerVersion: "1.0.0-test",
    correlationId: confirmed.correlation_id || "activity-flow-001",
  });
}

function inboxEnvelope(outbox) {
  return {
    eventId: outbox.outbox_event_id,
    topic: outbox.topic,
    eventType: outbox.event_type,
    schemaVersion: outbox.schema_version,
    sourceName: outbox.source_name,
    partitionKey: outbox.partition_key,
    partitionPosition: outbox.partition_position,
    aggregateType: outbox.aggregate_type,
    aggregateId: outbox.aggregate_id,
    aggregateVersion: outbox.aggregate_version,
    occurredAt: outbox.occurred_at,
    producerVersion: outbox.producer_version,
    correlationId: outbox.correlation_id,
    causationId: outbox.causation_id,
    idempotencyKey: outbox.idempotency_key,
    dedupeKey: outbox.dedupe_key,
    payload: outbox.payload_json,
    payloadDigest: outbox.payload_digest,
    releaseId: outbox.release_id,
  };
}

function registration(eventType) {
  return getDefaultInboxHandlerRegistry().assertScope({
    consumerName: "activity-task-source-projection",
    handlerVersion: "activity-task-source-v1",
    sourceName: "myroot-api",
    eventType,
    schemaVersion: "1",
    aggregateType: "ACTIVITY_ENROLLMENT_TASK_SOURCE",
  });
}

function evidence(resolved) {
  return {
    handlerVersion: resolved.descriptor.handlerVersion,
    registrationDigest: resolved.registrationDigest,
  };
}

function createProjectionPersistence() {
  const state = { assignments: [], invalidations: [], calls: [] };
  async function executeStatement(statementId, parameters) {
    state.calls.push({ statementId, parameters });
    if (statementId === "activity_task_assignment.select_conflicts_for_update.v1") {
      return state.assignments.filter((row) => (
        row.task_activity_assignment_id === parameters.assignmentId
        || (row.activity_enrollment_id === parameters.activityEnrollmentId
          && row.task_definition_id === parameters.taskDefinitionId
          && row.task_definition_version === parameters.taskDefinitionVersion)
        || row.source_confirmed_event_id === parameters.sourceConfirmedEventId
      ));
    }
    if (statementId === "activity_task_assignment.insert.v1") {
      state.assignments.push({
        task_activity_assignment_id: parameters.assignmentId,
        root_user_id: parameters.rootUserId,
        task_definition_id: parameters.taskDefinitionId,
        task_definition_version: parameters.taskDefinitionVersion,
        activity_enrollment_id: parameters.activityEnrollmentId,
        activity_session_id: parameters.activitySessionId,
        initial_status: "AVAILABLE",
        source_confirmed_event_id: parameters.sourceConfirmedEventId,
        source_confirmed_event_type: parameters.sourceConfirmedEventType,
        source_confirmed_at: parameters.sourceConfirmedAt,
      });
      return { affectedRows: 1 };
    }
    if ([
      "activity_task_assignment.select_for_invalidation.v1",
      "activity_task_assignment.verify_by_id.v1",
    ].includes(statementId)) {
      return state.assignments.filter((row) => (
        row.task_activity_assignment_id === parameters.assignmentId
      ));
    }
    if (statementId === "task_source_invalidation.select_conflicts_for_update.v1") {
      return state.invalidations.filter((row) => (
        row.task_source_invalidation_event_id === parameters.invalidationId
        || row.source_event_id === parameters.sourceEventId
      ));
    }
    if (statementId === "task_source_invalidation.insert.v1") {
      state.invalidations.push({
        task_source_invalidation_event_id: parameters.invalidationId,
        task_activity_assignment_id: parameters.assignmentId,
        source_event_id: parameters.sourceEventId,
        source_event_type: parameters.sourceEventType,
        reason_code: parameters.reasonCode,
        occurred_at: parameters.occurredAt,
      });
      return { affectedRows: 1 };
    }
    if (statementId === "task_source_invalidation.verify_by_id.v1") {
      return state.invalidations.filter((row) => (
        row.task_source_invalidation_event_id === parameters.invalidationId
      ));
    }
    throw new Error(`unexpected statement ${statementId}`);
  }
  return { state, executeStatement };
}

test("PENDING, rejected and unbound enrollment transitions cannot create Activity tasks", () => {
  assert.equal(buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent({
      operation: "ENROLL",
      from_status: null,
      to_status: "PENDING",
    }),
    binding: binding(),
  }), null);
  assert.equal(buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent({
      operation: "REVIEW",
      from_status: "PENDING",
      to_status: "REJECTED",
      reason_code: "CAPACITY_FULL_AT_REVIEW",
    }),
    binding: binding(),
  }), null);
  assert.equal(buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent(),
    binding: null,
  }), null);
});

test("confirmed and canceled envelopes use one ordered assignment partition and stable business keys", () => {
  const confirmed = confirmedEnvelope();
  const replay = confirmedEnvelope();
  const canceled = canceledEnvelope(confirmed);
  assert.deepEqual(replay, confirmed);
  assert.equal(confirmed.event_type, "activity.enrollment.confirmed.v1");
  assert.equal(confirmed.partition_position, 1);
  assert.equal(confirmed.aggregate_version, 1);
  assert.match(confirmed.aggregate_id, /^activity_task_[a-f0-9]{50}$/);
  assert.equal(confirmed.payload_json.activityTaskAssignmentId, confirmed.aggregate_id);
  assert.equal(canceled.event_type, "activity.enrollment.canceled.v1");
  assert.equal(canceled.partition_key, confirmed.partition_key);
  assert.equal(canceled.partition_position, 2);
  assert.equal(canceled.aggregate_version, 2);
  assert.match(confirmed.idempotency_key, /^activity-enrollment:.*:task:/);
  assert.match(canceled.idempotency_key, /^activity-event:.*:task:/);
});

test("complete Outbox staging is persistent-shape idempotent and rejects same key with drift", () => {
  const data = {};
  const envelope = confirmedEnvelope();
  assert.equal(stageOutboxEnvelope(data, envelope).created, true);
  assert.equal(stageOutboxEnvelope(data, confirmedEnvelope()).created, false);
  assert.equal(data.eventOutbox.length, 1);
  assert.throws(
    () => stageOutboxEnvelope(data, {
      ...envelope,
      payload_json: { ...envelope.payload_json, rootUserId: "another-root-user" },
    }),
    { code: "OUTBOX_ENVELOPE_INVALID" }
  );
});

test("unversioned task binding fails closed", () => {
  assert.throws(() => buildActivityTaskOutboxEnvelope({
    enrollmentEvent: enrollmentEvent(),
    binding: { taskDefinitionId: "td_activity_followup" },
  }), { code: "ACTIVITY_TASK_OUTBOX_INPUT_INVALID" });
});

test("confirmed consumer creates one immutable assignment and replays without another write", async () => {
  const resolved = registration("activity.enrollment.confirmed.v1");
  const persistence = createProjectionPersistence();
  const context = {
    envelope: inboxEnvelope(confirmedEnvelope()),
    handlerEvidence: evidence(resolved),
    executeStatement: persistence.executeStatement,
    stageOutbox() {},
  };
  const first = await resolved.apply(context);
  const replay = await resolved.apply(context);
  assert.deepEqual(replay, first);
  assert.equal(persistence.state.assignments.length, 1);
  assert.equal(
    persistence.state.calls.filter((call) => call.statementId === "activity_task_assignment.insert.v1").length,
    1
  );
  assert.equal(await resolved.verify({ ...context, ...first }), true);
});

test("canceled consumer appends one invalidation and preserves the immutable assignment", async () => {
  const confirmedRegistration = registration("activity.enrollment.confirmed.v1");
  const canceledRegistration = registration("activity.enrollment.canceled.v1");
  const persistence = createProjectionPersistence();
  const confirmed = confirmedEnvelope();
  await confirmedRegistration.apply({
    envelope: inboxEnvelope(confirmed),
    handlerEvidence: evidence(confirmedRegistration),
    executeStatement: persistence.executeStatement,
    stageOutbox() {},
  });
  const successorById = new Map();
  const context = {
    envelope: inboxEnvelope(canceledEnvelope(confirmed)),
    handlerEvidence: evidence(canceledRegistration),
    executeStatement: persistence.executeStatement,
    stageOutbox(contractId, envelope) {
      assert.equal(contractId, "task.source_invalidated.v1");
      const existing = successorById.get(envelope.outbox_event_id);
      if (existing) assert.deepEqual(envelope, existing);
      else successorById.set(envelope.outbox_event_id, envelope);
    },
  };
  const first = await canceledRegistration.apply(context);
  const replay = await canceledRegistration.apply(context);
  assert.deepEqual(replay, first);
  assert.equal(persistence.state.assignments.length, 1);
  assert.equal(persistence.state.assignments[0].initial_status, "AVAILABLE");
  assert.equal(persistence.state.invalidations.length, 1);
  assert.equal(
    persistence.state.calls.filter((call) => call.statementId === "task_source_invalidation.insert.v1").length,
    1
  );
  assert.equal(successorById.size, 1);
  const successor = [...successorById.values()][0];
  assert.equal(successor.event_type, "task.source_invalidated.v1");
  assert.equal(successor.payload_json.taskActivityAssignmentId, confirmed.aggregate_id);
  assert.equal(successor.payload_json.reasonCode, "SOURCE_CANCELED");
  assert.equal(successor.payload_json.taskDefinitionVersion, "task-definition-v3");
  assert.match(successor.idempotency_key, /^task-source-invalidation:/);
  assert.equal(await canceledRegistration.verify({ ...context, ...first }), true);
});

test("conflicting duplicate and malformed envelope fail before target facts can drift", async () => {
  const resolved = registration("activity.enrollment.confirmed.v1");
  const persistence = createProjectionPersistence();
  persistence.state.assignments.push({
    task_activity_assignment_id: confirmedEnvelope().aggregate_id,
    root_user_id: "different-root-user",
    task_definition_id: "td_activity_followup",
    task_definition_version: "task-definition-v3",
    activity_enrollment_id: "activity-enrollment-001",
    activity_session_id: "activity-session-001",
    initial_status: "AVAILABLE",
    source_confirmed_event_id: "activity-enrollment-event-confirmed-001",
    source_confirmed_event_type: "activity.enrollment.confirmed.v1",
    source_confirmed_at: "2026-08-01T02:03:04.005Z",
  });
  await assert.rejects(() => resolved.apply({
    envelope: inboxEnvelope(confirmedEnvelope()),
    handlerEvidence: evidence(resolved),
    executeStatement: persistence.executeStatement,
    stageOutbox() {},
  }), { code: "ACTIVITY_TASK_PROJECTION_FAILED" });
  const callsBeforeMalformed = persistence.state.calls.length;
  await assert.rejects(() => resolved.apply({
    envelope: {
      ...inboxEnvelope(confirmedEnvelope()),
      payload: { ...confirmedEnvelope().payload_json, unexpected: true },
    },
    handlerEvidence: evidence(resolved),
    executeStatement: persistence.executeStatement,
    stageOutbox() {},
  }), { code: "ACTIVITY_TASK_PROJECTION_FAILED" });
  assert.equal(persistence.state.calls.length, callsBeforeMalformed);
});
