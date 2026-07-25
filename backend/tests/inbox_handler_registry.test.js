const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const taskShareCompletionProjectionV1 = require("../src/inboxHandlers/taskShareCompletionProjectionV1");
const {
  assertResolvedInboxHandlerRegistration,
  computeInboxHandlerAssemblyDigest,
  computeInboxHandlerDescriptorDigest,
  computeInboxHandlerRegistrationDigest,
  computeInboxHandlerRegistryDigest,
  computeInboxHandlerSourceDigest,
  createInboxHandlerRegistry,
  getDefaultInboxHandlerRegistry,
} = require("../src/inboxHandlerRegistry");
const {
  scanInboxHandlerSource,
  validateProductionInboxHandlerRegistry,
} = require("../../scripts/validate-inbox-handler-registry");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "inbox-handler-registry",
  "v1.0.0.json"
);
const RESOLVE_INPUT = Object.freeze({
  consumerName: "task-share-completion-projection",
  handlerVersion: "task-share-completion-v1",
  sourceName: "myroot-api",
  eventType: "task.event.recorded.v1",
  schemaVersion: "1",
  aggregateType: "TASK_EVENT",
});

function sourceManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function sourceReader(sourcePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, sourcePath));
}

function validEnvelope(overrides = {}) {
  const taskEventId = "task-share-event-001";
  return {
    eventId: "outbox-task-share-event-001",
    eventType: "task.event.recorded.v1",
    schemaVersion: "1",
    sourceName: "myroot-api",
    partitionKey: `task_event:${taskEventId}`,
    partitionPosition: 1,
    aggregateType: "TASK_EVENT",
    aggregateId: taskEventId,
    aggregateVersion: 1,
    occurredAt: "2026-07-17 10:11:12.123",
    producerVersion: "0.5.13",
    correlationId: null,
    causationId: null,
    idempotencyKey: `task-event:${taskEventId}:v1`,
    payload: {
      taskEventId,
      taskType: "SHARE",
      eventType: "SHARE_COMPLETED",
    },
    payloadDigest: "a".repeat(64),
    ...overrides,
  };
}

function handlerEvidence(registration) {
  return {
    handlerId: registration.descriptor.handlerId,
    handlerVersion: registration.descriptor.handlerVersion,
    registryVersion: registration.registryVersion,
    registryDigest: registration.registryDigest,
    assemblySourceDigest: registration.assemblySourceDigest,
    registrationDigest: registration.registrationDigest,
    descriptorDigest: registration.descriptor.descriptorDigest,
    sourceDigest: registration.descriptor.sourceDigest,
  };
}

function databaseRow(parameters) {
  return {
    projection_id: parameters.projectionId,
    projection_generation: parameters.projectionGeneration,
    task_event_id: parameters.taskEventId,
    source_event_id: parameters.sourceEventId,
    source_event_type: parameters.sourceEventType,
    source_schema_version: parameters.sourceSchemaVersion,
    source_name: parameters.sourceName,
    source_partition_key: parameters.sourcePartitionKey,
    source_partition_position: parameters.sourcePartitionPosition,
    source_aggregate_version: parameters.sourceAggregateVersion,
    task_type: parameters.taskType,
    completion_event_type: parameters.completionEventType,
    occurred_at: parameters.occurredAt,
    handler_version: parameters.handlerVersion,
    handler_registration_digest: parameters.handlerRegistrationDigest,
  };
}

function executionHarness(registration, allowedPhases, execute) {
  const statementById = new Map(
    registration.statements.map((statement) => [statement.statementId, statement])
  );
  return async (statementId, parameters) => {
    const statement = statementById.get(statementId);
    if (!statement) {
      const error = new Error("unknown statement");
      error.code = "TEST_UNKNOWN_STATEMENT";
      throw error;
    }
    if (!allowedPhases.includes(statement.phase)) {
      const error = new Error("wrong statement phase");
      error.code = "TEST_WRONG_STATEMENT_PHASE";
      throw error;
    }
    assert.deepEqual(
      Object.keys(parameters).sort(),
      [...statement.parameterNames].sort(),
      `${statementId} parameters must be exact`
    );
    return execute(statement, parameters);
  };
}

test("production Registry exposes an exact frozen Interface with deterministic evidence", () => {
  const manifest = sourceManifest();
  const registry = getDefaultInboxHandlerRegistry();
  assert.deepEqual(Object.keys(registry), ["assertReady", "assertScope", "describe", "resolve"]);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry.assertReady(), true);

  const description = registry.describe();
  assert.equal(Object.isFrozen(description), true);
  assert.equal(description.scope, "PRODUCTION");
  assert.equal(description.registryVersion, 1);
  assert.equal(description.registryDigest, computeInboxHandlerRegistryDigest(manifest));
  assert.equal(description.assemblySourceDigest, computeInboxHandlerAssemblyDigest(
    manifest.assemblySourcePaths,
    sourceReader
  ));
  assert.equal(description.handlerCount, 4);

  const registration = assertResolvedInboxHandlerRegistration(registry.assertScope(RESOLVE_INPUT));
  const descriptor = registration.descriptor;
  assert.equal(Object.isFrozen(registration), true);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(computeInboxHandlerDescriptorDigest(descriptor), descriptor.descriptorDigest);
  assert.equal(computeInboxHandlerSourceDigest(
    descriptor.sourcePaths,
    sourceReader,
    registration.registryScope
  ), descriptor.sourceDigest);
  assert.equal(registration.registrationDigest, computeInboxHandlerRegistrationDigest(
    manifest.handlers[0],
    registration.assemblySourceDigest
  ));
  assert.equal(registry.resolve(RESOLVE_INPUT), registration);
});

test("Registry rejects source drift and unknown production scopes", () => {
  const manifest = sourceManifest();
  assert.throws(
    () => createInboxHandlerRegistry({
      manifest,
      sourceReader(sourcePath) {
        const bytes = sourceReader(sourcePath);
        return sourcePath === manifest.assemblySourcePaths[0]
          ? Buffer.concat([bytes, Buffer.from("\n// assembly drift\n")])
          : bytes;
      },
    }),
    (error) => error && error.code === "INBOX_HANDLER_ASSEMBLY_DRIFT"
  );
  assert.throws(
    () => createInboxHandlerRegistry({
      manifest,
      sourceReader(sourcePath) {
        const bytes = sourceReader(sourcePath);
        return sourcePath === manifest.handlers[0].descriptor.sourcePaths[0]
          ? Buffer.concat([bytes, Buffer.from("\n// drift\n")])
          : bytes;
      },
    }),
    (error) => error && error.code === "INBOX_HANDLER_SOURCE_DRIFT"
  );

  const registry = getDefaultInboxHandlerRegistry();
  const unknown = { ...RESOLVE_INPUT, eventType: "task.event.unknown.v1" };
  assert.equal(registry.resolve(unknown), null);
  assert.throws(
    () => registry.assertScope(unknown),
    (error) => error && error.code === "INBOX_HANDLER_NOT_REGISTERED"
  );
});

test("Registry rejects duplicate, unregistered and illegal statement declarations", () => {
  const mutations = [
    (manifest) => {
      manifest.handlers[0].statements.push({ ...manifest.handlers[0].statements[0] });
    },
    (manifest) => {
      manifest.handlers[0].descriptor.applyStatementIds = [
        ...manifest.handlers[0].descriptor.applyStatementIds,
        "share_projection.undeclared.v1",
      ].sort();
    },
    (manifest) => {
      manifest.handlers[0].statements[0].sql = "DROP TABLE `task_share_completion_projection`";
    },
    (manifest) => {
      manifest.handlers[0].statements[0].parameterRules[0].name = "wrongParameter";
    },
    (manifest) => {
      manifest.handlers[0].descriptor.applyExecutionProfiles = [];
    },
    (manifest) => {
      manifest.handlers[0].descriptor.applyExecutionProfiles[1] = [
        "share_projection.select_conflicts_for_update.v1",
        "share_projection.select_conflicts_for_update.v1",
      ];
    },
    (manifest) => {
      manifest.handlers[0].descriptor.applyExecutionProfiles[1].reverse();
    },
  ];
  for (const mutate of mutations) {
    const manifest = sourceManifest();
    mutate(manifest);
    assert.throws(() => createInboxHandlerRegistry({ manifest }), {
      code: "INBOX_HANDLER_REGISTRY_INVALID",
    });
  }
});

test("registration digest changes with registered SQL while descriptor and source evidence stay local", () => {
  const baseline = getDefaultInboxHandlerRegistry().assertScope(RESOLVE_INPUT);
  const manifest = sourceManifest();
  const statement = manifest.handlers[0].statements.find(
    (candidate) => candidate.statementId === "share_projection.verify_by_id.v1"
  );
  statement.sql = statement.sql.replace(
    "`handler_registration_digest` FROM",
    "`handler_registration_digest`, `created_at` FROM"
  );
  const altered = createInboxHandlerRegistry({ manifest }).assertScope(RESOLVE_INPUT);
  assert.equal(altered.descriptor.descriptorDigest, baseline.descriptor.descriptorDigest);
  assert.equal(altered.descriptor.sourceDigest, baseline.descriptor.sourceDigest);
  assert.notEqual(altered.registrationDigest, baseline.registrationDigest);
  assert.notEqual(altered.registryDigest, baseline.registryDigest);
});

test("VERIFY statements reject locks, writes and stateful SELECT forms", () => {
  for (const sql of [
    "SELECT `projection_id` FROM `task_share_completion_projection` WHERE `projection_id` = ? FOR UPDATE",
    "SELECT @myroot_probe := ?",
    "SELECT LAST_INSERT_ID(?)",
    "UPDATE `task_share_completion_projection` SET `projection_generation` = ? WHERE `projection_id` = ?",
    "DELETE FROM `task_share_completion_projection` WHERE `projection_id` = ?",
  ]) {
    const manifest = sourceManifest();
    const statement = manifest.handlers[0].statements.find(
      (candidate) => candidate.statementId === "share_projection.verify_by_id.v1"
    );
    statement.sql = sql;
    statement.parameterNames = sql.startsWith("UPDATE")
      ? ["projectionGeneration", "projectionId"]
      : ["projectionId"];
    assert.throws(() => createInboxHandlerRegistry({ manifest }), {
      code: "INBOX_HANDLER_REGISTRY_INVALID",
    });
  }
});

test("SHARE handler applies and verifies only registered statements with exact parameters", async () => {
  const registration = getDefaultInboxHandlerRegistry().assertScope(RESOLVE_INPUT);
  const calls = [];
  let inserted;
  const applyExecution = executionHarness(
    registration,
    ["APPLY_READ", "APPLY_WRITE"],
    async (statement, parameters) => {
      calls.push(statement.statementId);
      if (statement.statementId === "share_projection.select_conflicts_for_update.v1") return [];
      inserted = { ...parameters };
      return { affectedRows: 1 };
    }
  );
  const applied = await registration.apply({
    envelope: validEnvelope(),
    handlerEvidence: handlerEvidence(registration),
    executeStatement: applyExecution,
    stageOutbox() {
      assert.fail("database-only SHARE handler must not stage Outbox facts");
    },
  });
  assert.deepEqual(calls, [
    "share_projection.select_conflicts_for_update.v1",
    "share_projection.insert.v1",
  ]);
  assert.ok(inserted);

  const verifyExecution = executionHarness(
    registration,
    ["VERIFY_READ"],
    async (statement, parameters) => {
      assert.equal(statement.statementId, "share_projection.verify_by_id.v1");
      assert.equal(parameters.projectionId, inserted.projectionId);
      return [databaseRow(inserted)];
    }
  );
  assert.equal(await registration.verify({
    envelope: validEnvelope(),
    handlerEvidence: handlerEvidence(registration),
    result: applied.result,
    manifest: applied.manifest,
    executeStatement: verifyExecution,
  }), true);
});

test("statement execution contract fails closed for unknown IDs, wrong phases and inexact parameters", async () => {
  const registration = getDefaultInboxHandlerRegistry().assertScope(RESOLVE_INPUT);
  const applyExecution = executionHarness(
    registration,
    ["APPLY_READ", "APPLY_WRITE"],
    async () => []
  );
  await assert.rejects(
    () => applyExecution("share_projection.unknown.v1", {}),
    (error) => error && error.code === "TEST_UNKNOWN_STATEMENT"
  );
  await assert.rejects(
    () => applyExecution("share_projection.verify_by_id.v1", { projectionId: "share-1" }),
    (error) => error && error.code === "TEST_WRONG_STATEMENT_PHASE"
  );
  await assert.rejects(
    () => applyExecution("share_projection.select_conflicts_for_update.v1", {
      projectionGeneration: 1,
      taskEventId: "task-1",
      sourceEventId: "event-1",
      unexpected: true,
    }),
    /parameters must be exact/
  );
});

test("SHARE handler rejects non-SHARE, identity mismatch and expanded sensitive payloads", async () => {
  const registration = getDefaultInboxHandlerRegistry().assertScope(RESOLVE_INPUT);
  const invalidEnvelopes = [
    validEnvelope({ payload: {
      taskEventId: "task-share-event-001",
      taskType: "CHECKIN",
      eventType: "CHECKIN_COMPLETED",
    } }),
    validEnvelope({ aggregateId: "different-task-event" }),
    validEnvelope({ partitionKey: "task_event:different-task-event" }),
    validEnvelope({ payload: {
      taskEventId: "task-share-event-001",
      taskType: "SHARE",
      eventType: "SHARE_COMPLETED",
      rootUserId: "sensitive-user-id",
    } }),
  ];
  for (const envelope of invalidEnvelopes) {
    await assert.rejects(
      () => registration.apply({
        envelope,
        handlerEvidence: handlerEvidence(registration),
        executeStatement: async () => assert.fail("invalid envelope must fail before SQL"),
        stageOutbox: () => assert.fail("invalid envelope must not stage Outbox facts"),
      }),
      (error) => error && error.code === "TASK_SHARE_PROJECTION_FAILED"
    );
  }
});

test("source policy accepts the production handler and rejects network or dynamic capabilities", () => {
  const manifest = sourceManifest();
  const descriptor = manifest.handlers[0].descriptor;
  assert.deepEqual(scanInboxHandlerSource(sourceReader(descriptor.sourcePaths[0]), {
    sourcePath: descriptor.sourcePaths[0],
    allowedSourcePaths: descriptor.sourcePaths,
  }), {
    sourcePath: descriptor.sourcePaths[0],
    dependencyCount: 1,
    dependencies: ["node:crypto"],
  });

  const forbidden = [
    ["const secret = process.env.ROOT_SECRET;", "INBOX_HANDLER_PROCESS_ENV_FORBIDDEN"],
    ["const secret = process['env'].ROOT_SECRET;", "INBOX_HANDLER_PROCESS_ENV_FORBIDDEN"],
    ["eval('1 + 1');", "INBOX_HANDLER_EVAL_FORBIDDEN"],
    ["new Function('return 1')();", "INBOX_HANDLER_FUNCTION_CONSTRUCTOR_FORBIDDEN"],
    ["const load = require; load(name); require(name);", "INBOX_HANDLER_DYNAMIC_REQUIRE_FORBIDDEN"],
    ["require /* bypass */ ('node:https');", "INBOX_HANDLER_DYNAMIC_REQUIRE_FORBIDDEN"],
    ["import('node:https');", "INBOX_HANDLER_DYNAMIC_IMPORT_FORBIDDEN"],
    ["fetch('https://example.com');", "INBOX_HANDLER_NETWORK_GLOBAL_FORBIDDEN"],
    ["globalThis['fetch']('https://example.com');", "INBOX_HANDLER_NETWORK_GLOBAL_FORBIDDEN"],
    ["require('node:https');", "INBOX_HANDLER_NETWORK_MODULE_FORBIDDEN"],
    ["require('ws');", "INBOX_HANDLER_EXTERNAL_MODULE_FORBIDDEN"],
  ];
  for (const [source, code] of forbidden) {
    assert.throws(
      () => scanInboxHandlerSource(source, {
        sourcePath: "backend/src/inboxHandlers/unsafe.js",
        allowedSourcePaths: ["backend/src/inboxHandlers/unsafe.js"],
      }),
      (error) => error && error.code === code,
      code
    );
  }
});

test("standalone validator reads back all production handlers and authorized sources", () => {
  const result = validateProductionInboxHandlerRegistry();
  assert.equal(result.status, "PASS");
  assert.equal(result.scope, "PRODUCTION");
  assert.equal(result.handlerCount, 4);
  assert.equal(result.sourceCount, 4);
  assert.deepEqual(result.handlers.map((handler) => handler.handlerId), [
    "task-share-completion-projection-v1",
    "activity-enrollment-confirmed-task-v1",
    "activity-enrollment-canceled-task-v1",
    "task-source-invalidation-settlement-v1",
  ]);
  result.sources.forEach((source) => {
    assert.deepEqual(source.dependencies, ["node:crypto"]);
  });
});

test("production implementation map remains exact and cannot inject an unregistered handler", () => {
  const manifest = sourceManifest();
  assert.throws(() => createInboxHandlerRegistry({
    manifest,
    implementations: {
      "task-share-completion-projection-v1": taskShareCompletionProjectionV1,
      "unregistered-handler-v1": taskShareCompletionProjectionV1,
    },
  }), {
    code: "INBOX_HANDLER_REGISTRY_INVALID",
  });
});
