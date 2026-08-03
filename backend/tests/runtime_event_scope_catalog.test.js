const test = require("node:test");
const assert = require("node:assert/strict");

const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");
const {
  WORKER_MODES,
  RUNTIME_EVENT_SCOPES,
  assertRuntimeEventRow,
  assertRuntimeEventScopeRegistration,
  scopeIdentity,
  sqlContract,
} = require("../src/runtimeEventScopeCatalog");

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

test("the runtime catalog exposes only the remaining registered scope", () => {
  const registry = getDefaultInboxHandlerRegistry();
  registry.assertReady();
  assert.equal(RUNTIME_EVENT_SCOPES.length, 1);
  const [scope] = RUNTIME_EVENT_SCOPES;
  assert.equal(scope.workerMode, WORKER_MODES.ENABLED);
  const registration = registry.assertScope(scopeIdentity(scope));
  const asserted = assertRuntimeEventScopeRegistration(registration);
  assert.equal(asserted.scope, scope);
  assert.equal(asserted.registration, registration);
  assert.throws(
    () => assertRuntimeEventScopeRegistration(JSON.parse(JSON.stringify(registration))),
    (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
  );
});

test("the remaining runtime envelope requires exact SHARE identity", () => {
  const [scope] = RUNTIME_EVENT_SCOPES;
  assert.equal(assertRuntimeEventRow(scope, shareRow()).aggregate_id, "share-event-1");
  const malformed = shareRow();
  malformed.payload_json = { ...malformed.payload_json, extra: true };
  assert.throws(
    () => assertRuntimeEventRow(scope, malformed),
    (error) => error.code === "RUNTIME_EVENT_SCOPE_INVALID"
  );
});

test("the SQL contract is exact and caller scope text cannot enter the query", () => {
  const [scope] = RUNTIME_EVENT_SCOPES;
  const contract = sqlContract(scope, "candidate");
  assert.match(contract.predicate, /candidate\.`topic` = \?/);
  assert.match(contract.predicate, /JSON_LENGTH\(candidate\.`payload_json`\)/);
  assert.deepEqual(contract.values.slice(0, 5), [
    scope.topic, scope.sourceName, scope.eventType, scope.schemaVersion, scope.aggregateType,
  ]);
  assert.throws(() => sqlContract({ eventType: "*" }, "candidate"));
  assert.throws(() => sqlContract(scope, "candidate; DROP TABLE outbox_event"));
});
