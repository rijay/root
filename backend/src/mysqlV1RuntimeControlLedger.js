const crypto = require("node:crypto");
const {
  readMysqlProcedureResultRow,
  readMysqlProcedureResultRows,
} = require("./mysqlProcedureResult");

const MYSQL_SESSION_TIME_ZONE = "+00:00";
const MYSQL_POOL_TIME_ZONE = "+08:00";
const CONNECTION_ACQUIRE_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_MAXIMUM_AGE_SECONDS = 900;
const MAXIMUM_AGE_SECONDS = 86400;
const MAXIMUM_LEASE_SECONDS = 3600;
const MAXIMUM_RECOVERY_LIMIT = 100;

const TERMINAL_STATUSES = Object.freeze([
  "SUCCEEDED",
  "SKIPPED_BUSY",
  "FAILED_PRECONDITION",
  "REVIEW_REQUIRED",
]);
const SEVERITIES = Object.freeze(["BLOCKER", "WARNING"]);

const ERROR_CODES = Object.freeze({
  CONFIGURATION: "V1_RUNTIME_LEDGER_CONFIGURATION_INVALID",
  INPUT: "V1_RUNTIME_LEDGER_INPUT_INVALID",
  TARGET: "V1_RUNTIME_LEDGER_TARGET_DATABASE_MISMATCH",
  PERSISTENCE: "V1_RUNTIME_LEDGER_PERSISTENCE_FAILED",
  CONFLICT: "V1_RUNTIME_LEDGER_CONFLICT",
  FENCED: "V1_RUNTIME_LEDGER_LEASE_FENCED",
  ACK_UNKNOWN: "V1_RUNTIME_LEDGER_COMMIT_OUTCOME_UNKNOWN",
});

const SELECT_DATABASE_SQL = "SELECT DATABASE() AS database_name";
const SELECT_CONNECTION_AUTHORITY_SQL = `
  SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account
`;
const SET_TIME_ZONE_SQL = "SET time_zone = ?";
const SELECT_TIME_ZONE_SQL = "SELECT @@session.time_zone AS session_time_zone";
const PROCEDURES = Object.freeze({
  READ_CYCLE_BY_SCHEDULE: "v1_runtime_control_ledger_read_cycle_by_schedule",
  READ_CYCLE_BY_ID: "v1_runtime_control_ledger_read_cycle_by_id",
  READ_ALERT: "v1_runtime_control_ledger_read_alert",
  CLAIM_CYCLE: "v1_runtime_control_ledger_claim_cycle",
  RENEW_CYCLE: "v1_runtime_control_ledger_renew_cycle",
  FINALIZE_CYCLE: "v1_runtime_control_ledger_finalize_cycle",
  PREPARE_ALERT: "v1_runtime_control_ledger_prepare_alert",
  LOCK_STALE: "v1_runtime_control_ledger_lock_stale_cycles",
  RECOVER_STALE: "v1_runtime_control_ledger_recover_stale_cycle_prepare_alert",
  INSPECT: "v1_runtime_control_ledger_inspect_snapshot",
});

function procedureSql(tag, name, parameterCount) {
  return `/* v1_runtime_ledger:${tag} */ CALL ${name}(${Array(parameterCount).fill("?").join(", ")})`;
}

const READ_CYCLE_BY_SCHEDULE_SQL = procedureSql(
  "read_cycle_by_schedule_procedure", PROCEDURES.READ_CYCLE_BY_SCHEDULE, 2
);
const READ_CYCLE_BY_ID_SQL = procedureSql(
  "read_cycle_by_id_procedure", PROCEDURES.READ_CYCLE_BY_ID, 2
);
const READ_ALERT_SQL = procedureSql("read_alert_procedure", PROCEDURES.READ_ALERT, 3);
const CLAIM_CYCLE_SQL = procedureSql("claim_cycle_procedure", PROCEDURES.CLAIM_CYCLE, 8);
const RENEW_CYCLE_SQL = procedureSql("renew_cycle_procedure", PROCEDURES.RENEW_CYCLE, 5);
const FINALIZE_CYCLE_SQL = procedureSql("finalize_cycle_procedure", PROCEDURES.FINALIZE_CYCLE, 9);
const PREPARE_ALERT_SQL = procedureSql("prepare_alert_procedure", PROCEDURES.PREPARE_ALERT, 6);
const LOCK_STALE_CYCLES_SQL = procedureSql("lock_stale_procedure", PROCEDURES.LOCK_STALE, 2);
const RECOVER_STALE_CYCLE_SQL = procedureSql(
  "recover_stale_procedure", PROCEDURES.RECOVER_STALE, 7
);
const INSPECT_SQL = procedureSql("inspect_procedure", PROCEDURES.INSPECT, 1);

function ledgerError(code) {
  const error = new Error("V1 runtime control ledger operation failed");
  error.name = "V1RuntimeControlLedgerError";
  error.code = code;
  error.isV1RuntimeControlLedgerError = true;
  return error;
}

function configurationError() { return ledgerError(ERROR_CODES.CONFIGURATION); }
function inputError() { return ledgerError(ERROR_CODES.INPUT); }
function targetError() { return ledgerError(ERROR_CODES.TARGET); }
function persistenceError() { return ledgerError(ERROR_CODES.PERSISTENCE); }
function conflictError() { return ledgerError(ERROR_CODES.CONFLICT); }
function fencedError() { return ledgerError(ERROR_CODES.FENCED); }
function acknowledgementUnknownError() { return ledgerError(ERROR_CODES.ACK_UNKNOWN); }

function normalizedProcedureError(error) {
  if (error && error.isV1RuntimeControlLedgerError) return error;
  const stable = String(error && (error.sqlMessage || error.message) || "");
  if (stable.includes("V1_RUNTIME_LEDGER_CONFLICT")) return conflictError();
  if (stable.includes("V1_RUNTIME_LEDGER_LEASE_FENCED")) return fencedError();
  if (stable.includes("V1_RUNTIME_LEDGER_INPUT_INVALID")) return inputError();
  return persistenceError();
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return plainRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function opaqueAscii(value, maximumLength) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && /^[\x21-\x7e]+$/.test(value);
}

function databaseName(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 64
    && /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/.test(value);
}

function currentUser(value) {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 288
    && value.includes("@")
    && /^[\x21-\x7e]+$/.test(value);
}

function digest(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function stableCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}
function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isoInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw inputError();
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw inputError();
  return value;
}

function mysqlInstant(value) { return isoInstant(value).replace("T", " ").replace("Z", ""); }

function publicInstant(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const time = Date.parse(normalized);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  throw persistenceError();
}

function nonnegativeInteger(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw persistenceError();
  return normalized;
}

function positiveInteger(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw persistenceError();
  return normalized;
}

function hash(namespace, ...values) {
  const hasher = crypto.createHash("sha256").update(namespace, "utf8");
  for (const value of values) hasher.update("\0", "utf8").update(String(value), "utf8");
  return hasher.digest("hex");
}

function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw persistenceError();
  return rows;
}

function procedureRows(result) {
  if (!Array.isArray(result) || result.length !== 2) throw persistenceError();
  try {
    return readMysqlProcedureResultRows(result[0]);
  } catch {
    throw persistenceError();
  }
}

function procedureRow(result, optional = false) {
  const rows = procedureRows(result);
  if (rows.length === 1) return rows[0];
  if (optional && rows.length === 0) return null;
  throw persistenceError();
}

function mutationProcedureRow(result) {
  if (!Array.isArray(result) || result.length !== 2) throw persistenceError();
  try {
    return readMysqlProcedureResultRow(result[0]);
  } catch {
    throw persistenceError();
  }
}

function singleRow(result, optional = false) {
  const rows = selectedRows(result);
  if ((optional && rows.length > 1) || (!optional && rows.length !== 1)) throw persistenceError();
  return rows[0] || null;
}

function freezeCycle(row) {
  if (!plainRecord(row)
    || !digest(row.runtime_cycle_id)
    || !opaqueAscii(row.environment_id, 96)
    || !opaqueAscii(row.schedule_id, 128)
    || !digest(row.input_digest)
    || !["RUNNING", ...TERMINAL_STATUSES].includes(row.status)
    || !digest(row.claim_digest)) throw persistenceError();
  const leaseGeneration = positiveInteger(row.lease_generation);
  const blockerCount = nonnegativeInteger(row.blocker_count);
  const terminal = row.status !== "RUNNING";
  if (terminal !== (row.completed_at !== null && row.completed_at !== undefined)
    || (terminal && (!digest(row.finalization_digest) || !digest(row.result_digest)))
    || (!terminal && (row.finalization_digest !== null || row.result_digest !== null))
    || (row.error_code !== null && !stableCode(row.error_code))
    || (!terminal && (!opaqueAscii(row.lease_owner, 128)
      || row.lease_expires_at === null || blockerCount !== 0 || row.error_code !== null))
    || (terminal && (row.lease_owner !== null || row.lease_expires_at !== null))
    || (row.status === "SUCCEEDED" && (blockerCount !== 0 || row.error_code !== null))
    || (row.status === "SKIPPED_BUSY" && (blockerCount !== 0 || row.error_code === null))
    || (["FAILED_PRECONDITION", "REVIEW_REQUIRED"].includes(row.status)
      && (blockerCount < 1 || row.error_code === null))) {
    throw persistenceError();
  }
  return Object.freeze({
    cycleId: row.runtime_cycle_id,
    environmentId: row.environment_id,
    scheduleId: row.schedule_id,
    scheduledAt: publicInstant(row.scheduled_at),
    inputDigest: row.input_digest,
    status: row.status,
    leaseOwner: row.lease_owner === null ? null : row.lease_owner,
    leaseExpiresAt: publicInstant(row.lease_expires_at),
    leaseGeneration,
    claimedAt: publicInstant(row.claimed_at),
    completedAt: publicInstant(row.completed_at),
    resultDigest: row.result_digest === null ? null : row.result_digest,
    blockerCount,
    errorCode: row.error_code === null ? null : row.error_code,
  });
}

function freezeClaim(outcome, cycle) {
  return Object.freeze({ outcome, ...cycle });
}

function freezeAlert(row, outcome) {
  if (!plainRecord(row)
    || !digest(row.runtime_alert_id)
    || !digest(row.runtime_cycle_id)
    || !opaqueAscii(row.environment_id, 96)
    || !opaqueAscii(row.schedule_id, 128)
    || !digest(row.input_digest)
    || !stableCode(row.alert_code)
    || !SEVERITIES.includes(row.severity)) throw persistenceError();
  return Object.freeze({
    outcome,
    alertId: row.runtime_alert_id,
    cycleId: row.runtime_cycle_id,
    environmentId: row.environment_id,
    scheduleId: row.schedule_id,
    inputDigest: row.input_digest,
    alertCode: row.alert_code,
    severity: row.severity,
    observedAt: publicInstant(row.observed_at),
  });
}

function exactCycleIdentity(cycle, expected) {
  return cycle.cycleId === expected.cycleId
    && cycle.environmentId === expected.environmentId
    && cycle.scheduleId === expected.scheduleId
    && cycle.scheduledAt === expected.scheduledAt
    && cycle.inputDigest === expected.inputDigest;
}

function exactFinalization(cycle, expected) {
  return cycle.status === expected.status
    && cycle.resultDigest === expected.resultDigest
    && cycle.blockerCount === expected.blockerCount
    && cycle.errorCode === expected.errorCode;
}

function assertConnection(connection) {
  if (!connection
    || typeof connection.execute !== "function"
    || typeof connection.beginTransaction !== "function"
    || typeof connection.commit !== "function"
    || typeof connection.rollback !== "function"
    || typeof connection.release !== "function"
    || typeof connection.destroy !== "function") throw configurationError();
  return connection;
}

function createMysqlV1RuntimeControlLedger(options) {
  const allowedOptionKeys = new Set([
    "pool", "heartbeatPool", "inspectorPool", "env", "runtimeAlertDelivery",
    "registrarCurrentUser", "inspectorCurrentUser",
  ]);
  const optionShapeValid = plainRecord(options)
    && Object.prototype.hasOwnProperty.call(options, "pool")
    && Object.prototype.hasOwnProperty.call(options, "env")
    && Object.keys(options).every((key) => allowedOptionKeys.has(key));
  if (!optionShapeValid || !objectRecord(options.env)
    || !options.pool || typeof options.pool.getConnection !== "function"
    || (options.heartbeatPool && typeof options.heartbeatPool.getConnection !== "function")
    || (options.inspectorPool && typeof options.inspectorPool.getConnection !== "function")
    || ((options.registrarCurrentUser === undefined) !== (options.inspectorCurrentUser === undefined))
    || (options.registrarCurrentUser !== undefined
      && (!currentUser(options.registrarCurrentUser)
        || !currentUser(options.inspectorCurrentUser)
        || options.registrarCurrentUser === options.inspectorCurrentUser))
    || (options.runtimeAlertDelivery
      && (typeof options.runtimeAlertDelivery.registerAlertInTransaction !== "function"
        || typeof options.runtimeAlertDelivery.registrationRequired !== "boolean"))) {
    throw configurationError();
  }
  const { pool, env } = options;
  const heartbeatPool = options.heartbeatPool || pool;
  const inspectorPool = options.inspectorPool || pool;
  const registrarCurrentUser = options.registrarCurrentUser || null;
  const inspectorCurrentUser = options.inspectorCurrentUser || null;
  const runtimeAlertDelivery = options.runtimeAlertDelivery || Object.freeze({
    registrationRequired: false,
    async registerAlertInTransaction() {
      return Object.freeze({ outcome: "DISABLED" });
    },
  });
  const configuredDatabase = env.MYSQL_DATABASE;
  const environmentId = env.MYROOT_V1_RUNTIME_ENVIRONMENT_ID;
  if (!databaseName(configuredDatabase) || !opaqueAscii(environmentId, 96)) {
    throw configurationError();
  }

  async function retire(connection, destroy) {
    if (!connection) return;
    if (!destroy) {
      try {
        await connection.execute(SET_TIME_ZONE_SQL, [MYSQL_POOL_TIME_ZONE]);
        const restored = singleRow(await connection.execute(SELECT_TIME_ZONE_SQL));
        if (!plainRecord(restored) || restored.session_time_zone !== MYSQL_POOL_TIME_ZONE) {
          destroy = true;
        }
      } catch {
        destroy = true;
      }
    }
    try { if (destroy) connection.destroy(); else connection.release(); } catch {}
  }

  async function acquireBeforeDeadline(targetPool) {
    let timeout;
    let expired = false;
    const pending = Promise.resolve().then(() => targetPool.getConnection());
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        expired = true;
        reject(persistenceError());
      }, CONNECTION_ACQUIRE_TIMEOUT_MILLISECONDS);
    });
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      if (expired) {
        // mysql2 cannot cancel a queued acquisition. If capacity returns after
        // the caller has failed closed, destroy that late connection so it is
        // neither leaked nor silently returned with unknown session state.
        pending.then((lateConnection) => {
          try {
            if (lateConnection && typeof lateConnection.destroy === "function") {
              lateConnection.destroy();
            }
          } catch {}
        }).catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function acquire(targetPool = pool, expectedCurrentUser = registrarCurrentUser) {
    let connection;
    try {
      connection = assertConnection(await acquireBeforeDeadline(targetPool));
      const authority = singleRow(await connection.execute(
        expectedCurrentUser ? SELECT_CONNECTION_AUTHORITY_SQL : SELECT_DATABASE_SQL
      ));
      if (!plainRecord(authority)
        || authority.database_name !== configuredDatabase
        || !databaseName(authority.database_name)
        || (expectedCurrentUser && authority.authenticated_account !== expectedCurrentUser)) {
        throw targetError();
      }
      await connection.execute(SET_TIME_ZONE_SQL, [MYSQL_SESSION_TIME_ZONE]);
      return connection;
    } catch (error) {
      if (connection) await retire(connection, true);
      if (error && error.isV1RuntimeControlLedgerError) throw error;
      throw persistenceError();
    }
  }

  async function readCycleFreshBySchedule(scheduleId) {
    const connection = await acquire();
    let destroy = false;
    try {
      const row = procedureRow(await connection.execute(
        READ_CYCLE_BY_SCHEDULE_SQL,
        [environmentId, scheduleId]
      ), true);
      if (!row) return null;
      const cycle = freezeCycle(row);
      if (cycle.environmentId !== environmentId || cycle.scheduleId !== scheduleId) {
        throw persistenceError();
      }
      return { row, cycle };
    } catch (error) {
      destroy = true;
      throw normalizedProcedureError(error);
    } finally { await retire(connection, destroy); }
  }

  async function readCycleFreshById(cycleId) {
    const connection = await acquire();
    let destroy = false;
    try {
      const row = procedureRow(await connection.execute(
        READ_CYCLE_BY_ID_SQL,
        [environmentId, cycleId]
      ), true);
      if (!row) return null;
      const cycle = freezeCycle(row);
      if (cycle.environmentId !== environmentId || cycle.cycleId !== cycleId) {
        throw persistenceError();
      }
      return { row, cycle };
    } catch (error) {
      destroy = true;
      throw normalizedProcedureError(error);
    } finally { await retire(connection, destroy); }
  }

  async function readAlertFresh(cycleId, dedupeDigest) {
    const connection = await acquire();
    let destroy = false;
    try {
      const row = procedureRow(await connection.execute(
        READ_ALERT_SQL,
        [environmentId, cycleId, dedupeDigest]
      ), true);
      return row;
    } catch (error) {
      destroy = true;
      throw normalizedProcedureError(error);
    } finally { await retire(connection, destroy); }
  }

  async function claimCycle(input = {}) {
    if (!exactKeys(input, [
      "scheduleId", "scheduledAt", "inputDigest", "leaseOwner", "leaseSeconds",
    ])
      || !opaqueAscii(input.scheduleId, 128)
      || !digest(input.inputDigest)
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseSeconds, 1, MAXIMUM_LEASE_SECONDS)) throw inputError();
    const scheduledAt = isoInstant(input.scheduledAt);
    const expected = Object.freeze({
      cycleId: hash("myroot:v1:runtime-cycle:v1", environmentId, input.scheduleId),
      environmentId,
      scheduleId: input.scheduleId,
      scheduledAt,
      inputDigest: input.inputDigest,
    });
    const claimDigest = hash(
      "myroot:v1:runtime-claim:v1",
      expected.cycleId,
      scheduledAt,
      input.inputDigest,
      input.leaseOwner,
      input.leaseSeconds
    );
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      const persistedRow = mutationProcedureRow(await connection.execute(CLAIM_CYCLE_SQL, [
        environmentId,
        expected.cycleId,
        input.scheduleId,
        mysqlInstant(scheduledAt),
        input.inputDigest,
        input.leaseOwner,
        input.leaseSeconds,
        claimDigest,
      ]));
      const outcome = persistedRow.operation_outcome;
      if (!['CLAIMED', 'REPLAY'].includes(outcome)) throw persistenceError();
      const persisted = freezeCycle(persistedRow);
      if (!exactCycleIdentity(persisted, expected)) throw conflictError();
      if (outcome === "CLAIMED"
        && (persisted.status !== "RUNNING"
          || persisted.leaseOwner !== input.leaseOwner
          || persisted.leaseGeneration !== 1
          || persistedRow.claim_digest !== claimDigest)) throw persistenceError();
      expectedResult = freezeClaim(outcome, persisted);
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expectedResult;
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) {
        try {
          const fresh = await readCycleFreshBySchedule(input.scheduleId);
          if (fresh && exactCycleIdentity(fresh.cycle, expected)) {
            if (expectedResult.outcome === "REPLAY") return freezeClaim("REPLAY", fresh.cycle);
            if (fresh.row.claim_digest === claimDigest
              && fresh.cycle.status === "RUNNING"
              && fresh.cycle.leaseOwner === input.leaseOwner
              && fresh.cycle.leaseGeneration === 1) return freezeClaim("CLAIMED", fresh.cycle);
          }
        } catch {}
        throw acknowledgementUnknownError();
      }
      if (error && error.code === "ER_DUP_ENTRY") {
        try {
          const fresh = await readCycleFreshBySchedule(input.scheduleId);
          if (fresh && exactCycleIdentity(fresh.cycle, expected)) return freezeClaim("REPLAY", fresh.cycle);
        } catch (readError) {
          if (readError && readError.isV1RuntimeControlLedgerError) throw readError;
        }
        throw conflictError();
      }
      throw normalizedProcedureError(error);
    }
  }

  async function renewCycle(input = {}) {
    if (!exactKeys(input, [
      "cycleId", "leaseOwner", "leaseGeneration", "leaseSeconds",
    ])
      || !digest(input.cycleId)
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseGeneration, 1, Number.MAX_SAFE_INTEGER - 1)
      || !boundedInteger(input.leaseSeconds, 1, MAXIMUM_LEASE_SECONDS)) throw inputError();
    const expectedGeneration = input.leaseGeneration + 1;
    const connection = await acquire(heartbeatPool);
    let began = false;
    let commitAttempted = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      const row = procedureRow(await connection.execute(
        READ_CYCLE_BY_ID_SQL,
        [environmentId, input.cycleId]
      ), true);
      if (!row) throw conflictError();
      const current = freezeCycle(row);
      const dbNow = publicInstant(row.db_now);
      if (current.status !== "RUNNING"
        || current.leaseOwner !== input.leaseOwner
        || current.leaseGeneration !== input.leaseGeneration
        || current.leaseExpiresAt <= dbNow) throw fencedError();
      const renewedRow = mutationProcedureRow(await connection.execute(RENEW_CYCLE_SQL, [
        environmentId,
        input.cycleId,
        input.leaseOwner,
        input.leaseGeneration,
        input.leaseSeconds,
      ]));
      if (renewedRow.operation_outcome !== "RENEWED") throw persistenceError();
      expectedResult = freezeCycle(renewedRow);
      const renewedDbNow = publicInstant(renewedRow.db_now);
      if (expectedResult.status !== "RUNNING"
        || expectedResult.leaseOwner !== input.leaseOwner
        || expectedResult.leaseGeneration !== expectedGeneration
        || expectedResult.leaseExpiresAt <= renewedDbNow) throw persistenceError();
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expectedResult;
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) {
        try {
          const fresh = await readCycleFreshById(input.cycleId);
          if (fresh
            && fresh.cycle.status === "RUNNING"
            && fresh.cycle.leaseOwner === input.leaseOwner
            && fresh.cycle.leaseGeneration === expectedGeneration
            && fresh.cycle.leaseExpiresAt > publicInstant(fresh.row.db_now)) {
            return fresh.cycle;
          }
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw normalizedProcedureError(error);
    }
  }

  async function finalizeCycle(input = {}) {
    if (!exactKeys(input, [
      "cycleId", "leaseOwner", "leaseGeneration", "status",
      "resultDigest", "blockerCount", "errorCode",
    ])
      || !digest(input.cycleId)
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseGeneration, 1, Number.MAX_SAFE_INTEGER)
      || !TERMINAL_STATUSES.includes(input.status)
      || !digest(input.resultDigest)
      || !boundedInteger(input.blockerCount, 0, Number.MAX_SAFE_INTEGER)
      || !(input.errorCode === null || stableCode(input.errorCode))
      || (input.status === "SUCCEEDED" && (input.blockerCount !== 0 || input.errorCode !== null))
      || (input.status === "SKIPPED_BUSY" && (input.blockerCount !== 0 || input.errorCode === null))
      || (["FAILED_PRECONDITION", "REVIEW_REQUIRED"].includes(input.status)
        && (input.blockerCount < 1 || input.errorCode === null))) throw inputError();
    const finalizationDigest = hash(
      "myroot:v1:runtime-finalization:v1",
      input.cycleId,
      input.leaseGeneration,
      input.status,
      input.resultDigest,
      input.blockerCount,
      input.errorCode === null ? "NULL" : input.errorCode
    );
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      const row = procedureRow(await connection.execute(
        READ_CYCLE_BY_ID_SQL,
        [environmentId, input.cycleId]
      ), true);
      if (!row) throw conflictError();
      const current = freezeCycle(row);
      if (current.status !== "RUNNING") {
        if (row.finalization_digest !== finalizationDigest
          || !exactFinalization(current, input)) throw conflictError();
        expectedResult = current;
      } else {
        const dbNow = publicInstant(row.db_now);
        if (current.leaseOwner !== input.leaseOwner
          || current.leaseGeneration !== input.leaseGeneration
          || current.leaseExpiresAt <= dbNow) throw fencedError();
        const completedRow = mutationProcedureRow(await connection.execute(FINALIZE_CYCLE_SQL, [
          environmentId,
          input.cycleId,
          input.leaseOwner,
          input.leaseGeneration,
          input.status,
          finalizationDigest,
          input.resultDigest,
          input.blockerCount,
          input.errorCode,
        ]));
        if (completedRow.operation_outcome !== "FINALIZED") throw persistenceError();
        expectedResult = freezeCycle(completedRow);
        if (completedRow.finalization_digest !== finalizationDigest
          || !exactFinalization(expectedResult, input)) throw persistenceError();
      }
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expectedResult;
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) {
        try {
          const fresh = await readCycleFreshById(input.cycleId);
          if (fresh && fresh.row.finalization_digest === finalizationDigest
            && exactFinalization(fresh.cycle, input)) return fresh.cycle;
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw normalizedProcedureError(error);
    }
  }

  async function recordAlert(input = {}) {
    if (!exactKeys(input, ["cycleId", "alertCode", "severity"])
      || !digest(input.cycleId)
      || !stableCode(input.alertCode)
      || !SEVERITIES.includes(input.severity)) throw inputError();
    const dedupeDigest = hash(
      "myroot:v1:runtime-alert:v1",
      input.cycleId,
      input.alertCode,
      input.severity
    );
    const alertId = hash("myroot:v1:runtime-alert-id:v1", input.cycleId, dedupeDigest);
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expectedResult;
    try {
      await connection.beginTransaction();
      began = true;
      const persistedAlert = mutationProcedureRow(await connection.execute(
        PREPARE_ALERT_SQL,
        [
          environmentId,
          alertId,
          input.cycleId,
          input.alertCode,
          input.severity,
          dedupeDigest,
        ]
      ));
      if (!["RECORDED", "REPLAY"].includes(persistedAlert.operation_outcome)) {
        throw persistenceError();
      }
      expectedResult = freezeAlert(persistedAlert, persistedAlert.operation_outcome);
      if (expectedResult.alertId !== alertId
        || expectedResult.cycleId !== input.cycleId
        || expectedResult.environmentId !== environmentId
        || persistedAlert.dedupe_digest !== dedupeDigest
        || expectedResult.alertCode !== input.alertCode
        || expectedResult.severity !== input.severity) throw conflictError();
      await runtimeAlertDelivery.registerAlertInTransaction(connection, {
        runtimeAlertId: expectedResult.alertId,
        environmentId: expectedResult.environmentId,
        alertCode: expectedResult.alertCode,
        severity: expectedResult.severity,
        observedAt: expectedResult.observedAt,
      });
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expectedResult;
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) {
        if (runtimeAlertDelivery.registrationRequired) {
          // Alert and delivery request share one transaction, so neither can
          // be silently lost. An unavailable commit acknowledgement is
          // deliberately replayed by the caller instead of inferred from the
          // alert row alone.
          throw acknowledgementUnknownError();
        }
        try {
          const fresh = await readAlertFresh(input.cycleId, dedupeDigest);
          if (fresh) {
            const alert = freezeAlert(fresh, expectedResult.outcome);
            if (alert.alertId === alertId
              && alert.alertCode === input.alertCode
              && alert.severity === input.severity) return alert;
          }
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw normalizedProcedureError(error);
    }
  }

  async function recoverStale(input = {}) {
    if (!exactKeys(input, ["limit"])
      || !boundedInteger(input.limit, 1, MAXIMUM_RECOVERY_LIMIT)) throw inputError();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expected;
    let expectedReconciliations = [];
    try {
      await connection.beginTransaction();
      began = true;
      const rows = procedureRows(await connection.execute(
        LOCK_STALE_CYCLES_SQL,
        [environmentId, input.limit]
      ));
      if (rows.length > input.limit) throw persistenceError();
      const reconciliations = [];
      for (const row of rows) {
        const cycle = freezeCycle(row);
        const nextGeneration = cycle.leaseGeneration + 1;
        const errorCode = "V1_RUNTIME_CYCLE_STALE";
        const resultDigest = hash(
          "myroot:v1:runtime-stale-result:v1",
          cycle.cycleId,
          nextGeneration
        );
        const finalizationDigest = hash(
          "myroot:v1:runtime-finalization:v1",
          cycle.cycleId,
          nextGeneration,
          "REVIEW_REQUIRED",
          resultDigest,
          1,
          errorCode
        );
        const dedupeDigest = hash(
          "myroot:v1:runtime-alert:v1",
          cycle.cycleId,
          errorCode,
          "BLOCKER"
        );
        const alertId = hash("myroot:v1:runtime-alert-id:v1", cycle.cycleId, dedupeDigest);
        const recoveredRow = mutationProcedureRow(await connection.execute(
          RECOVER_STALE_CYCLE_SQL,
          [
          environmentId,
          cycle.cycleId,
          cycle.leaseGeneration,
          finalizationDigest,
          resultDigest,
          alertId,
          dedupeDigest,
          ]
        ));
        if (!["RECORDED", "REPLAY"].includes(recoveredRow.operation_outcome)) {
          throw persistenceError();
        }
        const publicAlert = freezeAlert(recoveredRow, recoveredRow.operation_outcome);
        if (publicAlert.alertId !== alertId
          || publicAlert.cycleId !== cycle.cycleId
          || publicAlert.environmentId !== cycle.environmentId
          || publicAlert.scheduleId !== cycle.scheduleId
          || publicAlert.inputDigest !== cycle.inputDigest
          || publicAlert.alertCode !== errorCode
          || publicAlert.severity !== "BLOCKER"
          || recoveredRow.status !== "REVIEW_REQUIRED"
          || positiveInteger(recoveredRow.lease_generation) !== nextGeneration
          || recoveredRow.finalization_digest !== finalizationDigest
          || recoveredRow.result_digest !== resultDigest) throw conflictError();
        await runtimeAlertDelivery.registerAlertInTransaction(connection, {
          runtimeAlertId: publicAlert.alertId,
          environmentId: publicAlert.environmentId,
          alertCode: publicAlert.alertCode,
          severity: publicAlert.severity,
          observedAt: publicAlert.observedAt,
        });
        reconciliations.push(Object.freeze({
          cycleId: cycle.cycleId,
          finalizationDigest,
          resultDigest,
          leaseGeneration: nextGeneration,
          dedupeDigest,
          alertId,
        }));
      }
      expected = Object.freeze({
        environmentId,
        reviewRequiredCount: reconciliations.length,
        cycleIds: Object.freeze(reconciliations.map((item) => item.cycleId)),
        alertCount: reconciliations.length,
      });
      expectedReconciliations = reconciliations;
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expected;
    } catch (error) {
      if (!commitAttempted && began) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) {
        if (runtimeAlertDelivery.registrationRequired) {
          throw acknowledgementUnknownError();
        }
        try {
          let alertCount = 0;
          for (const item of expectedReconciliations) {
            const expectedCycle = item.cycleId;
            const reconciliation = await readCycleFreshById(expectedCycle);
            if (!reconciliation
              || reconciliation.cycle.status !== "REVIEW_REQUIRED"
              || reconciliation.cycle.leaseGeneration !== item.leaseGeneration
              || reconciliation.row.finalization_digest !== item.finalizationDigest
              || reconciliation.cycle.resultDigest !== item.resultDigest) {
              throw acknowledgementUnknownError();
            }
            const alert = await readAlertFresh(expectedCycle, item.dedupeDigest);
            if (!alert || alert.runtime_alert_id !== item.alertId) {
              throw acknowledgementUnknownError();
            }
            alertCount += 1;
          }
          return Object.freeze({ ...expected, alertCount });
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw normalizedProcedureError(error);
    }
  }

  async function inspect(input = {}) {
    if (!(exactKeys(input, []) || exactKeys(input, ["maximumAgeSeconds"]))) throw inputError();
    const maximumAgeSeconds = input.maximumAgeSeconds === undefined
      ? DEFAULT_MAXIMUM_AGE_SECONDS
      : input.maximumAgeSeconds;
    if (!boundedInteger(maximumAgeSeconds, 1, MAXIMUM_AGE_SECONDS)) throw inputError();
    const connection = await acquire(inspectorPool, inspectorCurrentUser);
    let destroy = false;
    try {
      const row = mutationProcedureRow(await connection.execute(INSPECT_SQL, [environmentId]));
      const inspectedAt = publicInstant(row.db_now);
      const blockerCount = nonnegativeInteger(row.blocker_count);
      const warningCount = nonnegativeInteger(row.warning_count);
      const totalCount = nonnegativeInteger(row.total_count);
      const reviewRequiredCount = nonnegativeInteger(row.review_required_count);
      if (totalCount !== blockerCount + warningCount) throw persistenceError();
      const latestSafeCycleId = row.latest_safe_cycle_id === null
        ? null : row.latest_safe_cycle_id;
      const latestSafeCompletedAt = publicInstant(row.latest_safe_completed_at);
      const latestTerminalCycleId = row.latest_terminal_cycle_id === null
        ? null : row.latest_terminal_cycle_id;
      const latestTerminalStatus = row.latest_terminal_status === null
        ? null : row.latest_terminal_status;
      const latestTerminalCompletedAt = publicInstant(row.latest_terminal_completed_at);
      if ((latestSafeCycleId !== null && !digest(latestSafeCycleId))
        || (latestTerminalCycleId !== null && !digest(latestTerminalCycleId))
        || (latestTerminalStatus !== null && !TERMINAL_STATUSES.includes(latestTerminalStatus))) {
        throw persistenceError();
      }
      const ageSeconds = latestSafeCycleId
        ? Math.max(0, Math.floor((Date.parse(inspectedAt) - Date.parse(latestSafeCompletedAt)) / 1000))
        : null;
      let state = "SAFE";
      if (blockerCount > 0 || reviewRequiredCount > 0
        || (latestTerminalStatus && ["FAILED_PRECONDITION", "REVIEW_REQUIRED"].includes(
          latestTerminalStatus
        ))) state = "BLOCKED";
      else if (!latestSafeCycleId) state = "MISSING";
      else if (ageSeconds > maximumAgeSeconds) state = "STALE";
      else if (latestTerminalStatus === "SKIPPED_BUSY") state = "BUSY";
      else if (warningCount > 0) state = "WARNING";
      const result = Object.freeze({
        environmentId,
        databaseName: configuredDatabase,
        inspectedAt,
        maximumAgeSeconds,
        attestation: Object.freeze({
          state,
          cycleId: latestSafeCycleId,
          completedAt: latestSafeCompletedAt,
          ageSeconds,
          latestTerminalCycleId,
          latestTerminalStatus,
          latestTerminalCompletedAt,
        }),
        openAlerts: Object.freeze({
          totalCount,
          blockerCount,
          warningCount,
          latestObservedAt: publicInstant(row.latest_observed_at),
        }),
        reviewRequiredCount,
      });
      return result;
    } catch (error) {
      destroy = true;
      throw normalizedProcedureError(error);
    } finally { await retire(connection, destroy); }
  }

  return Object.freeze({
    inspect,
    claimCycle,
    renewCycle,
    finalizeCycle,
    recordAlert,
    recoverStale,
  });
}

module.exports = { createMysqlV1RuntimeControlLedger };
