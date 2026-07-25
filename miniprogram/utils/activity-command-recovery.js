const { createActivityCommand } = require("./activity-actions");
const { safeOpaqueId } = require("./activity-presenter");

const STORAGE_KEY = "MYROOT_ACTIVITY_PENDING_COMMANDS_V1";

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function payloadDigest(payload) {
  let hash = 0x811c9dc5;
  const value = stableSerialize(payload || {});
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function commandKey(kind, sessionId, payload = {}) {
  const commandKind = upper(kind);
  const safeSessionId = safeOpaqueId(sessionId);
  if (!["ENROLL", "CANCEL"].includes(commandKind) || !safeSessionId) {
    throw new Error("ACTIVITY_PENDING_COMMAND_INVALID");
  }
  return `${commandKind}:${safeSessionId}:${payloadDigest(payload)}`;
}

function validRecord(value) {
  return value
    && ["ENROLL", "CANCEL"].includes(value.kind)
    && safeOpaqueId(value.sessionId)
    && typeof value.payloadDigest === "string"
    && /^[a-f0-9]{8}$/.test(value.payloadDigest)
    && typeof value.idempotencyKey === "string"
    && /^ACTIVITY_INTENT_(ENROLL|CANCEL)_/.test(value.idempotencyKey)
    && Number.isInteger(Number(value.createdAt));
}

function createActivityPendingCommandRegistry(options = {}) {
  const storage = options.storage;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const entropy = typeof options.entropy === "function"
    ? options.entropy
    : () => Math.random().toString(36).slice(2);

  function assertStorage() {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("ACTIVITY_PENDING_COMMAND_STORAGE_REQUIRED");
    }
  }

  function read() {
    assertStorage();
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
      if (error && error.message === "ACTIVITY_PENDING_COMMAND_STORAGE_REQUIRED") throw error;
      throw error;
    }
    if (!raw) return { version: 1, records: {} };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new Error("ACTIVITY_PENDING_COMMAND_STORAGE_CORRUPT"); }
    if (!parsed || parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
      throw new Error("ACTIVITY_PENDING_COMMAND_STORAGE_CORRUPT");
    }
    const records = Object.fromEntries(Object.entries(parsed.records).filter(([key, record]) => key && validRecord(record)));
    if (Object.keys(records).length !== Object.keys(parsed.records).length) {
      throw new Error("ACTIVITY_PENDING_COMMAND_STORAGE_CORRUPT");
    }
    return { version: 1, records };
  }

  function write(document) {
    assertStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(document));
    const verified = read();
    if (stableSerialize(verified) !== stableSerialize(document)) {
      throw new Error("ACTIVITY_PENDING_COMMAND_STORAGE_FAILED");
    }
  }

  function claim(kind, sessionId, payload = {}) {
    const key = commandKey(kind, sessionId, payload);
    const document = read();
    if (validRecord(document.records[key])) {
      document.records[key] = { ...document.records[key], lastClaimedAt: Math.trunc(Number(now())) };
      write(document);
      return Object.freeze({ commandKey: key, ...document.records[key] });
    }
    const createdAt = Math.trunc(Number(now()));
    const command = createActivityCommand(kind, sessionId, createdAt, entropy());
    const record = {
      kind: command.kind,
      sessionId: command.sessionId,
      payloadDigest: payloadDigest(payload),
      idempotencyKey: command.idempotencyKey,
      createdAt,
    };
    document.records[key] = record;
    write(document);
    return Object.freeze({ commandKey: key, ...record });
  }

  function clear(recordOrKey) {
    const key = typeof recordOrKey === "string" ? recordOrKey : recordOrKey && recordOrKey.commandKey;
    if (!key) return false;
    const document = read();
    const existed = Boolean(document.records[key]);
    delete document.records[key];
    write(document);
    return existed;
  }

  function peek(kind, sessionId, payload = {}) {
    const key = commandKey(kind, sessionId, payload);
    const record = read().records[key];
    return validRecord(record) ? Object.freeze({ commandKey: key, ...record }) : null;
  }

  function listForSession(sessionId) {
    const safeSessionId = safeOpaqueId(sessionId);
    if (!safeSessionId) return [];
    return Object.entries(read().records)
      .filter(([, record]) => record.sessionId === safeSessionId)
      .map(([key, record]) => Object.freeze({ commandKey: key, ...record }))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  function list() {
    return Object.entries(read().records)
      .map(([key, record]) => Object.freeze({ commandKey: key, ...record }))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  return Object.freeze({ claim, clear, list, listForSession, peek });
}

module.exports = Object.freeze({
  ACTIVITY_PENDING_COMMAND_STORAGE_KEY: STORAGE_KEY,
  activityCommandPayloadDigest: payloadDigest,
  activityPendingCommandKey: commandKey,
  createActivityPendingCommandRegistry,
});
