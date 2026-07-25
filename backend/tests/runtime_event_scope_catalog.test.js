const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildActivityTaskOutboxEnvelope } = require("../src/activityTaskEventOutbox");
const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");
const {
  WORKER_MODES,
  RUNTIME_EVENT_SCOPES,
  assertRuntimeEventRow,
  assertRuntimeEventScopeRegistration,
  scopeIdentity,
  sqlContract,
} = require("../src/runtimeEventScopeCatalog");

function activityRow(kind) {
  const confirmed = kind === "CONFIRMED";
  return buildActivityTaskOutboxEnvelope({
    enrollmentEvent: {
      activity_enrollment_event_id: confirmed ? "aee-confirmed-1" : "aee-canceled-1",
      activity_enrollment_id: "ae-runtime-1",
      activity_session_id: "as-runtime-1",
      root_user_id: "root-runtime-1",
      event_sequence: confirmed ? 1 : 2,
      from_status: confirmed ? "PENDING" : "CONFIRMED",
      to_status: confirmed ? "CONFIRMED" : "CANCELED",
      operation: confirmed ? "ENROLL" : "CANCEL",
      reason_code: confirmed ? null : "USER_CANCELED",
      occurred_at: confirmed
        ? "2026-07-18 10:00:00.000"
        : "2026-07-18 11:00:00.000",
    },
    binding: { taskDefinitionId: "task-runtime-1", taskDefinitionVersion: "v1" },
  });
}

function shareRow() {
  return {
    topic: "task.events",
    source_name: "myroot-api",
    event_type: "task.event.recorded.v1",
    schema_version: "1",
    aggregate_type: "TASK_EVENT",
    aggregate_id: "share-event-1",
    partition_key: "task_event:share-event-1",
    partition_position: 1,
    aggregate_version: 1,
    idempotency_key: "task-event:share-event-1:v1",
    dedupe_key: "task-event:share-event-1:v1",
    payload_json: {
      taskEventId: "share-event-1",
      taskType: "SHARE",
      eventType: "SHARE_COMPLETED",
    },
  };
}

function sourceInvalidatedRow() {
  const canceled = activityRow("CANCELED");
  const assignmentId = canceled.aggregate_id;
  const sourceEventId = canceled.payload_json.activityEnrollmentEventId;
  const invalidationId = `task_invalid_${crypto.createHash("sha256")
    .update(`myroot:task-source-invalidation:v1:${assignmentId}\0${sourceEventId}`, "utf8")
    .digest("hex").slice(0, 51)}`;
  const idempotencyKey = `task-source-invalidation:${invalidationId}:v1`;
  return {
    topic: "task.source.events",
    source_name: "myroot-task-projection",
    event_type: "task.source_invalidated.v1",
    schema_version: "1",
    aggregate_type: "TASK_SOURCE_INVALIDATION",
    aggregate_id: invalidationId,
    partition_key: `task_source_invalidation:${invalidationId}`,
    partition_position: 1,
    aggregate_version: 1,
    idempotency_key: idempotencyKey,
    dedupe_key: idempotencyKey,
    payload_json: {
      taskActivityAssignmentId: assignmentId,
      rootUserId: canceled.payload_json.rootUserId,
      taskDefinitionId: canceled.payload_json.taskDefinitionId,
      taskDefinitionVersion: canceled.payload_json.taskDefinitionVersion,
      activityEnrollmentId: canceled.payload_json.activityEnrollmentId,
      activitySessionId: canceled.payload_json.activitySessionId,
      taskSourceInvalidationEventId: invalidationId,
      reasonCode: "SOURCE_CANCELED",
      sourceCancellationReasonCode: canceled.payload_json.reasonCode,
      sourceEventId,
    },
  };
}

test("the explicit catalog resolves all four runnable branded production Registrations", () => {
  const registry = getDefaultInboxHandlerRegistry();
  registry.assertReady();
  assert.equal(RUNTIME_EVENT_SCOPES.length, 4);
  for (const scope of RUNTIME_EVENT_SCOPES) {
    assert.equal(scope.workerMode, WORKER_MODES.ENABLED);
    const registration = registry.assertScope(scopeIdentity(scope));
    const asserted = assertRuntimeEventScopeRegistration(registration);
    assert.equal(asserted.scope, scope);
    assert.equal(asserted.registration, registration);
    assert.throws(
      () => assertRuntimeEventScopeRegistration(JSON.parse(JSON.stringify(registration))),
      (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
    );
  }
});

test("SHARE, Activity, and Settlement successor envelopes require exact deterministic identity", () => {
  const [share, confirmed, canceled, sourceInvalidated] = RUNTIME_EVENT_SCOPES;
  assert.equal(assertRuntimeEventRow(share, shareRow()).aggregate_id, "share-event-1");
  assert.equal(assertRuntimeEventRow(confirmed, activityRow("CONFIRMED")).partition_position, 1);
  assert.equal(assertRuntimeEventRow(canceled, activityRow("CANCELED")).partition_position, 2);
  assert.equal(
    assertRuntimeEventRow(sourceInvalidated, sourceInvalidatedRow()).partition_position,
    1
  );

  const malformed = activityRow("CONFIRMED");
  malformed.payload_json = { ...malformed.payload_json, extra: true };
  assert.throws(
    () => assertRuntimeEventRow(confirmed, malformed),
    (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
  );
  const forged = activityRow("CANCELED");
  forged.payload_json = { ...forged.payload_json, activityTaskAssignmentId: "activity_task_forged" };
  assert.throws(
    () => assertRuntimeEventRow(canceled, forged),
    (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
  );
  const forgedInvalidation = sourceInvalidatedRow();
  forgedInvalidation.payload_json = {
    ...forgedInvalidation.payload_json,
    sourceCancellationReasonCode: "UNKNOWN",
  };
  assert.throws(
    () => assertRuntimeEventRow(sourceInvalidated, forgedInvalidation),
    (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
  );
});

test("each SQL contract is exact and caller scope text cannot enter the query", () => {
  for (const scope of RUNTIME_EVENT_SCOPES) {
    const contract = sqlContract(scope, "candidate");
    assert.match(contract.predicate, /candidate\.`topic` = \?/);
    assert.match(contract.predicate, /JSON_LENGTH\(candidate\.`payload_json`\)/);
    assert.deepEqual(contract.values.slice(0, 5), [
      scope.topic, scope.sourceName, scope.eventType, scope.schemaVersion, scope.aggregateType,
    ]);
  }
  assert.throws(() => sqlContract({ eventType: "*" }, "candidate"));
  assert.throws(() => sqlContract(RUNTIME_EVENT_SCOPES[0], "candidate; DROP TABLE outbox_event"));
});
