const crypto = require("node:crypto");

const { atomicWriteFailure } = require("./atomicWriteError");
const { verifyLegacySha256V0 } = require("./commandRequestDigest");
const {
  COMMAND_IDEMPOTENCY_STATUS,
  commandIdempotencyError,
  commandRecordIdFor,
  decodeStoredCommandResult,
  encodeStoredCommandResult,
  normalizeCommandDescriptor,
  publicCommandRecord,
  safeCommandError,
} = require("./commandIdempotency");

const DEFAULT_LEASE_DURATION_SECONDS = 30;
const MAX_LEASE_DURATION_SECONDS = 15 * 60;
const CANONICAL_REQUEST_VERSION = "canonical-json:v1";
const CURRENT_REQUEST_DIGEST_SCHEME = "hmac-sha256:v1";
const LEGACY_REQUEST_DIGEST_SCHEME = "sha256:v0";
const RESULT_CODEC_VERSION = "A256GCM:v1";

const SELECT_SCOPE_SQL = `/* command-idempotency:select-scope */
SELECT command_idempotency.*,
       CASE
         WHEN lease_expires_at IS NOT NULL AND lease_expires_at <= CURRENT_TIMESTAMP(3) THEN 1
         ELSE 0
       END AS lease_expired
FROM command_idempotency
WHERE command_name = ? AND actor_id = ? AND idempotency_key = ?
LIMIT 1
FOR UPDATE`;

const INSERT_CLAIM_SQL = `/* command-idempotency:insert-claim */
INSERT INTO command_idempotency (
  command_idempotency_id,
  command_name,
  actor_id,
  actor_type,
  idempotency_key,
  request_digest,
  request_digest_scheme,
  request_digest_key_id,
  request_json,
  status,
  attempt_count,
  result_json,
  result_ref,
  error_json,
  last_attempt_request_id,
  started_at,
  completed_at,
  failed_at,
  retain_until,
  tombstoned_at,
  lease_owner,
  lease_expires_at,
  lease_generation,
  created_at,
  updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'IN_PROGRESS', ?, NULL, NULL, NULL, NULL,
  CURRENT_TIMESTAMP(3), NULL, NULL, NULL, NULL, ?,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND), 1,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
)`;

const INSERT_LEGACY_SUCCESS_SQL = `/* command-idempotency:insert-legacy-success */
INSERT INTO command_idempotency (
  command_idempotency_id,
  command_name,
  actor_id,
  actor_type,
  idempotency_key,
  request_digest,
  request_digest_scheme,
  request_digest_key_id,
  request_json,
  status,
  attempt_count,
  result_json,
  result_ref,
  result_codec_version,
  result_key_id,
  error_json,
  last_attempt_request_id,
  started_at,
  completed_at,
  failed_at,
  retain_until,
  tombstoned_at,
  lease_owner,
  lease_expires_at,
  lease_generation,
  created_at,
  updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SUCCEEDED', ?, ?, NULL, ?, ?, NULL, NULL,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL, NULL, NULL, NULL, NULL, ?,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
)`;

const TAKEOVER_SQL = `/* command-idempotency:takeover */
UPDATE command_idempotency
SET lease_owner = ?,
    lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
    lease_generation = lease_generation + 1,
    attempt_count = attempt_count + 1,
    started_at = CURRENT_TIMESTAMP(3),
    completed_at = NULL,
    failed_at = NULL,
    result_json = NULL,
    result_codec_version = NULL,
    result_key_id = NULL,
    error_json = NULL,
    request_digest = ?,
    request_digest_scheme = ?,
    request_digest_key_id = ?,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id <=> ?
  AND status = 'IN_PROGRESS'
  AND lease_owner <=> ?
  AND lease_generation = ?
  AND lease_expires_at <= CURRENT_TIMESTAMP(3)`;

const RETRY_SQL = `/* command-idempotency:retry */
UPDATE command_idempotency
SET status = 'IN_PROGRESS',
    lease_owner = ?,
    lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
    lease_generation = lease_generation + 1,
    attempt_count = attempt_count + 1,
    started_at = CURRENT_TIMESTAMP(3),
    completed_at = NULL,
    failed_at = NULL,
    result_json = NULL,
    result_codec_version = NULL,
    result_key_id = NULL,
    error_json = NULL,
    request_digest = ?,
    request_digest_scheme = ?,
    request_digest_key_id = ?,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id <=> ?
  AND status = 'FAILED'
  AND lease_generation = ?`;

const LOCK_OWNED_SQL = `/* command-idempotency:lock-owned */
SELECT *
FROM command_idempotency
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id <=> ?
  AND status = 'IN_PROGRESS'
  AND lease_owner = ?
  AND lease_generation = ?
  AND lease_expires_at > CURRENT_TIMESTAMP(3)
LIMIT 1
FOR UPDATE`;

const COMPLETE_SQL = `/* command-idempotency:complete */
UPDATE command_idempotency
SET status = 'SUCCEEDED',
    result_json = ?,
    result_ref = NULL,
    result_codec_version = ?,
    result_key_id = ?,
    error_json = NULL,
    completed_at = CURRENT_TIMESTAMP(3),
    failed_at = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id <=> ?
  AND status = 'IN_PROGRESS'
  AND lease_owner = ?
  AND lease_generation = ?`;

const FAIL_SQL = `/* command-idempotency:fail */
UPDATE command_idempotency
SET status = 'FAILED',
    result_json = NULL,
    result_ref = NULL,
    result_codec_version = NULL,
    result_key_id = NULL,
    error_json = ?,
    completed_at = NULL,
    failed_at = CURRENT_TIMESTAMP(3),
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id <=> ?
  AND status = 'IN_PROGRESS'
  AND lease_owner = ?
  AND lease_generation = ?`;

const UPGRADE_LEGACY_SUCCESS_SQL = `/* command-idempotency:upgrade-legacy-success */
UPDATE command_idempotency
SET request_digest = ?,
    request_digest_scheme = ?,
    request_digest_key_id = ?,
    result_json = ?,
    result_codec_version = ?,
    result_key_id = ?,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE command_idempotency_id = ?
  AND command_name = ?
  AND actor_id = ?
  AND idempotency_key = ?
  AND request_digest = ?
  AND request_digest_scheme = ?
  AND request_digest_key_id IS NULL
  AND status = 'SUCCEEDED'`;

function persistenceCause() {
  return new Error("command idempotency persistence failed");
}

function persistenceFailure() {
  return atomicWriteFailure(persistenceCause());
}

function rowsFrom(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}

function affectedRowsFrom(result) {
  return Number(result && result[0] && result[0].affectedRows) || 0;
}

function duplicateError(error) {
  return Boolean(error && (error.code === "ER_DUP_ENTRY" || Number(error.errno) === 1062));
}

function parseJsonColumn(value) {
  try {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
    if (typeof value === "string") return JSON.parse(value);
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw persistenceFailure();
  }
}

function text(value) {
  return String(value || "").trim();
}

function rawText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  throw persistenceFailure();
}

function optionalRawText(value) {
  if (value === null || value === undefined) return null;
  return rawText(value);
}

function utf8BytesEqual(actual, expected) {
  if (typeof expected !== "string") return false;
  const actualBytes = Buffer.isBuffer(actual)
    ? actual
    : typeof actual === "string"
      ? Buffer.from(actual, "utf8")
      : null;
  return Boolean(actualBytes && actualBytes.equals(Buffer.from(expected, "utf8")));
}

function exactNullableTextEqual(actual, expected) {
  if (expected === null) return actual === null || actual === undefined;
  return utf8BytesEqual(actual, expected);
}

function ownInputValue(input, camelName, snakeName) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw commandIdempotencyError(40001, "命令幂等输入无效", 400);
  }
  for (const key of [camelName, snakeName].filter(Boolean)) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property) continue;
    if (typeof property.get === "function" || typeof property.set === "function") {
      throw commandIdempotencyError(40001, "命令幂等输入无效", 400);
    }
    return property.value;
  }
  return undefined;
}

function positiveInteger(value, fallback = 1) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

function idempotencyKeyToken(rawKey) {
  return `cmdkey_${crypto.createHash("sha256").update(rawKey, "utf8").digest("hex")}`;
}

function actorType(input) {
  const normalized = text(ownInputValue(input, "actorType", "actor_type"));
  if (!normalized) return null;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalized)) {
    throw commandIdempotencyError(40001, "actorType 格式无效", 400);
  }
  return normalized;
}

function relationalDescriptor(descriptor, digestMetadata) {
  return {
    ...descriptor,
    idempotencyKey: idempotencyKeyToken(descriptor.idempotencyKey),
    requestDigest: digestMetadata.digest,
    requestDigestScheme: digestMetadata.digestVersion,
    requestDigestKeyId: digestMetadata.keyId,
  };
}

function normalizedCommandInput(input) {
  const request = ownInputValue(input, "request");
  const legacyDescriptor = normalizeCommandDescriptor({
    commandName: ownInputValue(input, "commandName", "command_name"),
    actorId: ownInputValue(input, "actorId", "actor_id"),
    idempotencyKey: ownInputValue(input, "idempotencyKey", "idempotency_key"),
    request,
  });
  return {
    legacyDescriptor,
    request,
    digestInput: {
      commandName: legacyDescriptor.commandName,
      actorId: legacyDescriptor.actorId,
      idempotencyKey: legacyDescriptor.idempotencyKey,
      request,
    },
  };
}

function assertExactScopeRow(row, descriptor) {
  if (
    !row
    || !utf8BytesEqual(row.command_name, descriptor.commandName)
    || !utf8BytesEqual(row.actor_id, descriptor.actorId)
    || !utf8BytesEqual(row.idempotency_key, descriptor.idempotencyKey)
  ) throw persistenceFailure();
}

function assertExactOwnedRow(row, claim) {
  assertExactScopeRow(row, {
    commandName: claim.commandName,
    actorId: claim.actorId,
    idempotencyKey: claim.idempotencyKeyToken,
  });
  if (
    !utf8BytesEqual(row.request_digest, claim.requestDigest)
    || !utf8BytesEqual(row.request_digest_scheme, claim.requestDigestScheme)
    || !exactNullableTextEqual(row.request_digest_key_id, claim.requestDigestKeyId)
  ) throw persistenceFailure();
}

function rowRecord(row) {
  return {
    recordId: rawText(row.command_idempotency_id),
    commandName: rawText(row.command_name),
    actorId: rawText(row.actor_id),
    idempotencyKey: rawText(row.idempotency_key),
    requestDigest: rawText(row.request_digest),
    status: text(row.status),
    attempts: nonNegativeInteger(row.attempt_count),
    createdAt: row.created_at || "",
    startedAt: row.started_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || "",
    failedAt: row.failed_at || "",
    result: parseJsonColumn(row.result_json),
    error: parseJsonColumn(row.error_json),
  };
}

function activeClaim(row) {
  const claim = {
    recordId: rawText(row.command_idempotency_id),
    commandName: rawText(row.command_name),
    actorId: rawText(row.actor_id),
    idempotencyKeyToken: rawText(row.idempotency_key),
    requestDigest: rawText(row.request_digest),
    requestDigestScheme: rawText(row.request_digest_scheme),
    requestDigestKeyId: optionalRawText(row.request_digest_key_id),
    leaseOwner: rawText(row.lease_owner),
    leaseGeneration: positiveInteger(row.lease_generation, 0),
    attemptCount: positiveInteger(row.attempt_count, 0),
  };
  if (
    !/^cmdidem_[a-f0-9]{24}$/.test(claim.recordId)
    || !claim.commandName
    || !claim.actorId
    || !/^cmdkey_[a-f0-9]{64}$/.test(claim.idempotencyKeyToken)
    || !/^[a-f0-9]{64}$/.test(claim.requestDigest)
    || ![CURRENT_REQUEST_DIGEST_SCHEME, LEGACY_REQUEST_DIGEST_SCHEME].includes(claim.requestDigestScheme)
    || (claim.requestDigestScheme === CURRENT_REQUEST_DIGEST_SCHEME
      ? !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(claim.requestDigestKeyId || "")
      : claim.requestDigestKeyId !== null)
    || !/^cmdlease_[a-f0-9]{64}$/.test(claim.leaseOwner)
    || claim.leaseGeneration < 1
    || claim.attemptCount < 1
  ) {
    throw persistenceFailure();
  }
  return Object.freeze(claim);
}

function validateClaim(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw persistenceFailure();
  const claim = {
    recordId: rawText(input.recordId),
    commandName: rawText(input.commandName),
    actorId: rawText(input.actorId),
    idempotencyKeyToken: rawText(input.idempotencyKeyToken),
    requestDigest: rawText(input.requestDigest),
    requestDigestScheme: rawText(input.requestDigestScheme),
    requestDigestKeyId: optionalRawText(input.requestDigestKeyId),
    leaseOwner: rawText(input.leaseOwner),
    leaseGeneration: positiveInteger(input.leaseGeneration, 0),
    attemptCount: positiveInteger(input.attemptCount, 0),
  };
  if (
    !/^cmdidem_[a-f0-9]{24}$/.test(claim.recordId)
    || !claim.commandName
    || !claim.actorId
    || !/^cmdkey_[a-f0-9]{64}$/.test(claim.idempotencyKeyToken)
    || !/^[a-f0-9]{64}$/.test(claim.requestDigest)
    || ![CURRENT_REQUEST_DIGEST_SCHEME, LEGACY_REQUEST_DIGEST_SCHEME].includes(claim.requestDigestScheme)
    || (claim.requestDigestScheme === CURRENT_REQUEST_DIGEST_SCHEME
      ? !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(claim.requestDigestKeyId || "")
      : claim.requestDigestKeyId !== null)
    || !/^cmdlease_[a-f0-9]{64}$/.test(claim.leaseOwner)
    || claim.leaseGeneration < 1
    || claim.attemptCount < 1
  ) {
    throw persistenceFailure();
  }
  return claim;
}

function recordForClaim(claim, overrides = {}) {
  return {
    recordId: claim.recordId,
    commandName: claim.commandName,
    actorId: claim.actorId,
    idempotencyKey: claim.idempotencyKeyToken,
    requestDigest: claim.requestDigest,
    status: COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS,
    attempts: claim.attemptCount,
    createdAt: "",
    startedAt: "",
    updatedAt: "",
    completedAt: "",
    failedAt: "",
    result: null,
    error: null,
    ...overrides,
  };
}

function legacyScopeMatches(record, descriptor) {
  return record
    && utf8BytesEqual(record.commandName, descriptor.commandName)
    && utf8BytesEqual(record.actorId, descriptor.actorId)
    && utf8BytesEqual(record.idempotencyKey, descriptor.idempotencyKey);
}

function legacyStateError() {
  return commandIdempotencyError(40903, "历史命令状态无法安全恢复", 409);
}

function stateError() {
  return commandIdempotencyError(40903, "命令幂等记录状态无法安全恢复", 409);
}

function digestConflict() {
  return commandIdempotencyError(40901, "相同命令幂等键对应了不同请求", 409);
}

function inProgressConflict() {
  return commandIdempotencyError(40902, "相同命令正在执行中", 409);
}

function createMysqlCommandIdempotencyAdapter(connection, options = {}) {
  if (!connection || typeof connection.execute !== "function") throw persistenceFailure();
  const requestDigestCodec = options.requestDigestCodec;
  const resultCodec = options.resultCodec;
  let requestDigestStatus;
  try {
    if (
      !requestDigestCodec
      || typeof requestDigestCodec.digest !== "function"
      || typeof requestDigestCodec.verify !== "function"
      || typeof requestDigestCodec.classifyKeyId !== "function"
      || typeof requestDigestCodec.getStatus !== "function"
      || typeof requestDigestCodec.assertReady !== "function"
      || !resultCodec
      || typeof resultCodec.encode !== "function"
      || typeof resultCodec.decode !== "function"
      || typeof resultCodec.inspectEnvelope !== "function"
      || typeof resultCodec.getStatus !== "function"
      || typeof resultCodec.assertReady !== "function"
    ) throw persistenceCause();
    requestDigestCodec.assertReady();
    resultCodec.assertReady();
    requestDigestStatus = requestDigestCodec.getStatus();
    const resultStatus = resultCodec.getStatus();
    if (
      !requestDigestStatus
      || requestDigestStatus.ready !== true
      || requestDigestStatus.canonicalVersion !== CANONICAL_REQUEST_VERSION
      || requestDigestStatus.digestVersion !== CURRENT_REQUEST_DIGEST_SCHEME
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(requestDigestStatus.keyId || "")
      || !resultStatus
      || resultStatus.ready !== true
      || resultStatus.enabled !== true
    ) throw persistenceCause();
  } catch {
    throw persistenceFailure();
  }
  const execute = connection.execute.bind(connection);
  const leaseDurationSeconds = positiveInteger(options.leaseDurationSeconds, DEFAULT_LEASE_DURATION_SECONDS);
  if (leaseDurationSeconds > MAX_LEASE_DURATION_SECONDS) throw persistenceFailure();
  const randomBytes = typeof options.randomBytes === "function" ? options.randomBytes : crypto.randomBytes;
  let state = "ACTIVE";

  function descriptorBundle(input) {
    const normalized = normalizedCommandInput(input);
    const secureDigest = requestDigestCodec.digest(normalized.digestInput);
    if (
      !secureDigest
      || secureDigest.canonicalVersion !== CANONICAL_REQUEST_VERSION
      || secureDigest.digestVersion !== CURRENT_REQUEST_DIGEST_SCHEME
      || secureDigest.keyId !== requestDigestStatus.keyId
      || !/^[a-f0-9]{64}$/.test(secureDigest.digest || "")
    ) throw persistenceFailure();
    return {
      ...normalized,
      secureDigest,
      durableDescriptor: relationalDescriptor(normalized.legacyDescriptor, secureDigest),
    };
  }

  function assertActive() {
    if (state !== "ACTIVE") throw persistenceFailure();
  }

  function nextLeaseOwner() {
    let bytes;
    try {
      bytes = randomBytes(32);
    } catch {
      throw persistenceFailure();
    }
    if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw persistenceFailure();
    return `cmdlease_${bytes.toString("hex")}`;
  }

  async function dbExecute(sql, params) {
    assertActive();
    try {
      return await execute(sql, params);
    } catch {
      throw persistenceFailure();
    }
  }

  async function selectScope(descriptor) {
    const result = await dbExecute(SELECT_SCOPE_SQL, [
      descriptor.commandName,
      descriptor.actorId,
      descriptor.idempotencyKey,
    ]);
    const row = rowsFrom(result)[0] || null;
    if (row) assertExactScopeRow(row, descriptor);
    return row;
  }

  function claimed(row) {
    return Object.freeze({ kind: "CLAIMED", claim: activeClaim(row) });
  }

  function requestDigestState(row, bundle) {
    const scheme = rawText(row.request_digest_scheme);
    const digest = rawText(row.request_digest);
    const keyId = optionalRawText(row.request_digest_key_id);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw stateError();
    if (scheme === CURRENT_REQUEST_DIGEST_SCHEME) {
      const keyState = requestDigestCodec.classifyKeyId(keyId);
      if (!["CURRENT", "PREVIOUS"].includes(keyState)) throw stateError();
      const matches = requestDigestCodec.verify({
        canonicalVersion: CANONICAL_REQUEST_VERSION,
        digestVersion: scheme,
        keyId,
        digest,
      }, bundle.digestInput);
      if (!matches) throw digestConflict();
      return { legacy: false, scheme, digest, keyId };
    }
    if (scheme === LEGACY_REQUEST_DIGEST_SCHEME) {
      if (keyId !== null) throw stateError();
      if (!verifyLegacySha256V0(digest, bundle.request)) throw digestConflict();
      return { legacy: true, scheme, digest, keyId };
    }
    throw stateError();
  }

  function inspectEncodedResult(stored) {
    let metadata;
    try {
      metadata = resultCodec.inspectEnvelope(stored);
    } catch {
      throw persistenceFailure();
    }
    if (
      !metadata
      || metadata.protected !== true
      || metadata.codecVersion !== RESULT_CODEC_VERSION
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(metadata.keyId || "")
    ) throw persistenceFailure();
    return metadata;
  }

  function decodePersistedResult(row, allowMissingMetadata = false) {
    const record = rowRecord(row);
    const metadata = inspectEncodedResult(record.result);
    const storedCodecVersion = optionalRawText(row.result_codec_version);
    const storedKeyId = optionalRawText(row.result_key_id);
    if (
      storedCodecVersion === null
      && storedKeyId === null
      && allowMissingMetadata
    ) return { record, decoded: decodeStoredCommandResult(record, { resultCodec }) };
    if (
      storedCodecVersion !== metadata.codecVersion
      || storedKeyId !== metadata.keyId
    ) throw persistenceFailure();
    return { record, decoded: decodeStoredCommandResult(record, { resultCodec }) };
  }

  function replayOutcome(row) {
    const { record, decoded } = decodePersistedResult(row, false);
    return {
      result: decoded,
      replayed: true,
      record: publicCommandRecord(record),
    };
  }

  async function takeover(row, bundle, digestState) {
    const leaseOwner = nextLeaseOwner();
    const previousGeneration = nonNegativeInteger(row.lease_generation);
    const durable = bundle.durableDescriptor;
    const result = await dbExecute(TAKEOVER_SQL, [
      leaseOwner,
      leaseDurationSeconds,
      durable.requestDigest,
      durable.requestDigestScheme,
      durable.requestDigestKeyId,
      rawText(row.command_idempotency_id),
      durable.commandName,
      durable.actorId,
      durable.idempotencyKey,
      digestState.digest,
      digestState.scheme,
      digestState.keyId,
      optionalRawText(row.lease_owner),
      previousGeneration,
    ]);
    if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    return claimed({
      ...row,
      request_digest: durable.requestDigest,
      request_digest_scheme: durable.requestDigestScheme,
      request_digest_key_id: durable.requestDigestKeyId,
      lease_owner: leaseOwner,
      lease_generation: previousGeneration + 1,
      attempt_count: nonNegativeInteger(row.attempt_count) + 1,
    });
  }

  async function retry(row, bundle, digestState) {
    const leaseOwner = nextLeaseOwner();
    const previousGeneration = nonNegativeInteger(row.lease_generation);
    const durable = bundle.durableDescriptor;
    const result = await dbExecute(RETRY_SQL, [
      leaseOwner,
      leaseDurationSeconds,
      durable.requestDigest,
      durable.requestDigestScheme,
      durable.requestDigestKeyId,
      rawText(row.command_idempotency_id),
      durable.commandName,
      durable.actorId,
      durable.idempotencyKey,
      digestState.digest,
      digestState.scheme,
      digestState.keyId,
      previousGeneration,
    ]);
    if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    return claimed({
      ...row,
      status: COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS,
      request_digest: durable.requestDigest,
      request_digest_scheme: durable.requestDigestScheme,
      request_digest_key_id: durable.requestDigestKeyId,
      lease_owner: leaseOwner,
      lease_generation: previousGeneration + 1,
      attempt_count: nonNegativeInteger(row.attempt_count) + 1,
    });
  }

  async function upgradeLegacySuccess(row, bundle, digestState) {
    const { record: legacyRecord, decoded } = decodePersistedResult(row, true);
    const durable = bundle.durableDescriptor;
    const upgradedRecord = {
      ...legacyRecord,
      commandName: durable.commandName,
      actorId: durable.actorId,
      idempotencyKey: durable.idempotencyKey,
      requestDigest: durable.requestDigest,
      result: null,
    };
    const stored = encodeStoredCommandResult(decoded, { resultCodec, record: upgradedRecord });
    const metadata = inspectEncodedResult(stored);
    const result = await dbExecute(UPGRADE_LEGACY_SUCCESS_SQL, [
      durable.requestDigest,
      durable.requestDigestScheme,
      durable.requestDigestKeyId,
      JSON.stringify(stored),
      metadata.codecVersion,
      metadata.keyId,
      rawText(row.command_idempotency_id),
      durable.commandName,
      durable.actorId,
      durable.idempotencyKey,
      digestState.digest,
      digestState.scheme,
    ]);
    if (affectedRowsFrom(result) !== 1) {
      const concurrent = await selectScope(durable);
      if (!concurrent || rawText(concurrent.request_digest_scheme) !== CURRENT_REQUEST_DIGEST_SCHEME) {
        throw persistenceFailure();
      }
      return resolveExisting(concurrent, bundle);
    }
    upgradedRecord.result = stored;
    return Object.freeze({
      kind: "REPLAY",
      outcome: {
        result: decoded,
        replayed: true,
        record: publicCommandRecord(upgradedRecord),
      },
    });
  }

  async function resolveExisting(row, bundle) {
    const digestState = requestDigestState(row, bundle);
    if (row.tombstoned_at !== null && row.tombstoned_at !== undefined) throw stateError();
    const status = text(row.status);
    if (status === COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED) {
      if (digestState.legacy) return upgradeLegacySuccess(row, bundle, digestState);
      return Object.freeze({ kind: "REPLAY", outcome: replayOutcome(row) });
    }
    if (status === COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS) {
      if (
        !text(row.lease_owner)
        || row.lease_expires_at === null
        || row.lease_expires_at === undefined
        || nonNegativeInteger(row.lease_generation) < 1
      ) {
        throw stateError();
      }
      if (Number(row.lease_expired) === 1) return takeover(row, bundle, digestState);
      throw inProgressConflict();
    }
    if (status === COMMAND_IDEMPOTENCY_STATUS.FAILED) return retry(row, bundle, digestState);
    throw stateError();
  }

  async function importLegacySuccess(bundle, legacyRecord) {
    const decoded = decodeStoredCommandResult(legacyRecord, { resultCodec });
    const durableDescriptor = bundle.durableDescriptor;
    const durableRecord = {
      recordId: commandRecordIdFor(bundle.legacyDescriptor),
      ...durableDescriptor,
      status: COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED,
      attempts: positiveInteger(legacyRecord.attempts),
      createdAt: "",
      startedAt: "",
      updatedAt: "",
      completedAt: "",
      failedAt: "",
      result: null,
      error: null,
    };
    const stored = encodeStoredCommandResult(decoded, { resultCodec, record: durableRecord });
    const metadata = inspectEncodedResult(stored);
    const attempts = durableRecord.attempts;
    try {
      const result = await execute(INSERT_LEGACY_SUCCESS_SQL, [
        durableRecord.recordId,
        durableDescriptor.commandName,
        durableDescriptor.actorId,
        null,
        durableDescriptor.idempotencyKey,
        durableDescriptor.requestDigest,
        durableDescriptor.requestDigestScheme,
        durableDescriptor.requestDigestKeyId,
        attempts,
        JSON.stringify(stored),
        metadata.codecVersion,
        metadata.keyId,
        attempts,
      ]);
      if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    } catch (error) {
      if (!duplicateError(error)) throw persistenceFailure();
      const concurrent = await selectScope(durableDescriptor);
      if (!concurrent) throw persistenceFailure();
      return resolveExisting(concurrent, bundle);
    }
    durableRecord.result = stored;
    return Object.freeze({
      kind: "REPLAY",
      outcome: {
        result: decoded,
        replayed: true,
        record: publicCommandRecord(durableRecord),
      },
    });
  }

  async function claim(input, claimOptions = {}) {
    assertActive();
    const bundle = descriptorBundle(input);
    const descriptor = bundle.legacyDescriptor;
    const durableDescriptor = bundle.durableDescriptor;
    let row = await selectScope(durableDescriptor);
    if (row) return resolveExisting(row, bundle);

    const legacyRecord = claimOptions.legacyRecord;
    if (legacyRecord) {
      if (!legacyScopeMatches(legacyRecord, descriptor)) throw legacyStateError();
      if (!verifyLegacySha256V0(legacyRecord.requestDigest, bundle.request)) throw digestConflict();
      if (text(legacyRecord.status) === COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED) {
        return importLegacySuccess(bundle, legacyRecord);
      }
      if (text(legacyRecord.status) === COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS) throw legacyStateError();
      if (text(legacyRecord.status) !== COMMAND_IDEMPOTENCY_STATUS.FAILED) throw legacyStateError();
    }

    const leaseOwner = nextLeaseOwner();
    const recordId = commandRecordIdFor(descriptor);
    const legacyAttempts = legacyRecord ? nonNegativeInteger(legacyRecord.attempts) : 0;
    const attemptCount = legacyAttempts + 1;
    if (!Number.isSafeInteger(attemptCount) || attemptCount > 0xFFFFFFFF) throw legacyStateError();
    try {
      const result = await execute(INSERT_CLAIM_SQL, [
        recordId,
        durableDescriptor.commandName,
        durableDescriptor.actorId,
        actorType(input),
        durableDescriptor.idempotencyKey,
        durableDescriptor.requestDigest,
        durableDescriptor.requestDigestScheme,
        durableDescriptor.requestDigestKeyId,
        attemptCount,
        leaseOwner,
        leaseDurationSeconds,
      ]);
      if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    } catch (error) {
      if (!duplicateError(error)) {
        if (error && error.code === "ATOMIC_WRITE_FAILED") throw error;
        throw persistenceFailure();
      }
      row = await selectScope(durableDescriptor);
      if (!row) throw persistenceFailure();
      return resolveExisting(row, bundle);
    }

    return claimed({
      command_idempotency_id: recordId,
      command_name: durableDescriptor.commandName,
      actor_id: durableDescriptor.actorId,
      idempotency_key: durableDescriptor.idempotencyKey,
      request_digest: durableDescriptor.requestDigest,
      request_digest_scheme: durableDescriptor.requestDigestScheme,
      request_digest_key_id: durableDescriptor.requestDigestKeyId,
      status: COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS,
      attempt_count: attemptCount,
      lease_owner: leaseOwner,
      lease_generation: 1,
    });
  }

  async function lockOwnedAttempt(input) {
    const claim = validateClaim(input);
    const result = await dbExecute(LOCK_OWNED_SQL, [
      claim.recordId,
      claim.commandName,
      claim.actorId,
      claim.idempotencyKeyToken,
      claim.requestDigest,
      claim.requestDigestScheme,
      claim.requestDigestKeyId,
      claim.leaseOwner,
      claim.leaseGeneration,
    ]);
    const row = rowsFrom(result)[0];
    if (!row) throw persistenceFailure();
    assertExactOwnedRow(row, claim);
    return activeClaim(row);
  }

  async function completeOwnedAttempt(input, resultValue) {
    const claim = validateClaim(input);
    const record = recordForClaim(claim);
    const storedResult = encodeStoredCommandResult(resultValue, { resultCodec, record });
    const metadata = inspectEncodedResult(storedResult);
    const result = await dbExecute(COMPLETE_SQL, [
      JSON.stringify(storedResult),
      metadata.codecVersion,
      metadata.keyId,
      claim.recordId,
      claim.commandName,
      claim.actorId,
      claim.idempotencyKeyToken,
      claim.requestDigest,
      claim.requestDigestScheme,
      claim.requestDigestKeyId,
      claim.leaseOwner,
      claim.leaseGeneration,
    ]);
    if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    const completedRecord = recordForClaim(claim, {
      status: COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED,
      result: storedResult,
    });
    return {
      result: decodeStoredCommandResult(completedRecord, { resultCodec }),
      replayed: false,
      record: publicCommandRecord(completedRecord),
    };
  }

  async function failOwnedAttempt(input, error) {
    const claim = validateClaim(input);
    const safe = safeCommandError(error);
    const result = await dbExecute(FAIL_SQL, [
      JSON.stringify(safe),
      claim.recordId,
      claim.commandName,
      claim.actorId,
      claim.idempotencyKeyToken,
      claim.requestDigest,
      claim.requestDigestScheme,
      claim.requestDigestKeyId,
      claim.leaseOwner,
      claim.leaseGeneration,
    ]);
    if (affectedRowsFrom(result) !== 1) throw persistenceFailure();
    return {
      recordId: claim.recordId,
      status: COMMAND_IDEMPOTENCY_STATUS.FAILED,
      attempts: claim.attemptCount,
      error: safe,
    };
  }

  function discard() {
    state = "DISCARDED";
  }

  return Object.freeze({
    claim,
    lockOwnedAttempt,
    completeOwnedAttempt,
    failOwnedAttempt,
    discard,
  });
}

module.exports = {
  createMysqlCommandIdempotencyAdapter,
};
