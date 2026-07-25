const crypto = require("node:crypto");

const OUTBOX_STATUSES = Object.freeze({
  PENDING: "PENDING",
  CLAIMED: "CLAIMED",
  RETRY_PENDING: "RETRY_PENDING",
  SUCCEEDED: "SUCCEEDED",
  DEAD_LETTER: "DEAD_LETTER",
});

const INBOX_STATUSES = Object.freeze({
  PROCESSING: "PROCESSING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
});

const COMPLETE_OUTBOX_ENVELOPE_FIELDS = Object.freeze([
  "outbox_event_id",
  "topic",
  "event_type",
  "schema_version",
  "source_name",
  "partition_key",
  "partition_position",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "occurred_at",
  "producer_version",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "dedupe_key",
  "payload_json",
  "payload_digest",
  "status",
  "attempt_count",
  "max_attempts",
  "available_at",
  "next_retry_at",
  "lease_owner",
  "lease_expires_at",
  "last_error_json",
  "release_id",
  "succeeded_at",
  "dead_lettered_at",
  "created_at",
  "updated_at",
]);

const OUTBOX_REPLAY_IDENTITY_FIELDS = Object.freeze([
  "outbox_event_id",
  "topic",
  "event_type",
  "schema_version",
  "source_name",
  "partition_key",
  "partition_position",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "occurred_at",
  "idempotency_key",
  "dedupe_key",
  "payload_json",
  "payload_digest",
  "max_attempts",
  "available_at",
  "created_at",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || "").trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (normalized) return normalized;
  const error = new Error(`${field} is required`);
  error.code = "EVENT_TRANSPORT_INPUT_INVALID";
  throw error;
}

function positiveInteger(value, field, fallback) {
  const candidate = value === undefined ? fallback : Number(value);
  if (Number.isInteger(candidate) && candidate > 0) return candidate;
  const error = new Error(`${field} must be a positive integer`);
  error.code = "EVENT_TRANSPORT_INPUT_INVALID";
  throw error;
}

function nonNegativeInteger(value, field, fallback = 0) {
  const candidate = value === undefined ? fallback : Number(value);
  if (Number.isInteger(candidate) && candidate >= 0) return candidate;
  const error = new Error(`${field} must be a non-negative integer`);
  error.code = "EVENT_TRANSPORT_INPUT_INVALID";
  throw error;
}

function instant(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const error = new Error("now must be a valid date-time");
    error.code = "EVENT_TRANSPORT_INPUT_INVALID";
    throw error;
  }
  return date;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadSnapshot(payload) {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw new TypeError("payload is not JSON serializable");
    const normalized = JSON.parse(serialized);
    const canonical = stableJson(normalized);
    return {
      payload: normalized,
      digest: crypto.createHash("sha256").update(canonical).digest("hex"),
    };
  } catch (cause) {
    const error = new Error("payload must be JSON serializable");
    error.code = "EVENT_TRANSPORT_PAYLOAD_INVALID";
    error.cause = cause;
    throw error;
  }
}

function ensureArray(data, key) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("event transport state must be an object");
    error.code = "EVENT_TRANSPORT_STATE_INVALID";
    throw error;
  }
  if (data[key] === undefined) data[key] = [];
  if (!Array.isArray(data[key])) {
    const error = new Error(`${key} must be an array`);
    error.code = "EVENT_TRANSPORT_STATE_INVALID";
    throw error;
  }
  return data[key];
}

function ensureEventTransportState(data) {
  return {
    outbox: ensureArray(data, "eventOutbox"),
    inbox: ensureArray(data, "eventInbox"),
    checkpoints: ensureArray(data, "eventConsumerCheckpoints"),
  };
}

function transportError(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  return error;
}

function nextOutboxSequence(outbox) {
  return outbox.reduce((maximum, event) => Math.max(maximum, Number(event.sequence || 0)), 0) + 1;
}

function assertLegacyOutboxModel(outbox) {
  if (outbox.some((event) => Object.prototype.hasOwnProperty.call(event, "partition_position") ||
    Object.prototype.hasOwnProperty.call(event, "attempt_count"))) {
    throw transportError(
      "OUTBOX_MODEL_MISMATCH",
      "legacy outbox operations cannot consume complete relational envelopes"
    );
  }
}

function assertCompleteOutboxModel(outbox) {
  if (outbox.some((event) => Object.prototype.hasOwnProperty.call(event, "sequence") ||
    Object.prototype.hasOwnProperty.call(event, "attempts"))) {
    throw transportError(
      "OUTBOX_MODEL_MISMATCH",
      "complete relational envelopes cannot share the legacy outbox state"
    );
  }
}

function defaultId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function enqueueOutboxEvent(data, command = {}, options = {}) {
  const { outbox } = ensureEventTransportState(data);
  assertLegacyOutboxModel(outbox);
  const topic = requiredText(command.topic, "topic");
  const dedupeKey = requiredText(command.dedupeKey, "dedupeKey");
  const aggregateKey = text(command.aggregateKey);
  const snapshot = payloadSnapshot(command.payload);
  const existing = outbox.find((event) => event.topic === topic && event.dedupe_key === dedupeKey);

  if (existing) {
    if (existing.payload_digest !== snapshot.digest || text(existing.aggregate_key) !== aggregateKey) {
      throw transportError("OUTBOX_DEDUPE_CONFLICT", "outbox dedupe key already has different event content", {
        topic,
        dedupeKey,
        eventId: existing.outbox_event_id,
      });
    }
    return { created: false, event: clone(existing) };
  }

  const now = instant(options.now);
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => defaultId("outbox");
  const eventId = requiredText(idFactory(), "outboxEventId");
  if (outbox.some((event) => event.outbox_event_id === eventId)) {
    throw transportError("OUTBOX_EVENT_ID_CONFLICT", "outbox event id already exists", { eventId });
  }

  const event = {
    outbox_event_id: eventId,
    sequence: nextOutboxSequence(outbox),
    topic,
    aggregate_key: aggregateKey,
    dedupe_key: dedupeKey,
    payload_json: snapshot.payload,
    payload_digest: snapshot.digest,
    status: OUTBOX_STATUSES.PENDING,
    attempts: 0,
    max_attempts: positiveInteger(command.maxAttempts, "maxAttempts", 5),
    available_at: now.toISOString(),
    lease_owner: "",
    lease_expires_at: "",
    last_error: "",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    succeeded_at: "",
    dead_lettered_at: "",
  };
  outbox.push(event);
  return { created: true, event: clone(event) };
}

function completeEnvelopeSnapshot(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw transportError("OUTBOX_ENVELOPE_INVALID", "outbox event envelope is invalid");
  }
  const keys = Object.keys(envelope);
  if (
    keys.length !== COMPLETE_OUTBOX_ENVELOPE_FIELDS.length ||
    COMPLETE_OUTBOX_ENVELOPE_FIELDS.some((field) =>
      !Object.prototype.hasOwnProperty.call(envelope, field) || envelope[field] === undefined
    )
  ) {
    throw transportError("OUTBOX_ENVELOPE_INVALID", "outbox event envelope is invalid");
  }
  const snapshot = payloadSnapshot(envelope).payload;
  const payload = payloadSnapshot(snapshot.payload_json);
  const hasText = (value, maximumLength) =>
    typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
  const hasNullableText = (value, maximumLength) => value === null || hasText(value, maximumLength);
  const isPositiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (
    !hasText(snapshot.outbox_event_id, 64) ||
    !hasText(snapshot.topic, 128) ||
    !hasText(snapshot.event_type, 128) ||
    !hasText(snapshot.schema_version, 32) ||
    !hasText(snapshot.source_name, 96) ||
    !hasText(snapshot.partition_key, 191) ||
    !isPositiveInteger(snapshot.partition_position) ||
    !hasText(snapshot.aggregate_type, 96) ||
    !hasText(snapshot.aggregate_id, 191) ||
    !isPositiveInteger(snapshot.aggregate_version) ||
    !hasText(snapshot.occurred_at, 40) ||
    !hasText(snapshot.producer_version, 64) ||
    !hasNullableText(snapshot.correlation_id, 128) ||
    !hasNullableText(snapshot.causation_id, 128) ||
    !hasText(snapshot.idempotency_key, 191) ||
    !hasText(snapshot.dedupe_key, 191) ||
    !/^[a-f0-9]{64}$/.test(snapshot.payload_digest) ||
    snapshot.payload_digest !== payload.digest ||
    snapshot.status !== OUTBOX_STATUSES.PENDING ||
    Number(snapshot.attempt_count) !== 0 ||
    !isPositiveInteger(snapshot.max_attempts) ||
    !hasText(snapshot.available_at, 40) ||
    snapshot.next_retry_at !== null ||
    snapshot.lease_owner !== null ||
    snapshot.lease_expires_at !== null ||
    snapshot.last_error_json !== null ||
    !hasNullableText(snapshot.release_id, 96) ||
    snapshot.succeeded_at !== null ||
    snapshot.dead_lettered_at !== null ||
    !hasText(snapshot.created_at, 40) ||
    !hasText(snapshot.updated_at, 40)
  ) {
    throw transportError("OUTBOX_ENVELOPE_INVALID", "outbox event envelope is invalid");
  }
  return snapshot;
}

function immutableEnvelopeDigest(envelope) {
  const immutable = {};
  for (const field of OUTBOX_REPLAY_IDENTITY_FIELDS) immutable[field] = envelope[field];
  return payloadSnapshot(immutable).digest;
}

function stageOutboxEnvelope(data, envelope) {
  const outbox = ensureArray(data, "eventOutbox");
  assertCompleteOutboxModel(outbox);
  const snapshot = completeEnvelopeSnapshot(envelope);
  const existing = outbox.find((event) =>
    event.topic === snapshot.topic && event.dedupe_key === snapshot.dedupe_key
  );
  if (existing) {
    if (immutableEnvelopeDigest(existing) !== immutableEnvelopeDigest(snapshot)) {
      throw transportError("OUTBOX_DEDUPE_CONFLICT", "outbox event conflicts with an existing dedupe key");
    }
    return { created: false, event: clone(existing) };
  }
  if (outbox.some((event) => event.outbox_event_id === snapshot.outbox_event_id)) {
    throw transportError("OUTBOX_EVENT_ID_CONFLICT", "outbox event id already exists");
  }
  if (outbox.some((event) =>
    event.source_name === snapshot.source_name &&
    event.partition_key === snapshot.partition_key &&
    Number(event.partition_position) === Number(snapshot.partition_position)
  )) {
    throw transportError("OUTBOX_POSITION_CONFLICT", "outbox event conflicts with an existing partition position");
  }
  outbox.push(snapshot);
  return { created: true, event: clone(snapshot) };
}

function clearLease(event) {
  event.lease_owner = "";
  event.lease_expires_at = "";
}

const SAFE_PERSISTED_ERROR_MESSAGES = new Set([
  "event processing failed",
  "lease expired after max attempts",
  "max attempts reached before claim",
]);

function persistedErrorText(value) {
  const message = text(value && value.message ? value.message : value);
  return SAFE_PERSISTED_ERROR_MESSAGES.has(message)
    ? message
    : "event processing failed";
}

function markOutboxDeadLetter(event, now, reason) {
  event.status = OUTBOX_STATUSES.DEAD_LETTER;
  event.last_error = persistedErrorText(reason);
  event.dead_lettered_at = now.toISOString();
  event.updated_at = now.toISOString();
  clearLease(event);
}

function leaseExpired(event, now) {
  if (!event.lease_expires_at) return true;
  return instant(event.lease_expires_at).getTime() <= now.getTime();
}

function claimOutboxEvents(data, command = {}, options = {}) {
  const { outbox } = ensureEventTransportState(data);
  assertLegacyOutboxModel(outbox);
  const workerId = requiredText(command.workerId, "workerId");
  const limit = positiveInteger(command.limit, "limit", 10);
  const leaseMs = positiveInteger(command.leaseMs, "leaseMs", 30_000);
  const now = instant(options.now);
  const topics = Array.isArray(command.topics)
    ? new Set(command.topics.map((topic) => requiredText(topic, "topic")))
    : null;
  const claimed = [];

  const candidates = outbox.slice().sort((left, right) => Number(left.sequence) - Number(right.sequence));
  for (const event of candidates) {
    if (claimed.length >= limit) break;
    if (topics && !topics.has(event.topic)) continue;
    if ([OUTBOX_STATUSES.SUCCEEDED, OUTBOX_STATUSES.DEAD_LETTER].includes(event.status)) continue;

    if (event.status === OUTBOX_STATUSES.CLAIMED && !leaseExpired(event, now)) continue;
    if (event.status !== OUTBOX_STATUSES.CLAIMED && instant(event.available_at).getTime() > now.getTime()) continue;

    if (Number(event.attempts) >= Number(event.max_attempts)) {
      markOutboxDeadLetter(event, now, event.status === OUTBOX_STATUSES.CLAIMED
        ? "lease expired after max attempts"
        : "max attempts reached before claim");
      continue;
    }

    event.status = OUTBOX_STATUSES.CLAIMED;
    event.attempts = Number(event.attempts || 0) + 1;
    event.lease_owner = workerId;
    event.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
    event.updated_at = now.toISOString();
    claimed.push(clone(event));
  }

  return claimed;
}

function findOutboxEvent(data, eventId) {
  const { outbox } = ensureEventTransportState(data);
  assertLegacyOutboxModel(outbox);
  const normalizedId = requiredText(eventId, "eventId");
  const event = outbox.find((candidate) => candidate.outbox_event_id === normalizedId);
  if (!event) throw transportError("OUTBOX_EVENT_NOT_FOUND", "outbox event not found", { eventId: normalizedId });
  return event;
}

function assertOutboxLease(event, workerId, now) {
  const normalizedWorker = requiredText(workerId, "workerId");
  if (event.status !== OUTBOX_STATUSES.CLAIMED || event.lease_owner !== normalizedWorker || leaseExpired(event, now)) {
    throw transportError("OUTBOX_LEASE_LOST", "outbox event lease is not owned by this worker", {
      eventId: event.outbox_event_id,
      workerId: normalizedWorker,
      leaseOwner: event.lease_owner,
      status: event.status,
    });
  }
}

function completeOutboxEvent(data, command = {}, options = {}) {
  const event = findOutboxEvent(data, command.eventId);
  if (event.status === OUTBOX_STATUSES.SUCCEEDED) return clone(event);
  const now = instant(options.now);
  assertOutboxLease(event, command.workerId, now);
  event.status = OUTBOX_STATUSES.SUCCEEDED;
  event.succeeded_at = now.toISOString();
  event.updated_at = now.toISOString();
  event.last_error = "";
  clearLease(event);
  return clone(event);
}

function failOutboxEvent(data, command = {}, options = {}) {
  const event = findOutboxEvent(data, command.eventId);
  const now = instant(options.now);
  assertOutboxLease(event, command.workerId, now);
  const retryable = command.retryable !== false;
  const reason = persistedErrorText(command.error);
  const retryDelayMs = nonNegativeInteger(command.retryDelayMs, "retryDelayMs", 0);

  if (retryable && Number(event.attempts) < Number(event.max_attempts)) {
    event.status = OUTBOX_STATUSES.RETRY_PENDING;
    event.available_at = new Date(now.getTime() + retryDelayMs).toISOString();
    event.updated_at = now.toISOString();
    event.last_error = reason;
    clearLease(event);
  } else {
    markOutboxDeadLetter(event, now, reason);
  }
  return clone(event);
}

function checkpointRecord(checkpoints, consumer, stream, now, create = true) {
  let record = checkpoints.find((candidate) => candidate.consumer === consumer && candidate.stream === stream);
  if (!record && create) {
    record = {
      consumer,
      stream,
      checkpoint: 0,
      watermark: 0,
      updated_at: now.toISOString(),
    };
    checkpoints.push(record);
  }
  return record;
}

function receiveInboxEvent(data, command = {}, options = {}) {
  const { inbox, checkpoints } = ensureEventTransportState(data);
  const consumer = requiredText(command.consumer, "consumer");
  const stream = requiredText(command.stream, "stream");
  const eventId = requiredText(command.eventId, "eventId");
  const topic = requiredText(command.topic, "topic");
  const sequence = positiveInteger(command.sequence, "sequence");
  const snapshot = payloadSnapshot(command.payload);
  const existing = inbox.find((receipt) => receipt.consumer === consumer && receipt.event_id === eventId);

  if (existing) {
    if (existing.payload_digest !== snapshot.digest) {
      throw transportError("INBOX_PAYLOAD_CONFLICT", "inbox event id already has a different payload digest", {
        consumer,
        eventId,
      });
    }
    if (existing.stream !== stream || existing.topic !== topic || Number(existing.sequence) !== sequence) {
      throw transportError("INBOX_EVENT_CONFLICT", "inbox event id already has different envelope metadata", {
        consumer,
        eventId,
      });
    }
    return { created: false, receipt: clone(existing) };
  }

  const sequenceOwner = inbox.find((receipt) =>
    receipt.consumer === consumer && receipt.stream === stream && Number(receipt.sequence) === sequence
  );
  if (sequenceOwner) {
    throw transportError("INBOX_SEQUENCE_CONFLICT", "consumer stream sequence already belongs to another event", {
      consumer,
      stream,
      sequence,
      eventId: sequenceOwner.event_id,
    });
  }

  const now = instant(options.now);
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => defaultId("inbox");
  const receiptId = requiredText(idFactory(), "receiptId");
  if (inbox.some((receipt) => receipt.inbox_receipt_id === receiptId)) {
    throw transportError("INBOX_RECEIPT_ID_CONFLICT", "inbox receipt id already exists", { receiptId });
  }

  const receipt = {
    inbox_receipt_id: receiptId,
    consumer,
    stream,
    event_id: eventId,
    sequence,
    topic,
    payload_json: snapshot.payload,
    payload_digest: snapshot.digest,
    status: INBOX_STATUSES.PROCESSING,
    attempts: 1,
    last_error: "",
    received_at: now.toISOString(),
    updated_at: now.toISOString(),
    succeeded_at: "",
    failed_at: "",
  };
  inbox.push(receipt);
  const checkpoint = checkpointRecord(checkpoints, consumer, stream, now);
  checkpoint.watermark = Math.max(Number(checkpoint.watermark || 0), sequence);
  checkpoint.updated_at = now.toISOString();
  return { created: true, receipt: clone(receipt) };
}

function findInboxReceipt(data, receiptId) {
  const { inbox } = ensureEventTransportState(data);
  const normalizedId = requiredText(receiptId, "receiptId");
  const receipt = inbox.find((candidate) => candidate.inbox_receipt_id === normalizedId);
  if (!receipt) throw transportError("INBOX_RECEIPT_NOT_FOUND", "inbox receipt not found", { receiptId: normalizedId });
  return receipt;
}

function advanceCheckpoint(data, receipt, now) {
  const { inbox, checkpoints } = ensureEventTransportState(data);
  const checkpoint = checkpointRecord(checkpoints, receipt.consumer, receipt.stream, now);
  let next = Number(checkpoint.checkpoint || 0) + 1;
  while (inbox.some((candidate) =>
    candidate.consumer === receipt.consumer &&
    candidate.stream === receipt.stream &&
    Number(candidate.sequence) === next &&
    candidate.status === INBOX_STATUSES.SUCCEEDED
  )) {
    checkpoint.checkpoint = next;
    next += 1;
  }
  checkpoint.updated_at = now.toISOString();
  return checkpoint;
}

function completeInboxEvent(data, command = {}, options = {}) {
  const receipt = findInboxReceipt(data, command.receiptId);
  const now = instant(options.now);
  if (receipt.status === INBOX_STATUSES.SUCCEEDED) {
    advanceCheckpoint(data, receipt, now);
    return clone(receipt);
  }
  if (receipt.status !== INBOX_STATUSES.PROCESSING) {
    throw transportError("INBOX_STATE_CONFLICT", "only a processing inbox receipt can succeed", {
      receiptId: receipt.inbox_receipt_id,
      status: receipt.status,
    });
  }
  receipt.status = INBOX_STATUSES.SUCCEEDED;
  receipt.succeeded_at = now.toISOString();
  receipt.updated_at = now.toISOString();
  receipt.last_error = "";
  advanceCheckpoint(data, receipt, now);
  return clone(receipt);
}

function failInboxEvent(data, command = {}, options = {}) {
  const receipt = findInboxReceipt(data, command.receiptId);
  if (receipt.status === INBOX_STATUSES.FAILED) return clone(receipt);
  if (receipt.status !== INBOX_STATUSES.PROCESSING) {
    throw transportError("INBOX_STATE_CONFLICT", "only a processing inbox receipt can fail", {
      receiptId: receipt.inbox_receipt_id,
      status: receipt.status,
    });
  }
  const now = instant(options.now);
  receipt.status = INBOX_STATUSES.FAILED;
  receipt.last_error = persistedErrorText(command.error);
  receipt.failed_at = now.toISOString();
  receipt.updated_at = now.toISOString();
  return clone(receipt);
}

function retryInboxEvent(data, command = {}, options = {}) {
  const receipt = findInboxReceipt(data, command.receiptId);
  if (receipt.status !== INBOX_STATUSES.FAILED) {
    throw transportError("INBOX_STATE_CONFLICT", "only a failed inbox receipt can be retried", {
      receiptId: receipt.inbox_receipt_id,
      status: receipt.status,
    });
  }
  const now = instant(options.now);
  receipt.status = INBOX_STATUSES.PROCESSING;
  receipt.attempts = Number(receipt.attempts || 0) + 1;
  receipt.last_error = "";
  receipt.failed_at = "";
  receipt.updated_at = now.toISOString();
  return clone(receipt);
}

function getConsumerCheckpoint(data, query = {}) {
  const { checkpoints } = ensureEventTransportState(data);
  const consumer = requiredText(query.consumer, "consumer");
  const stream = requiredText(query.stream, "stream");
  const record = checkpointRecord(checkpoints, consumer, stream, new Date(0), false);
  if (!record) {
    return { consumer, stream, checkpoint: 0, watermark: 0, updated_at: "" };
  }
  return clone({
    consumer: record.consumer,
    stream: record.stream,
    checkpoint: Number(record.checkpoint || 0),
    watermark: Number(record.watermark || 0),
    updated_at: record.updated_at || "",
  });
}

module.exports = {
  INBOX_STATUSES,
  OUTBOX_STATUSES,
  claimOutboxEvents,
  completeInboxEvent,
  completeOutboxEvent,
  enqueueOutboxEvent,
  ensureEventTransportState,
  failInboxEvent,
  failOutboxEvent,
  getConsumerCheckpoint,
  payloadSnapshot,
  receiveInboxEvent,
  retryInboxEvent,
  stageOutboxEnvelope,
};
