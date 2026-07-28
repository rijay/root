const crypto = require("node:crypto");

const { getDefaultInboxHandlerRegistry } = require("./inboxHandlerRegistry");
const { createMysqlInboxCheckpoint } = require("./mysqlInboxCheckpoint");
const {
  WORKER_MODES,
  RUNTIME_EVENT_SCOPES,
  assertRuntimeEventScopeRegistration,
  scopeIdentity,
} = require("./runtimeEventScopeCatalog");

const MYSQL_SESSION_TIME_ZONE = "+08:00";
const ENABLE_FLAG = "MYROOT_INBOX_WORKER_HARNESS_ENABLED";
const RETRY_POLICY_VERSION = "inbox-retry-v1";
const OPTION_KEYS = Object.freeze(["pool", "env", "workerId"]);
const RUN_INPUT_KEYS = Object.freeze(["limit"]);

const RUNNABLE_SCOPE_SQL = `/* inbox_worker:discover_runnable */
SELECT r.source_name, r.partition_key, r.partition_position
FROM inbox_receipt AS r
INNER JOIN consumer_checkpoint AS c
  ON c.consumer_name = r.consumer_name
 AND c.source_name = r.source_name
 AND c.partition_key = r.partition_key
WHERE r.consumer_name = ?
  AND r.handler_version = ?
  AND r.handler_id = ?
  AND r.handler_registry_version = ?
  AND r.handler_descriptor_digest = ?
  AND r.handler_source_digest = ?
  AND r.handler_registration_digest = ?
  AND r.source_name = ?
  AND r.event_type = ?
  AND r.schema_version = ?
  AND r.aggregate_type = ?
  AND c.handler_version = ?
  AND c.gap_status = 'CLEAR'
  AND r.partition_position = c.last_contiguous_position + 1
  AND (
    r.status = 'RECEIVED'
    OR (
      r.status = 'RETRY_PENDING'
      AND r.retry_policy_version = '${RETRY_POLICY_VERSION}'
      AND r.next_retry_at <= CURRENT_TIMESTAMP(3)
    )
  )
ORDER BY r.updated_at, r.inbox_receipt_id
LIMIT ?`;

const RECOVERABLE_SCOPE_SQL = `/* inbox_worker:discover_recoverable */
SELECT r.source_name, r.partition_key, r.partition_position
FROM inbox_receipt AS r
INNER JOIN consumer_checkpoint AS c
  ON c.consumer_name = r.consumer_name
 AND c.source_name = r.source_name
 AND c.partition_key = r.partition_key
WHERE r.consumer_name = ?
  AND r.handler_version = ?
  AND r.handler_id = ?
  AND r.handler_registry_version = ?
  AND r.handler_descriptor_digest = ?
  AND r.handler_source_digest = ?
  AND r.handler_registration_digest = ?
  AND r.source_name = ?
  AND r.event_type = ?
  AND r.schema_version = ?
  AND r.aggregate_type = ?
  AND c.handler_version = ?
  AND c.gap_status = 'CLEAR'
  AND r.partition_position = c.last_contiguous_position + 1
  AND r.status = 'CLAIMED'
  AND r.retry_policy_version = '${RETRY_POLICY_VERSION}'
  AND r.lease_expires_at <= CURRENT_TIMESTAMP(3)
ORDER BY r.lease_expires_at, r.inbox_receipt_id
LIMIT ?`;

const INSPECT_SQL = `/* inbox_worker:inspect_scope */
SELECT
  COUNT(*) AS receipt_count,
  COALESCE(SUM(r.status = 'RECEIVED'), 0) AS received_count,
  COALESCE(SUM(r.status = 'RETRY_PENDING'), 0) AS retry_pending_count,
  COALESCE(SUM(r.status = 'CLAIMED'), 0) AS claimed_count,
  COALESCE(SUM(r.status = 'SUCCEEDED'), 0) AS succeeded_count,
  COALESCE(SUM(r.status = 'DEAD_LETTER'), 0) AS dead_letter_count,
  COALESCE(SUM(r.status = 'REVIEW_REQUIRED'), 0) AS review_required_count,
  COALESCE(SUM(c.consumer_checkpoint_id IS NULL), 0) AS checkpoint_missing_receipt_count,
  COUNT(DISTINCT CASE WHEN c.gap_status <> 'CLEAR' THEN c.consumer_checkpoint_id ELSE NULL END)
    AS blocked_gap_scope_count,
  COALESCE(SUM(
    ? = 'ENABLED'
    AND c.gap_status = 'CLEAR'
    AND r.partition_position = c.last_contiguous_position + 1
    AND (
      r.status = 'RECEIVED'
      OR (
        r.status = 'RETRY_PENDING'
        AND r.retry_policy_version = '${RETRY_POLICY_VERSION}'
        AND r.next_retry_at <= CURRENT_TIMESTAMP(3)
      )
    )
  ), 0) AS runnable_scope_count,
  COALESCE(SUM(
    ? = 'ENABLED'
    AND c.gap_status = 'CLEAR'
    AND r.partition_position = c.last_contiguous_position + 1
    AND r.status = 'CLAIMED'
    AND r.retry_policy_version = '${RETRY_POLICY_VERSION}'
    AND r.lease_expires_at <= CURRENT_TIMESTAMP(3)
  ), 0) AS recoverable_scope_count,
  COALESCE(SUM(
    ? = 'BLOCKED_SUCCESSOR_UNAVAILABLE'
    AND c.gap_status = 'CLEAR'
    AND r.partition_position = c.last_contiguous_position + 1
    AND r.status IN ('RECEIVED', 'RETRY_PENDING', 'CLAIMED')
  ), 0) AS successor_unavailable_head_count,
  COALESCE(SUM(
    c.gap_status = 'CLEAR'
    AND r.partition_position = c.last_contiguous_position + 1
    AND r.status IN ('RECEIVED', 'RETRY_PENDING', 'CLAIMED')
    AND NOT (
      r.handler_version = ?
      AND r.handler_id = ?
      AND r.handler_registry_version = ?
      AND r.handler_descriptor_digest = ?
      AND r.handler_source_digest = ?
      AND r.handler_registration_digest = ?
      AND c.handler_version = ?
    )
  ), 0) AS registration_mismatch_head_count
FROM inbox_receipt AS r
LEFT JOIN consumer_checkpoint AS c
  ON c.consumer_name = r.consumer_name
 AND c.source_name = r.source_name
 AND c.partition_key = r.partition_key
WHERE r.consumer_name = ?
  AND r.source_name = ?
  AND r.event_type = ?
  AND r.schema_version = ?
  AND r.aggregate_type = ?`;

function workerError(code) {
  const error = new Error("inbox worker harness operation failed");
  error.code = code;
  return error;
}

function configurationError() { return workerError("INBOX_WORKER_CONFIGURATION_INVALID"); }
function inputError() { return workerError("INBOX_WORKER_INPUT_INVALID"); }
function disabledError() { return workerError("INBOX_WORKER_DISABLED"); }
function persistenceError() { return workerError("INBOX_WORKER_PERSISTENCE_FAILED"); }

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

function normalizeLimit(input) {
  if (!exactKeys(input, RUN_INPUT_KEYS)) throw inputError();
  const limit = Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw inputError();
  return limit;
}

function selectedRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw persistenceError();
  return result[0];
}

function nonNegativeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw persistenceError();
  return count;
}

function registeredScopes() {
  try {
    const registry = getDefaultInboxHandlerRegistry();
    registry.assertReady();
    return Object.freeze(RUNTIME_EVENT_SCOPES.map((scope) => {
      const asserted = assertRuntimeEventScopeRegistration(registry.assertScope(scopeIdentity(scope)));
      if (asserted.scope !== scope) throw configurationError();
      return Object.freeze(asserted);
    }));
  } catch (error) {
    if (error && error.code === "INBOX_WORKER_CONFIGURATION_INVALID") throw error;
    throw configurationError();
  }
}

function identityValues(entry) {
  const { scope, registration } = entry;
  return Object.freeze([
    scope.consumerName,
    scope.handlerVersion,
    scope.handlerId,
    registration.registryVersion,
    registration.descriptor.descriptorDigest,
    registration.descriptor.sourceDigest,
    registration.registrationDigest,
    scope.sourceName,
    scope.eventType,
    scope.schemaVersion,
    scope.aggregateType,
  ]);
}

function normalizeScopeRows(entry, rows, maximum) {
  if (!Array.isArray(rows) || rows.length > maximum) throw persistenceError();
  const scopes = [];
  const seen = new Set();
  for (const row of rows) {
    if (!plainRecord(row)
      || !exactText(row.source_name, 96)
      || !exactText(row.partition_key, 191)
      || !Number.isSafeInteger(Number(row.partition_position))
      || Number(row.partition_position) < 1
      || row.source_name !== entry.scope.sourceName) throw persistenceError();
    const key = `${row.source_name}\0${row.partition_key}`;
    if (seen.has(key)) throw persistenceError();
    seen.add(key);
    scopes.push(Object.freeze({ sourceName: row.source_name, partitionKey: row.partition_key }));
  }
  return Object.freeze(scopes);
}

function createMysqlInboxWorkerHarness(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !OPTION_KEYS.includes(key))) throw configurationError();
  const pool = options.pool;
  const runtimeEnv = options.env === undefined ? process.env : options.env;
  const workerId = options.workerId || `inbox-worker:${crypto.randomUUID()}`;
  if (!pool
    || typeof pool.getConnection !== "function"
    || (options.env !== undefined && !plainRecord(options.env))
    || !opaqueAscii(workerId, 128)) throw configurationError();

  const entries = registeredScopes();
  const runnableEntries = entries.filter(({ scope }) => scope.workerMode === WORKER_MODES.ENABLED);
  const blockedEntries = entries.filter(({ scope }) => (
    scope.workerMode === WORKER_MODES.BLOCKED_SUCCESSOR_UNAVAILABLE
  ));
  if (runnableEntries.length === 0
    || runnableEntries.length + blockedEntries.length !== entries.length) throw configurationError();

  const enabled = runtimeEnv[ENABLE_FLAG] === "true";
  const cores = new Map();
  let runnableCursor = 0;
  if (enabled) {
    try {
      for (const { scope } of runnableEntries) {
        cores.set(scope.scopeId, createMysqlInboxCheckpoint({
          pool,
          consumerName: scope.consumerName,
          handlerVersion: scope.handlerVersion,
          sourceName: scope.sourceName,
          eventType: scope.eventType,
          schemaVersion: scope.schemaVersion,
          aggregateType: scope.aggregateType,
          workerId: `${workerId}:${scope.scopeId.toLowerCase()}`,
          env: runtimeEnv,
        }));
      }
    } catch { throw configurationError(); }
  }

  async function executeRead(sql, values) {
    let connection;
    let destroy = false;
    try {
      connection = await pool.getConnection();
      if (!connection
        || typeof connection.execute !== "function"
        || typeof connection.release !== "function"
        || typeof connection.destroy !== "function") throw configurationError();
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
      return selectedRows(await connection.execute(sql, values));
    } catch (error) {
      destroy = true;
      if (error && error.code === "INBOX_WORKER_CONFIGURATION_INVALID") throw error;
      throw persistenceError();
    } finally {
      if (connection) {
        try { if (destroy) connection.destroy(); else connection.release(); } catch {}
      }
    }
  }

  async function discover(entry, kind, limit) {
    const sql = kind === "RUN" ? RUNNABLE_SCOPE_SQL : RECOVERABLE_SCOPE_SQL;
    const rows = await executeRead(sql, [
      ...identityValues(entry),
      entry.scope.handlerVersion,
      limit,
    ]);
    return normalizeScopeRows(entry, rows, limit);
  }

  function assertEnabled() {
    if (!enabled || cores.size !== runnableEntries.length) throw disabledError();
  }

  async function runOnce(input = {}) {
    const limit = normalizeLimit(input);
    assertEnabled();
    let remaining = limit;
    let discoveredScopeCount = 0;
    let claimedCount = 0;
    let succeededCount = 0;
    let retryScheduledCount = 0;
    let noOpCount = 0;
    const orderedEntries = [
      ...runnableEntries.slice(runnableCursor),
      ...runnableEntries.slice(0, runnableCursor),
    ];
    runnableCursor = (runnableCursor + 1) % runnableEntries.length;
    for (const entry of orderedEntries) {
      if (remaining === 0) break;
      const scopes = await discover(entry, "RUN", remaining);
      discoveredScopeCount += scopes.length;
      remaining -= scopes.length;
      const core = cores.get(entry.scope.scopeId);
      for (const scope of scopes) {
        let claims;
        try { claims = await core.claimNext(scope); } catch { throw persistenceError(); }
        if (!Array.isArray(claims) || claims.length > 1) throw persistenceError();
        if (claims.length === 0) { noOpCount += 1; continue; }
        claimedCount += 1;
        const claim = claims[0];
        try {
          await core.completeOwned(claim);
          succeededCount += 1;
        } catch {
          try {
            await core.failOwned(claim, {
              reasonCode: "INBOX_HANDLER_EXECUTION_FAILED",
              retryable: true,
            });
            retryScheduledCount += 1;
          } catch { throw persistenceError(); }
        }
      }
    }
    return Object.freeze({
      discoveredScopeCount, claimedCount, succeededCount, retryScheduledCount, noOpCount,
    });
  }

  async function recoverOnce(input = {}) {
    const limit = normalizeLimit(input);
    assertEnabled();
    let remaining = limit;
    let discoveredScopeCount = 0;
    let recoveredCount = 0;
    let retryPendingCount = 0;
    let deadLetterCount = 0;
    let noOpCount = 0;
    const orderedEntries = [
      ...runnableEntries.slice(runnableCursor),
      ...runnableEntries.slice(0, runnableCursor),
    ];
    runnableCursor = (runnableCursor + 1) % runnableEntries.length;
    for (const entry of orderedEntries) {
      if (remaining === 0) break;
      const scopes = await discover(entry, "RECOVER", remaining);
      discoveredScopeCount += scopes.length;
      remaining -= scopes.length;
      const core = cores.get(entry.scope.scopeId);
      for (const scope of scopes) {
        let recovered;
        try { recovered = await core.recoverExpired(scope); } catch { throw persistenceError(); }
        if (!Array.isArray(recovered) || recovered.length > 1) throw persistenceError();
        if (recovered.length === 0) { noOpCount += 1; continue; }
        const status = recovered[0] && recovered[0].status;
        if (status === "RETRY_PENDING") retryPendingCount += 1;
        else if (status === "DEAD_LETTER") deadLetterCount += 1;
        else throw persistenceError();
        recoveredCount += 1;
      }
    }
    return Object.freeze({
      discoveredScopeCount, recoveredCount, retryPendingCount, deadLetterCount, noOpCount,
    });
  }

  async function inspect() {
    const totals = {
      receiptCount: 0,
      received: 0,
      retryPending: 0,
      claimed: 0,
      succeeded: 0,
      deadLetter: 0,
      reviewRequired: 0,
      runnableScopeCount: 0,
      recoverableScopeCount: 0,
      blockedGapScopeCount: 0,
      checkpointMissingReceiptCount: 0,
      registrationMismatchHeadCount: 0,
      successorUnavailableHeadCount: 0,
    };
    for (const entry of entries) {
      const { scope, registration } = entry;
      const rows = await executeRead(INSPECT_SQL, [
        scope.workerMode,
        scope.workerMode,
        scope.workerMode,
        scope.handlerVersion,
        scope.handlerId,
        registration.registryVersion,
        registration.descriptor.descriptorDigest,
        registration.descriptor.sourceDigest,
        registration.registrationDigest,
        scope.handlerVersion,
        scope.consumerName,
        scope.sourceName,
        scope.eventType,
        scope.schemaVersion,
        scope.aggregateType,
      ]);
      if (rows.length !== 1 || !plainRecord(rows[0])) throw persistenceError();
      const row = rows[0];
      totals.receiptCount += nonNegativeCount(row.receipt_count);
      totals.received += nonNegativeCount(row.received_count);
      totals.retryPending += nonNegativeCount(row.retry_pending_count);
      totals.claimed += nonNegativeCount(row.claimed_count);
      totals.succeeded += nonNegativeCount(row.succeeded_count);
      totals.deadLetter += nonNegativeCount(row.dead_letter_count);
      totals.reviewRequired += nonNegativeCount(row.review_required_count);
      totals.runnableScopeCount += nonNegativeCount(row.runnable_scope_count);
      totals.recoverableScopeCount += nonNegativeCount(row.recoverable_scope_count);
      totals.blockedGapScopeCount += nonNegativeCount(row.blocked_gap_scope_count);
      totals.checkpointMissingReceiptCount += nonNegativeCount(
        row.checkpoint_missing_receipt_count
      );
      totals.registrationMismatchHeadCount += nonNegativeCount(
        row.registration_mismatch_head_count
      );
      totals.successorUnavailableHeadCount += nonNegativeCount(
        row.successor_unavailable_head_count
      );
    }
    return Object.freeze({
      receiptCount: totals.receiptCount,
      statusCounts: Object.freeze({
        received: totals.received,
        retryPending: totals.retryPending,
        claimed: totals.claimed,
        succeeded: totals.succeeded,
        deadLetter: totals.deadLetter,
        reviewRequired: totals.reviewRequired,
      }),
      runnableScopeCount: totals.runnableScopeCount,
      recoverableScopeCount: totals.recoverableScopeCount,
      blockedGapScopeCount: totals.blockedGapScopeCount,
      checkpointMissingReceiptCount: totals.checkpointMissingReceiptCount,
      registrationMismatchHeadCount: totals.registrationMismatchHeadCount,
      successorUnavailableHeadCount: totals.successorUnavailableHeadCount,
    });
  }

  return Object.freeze({ runOnce, recoverOnce, inspect });
}

module.exports = { createMysqlInboxWorkerHarness };
