const crypto = require("node:crypto");

const { createMysqlInboxWorkerHarness } = require("./mysqlInboxWorkerHarness");
const {
  createMysqlOutboxToInboxBridgeHarness,
} = require("./mysqlOutboxToInboxBridgeHarness");

const ENABLE_FLAG = "MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED";
const KILL_SWITCH_FLAG = "MYROOT_V1_RUNTIME_KILL_SWITCH";
const OWNER_FLAG = "MYROOT_V1_RUNTIME_OWNER";
const BRIDGE_FLAG = "MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED";
const WORKER_FLAG = "MYROOT_INBOX_WORKER_HARNESS_ENABLED";
const CONNECTION_LIMIT_FLAG = "MYSQL_CONNECTION_LIMIT";
const DATABASE_FLAG = "MYSQL_DATABASE";
const ENVIRONMENT_ID_FLAG = "MYROOT_V1_RUNTIME_ENVIRONMENT_ID";
const LOCK_NAME_PREFIX = "myroot:v1:runtime:";
const RUNTIME_APPLICATION_SCOPE = "myroot-v1-runtime-orchestrator";
const MYSQL_SESSION_TIME_ZONE = "+08:00";
const COORDINATION_SCOPE = "NON_OVERLAP_COORDINATION_ONLY";

const PRODUCTION_OPTION_KEYS = Object.freeze(["pool", "env"]);
const BRIDGE_KEYS = Object.freeze(["inspect", "recoverOnce", "runOnce"]);
const WORKER_KEYS = Object.freeze(["inspect", "recoverOnce", "runOnce"]);
const COORDINATOR_KEYS = Object.freeze(["inspect", "tryAcquire"]);
const LEASE_KEYS = Object.freeze([
  "coordinationDigest", "coordinationScope", "assertHeld", "release",
]);
const ONE_SHOT_KEYS = Object.freeze(["bridgeLimit", "workerLimit", "recoveryLimit"]);

const OWNED_MODULES = Object.freeze(["OUTBOX_INBOX_BRIDGE", "INBOX_WORKER"]);
const EXCLUDED_MODULES = Object.freeze([
  Object.freeze({ module: "INBOX_SHADOW_REPLAY", reasonCode: "GOVERNED_MANUAL_ONLY" }),
  Object.freeze({
    module: "NOTIFICATION_PROVIDER_SEND",
    reasonCode: "NO_PROVIDER_SEND_INTERFACE",
  }),
]);

function orchestrationError(code) {
  const error = new Error("v1 runtime orchestration operation failed");
  error.code = code;
  return error;
}

function configurationError() {
  return orchestrationError("V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID");
}

function inputError() {
  return orchestrationError("V1_RUNTIME_ORCHESTRATOR_INPUT_INVALID");
}

function persistenceError() {
  return orchestrationError("V1_RUNTIME_ORCHESTRATOR_PERSISTENCE_FAILED");
}

function coordinationError() {
  return orchestrationError("V1_RUNTIME_ORCHESTRATOR_COORDINATION_FAILED");
}

function targetAuthorityError() {
  return orchestrationError("V1_RUNTIME_ORCHESTRATOR_TARGET_AUTHORITY_FAILED");
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

function sha256Digest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function nonNegativeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw persistenceError();
  return count;
}

function positiveConnectionId(value) {
  const connectionId = Number(value);
  if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw coordinationError();
  return connectionId;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function assertAdapter(adapter, keys) {
  if (!exactKeys(adapter, keys)
    || keys.some((key) => typeof adapter[key] !== "function")) throw configurationError();
  return adapter;
}

function normalizeEnvironment(env) {
  if (!plainRecord(env)) throw configurationError();
  return env;
}

function runtimeOwner(env) {
  const owner = env[OWNER_FLAG];
  return opaqueAscii(owner, 96) ? owner : null;
}

function runtimeConnectionLimit(env) {
  const raw = Object.prototype.hasOwnProperty.call(env, CONNECTION_LIMIT_FLAG)
    ? env[CONNECTION_LIMIT_FLAG]
    : "8";
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function runtimeTargetIdentity(env) {
  const database = env[DATABASE_FLAG];
  const environmentId = env[ENVIRONMENT_ID_FLAG];
  if (!opaqueAscii(database, 64) || !opaqueAscii(environmentId, 96)) return null;
  return Object.freeze({ database, environmentId });
}

function runtimeLockName(actualDatabase) {
  if (!opaqueAscii(actualDatabase, 64)) throw coordinationError();
  const digest = crypto.createHash("sha256")
    .update("myroot:v1:runtime-lock-authority:v1\0", "utf8")
    .update(RUNTIME_APPLICATION_SCOPE, "utf8")
    .update("\0", "utf8")
    .update(actualDatabase, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `${LOCK_NAME_PREFIX}${digest}`;
}

function mysqlPoolConnectionLimit(pool) {
  if (!pool || typeof pool !== "object") return null;
  const mysqlPool = pool.pool && typeof pool.pool === "object" ? pool.pool : pool;
  const config = mysqlPool.config;
  if (!config || typeof config !== "object") return null;
  const value = config.connectionLimit;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw inputError();
  return value;
}

function normalizeOneShot(input) {
  if (!exactKeys(input, ONE_SHOT_KEYS)) throw inputError();
  return Object.freeze({
    bridgeLimit: normalizeLimit(input.bridgeLimit),
    workerLimit: normalizeLimit(input.workerLimit),
    recoveryLimit: normalizeLimit(input.recoveryLimit),
  });
}

function selectedSingleRow(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows) || rows.length !== 1 || !plainRecord(rows[0])) {
    throw coordinationError();
  }
  return rows[0];
}

function assertPoolConnection(connection) {
  if (!connection
    || typeof connection.execute !== "function"
    || typeof connection.release !== "function"
    || typeof connection.destroy !== "function") throw configurationError();
  return connection;
}

function createTargetBoundMysqlPool(pool, configuredDatabase) {
  if (!pool || typeof pool.getConnection !== "function"
    || !opaqueAscii(configuredDatabase, 64)) throw configurationError();

  async function getConnection() {
    let connection;
    try {
      connection = assertPoolConnection(await pool.getConnection());
      const authority = selectedSingleRow(await connection.execute(
        "SELECT DATABASE() AS database_name"
      ));
      if (authority.database_name !== configuredDatabase
        || !opaqueAscii(authority.database_name, 64)) throw targetAuthorityError();
      return connection;
    } catch (error) {
      try { if (connection) connection.destroy(); } catch {}
      if (error && error.code === "V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID") throw error;
      throw targetAuthorityError();
    }
  }

  return Object.freeze({ getConnection });
}

function createMysqlNamedLockCoordinator(pool, configuredDatabase) {
  if (!pool || typeof pool.getConnection !== "function"
    || !opaqueAscii(configuredDatabase, 64)) throw configurationError();

  async function acquireConnection() {
    let connection;
    try {
      connection = assertPoolConnection(await pool.getConnection());
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
      const authority = selectedSingleRow(await connection.execute(
        "SELECT DATABASE() AS database_name"
      ));
      if (authority.database_name !== configuredDatabase
        || !opaqueAscii(authority.database_name, 64)) throw coordinationError();
      return Object.freeze({
        connection,
        lockName: runtimeLockName(authority.database_name),
      });
    } catch (error) {
      try { if (connection) connection.destroy(); } catch {}
      if (error && error.code === "V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID") throw error;
      throw coordinationError();
    }
  }

  function retire(connection, destroy = false) {
    try {
      if (destroy) connection.destroy();
      else connection.release();
    } catch {}
  }

  async function inspect() {
    const acquired = await acquireConnection();
    const { connection, lockName } = acquired;
    let destroy = false;
    try {
      const row = selectedSingleRow(await connection.execute(
        "SELECT IS_FREE_LOCK(?) AS is_free, IS_USED_LOCK(?) AS connection_id",
        [lockName, lockName]
      ));
      const free = Number(row.is_free);
      const holder = row.connection_id === null ? null : positiveConnectionId(row.connection_id);
      if (![0, 1].includes(free)
        || (free === 1 && holder !== null)
        || (free === 0 && holder === null)) throw coordinationError();
      return Object.freeze({
        ready: true,
        lockState: free === 1 ? "FREE" : "HELD",
        coordinationScope: COORDINATION_SCOPE,
      });
    } catch (error) {
      destroy = true;
      throw error && error.code ? error : coordinationError();
    } finally {
      retire(connection, destroy);
    }
  }

  async function tryAcquire(identity) {
    if (!plainRecord(identity)
      || !opaqueAscii(identity.runtimeOwner, 96)
      || !opaqueAscii(identity.cycleId, 64)) throw coordinationError();
    const acquired = await acquireConnection();
    const { connection, lockName } = acquired;
    let retired = false;
    let destroy = false;
    try {
      const row = selectedSingleRow(await connection.execute(
        "SELECT GET_LOCK(?, 0) AS acquired, CONNECTION_ID() AS connection_id",
        [lockName]
      ));
      if (row.acquired === null || row.acquired === undefined) throw coordinationError();
      const acquired = Number(row.acquired);
      if (![0, 1].includes(acquired)) throw coordinationError();
      if (acquired === 0) {
        retire(connection, false);
        retired = true;
        return null;
      }
      const connectionId = positiveConnectionId(row.connection_id);
      const coordinationDigest = crypto.createHash("sha256")
        .update("myroot:v1:runtime-coordination-lease:v1\0", "utf8")
        .update(lockName, "utf8")
        .update("\0", "utf8")
        .update(identity.runtimeOwner, "utf8")
        .update("\0", "utf8")
        .update(identity.cycleId, "utf8")
        .update("\0", "utf8")
        .update(String(connectionId), "utf8")
        .digest("hex");

      async function assertHeld() {
        if (retired) return false;
        try {
          const held = selectedSingleRow(await connection.execute(
            "SELECT IS_USED_LOCK(?) AS connection_id",
            [lockName]
          ));
          return held.connection_id !== null
            && Number(held.connection_id) === connectionId;
        } catch {
          retire(connection, true);
          retired = true;
          return false;
        }
      }

      async function release() {
        if (retired) return;
        let released = false;
        try {
          const row = selectedSingleRow(await connection.execute(
            "SELECT RELEASE_LOCK(?) AS released",
            [lockName]
          ));
          released = Number(row.released) === 1;
          if (!released) throw coordinationError();
          retire(connection, false);
          retired = true;
        } catch (error) {
          retire(connection, true);
          retired = true;
          throw error && error.code ? error : coordinationError();
        }
      }

      return Object.freeze({
        coordinationDigest,
        coordinationScope: COORDINATION_SCOPE,
        assertHeld,
        release,
      });
    } catch (error) {
      destroy = !retired;
      throw error && error.code ? error : coordinationError();
    } finally {
      if (destroy && !retired) retire(connection, true);
    }
  }

  return Object.freeze({ inspect, tryAcquire });
}

function normalizeCoordinationSnapshot(value) {
  if (!exactKeys(value, ["ready", "lockState", "coordinationScope"])
    || value.ready !== true
    || !["FREE", "HELD"].includes(value.lockState)
    || value.coordinationScope !== COORDINATION_SCOPE) throw persistenceError();
  return Object.freeze({
    ready: true,
    lockState: value.lockState,
    coordinationScope: value.coordinationScope,
  });
}

function normalizeBridgeSnapshot(value) {
  if (!exactKeys(value, ["enabled", "killSwitch", "lag", "mismatch", "readiness"])
    || typeof value.enabled !== "boolean"
    || !["OPEN", "CLOSED"].includes(value.killSwitch)
    || !exactKeys(value.lag, ["receipt", "claimed"])
    || !exactKeys(value.mismatch, [
      "outboxScope", "inboxRegistration", "terminalWithoutReceipt", "unregisteredActive",
      "successorUnavailableActive", "outboxOpenDeadLetter", "deadLetterCompanion",
    ])
    || !exactKeys(value.readiness, ["ready", "reasonCode"])
    || typeof value.readiness.ready !== "boolean"
    || !opaqueAscii(value.readiness.reasonCode, 96)) throw persistenceError();
  return deepFreeze({
    enabled: value.enabled,
    killSwitch: value.killSwitch,
    lag: {
      receipt: nonNegativeCount(value.lag.receipt),
      claimed: nonNegativeCount(value.lag.claimed),
    },
    mismatch: {
      outboxScope: nonNegativeCount(value.mismatch.outboxScope),
      inboxRegistration: nonNegativeCount(value.mismatch.inboxRegistration),
      terminalWithoutReceipt: nonNegativeCount(value.mismatch.terminalWithoutReceipt),
      unregisteredActive: nonNegativeCount(value.mismatch.unregisteredActive),
      successorUnavailableActive: nonNegativeCount(
        value.mismatch.successorUnavailableActive
      ),
      outboxOpenDeadLetter: nonNegativeCount(value.mismatch.outboxOpenDeadLetter),
      deadLetterCompanion: nonNegativeCount(value.mismatch.deadLetterCompanion),
    },
    readiness: {
      ready: value.readiness.ready,
      reasonCode: value.readiness.reasonCode,
    },
  });
}

function normalizeWorkerSnapshot(value) {
  if (!exactKeys(value, [
    "receiptCount", "statusCounts", "runnableScopeCount", "recoverableScopeCount",
    "blockedGapScopeCount", "checkpointMissingReceiptCount", "registrationMismatchHeadCount",
    "successorUnavailableHeadCount",
  ])
    || !exactKeys(value.statusCounts, [
      "received", "retryPending", "claimed", "succeeded", "deadLetter", "reviewRequired",
    ])) throw persistenceError();
  const snapshot = {
    receiptCount: nonNegativeCount(value.receiptCount),
    statusCounts: {
      received: nonNegativeCount(value.statusCounts.received),
      retryPending: nonNegativeCount(value.statusCounts.retryPending),
      claimed: nonNegativeCount(value.statusCounts.claimed),
      succeeded: nonNegativeCount(value.statusCounts.succeeded),
      deadLetter: nonNegativeCount(value.statusCounts.deadLetter),
      reviewRequired: nonNegativeCount(value.statusCounts.reviewRequired),
    },
    runnableScopeCount: nonNegativeCount(value.runnableScopeCount),
    recoverableScopeCount: nonNegativeCount(value.recoverableScopeCount),
    blockedGapScopeCount: nonNegativeCount(value.blockedGapScopeCount),
    checkpointMissingReceiptCount: nonNegativeCount(value.checkpointMissingReceiptCount),
    registrationMismatchHeadCount: nonNegativeCount(value.registrationMismatchHeadCount),
    successorUnavailableHeadCount: nonNegativeCount(value.successorUnavailableHeadCount),
  };
  const statusTotal = Object.values(snapshot.statusCounts)
    .reduce((sum, count) => sum + count, 0);
  if (snapshot.receiptCount !== statusTotal
    || snapshot.runnableScopeCount
      > snapshot.statusCounts.received + snapshot.statusCounts.retryPending
    || snapshot.recoverableScopeCount > snapshot.statusCounts.claimed) throw persistenceError();
  return deepFreeze(snapshot);
}

function alert(code, severity, count = null) {
  return Object.freeze({ code, severity, count });
}

function addCountAlert(alerts, code, count, severity) {
  if (count > 0) alerts.push(alert(code, severity, count));
}

function unavailableSnapshot() {
  return Object.freeze({ status: "UNAVAILABLE" });
}

function normalizePhaseResult(value, expectedKeys, requiresEnabled) {
  if (!exactKeys(value, expectedKeys)
    || (requiresEnabled && value.enabled !== true)) throw persistenceError();
  const result = {};
  for (const key of expectedKeys) {
    if (key === "enabled") result.enabled = true;
    else result[key] = nonNegativeCount(value[key]);
  }
  return Object.freeze(result);
}

function normalizeBridgeRecovery(value) {
  const result = normalizePhaseResult(value, [
    "enabled", "recoveredCount", "retryPendingCount", "deadLetteredCount",
  ], true);
  if (result.recoveredCount !== result.retryPendingCount + result.deadLetteredCount) {
    throw persistenceError();
  }
  return result;
}

function normalizeBridgeDispatch(value) {
  const result = normalizePhaseResult(value, [
    "enabled", "claimedCount", "inboxCreatedCount", "inboxReplayedCount",
    "outboxCompletedCount", "retryScheduledCount", "deadLetteredCount",
  ], true);
  if (result.inboxCreatedCount + result.inboxReplayedCount !== result.outboxCompletedCount
    || result.claimedCount !== result.outboxCompletedCount
      + result.retryScheduledCount + result.deadLetteredCount) throw persistenceError();
  return result;
}

function normalizeWorkerRecovery(value) {
  const result = normalizePhaseResult(value, [
    "discoveredScopeCount", "recoveredCount", "retryPendingCount", "deadLetterCount", "noOpCount",
  ], false);
  if (result.recoveredCount !== result.retryPendingCount + result.deadLetterCount
    || result.discoveredScopeCount !== result.recoveredCount + result.noOpCount) {
    throw persistenceError();
  }
  return result;
}

function normalizeWorkerExecution(value) {
  const result = normalizePhaseResult(value, [
    "discoveredScopeCount", "claimedCount", "succeededCount", "retryScheduledCount", "noOpCount",
  ], false);
  if (result.claimedCount !== result.succeededCount + result.retryScheduledCount
    || result.discoveredScopeCount !== result.claimedCount + result.noOpCount) {
    throw persistenceError();
  }
  return result;
}

function createRuntimeOrchestrationCore({ env, adapters, actualConnectionLimit }) {
  const bridge = assertAdapter(adapters.bridge, BRIDGE_KEYS);
  const worker = assertAdapter(adapters.worker, WORKER_KEYS);
  const coordinator = assertAdapter(adapters.coordinator, COORDINATOR_KEYS);
  let cycleInFlight = false;

  const enabled = env[ENABLE_FLAG] === "true";
  const killSwitch = env[KILL_SWITCH_FLAG] === "DISENGAGED" ? "DISENGAGED" : "ENGAGED";
  const owner = runtimeOwner(env);
  const targetIdentity = runtimeTargetIdentity(env);
  const configuredConnectionLimit = runtimeConnectionLimit(env);
  const actualPoolConnectionLimit = Number.isSafeInteger(actualConnectionLimit)
    && actualConnectionLimit > 0
    ? actualConnectionLimit
    : null;
  const poolCapacityVerified = configuredConnectionLimit !== null
    && actualPoolConnectionLimit !== null;
  const poolCapacityConsistent = poolCapacityVerified
    && configuredConnectionLimit === actualPoolConnectionLimit;
  // Coordination holds one connection, an active Bridge/Worker phase uses a
  // second, and the Control Plane lease heartbeat must retain a third so a
  // long phase cannot starve renewal.
  const poolCapacityReady = poolCapacityConsistent && actualPoolConnectionLimit >= 3;
  const bridgeConfigured = env[BRIDGE_FLAG] === "true";
  const workerConfigured = env[WORKER_FLAG] === "true";

  async function inspectWithCoordination(knownCoordination = null) {
    let coordination = knownCoordination === null
      ? unavailableSnapshot()
      : normalizeCoordinationSnapshot(knownCoordination);
    let bridgeStatus = unavailableSnapshot();
    let workerStatus = unavailableSnapshot();
    let coordinationFailure = false;
    let bridgeFailure = false;
    let workerFailure = false;
    if (knownCoordination === null && targetIdentity) {
      try { coordination = normalizeCoordinationSnapshot(await coordinator.inspect()); } catch {
        coordinationFailure = true;
      }
    }
    try { bridgeStatus = normalizeBridgeSnapshot(await bridge.inspect()); } catch {
      bridgeFailure = true;
    }
    try { workerStatus = normalizeWorkerSnapshot(await worker.inspect()); } catch {
      workerFailure = true;
    }

    const alerts = [];
    if (!enabled) alerts.push(alert("ORCHESTRATOR_DISABLED", "BLOCKER"));
    if (killSwitch !== "DISENGAGED") {
      alerts.push(alert("ORCHESTRATOR_KILL_SWITCH_ENGAGED", "BLOCKER"));
    }
    if (!owner) alerts.push(alert("RUNTIME_OWNER_UNASSIGNED", "BLOCKER"));
    if (!targetIdentity) alerts.push(alert("RUNTIME_TARGET_IDENTITY_UNASSIGNED", "BLOCKER"));
    if (!poolCapacityVerified) {
      alerts.push(alert("RUNTIME_POOL_CAPACITY_UNVERIFIED", "BLOCKER"));
    } else if (!poolCapacityConsistent) {
      alerts.push(alert("RUNTIME_POOL_CAPACITY_MISMATCH", "BLOCKER"));
    } else if (!poolCapacityReady) {
      alerts.push(alert("RUNTIME_POOL_CAPACITY_INSUFFICIENT", "BLOCKER"));
    }
    if (coordinationFailure) alerts.push(alert("COORDINATION_INSPECTION_FAILED", "BLOCKER"));
    if (bridgeFailure) alerts.push(alert("BRIDGE_INSPECTION_FAILED", "BLOCKER"));
    if (workerFailure) alerts.push(alert("WORKER_INSPECTION_FAILED", "BLOCKER"));

    if (!bridgeFailure) {
      if (!bridgeConfigured || !bridgeStatus.enabled) {
        alerts.push(alert("BRIDGE_DISABLED", "BLOCKER"));
      } else if (!bridgeStatus.readiness.ready) {
        alerts.push(alert(bridgeStatus.readiness.reasonCode, "BLOCKER"));
      }
    }
    if (!workerFailure && !workerConfigured) alerts.push(alert("WORKER_DISABLED", "BLOCKER"));

    if (!bridgeFailure) {
      addCountAlert(alerts, "BRIDGE_OUTBOX_SCOPE_MISMATCH", bridgeStatus.mismatch.outboxScope, "BLOCKER");
      addCountAlert(
        alerts,
        "BRIDGE_INBOX_REGISTRATION_MISMATCH",
        bridgeStatus.mismatch.inboxRegistration,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "BRIDGE_TERMINAL_WITHOUT_RECEIPT",
        bridgeStatus.mismatch.terminalWithoutReceipt,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "BRIDGE_UNREGISTERED_ACTIVE",
        bridgeStatus.mismatch.unregisteredActive,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "BRIDGE_SUCCESSOR_UNAVAILABLE_ACTIVE",
        bridgeStatus.mismatch.successorUnavailableActive,
        "WARNING"
      );
      addCountAlert(
        alerts,
        "BRIDGE_OUTBOX_OPEN_DEAD_LETTER",
        bridgeStatus.mismatch.outboxOpenDeadLetter,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "BRIDGE_DEAD_LETTER_COMPANION_MISMATCH",
        bridgeStatus.mismatch.deadLetterCompanion,
        "BLOCKER"
      );
    }
    if (!workerFailure) {
      addCountAlert(alerts, "WORKER_BLOCKED_GAP", workerStatus.blockedGapScopeCount, "BLOCKER");
      addCountAlert(
        alerts,
        "WORKER_CHECKPOINT_MISSING",
        workerStatus.checkpointMissingReceiptCount,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "WORKER_REGISTRATION_MISMATCH",
        workerStatus.registrationMismatchHeadCount,
        "BLOCKER"
      );
      addCountAlert(
        alerts,
        "WORKER_SUCCESSOR_UNAVAILABLE",
        workerStatus.successorUnavailableHeadCount,
        "WARNING"
      );
      addCountAlert(alerts, "WORKER_DEAD_LETTER", workerStatus.statusCounts.deadLetter, "BLOCKER");
      addCountAlert(
        alerts,
        "WORKER_REVIEW_REQUIRED",
        workerStatus.statusCounts.reviewRequired,
        "BLOCKER"
      );
    }

    const lag = Object.freeze({
      bridgeReceipt: bridgeFailure ? 0 : bridgeStatus.lag.receipt,
      bridgeClaimed: bridgeFailure ? 0 : bridgeStatus.lag.claimed,
      workerRunnable: workerFailure ? 0 : workerStatus.runnableScopeCount,
      workerRecoverable: workerFailure ? 0 : workerStatus.recoverableScopeCount,
    });
    addCountAlert(alerts, "BRIDGE_RECEIPT_LAG", lag.bridgeReceipt, "WARNING");
    addCountAlert(alerts, "BRIDGE_CLAIMED_LAG", lag.bridgeClaimed, "WARNING");
    addCountAlert(alerts, "WORKER_RUNNABLE_LAG", lag.workerRunnable, "WARNING");
    addCountAlert(alerts, "WORKER_RECOVERABLE_LAG", lag.workerRecoverable, "WARNING");

    const blockerCodes = Object.freeze(alerts
      .filter((item) => item.severity === "BLOCKER")
      .map((item) => item.code));
    return deepFreeze({
      enabled,
      killSwitch,
      runtimeOwner: owner || "UNASSIGNED",
      targetIdentity: targetIdentity
        ? Object.freeze({
          database: targetIdentity.database,
          environmentId: targetIdentity.environmentId,
        })
        : Object.freeze({ status: "UNASSIGNED" }),
      poolCapacity: Object.freeze({
        configured: configuredConnectionLimit,
        actual: actualPoolConnectionLimit,
        verified: poolCapacityVerified,
        consistent: poolCapacityConsistent,
      }),
      ownedModules: OWNED_MODULES,
      excludedModules: EXCLUDED_MODULES,
      coordination,
      bridge: bridgeStatus,
      worker: workerStatus,
      lag,
      alerts: Object.freeze(alerts),
      readiness: {
        ready: blockerCodes.length === 0,
        blockerCodes,
        reasonCode: blockerCodes.length === 0
          ? "V1_RUNTIME_ORCHESTRATOR_READY"
          : "V1_RUNTIME_ORCHESTRATOR_NOT_READY",
      },
    });
  }

  function inspect() {
    return inspectWithCoordination();
  }

  async function assertCoordinationHeld(lease) {
    let held = false;
    try { held = await lease.assertHeld(); } catch {}
    if (held !== true) {
      throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_COORDINATION_LOST");
    }
  }

  async function runPhase(lease, phase, operation, normalize) {
    await assertCoordinationHeld(lease);
    let result;
    try {
      result = normalize(await operation());
    } catch (error) {
      if (error && error.code === "V1_RUNTIME_ORCHESTRATOR_COORDINATION_LOST") throw error;
      const failure = orchestrationError("V1_RUNTIME_ORCHESTRATOR_PHASE_FAILED");
      failure.phase = phase;
      throw failure;
    }
    await assertCoordinationHeld(lease);
    return result;
  }

  async function runOneShot(input = {}) {
    const limits = normalizeOneShot(input);
    if (!enabled) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_DISABLED");
    if (killSwitch !== "DISENGAGED") {
      throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_KILL_SWITCH_ENGAGED");
    }
    if (!owner) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_NOT_READY");
    if (!targetIdentity) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_NOT_READY");
    if (!poolCapacityReady) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_NOT_READY");
    if (cycleInFlight) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_BUSY");
    cycleInFlight = true;
    const cycleId = crypto.randomUUID().replace(/-/g, "");
    let lease = null;
    let primaryFailure = null;
    let result = null;
    try {
      try {
        lease = await coordinator.tryAcquire({ runtimeOwner: owner, cycleId });
      } catch {
        throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_COORDINATION_FAILED");
      }
      if (lease === null) throw orchestrationError("V1_RUNTIME_ORCHESTRATOR_BUSY");
      if (!exactKeys(lease, LEASE_KEYS)
        || !sha256Digest(lease.coordinationDigest)
        || lease.coordinationScope !== COORDINATION_SCOPE
        || typeof lease.assertHeld !== "function"
        || typeof lease.release !== "function") throw coordinationError();

      await assertCoordinationHeld(lease);
      const preflight = await inspectWithCoordination({
        ready: true,
        lockState: "HELD",
        coordinationScope: COORDINATION_SCOPE,
      });
      await assertCoordinationHeld(lease);
      if (!preflight.readiness.ready) {
        const failure = orchestrationError("V1_RUNTIME_ORCHESTRATOR_NOT_READY");
        failure.blockerCodes = preflight.readiness.blockerCodes;
        throw failure;
      }

      const phases = deepFreeze({
        bridgeRecovery: await runPhase(
          lease,
          "BRIDGE_RECOVERY",
          () => bridge.recoverOnce({ limit: limits.recoveryLimit }),
          normalizeBridgeRecovery
        ),
        bridgeDispatch: await runPhase(
          lease,
          "BRIDGE_DISPATCH",
          () => bridge.runOnce({ limit: limits.bridgeLimit }),
          normalizeBridgeDispatch
        ),
        workerRecovery: await runPhase(
          lease,
          "WORKER_RECOVERY",
          () => worker.recoverOnce({ limit: limits.recoveryLimit }),
          normalizeWorkerRecovery
        ),
        workerExecution: await runPhase(
          lease,
          "WORKER_EXECUTION",
          () => worker.runOnce({ limit: limits.workerLimit }),
          normalizeWorkerExecution
        ),
      });

      await assertCoordinationHeld(lease);
      const postflight = await inspectWithCoordination({
        ready: true,
        lockState: "HELD",
        coordinationScope: COORDINATION_SCOPE,
      });
      await assertCoordinationHeld(lease);

      const cycleDeadLetterCount = phases.bridgeRecovery.deadLetteredCount
        + phases.bridgeDispatch.deadLetteredCount
        + phases.workerRecovery.deadLetterCount;
      const newWorkerTerminalCount = postflight.worker.status === "UNAVAILABLE"
        ? 0
        : Math.max(
          0,
          postflight.worker.statusCounts.deadLetter - preflight.worker.statusCounts.deadLetter
        ) + Math.max(
          0,
          postflight.worker.statusCounts.reviewRequired - preflight.worker.statusCounts.reviewRequired
        );
      if (cycleDeadLetterCount > 0
        || newWorkerTerminalCount > 0
        || !postflight.readiness.ready) {
        const failure = orchestrationError("V1_RUNTIME_ORCHESTRATOR_REVIEW_REQUIRED");
        failure.outcome = "REVIEW_REQUIRED";
        failure.cycleDeadLetterCount = cycleDeadLetterCount;
        failure.newWorkerTerminalCount = newWorkerTerminalCount;
        failure.blockerCodes = postflight.readiness.blockerCodes;
        throw failure;
      }

      result = deepFreeze({
        cycleId,
        runtimeOwner: owner,
        coordinationLeaseDigest: lease.coordinationDigest,
        coordinationScope: lease.coordinationScope,
        phases,
        postflight,
      });
    } catch (error) {
      primaryFailure = error && error.code
        ? error
        : orchestrationError("V1_RUNTIME_ORCHESTRATOR_PHASE_FAILED");
    }

    let releaseFailure = false;
    if (lease) {
      try { await lease.release(); } catch { releaseFailure = true; }
    }
    cycleInFlight = false;
    if (releaseFailure) {
      const failure = orchestrationError("V1_RUNTIME_ORCHESTRATOR_COORDINATION_RELEASE_FAILED");
      if (primaryFailure) failure.precedingFailureCode = primaryFailure.code;
      throw failure;
    }
    if (primaryFailure) throw primaryFailure;
    return result;
  }

  return Object.freeze({ inspect, runOneShot });
}

function createV1RuntimeOrchestrationFoundation(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !PRODUCTION_OPTION_KEYS.includes(key))
    || !options.pool || typeof options.pool.getConnection !== "function") throw configurationError();
  const env = options.env === undefined
    ? Object.freeze({ ...process.env })
    : normalizeEnvironment(options.env);
  const owner = runtimeOwner(env) || "runtime-owner-unassigned";
  const targetIdentity = runtimeTargetIdentity(env);
  const targetBoundPool = targetIdentity
    ? createTargetBoundMysqlPool(options.pool, targetIdentity.database)
    : Object.freeze({ async getConnection() { throw targetAuthorityError(); } });
  let bridge;
  let worker;
  let coordinator;
  try {
    bridge = createMysqlOutboxToInboxBridgeHarness({
      pool: targetBoundPool,
      env,
      workerId: `${owner}:bridge`,
    });
    worker = createMysqlInboxWorkerHarness({
      pool: targetBoundPool,
      env,
      workerId: `${owner}:worker`,
    });
    coordinator = targetIdentity
      ? createMysqlNamedLockCoordinator(targetBoundPool, targetIdentity.database)
      : Object.freeze({
        async inspect() { throw coordinationError(); },
        async tryAcquire() { throw coordinationError(); },
      });
  } catch {
    throw configurationError();
  }
  return createRuntimeOrchestrationCore({
    env,
    adapters: { bridge, worker, coordinator },
    actualConnectionLimit: mysqlPoolConnectionLimit(options.pool),
  });
}

module.exports = {
  createV1RuntimeOrchestrationFoundation,
};
