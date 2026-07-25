const DEFAULT_STORAGE_KEY = "ROOT_ADMIN_ACTIVITY_PENDING_COMMANDS_V3";
const DOCUMENT_VERSION = 3;

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function emptyDocument() {
  return { version: DOCUMENT_VERSION, revision: 0, records: {}, tombstones: {} };
}

function isPending(value) {
  return value
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.length > 0
    && Number.isInteger(Number(value.createdAt))
    && Number.isInteger(Number(value.revision));
}

function normalizeDocument(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.version !== DOCUMENT_VERSION) return emptyDocument();
  return {
    version: DOCUMENT_VERSION,
    revision: Number.isInteger(Number(source.revision)) ? Number(source.revision) : 0,
    records: Object.fromEntries(Object.entries(source.records || {}).filter(([key, record]) => key && isPending(record))),
    tombstones: Object.fromEntries(Object.entries(source.tombstones || {}).filter(([key, tombstone]) => (
      key && Number.isInteger(Number(tombstone && tombstone.revision))
    ))),
  };
}

export function activityCommandKey(operation, payload = {}) {
  const normalizedOperation = String(operation || "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 80);
  if (!normalizedOperation) throw new Error("ACTIVITY_COMMAND_OPERATION_REQUIRED");
  const serialized = stableSerialize(payload);
  return `${normalizedOperation}:${serialized.length}:${fnv1a64(serialized)}`;
}

export function createPendingActivityCommandRegistry(options = {}) {
  const storage = options.storage;
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const lockManager = Object.prototype.hasOwnProperty.call(options, "lockManager")
    ? options.lockManager
    : (globalThis.navigator && globalThis.navigator.locks);
  const createIdempotencyKey = typeof options.createIdempotencyKey === "function"
    ? options.createIdempotencyKey
    : (operation) => {
      const entropy = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${now()}-${Math.random().toString(36).slice(2, 14)}`;
      return `activity-intent-${operation}-${entropy}`;
    };
  const listeners = new Set();
  const channel = Object.prototype.hasOwnProperty.call(options, "channel")
    ? options.channel
    : ((typeof options.createChannel === "function" ? options.createChannel(`${storageKey}:events`) : null)
      || (typeof globalThis.BroadcastChannel === "function" ? new globalThis.BroadcastChannel(`${storageKey}:events`) : null));

  function assertStorage() {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("ACTIVITY_COMMAND_PERSISTENT_STORAGE_REQUIRED");
    }
  }

  function readDocument() {
    assertStorage();
    let raw;
    try {
      raw = storage.getItem(storageKey);
    } catch (error) {
      if (error && error.message === "ACTIVITY_COMMAND_PERSISTENT_STORAGE_REQUIRED") throw error;
      throw error;
    }
    if (!raw) return emptyDocument();
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new Error("ACTIVITY_COMMAND_STORAGE_CORRUPT"); }
    if (!parsed || parsed.version !== DOCUMENT_VERSION) throw new Error("ACTIVITY_COMMAND_STORAGE_CORRUPT");
    return normalizeDocument(parsed);
  }

  function persist(document) {
    assertStorage();
    storage.setItem(storageKey, JSON.stringify(document));
    const verified = readDocument();
    if (verified.revision !== document.revision) {
      throw new Error("ACTIVITY_COMMAND_STORAGE_WRITE_CONFLICT");
    }
  }

  function publish(event) {
    if (channel && typeof channel.postMessage === "function") channel.postMessage(event);
    listeners.forEach((listener) => listener(event));
  }

  async function withLock(callback) {
    if (!lockManager || typeof lockManager.request !== "function") {
      throw new Error("ACTIVITY_COMMAND_CROSS_TAB_LOCK_REQUIRED");
    }
    return lockManager.request(`${storageKey}:write`, { mode: "exclusive" }, callback);
  }

  async function claim(commandKey, metadata = {}) {
    if (!commandKey) throw new Error("ACTIVITY_COMMAND_KEY_REQUIRED");
    return withLock(async () => {
      const document = readDocument();
      if (isPending(document.records[commandKey])) {
        const revision = document.revision + 1;
        document.revision = revision;
        document.records[commandKey] = { ...document.records[commandKey], lastClaimedAt: now(), revision };
        persist(document);
        publish({ type: "claim", commandKey, revision });
        return Object.freeze({ commandKey, ...document.records[commandKey] });
      }

      const operation = String(metadata.operation || commandKey.split(":", 1)[0] || "write");
      const revision = document.revision + 1;
      const record = {
        idempotencyKey: createIdempotencyKey(operation),
        createdAt: now(),
        revision,
        operation,
        payload: metadata.payload && typeof metadata.payload === "object" ? metadata.payload : {},
      };
      document.revision = revision;
      document.records[commandKey] = record;
      delete document.tombstones[commandKey];
      persist(document);
      publish({ type: "claim", commandKey, revision });
      return Object.freeze({ commandKey, ...record });
    });
  }

  async function clear(commandKey, reason = "authority-confirmed") {
    if (!commandKey) return false;
    return withLock(async () => {
      const document = readDocument();
      const revision = document.revision + 1;
      const existed = Boolean(document.records[commandKey]);
      delete document.records[commandKey];
      document.revision = revision;
      document.tombstones[commandKey] = { revision, clearedAt: now(), reason: String(reason || "cleared").slice(0, 80) };
      persist(document);
      publish({ type: "clear", commandKey, revision });
      return existed;
    });
  }

  async function replace(commandKey, metadata = {}, reason = "operator-voided") {
    await clear(commandKey, reason);
    return claim(commandKey, metadata);
  }

  function list() {
    const document = readDocument();
    return Object.entries(document.records)
      .map(([commandKey, record]) => Object.freeze({ commandKey, ...record }))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  function peek(commandKey) {
    return list().find((record) => record.commandKey === commandKey) || null;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  if (channel) {
    const receive = (event) => {
      const data = event && Object.prototype.hasOwnProperty.call(event, "data") ? event.data : event;
      listeners.forEach((listener) => listener(data));
    };
    if (typeof channel.addEventListener === "function") channel.addEventListener("message", receive);
    else channel.onmessage = receive;
  }

  return Object.freeze({ claim, clear, list, peek, replace, subscribe });
}

export const ACTIVITY_PENDING_COMMAND_STORAGE_KEY = DEFAULT_STORAGE_KEY;
