const crypto = require("node:crypto");

const { createClientError } = require("./clientError");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { payloadSnapshot } = require("./eventTransport");

const TASK_EVENT_IDEMPOTENCY_OPERATION = "RECORD_TASK_EVENT:v1";
const TASK_EVENT_CANONICAL_VERSION = "canonical-json:v1";

function taskEventIdempotencyError(code, message, status) {
  return createClientError(code, message, status);
}

function exactText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function literalText(value) {
  return typeof value === "string" ? value : "";
}

function normalizeRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw taskEventIdempotencyError(
      "TASK_EVENT_IDEMPOTENCY_REQUEST_INVALID",
      "任务事件请求无法建立幂等摘要",
      400
    );
  }
  let payload;
  try {
    payload = payloadSnapshot(input.payload || {}).payload;
  } catch {
    throw taskEventIdempotencyError(
      "TASK_EVENT_IDEMPOTENCY_REQUEST_INVALID",
      "任务事件请求无法建立幂等摘要",
      400
    );
  }
  const request = {
    campaignId: exactText(input.campaignId),
    taskDefinitionId: exactText(input.taskDefinitionId),
    taskType: exactText(input.taskType),
    eventType: exactText(input.eventType),
    taskDate: exactText(input.taskDate),
    payload,
    sourceChannel: exactText(input.sourceChannel),
    occurredAt: input.occurredAt === null || input.occurredAt === undefined
      ? null
      : exactText(input.occurredAt),
  };
  if (
    !request.campaignId
    || !request.taskDefinitionId
    || !request.taskType
    || !request.eventType
    || !request.taskDate
    || (input.occurredAt !== null && input.occurredAt !== undefined && !request.occurredAt)
  ) {
    throw taskEventIdempotencyError(
      "TASK_EVENT_IDEMPOTENCY_REQUEST_INVALID",
      "任务事件请求无法建立幂等摘要",
      400
    );
  }
  return Object.freeze(request);
}

function descriptor(rootUserId, idempotencyKey, request) {
  return Object.freeze({
    commandName: TASK_EVENT_IDEMPOTENCY_OPERATION,
    actorId: rootUserId,
    idempotencyKey,
    request,
  });
}

function digestEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function storedDigest(event) {
  const values = {
    canonicalVersion: exactText(event.request_canonical_version),
    digestVersion: exactText(event.request_digest_scheme),
    keyId: exactText(event.request_digest_key_id),
    digest: exactText(event.request_digest).toLowerCase(),
  };
  const present = Object.values(values).filter(Boolean).length;
  return { values, present };
}

function requestFromEvent(event) {
  if (
    event.occurred_at_client_supplied !== true
    && event.occurred_at_client_supplied !== false
  ) {
    throw taskEventIdempotencyError(
      "TASK_EVENT_IDEMPOTENCY_PROVENANCE_UNKNOWN",
      "历史任务事件时间来源无法验证",
      503
    );
  }
  return normalizeRequest({
    campaignId: event.campaign_id,
    taskDefinitionId: event.task_definition_id,
    taskType: event.task_type,
    eventType: event.event_type,
    taskDate: event.task_date,
    payload: event.payload_json || {},
    sourceChannel: event.source_channel || "",
    occurredAt: event.occurred_at_client_supplied === true ? event.occurred_at : null,
  });
}

function applyMetadata(event, metadata) {
  event.idempotency_operation = TASK_EVENT_IDEMPOTENCY_OPERATION;
  event.request_canonical_version = metadata.canonicalVersion;
  event.request_digest = metadata.digest;
  event.request_digest_scheme = metadata.digestVersion;
  event.request_digest_key_id = metadata.keyId;
}

function normalizeTaskEventIdempotencyState(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;
  if (!exactText(event.idempotency_operation)) {
    event.idempotency_operation = TASK_EVENT_IDEMPOTENCY_OPERATION;
  }
  if (event.occurred_at_client_supplied === undefined) {
    event.occurred_at_client_supplied = null;
  }
  return event;
}

function createTaskEventIdempotencyClaim(input = {}, context = {}) {
  const rootUserId = exactText(input.rootUserId);
  // The MySQL Interface persists this value under ascii_bin without any
  // normalization. Validate the caller's literal value so whitespace or
  // Unicode cannot be silently rewritten into a different idempotency scope.
  const idempotencyKey = literalText(input.idempotencyKey);
  if (
    !rootUserId
    || rootUserId.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)
  ) {
    throw taskEventIdempotencyError(
      "TASK_EVENT_IDEMPOTENCY_SCOPE_INVALID",
      "任务事件幂等作用域无效",
      400
    );
  }
  const request = normalizeRequest(input.request);
  const codec = context.taskEventRequestDigestCodec
    || createCommandRequestDigestCodec(context.env || process.env);
  const currentDescriptor = descriptor(rootUserId, idempotencyKey, request);
  const metadata = codec.digest(currentDescriptor);

  function scopeMatches(event) {
    return Boolean(event)
      && event.root_user_id === rootUserId
      && (event.idempotency_operation || TASK_EVENT_IDEMPOTENCY_OPERATION) === TASK_EVENT_IDEMPOTENCY_OPERATION
      && event.idempotency_key === idempotencyKey;
  }

  function reconcile(event) {
    if (!scopeMatches(event)) {
      throw taskEventIdempotencyError(
        "TASK_EVENT_IDEMPOTENCY_SCOPE_INVALID",
        "任务事件幂等作用域无效",
        503
      );
    }
    const stored = storedDigest(event);
    let replayMatches = false;
    if (stored.present === 0) {
      const legacyMetadata = codec.digest(descriptor(rootUserId, idempotencyKey, requestFromEvent(event)));
      replayMatches = digestEqual(metadata.digest, legacyMetadata.digest);
    } else if (stored.present !== 4) {
      throw taskEventIdempotencyError(
        "TASK_EVENT_IDEMPOTENCY_STATE_INVALID",
        "任务事件幂等状态不完整",
        503
      );
    } else {
      const keyClass = codec.classifyKeyId(stored.values.keyId);
      if (
        stored.values.canonicalVersion !== TASK_EVENT_CANONICAL_VERSION
        || stored.values.digestVersion !== "hmac-sha256:v1"
        || !["CURRENT", "PREVIOUS"].includes(keyClass)
      ) {
        throw taskEventIdempotencyError(
          "TASK_EVENT_IDEMPOTENCY_DIGEST_UNVERIFIABLE",
          "任务事件幂等摘要无法验证",
          503
        );
      }
      replayMatches = codec.verify(stored.values, currentDescriptor);
    }
    if (!replayMatches) {
      throw taskEventIdempotencyError(40901, "相同任务事件幂等键对应了不同请求", 409);
    }
    // Successful legacy replay and previous-key replay both rotate the stored
    // digest to the current key without changing the business event identity.
    applyMetadata(event, metadata);
    return event;
  }

  return Object.freeze({
    idempotencyKey,
    metadata,
    operation: TASK_EVENT_IDEMPOTENCY_OPERATION,
    request,
    applyTo(event) {
      applyMetadata(event, metadata);
      return event;
    },
    reconcile,
    scopeMatches,
  });
}

function validateTaskEventIdempotencyCollection(events) {
  const errors = [];
  const warnings = [];
  const scopes = new Set();
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push("task event idempotency row must be an object");
      return;
    }
    const eventId = exactText(event.task_event_id) || "unknown";
    const rootUserId = exactText(event.root_user_id);
    const idempotencyKey = literalText(event.idempotency_key);
    const operation = exactText(event.idempotency_operation) || TASK_EVENT_IDEMPOTENCY_OPERATION;
    if (
      !rootUserId
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)
      || operation !== TASK_EVENT_IDEMPOTENCY_OPERATION
    ) {
      errors.push(`task event idempotency scope invalid: ${eventId}`);
      return;
    }
    const scope = `${rootUserId}\u0000${operation}\u0000${idempotencyKey}`;
    if (scopes.has(scope)) errors.push(`duplicate task event idempotency scope: ${eventId}`);
    scopes.add(scope);

    const stored = storedDigest(event);
    if (stored.present === 0) {
      warnings.push(`legacy task event idempotency digest missing: ${eventId}`);
    } else if (
      stored.present !== 4
      || stored.values.canonicalVersion !== TASK_EVENT_CANONICAL_VERSION
      || stored.values.digestVersion !== "hmac-sha256:v1"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(stored.values.keyId)
      || !/^[a-f0-9]{64}$/.test(stored.values.digest)
    ) {
      errors.push(`task event idempotency digest invalid: ${eventId}`);
    }
    if (
      event.occurred_at_client_supplied !== undefined
      && event.occurred_at_client_supplied !== null
      && typeof event.occurred_at_client_supplied !== "boolean"
    ) {
      errors.push(`task event occurred-at provenance invalid: ${eventId}`);
    }
  });
  return { errors, warnings };
}

module.exports = {
  TASK_EVENT_CANONICAL_VERSION,
  TASK_EVENT_IDEMPOTENCY_OPERATION,
  createTaskEventIdempotencyClaim,
  normalizeTaskEventIdempotencyState,
  validateTaskEventIdempotencyCollection,
};
