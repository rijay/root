const crypto = require("node:crypto");

const { createInboxContentCodec } = require("./inboxContentProtection");
const { getDefaultInboxHandlerRegistry } = require("./inboxHandlerRegistry");
const { createMysqlInboxCheckpointAdapter } = require("./mysqlInboxCheckpointAdapter");
const {
  INBOX_RETRY_POLICY_V1,
  createInboxRetryPolicy,
} = require("./inboxRetryPolicy");

const MYSQL_SESSION_TIME_ZONE = "+08:00";
const SAFE_ADAPTER_CODES = new Set([
  "INBOX_CHECKPOINT_ENVELOPE_CONFLICT",
  "INBOX_CHECKPOINT_LEASE_LOST",
]);
const CORE_OPTION_KEYS = Object.freeze([
  "pool",
  "consumerName",
  "handlerVersion",
  "sourceName",
  "eventType",
  "schemaVersion",
  "aggregateType",
  "workerId",
  "transitionIdFactory",
  "leaseSeconds",
  "maxAttempts",
  "maxTransactionAttempts",
  "env",
]);

function coreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function configurationError() {
  return coreError("INBOX_CORE_CONFIGURATION_INVALID", "inbox core configuration is invalid");
}

function inputError() {
  return coreError("INBOX_CORE_INPUT_INVALID", "inbox core input is invalid");
}

function persistenceError() {
  return coreError("INBOX_CORE_PERSISTENCE_FAILED", "inbox core persistence failed");
}

function leaseLost() {
  return coreError("INBOX_CORE_LEASE_LOST", "inbox processing lease was lost");
}

function conflictError() {
  return coreError("INBOX_CORE_CONFLICT", "inbox event conflicts with persisted facts");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function positiveInteger(value, fallback, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) throw configurationError();
  return candidate;
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw persistenceError();
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(clone(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactResult(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function normalizedError(error) {
  if (error && error.code === "INBOX_CHECKPOINT_LEASE_LOST") return leaseLost();
  if (error && error.code === "INBOX_CHECKPOINT_ENVELOPE_CONFLICT") return conflictError();
  if (error && error.code === "INBOX_CHECKPOINT_INPUT_INVALID") return inputError();
  if (error && error.code === "INBOX_CHECKPOINT_CONFIGURATION_INVALID") return configurationError();
  if (error && SAFE_ADAPTER_CODES.has(error.code)) return error;
  return persistenceError();
}

function createMysqlInboxCheckpoint(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !CORE_OPTION_KEYS.includes(key))) throw configurationError();
  const pool = options.pool;
  const consumerName = options.consumerName;
  const handlerVersion = options.handlerVersion;
  const sourceName = options.sourceName;
  const eventType = options.eventType;
  const schemaVersion = options.schemaVersion;
  const aggregateType = options.aggregateType;
  const workerId = options.workerId || crypto.randomUUID();
  const transitionIdFactory = options.transitionIdFactory || (() => crypto.randomUUID());
  const retryPolicy = createInboxRetryPolicy();
  const leaseSeconds = positiveInteger(options.leaseSeconds, 30, 3_600);
  const maxAttempts = positiveInteger(options.maxAttempts, 5, 0xFFFFFFFF);
  const maxTransactionAttempts = positiveInteger(options.maxTransactionAttempts, 2, 5);
  let contentCodec;
  let handlerRegistration;
  const runtimeEnv = options.env === undefined ? process.env : options.env;
  try {
    if (options.env !== undefined && !plainRecord(options.env)) throw configurationError();
    const registry = getDefaultInboxHandlerRegistry();
    registry.assertReady();
    handlerRegistration = registry.resolve({
      consumerName,
      handlerVersion,
      sourceName,
      eventType,
      schemaVersion,
      aggregateType,
    });
    if (!handlerRegistration || handlerRegistration.registryScope !== "PRODUCTION") throw configurationError();
    contentCodec = createInboxContentCodec(runtimeEnv);
    contentCodec.assertReady();
    const contentStatus = contentCodec.getStatus();
    if (!plainRecord(contentStatus)
      || contentStatus.ready !== true
      || contentStatus.enabled !== true) throw configurationError();
  } catch {
    throw configurationError();
  }

  if (!pool
    || typeof pool.getConnection !== "function"
    || !exactText(consumerName, 128)
    || !opaqueAscii(handlerVersion, 64)
    || !exactText(sourceName, 96)
    || !exactText(eventType, 128)
    || !opaqueAscii(schemaVersion, 32)
    || !exactText(aggregateType, 96)
    || !opaqueAscii(workerId, 128)
    || typeof transitionIdFactory !== "function") throw configurationError();

  function nextTransitionId() {
    let value;
    try { value = transitionIdFactory(); } catch { throw configurationError(); }
    if (!opaqueAscii(value, 128) || value.length < 8) throw configurationError();
    return value;
  }

  async function acquireConnection() {
    let connection;
    try { connection = await pool.getConnection(); } catch { throw persistenceError(); }
    if (!connection
      || typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function"
      || typeof connection.rollback !== "function"
      || typeof connection.execute !== "function"
      || typeof connection.destroy !== "function"
      || typeof connection.release !== "function") {
      try { if (connection && typeof connection.release === "function") connection.release(); } catch {}
      throw configurationError();
    }
    try {
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
    } catch {
      try { connection.destroy(); } catch {}
      throw persistenceError();
    }
    return connection;
  }

  function createAdapter(connection) {
    try {
      return createMysqlInboxCheckpointAdapter(connection, {
        contentCodec,
        handlerRegistration,
      });
    } catch (error) {
      throw normalizedError(error);
    }
  }

  function retire(adapter, connection, mode) {
    if (mode === "COMMITTED") {
      try { adapter.afterCommit(); } catch {}
    } else {
      try { if (adapter && typeof adapter.discard === "function") adapter.discard(); } catch {}
    }
    try {
      if (mode === "DESTROY") connection.destroy();
      else connection.release();
    } catch {}
  }

  async function executeTransaction(work) {
    const connection = await acquireConnection();
    let adapter;
    let began = false;
    let phase = "BEGIN";
    let workResult;
    try {
      await connection.beginTransaction();
      began = true;
      adapter = createAdapter(connection);
      phase = "WORK";
      workResult = await work(adapter);
      phase = "COMMIT";
      await connection.commit();
      phase = "DONE";
      retire(adapter, connection, "COMMITTED");
      return { ok: true, result: workResult };
    } catch (error) {
      const commitUnknown = phase === "COMMIT";
      let rollbackFailed = false;
      if (began && !commitUnknown) {
        try { await connection.rollback(); } catch { rollbackFailed = true; }
      }
      retire(adapter, connection, phase === "BEGIN" || commitUnknown || rollbackFailed ? "DESTROY" : "ROLLED_BACK");
      return { ok: false, error, commitUnknown, result: workResult };
    }
  }

  async function readAuthoritative(read) {
    const connection = await acquireConnection();
    let adapter;
    let began = false;
    let beginFailed = false;
    let rollbackFailed = false;
    try {
      await connection.beginTransaction();
      began = true;
      adapter = createAdapter(connection);
      const result = await read(adapter);
      await connection.rollback();
      began = false;
      return result;
    } catch (error) {
      beginFailed = !began;
      if (began) {
        try { await connection.rollback(); } catch { rollbackFailed = true; }
      }
      throw normalizedError(error);
    } finally {
      retire(adapter, connection, beginFailed || rollbackFailed ? "DESTROY" : "ROLLED_BACK");
    }
  }

  function scopeInput(input) {
    if (!exactKeys(input, ["sourceName", "partitionKey"])
      || !exactText(input.sourceName, 96)
      || !exactText(input.partitionKey, 191)
      || input.sourceName !== handlerRegistration.descriptor.sourceName) throw inputError();
    return Object.freeze({ sourceName: input.sourceName, partitionKey: input.partitionKey });
  }

  async function receive(envelope) {
    if (!plainRecord(envelope)
      || envelope.sourceName !== handlerRegistration.descriptor.sourceName
      || envelope.eventType !== handlerRegistration.descriptor.eventType
      || envelope.schemaVersion !== handlerRegistration.descriptor.schemaVersion
      || envelope.aggregateType !== handlerRegistration.descriptor.aggregateType) throw inputError();
    const transitionId = nextTransitionId();
    const operation = (adapter) => adapter.receive({
      consumerName,
      handlerVersion,
      transitionId,
      maxAttempts,
      retryPolicyVersion: retryPolicy.policyVersion,
      envelope,
    });
    for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
      const execution = await executeTransaction(operation);
      if (execution.ok) return immutable(execution.result);
      if (!execution.commitUnknown) throw normalizedError(execution.error);
      const readback = await readAuthoritative((adapter) => adapter.readReceiptConvergence({
        consumerName,
        handlerVersion,
        maxAttempts,
        retryPolicyVersion: retryPolicy.policyVersion,
        envelope,
      }));
      if (readback && readback.state === "CONVERGED") return immutable(readback.result);
      if (!readback || readback.state !== "ABSENT" || attempt === maxTransactionAttempts) throw persistenceError();
    }
    throw persistenceError();
  }

  async function claimNext(input = {}) {
    const scope = scopeInput(input);
    const transitionId = nextTransitionId();
    const operation = (adapter) => adapter.claimNext({
      consumerName,
      handlerVersion,
      workerId,
      transitionId,
      sourceName: scope.sourceName,
      partitionKey: scope.partitionKey,
      leaseSeconds,
      retryPolicyVersion: retryPolicy.policyVersion,
    });
    for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
      const execution = await executeTransaction(operation);
      if (execution.ok) return immutable(execution.result);
      if (!execution.commitUnknown) throw normalizedError(execution.error);
      const recovered = await readAuthoritative((adapter) => adapter.readClaimByTransition({
        consumerName,
        workerId,
        transitionId,
      }));
      if (exactResult(execution.result, recovered)) return immutable(recovered);
      throw persistenceError();
    }
    throw persistenceError();
  }

  async function runOwnedTransition(kind, claim, input = {}) {
    if (!plainRecord(claim)) throw inputError();
    const transitionId = nextTransitionId();
    let expectedStatus = "SUCCEEDED";
    let expectedFailure = null;
    let operation;
    if (kind === "COMPLETE") {
      if (!exactKeys(input, [])) throw inputError();
      operation = (adapter) => adapter.completeOwned(claim, { transitionId });
    } else {
      if (!exactKeys(input, ["reasonCode", "retryable"]) || typeof input.retryable !== "boolean") throw inputError();
      const decision = retryPolicy.decide({
        attemptCount: claim.attemptCount,
        maxAttempts: claim.maxAttempts,
        retryable: input.retryable,
        reasonCode: input.reasonCode,
      });
      expectedStatus = decision.kind === "RETRY" ? "RETRY_PENDING" : "DEAD_LETTER";
      expectedFailure = Object.freeze({
        kind: decision.kind,
        delayMs: decision.delayMs,
        reasonCode: decision.reasonCode,
        policyVersion: decision.policyVersion,
      });
      operation = (adapter) => adapter.failOwned(claim, {
        transitionId,
        reasonCode: decision.reasonCode,
        retryable: decision.kind === "RETRY",
        retryPolicy: INBOX_RETRY_POLICY_V1,
      });
    }

    for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
      const execution = await executeTransaction(operation);
      if (execution.ok) return immutable(execution.result);
      if (!execution.commitUnknown) throw normalizedError(execution.error);
      const recovered = await readAuthoritative((adapter) => adapter.readTransition({
        claim,
        transitionId,
        expectedStatus,
        expectedFailure,
      }));
      if (recovered && recovered.state === "CONVERGED") {
        if (execution.result !== undefined && !exactResult(execution.result, recovered.result)) throw persistenceError();
        return immutable(recovered.result);
      }
      if (recovered && recovered.state === "LEASE_LOST") throw leaseLost();
      if (!recovered || recovered.state !== "OWNED" || attempt === maxTransactionAttempts) throw persistenceError();
    }
    throw persistenceError();
  }

  async function completeOwned(claim, input = {}) {
    return runOwnedTransition("COMPLETE", claim, input);
  }

  async function failOwned(claim, input = {}) {
    return runOwnedTransition("FAIL", claim, input);
  }

  async function recoverExpired(input = {}) {
    const scope = scopeInput(input);
    const transitionId = nextTransitionId();
    const operation = (adapter) => adapter.recoverExpired({
      consumerName,
      handlerVersion,
      sourceName: scope.sourceName,
      partitionKey: scope.partitionKey,
      transitionId,
      retryPolicy: INBOX_RETRY_POLICY_V1,
    });
    for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
      const execution = await executeTransaction(operation);
      if (execution.ok) return immutable(execution.result);
      if (!execution.commitUnknown) throw normalizedError(execution.error);
      const recovered = await readAuthoritative((adapter) => adapter.readRecoveryByTransition({
        consumerName,
        sourceName: scope.sourceName,
        partitionKey: scope.partitionKey,
        transitionId,
      }));
      if (recovered && recovered.state === "CONVERGED" && exactResult(execution.result, recovered.result)) {
        return immutable(recovered.result);
      }
      if (recovered && recovered.state === "ABSENT" && Array.isArray(execution.result) && execution.result.length === 0) {
        return Object.freeze([]);
      }
      throw persistenceError();
    }
    throw persistenceError();
  }

  async function getCheckpoint(input = {}) {
    const scope = scopeInput(input);
    const checkpoint = await readAuthoritative((adapter) => adapter.getCheckpoint({
      consumerName,
      handlerVersion,
      sourceName: scope.sourceName,
      partitionKey: scope.partitionKey,
    }));
    return checkpoint === null ? null : immutable(checkpoint);
  }

  return Object.freeze({
    receive,
    claimNext,
    completeOwned,
    failOwned,
    recoverExpired,
    getCheckpoint,
  });
}

module.exports = {
  createMysqlInboxCheckpoint,
};
