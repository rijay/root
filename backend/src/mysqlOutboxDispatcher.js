const crypto = require("node:crypto");

const { createMysqlOutboxDispatcherAdapter } = require("./mysqlOutboxDispatcherAdapter");
const {
  assertRuntimeEventClaim,
  assertRuntimeEventScopeRegistration,
} = require("./runtimeEventScopeCatalog");
const {
  OUTBOX_RETRY_POLICY_V1,
  createOutboxRetryPolicy,
} = require("./outboxRetryPolicy");

const SAFE_ERROR_CODES = new Set([
  "OUTBOX_DISPATCH_INPUT_INVALID",
  "OUTBOX_DISPATCH_LEASE_LOST",
  "OUTBOX_DISPATCH_STATE_INVALID",
]);
const MYSQL_SESSION_TIME_ZONE = "+08:00";

function dispatcherError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function configurationError() {
  return dispatcherError(
    "OUTBOX_DISPATCH_CONFIGURATION_INVALID",
    "outbox dispatcher configuration is invalid"
  );
}

function persistenceError() {
  return dispatcherError(
    "OUTBOX_DISPATCH_PERSISTENCE_FAILED",
    "outbox dispatcher persistence failed"
  );
}

function normalizePositiveInteger(value, fallback, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
  }
  return candidate;
}

function opaqueIdentifier(value) {
  if (typeof value !== "string") throw configurationError();
  const normalized = value.trim();
  if (
    normalized !== value
    || normalized.length < 8
    || normalized.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) throw configurationError();
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function registeredRuntimeScope(value) {
  try { return assertRuntimeEventScopeRegistration(value); } catch {
    throw dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
  }
}

function assertRegisteredClaims(scope, value) {
  if (!Array.isArray(value)) throw persistenceError();
  for (const claim of value) {
    try { assertRuntimeEventClaim(scope, claim); } catch { throw persistenceError(); }
  }
  return value;
}

function exactResultSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const order = (items) => [...items]
    .sort((first, second) => String(first && first.outboxEventId).localeCompare(String(second && second.outboxEventId)));
  return canonicalJson(order(left)) === canonicalJson(order(right));
}

function normalizedError(error) {
  if (error && error.code === "OUTBOX_LEASE_LOST") {
    return dispatcherError("OUTBOX_DISPATCH_LEASE_LOST", "outbox dispatch lease was lost");
  }
  if (error && error.code === "OUTBOX_DISPATCHER_INPUT_INVALID") {
    return dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
  }
  if (error && SAFE_ERROR_CODES.has(error.code)) return error;
  return persistenceError();
}

function createMysqlOutboxDispatcher(options = {}) {
  const pool = options.pool;
  const adapterFactory = options.adapterFactory || createMysqlOutboxDispatcherAdapter;
  const retryPolicy = createOutboxRetryPolicy();
  const transitionIdFactory = options.transitionIdFactory || (() => crypto.randomUUID());
  const workerId = opaqueIdentifier(options.workerId || crypto.randomUUID());
  const leaseSeconds = normalizePositiveInteger(options.leaseSeconds, 30, 3_600);
  const maxTransactionAttempts = normalizePositiveInteger(options.maxTransactionAttempts, 2, 5);

  if (
    !pool
    || typeof pool.getConnection !== "function"
    || typeof adapterFactory !== "function"
    || !retryPolicy
    || typeof retryPolicy.decide !== "function"
    || typeof retryPolicy.policyVersion !== "string"
    || typeof transitionIdFactory !== "function"
    || options.retryPolicy !== undefined
  ) throw configurationError();

  function nextTransitionId() {
    return opaqueIdentifier(transitionIdFactory());
  }

  async function acquireConnection() {
    let connection;
    try {
      connection = await pool.getConnection();
    } catch (error) {
      throw persistenceError(error);
    }
    if (
      !connection
      || typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function"
      || typeof connection.rollback !== "function"
      || typeof connection.execute !== "function"
      || typeof connection.destroy !== "function"
      || typeof connection.release !== "function"
    ) {
      try {
        if (connection && typeof connection.release === "function") connection.release();
      } catch {}
      throw configurationError();
    }
    try {
      await connection.execute("SET SESSION time_zone = '+08:00'");
    } catch {
      try { connection.destroy(); } catch {}
      throw persistenceError();
    }
    return connection;
  }

  function retire(adapter, connection, destroy = false) {
    try {
      if (adapter && typeof adapter.discard === "function") adapter.discard();
    } catch {}
    try {
      if (destroy) connection.destroy();
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
      adapter = adapterFactory(connection);
      phase = "WORK";
      workResult = await work(adapter);
      phase = "COMMIT";
      await connection.commit();
      phase = "DONE";
      retire(adapter, connection);
      return { ok: true, result: workResult };
    } catch (error) {
      const commitUnknown = phase === "COMMIT";
      let rollbackFailed = false;
      if (began && !commitUnknown) {
        try {
          await connection.rollback();
        } catch {
          rollbackFailed = true;
        }
      }
      retire(adapter, connection, phase === "BEGIN" || commitUnknown || rollbackFailed);
      return { ok: false, error, commitUnknown, result: workResult };
    }
  }

  async function readAuthoritative(read) {
    const connection = await acquireConnection();
    let adapter;
    let began = false;
    let rollbackFailed = false;
    let beginFailed = false;
    try {
      await connection.beginTransaction();
      began = true;
      adapter = adapterFactory(connection);
      const result = await read(adapter);
      await connection.rollback();
      began = false;
      return result;
    } catch (error) {
      beginFailed = !began;
      if (began) {
        try {
          await connection.rollback();
        } catch {
          rollbackFailed = true;
        }
      }
      throw normalizedError(error);
    } finally {
      retire(adapter, connection, beginFailed || rollbackFailed);
    }
  }

  async function claimDue(input = {}) {
    const limit = normalizePositiveInteger(input.limit, 10, 100);
    const transitionId = nextTransitionId();
    const execution = await executeTransaction((adapter) => adapter.claimDue({
      workerId,
      transitionId,
      limit,
      leaseSeconds,
      retryPolicyVersion: retryPolicy.policyVersion,
    }));
    if (execution.ok) return immutable(execution.result);
    if (!execution.commitUnknown) throw normalizedError(execution.error);

    const recovered = await readAuthoritative((adapter) => adapter.readClaimsByTransition({
      workerId,
      transitionId,
    }));
    if (exactResultSet(execution.result, recovered)) return immutable(recovered);
    throw persistenceError(execution.error);
  }

  async function claimRegistered(handlerRegistration, input = {}) {
    const { registration, scope } = registeredRuntimeScope(handlerRegistration);
    if (!exactKeys(input, input.limit === undefined ? [] : ["limit"])) {
      throw dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
    }
    const limit = normalizePositiveInteger(input.limit, 10, 100);
    const transitionId = nextTransitionId();
    const execution = await executeTransaction((adapter) => adapter.claimRegistered({
      workerId,
      transitionId,
      limit,
      leaseSeconds,
      retryPolicyVersion: retryPolicy.policyVersion,
      handlerRegistration: registration,
    }));
    if (execution.ok) return immutable(assertRegisteredClaims(scope, execution.result));
    if (!execution.commitUnknown) throw normalizedError(execution.error);

    const recovered = await readAuthoritative((adapter) => adapter.readClaimsByTransition({
      workerId,
      transitionId,
    }));
    assertRegisteredClaims(scope, recovered);
    if (exactResultSet(execution.result, recovered)) return immutable(recovered);
    throw persistenceError(execution.error);
  }

  async function runOwnedTransition(kind, claim, input = {}) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      throw dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
    }
    const transitionId = nextTransitionId();
    let expectedStatus = "SUCCEEDED";
    let operation;
    if (kind === "COMPLETE") {
      operation = (adapter) => adapter.completeOwned(claim, { transitionId });
    } else {
      const decision = retryPolicy.decide({
        attemptCount: claim.attemptCount,
        maxAttempts: claim.maxAttempts,
        reasonCode: input.reasonCode,
        retryable: input.retryable === true,
      });
      expectedStatus = decision.kind === "RETRY" ? "RETRY_PENDING" : "DEAD_LETTER";
      operation = (adapter) => adapter.failOwned(claim, {
        transitionId,
        reasonCode: decision.reasonCode,
        retryable: decision.kind === "RETRY",
        retryPolicy: OUTBOX_RETRY_POLICY_V1,
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
      }));
      if (recovered && recovered.state === "CONVERGED") {
        return immutable(recovered.result || { status: expectedStatus, replayed: true });
      }
      if (recovered && recovered.state === "LEASE_LOST") {
        throw dispatcherError("OUTBOX_DISPATCH_LEASE_LOST", "outbox dispatch lease was lost");
      }
      if (!recovered || recovered.state !== "OWNED" || attempt === maxTransactionAttempts) {
        throw persistenceError(execution.error);
      }
    }
    throw persistenceError();
  }

  async function completeOwned(claim) {
    return runOwnedTransition("COMPLETE", claim);
  }

  async function failOwned(claim, input = {}) {
    return runOwnedTransition("FAIL", claim, input);
  }

  async function recoverExpired(input = {}) {
    const limit = normalizePositiveInteger(input.limit, 10, 100);
    const transitionId = nextTransitionId();
    const execution = await executeTransaction((adapter) => adapter.recoverExpired({
      transitionId,
      limit,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
    }));
    if (execution.ok) return immutable(execution.result);
    if (!execution.commitUnknown) throw normalizedError(execution.error);

    const recovered = await readAuthoritative((adapter) => adapter.readRecoveryByTransition({
      transitionId,
    }));
    if (
      recovered
      && recovered.state === "CONVERGED"
      && exactResultSet(execution.result, recovered.result)
    ) return immutable(recovered.result);
    if (
      Array.isArray(execution.result)
      && execution.result.length === 0
      && recovered
      && recovered.state === "ABSENT"
    ) return Object.freeze([]);
    throw persistenceError(execution.error);
  }

  async function recoverExpiredRegistered(handlerRegistration, input = {}) {
    const { registration } = registeredRuntimeScope(handlerRegistration);
    if (!exactKeys(input, input.limit === undefined ? [] : ["limit"])) {
      throw dispatcherError("OUTBOX_DISPATCH_INPUT_INVALID", "outbox dispatcher input is invalid");
    }
    const limit = normalizePositiveInteger(input.limit, 10, 100);
    const transitionId = nextTransitionId();
    const execution = await executeTransaction((adapter) => adapter.recoverExpiredRegistered({
      transitionId,
      limit,
      retryPolicy: OUTBOX_RETRY_POLICY_V1,
      handlerRegistration: registration,
    }));
    if (execution.ok) return immutable(execution.result);
    if (!execution.commitUnknown) throw normalizedError(execution.error);

    const recovered = await readAuthoritative((adapter) => adapter.readRecoveryByTransition({
      transitionId,
    }));
    if (
      recovered
      && recovered.state === "CONVERGED"
      && exactResultSet(execution.result, recovered.result)
    ) return immutable(recovered.result);
    if (
      Array.isArray(execution.result)
      && execution.result.length === 0
      && recovered
      && recovered.state === "ABSENT"
    ) return Object.freeze([]);
    throw persistenceError(execution.error);
  }

  return Object.freeze({
    claimDue,
    claimRegistered,
    completeOwned,
    failOwned,
    recoverExpired,
    recoverExpiredRegistered,
  });
}

module.exports = {
  createMysqlOutboxDispatcher,
};
