const crypto = require("node:crypto");

const {
  runtimeAlertDeliverySloForSeverity,
} = require("./v1RuntimeAlertDeliveryPolicy");

const {
  CANONICAL_VERSION,
  DIGEST_SCHEME,
  PAYLOAD_SCHEMA_VERSION,
  RECEIVER_BINDING_AUTHORITY_VERSION,
  createV1RuntimeAlertPayloadAdapter,
  normalizePayload,
  runtimeAlertDeliveryMode,
} = require("./v1RuntimeAlertPayloadAdapter");
const {
  readMysqlProcedureAffectedRows,
  readMysqlProcedureResultRow,
} = require("./mysqlProcedureResult");

const MYSQL_SESSION_TIME_ZONE = "+00:00";
const MYSQL_POOL_TIME_ZONE = "+08:00";
const MAXIMUM_LEASE_SECONDS = 3600;
const MAXIMUM_RECOVERY_LIMIT = 100;
const MAXIMUM_ATTEMPTS = 5;
const DEFAULT_MAXIMUM_ATTEMPTS = 3;
const DEFAULT_BACKOFF_SECONDS = 10;
const MAXIMUM_BACKOFF_SECONDS = 3600;
const STATUSES = Object.freeze([
  "PENDING",
  "CLAIMED",
  "RETRY_WAIT",
  "STARTED",
  "DELIVERED",
  "DEAD_LETTER",
  "UNKNOWN",
]);

const SELECT_DATABASE_SQL = "SELECT DATABASE() AS database_name";
const SET_TIME_ZONE_SQL = "SET time_zone = ?";
const SELECT_TIME_ZONE_SQL = "SELECT @@session.time_zone AS session_time_zone";
const REGISTER_DRY_RUN_SQL = `
  /* v1_runtime_alert_delivery:register_dry_run */
  CALL v1_runtime_alert_delivery_register_dry_run(?, ?, ?, ?, ?, ?, ?, ?)
`;
const REGISTER_CONTROLLED_SQL = `
  /* v1_runtime_alert_delivery:register_controlled */
  CALL v1_runtime_alert_delivery_register_controlled(?, ?, ?, ?, ?, ?, ?, ?)
`;

const DELIVERY_COLUMNS = `
  delivery.runtime_alert_delivery_id,
  delivery.runtime_alert_id,
  delivery.environment_id,
  delivery.registration_mode,
  delivery.receiver_binding_authority_version,
  delivery.receiver_binding_ref,
  delivery.receiver_binding_digest,
  delivery.receiver_binding_digest_scheme,
  delivery.receiver_binding_digest_key_id,
  delivery.payload_schema_version,
  delivery.payload_canonical_version,
  delivery.payload_digest,
  delivery.payload_digest_scheme,
  delivery.payload_digest_key_id,
  delivery.slo_class,
  delivery.slo_target_seconds,
  delivery.retry_policy_version,
  delivery.maximum_attempts,
  delivery.status,
  delivery.attempt_count,
  delivery.available_at,
  delivery.lease_owner,
  delivery.lease_expires_at,
  delivery.lease_generation,
  delivery.provider_started_at,
  delivery.provider_completed_at,
  delivery.receipt_digest,
  delivery.receipt_digest_scheme,
  delivery.receipt_digest_key_id,
  delivery.stable_error_code,
  delivery.created_at,
  delivery.updated_at,
  runtime_alert.alert_code,
  runtime_alert.severity,
  runtime_alert.observed_at,
  CURRENT_TIMESTAMP(3) AS db_now
`;
const SELECT_DELIVERY_BY_ID_SQL = `
  /* v1_runtime_alert_delivery:select_by_id */
  SELECT ${DELIVERY_COLUMNS}
  FROM v1_runtime_alert_delivery AS delivery
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_alert_id = delivery.runtime_alert_id
   AND runtime_alert.environment_id = delivery.environment_id
  WHERE delivery.environment_id = ?
    AND delivery.runtime_alert_delivery_id = ?
  LIMIT 2
`;
const LOCK_DELIVERY_BY_ID_SQL = `${SELECT_DELIVERY_BY_ID_SQL.trim()} FOR UPDATE`;
const LOCK_DUE_DELIVERY_SQL = `
  /* v1_runtime_alert_delivery:lock_due */
  SELECT ${DELIVERY_COLUMNS}
  FROM v1_runtime_alert_delivery AS delivery
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_alert_id = delivery.runtime_alert_id
   AND runtime_alert.environment_id = delivery.environment_id
  WHERE delivery.environment_id = ?
    AND delivery.registration_mode = 'CONTROLLED'
    AND delivery.receiver_binding_authority_version = ?
    AND delivery.receiver_binding_ref = ?
    AND delivery.status IN ('PENDING', 'RETRY_WAIT')
    AND delivery.available_at <= CURRENT_TIMESTAMP(3)
  ORDER BY delivery.slo_target_seconds,
           delivery.available_at,
           delivery.runtime_alert_delivery_id
  LIMIT 1 FOR UPDATE SKIP LOCKED
`;
const CLAIM_DELIVERY_SQL = `
  /* v1_runtime_alert_delivery:claim */
  CALL v1_runtime_alert_delivery_claim(?, ?, ?, ?, ?)
`;
const START_PROVIDER_SQL = `
  /* v1_runtime_alert_delivery:start_provider */
  CALL v1_runtime_alert_delivery_mark_provider_started(?, ?, ?, ?)
`;
const COMPLETE_DELIVERED_SQL = `
  /* v1_runtime_alert_delivery:complete_delivered */
  CALL v1_runtime_alert_delivery_complete_delivered(?, ?, ?, ?, ?, ?, ?)
`;
const RETRY_BEFORE_PROVIDER_SQL = `
  /* v1_runtime_alert_delivery:retry_before_provider */
  CALL v1_runtime_alert_delivery_fail_before_provider_retry(?, ?, ?, ?, ?, ?)
`;
const DEAD_LETTER_BEFORE_PROVIDER_SQL = `
  /* v1_runtime_alert_delivery:dead_letter_before_provider */
  CALL v1_runtime_alert_delivery_fail_before_provider_dead(?, ?, ?, ?, ?)
`;
const MARK_UNKNOWN_SQL = `
  /* v1_runtime_alert_delivery:mark_unknown */
  CALL v1_runtime_alert_delivery_mark_unknown(?, ?, ?, ?, ?)
`;
const LOCK_STALE_SQL = `
  /* v1_runtime_alert_delivery:lock_stale */
  SELECT ${DELIVERY_COLUMNS}
  FROM v1_runtime_alert_delivery AS delivery
  INNER JOIN v1_runtime_alert AS runtime_alert
    ON runtime_alert.runtime_alert_id = delivery.runtime_alert_id
   AND runtime_alert.environment_id = delivery.environment_id
  WHERE delivery.environment_id = ?
    AND delivery.registration_mode = 'CONTROLLED'
    AND delivery.receiver_binding_authority_version = ?
    AND delivery.receiver_binding_ref = ?
    AND delivery.status IN ('CLAIMED', 'STARTED')
    AND delivery.lease_expires_at <= CURRENT_TIMESTAMP(3)
  ORDER BY delivery.lease_expires_at, delivery.runtime_alert_delivery_id
  LIMIT ? FOR UPDATE SKIP LOCKED
`;
const RECOVER_STARTED_UNKNOWN_SQL = `
  /* v1_runtime_alert_delivery:recover_started_unknown */
  CALL v1_runtime_alert_delivery_recover_started_unknown(?, ?, ?, ?)
`;
const RECOVER_CLAIM_RETRY_SQL = `
  /* v1_runtime_alert_delivery:recover_claim_retry */
  CALL v1_runtime_alert_delivery_recover_claim_retry(?, ?, ?, ?, ?)
`;
const RECOVER_CLAIM_DEAD_SQL = `
  /* v1_runtime_alert_delivery:recover_claim_dead */
  CALL v1_runtime_alert_delivery_recover_claim_dead(?, ?, ?, ?)
`;
const INSPECT_SQL = `
  /* v1_runtime_alert_delivery:inspect */
  CALL v1_runtime_alert_delivery_inspect(?, ?, ?)
`;

function deliveryError(code) {
  const error = new Error("V1 runtime alert delivery persistence operation failed");
  error.name = "V1RuntimeAlertDeliveryPersistenceError";
  error.code = code;
  error.isV1RuntimeAlertDeliveryPersistenceError = true;
  return error;
}

function configurationError() {
  return deliveryError("V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID");
}
function inputError() { return deliveryError("V1_RUNTIME_ALERT_DELIVERY_INPUT_INVALID"); }
function persistenceError() { return deliveryError("V1_RUNTIME_ALERT_DELIVERY_PERSISTENCE_FAILED"); }
function conflictError() { return deliveryError("V1_RUNTIME_ALERT_DELIVERY_CONFLICT"); }
function fencedError() { return deliveryError("V1_RUNTIME_ALERT_DELIVERY_LEASE_FENCED"); }
function acknowledgementUnknownError() {
  return deliveryError("V1_RUNTIME_ALERT_DELIVERY_COMMIT_OUTCOME_UNKNOWN");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function digest(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function stableCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}
function opaqueAscii(value, maximumLength) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && /^[\x21-\x7e]+$/.test(value);
}
function databaseName(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/.test(value);
}
function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw persistenceError();
  return number;
}
function nonnegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw persistenceError();
  return number;
}
function publicInstant(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const epoch = Date.parse(normalized);
    if (Number.isFinite(epoch)) return new Date(epoch).toISOString();
  }
  throw persistenceError();
}
function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw persistenceError();
  return rows;
}
function singleRow(result, optional = false) {
  const rows = selectedRows(result);
  if ((optional && rows.length > 1) || (!optional && rows.length !== 1)) throw persistenceError();
  return rows[0] || null;
}
function procedureAffectedRows(result) {
  try {
    return readMysqlProcedureAffectedRows(Array.isArray(result) ? result[0] : null);
  } catch {
    throw persistenceError();
  }
}
function procedureRow(result) {
  try {
    return readMysqlProcedureResultRow(Array.isArray(result) ? result[0] : null);
  } catch {
    throw persistenceError();
  }
}
function hash(domain, ...values) {
  const hasher = crypto.createHash("sha256").update(domain, "utf8");
  for (const value of values) hasher.update("\0", "utf8").update(String(value), "utf8");
  return hasher.digest("hex");
}
function numberEnv(env, name, fallback, maximum) {
  const raw = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : String(fallback);
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) throw configurationError();
  const number = Number(raw);
  if (!boundedInteger(number, 1, maximum)) throw configurationError();
  return number;
}
function retryDelay(base, attemptCount) {
  return Math.min(MAXIMUM_BACKOFF_SECONDS, base * (2 ** Math.max(0, attemptCount - 1)));
}
function lockStaleSql(limit) {
  if (!boundedInteger(limit, 1, MAXIMUM_RECOVERY_LIMIT)) throw inputError();
  return LOCK_STALE_SQL.replace("LIMIT ?", `LIMIT ${limit}`);
}

function sloForSeverity(severity) {
  const slo = runtimeAlertDeliverySloForSeverity(severity);
  if (!slo) throw inputError();
  return slo;
}

function deliveryPayload(input) {
  return normalizePayload({
    alertCode: input.alertCode,
    deliveryId: input.deliveryId,
    observedAt: input.observedAt,
    runtimeAlertId: input.runtimeAlertId,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    severity: input.severity,
    sloClass: input.sloClass,
    sloTargetSeconds: input.sloTargetSeconds,
  });
}

function freezeDelivery(row) {
  if (!plainRecord(row)
    || !digest(row.runtime_alert_delivery_id)
    || !digest(row.runtime_alert_id)
    || !opaqueAscii(row.environment_id, 96)
    || !["DRY_RUN", "CONTROLLED"].includes(row.registration_mode)
    || row.receiver_binding_authority_version !== RECEIVER_BINDING_AUTHORITY_VERSION
    || !opaqueAscii(row.receiver_binding_ref, 128)
    || !digest(row.receiver_binding_digest)
    || row.receiver_binding_digest_scheme !== DIGEST_SCHEME
    || !opaqueAscii(row.receiver_binding_digest_key_id, 64)
    || row.payload_schema_version !== PAYLOAD_SCHEMA_VERSION
    || row.payload_canonical_version !== CANONICAL_VERSION
    || !digest(row.payload_digest)
    || row.payload_digest_scheme !== DIGEST_SCHEME
    || !opaqueAscii(row.payload_digest_key_id, 64)
    || !STATUSES.includes(row.status)
    || !stableCode(row.alert_code)
    || !["BLOCKER", "WARNING"].includes(row.severity)
    || row.retry_policy_version !== "pre-provider-exponential:v1") throw persistenceError();
  const attemptCount = nonnegativeInteger(row.attempt_count);
  const maximumAttempts = positiveInteger(row.maximum_attempts);
  const leaseGeneration = nonnegativeInteger(row.lease_generation);
  const sloTargetSeconds = positiveInteger(row.slo_target_seconds);
  const slo = sloForSeverity(row.severity);
  if (maximumAttempts > MAXIMUM_ATTEMPTS
    || attemptCount > maximumAttempts
    || row.slo_class !== slo.sloClass
    || sloTargetSeconds !== slo.sloTargetSeconds) throw persistenceError();
  const leaseOwner = row.lease_owner === null ? null : row.lease_owner;
  const leaseExpiresAt = publicInstant(row.lease_expires_at);
  const providerStartedAt = publicInstant(row.provider_started_at);
  const providerCompletedAt = publicInstant(row.provider_completed_at);
  const receiptPresent = row.receipt_digest !== null
    || row.receipt_digest_scheme !== null
    || row.receipt_digest_key_id !== null;
  const errorCode = row.stable_error_code === null ? null : row.stable_error_code;
  const claimed = row.status === "CLAIMED";
  const started = row.status === "STARTED";
  const delivered = row.status === "DELIVERED";
  const dead = row.status === "DEAD_LETTER";
  const unknown = row.status === "UNKNOWN";
  const retry = row.status === "RETRY_WAIT";
  if ((["PENDING", "RETRY_WAIT", "DEAD_LETTER"].includes(row.status)
      && providerStartedAt !== null)
    || ((claimed || started)
      && (!opaqueAscii(leaseOwner, 128) || !leaseExpiresAt || leaseGeneration < 1))
    || (!(claimed || started) && (leaseOwner !== null || leaseExpiresAt !== null))
    || (row.status === "PENDING" && (attemptCount !== 0 || leaseGeneration !== 0 || errorCode !== null))
    || (claimed && (attemptCount < 1 || providerStartedAt !== null || errorCode !== null))
    || (retry && (attemptCount < 1 || attemptCount >= maximumAttempts || errorCode === null))
    || (started && (attemptCount < 1 || !providerStartedAt || errorCode !== null))
    || ((delivered || dead || unknown) && !providerCompletedAt)
    || (delivered && (!providerStartedAt || !receiptPresent || errorCode !== null))
    || ((dead || unknown) && (receiptPresent || errorCode === null))
    || (unknown && !providerStartedAt)
    || (dead && providerStartedAt !== null)
    || (!(delivered || dead || unknown) && providerCompletedAt !== null)
    || (!delivered && receiptPresent)
    || (receiptPresent && (!digest(row.receipt_digest)
      || row.receipt_digest_scheme !== DIGEST_SCHEME
      || !opaqueAscii(row.receipt_digest_key_id, 64)))
    || (errorCode !== null && !stableCode(errorCode))) throw persistenceError();
  if (started && providerStartedAt >= leaseExpiresAt) throw persistenceError();
  const observedAt = publicInstant(row.observed_at);
  const payload = deliveryPayload({
    alertCode: row.alert_code,
    deliveryId: row.runtime_alert_delivery_id,
    observedAt,
    runtimeAlertId: row.runtime_alert_id,
    severity: row.severity,
    ...slo,
  });
  return Object.freeze({
    deliveryId: row.runtime_alert_delivery_id,
    runtimeAlertId: row.runtime_alert_id,
    environmentId: row.environment_id,
    registrationMode: row.registration_mode,
    receiverBindingAuthorityVersion: row.receiver_binding_authority_version,
    receiverBindingRef: row.receiver_binding_ref,
    receiverBindingDigest: row.receiver_binding_digest,
    receiverBindingDigestScheme: row.receiver_binding_digest_scheme,
    receiverBindingDigestKeyId: row.receiver_binding_digest_key_id,
    payload,
    payloadDigest: row.payload_digest,
    payloadDigestScheme: row.payload_digest_scheme,
    payloadDigestKeyId: row.payload_digest_key_id,
    payloadCanonicalVersion: row.payload_canonical_version,
    retryPolicyVersion: row.retry_policy_version,
    maximumAttempts,
    status: row.status,
    attemptCount,
    availableAt: publicInstant(row.available_at),
    leaseOwner,
    leaseExpiresAt,
    leaseGeneration,
    providerStartedAt,
    providerCompletedAt,
    receiptDigest: row.receipt_digest,
    receiptDigestScheme: row.receipt_digest_scheme,
    receiptDigestKeyId: row.receipt_digest_key_id,
    errorCode,
    databaseNow: publicInstant(row.db_now),
  });
}

function createMysqlV1RuntimeAlertDeliveryAdapter(options = {}) {
  const validKeys = exactKeys(options, ["pool", "env"])
    || exactKeys(options, ["pool", "env", "payloadAdapter"]);
  if (!validKeys || !options.pool || typeof options.pool.getConnection !== "function"
    || !plainRecord(options.env)) throw configurationError();
  const { pool, env } = options;
  const mode = runtimeAlertDeliveryMode(env);
  const configuredDatabase = env.MYSQL_DATABASE;
  const environmentId = env.MYROOT_V1_RUNTIME_ENVIRONMENT_ID;
  if (!databaseName(configuredDatabase) || !opaqueAscii(environmentId, 96)) {
    throw configurationError();
  }
  const maximumAttempts = numberEnv(
    env,
    "MYROOT_V1_RUNTIME_ALERT_DELIVERY_MAXIMUM_ATTEMPTS",
    DEFAULT_MAXIMUM_ATTEMPTS,
    MAXIMUM_ATTEMPTS
  );
  const baseBackoffSeconds = numberEnv(
    env,
    "MYROOT_V1_RUNTIME_ALERT_DELIVERY_BACKOFF_SECONDS",
    DEFAULT_BACKOFF_SECONDS,
    MAXIMUM_BACKOFF_SECONDS
  );
  const payloadAdapter = mode === "DISABLED"
    ? null
    : (options.payloadAdapter || createV1RuntimeAlertPayloadAdapter(env));
  if (payloadAdapter && (!payloadAdapter.binding
    || typeof payloadAdapter.sign !== "function"
    || typeof payloadAdapter.verify !== "function"
    || typeof payloadAdapter.prepare !== "function"
    || typeof payloadAdapter.verifyBinding !== "function"
    || typeof payloadAdapter.digestReceipt !== "function")) throw configurationError();

  async function retire(connection, destroy) {
    if (!connection) return;
    if (!destroy) {
      try {
        await connection.execute(SET_TIME_ZONE_SQL, [MYSQL_POOL_TIME_ZONE]);
        const restored = singleRow(await connection.execute(SELECT_TIME_ZONE_SQL));
        if (!plainRecord(restored) || restored.session_time_zone !== MYSQL_POOL_TIME_ZONE) {
          destroy = true;
        }
      } catch { destroy = true; }
    }
    try { if (destroy) connection.destroy(); else connection.release(); } catch {}
  }

  async function acquire() {
    let connection;
    try {
      connection = await pool.getConnection();
      if (!connection
        || typeof connection.execute !== "function"
        || typeof connection.beginTransaction !== "function"
        || typeof connection.commit !== "function"
        || typeof connection.rollback !== "function"
        || typeof connection.release !== "function"
        || typeof connection.destroy !== "function") throw configurationError();
      const authority = singleRow(await connection.execute(SELECT_DATABASE_SQL));
      if (!plainRecord(authority) || authority.database_name !== configuredDatabase) {
        throw deliveryError("V1_RUNTIME_ALERT_DELIVERY_TARGET_DATABASE_MISMATCH");
      }
      await connection.execute(SET_TIME_ZONE_SQL, [MYSQL_SESSION_TIME_ZONE]);
      return connection;
    } catch (error) {
      if (connection) await retire(connection, true);
      if (error && error.isV1RuntimeAlertDeliveryPersistenceError) throw error;
      throw persistenceError();
    }
  }

  async function readFresh(deliveryId) {
    const connection = await acquire();
    let destroy = false;
    try {
      const row = singleRow(await connection.execute(
        SELECT_DELIVERY_BY_ID_SQL,
        [environmentId, deliveryId]
      ), true);
      return row ? freezeDelivery(row) : null;
    } catch (error) {
      destroy = true;
      throw error && error.isV1RuntimeAlertDeliveryPersistenceError
        ? error : persistenceError();
    } finally { await retire(connection, destroy); }
  }

  async function registerAlertInTransaction(connection, input = {}) {
    if (mode === "DISABLED") return Object.freeze({ outcome: "DISABLED" });
    if (!connection || typeof connection.execute !== "function"
      || !exactKeys(input, [
        "runtimeAlertId", "environmentId", "alertCode", "severity", "observedAt",
      ])
      || !digest(input.runtimeAlertId)
      || input.environmentId !== environmentId
      || !stableCode(input.alertCode)
      || !["BLOCKER", "WARNING"].includes(input.severity)) throw inputError();
    const observedAt = publicInstant(input.observedAt);
    const binding = payloadAdapter.binding;
    if (binding.registrationMode !== mode
      || binding.authorityVersion !== RECEIVER_BINDING_AUTHORITY_VERSION) {
      throw configurationError();
    }
    const deliveryId = hash(
      "myroot:v1-runtime-alert:delivery-id:v1",
      input.runtimeAlertId,
      binding.authorityVersion,
      binding.ref
    );
    const slo = sloForSeverity(input.severity);
    const payload = deliveryPayload({
      alertCode: input.alertCode,
      deliveryId,
      observedAt,
      runtimeAlertId: input.runtimeAlertId,
      severity: input.severity,
      ...slo,
    });
    const signed = payloadAdapter.sign(payload);
    const expected = Object.freeze({
      deliveryId,
      runtimeAlertId: input.runtimeAlertId,
      environmentId,
      registrationMode: mode,
      receiverBindingAuthorityVersion: binding.authorityVersion,
      receiverBindingRef: binding.ref,
      receiverBindingDigest: binding.digest,
      receiverBindingDigestScheme: binding.digestScheme,
      receiverBindingDigestKeyId: binding.keyId,
      payloadDigest: signed.digest,
      payloadDigestScheme: signed.digestScheme,
      payloadDigestKeyId: signed.keyId,
      sloClass: slo.sloClass,
      sloTargetSeconds: slo.sloTargetSeconds,
    });
    const registrationSql = mode === "DRY_RUN"
      ? REGISTER_DRY_RUN_SQL : REGISTER_CONTROLLED_SQL;
    const row = procedureRow(await connection.execute(registrationSql, [
      deliveryId,
      input.runtimeAlertId,
      environmentId,
      signed.digest,
      signed.keyId,
      slo.sloClass,
      slo.sloTargetSeconds,
      maximumAttempts,
    ]));
    const outcome = row.operation_outcome;
    if (!["REGISTERED", "REPLAY"].includes(outcome)) throw persistenceError();
    const storedBinding = Object.freeze({
      authorityVersion: row.receiver_binding_authority_version,
      registrationMode: row.registration_mode,
      ref: row.receiver_binding_ref,
      digest: row.receiver_binding_digest,
      digestScheme: row.receiver_binding_digest_scheme,
      keyId: row.receiver_binding_digest_key_id,
    });
    const storedSignature = Object.freeze({
      canonicalVersion: row.payload_canonical_version,
      digestScheme: row.payload_digest_scheme,
      keyId: row.payload_digest_key_id,
      digest: row.payload_digest,
    });
    if (row.runtime_alert_delivery_id !== expected.deliveryId
      || row.runtime_alert_id !== expected.runtimeAlertId
      || row.environment_id !== expected.environmentId
      || row.registration_mode !== expected.registrationMode
      || row.receiver_binding_authority_version
        !== expected.receiverBindingAuthorityVersion
      || row.receiver_binding_ref !== expected.receiverBindingRef
      || !payloadAdapter.verifyBinding(storedBinding)
      || row.payload_schema_version !== PAYLOAD_SCHEMA_VERSION
      || !payloadAdapter.verify(storedSignature, payload)
      || row.slo_class !== expected.sloClass
      || Number(row.slo_target_seconds) !== expected.sloTargetSeconds
      || row.retry_policy_version !== "pre-provider-exponential:v1"
      || Number(row.maximum_attempts) !== maximumAttempts
      || !STATUSES.includes(row.status)) throw conflictError();
    return Object.freeze({
      outcome,
      ...expected,
      receiverBindingDigest: row.receiver_binding_digest,
      receiverBindingDigestScheme: row.receiver_binding_digest_scheme,
      receiverBindingDigestKeyId: row.receiver_binding_digest_key_id,
      payloadDigest: row.payload_digest,
      payloadDigestScheme: row.payload_digest_scheme,
      payloadDigestKeyId: row.payload_digest_key_id,
    });
  }

  async function claimNext(input = {}) {
    if (mode !== "CONTROLLED") throw configurationError();
    if (!exactKeys(input, ["leaseOwner", "leaseSeconds"])
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseSeconds, 1, MAXIMUM_LEASE_SECONDS)) throw inputError();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expected;
    try {
      await connection.beginTransaction();
      began = true;
      const row = singleRow(await connection.execute(
        LOCK_DUE_DELIVERY_SQL,
        [environmentId, RECEIVER_BINDING_AUTHORITY_VERSION, payloadAdapter.binding.ref]
      ), true);
      if (!row) {
        commitAttempted = true;
        await connection.commit();
        await retire(connection, false);
        return null;
      }
      const current = freezeDelivery(row);
      if (!["PENDING", "RETRY_WAIT"].includes(current.status)
        || current.registrationMode !== "CONTROLLED"
        || current.receiverBindingAuthorityVersion !== RECEIVER_BINDING_AUTHORITY_VERSION
        || current.receiverBindingRef !== payloadAdapter.binding.ref
        || current.attemptCount >= current.maximumAttempts) throw conflictError();
      if (procedureAffectedRows(await connection.execute(CLAIM_DELIVERY_SQL, [
        environmentId,
        current.deliveryId,
        payloadAdapter.binding.ref,
        input.leaseOwner,
        input.leaseSeconds,
      ])) !== 1) throw fencedError();
      expected = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, current.deliveryId]
      )));
      if (expected.status !== "CLAIMED"
        || expected.registrationMode !== "CONTROLLED"
        || expected.receiverBindingAuthorityVersion !== RECEIVER_BINDING_AUTHORITY_VERSION
        || expected.receiverBindingRef !== payloadAdapter.binding.ref
        || expected.leaseOwner !== input.leaseOwner
        || expected.leaseGeneration !== current.leaseGeneration + 1
        || expected.attemptCount !== current.attemptCount + 1
        || expected.leaseExpiresAt <= expected.databaseNow) throw persistenceError();
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expected;
    } catch (error) {
      if (began && !commitAttempted) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted && expected) {
        try {
          const fresh = await readFresh(expected.deliveryId);
          if (fresh && fresh.status === "CLAIMED"
            && fresh.leaseOwner === expected.leaseOwner
            && fresh.leaseGeneration === expected.leaseGeneration
            && fresh.attemptCount === expected.attemptCount) return fresh;
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw error && error.isV1RuntimeAlertDeliveryPersistenceError
        ? error : persistenceError();
    }
  }

  async function mutateClaim(input, operation) {
    if (mode !== "CONTROLLED") throw configurationError();
    if (!exactKeys(input, ["deliveryId", "leaseOwner", "leaseGeneration"])
      || !digest(input.deliveryId)
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseGeneration, 1, Number.MAX_SAFE_INTEGER)) throw inputError();
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    let expected;
    try {
      await connection.beginTransaction();
      began = true;
      const current = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, input.deliveryId]
      ), true));
      if (current.registrationMode !== "CONTROLLED"
        || current.receiverBindingAuthorityVersion !== RECEIVER_BINDING_AUTHORITY_VERSION
        || current.receiverBindingRef !== payloadAdapter.binding.ref) throw fencedError();
      expected = await operation(connection, current);
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expected;
    } catch (error) {
      if (began && !commitAttempted) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted && expected) {
        try {
          const fresh = await readFresh(input.deliveryId);
          if (fresh && fresh.status === expected.status
            && fresh.leaseGeneration === expected.leaseGeneration) return fresh;
        } catch {}
        throw acknowledgementUnknownError();
      }
      throw error && error.isV1RuntimeAlertDeliveryPersistenceError
        ? error : persistenceError();
    }
  }

  async function markProviderStarted(input = {}) {
    return mutateClaim(input, async (connection, current) => {
      if (current.status !== "CLAIMED"
        || current.leaseOwner !== input.leaseOwner
        || current.leaseGeneration !== input.leaseGeneration
        || current.leaseExpiresAt <= current.databaseNow) throw fencedError();
      if (procedureAffectedRows(await connection.execute(START_PROVIDER_SQL, [
        environmentId,
        input.deliveryId,
        input.leaseOwner,
        input.leaseGeneration,
      ])) !== 1) throw fencedError();
      const started = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, input.deliveryId]
      )));
      if (started.status !== "STARTED"
        || started.leaseOwner !== input.leaseOwner
        || started.leaseGeneration !== input.leaseGeneration
        || !started.providerStartedAt) throw persistenceError();
      return started;
    });
  }

  async function completeDelivered(input = {}) {
    if (!exactKeys(input, [
      "deliveryId", "leaseOwner", "leaseGeneration",
      "receiptDigest", "receiptDigestScheme", "receiptDigestKeyId",
    ])
      || !digest(input.receiptDigest)
      || input.receiptDigestScheme !== DIGEST_SCHEME
      || !opaqueAscii(input.receiptDigestKeyId, 64)) throw inputError();
    const claim = {
      deliveryId: input.deliveryId,
      leaseOwner: input.leaseOwner,
      leaseGeneration: input.leaseGeneration,
    };
    return mutateClaim(claim, async (connection, current) => {
      if (current.status === "DELIVERED") {
        if (current.receiptDigest === input.receiptDigest
          && current.receiptDigestScheme === input.receiptDigestScheme
          && current.receiptDigestKeyId === input.receiptDigestKeyId) return current;
        throw conflictError();
      }
      if (current.status !== "STARTED"
        || current.leaseOwner !== input.leaseOwner
        || current.leaseGeneration !== input.leaseGeneration
        || current.leaseExpiresAt <= current.databaseNow) throw fencedError();
      if (procedureAffectedRows(await connection.execute(COMPLETE_DELIVERED_SQL, [
        environmentId,
        input.deliveryId,
        input.leaseOwner,
        input.leaseGeneration,
        input.receiptDigest,
        input.receiptDigestScheme,
        input.receiptDigestKeyId,
      ])) !== 1) throw fencedError();
      const delivered = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, input.deliveryId]
      )));
      if (delivered.status !== "DELIVERED"
        || delivered.receiptDigest !== input.receiptDigest
        || delivered.receiptDigestKeyId !== input.receiptDigestKeyId) throw persistenceError();
      return delivered;
    });
  }

  async function failBeforeProvider(input = {}) {
    if (!exactKeys(input, [
      "deliveryId", "leaseOwner", "leaseGeneration", "errorCode", "retryable",
    ])
      || typeof input.retryable !== "boolean"
      || !stableCode(input.errorCode)) throw inputError();
    const claim = {
      deliveryId: input.deliveryId,
      leaseOwner: input.leaseOwner,
      leaseGeneration: input.leaseGeneration,
    };
    return mutateClaim(claim, async (connection, current) => {
      if (current.status !== "CLAIMED"
        || current.leaseOwner !== input.leaseOwner
        || current.leaseGeneration !== input.leaseGeneration
        || current.providerStartedAt !== null
        || current.leaseExpiresAt <= current.databaseNow) throw fencedError();
      const retry = input.retryable && current.attemptCount < current.maximumAttempts;
      const result = retry
        ? await connection.execute(RETRY_BEFORE_PROVIDER_SQL, [
          environmentId,
          input.deliveryId,
          input.leaseOwner,
          input.leaseGeneration,
          retryDelay(baseBackoffSeconds, current.attemptCount),
          input.errorCode,
        ])
        : await connection.execute(DEAD_LETTER_BEFORE_PROVIDER_SQL, [
          environmentId,
          input.deliveryId,
          input.leaseOwner,
          input.leaseGeneration,
          input.errorCode,
        ]);
      if (procedureAffectedRows(result) !== 1) throw fencedError();
      const persisted = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, input.deliveryId]
      )));
      if (persisted.status !== (retry ? "RETRY_WAIT" : "DEAD_LETTER")
        || persisted.errorCode !== input.errorCode
        || persisted.leaseGeneration !== input.leaseGeneration + 1) throw persistenceError();
      return persisted;
    });
  }

  async function markUnknown(input = {}) {
    if (!exactKeys(input, [
      "deliveryId", "leaseOwner", "leaseGeneration", "errorCode",
    ]) || !stableCode(input.errorCode)) throw inputError();
    const claim = {
      deliveryId: input.deliveryId,
      leaseOwner: input.leaseOwner,
      leaseGeneration: input.leaseGeneration,
    };
    return mutateClaim(claim, async (connection, current) => {
      if (["DELIVERED", "UNKNOWN"].includes(current.status)) return current;
      if (current.status !== "STARTED"
        || current.leaseOwner !== input.leaseOwner
        || current.leaseGeneration !== input.leaseGeneration) throw fencedError();
      if (procedureAffectedRows(await connection.execute(MARK_UNKNOWN_SQL, [
        environmentId,
        input.deliveryId,
        input.leaseOwner,
        input.leaseGeneration,
        input.errorCode,
      ])) !== 1) throw fencedError();
      const unknown = freezeDelivery(singleRow(await connection.execute(
        LOCK_DELIVERY_BY_ID_SQL,
        [environmentId, input.deliveryId]
      )));
      if (unknown.status !== "UNKNOWN"
        || unknown.errorCode !== input.errorCode
        || unknown.leaseGeneration !== input.leaseGeneration + 1) throw persistenceError();
      return unknown;
    });
  }

  async function recoverStale(input = {}) {
    if (!exactKeys(input, ["limit"])
      || !boundedInteger(input.limit, 1, MAXIMUM_RECOVERY_LIMIT)) throw inputError();
    if (mode !== "CONTROLLED") {
      return Object.freeze({
        mode,
        recoveredBeforeProviderCount: 0,
        unknownCount: 0,
        deadLetterCount: 0,
        deliveryIds: Object.freeze([]),
      });
    }
    const connection = await acquire();
    let began = false;
    let commitAttempted = false;
    const deliveryIds = [];
    let recoveredBeforeProviderCount = 0;
    let unknownCount = 0;
    let deadLetterCount = 0;
    try {
      await connection.beginTransaction();
      began = true;
      const rows = selectedRows(await connection.execute(lockStaleSql(input.limit), [
        environmentId,
        RECEIVER_BINDING_AUTHORITY_VERSION,
        payloadAdapter.binding.ref,
      ]));
      if (rows.length > input.limit) throw persistenceError();
      for (const row of rows) {
        const current = freezeDelivery(row);
        let result;
        if (current.status === "STARTED") {
          result = await connection.execute(RECOVER_STARTED_UNKNOWN_SQL, [
            environmentId,
            current.deliveryId,
            current.leaseOwner,
            current.leaseGeneration,
          ]);
          unknownCount += 1;
        } else if (current.status === "CLAIMED"
          && current.attemptCount < current.maximumAttempts) {
          result = await connection.execute(RECOVER_CLAIM_RETRY_SQL, [
            environmentId,
            current.deliveryId,
            current.leaseOwner,
            current.leaseGeneration,
            retryDelay(baseBackoffSeconds, current.attemptCount),
          ]);
          recoveredBeforeProviderCount += 1;
        } else if (current.status === "CLAIMED") {
          result = await connection.execute(RECOVER_CLAIM_DEAD_SQL, [
            environmentId,
            current.deliveryId,
            current.leaseOwner,
            current.leaseGeneration,
          ]);
          deadLetterCount += 1;
        } else {
          throw conflictError();
        }
        if (procedureAffectedRows(result) !== 1) throw fencedError();
        deliveryIds.push(current.deliveryId);
      }
      const expected = Object.freeze({
        mode,
        recoveredBeforeProviderCount,
        unknownCount,
        deadLetterCount,
        deliveryIds: Object.freeze(deliveryIds),
      });
      commitAttempted = true;
      await connection.commit();
      await retire(connection, false);
      return expected;
    } catch (error) {
      if (began && !commitAttempted) { try { await connection.rollback(); } catch {} }
      await retire(connection, true);
      if (commitAttempted) throw acknowledgementUnknownError();
      throw error && error.isV1RuntimeAlertDeliveryPersistenceError
        ? error : persistenceError();
    }
  }

  async function inspect() {
    if (mode === "DISABLED") {
      return Object.freeze({
        mode,
        registrationRequired: false,
        totalCount: 0,
        dryRunRecordedCount: 0,
        controlledCount: 0,
        authorityMismatchCount: 0,
        pendingCount: 0,
        claimedCount: 0,
        retryWaitCount: 0,
        startedCount: 0,
        deliveredCount: 0,
        deadLetterCount: 0,
        unknownCount: 0,
        reviewRequiredCount: 0,
        oldestAvailableAt: null,
        inspectedAt: null,
      });
    }
    const connection = await acquire();
    let destroy = false;
    try {
      const row = procedureRow(await connection.execute(INSPECT_SQL, [
        environmentId,
        RECEIVER_BINDING_AUTHORITY_VERSION,
        payloadAdapter.binding.ref,
      ]));
      const result = Object.freeze({
        mode,
        registrationRequired: true,
        totalCount: nonnegativeInteger(row.total_count),
        dryRunRecordedCount: nonnegativeInteger(row.dry_run_recorded_count),
        controlledCount: nonnegativeInteger(row.controlled_count),
        authorityMismatchCount: nonnegativeInteger(row.authority_mismatch_count),
        pendingCount: nonnegativeInteger(row.pending_count),
        claimedCount: nonnegativeInteger(row.claimed_count),
        retryWaitCount: nonnegativeInteger(row.retry_wait_count),
        startedCount: nonnegativeInteger(row.started_count),
        deliveredCount: nonnegativeInteger(row.delivered_count),
        deadLetterCount: nonnegativeInteger(row.dead_letter_count),
        unknownCount: nonnegativeInteger(row.unknown_count),
        reviewRequiredCount: nonnegativeInteger(row.unknown_count)
          + nonnegativeInteger(row.dead_letter_count)
          + nonnegativeInteger(row.authority_mismatch_count),
        oldestAvailableAt: publicInstant(row.oldest_available_at),
        inspectedAt: publicInstant(row.db_now),
      });
      await retire(connection, false);
      return result;
    } catch (error) {
      destroy = true;
      throw error && error.isV1RuntimeAlertDeliveryPersistenceError
        ? error : persistenceError();
    } finally { if (destroy) await retire(connection, true); }
  }

  return Object.freeze({
    mode,
    registrationRequired: mode !== "DISABLED",
    payloadAdapter,
    registerAlertInTransaction,
    claimNext,
    markProviderStarted,
    completeDelivered,
    failBeforeProvider,
    markUnknown,
    recoverStale,
    inspect,
  });
}

module.exports = {
  createMysqlV1RuntimeAlertDeliveryAdapter,
  deliveryPayload,
};
