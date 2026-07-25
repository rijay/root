const crypto = require("node:crypto");

const APPLY_SELECT_ID = "task_share_shadow.select_conflicts_for_update.v1";
const APPLY_INSERT_ID = "task_share_shadow.insert.v1";
const VERIFY_SELECT_ID = "task_share_shadow.verify_by_run_receipt.v1";
const EXECUTOR_ID = "task-share-completion-shadow-v1";
const EXECUTOR_VERSION = "task-share-shadow-v1";

function executorError() {
  const error = new Error("task share shadow replay execution failed");
  error.code = "TASK_SHARE_SHADOW_REPLAY_EXECUTION_FAILED";
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function shadowProjectionId(replayRunId, sourceReceiptId) {
  const digest = crypto.createHash("sha256")
    .update("myroot-inbox-shadow-projection-id:v1\0", "utf8")
    .update(JSON.stringify({ replayRunId, sourceReceiptId }), "utf8")
    .digest("hex");
  return `shadow_${digest.slice(0, 57)}`;
}

function expectedFact(sourceFact, runEvidence, executorEvidence) {
  if (!exactKeys(sourceFact, [
    "projectionId", "projectionGeneration", "taskEventId", "sourceEventId",
    "sourceEventType", "sourceSchemaVersion", "sourceName", "sourcePartitionKey",
    "sourcePartitionPosition", "sourceAggregateVersion", "taskType",
    "completionEventType", "occurredAt", "handlerVersion",
    "handlerRegistrationDigest",
  ])
    || sourceFact.projectionGeneration !== 1
    || sourceFact.sourceEventType !== "task.event.recorded.v1"
    || sourceFact.sourceSchemaVersion !== "1"
    || sourceFact.sourceName !== "myroot-api"
    || sourceFact.taskType !== "SHARE"
    || sourceFact.completionEventType !== "SHARE_COMPLETED"
    || sourceFact.handlerVersion !== "task-share-completion-v1"
    || !exactText(sourceFact.taskEventId, 64)
    || !exactText(sourceFact.sourceEventId, 64)
    || sourceFact.sourcePartitionKey !== `task_event:${sourceFact.taskEventId}`
    || !exactInteger(sourceFact.sourcePartitionPosition, 1)
    || !exactInteger(sourceFact.sourceAggregateVersion, 1)
    || !exactText(sourceFact.occurredAt, 64)
    || !/^[a-f0-9]{64}$/.test(sourceFact.handlerRegistrationDigest)
    || !exactKeys(runEvidence, [
      "replayRunId", "shadowGeneration", "sourceReceiptId",
      "sourceHandlerRegistrationDigest",
    ])
    || !exactText(runEvidence.replayRunId, 64)
    || !exactInteger(runEvidence.shadowGeneration, 2)
    || !exactText(runEvidence.sourceReceiptId, 64)
    || runEvidence.sourceHandlerRegistrationDigest !== sourceFact.handlerRegistrationDigest
    || !exactKeys(executorEvidence, [
      "executorId", "executorVersion", "registryVersion", "registryDigest",
      "descriptorDigest", "sourceDigest", "registrationDigest",
    ])
    || executorEvidence.executorId !== EXECUTOR_ID
    || executorEvidence.executorVersion !== EXECUTOR_VERSION
    || !exactInteger(executorEvidence.registryVersion, 1)
    || !/^[a-f0-9]{64}$/.test(executorEvidence.registryDigest)
    || !/^[a-f0-9]{64}$/.test(executorEvidence.descriptorDigest)
    || !/^[a-f0-9]{64}$/.test(executorEvidence.sourceDigest)
    || !/^[a-f0-9]{64}$/.test(executorEvidence.registrationDigest)) throw executorError();

  return Object.freeze({
    shadowProjectionId: shadowProjectionId(
      runEvidence.replayRunId,
      runEvidence.sourceReceiptId
    ),
    replayRunId: runEvidence.replayRunId,
    projectionGeneration: runEvidence.shadowGeneration,
    sourceReceiptId: runEvidence.sourceReceiptId,
    taskEventId: sourceFact.taskEventId,
    sourceEventId: sourceFact.sourceEventId,
    sourceEventType: sourceFact.sourceEventType,
    sourceSchemaVersion: sourceFact.sourceSchemaVersion,
    sourceName: sourceFact.sourceName,
    sourcePartitionKey: sourceFact.sourcePartitionKey,
    sourcePartitionPosition: sourceFact.sourcePartitionPosition,
    sourceAggregateVersion: sourceFact.sourceAggregateVersion,
    taskType: sourceFact.taskType,
    completionEventType: sourceFact.completionEventType,
    occurredAt: sourceFact.occurredAt,
    sourceHandlerRegistrationDigest: sourceFact.handlerRegistrationDigest,
    executionHandlerId: executorEvidence.executorId,
    executionHandlerVersion: executorEvidence.executorVersion,
  });
}

function writeParameters(fact) {
  return { ...fact };
}

function exactFact(row, fact) {
  if (!plainRecord(row)) return false;
  const mapping = {
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
  return Object.entries(mapping).every(([key, value]) => (
    ["projection_generation", "source_partition_position", "source_aggregate_version"].includes(key)
      ? Number(row[key]) === value
      : row[key] === value
  ));
}

async function apply(context) {
  if (!exactKeys(context, [
    "sourceFact", "runEvidence", "executorEvidence", "executeStatement",
  ]) || typeof context.executeStatement !== "function") throw executorError();
  const fact = expectedFact(context.sourceFact, context.runEvidence, context.executorEvidence);
  const conflicts = await context.executeStatement(APPLY_SELECT_ID, {
    replayRunId: fact.replayRunId,
    sourceReceiptId: fact.sourceReceiptId,
    projectionGeneration: fact.projectionGeneration,
    taskEventId: fact.taskEventId,
    sourceEventId: fact.sourceEventId,
  });
  if (!Array.isArray(conflicts) || conflicts.length > 1) throw executorError();
  let disposition = "REPLAYED";
  if (conflicts.length === 0) {
    const inserted = await context.executeStatement(APPLY_INSERT_ID, writeParameters(fact));
    if (!plainRecord(inserted) || inserted.affectedRows !== 1) throw executorError();
    disposition = "INSERTED";
  } else if (!exactFact(conflicts[0], fact)) throw executorError();
  return Object.freeze({
    result: Object.freeze({
      shadowProjectionId: fact.shadowProjectionId,
      replayRunId: fact.replayRunId,
      sourceReceiptId: fact.sourceReceiptId,
      projectionGeneration: fact.projectionGeneration,
      disposition,
    }),
    manifest: Object.freeze({ fact: Object.freeze({ ...fact }) }),
  });
}

async function verify(context) {
  if (!exactKeys(context, [
    "sourceFact", "runEvidence", "executorEvidence", "result", "manifest",
    "executeStatement",
  ]) || typeof context.executeStatement !== "function" || !plainRecord(context.result)
    || !plainRecord(context.manifest) || !plainRecord(context.manifest.fact)) return false;
  let fact;
  try { fact = expectedFact(context.sourceFact, context.runEvidence, context.executorEvidence); } catch {
    return false;
  }
  if (!exactKeys(context.result, [
    "shadowProjectionId", "replayRunId", "sourceReceiptId",
    "projectionGeneration", "disposition",
  ]) || !["INSERTED", "REPLAYED"].includes(context.result.disposition)
    || context.result.shadowProjectionId !== fact.shadowProjectionId
    || context.result.replayRunId !== fact.replayRunId
    || context.result.sourceReceiptId !== fact.sourceReceiptId
    || context.result.projectionGeneration !== fact.projectionGeneration
    || JSON.stringify(context.manifest.fact) !== JSON.stringify(fact)) return false;
  let rows;
  try {
    rows = await context.executeStatement(VERIFY_SELECT_ID, {
      replayRunId: fact.replayRunId,
      sourceReceiptId: fact.sourceReceiptId,
    });
  } catch { return false; }
  return Array.isArray(rows) && rows.length === 1 && exactFact(rows[0], fact);
}

module.exports = Object.freeze({ apply, verify });
