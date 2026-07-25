const { payloadSnapshot } = require("./eventTransport");

const OUTBOX_COLUMNS = Object.freeze([
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

const REQUIRED_TEXT_LIMITS = Object.freeze({
  outbox_event_id: 64,
  topic: 128,
  event_type: 128,
  schema_version: 32,
  source_name: 96,
  partition_key: 191,
  aggregate_type: 96,
  aggregate_id: 191,
  producer_version: 64,
  idempotency_key: 191,
  dedupe_key: 191,
  payload_digest: 64,
  status: 32,
});

const NULLABLE_TEXT_LIMITS = Object.freeze({
  correlation_id: 128,
  causation_id: 128,
  lease_owner: 128,
  release_id: 96,
});

const REQUIRED_DATE_FIELDS = Object.freeze([
  "occurred_at",
  "available_at",
  "created_at",
  "updated_at",
]);

const NULLABLE_DATE_FIELDS = Object.freeze([
  "next_retry_at",
  "lease_expires_at",
  "succeeded_at",
  "dead_lettered_at",
]);

const REPLAY_IDENTITY_FIELDS = Object.freeze([
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

const MYSQL_TIMEZONE_OFFSET_MINUTES = 8 * 60;

const INSERT_SQL = `INSERT INTO \`outbox_event\` (${OUTBOX_COLUMNS.map((column) => `\`${column}\``).join(", ")}) VALUES (${OUTBOX_COLUMNS.map(() => "?").join(", ")})`;

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidEnvelope() {
  return adapterError("OUTBOX_ENVELOPE_INVALID", "outbox event envelope is invalid");
}

function requiredText(value, maximumLength) {
  if (typeof value !== "string") throw invalidEnvelope();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw invalidEnvelope();
  return normalized;
}

function nullableText(value, maximumLength) {
  if (value === null) return null;
  if (value === undefined || value === "") throw invalidEnvelope();
  return requiredText(value, maximumLength);
}

function unsignedInteger(value, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) throw invalidEnvelope();
  return number;
}

function validWallClock(dateText, timeText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour, minute, second] = timeText.split(":").map(Number);
  if (year < 1000 || year > 9999) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day &&
    candidate.getUTCHours() === hour &&
    candidate.getUTCMinutes() === minute &&
    candidate.getUTCSeconds() === second;
}

function mysqlDateTime(value, nullable = false) {
  if (nullable && value === null) return null;
  if (nullable && (value === undefined || value === "")) throw invalidEnvelope();
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw invalidEnvelope();
    return new Date(value.getTime() + MYSQL_TIMEZONE_OFFSET_MINUTES * 60_000)
      .toISOString()
      .slice(0, 23)
      .replace("T", " ");
  }
  if (typeof value !== "string") throw invalidEnvelope();
  const normalized = value.trim();
  const mysqlMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/);
  if (mysqlMatch) {
    if (!validWallClock(mysqlMatch[1], mysqlMatch[2])) throw invalidEnvelope();
    return `${mysqlMatch[1]} ${mysqlMatch[2]}.${String(mysqlMatch[3] || "0").padEnd(3, "0")}`;
  }
  const isoMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!isoMatch) throw invalidEnvelope();
  const instant = new Date(normalized);
  if (!Number.isFinite(instant.getTime()) || !validWallClock(isoMatch[1], isoMatch[2])) throw invalidEnvelope();
  return new Date(instant.getTime() + MYSQL_TIMEZONE_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

function jsonSnapshot(value) {
  if (typeof payloadSnapshot !== "function") {
    throw adapterError("OUTBOX_ADAPTER_CONFIGURATION_INVALID", "outbox adapter configuration is invalid");
  }
  try {
    return payloadSnapshot(value);
  } catch {
    throw invalidEnvelope();
  }
}

function jsonValue(value, nullable = false) {
  if (nullable && value === null) return null;
  if (nullable && value === undefined) throw invalidEnvelope();
  return jsonSnapshot(value).payload;
}

function normalizeEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidEnvelope();
  const keys = Object.keys(input);
  if (
    keys.length !== OUTBOX_COLUMNS.length ||
    OUTBOX_COLUMNS.some((column) => !Object.prototype.hasOwnProperty.call(input, column))
  ) {
    throw invalidEnvelope();
  }
  const envelope = {};
  for (const [field, limit] of Object.entries(REQUIRED_TEXT_LIMITS)) {
    envelope[field] = requiredText(input[field], limit);
  }
  for (const [field, limit] of Object.entries(NULLABLE_TEXT_LIMITS)) {
    envelope[field] = nullableText(input[field], limit);
  }
  envelope.partition_position = unsignedInteger(input.partition_position, { positive: true });
  envelope.aggregate_version = unsignedInteger(input.aggregate_version, { positive: true });
  envelope.attempt_count = unsignedInteger(input.attempt_count);
  envelope.max_attempts = unsignedInteger(input.max_attempts, { positive: true });
  if (envelope.status !== "PENDING" || envelope.attempt_count !== 0) throw invalidEnvelope();

  for (const field of REQUIRED_DATE_FIELDS) envelope[field] = mysqlDateTime(input[field]);
  for (const field of NULLABLE_DATE_FIELDS) envelope[field] = mysqlDateTime(input[field], true);
  envelope.last_error_json = jsonValue(input.last_error_json, true);
  envelope.payload_json = jsonValue(input.payload_json);
  const computedDigest = jsonSnapshot(envelope.payload_json).digest;
  if (!/^[a-f0-9]{64}$/.test(envelope.payload_digest) || envelope.payload_digest !== computedDigest) {
    throw invalidEnvelope();
  }

  if (
    envelope.next_retry_at !== null ||
    envelope.lease_owner !== null ||
    envelope.lease_expires_at !== null ||
    envelope.last_error_json !== null ||
    envelope.succeeded_at !== null ||
    envelope.dead_lettered_at !== null
  ) {
    throw invalidEnvelope();
  }

  return Object.freeze({ ...envelope });
}

function parseJsonColumn(value) {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function immutableSnapshot(input) {
  try {
    const snapshot = {};
    for (const field of REPLAY_IDENTITY_FIELDS) {
      if (field === "payload_json") {
        snapshot[field] = jsonSnapshot(parseJsonColumn(input[field])).digest;
      } else if (REQUIRED_DATE_FIELDS.includes(field)) {
        snapshot[field] = mysqlDateTime(input[field]);
      } else if (NULLABLE_TEXT_LIMITS[field]) {
        snapshot[field] = nullableText(input[field], NULLABLE_TEXT_LIMITS[field]);
      } else if (["partition_position", "aggregate_version", "max_attempts"].includes(field)) {
        snapshot[field] = unsignedInteger(input[field], { positive: true });
      } else if (REQUIRED_TEXT_LIMITS[field]) {
        snapshot[field] = requiredText(input[field], REQUIRED_TEXT_LIMITS[field]);
      } else {
        snapshot[field] = input[field];
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotOutboxImmutableIdentity(input) {
  const snapshot = immutableSnapshot(input);
  if (!snapshot) {
    throw adapterError("OUTBOX_IMMUTABLE_IDENTITY_INVALID", "outbox immutable identity is invalid");
  }
  return Object.freeze({ ...snapshot });
}

function exactImmutableReplay(existing, staged) {
  const existingSnapshot = immutableSnapshot(existing);
  const stagedSnapshot = immutableSnapshot(staged);
  if (!existingSnapshot || !stagedSnapshot) return false;
  return JSON.stringify(existingSnapshot) === JSON.stringify(stagedSnapshot);
}

function insertValues(envelope) {
  return OUTBOX_COLUMNS.map((column) => {
    if (column === "payload_json" || column === "last_error_json") {
      return envelope[column] === null ? null : JSON.stringify(envelope[column]);
    }
    return envelope[column];
  });
}

function isDuplicateError(error) {
  return Boolean(error && (error.code === "ER_DUP_ENTRY" || Number(error.errno) === 1062));
}

function rowsFrom(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}

function createMysqlEventTransportAdapter(connection) {
  if (!connection || typeof connection.execute !== "function") {
    throw adapterError("OUTBOX_ADAPTER_CONFIGURATION_INVALID", "outbox adapter configuration is invalid");
  }
  const execute = connection.execute.bind(connection);
  const staged = [];
  let state = "ACTIVE";
  let flushSummary = null;

  function assertActive() {
    if (state !== "ACTIVE") {
      throw adapterError("OUTBOX_TRANSACTION_INACTIVE", "outbox transaction is inactive");
    }
  }

  function stageOutbox(input) {
    assertActive();
    const envelope = normalizeEnvelope(input);
    staged.push(envelope);
    return { staged: true, outboxEventId: envelope.outbox_event_id };
  }

  function assertNoStagedFacts() {
    assertActive();
    if (staged.length > 0) {
      throw adapterError(
        "OUTBOX_STAGED_FACTS_PRESENT",
        "outbox transaction contains staged facts"
      );
    }
    return true;
  }

  async function resolveDuplicate(envelope) {
    let result;
    try {
      result = await execute(
        "SELECT * FROM `outbox_event` WHERE `topic` = ? AND `dedupe_key` = ? LIMIT 1 FOR UPDATE",
        [envelope.topic, envelope.dedupe_key]
      );
    } catch {
      throw adapterError("OUTBOX_PERSISTENCE_FAILED", "outbox event persistence failed");
    }
    const dedupeRow = rowsFrom(result)[0];
    if (dedupeRow) {
      if (exactImmutableReplay(dedupeRow, envelope)) return "REPLAY";
      throw adapterError("OUTBOX_DEDUPE_CONFLICT", "outbox event conflicts with an existing dedupe key");
    }

    try {
      result = await execute(
        "SELECT * FROM `outbox_event` WHERE `source_name` = ? AND `partition_key` = ? AND `partition_position` = ? LIMIT 1 FOR UPDATE",
        [envelope.source_name, envelope.partition_key, envelope.partition_position]
      );
    } catch {
      throw adapterError("OUTBOX_PERSISTENCE_FAILED", "outbox event persistence failed");
    }
    if (rowsFrom(result)[0]) {
      throw adapterError("OUTBOX_POSITION_CONFLICT", "outbox event conflicts with an existing partition position");
    }
    throw adapterError("OUTBOX_WRITE_CONFLICT", "outbox event conflicts with an existing record");
  }

  async function flushImplementation() {
    const summary = { inserted: 0, replayed: 0 };
    for (const envelope of staged) {
      try {
        await execute(INSERT_SQL, insertValues(envelope));
        summary.inserted += 1;
      } catch (error) {
        if (!isDuplicateError(error)) {
          throw adapterError("OUTBOX_PERSISTENCE_FAILED", "outbox event persistence failed");
        }
        const resolution = await resolveDuplicate(envelope);
        if (resolution === "REPLAY") summary.replayed += 1;
      }
    }
    staged.length = 0;
    flushSummary = Object.freeze(summary);
    state = "FLUSHED";
    return { ...flushSummary };
  }

  async function flushBeforeCommit() {
    if (state === "FLUSHED") return Promise.resolve({ ...flushSummary });
    assertActive();
    state = "FLUSHING";
    return flushImplementation().catch((error) => {
      state = "FAILED";
      throw error;
    });
  }

  function afterCommit() {
    if (state !== "FLUSHED") {
      throw adapterError("OUTBOX_TRANSACTION_INACTIVE", "outbox transaction is inactive");
    }
    staged.length = 0;
    state = "COMMITTED";
  }

  function discard() {
    staged.length = 0;
    flushSummary = null;
    state = "DISCARDED";
  }

  const adapter = {
    stageOutbox,
    flushBeforeCommit,
    afterCommit,
    discard,
  };
  Object.defineProperty(adapter, "assertNoStagedFacts", {
    value: assertNoStagedFacts,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(adapter);
}

module.exports = {
  createMysqlEventTransportAdapter,
  snapshotOutboxImmutableIdentity,
};
