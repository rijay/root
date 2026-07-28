const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMysqlCommandIdempotencyAdapter,
} = require("../src/mysqlCommandIdempotencyAdapter");
const { createCommandRequestDigestCodec } = require("../src/commandRequestDigest");
const { createCommandResultCodec } = require("../src/commandResultProtection");
const { digestCommandRequest } = require("../src/commandIdempotency");
const { isAtomicWriteError } = require("../src/atomicWriteError");

const NOW = "2026-07-16 12:00:00.000";
const RAW_REQUEST_ID = "request-raw-must-not-be-persisted";

function codec() {
  return createCommandResultCodec({
    NODE_ENV: "production",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "mysql-command-result-test-key-with-at-least-32-characters",
    ROOT_COMMAND_RESULT_KEY_ID: "mysql-command-key-v1",
  });
}

function requestDigestCodec() {
  return createCommandRequestDigestCodec({
    NODE_ENV: "production",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "mysql-command-request-digest-test-key-with-strong-entropy-2026",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "mysql-command-digest-v1",
  });
}

function input(overrides = {}) {
  return {
    commandName: "TASK_EVENT_CREATE",
    actorId: "root-user-001",
    idempotencyKey: RAW_REQUEST_ID,
    request: {
      taskId: "task-001",
      phone: "13800000000",
      healthAnswer: "sensitive-gut-state",
      token: "secret-bearer-token",
    },
    ...overrides,
  };
}

function mysqlTimeAfter(seconds) {
  return new Date(Date.parse(`${NOW.replace(" ", "T")}Z`) + seconds * 1000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function flipLastHex(value) {
  return `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
}

class FakeCommandConnection {
  constructor(row = null) {
    this.row = row ? clone(row) : null;
    this.calls = [];
    this.failures = [];
    this.zeroAffectedMarkers = [];
    this.forceScopeRow = false;
  }

  failOnce(marker, message) {
    this.failures.push({ marker, message });
  }

  zeroAffectedOnce(marker) {
    this.zeroAffectedMarkers.push(marker);
  }

  async execute(sql, params = []) {
    this.calls.push({ sql, params: clone(params) });
    const failureIndex = this.failures.findIndex((candidate) => sql.includes(candidate.marker));
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      throw new Error(failure.message);
    }
    const zeroAffectedIndex = this.zeroAffectedMarkers.findIndex((marker) => sql.includes(marker));
    if (zeroAffectedIndex >= 0) {
      this.zeroAffectedMarkers.splice(zeroAffectedIndex, 1);
      return [{ affectedRows: 0 }, []];
    }

    if (sql.includes("command-idempotency:select-scope")) {
      const [commandName, actorId, idempotencyKey] = params;
      if (!this.row || (!this.forceScopeRow && (
        this.row.command_name !== commandName
        || this.row.actor_id !== actorId
        || this.row.idempotency_key !== idempotencyKey
      ))) {
        return [[], []];
      }
      return [[{
        ...clone(this.row),
        lease_expired: this.row.lease_expires_at !== null && this.row.lease_expires_at <= NOW ? 1 : 0,
      }], []];
    }

    if (sql.includes("command-idempotency:insert-claim")) {
      const [
        recordId,
        commandName,
        actorId,
        actorType,
        idempotencyKey,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        attemptCount,
        leaseOwner,
        leaseSeconds,
      ] = params;
      if (this.row) {
        const error = new Error("Duplicate entry contains raw SQL detail");
        error.code = "ER_DUP_ENTRY";
        error.errno = 1062;
        throw error;
      }
      this.row = {
        command_idempotency_id: recordId,
        command_name: commandName,
        actor_id: actorId,
        actor_type: actorType,
        idempotency_key: idempotencyKey,
        request_digest: requestDigest,
        request_digest_scheme: requestDigestScheme,
        request_digest_key_id: requestDigestKeyId,
        request_json: null,
        status: "IN_PROGRESS",
        attempt_count: attemptCount,
        result_json: null,
        result_ref: null,
        result_codec_version: null,
        result_key_id: null,
        error_json: null,
        last_attempt_request_id: null,
        started_at: NOW,
        completed_at: null,
        failed_at: null,
        retain_until: null,
        tombstoned_at: null,
        lease_owner: leaseOwner,
        lease_expires_at: mysqlTimeAfter(leaseSeconds),
        lease_generation: 1,
        created_at: NOW,
        updated_at: NOW,
      };
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:insert-legacy-success")) {
      const [
        recordId,
        commandName,
        actorId,
        actorType,
        idempotencyKey,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        attempts,
        resultJson,
        resultCodecVersion,
        resultKeyId,
        leaseGeneration,
      ] = params;
      this.row = {
        command_idempotency_id: recordId,
        command_name: commandName,
        actor_id: actorId,
        actor_type: actorType,
        idempotency_key: idempotencyKey,
        request_digest: requestDigest,
        request_digest_scheme: requestDigestScheme,
        request_digest_key_id: requestDigestKeyId,
        request_json: null,
        status: "SUCCEEDED",
        attempt_count: attempts,
        result_json: resultJson,
        result_ref: null,
        result_codec_version: resultCodecVersion,
        result_key_id: resultKeyId,
        error_json: null,
        last_attempt_request_id: null,
        started_at: NOW,
        completed_at: NOW,
        failed_at: null,
        retain_until: null,
        tombstoned_at: null,
        lease_owner: null,
        lease_expires_at: null,
        lease_generation: leaseGeneration,
        created_at: NOW,
        updated_at: NOW,
      };
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:takeover")) {
      const [
        leaseOwner,
        leaseSeconds,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        previousRequestDigest,
        previousRequestDigestScheme,
        previousRequestDigestKeyId,
        previousOwner,
        previousGeneration,
      ] = params;
      const owned = this.row && this.row.command_idempotency_id === recordId && this.row.status === "IN_PROGRESS"
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === previousRequestDigest
        && this.row.request_digest_scheme === previousRequestDigestScheme
        && this.row.request_digest_key_id === previousRequestDigestKeyId
        && this.row.lease_owner === previousOwner && this.row.lease_generation === previousGeneration
        && this.row.lease_expires_at <= NOW;
      if (!owned) return [{ affectedRows: 0 }, []];
      this.row.lease_owner = leaseOwner;
      this.row.lease_expires_at = mysqlTimeAfter(leaseSeconds);
      this.row.lease_generation += 1;
      this.row.attempt_count += 1;
      this.row.started_at = NOW;
      this.row.completed_at = null;
      this.row.failed_at = null;
      this.row.result_json = null;
      this.row.result_codec_version = null;
      this.row.result_key_id = null;
      this.row.error_json = null;
      this.row.request_digest = requestDigest;
      this.row.request_digest_scheme = requestDigestScheme;
      this.row.request_digest_key_id = requestDigestKeyId;
      this.row.updated_at = NOW;
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:retry")) {
      const [
        leaseOwner,
        leaseSeconds,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        previousRequestDigest,
        previousRequestDigestScheme,
        previousRequestDigestKeyId,
        previousGeneration,
      ] = params;
      const retryable = this.row && this.row.command_idempotency_id === recordId && this.row.status === "FAILED"
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === previousRequestDigest
        && this.row.request_digest_scheme === previousRequestDigestScheme
        && this.row.request_digest_key_id === previousRequestDigestKeyId
        && this.row.lease_generation === previousGeneration;
      if (!retryable) return [{ affectedRows: 0 }, []];
      this.row.status = "IN_PROGRESS";
      this.row.lease_owner = leaseOwner;
      this.row.lease_expires_at = mysqlTimeAfter(leaseSeconds);
      this.row.lease_generation += 1;
      this.row.attempt_count += 1;
      this.row.started_at = NOW;
      this.row.completed_at = null;
      this.row.failed_at = null;
      this.row.result_json = null;
      this.row.result_codec_version = null;
      this.row.result_key_id = null;
      this.row.error_json = null;
      this.row.request_digest = requestDigest;
      this.row.request_digest_scheme = requestDigestScheme;
      this.row.request_digest_key_id = requestDigestKeyId;
      this.row.updated_at = NOW;
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:lock-owned")) {
      const [
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        leaseOwner,
        leaseGeneration,
      ] = params;
      const owned = this.row && this.row.command_idempotency_id === recordId && this.row.status === "IN_PROGRESS"
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === requestDigest
        && this.row.request_digest_scheme === requestDigestScheme
        && this.row.request_digest_key_id === requestDigestKeyId
        && this.row.lease_owner === leaseOwner && this.row.lease_generation === leaseGeneration
        && this.row.lease_expires_at > NOW;
      return [owned ? [[clone(this.row)][0]] : [], []];
    }

    if (sql.includes("command-idempotency:complete")) {
      const [
        resultJson,
        resultCodecVersion,
        resultKeyId,
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        leaseOwner,
        leaseGeneration,
      ] = params;
      const owned = this.row && this.row.command_idempotency_id === recordId && this.row.status === "IN_PROGRESS"
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === requestDigest
        && this.row.request_digest_scheme === requestDigestScheme
        && this.row.request_digest_key_id === requestDigestKeyId
        && this.row.lease_owner === leaseOwner && this.row.lease_generation === leaseGeneration;
      if (!owned) return [{ affectedRows: 0 }, []];
      this.row.status = "SUCCEEDED";
      this.row.result_json = resultJson;
      this.row.result_codec_version = resultCodecVersion;
      this.row.result_key_id = resultKeyId;
      this.row.error_json = null;
      this.row.completed_at = NOW;
      this.row.failed_at = null;
      this.row.lease_owner = null;
      this.row.lease_expires_at = null;
      this.row.updated_at = NOW;
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:fail")) {
      const [
        errorJson,
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        leaseOwner,
        leaseGeneration,
      ] = params;
      const owned = this.row && this.row.command_idempotency_id === recordId && this.row.status === "IN_PROGRESS"
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === requestDigest
        && this.row.request_digest_scheme === requestDigestScheme
        && this.row.request_digest_key_id === requestDigestKeyId
        && this.row.lease_owner === leaseOwner && this.row.lease_generation === leaseGeneration;
      if (!owned) return [{ affectedRows: 0 }, []];
      this.row.status = "FAILED";
      this.row.result_json = null;
      this.row.result_codec_version = null;
      this.row.result_key_id = null;
      this.row.error_json = errorJson;
      this.row.completed_at = null;
      this.row.failed_at = NOW;
      this.row.lease_owner = null;
      this.row.lease_expires_at = null;
      this.row.updated_at = NOW;
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("command-idempotency:upgrade-legacy-success")) {
      const [
        requestDigest,
        requestDigestScheme,
        requestDigestKeyId,
        resultJson,
        resultCodecVersion,
        resultKeyId,
        recordId,
        commandName,
        actorId,
        idempotencyKey,
        previousRequestDigest,
        previousRequestDigestScheme,
      ] = params;
      const upgradeable = this.row && this.row.command_idempotency_id === recordId
        && this.row.command_name === commandName && this.row.actor_id === actorId
        && this.row.idempotency_key === idempotencyKey
        && this.row.request_digest === previousRequestDigest
        && this.row.request_digest_scheme === previousRequestDigestScheme
        && this.row.request_digest_key_id === null
        && this.row.status === "SUCCEEDED";
      if (!upgradeable) return [{ affectedRows: 0 }, []];
      this.row.request_digest = requestDigest;
      this.row.request_digest_scheme = requestDigestScheme;
      this.row.request_digest_key_id = requestDigestKeyId;
      this.row.result_json = resultJson;
      this.row.result_codec_version = resultCodecVersion;
      this.row.result_key_id = resultKeyId;
      this.row.updated_at = NOW;
      return [{ affectedRows: 1 }, []];
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }
}

function createAdapter(connection, randomByte = 0x11, codecOptions = {}) {
  return createMysqlCommandIdempotencyAdapter(connection, {
    requestDigestCodec: codecOptions.requestDigestCodec || requestDigestCodec(),
    resultCodec: codecOptions.resultCodec || codec(),
    leaseDurationSeconds: 30,
    randomBytes(size) {
      return Buffer.alloc(size, randomByte);
    },
  });
}

async function claimThenRow(overrides = {}) {
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  const claimed = await adapter.claim(input(overrides));
  return { connection, adapter, claimed };
}

test("new claim hashes the persistent idempotency key and persists no request/body secrets", async () => {
  const { connection, claimed } = await claimThenRow();

  assert.equal(claimed.kind, "CLAIMED");
  assert.equal(claimed.claim.attemptCount, 1);
  assert.equal(claimed.claim.leaseGeneration, 1);
  assert.match(claimed.claim.leaseOwner, /^cmdlease_[a-f0-9]{64}$/);
  assert.match(connection.row.idempotency_key, /^cmdkey_[a-f0-9]{64}$/);
  assert.notEqual(connection.row.idempotency_key, RAW_REQUEST_ID);
  assert.match(connection.row.request_digest, /^[a-f0-9]{64}$/);
  assert.equal(connection.row.request_digest_scheme, "hmac-sha256:v1");
  assert.equal(connection.row.request_digest_key_id, "mysql-command-digest-v1");
  assert.notEqual(connection.row.request_digest, digestCommandRequest(input().request));
  assert.equal(connection.row.request_json, null);
  assert.equal(connection.row.result_ref, null);
  assert.equal(connection.row.last_attempt_request_id, null);
  const persisted = JSON.stringify(connection.row);
  const persistenceTrace = JSON.stringify(connection.calls);
  assert.doesNotMatch(persisted, /request-raw|13800000000|sensitive-gut-state|secret-bearer-token/);
  assert.doesNotMatch(persistenceTrace, /request-raw|13800000000|sensitive-gut-state|secret-bearer-token/);
  assert(connection.calls.every(({ sql }) => sql.includes("?") || sql.includes("select-scope")));
  assert(connection.calls.some(({ sql }) => sql.includes("CURRENT_TIMESTAMP(3)") && sql.includes("DATE_ADD")));
});

test("protected relational success replays without executing and without plaintext at rest", async () => {
  const { connection, adapter, claimed } = await claimThenRow();
  await adapter.lockOwnedAttempt(claimed.claim);
  const sensitive = { phone: "13800000000", healthAnswer: "sensitive-gut-state" };
  const completed = await adapter.completeOwnedAttempt(claimed.claim, sensitive);
  assert.equal(completed.replayed, false);
  assert.deepEqual(completed.result, sensitive);
  assert.doesNotMatch(JSON.stringify(connection.row.result_json), /13800000000|sensitive-gut-state/);
  assert.equal(connection.row.result_codec_version, "A256GCM:v1");
  assert.equal(connection.row.result_key_id, "mysql-command-key-v1");

  const replay = await adapter.claim(input());
  assert.equal(replay.kind, "REPLAY");
  assert.equal(replay.outcome.replayed, true);
  assert.deepEqual(replay.outcome.result, sensitive);
});

test("rotated codecs replay old durable rows and atomically upgrade previous request keys on takeover", async () => {
  const retiredJson = JSON.stringify({
    REQUEST_DIGEST: [],
    COMMAND_RESULT: [],
    INBOX_CONTENT: [],
    NOTIFICATION_RECEIPT: [],
  });
  const rotatedCodecs = {
    requestDigestCodec: createCommandRequestDigestCodec({
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "mysql-command-request-digest-current-key-v2-with-strong-entropy-2026",
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "mysql-command-digest-v2",
      ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({
        "mysql-command-digest-v1": "mysql-command-request-digest-test-key-with-strong-entropy-2026",
      }),
      ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: retiredJson,
    }),
    resultCodec: createCommandResultCodec({
      NODE_ENV: "production",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "mysql-command-result-current-key-v2-with-at-least-32-characters",
      ROOT_COMMAND_RESULT_KEY_ID: "mysql-command-key-v2",
      ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: JSON.stringify({
        "mysql-command-key-v1": "mysql-command-result-test-key-with-at-least-32-characters",
      }),
      ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: retiredJson,
    }),
  };

  const replayConnection = new FakeCommandConnection();
  const oldAdapter = createAdapter(replayConnection);
  const oldClaim = await oldAdapter.claim(input());
  await oldAdapter.completeOwnedAttempt(oldClaim.claim, { status: "DONE", marker: "old-row" });
  assert.equal(replayConnection.row.request_digest_key_id, "mysql-command-digest-v1");
  assert.equal(replayConnection.row.result_key_id, "mysql-command-key-v1");

  const rotatedReplayAdapter = createAdapter(replayConnection, 0x22, rotatedCodecs);
  const replay = await rotatedReplayAdapter.claim(input());
  assert.equal(replay.kind, "REPLAY");
  assert.deepEqual(replay.outcome.result, { status: "DONE", marker: "old-row" });
  assert.equal(replayConnection.row.request_digest_key_id, "mysql-command-digest-v1");
  assert.equal(replayConnection.row.result_key_id, "mysql-command-key-v1");

  const takeoverConnection = new FakeCommandConnection();
  const oldTakeoverAdapter = createAdapter(takeoverConnection);
  await oldTakeoverAdapter.claim(input());
  takeoverConnection.row.lease_expires_at = NOW;
  const rotatedTakeoverAdapter = createAdapter(takeoverConnection, 0x33, rotatedCodecs);
  const takeover = await rotatedTakeoverAdapter.claim(input());
  assert.equal(takeover.kind, "CLAIMED");
  assert.equal(takeover.claim.requestDigestKeyId, "mysql-command-digest-v2");
  assert.equal(takeoverConnection.row.request_digest_key_id, "mysql-command-digest-v2");
});

test("digest conflicts fail consistently before retry, takeover or replay", async () => {
  for (const status of ["IN_PROGRESS", "FAILED", "SUCCEEDED"]) {
    const { connection, adapter, claimed } = await claimThenRow();
    connection.row.status = status;
    connection.row.request_digest = "0".repeat(64);
    if (status === "SUCCEEDED") connection.row.result_json = JSON.stringify({ protected: true });
    await assert.rejects(
      () => adapter.claim(input()),
      (error) => error.code === 40901 && error.status === 409
    );
    assert.equal(connection.row.attempt_count, 1);
    assert.equal(claimed.claim.leaseGeneration, 1);
  }
});

test("fresh IN_PROGRESS conflicts, while expiry equality performs one fenced takeover", async () => {
  const first = await claimThenRow();
  await assert.rejects(
    () => first.adapter.claim(input()),
    (error) => error.code === 40902 && error.status === 409
  );

  first.connection.row.lease_expires_at = NOW;
  const takeover = await first.adapter.claim(input());
  assert.equal(takeover.kind, "CLAIMED");
  assert.equal(takeover.claim.attemptCount, 2);
  assert.equal(takeover.claim.leaseGeneration, 2);
  assert.equal(first.connection.row.attempt_count, 2);
  assert.equal(first.connection.row.lease_generation, 2);
});

test("FAILED retries increment attempt and generation exactly once and clear terminal state", async () => {
  const { connection, adapter } = await claimThenRow();
  connection.row.status = "FAILED";
  connection.row.error_json = JSON.stringify({ code: "TEMP", message: "command failed" });
  connection.row.failed_at = NOW;
  connection.row.lease_owner = null;
  connection.row.lease_expires_at = null;

  const retry = await adapter.claim(input());
  assert.equal(retry.claim.attemptCount, 2);
  assert.equal(retry.claim.leaseGeneration, 2);
  assert.equal(connection.row.status, "IN_PROGRESS");
  assert.equal(connection.row.error_json, null);
  assert.equal(connection.row.failed_at, null);
});

test("a safe legacy FAILED record carries its history into exactly one new relational attempt", async () => {
  const legacyInput = input();
  const legacyRecord = {
    recordId: "cmdidem_legacy_failed",
    commandName: legacyInput.commandName,
    actorId: legacyInput.actorId,
    idempotencyKey: legacyInput.idempotencyKey,
    requestDigest: digestCommandRequest(legacyInput.request),
    status: "FAILED",
    attempts: 3,
    result: null,
    error: { code: "TEMP", message: "command failed" },
  };
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  const claimed = await adapter.claim(legacyInput, { legacyRecord });
  assert.equal(claimed.claim.attemptCount, 4);
  assert.equal(claimed.claim.leaseGeneration, 1);
  assert.equal(connection.row.attempt_count, 4);
  assert.equal(connection.row.error_json, null);
});

test("tombstones and unknown states fail closed", async () => {
  const tombstonedConnection = new FakeCommandConnection();
  const tombstonedAdapter = createAdapter(tombstonedConnection);
  const first = await tombstonedAdapter.claim(input());
  tombstonedConnection.row.tombstoned_at = NOW;
  await assert.rejects(
    () => tombstonedAdapter.claim(input()),
    (error) => error.code === 40903 && error.status === 409
  );
  assert.equal(first.claim.attemptCount, 1);

  tombstonedConnection.row.tombstoned_at = null;
  tombstonedConnection.row.status = "UNKNOWN";
  await assert.rejects(
    () => tombstonedAdapter.claim(input()),
    (error) => error.code === 40903 && error.status === 409
  );

  tombstonedConnection.row.status = "IN_PROGRESS";
  tombstonedConnection.row.lease_owner = null;
  tombstonedConnection.row.lease_expires_at = null;
  tombstonedConnection.row.lease_generation = 0;
  await assert.rejects(
    () => tombstonedAdapter.claim(input()),
    (error) => error.code === 40903 && error.status === 409
  );
});

test("zero-row takeover and retry races fail closed as atomic lease loss", async () => {
  const takeoverHarness = await claimThenRow();
  takeoverHarness.connection.row.lease_expires_at = NOW;
  takeoverHarness.connection.zeroAffectedOnce("command-idempotency:takeover");
  await assert.rejects(
    () => takeoverHarness.adapter.claim(input()),
    isAtomicWriteError
  );

  const retryHarness = await claimThenRow();
  retryHarness.connection.row.status = "FAILED";
  retryHarness.connection.row.lease_owner = null;
  retryHarness.connection.row.lease_expires_at = null;
  retryHarness.connection.zeroAffectedOnce("command-idempotency:retry");
  await assert.rejects(
    () => retryHarness.adapter.claim(input()),
    isAtomicWriteError
  );
});

test("owner plus generation fence lock, completion and failure; lost leases are atomic failures", async () => {
  const { connection, adapter, claimed } = await claimThenRow();
  const stale = { ...claimed.claim, leaseGeneration: 0 };
  await assert.rejects(() => adapter.lockOwnedAttempt(stale), isAtomicWriteError);
  await assert.rejects(() => adapter.completeOwnedAttempt(stale, { ok: true }), isAtomicWriteError);
  await assert.rejects(() => adapter.failOwnedAttempt(stale, new Error("must-not-leak")), isAtomicWriteError);

  await adapter.lockOwnedAttempt(claimed.claim);
  const failed = await adapter.failOwnedAttempt(
    claimed.claim,
    Object.assign(new Error("phone=13800000000 bearer=secret"), { code: "TEMPORARY" })
  );
  assert.equal(failed.status, "FAILED");
  assert.deepEqual(JSON.parse(connection.row.error_json), { code: "TEMPORARY", message: "command failed" });
  assert.doesNotMatch(JSON.stringify(connection.row), /13800000000|bearer|secret/);
});

test("late old worker cannot complete after a stale takeover", async () => {
  const { connection, adapter, claimed } = await claimThenRow();
  connection.row.lease_expires_at = NOW;
  const takeover = await adapter.claim(input());
  await assert.rejects(
    () => adapter.completeOwnedAttempt(claimed.claim, { stale: true }),
    isAtomicWriteError
  );
  await adapter.lockOwnedAttempt(takeover.claim);
  const completed = await adapter.completeOwnedAttempt(takeover.claim, { current: true });
  assert.deepEqual(completed.result, { current: true });
});

test("three workers are fenced by owner and monotonic generation across repeated expiry", async () => {
  const connection = new FakeCommandConnection();
  const workerOne = createAdapter(connection, 0x11);
  const workerTwo = createAdapter(connection, 0x22);
  const workerThree = createAdapter(connection, 0x33);
  const first = await workerOne.claim(input());
  connection.row.lease_expires_at = NOW;
  const second = await workerTwo.claim(input());
  connection.row.lease_expires_at = NOW;
  const third = await workerThree.claim(input());

  assert.equal(first.claim.leaseGeneration, 1);
  assert.equal(second.claim.leaseGeneration, 2);
  assert.equal(third.claim.leaseGeneration, 3);
  assert.notEqual(first.claim.leaseOwner, second.claim.leaseOwner);
  assert.notEqual(second.claim.leaseOwner, third.claim.leaseOwner);
  await assert.rejects(() => workerOne.completeOwnedAttempt(first.claim, { worker: 1 }), isAtomicWriteError);
  await assert.rejects(() => workerTwo.completeOwnedAttempt(second.claim, { worker: 2 }), isAtomicWriteError);
  const completed = await workerThree.completeOwnedAttempt(third.claim, { worker: 3 });
  assert.deepEqual(completed.result, { worker: 3 });
});

test("legacy SUCCEEDED is decoded with its old binding and re-encrypted for relational replay", async () => {
  const resultCodec = codec();
  const legacyInput = input();
  const digest = digestCommandRequest(legacyInput.request);
  const legacyRecord = {
    recordId: "cmdidem_legacy_001",
    commandName: legacyInput.commandName,
    actorId: legacyInput.actorId,
    idempotencyKey: legacyInput.idempotencyKey,
    requestDigest: digest,
    status: "SUCCEEDED",
    attempts: 3,
    createdAt: "2026-07-15T00:00:00.000Z",
    startedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:01.000Z",
    completedAt: "2026-07-15T00:00:01.000Z",
    failedAt: "",
    error: null,
  };
  // Use the canonical legacy binding exported by the Command Idempotency Module.
  const { commandResultBinding } = require("../src/commandIdempotency");
  legacyRecord.result = resultCodec.encode(
    { phone: "13800000000", status: "DONE" },
    { binding: commandResultBinding(legacyRecord) }
  );

  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  const imported = await adapter.claim(legacyInput, { legacyRecord });
  assert.equal(imported.kind, "REPLAY");
  assert.deepEqual(imported.outcome.result, { phone: "13800000000", status: "DONE" });
  assert.equal(connection.row.attempt_count, 3);
  assert.notEqual(connection.row.idempotency_key, RAW_REQUEST_ID);
  assert.doesNotMatch(JSON.stringify(connection.row), /13800000000|request-raw/);

  const replay = await adapter.claim(legacyInput);
  assert.deepEqual(replay.outcome.result, { phone: "13800000000", status: "DONE" });
});

test("legacy digest conflicts preserve 40901 and ambiguous IN_PROGRESS fails closed", async () => {
  const legacy = {
    recordId: "cmdidem_legacy_002",
    commandName: input().commandName,
    actorId: input().actorId,
    idempotencyKey: RAW_REQUEST_ID,
    requestDigest: "0".repeat(64),
    status: "SUCCEEDED",
    result: null,
    attempts: 1,
  };
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  await assert.rejects(
    () => adapter.claim(input(), { legacyRecord: legacy }),
    (error) => error.code === 40901
  );
  assert.equal(connection.row, null);

  legacy.requestDigest = digestCommandRequest(input().request);
  legacy.status = "IN_PROGRESS";
  await assert.rejects(
    () => adapter.claim(input(), { legacyRecord: legacy }),
    (error) => error.code === 40903
  );
  assert.equal(connection.row, null);
});

test("database failures are generic AtomicWriteError values without original SQL details", async () => {
  const connection = new FakeCommandConnection();
  connection.failOnce("command-idempotency:select-scope", "SQL failed phone=13800000000 token=secret");
  const adapter = createAdapter(connection);
  await assert.rejects(
    () => adapter.claim(input()),
    (error) => {
      assert.equal(isAtomicWriteError(error), true);
      assert.equal(error.message, "atomic write failed");
      assert.equal(error.cause.message, "command idempotency persistence failed");
      assert.doesNotMatch(JSON.stringify(error), /13800000000|token|secret|SQL failed/);
      return true;
    }
  );
});

test("malformed persisted result JSON fails as a generic atomic persistence error", async () => {
  const { connection, adapter } = await claimThenRow();
  connection.row.status = "SUCCEEDED";
  connection.row.result_json = "{contains:phone=13800000000";
  await assert.rejects(
    () => adapter.claim(input()),
    (error) => {
      assert.equal(isAtomicWriteError(error), true);
      assert.equal(error.cause.message, "command idempotency persistence failed");
      assert.doesNotMatch(JSON.stringify(error), /13800000000|contains/);
      return true;
    }
  );
});

test("constructor requires ready keyed codecs before the first SQL call", () => {
  const missing = new FakeCommandConnection();
  assert.throws(
    () => createMysqlCommandIdempotencyAdapter(missing),
    isAtomicWriteError
  );
  assert.equal(missing.calls.length, 0);

  const plaintext = new FakeCommandConnection();
  assert.throws(
    () => createMysqlCommandIdempotencyAdapter(plaintext, {
      requestDigestCodec: requestDigestCodec(),
      resultCodec: createCommandResultCodec({ NODE_ENV: "test" }),
    }),
    isAtomicWriteError
  );
  assert.equal(plaintext.calls.length, 0);
});

test("caller supplied digest and per-call plaintext codec cannot downgrade persistence", async () => {
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  const claimed = await adapter.claim(input({ requestDigest: "0".repeat(64) }));
  assert.notEqual(connection.row.request_digest, "0".repeat(64));
  const completed = await adapter.completeOwnedAttempt(
    claimed.claim,
    { phone: "13800000000" },
    { resultCodec: createCommandResultCodec({ NODE_ENV: "test" }) }
  );
  assert.deepEqual(completed.result, { phone: "13800000000" });
  assert.equal(connection.row.result_codec_version, "A256GCM:v1");
  assert.doesNotMatch(connection.row.result_json, /13800000000/);
});

test("selected scope is checked byte-for-byte after the binary database lookup", async () => {
  const cases = [
    ["command_name", (value) => value.toLowerCase()],
    ["actor_id", (value) => `${value} `],
    ["idempotency_key", flipLastHex],
  ];
  for (const [field, mutate] of cases) {
    const { connection, adapter } = await claimThenRow();
    connection.row[field] = mutate(connection.row[field]);
    connection.forceScopeRow = true;
    await assert.rejects(() => adapter.claim(input()), isAtomicWriteError, field);
  }

  const unicodeInput = input({ actorId: "root-user-caf\u00e9" });
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  await adapter.claim(unicodeInput);
  connection.row.actor_id = "root-user-cafe\u0301";
  connection.forceScopeRow = true;
  await assert.rejects(() => adapter.claim(unicodeInput), isAtomicWriteError);
});

test("owned lock, completion and failure fence every scope and digest metadata field", async () => {
  const mutations = [
    (claim) => ({ ...claim, commandName: `${claim.commandName}_OTHER` }),
    (claim) => ({ ...claim, actorId: `${claim.actorId}_other` }),
    (claim) => ({ ...claim, idempotencyKeyToken: flipLastHex(claim.idempotencyKeyToken) }),
    (claim) => ({ ...claim, requestDigest: flipLastHex(claim.requestDigest) }),
    (claim) => ({ ...claim, requestDigestScheme: "sha256:v0", requestDigestKeyId: null }),
    (claim) => ({ ...claim, requestDigestKeyId: "mysql-command-digest-v2" }),
  ];
  for (const mutate of mutations) {
    const { connection, adapter, claimed } = await claimThenRow();
    const forged = mutate(claimed.claim);
    await assert.rejects(() => adapter.lockOwnedAttempt(forged), isAtomicWriteError);
    await assert.rejects(() => adapter.completeOwnedAttempt(forged, { forged: true }), isAtomicWriteError);
    await assert.rejects(() => adapter.failOwnedAttempt(forged, new Error("forged")), isAtomicWriteError);
    assert.equal(connection.row.status, "IN_PROGRESS");
  }
});

test("replay rejects result metadata that does not exactly match the protected envelope", async () => {
  for (const [field, value] of [
    ["result_codec_version", "A256GCM:v2"],
    ["result_key_id", "mysql-command-key-v2"],
  ]) {
    const { connection, adapter, claimed } = await claimThenRow();
    await adapter.completeOwnedAttempt(claimed.claim, { ok: true });
    connection.row[field] = value;
    await assert.rejects(() => adapter.claim(input()), isAtomicWriteError);
  }
});

test("legacy relational success is verified then atomically upgraded to HMAC and result metadata", async () => {
  const resultCodec = codec();
  const { connection, adapter } = await claimThenRow();
  const legacyDigest = digestCommandRequest(input().request);
  const legacyRecord = {
    recordId: connection.row.command_idempotency_id,
    commandName: connection.row.command_name,
    actorId: connection.row.actor_id,
    idempotencyKey: connection.row.idempotency_key,
    requestDigest: legacyDigest,
  };
  const { commandResultBinding } = require("../src/commandIdempotency");
  connection.row.request_digest = legacyDigest;
  connection.row.request_digest_scheme = "sha256:v0";
  connection.row.request_digest_key_id = null;
  connection.row.status = "SUCCEEDED";
  connection.row.lease_owner = null;
  connection.row.lease_expires_at = null;
  connection.row.result_json = JSON.stringify(resultCodec.encode(
    { status: "DONE", phone: "13800000000" },
    { binding: commandResultBinding(legacyRecord) }
  ));
  connection.row.result_codec_version = null;
  connection.row.result_key_id = null;

  const replay = await adapter.claim(input());
  assert.equal(replay.kind, "REPLAY");
  assert.deepEqual(replay.outcome.result, { status: "DONE", phone: "13800000000" });
  assert.equal(connection.row.request_digest_scheme, "hmac-sha256:v1");
  assert.equal(connection.row.request_digest_key_id, "mysql-command-digest-v1");
  assert.equal(connection.row.result_codec_version, "A256GCM:v1");
  assert.equal(connection.row.result_key_id, "mysql-command-key-v1");
  assert.notEqual(connection.row.request_digest, legacyDigest);
  assert.doesNotMatch(connection.row.result_json, /13800000000/);
});

test("legacy failed and expired in-progress rows upgrade digest metadata inside the fenced attempt", async () => {
  for (const status of ["FAILED", "IN_PROGRESS"]) {
    const { connection, adapter } = await claimThenRow();
    const legacyDigest = digestCommandRequest(input().request);
    connection.row.request_digest = legacyDigest;
    connection.row.request_digest_scheme = "sha256:v0";
    connection.row.request_digest_key_id = null;
    connection.row.status = status;
    if (status === "FAILED") {
      connection.row.lease_owner = null;
      connection.row.lease_expires_at = null;
    } else {
      connection.row.lease_expires_at = NOW;
    }
    const next = await adapter.claim(input());
    assert.equal(next.kind, "CLAIMED");
    assert.equal(next.claim.requestDigestScheme, "hmac-sha256:v1");
    assert.equal(connection.row.request_digest_scheme, "hmac-sha256:v1");
    assert.equal(connection.row.request_digest_key_id, "mysql-command-digest-v1");
  }
});

test("unknown digest scheme and inactive digest key fail as unsafe stored state", async () => {
  for (const mutate of [
    (row) => { row.request_digest_scheme = "unknown:v9"; },
    (row) => { row.request_digest_key_id = "retired-key-v0"; },
  ]) {
    const { connection, adapter } = await claimThenRow();
    mutate(connection.row);
    await assert.rejects(
      () => adapter.claim(input()),
      (error) => error.code === 40903 && error.status === 409
    );
  }
});

test("discard retires the transaction Adapter", async () => {
  const connection = new FakeCommandConnection();
  const adapter = createAdapter(connection);
  adapter.discard();
  await assert.rejects(() => adapter.claim(input()), isAtomicWriteError);
  assert.equal(connection.calls.length, 0);
});
