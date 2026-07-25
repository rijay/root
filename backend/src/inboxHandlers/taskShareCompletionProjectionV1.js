const crypto = require("node:crypto");

const PROJECTION_GENERATION = 1;
const HANDLER_VERSION = "task-share-completion-v1";
const APPLY_SELECT_ID = "share_projection.select_conflicts_for_update.v1";
const APPLY_INSERT_ID = "share_projection.insert.v1";
const VERIFY_SELECT_ID = "share_projection.verify_by_id.v1";

function handlerError() {
  const error = new Error("task share completion projection could not be applied");
  error.code = "TASK_SHARE_PROJECTION_FAILED";
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
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function projectionId(taskEventId) {
  const digest = crypto
    .createHash("sha256")
    .update(`myroot:task-share-completion-projection:v1:${taskEventId}`, "utf8")
    .digest("hex");
  return `share_${digest.slice(0, 58)}`;
}

function normalizeEnvelope(envelope) {
  if (!plainRecord(envelope)
    || envelope.eventType !== "task.event.recorded.v1"
    || envelope.schemaVersion !== "1"
    || envelope.sourceName !== "myroot-api"
    || envelope.aggregateType !== "TASK_EVENT"
    || envelope.aggregateVersion !== 1
    || envelope.partitionPosition !== 1
    || !exactText(envelope.eventId, 64)
    || !exactText(envelope.aggregateId, 64)
    || !exactKeys(envelope.payload, ["taskEventId", "taskType", "eventType"])
    || !exactText(envelope.payload.taskEventId, 64)
    || envelope.payload.taskType !== "SHARE"
    || envelope.payload.eventType !== "SHARE_COMPLETED"
    || !byteEqual(envelope.aggregateId, envelope.payload.taskEventId)
    || !byteEqual(envelope.partitionKey, `task_event:${envelope.payload.taskEventId}`)) {
    throw handlerError();
  }
  return Object.freeze({
    projectionId: projectionId(envelope.payload.taskEventId),
    projectionGeneration: PROJECTION_GENERATION,
    taskEventId: envelope.payload.taskEventId,
    sourceEventId: envelope.eventId,
    sourceEventType: envelope.eventType,
    sourceSchemaVersion: envelope.schemaVersion,
    sourceName: envelope.sourceName,
    sourcePartitionKey: envelope.partitionKey,
    sourcePartitionPosition: envelope.partitionPosition,
    sourceAggregateVersion: envelope.aggregateVersion,
    taskType: envelope.payload.taskType,
    completionEventType: envelope.payload.eventType,
    occurredAt: envelope.occurredAt,
  });
}

function expectedFact(envelope, handlerEvidence) {
  if (!plainRecord(handlerEvidence)
    || !exactText(handlerEvidence.registrationDigest, 64)
    || !/^[a-f0-9]{64}$/.test(handlerEvidence.registrationDigest)
    || handlerEvidence.handlerVersion !== HANDLER_VERSION) throw handlerError();
  return Object.freeze({
    ...normalizeEnvelope(envelope),
    handlerVersion: handlerEvidence.handlerVersion,
    handlerRegistrationDigest: handlerEvidence.registrationDigest,
  });
}

function exactFact(row, expected) {
  return plainRecord(row)
    && byteEqual(row.projection_id, expected.projectionId)
    && Number(row.projection_generation) === expected.projectionGeneration
    && byteEqual(row.task_event_id, expected.taskEventId)
    && byteEqual(row.source_event_id, expected.sourceEventId)
    && byteEqual(row.source_event_type, expected.sourceEventType)
    && byteEqual(row.source_schema_version, expected.sourceSchemaVersion)
    && byteEqual(row.source_name, expected.sourceName)
    && byteEqual(row.source_partition_key, expected.sourcePartitionKey)
    && Number(row.source_partition_position) === expected.sourcePartitionPosition
    && Number(row.source_aggregate_version) === expected.sourceAggregateVersion
    && byteEqual(row.task_type, expected.taskType)
    && byteEqual(row.completion_event_type, expected.completionEventType)
    && byteEqual(row.occurred_at, expected.occurredAt)
    && byteEqual(row.handler_version, expected.handlerVersion)
    && byteEqual(row.handler_registration_digest, expected.handlerRegistrationDigest);
}

function writeParameters(fact) {
  return {
    projectionId: fact.projectionId,
    projectionGeneration: fact.projectionGeneration,
    taskEventId: fact.taskEventId,
    sourceEventId: fact.sourceEventId,
    sourceEventType: fact.sourceEventType,
    sourceSchemaVersion: fact.sourceSchemaVersion,
    sourceName: fact.sourceName,
    sourcePartitionKey: fact.sourcePartitionKey,
    sourcePartitionPosition: fact.sourcePartitionPosition,
    sourceAggregateVersion: fact.sourceAggregateVersion,
    taskType: fact.taskType,
    completionEventType: fact.completionEventType,
    occurredAt: fact.occurredAt,
    handlerVersion: fact.handlerVersion,
    handlerRegistrationDigest: fact.handlerRegistrationDigest,
  };
}

async function apply(context) {
  if (!plainRecord(context)
    || typeof context.executeStatement !== "function"
    || typeof context.stageOutbox !== "function") throw handlerError();
  const fact = expectedFact(context.envelope, context.handlerEvidence);
  const conflicts = await context.executeStatement(APPLY_SELECT_ID, {
    projectionGeneration: fact.projectionGeneration,
    taskEventId: fact.taskEventId,
    sourceEventId: fact.sourceEventId,
  });
  if (!Array.isArray(conflicts) || conflicts.length > 1) throw handlerError();
  if (conflicts.length === 1) {
    if (!exactFact(conflicts[0], fact)) throw handlerError();
  } else {
    const inserted = await context.executeStatement(APPLY_INSERT_ID, writeParameters(fact));
    if (!plainRecord(inserted) || inserted.affectedRows !== 1) throw handlerError();
  }
  return {
    result: {
      projectionId: fact.projectionId,
      projectionGeneration: fact.projectionGeneration,
      taskEventId: fact.taskEventId,
    },
    manifest: {
      targetFactIds: [fact.projectionId],
      projectionGeneration: fact.projectionGeneration,
      taskEventId: fact.taskEventId,
    },
  };
}

async function verify(context) {
  if (!plainRecord(context)
    || !plainRecord(context.result)
    || !plainRecord(context.manifest)
    || typeof context.executeStatement !== "function") return false;
  let fact;
  try { fact = expectedFact(context.envelope, context.handlerEvidence); } catch { return false; }
  if (!exactKeys(context.result, ["projectionId", "projectionGeneration", "taskEventId"])
    || !exactKeys(context.manifest, ["targetFactIds", "projectionGeneration", "taskEventId"])
    || context.result.projectionId !== fact.projectionId
    || context.result.projectionGeneration !== fact.projectionGeneration
    || context.result.taskEventId !== fact.taskEventId
    || !Array.isArray(context.manifest.targetFactIds)
    || context.manifest.targetFactIds.length !== 1
    || context.manifest.targetFactIds[0] !== fact.projectionId
    || context.manifest.projectionGeneration !== fact.projectionGeneration
    || context.manifest.taskEventId !== fact.taskEventId) return false;
  let rows;
  try {
    rows = await context.executeStatement(VERIFY_SELECT_ID, {
      projectionId: fact.projectionId,
    });
  } catch {
    return false;
  }
  return Array.isArray(rows) && rows.length === 1 && exactFact(rows[0], fact);
}

module.exports = Object.freeze({
  apply,
  verify,
  outboxBuilders: Object.freeze({}),
});
