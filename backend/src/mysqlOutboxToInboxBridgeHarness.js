const crypto = require("node:crypto");

const { getDefaultInboxHandlerRegistry } = require("./inboxHandlerRegistry");
const { createMysqlInboxCheckpoint } = require("./mysqlInboxCheckpoint");
const { createMysqlOutboxDispatcher } = require("./mysqlOutboxDispatcher");
const {
  WORKER_MODES,
  RUNTIME_EVENT_SCOPES,
  assertRuntimeEventClaim,
  assertRuntimeEventScopeRegistration,
  scopeIdentity,
  sqlContract,
} = require("./runtimeEventScopeCatalog");

const ENABLE_FLAG = "MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED";
const MYSQL_SESSION_TIME_ZONE = "+08:00";
const OPTION_KEYS = Object.freeze(["pool", "env", "workerId"]);
const RUN_KEYS = Object.freeze(["limit"]);
const ACTIVE_STATUS_SQL = "('PENDING', 'RETRY_PENDING', 'CLAIMED')";

function bridgeError(code) {
  const error = new Error("outbox to inbox bridge operation failed");
  error.code = code;
  return error;
}

function configurationError() { return bridgeError("OUTBOX_INBOX_BRIDGE_CONFIGURATION_INVALID"); }
function inputError() { return bridgeError("OUTBOX_INBOX_BRIDGE_INPUT_INVALID"); }
function disabledError() { return bridgeError("OUTBOX_INBOX_BRIDGE_DISABLED"); }
function scopeMismatchError() { return bridgeError("OUTBOX_INBOX_BRIDGE_SCOPE_MISMATCH"); }
function persistenceError() { return bridgeError("OUTBOX_INBOX_BRIDGE_PERSISTENCE_FAILED"); }

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
  if (!exactKeys(input, RUN_KEYS)) throw inputError();
  const limit = Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw inputError();
  return limit;
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
      const resolved = registry.assertScope(scopeIdentity(scope));
      const asserted = assertRuntimeEventScopeRegistration(resolved);
      if (asserted.scope !== scope) throw configurationError();
      return Object.freeze(asserted);
    }));
  } catch (error) {
    if (error && error.code === "OUTBOX_INBOX_BRIDGE_CONFIGURATION_INVALID") throw error;
    throw configurationError();
  }
}

function inboxEnvelope(scope, claim) {
  try { assertRuntimeEventClaim(scope, claim); } catch { throw scopeMismatchError(); }
  const envelope = claim.envelope;
  return Object.freeze({
    eventId: claim.outboxEventId,
    eventType: envelope.eventType,
    schemaVersion: envelope.schemaVersion,
    sourceName: envelope.sourceName,
    partitionKey: envelope.partitionKey,
    partitionPosition: envelope.partitionPosition,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    occurredAt: envelope.occurredAt,
    producerVersion: envelope.producerVersion,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId,
    idempotencyKey: envelope.idempotencyKey,
    payload: envelope.payload,
    payloadDigest: envelope.payloadDigest,
  });
}

function assertReceipt(receipt, envelope) {
  if (!plainRecord(receipt)
    || !exactText(receipt.receiptId, 64)
    || !["RECEIVED", "RETRY_PENDING", "CLAIMED", "SUCCEEDED", "DEAD_LETTER", "REVIEW_REQUIRED"].includes(receipt.receiptStatus)
    || !plainRecord(receipt.envelope)
    || receipt.envelope.eventId !== envelope.eventId) throw persistenceError();
  return receipt;
}

function retryableInboxFailure(error) {
  return !(error && ["INBOX_CORE_CONFLICT", "INBOX_CORE_INPUT_INVALID"].includes(error.code));
}

function scopeInspectQuery(entry) {
  const { scope, registration } = entry;
  const contract = sqlContract(scope, "o");
  const familyValues = [
    scope.topic,
    scope.sourceName,
    scope.eventType,
    scope.schemaVersion,
    scope.aggregateType,
  ];
  const receiptIdentity = [
    scope.consumerName,
    scope.handlerVersion,
    scope.handlerId,
    registration.registryVersion,
    registration.descriptor.descriptorDigest,
    registration.descriptor.sourceDigest,
    registration.registrationDigest,
  ];
  const receiptExistsSql = `EXISTS (
    SELECT 1 FROM inbox_receipt AS r
    WHERE r.consumer_name = ?
      AND r.event_id = o.outbox_event_id
      AND r.handler_version = ?
      AND r.handler_id = ?
      AND r.handler_registry_version = ?
      AND r.handler_descriptor_digest = ?
      AND r.handler_source_digest = ?
      AND r.handler_registration_digest = ?
  )`;
  const sql = `/* outbox_inbox_bridge:inspect_scope:${scope.scopeId} */
SELECT
  COALESCE(SUM(o.status IN ${ACTIVE_STATUS_SQL} AND ${contract.predicate} AND NOT ${receiptExistsSql}), 0) AS receipt_lag_count,
  COALESCE(SUM(o.status = 'CLAIMED' AND ${contract.predicate}), 0) AS claimed_count,
  COALESCE(SUM(
    o.status IN ${ACTIVE_STATUS_SQL}
    AND o.topic = ? AND o.source_name = ? AND o.event_type = ?
    AND o.schema_version = ? AND o.aggregate_type = ?
    AND COALESCE(${contract.predicate}, 0) = 0
  ), 0) AS outbox_scope_mismatch_count,
  COALESCE(SUM(o.status = 'SUCCEEDED' AND ${contract.predicate} AND NOT ${receiptExistsSql}), 0) AS terminal_without_receipt_count,
  COALESCE(SUM(
    o.status = 'DEAD_LETTER' AND ${contract.predicate}
    AND EXISTS (
      SELECT 1 FROM event_dead_letter AS dead
      WHERE dead.direction = 'OUTBOX'
        AND dead.source_record_id = o.outbox_event_id
        AND dead.status = 'OPEN'
    )
  ), 0) AS outbox_open_dead_letter_count,
  (
    SELECT COUNT(*) FROM inbox_receipt AS mismatch
    WHERE mismatch.consumer_name = ?
      AND mismatch.source_name = ?
      AND mismatch.event_type = ?
      AND mismatch.schema_version = ?
      AND mismatch.aggregate_type = ?
      AND NOT (
        mismatch.handler_version = ?
        AND mismatch.handler_id = ?
        AND mismatch.handler_registry_version = ?
        AND mismatch.handler_descriptor_digest = ?
        AND mismatch.handler_source_digest = ?
        AND mismatch.handler_registration_digest = ?
      )
  ) AS registration_mismatch_count
FROM outbox_event AS o`;
  return Object.freeze({
    sql,
    values: Object.freeze([
      ...contract.values, ...receiptIdentity,
      ...contract.values,
      ...familyValues, ...contract.values,
      ...contract.values, ...receiptIdentity,
      ...contract.values,
      scope.consumerName, scope.sourceName, scope.eventType, scope.schemaVersion, scope.aggregateType,
      scope.handlerVersion, scope.handlerId, registration.registryVersion,
      registration.descriptor.descriptorDigest, registration.descriptor.sourceDigest,
      registration.registrationDigest,
    ]),
  });
}

function anyScopePredicate(entries, alias) {
  const contracts = entries.map(({ scope }) => sqlContract(scope, alias));
  return Object.freeze({
    predicate: `(${contracts.map((contract) => contract.predicate).join(" OR ")})`,
    values: Object.freeze(contracts.flatMap((contract) => contract.values)),
  });
}

function unsupportedActiveQuery(entries) {
  const supported = anyScopePredicate(entries, "unsupported");
  return Object.freeze({
    sql: `/* outbox_inbox_bridge:inspect_unsupported_active */
SELECT COUNT(*) AS unregistered_active_count
FROM outbox_event AS unsupported
WHERE unsupported.status IN ${ACTIVE_STATUS_SQL}
  AND COALESCE(${supported.predicate}, 0) = 0`,
    values: supported.values,
  });
}

function companionQuery(entries) {
  const supported = anyScopePredicate(entries, "dead_source");
  const reverseSupported = anyScopePredicate(entries, "dead_source");
  return Object.freeze({
    sql: `/* outbox_inbox_bridge:inspect_dead_letter_companion */
SELECT (
  /* bridge_companion:source_anchor */
  SELECT COUNT(*)
  FROM outbox_event AS dead_source
  LEFT JOIN event_dead_letter AS dead
    ON dead.direction = 'OUTBOX'
   AND dead.source_record_id = dead_source.outbox_event_id
  WHERE dead_source.status = 'DEAD_LETTER'
    AND ${supported.predicate}
    AND (
      dead.event_dead_letter_id IS NULL
      OR dead.status <> 'OPEN'
      OR dead.consumer_name IS NOT NULL
      OR dead.source_lease_generation IS NOT NULL
      OR dead.source_transition_id IS NOT NULL
      OR NOT (dead.source_name <=> dead_source.source_name)
      OR NOT (dead.partition_key <=> dead_source.partition_key)
      OR dead.partition_position <> dead_source.partition_position
      OR NOT (dead.event_id <=> dead_source.outbox_event_id)
      OR NOT (dead.event_type <=> dead_source.event_type)
      OR dead.payload_json IS NOT NULL
      OR NOT (dead.payload_digest <=> dead_source.payload_digest)
      OR dead.attempt_count <> dead_source.attempt_count
      OR NOT (JSON_TYPE(dead.error_json) <=> 'OBJECT')
      OR NOT (JSON_UNQUOTE(JSON_EXTRACT(dead.error_json, '$.code')) <=> dead.reason_code)
      OR dead.next_retry_at IS NOT NULL
      OR dead.replay_request_id IS NOT NULL
      OR NOT (dead.release_id <=> dead_source.release_id)
      OR dead.resolved_at IS NOT NULL
      OR dead.resolved_by IS NOT NULL
    )
) + (
  /* bridge_companion:dead_claim_anchor */
  SELECT COUNT(*)
  FROM event_dead_letter AS dead
  LEFT JOIN outbox_event AS dead_source
    ON dead_source.outbox_event_id = dead.source_record_id
  WHERE dead.direction = 'OUTBOX'
    AND dead.status = 'OPEN'
    AND (
      dead.source_name = 'myroot-api'
      AND dead.event_type = 'task.event.recorded.v1'
      AND dead.partition_key LIKE 'task_event:%'
    )
    AND (
      dead_source.outbox_event_id IS NULL
      OR dead_source.status <> 'DEAD_LETTER'
      OR COALESCE(${reverseSupported.predicate}, 0) = 0
    )
) AS dead_letter_companion_mismatch_count`,
    values: Object.freeze([...supported.values, ...reverseSupported.values]),
  });
}

function blockedActiveQuery(entry) {
  const contract = sqlContract(entry.scope, "blocked");
  return Object.freeze({
    sql: `/* outbox_inbox_bridge:blocked_successor_active */
SELECT COUNT(*) AS successor_unavailable_active_count
FROM outbox_event AS blocked
WHERE blocked.status IN ${ACTIVE_STATUS_SQL}
  AND ${contract.predicate}`,
    values: contract.values,
  });
}

function createMysqlOutboxToInboxBridgeHarness(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !OPTION_KEYS.includes(key))) throw configurationError();
  const pool = options.pool;
  const runtimeEnv = options.env === undefined ? process.env : options.env;
  const workerId = options.workerId || `outbox-inbox-bridge:${crypto.randomUUID()}`;
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
  let outbox = null;
  const inboxes = new Map();
  let runnableCursor = 0;
  if (enabled) {
    try {
      outbox = createMysqlOutboxDispatcher({ pool, workerId: `${workerId}:outbox` });
      for (const { scope } of runnableEntries) {
        inboxes.set(scope.scopeId, createMysqlInboxCheckpoint({
          pool,
          consumerName: scope.consumerName,
          handlerVersion: scope.handlerVersion,
          sourceName: scope.sourceName,
          eventType: scope.eventType,
          schemaVersion: scope.schemaVersion,
          aggregateType: scope.aggregateType,
          workerId: `${workerId}:inbox:${scope.scopeId.toLowerCase()}`,
          env: runtimeEnv,
        }));
      }
    } catch { throw configurationError(); }
  }

  async function successorUnavailableActiveCount(connection) {
    let count = 0;
    for (const entry of blockedEntries) {
      const query = blockedActiveQuery(entry);
      const result = await connection.execute(query.sql, query.values);
      const rows = Array.isArray(result) ? result[0] : null;
      if (!Array.isArray(rows) || rows.length !== 1 || !plainRecord(rows[0])) {
        throw persistenceError();
      }
      count += nonNegativeCount(rows[0].successor_unavailable_active_count);
    }
    return count;
  }

  function assertEnabled() {
    if (!enabled || !outbox || inboxes.size !== runnableEntries.length) throw disabledError();
  }

  async function runOnce(input = {}) {
    assertEnabled();
    const limit = normalizeLimit(input);
    const result = {
      enabled: true,
      claimedCount: 0,
      inboxCreatedCount: 0,
      inboxReplayedCount: 0,
      outboxCompletedCount: 0,
      retryScheduledCount: 0,
      deadLetteredCount: 0,
    };
    let remaining = limit;
    const orderedEntries = [
      ...runnableEntries.slice(runnableCursor),
      ...runnableEntries.slice(0, runnableCursor),
    ];
    runnableCursor = (runnableCursor + 1) % runnableEntries.length;
    for (const entry of orderedEntries) {
      if (remaining === 0) break;
      let claims;
      try { claims = await outbox.claimRegistered(entry.registration, { limit: remaining }); } catch (error) {
        if (error && error.code === "OUTBOX_DISPATCH_INPUT_INVALID") throw scopeMismatchError();
        throw persistenceError();
      }
      if (!Array.isArray(claims) || claims.length > remaining) throw persistenceError();
      result.claimedCount += claims.length;
      remaining -= claims.length;
      const inbox = inboxes.get(entry.scope.scopeId);
      for (const claim of claims) {
        const envelope = inboxEnvelope(entry.scope, claim);
        let receipt;
        try { receipt = assertReceipt(await inbox.receive(envelope), envelope); } catch (error) {
          if (error && error.code === "OUTBOX_INBOX_BRIDGE_SCOPE_MISMATCH") throw error;
          let failure;
          try {
            failure = await outbox.failOwned(claim, {
              reasonCode: retryableInboxFailure(error)
                ? "OUTBOX_DISPATCH_FAILED"
                : "OUTBOX_PAYLOAD_INVALID",
              retryable: retryableInboxFailure(error),
            });
          } catch { throw persistenceError(); }
          if (failure && failure.status === "RETRY_PENDING") result.retryScheduledCount += 1;
          else if (failure && failure.status === "DEAD_LETTER") result.deadLetteredCount += 1;
          else throw persistenceError();
          continue;
        }
        if (receipt.created === true) result.inboxCreatedCount += 1;
        else if (receipt.created === false) result.inboxReplayedCount += 1;
        else throw persistenceError();
        try {
          const completed = await outbox.completeOwned(claim);
          if (!completed || completed.status !== "SUCCEEDED") throw persistenceError();
        } catch { throw persistenceError(); }
        result.outboxCompletedCount += 1;
      }
    }
    return Object.freeze(result);
  }

  async function recoverOnce(input = {}) {
    assertEnabled();
    const limit = normalizeLimit(input);
    let remaining = limit;
    let recoveredCount = 0;
    let retryPendingCount = 0;
    let deadLetteredCount = 0;
    const orderedEntries = [
      ...runnableEntries.slice(runnableCursor),
      ...runnableEntries.slice(0, runnableCursor),
    ];
    runnableCursor = (runnableCursor + 1) % runnableEntries.length;
    for (const entry of orderedEntries) {
      if (remaining === 0) break;
      let recovered;
      try {
        recovered = await outbox.recoverExpiredRegistered(entry.registration, { limit: remaining });
      } catch { throw persistenceError(); }
      if (!Array.isArray(recovered) || recovered.length > remaining) throw persistenceError();
      remaining -= recovered.length;
      recoveredCount += recovered.length;
      for (const item of recovered) {
        if (item && item.status === "RETRY_PENDING") retryPendingCount += 1;
        else if (item && item.status === "DEAD_LETTER") deadLetteredCount += 1;
        else throw persistenceError();
      }
    }
    return Object.freeze({ enabled: true, recoveredCount, retryPendingCount, deadLetteredCount });
  }

  async function inspect() {
    let connection;
    let began = false;
    let destroy = false;
    try {
      connection = await pool.getConnection();
      if (!connection
        || typeof connection.execute !== "function"
        || typeof connection.beginTransaction !== "function"
        || typeof connection.rollback !== "function"
        || typeof connection.release !== "function"
        || typeof connection.destroy !== "function") throw configurationError();
      await connection.execute(`SET SESSION time_zone = '${MYSQL_SESSION_TIME_ZONE}'`);
      await connection.beginTransaction();
      began = true;
      const totals = {
        receipt: 0, claimed: 0, outboxScope: 0, inboxRegistration: 0,
        terminalWithoutReceipt: 0, outboxOpenDeadLetter: 0,
      };
      for (const entry of entries) {
        const query = scopeInspectQuery(entry);
        const result = await connection.execute(query.sql, query.values);
        const rows = Array.isArray(result) ? result[0] : null;
        if (!Array.isArray(rows) || rows.length !== 1 || !plainRecord(rows[0])) throw persistenceError();
        const row = rows[0];
        totals.receipt += nonNegativeCount(row.receipt_lag_count);
        totals.claimed += nonNegativeCount(row.claimed_count);
        totals.outboxScope += nonNegativeCount(row.outbox_scope_mismatch_count);
        totals.inboxRegistration += nonNegativeCount(row.registration_mismatch_count);
        totals.terminalWithoutReceipt += nonNegativeCount(row.terminal_without_receipt_count);
        totals.outboxOpenDeadLetter += nonNegativeCount(row.outbox_open_dead_letter_count);
      }
      const unsupported = unsupportedActiveQuery(entries);
      const unsupportedResult = await connection.execute(unsupported.sql, unsupported.values);
      const unsupportedRows = Array.isArray(unsupportedResult) ? unsupportedResult[0] : null;
      const companion = companionQuery(entries);
      const companionResult = await connection.execute(companion.sql, companion.values);
      const companionRows = Array.isArray(companionResult) ? companionResult[0] : null;
      if (!Array.isArray(unsupportedRows) || unsupportedRows.length !== 1 || !plainRecord(unsupportedRows[0])
        || !Array.isArray(companionRows) || companionRows.length !== 1 || !plainRecord(companionRows[0])) {
        throw persistenceError();
      }
      const successorUnavailableActive = await successorUnavailableActiveCount(connection);
      await connection.rollback();
      began = false;
      connection.release();
      connection = null;
      const mismatch = Object.freeze({
        outboxScope: totals.outboxScope,
        inboxRegistration: totals.inboxRegistration,
        terminalWithoutReceipt: totals.terminalWithoutReceipt,
        unregisteredActive: nonNegativeCount(unsupportedRows[0].unregistered_active_count),
        successorUnavailableActive,
        outboxOpenDeadLetter: totals.outboxOpenDeadLetter,
        deadLetterCompanion: nonNegativeCount(
          companionRows[0].dead_letter_companion_mismatch_count
        ),
      });
      // Scope rotation and per-partition checkpoints keep one failed successor
      // from becoming a global queue head. Any explicitly blocked future scope
      // remains excluded from runnableEntries and visible in readiness.
      const clean = Object.values(mismatch).every((count) => count === 0);
      return Object.freeze({
        enabled,
        killSwitch: enabled ? "OPEN" : "CLOSED",
        lag: Object.freeze({ receipt: totals.receipt, claimed: totals.claimed }),
        mismatch,
        readiness: Object.freeze({
          ready: enabled && clean,
          reasonCode: !enabled
            ? "BRIDGE_DISABLED"
            : clean ? "BRIDGE_SCOPE_READY" : "BRIDGE_SCOPE_REVIEW_REQUIRED",
        }),
      });
    } catch (error) {
      destroy = true;
      if (began && connection) {
        try { await connection.rollback(); } catch {}
      }
      if (error && error.code === "OUTBOX_INBOX_BRIDGE_CONFIGURATION_INVALID") throw error;
      throw persistenceError();
    } finally {
      if (connection) {
        try { if (destroy) connection.destroy(); else connection.release(); } catch {}
      }
    }
  }

  return Object.freeze({ runOnce, recoverOnce, inspect });
}

module.exports = { createMysqlOutboxToInboxBridgeHarness };
