const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertResolvedInboxReplayExecutorRegistration,
  computeInboxReplayExecutorAssemblyDigest,
  computeInboxReplayExecutorDescriptorDigest,
  computeInboxReplayExecutorRegistrationDigest,
  computeInboxReplayExecutorRegistryDigest,
  computeInboxReplayExecutorSourceDigest,
  computeInboxReplayStatementSqlDigest,
  createInboxReplayExecutorRegistry,
  getDefaultInboxReplayExecutorRegistry,
  validateInboxReplayExecutorRegistryForTest,
} = require("../src/inboxReplayExecutorRegistry");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "inbox-replay-executor-registry",
  "v1.0.0.json"
);
const DIGEST = "a".repeat(64);

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function testManifest() {
  return { ...manifest(), scope: "TEST_ONLY" };
}

function realSourceReader(sourcePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, sourcePath));
}

function validateForTest(source) {
  return validateInboxReplayExecutorRegistryForTest({
    scope: "TEST_ONLY",
    manifest: source,
    sourceReader: realSourceReader,
  });
}

function sourceFact() {
  return {
    projectionId: "task-projection-source-001",
    projectionGeneration: 1,
    taskEventId: "task-event-source-001",
    sourceEventId: "event-source-001",
    sourceEventType: "task.event.recorded.v1",
    sourceSchemaVersion: "1",
    sourceName: "myroot-api",
    sourcePartitionKey: "task_event:task-event-source-001",
    sourcePartitionPosition: 1,
    sourceAggregateVersion: 1,
    taskType: "SHARE",
    completionEventType: "SHARE_COMPLETED",
    occurredAt: "2026-07-16 18:00:00.000",
    handlerVersion: "task-share-completion-v1",
    handlerRegistrationDigest: DIGEST,
  };
}

function shadowRow(fact) {
  return {
    shadow_projection_id: fact.shadowProjectionId,
    replay_run_id: fact.replayRunId,
    projection_generation: fact.projectionGeneration,
    source_receipt_id: fact.sourceReceiptId,
    task_event_id: fact.taskEventId,
    source_event_id: fact.sourceEventId,
    source_event_type: fact.sourceEventType,
    source_schema_version: fact.sourceSchemaVersion,
    source_name: fact.sourceName,
    source_partition_key: fact.sourcePartitionKey,
    source_partition_position: fact.sourcePartitionPosition,
    source_aggregate_version: fact.sourceAggregateVersion,
    task_type: fact.taskType,
    completion_event_type: fact.completionEventType,
    occurred_at: fact.occurredAt,
    source_handler_registration_digest: fact.sourceHandlerRegistrationDigest,
    execution_handler_id: fact.executionHandlerId,
    execution_handler_version: fact.executionHandlerVersion,
  };
}

test("production Replay Executor Registry is deterministic and exposes one frozen static registration", () => {
  const source = manifest();
  const registry = getDefaultInboxReplayExecutorRegistry();
  assert.deepEqual(Object.keys(registry), ["assertReady", "describe", "resolve"]);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry.assertReady(), true);
  const description = registry.describe();
  assert.equal(Object.isFrozen(description), true);
  assert.equal(description.scope, "PRODUCTION");
  assert.equal(description.registryVersion, 1);
  assert.equal(description.executorCount, 1);
  assert.equal(description.registryDigest, computeInboxReplayExecutorRegistryDigest(source));
  assert.equal(
    description.assemblySourceDigest,
    computeInboxReplayExecutorAssemblyDigest(source.assemblySourcePaths)
  );
  const descriptor = source.executors[0].descriptor;
  assert.equal(descriptor.sourceDigest, computeInboxReplayExecutorSourceDigest(descriptor.sourcePaths));
  assert.equal(descriptor.descriptorDigest, computeInboxReplayExecutorDescriptorDigest(descriptor));
  assert.equal(description.executors[0].sourceDigest, descriptor.sourceDigest);
  assert.equal(description.executors[0].descriptorDigest, descriptor.descriptorDigest);
});

test("only the exact registered executor identity resolves and clones cannot cross the Interface", () => {
  const registry = getDefaultInboxReplayExecutorRegistry();
  const registration = registry.resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
  assert.equal(Object.isFrozen(registration), true);
  assert.equal(Object.isFrozen(registration.descriptor), true);
  assert.equal(Object.isFrozen(registration.statements), true);
  assert.equal(assertResolvedInboxReplayExecutorRegistration(registration), registration);
  assert.equal(
    registration.registrationDigest,
    computeInboxReplayExecutorRegistrationDigest(
      { descriptor: registration.descriptor, statements: registration.statements },
      registration.assemblySourceDigest
    )
  );
  assert.equal(registry.resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v2",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  }), null);
  assert.throws(
    () => assertResolvedInboxReplayExecutorRegistration({ ...registration }),
    (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
  );
});

test("registered statements are shadow-only and contain no Outbox, Inbox or production projection mutation", () => {
  const registration = getDefaultInboxReplayExecutorRegistry().resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
  assert.deepEqual(registration.statements.map((statement) => statement.statementId), [
    "task_share_shadow.insert.v1",
    "task_share_shadow.select_conflicts_for_update.v1",
    "task_share_shadow.verify_by_run_receipt.v1",
  ]);
  for (const statement of registration.statements) {
    assert.equal(statement.placeholderCount, statement.parameterNames.length);
    assert.equal(statement.sqlDigest, computeInboxReplayStatementSqlDigest(statement.sql));
    assert.match(statement.sql, /task_share_completion_shadow_projection/);
    assert.doesNotMatch(
      statement.sql.replaceAll("task_share_completion_shadow_projection", ""),
      /\b(?:outbox_event|inbox_receipt|consumer_checkpoint|task_share_completion_projection)\b/i
    );
    assert.doesNotMatch(
      statement.sql.replace(/\s+FOR UPDATE\s*$/i, ""),
      /\b(?:UPDATE|DELETE|REPLACE|CALL|LOAD|GRANT|CREATE|ALTER|DROP)\b/i
    );
  }
});

test("pure registered executor applies and verifies only through registered statement identifiers", async () => {
  const registration = getDefaultInboxReplayExecutorRegistry().resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
  const evidence = {
    executorId: registration.descriptor.executorId,
    executorVersion: registration.descriptor.executorVersion,
    registryVersion: registration.registryVersion,
    registryDigest: registration.registryDigest,
    descriptorDigest: registration.descriptor.descriptorDigest,
    sourceDigest: registration.descriptor.sourceDigest,
    registrationDigest: registration.registrationDigest,
  };
  const runEvidence = {
    replayRunId: "replay-run-executor-001",
    shadowGeneration: 2,
    sourceReceiptId: "source-receipt-001",
    sourceHandlerRegistrationDigest: DIGEST,
  };
  const calls = [];
  let insertedFact = null;
  const executeStatement = async (statementId, parameters) => {
    calls.push(statementId);
    if (statementId === "task_share_shadow.select_conflicts_for_update.v1") return [];
    if (statementId === "task_share_shadow.insert.v1") {
      insertedFact = { ...parameters };
      return { affectedRows: 1 };
    }
    if (statementId === "task_share_shadow.verify_by_run_receipt.v1") {
      return [shadowRow(insertedFact)];
    }
    assert.fail(`unregistered statement: ${statementId}`);
  };
  const applied = await registration.apply({
    sourceFact: sourceFact(),
    runEvidence,
    executorEvidence: evidence,
    executeStatement,
  });
  assert.equal(applied.result.disposition, "INSERTED");
  assert.equal(await registration.verify({
    sourceFact: sourceFact(),
    runEvidence,
    executorEvidence: evidence,
    result: applied.result,
    manifest: applied.manifest,
    executeStatement,
  }), true);
  assert.deepEqual(calls, [
    "task_share_shadow.select_conflicts_for_update.v1",
    "task_share_shadow.insert.v1",
    "task_share_shadow.verify_by_run_receipt.v1",
  ]);
});

test("production factory is no-argument-only and TEST_ONLY validation cannot mint a production brand", () => {
  for (const injected of [
    {},
    { manifest: manifest() },
    { sourceReader: realSourceReader },
    {
      implementations: {
        "task-share-completion-shadow-v1": { async apply() {}, async verify() {} },
      },
    },
  ]) {
    assert.throws(
      () => createInboxReplayExecutorRegistry(injected),
      (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
    );
  }
  const registry = validateForTest(testManifest());
  assert.equal(registry.describe().scope, "TEST_ONLY");
  const registration = registry.resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
  assert.throws(
    () => assertResolvedInboxReplayExecutorRegistration(registration),
    (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
  );
  const productionRegistration = getDefaultInboxReplayExecutorRegistry().resolve({
    executorId: "task-share-completion-shadow-v1",
    executorVersion: "task-share-shadow-v1",
    policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
    mode: "SHADOW_REBUILD",
  });
  const reflectedClone = { ...registration };
  for (const symbol of Object.getOwnPropertySymbols(productionRegistration)) {
    Object.defineProperty(
      reflectedClone,
      symbol,
      Object.getOwnPropertyDescriptor(productionRegistration, symbol)
    );
  }
  assert.throws(
    () => assertResolvedInboxReplayExecutorRegistration(reflectedClone),
    (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
  );
  assert.throws(
    () => validateInboxReplayExecutorRegistryForTest({
      scope: "PRODUCTION",
      manifest: manifest(),
      sourceReader: realSourceReader,
    }),
    (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
  );
});

test("source, assembly and SQL capability drift fail closed", () => {
  const mutations = [
    ["INBOX_REPLAY_EXECUTOR_SOURCE_DRIFT", (source) => {
      source.executors[0].descriptor.sourceDigest = "f".repeat(64);
    }],
    ["INBOX_REPLAY_EXECUTOR_ASSEMBLY_DRIFT", (source) => {
      source.assemblySourceDigest = "f".repeat(64);
    }],
    ["INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID", (source) => {
      source.executors[0].statements[0].sql = "INSERT INTO outbox_event (event_id) VALUES (?)";
    }],
  ];
  for (const [code, mutate] of mutations) {
    const source = testManifest();
    mutate(source);
    assert.throws(
      () => validateForTest(source),
      (error) => error && error.code === code,
      code
    );
  }
});

test("comment-target, multi-statement, CTE, UNION, subquery, extra-table and placeholder drift fail closed", () => {
  const original = manifest().executors[0].statements[1].sql;
  const attacks = [
    `${original} /* task_share_completion_shadow_projection */`,
    `${original}; DELETE FROM outbox_event`,
    `WITH chosen AS (${original.replace(/ FOR UPDATE$/, "")}) SELECT * FROM chosen`,
    `${original.replace(/ FOR UPDATE$/, "")} UNION SELECT * FROM outbox_event`,
    "SELECT * FROM (SELECT * FROM task_share_completion_shadow_projection) AS chosen",
    `${original.replace(/ FOR UPDATE$/, "")} JOIN outbox_event ON 1 = 1`,
    `${original} AND ? = ?`,
  ];
  for (const sql of attacks) {
    const source = testManifest();
    const statement = source.executors[0].statements[1];
    statement.sql = sql;
    statement.sqlDigest = computeInboxReplayStatementSqlDigest(sql);
    statement.placeholderCount = (sql.match(/\?/g) || []).length;
    assert.throws(
      () => validateForTest(source),
      (error) => error && error.code === "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID"
    );
  }
});
