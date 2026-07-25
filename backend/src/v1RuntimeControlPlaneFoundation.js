const crypto = require("node:crypto");

const {
  createKeyInventoryReadinessFoundation,
} = require("./keyInventoryReadinessFoundation");
const {
  createMysqlV1RuntimeControlLedger,
} = require("./mysqlV1RuntimeControlLedger");
const {
  createMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
} = require("./mysqlV1RuntimeAlertDeliveryAuthorityAdapter");
const { runtimeAlertDeliveryMode } = require("./v1RuntimeAlertPayloadAdapter");
const {
  createV1RuntimeOrchestrationFoundation,
} = require("./v1RuntimeOrchestrationFoundation");

const CONTRACT_VERSION = "V1_RUNTIME_CONTROL_PLANE:v1";
const ENABLE_FLAG = "MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED";
const READY_REQUIRED_FLAG = "ROOT_V1_RUNTIME_READY_REQUIRED";
const KILL_SWITCH_FLAG = "MYROOT_V1_RUNTIME_KILL_SWITCH";
const RUNTIME_OWNER_FLAG = "MYROOT_V1_RUNTIME_OWNER";
const ATTESTATION_MAX_AGE_FLAG = "MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS";
const RELEASE_ID_FLAG = "ROOT_RELEASE_ID";
const DEFAULT_ATTESTATION_MAX_AGE_SECONDS = 180;
const CYCLE_LEASE_SECONDS = 120;
const LEASE_HEARTBEAT_INTERVAL_MILLISECONDS = 30_000;
const STALE_RECOVERY_LIMIT = 10;

const PRODUCTION_OPTION_KEYS = Object.freeze([
  "env",
  "heartbeatPool",
  "orchestrationPool",
  "pool",
  "registrarHeartbeatPool",
  "registrarPool",
  "runtimeAlertInspectorCurrentUser",
  "runtimeAlertInspectorPool",
  "runtimeAlertRegistrarCurrentUser",
  "runtimeAlertWorkerCurrentUser",
  "runtimeAlertWorkerPool",
]);
const SCHEDULE_INPUT_KEYS = Object.freeze([
  "bridgeLimit",
  "recoveryLimit",
  "scheduleId",
  "scheduledAt",
  "workerLimit",
]);
const LEDGER_KEYS = Object.freeze([
  "claimCycle",
  "finalizeCycle",
  "inspect",
  "recordAlert",
  "recoverStale",
  "renewCycle",
]);
const KEY_INVENTORY_KEYS = Object.freeze(["inspect", "verify"]);
const RUNTIME_KEYS = Object.freeze(["inspect", "runOneShot"]);
const TERMINAL_STATUSES = Object.freeze([
  "FAILED_PRECONDITION",
  "REVIEW_REQUIRED",
  "SKIPPED_BUSY",
  "SUCCEEDED",
]);
const READY_ATTESTATION_STATES = new Set(["SAFE", "WARNING", "BUSY"]);
const PRECONDITION_CODES = new Set([
  "V1_RUNTIME_ORCHESTRATOR_CONFIGURATION_INVALID",
  "V1_RUNTIME_ORCHESTRATOR_COORDINATION_FAILED",
  "V1_RUNTIME_ORCHESTRATOR_DISABLED",
  "V1_RUNTIME_ORCHESTRATOR_KILL_SWITCH_ENGAGED",
  "V1_RUNTIME_ORCHESTRATOR_NOT_READY",
  "V1_RUNTIME_ORCHESTRATOR_TARGET_AUTHORITY_FAILED",
]);

function controlError(code, status = 503) {
  const error = new Error("v1 runtime control plane operation failed");
  error.code = code;
  error.status = status;
  return error;
}

function configurationError() {
  return controlError("V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID");
}

function inputError() {
  return controlError("V1_RUNTIME_CONTROL_PLANE_INPUT_INVALID", 400);
}

function persistenceError() {
  return controlError("V1_RUNTIME_CONTROL_PLANE_PERSISTENCE_FAILED");
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
  return keys.length === wanted.length
    && keys.every((key, index) => key === wanted[index]);
}

function opaqueAscii(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function releaseIdentifier(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(value);
}

function sha256Digest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function stableCode(value, fallback = "V1_RUNTIME_CONTROL_PLANE_OPERATION_FAILED") {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
    ? value
    : fallback;
}

function nonNegativeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw persistenceError();
  return count;
}

function exactIsoInstant(value) {
  if (typeof value !== "string" || value.length > 32) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function exactBooleanFlag(env, name, fallback = false) {
  if (!Object.prototype.hasOwnProperty.call(env, name) || env[name] === "") return fallback;
  if (env[name] === "true") return true;
  if (env[name] === "false") return false;
  throw configurationError();
}

function positiveIntegerEnv(env, name, fallback, maximum) {
  const raw = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : String(fallback);
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) throw configurationError();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw configurationError();
  return parsed;
}

function normalizeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw inputError();
  return value;
}

function canonicalInstant(value) {
  if (typeof value !== "string" || value.length > 32) throw inputError();
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw inputError();
  const canonical = new Date(epoch).toISOString();
  if (canonical !== value) throw inputError();
  return canonical;
}

function normalizeScheduleInput(input) {
  if (!exactKeys(input, SCHEDULE_INPUT_KEYS)
    || !opaqueAscii(input.scheduleId, 128)) throw inputError();
  return Object.freeze({
    bridgeLimit: normalizeLimit(input.bridgeLimit),
    recoveryLimit: normalizeLimit(input.recoveryLimit),
    scheduleId: input.scheduleId,
    scheduledAt: canonicalInstant(input.scheduledAt),
    workerLimit: normalizeLimit(input.workerLimit),
  });
}

function digest(domain, value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw persistenceError(); }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw persistenceError();
  }
  return crypto.createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(serialized, "utf8")
    .digest("hex");
}

function inputDigest(input) {
  return digest("myroot:v1-runtime-control-input:v1", input);
}

function scopeText(env, name, maximumBytes = 64 * 1024) {
  const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw configurationError();
  }
  return value;
}

function platformEnvironmentId(env) {
  return scopeText(env, "ROOT_CLOUDBASE_ENV_ID", 256)
    || scopeText(env, "CLOUDBASE_ENV_ID", 256)
    || scopeText(env, "TCB_ENV_ID", 256);
}

function requiredScopeInteger(env, name, minimum, maximum) {
  const raw = scopeText(env, name, 16);
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw configurationError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError();
  }
  return value;
}

function deploymentIdentity(env) {
  const revision = scopeText(env, "K_REVISION", 128);
  const artifactDigest = scopeText(env, "ROOT_RELEASE_ARTIFACT_DIGEST", 64);
  if ((!revision && !artifactDigest)
    || (revision && !opaqueAscii(revision, 128))
    || (artifactDigest && !sha256Digest(artifactDigest))) throw configurationError();
  return Object.freeze({ revision, artifactDigest });
}

function runtimeControlScopeId(env) {
  const mysqlPort = Number(scopeText(env, "MYSQL_PORT", 8));
  const target = {
    platformEnvironmentId: platformEnvironmentId(env),
    mysqlHost: scopeText(env, "MYSQL_HOST", 256),
    mysqlPort,
    mysqlUsername: scopeText(env, "MYSQL_USERNAME", 256),
    database: env.MYSQL_DATABASE,
    targetGeneration: scopeText(env, "MYROOT_V1_RUNTIME_TARGET_GENERATION", 96),
  };
  const capacity = {
    mainConnectionLimit: requiredScopeInteger(env, "MYROOT_V1_MAIN_CONNECTION_LIMIT", 1, 1024),
    runtimeConnectionLimit: requiredScopeInteger(env, "MYROOT_V1_RUNTIME_CONNECTION_LIMIT", 3, 64),
    heartbeatConnectionLimit: requiredScopeInteger(
      env,
      "MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT",
      1,
      1
    ),
    maximumInstances: requiredScopeInteger(env, "MYROOT_CLOUDRUN_MAX_INSTANCES", 1, 10000),
    serverMaximumConnections: requiredScopeInteger(env, "MYSQL_SERVER_MAX_CONNECTIONS", 1, 1000000000),
    headroomConnections: requiredScopeInteger(env, "MYROOT_MYSQL_CONNECTION_HEADROOM", 0, 1000000000),
    evidenceRef: scopeText(env, "MYROOT_MYSQL_CAPACITY_EVIDENCE_REF", 256),
  };
  const requiredConnections = (
    capacity.mainConnectionLimit
    + capacity.runtimeConnectionLimit
    + capacity.heartbeatConnectionLimit
  ) * capacity.maximumInstances + capacity.headroomConnections;
  if (requiredConnections > capacity.serverMaximumConnections
    || !opaqueAscii(capacity.evidenceRef, 256)) throw configurationError();
  const keyConfigurationFingerprint = digest(
    "myroot:v1-runtime-key-configuration:v1",
    {
      commandRequestKeyId: scopeText(env, "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID", 64),
      commandRequestMaterial: scopeText(env, "ROOT_COMMAND_REQUEST_DIGEST_KEY"),
      commandRequestVerificationKeyring: scopeText(env, "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON"),
      commandResultKeyId: scopeText(env, "ROOT_COMMAND_RESULT_KEY_ID", 64),
      commandResultMaterial: scopeText(env, "ROOT_COMMAND_RESULT_ENCRYPTION_KEY"),
      commandResultDecryptionKeyring: scopeText(env, "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON"),
      inboxContentKeyId: scopeText(env, "ROOT_INBOX_CONTENT_KEY_ID", 64),
      inboxContentMaterial: scopeText(env, "ROOT_INBOX_CONTENT_ENCRYPTION_KEY"),
      inboxDecryptionKeyring: scopeText(env, "ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON"),
      notificationReceiptKeyId: scopeText(
        env,
        "ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID",
        64
      ),
      notificationReceiptMaterial: scopeText(
        env,
        "ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY"
      ),
      retiredKeyIds: scopeText(env, "ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON"),
    }
  );
  const scope = {
    contractVersion: CONTRACT_VERSION,
    releaseId: env[RELEASE_ID_FLAG],
    deploymentIdentity: deploymentIdentity(env),
    environmentId: env.MYROOT_V1_RUNTIME_ENVIRONMENT_ID,
    target,
    runtimeOwner: env[RUNTIME_OWNER_FLAG],
    capacity,
    attestationMaximumAgeSeconds: env[ATTESTATION_MAX_AGE_FLAG]
      || String(DEFAULT_ATTESTATION_MAX_AGE_SECONDS),
    runtimeFlags: {
      control: env[ENABLE_FLAG] || "",
      runtime: env.MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED || "",
      bridge: env.MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED || "",
      worker: env.MYROOT_INBOX_WORKER_HARNESS_ENABLED || "",
      keyInventory: env.ROOT_KEY_INVENTORY_READINESS_ENABLED || "",
      killSwitch: env[KILL_SWITCH_FLAG] || "",
    },
    keyConfigurationFingerprint,
  };
  if (!releaseIdentifier(scope.releaseId)
    || !opaqueAscii(scope.environmentId, 96)
    || !opaqueAscii(scope.runtimeOwner, 96)
    || !opaqueAscii(target.platformEnvironmentId, 128)
    || !opaqueAscii(target.mysqlHost, 255)
    || !Number.isInteger(target.mysqlPort)
    || target.mysqlPort < 1
    || target.mysqlPort > 65535
    || !opaqueAscii(target.mysqlUsername, 128)
    || !opaqueAscii(target.database, 64)
    || !opaqueAscii(target.targetGeneration, 96)) throw configurationError();
  return `cp-${digest("myroot:v1-runtime-control-scope:v1", scope).slice(0, 64)}`;
}

function assertAdapter(adapter, keys) {
  if (!exactKeys(adapter, keys)
    || keys.some((key) => typeof adapter[key] !== "function")) throw configurationError();
  return adapter;
}

function normalizeKeyInventoryReport(report) {
  if (!plainRecord(report)
    || typeof report.ready !== "boolean"
    || !stableCode(report.status, "")
    || !plainRecord(report.schema)
    || typeof report.schema.ready !== "boolean"
    || !stableCode(report.schema.status, "")
    || !Array.isArray(report.issues)) throw persistenceError();
  return Object.freeze({
    ready: report.ready === true && report.schema.ready === true,
    status: stableCode(report.status),
    schemaStatus: stableCode(report.schema.status),
    issueCount: report.issues.length,
  });
}

function normalizeRuntimeInspection(report) {
  if (!plainRecord(report)
    || !plainRecord(report.readiness)
    || typeof report.readiness.ready !== "boolean"
    || !Array.isArray(report.readiness.blockerCodes)) throw persistenceError();
  const blockerCodes = [...new Set(report.readiness.blockerCodes.map((code) => stableCode(code)))];
  return Object.freeze({
    ready: report.readiness.ready === true && blockerCodes.length === 0,
    blockerCodes: Object.freeze(blockerCodes),
  });
}

function normalizeClaim(value, expectedEnvironmentId = null) {
  const keys = [
    "blockerCount", "claimedAt", "completedAt", "cycleId", "environmentId", "errorCode",
    "inputDigest", "leaseExpiresAt", "leaseGeneration", "leaseOwner", "outcome", "resultDigest",
    "scheduleId", "scheduledAt", "status",
  ];
  if (!exactKeys(value, keys)
    || !["CLAIMED", "REPLAY"].includes(value.outcome)
    || !sha256Digest(value.cycleId)
    || !sha256Digest(value.inputDigest)
    || !opaqueAscii(value.environmentId, 96)
    || (expectedEnvironmentId !== null && value.environmentId !== expectedEnvironmentId)
    || !opaqueAscii(value.scheduleId, 128)
    || !Number.isSafeInteger(value.leaseGeneration)
    || value.leaseGeneration < 1
    || !["RUNNING", ...TERMINAL_STATUSES].includes(value.status)) throw persistenceError();
  if (value.status === "RUNNING") {
    if (!opaqueAscii(value.leaseOwner, 128)
      || typeof value.leaseExpiresAt !== "string"
      || value.completedAt !== null
      || value.resultDigest !== null
      || value.errorCode !== null
      || nonNegativeCount(value.blockerCount) !== 0) throw persistenceError();
  } else if (value.leaseOwner !== null
    || value.leaseExpiresAt !== null
    || typeof value.completedAt !== "string"
    || !sha256Digest(value.resultDigest)
    || (value.status === "SUCCEEDED" ? value.errorCode !== null : !stableCode(value.errorCode, ""))) {
    throw persistenceError();
  }
  return Object.freeze({ ...value, blockerCount: nonNegativeCount(value.blockerCount) });
}

function normalizeTerminal(value, expectedEnvironmentId = null) {
  const keys = [
    "blockerCount", "claimedAt", "completedAt", "cycleId", "environmentId", "errorCode",
    "inputDigest", "leaseExpiresAt", "leaseGeneration", "leaseOwner", "resultDigest", "scheduleId",
    "scheduledAt", "status",
  ];
  if (!exactKeys(value, keys) || !TERMINAL_STATUSES.includes(value.status)) {
    throw persistenceError();
  }
  return normalizeClaim({ outcome: "REPLAY", ...value }, expectedEnvironmentId);
}

function normalizeRenewedLease(value, previous) {
  const keys = [
    "blockerCount", "claimedAt", "completedAt", "cycleId", "environmentId", "errorCode",
    "inputDigest", "leaseExpiresAt", "leaseGeneration", "leaseOwner", "resultDigest", "scheduleId",
    "scheduledAt", "status",
  ];
  if (!exactKeys(value, keys)) throw persistenceError();
  const renewed = normalizeClaim({ outcome: "REPLAY", ...value });
  if (renewed.status !== "RUNNING"
    || renewed.cycleId !== previous.cycleId
    || renewed.environmentId !== previous.environmentId
    || renewed.scheduleId !== previous.scheduleId
    || renewed.scheduledAt !== previous.scheduledAt
    || renewed.inputDigest !== previous.inputDigest
    || renewed.leaseOwner !== previous.leaseOwner
    || renewed.leaseGeneration !== previous.leaseGeneration + 1) throw persistenceError();
  return renewed;
}

function publicCycle(value, replayed) {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    scheduleId: value.scheduleId,
    cycleId: value.cycleId,
    status: value.status,
    replayed,
    inputDigest: value.inputDigest,
    resultDigest: value.resultDigest,
    blockerCount: value.blockerCount,
    errorCode: value.errorCode,
    completedAt: value.completedAt,
  });
}

function normalizeLedgerInspection(value, expectedEnvironmentId, expectedDatabase) {
  if (!exactKeys(value, [
    "attestation", "databaseName", "environmentId", "inspectedAt", "maximumAgeSeconds",
    "openAlerts", "reviewRequiredCount",
  ])
    || value.environmentId !== expectedEnvironmentId
    || value.databaseName !== expectedDatabase
    || !exactIsoInstant(value.inspectedAt)
    || !plainRecord(value.attestation)
    || !exactKeys(value.attestation, [
      "ageSeconds", "completedAt", "cycleId", "latestTerminalCompletedAt",
      "latestTerminalCycleId", "latestTerminalStatus", "state",
    ])
    || !["SAFE", "WARNING", "BUSY", "STALE", "BLOCKED", "MISSING"].includes(value.attestation.state)
    || !plainRecord(value.openAlerts)
    || !exactKeys(value.openAlerts, ["blockerCount", "latestObservedAt", "totalCount", "warningCount"])) {
    throw persistenceError();
  }
  const proofFields = [
    value.attestation.cycleId,
    value.attestation.completedAt,
    value.attestation.ageSeconds,
  ];
  const hasProof = proofFields.every((item) => item !== null);
  if (!hasProof && proofFields.some((item) => item !== null)) throw persistenceError();
  if (hasProof && (!sha256Digest(value.attestation.cycleId)
    || !exactIsoInstant(value.attestation.completedAt)
    || !Number.isSafeInteger(value.attestation.ageSeconds)
    || value.attestation.ageSeconds < 0)) throw persistenceError();
  if (["SAFE", "WARNING", "BUSY", "STALE"].includes(value.attestation.state) && !hasProof) {
    throw persistenceError();
  }
  if (value.attestation.state === "MISSING" && hasProof) throw persistenceError();

  const latestTerminalFields = [
    value.attestation.latestTerminalCycleId,
    value.attestation.latestTerminalStatus,
    value.attestation.latestTerminalCompletedAt,
  ];
  const hasLatestTerminal = latestTerminalFields.every((item) => item !== null);
  if (!hasLatestTerminal && latestTerminalFields.some((item) => item !== null)) throw persistenceError();
  if (hasLatestTerminal && (!sha256Digest(value.attestation.latestTerminalCycleId)
    || !TERMINAL_STATUSES.includes(value.attestation.latestTerminalStatus)
    || !exactIsoInstant(value.attestation.latestTerminalCompletedAt))) throw persistenceError();
  const openAlerts = {
    totalCount: nonNegativeCount(value.openAlerts.totalCount),
    blockerCount: nonNegativeCount(value.openAlerts.blockerCount),
    warningCount: nonNegativeCount(value.openAlerts.warningCount),
    latestObservedAt: value.openAlerts.latestObservedAt,
  };
  if (openAlerts.totalCount !== openAlerts.blockerCount + openAlerts.warningCount) {
    throw persistenceError();
  }
  if ((openAlerts.totalCount === 0) !== (openAlerts.latestObservedAt === null)
    || (openAlerts.latestObservedAt !== null && !exactIsoInstant(openAlerts.latestObservedAt))) {
    throw persistenceError();
  }
  return Object.freeze({
    attestation: Object.freeze({ ...value.attestation }),
    openAlerts: Object.freeze(openAlerts),
    reviewRequiredCount: nonNegativeCount(value.reviewRequiredCount),
    maximumAgeSeconds: nonNegativeCount(value.maximumAgeSeconds),
  });
}

function safeFailureSummary(error) {
  const code = stableCode(error && error.code);
  const blockerCodes = Array.isArray(error && error.blockerCodes)
    ? [...new Set(error.blockerCodes.map((item) => stableCode(item)))]
    : [];
  const cycleDeadLetterCount = Number.isSafeInteger(error && error.cycleDeadLetterCount)
    && error.cycleDeadLetterCount >= 0 ? error.cycleDeadLetterCount : 0;
  const newWorkerTerminalCount = Number.isSafeInteger(error && error.newWorkerTerminalCount)
    && error.newWorkerTerminalCount >= 0 ? error.newWorkerTerminalCount : 0;
  return Object.freeze({ code, blockerCodes, cycleDeadLetterCount, newWorkerTerminalCount });
}

function createV1RuntimeControlPlaneCore({ env, adapters, instanceId }) {
  if (!plainRecord(env) || !opaqueAscii(instanceId, 64)) throw configurationError();
  const ledger = assertAdapter(adapters.ledger, LEDGER_KEYS);
  const keyInventory = assertAdapter(adapters.keyInventory, KEY_INVENTORY_KEYS);
  const runtime = assertAdapter(adapters.runtime, RUNTIME_KEYS);
  const enabled = exactBooleanFlag(env, ENABLE_FLAG, false);
  const readyRequired = exactBooleanFlag(env, READY_REQUIRED_FLAG, false);
  const attestationMaximumAgeSeconds = positiveIntegerEnv(
    env,
    ATTESTATION_MAX_AGE_FLAG,
    DEFAULT_ATTESTATION_MAX_AGE_SECONDS,
    3600
  );
  const killSwitch = env[KILL_SWITCH_FLAG] === "DISENGAGED" ? "DISENGAGED" : "ENGAGED";
  const runtimeOwner = env[RUNTIME_OWNER_FLAG];
  if (enabled && !opaqueAscii(runtimeOwner, 96)) throw configurationError();
  const controlScopeId = enabled ? runtimeControlScopeId(env) : null;
  const leaseOwner = `cp-${digest("myroot:v1-runtime-control-instance:v1", {
    instanceId,
    runtimeOwner: runtimeOwner || "UNASSIGNED",
  }).slice(0, 48)}`;

  async function renewLease(previous) {
    try {
      return normalizeRenewedLease(await ledger.renewCycle({
        cycleId: previous.cycleId,
        leaseOwner: previous.leaseOwner,
        leaseGeneration: previous.leaseGeneration,
        leaseSeconds: CYCLE_LEASE_SECONDS,
      }), previous);
    } catch {
      throw controlError("V1_RUNTIME_CONTROL_PLANE_LEASE_HEARTBEAT_FAILED");
    }
  }

  async function startLeaseHeartbeat(claim) {
    let current = await renewLease(claim);
    let timer = null;
    let inFlight = null;
    let failure = null;
    let stopped = false;

    function scheduleNext() {
      timer = setTimeout(() => { void beat(); }, LEASE_HEARTBEAT_INTERVAL_MILLISECONDS);
      if (timer && typeof timer.unref === "function") timer.unref();
    }

    async function beat() {
      if (stopped) return;
      const pending = renewLease(current);
      inFlight = pending;
      try {
        current = await pending;
      } catch {
        failure = controlError("V1_RUNTIME_CONTROL_PLANE_LEASE_HEARTBEAT_FAILED");
        stopped = true;
      } finally {
        if (inFlight === pending) inFlight = null;
      }
      if (!stopped) scheduleNext();
    }

    scheduleNext();
    return Object.freeze({
      assertHealthy() {
        if (failure) throw failure;
      },
      async stop() {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        const pending = inFlight;
        if (pending) { try { await pending; } catch {} }
        if (failure) throw failure;
        return current;
      },
    });
  }

  async function inspect() {
    if (!enabled) {
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        enabled: false,
        required: readyRequired,
        ready: !readyRequired,
        status: readyRequired
          ? "V1_RUNTIME_CONTROL_PLANE_REQUIRED_BUT_DISABLED"
          : "V1_RUNTIME_CONTROL_PLANE_NOT_REQUIRED",
        killSwitch,
        attestation: Object.freeze({
          state: "MISSING",
          cycleId: null,
          completedAt: null,
          ageSeconds: null,
          latestTerminalCycleId: null,
          latestTerminalStatus: null,
          latestTerminalCompletedAt: null,
        }),
        openAlerts: Object.freeze({ totalCount: 0, blockerCount: 0, warningCount: 0, latestObservedAt: null }),
        reviewRequiredCount: 0,
      });
    }
    const snapshot = normalizeLedgerInspection(await ledger.inspect({
      maximumAgeSeconds: attestationMaximumAgeSeconds,
    }), controlScopeId, env.MYSQL_DATABASE);
    if (snapshot.maximumAgeSeconds !== attestationMaximumAgeSeconds) throw persistenceError();
    const ready = killSwitch === "DISENGAGED"
      && READY_ATTESTATION_STATES.has(snapshot.attestation.state)
      && snapshot.openAlerts.blockerCount === 0
      && snapshot.reviewRequiredCount === 0;
    let status = "V1_RUNTIME_CONTROL_PLANE_READY";
    if (killSwitch !== "DISENGAGED") status = "V1_RUNTIME_CONTROL_PLANE_KILL_SWITCH_ENGAGED";
    else if (snapshot.attestation.state === "MISSING") status = "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_MISSING";
    else if (snapshot.attestation.state === "STALE") status = "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_STALE";
    else if (snapshot.attestation.state === "BLOCKED") status = "V1_RUNTIME_CONTROL_PLANE_ATTESTATION_BLOCKED";
    else if (snapshot.attestation.state === "WARNING") status = "V1_RUNTIME_CONTROL_PLANE_READY_WITH_WARNING";
    else if (snapshot.attestation.state === "BUSY") status = "V1_RUNTIME_CONTROL_PLANE_READY_BUSY";
    else if (snapshot.openAlerts.blockerCount > 0 || snapshot.reviewRequiredCount > 0) {
      status = "V1_RUNTIME_CONTROL_PLANE_REVIEW_REQUIRED";
    }
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      enabled: true,
      required: readyRequired,
      ready,
      status,
      killSwitch,
      attestation: snapshot.attestation,
      openAlerts: snapshot.openAlerts,
      reviewRequiredCount: snapshot.reviewRequiredCount,
    });
  }

  async function previewScheduledCycle(input) {
    const schedule = normalizeScheduleInput(input);
    const scheduleInputDigest = inputDigest(schedule);
    if (!enabled) {
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        enabled: false,
        ready: false,
        status: "V1_RUNTIME_CONTROL_PLANE_DISABLED",
        scheduleId: schedule.scheduleId,
        inputDigest: scheduleInputDigest,
        keyInventory: Object.freeze({ ready: false, status: "NOT_INSPECTED", schemaStatus: "NOT_INSPECTED", issueCount: 0 }),
        runtime: Object.freeze({ ready: false, blockerCodes: Object.freeze(["CONTROL_PLANE_DISABLED"]) }),
      });
    }
    const keySummary = normalizeKeyInventoryReport(await keyInventory.inspect());
    const runtimeSummary = normalizeRuntimeInspection(await runtime.inspect());
    const ready = keySummary.ready && runtimeSummary.ready && killSwitch === "DISENGAGED";
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      enabled: true,
      ready,
      status: ready ? "V1_RUNTIME_SCHEDULE_READY" : "V1_RUNTIME_SCHEDULE_NOT_READY",
      scheduleId: schedule.scheduleId,
      inputDigest: scheduleInputDigest,
      keyInventory: keySummary,
      runtime: runtimeSummary,
    });
  }

  async function finalizeFailure(claim, status, summary, blockerCount, severity) {
    const errorCode = stableCode(summary.code);
    const resultDigest = digest("myroot:v1-runtime-control-failure:v1", summary);
    const terminal = normalizeTerminal(await ledger.finalizeCycle({
      cycleId: claim.cycleId,
      leaseOwner: claim.leaseOwner,
      leaseGeneration: claim.leaseGeneration,
      status,
      resultDigest,
      blockerCount,
      errorCode,
    }), controlScopeId);
    await ensureTerminalAlert(terminal, severity);
    return publicCycle(terminal, false);
  }

  async function ensureTerminalAlert(terminal, severity) {
    if (terminal.status === "SUCCEEDED" || terminal.status === "RUNNING") return;
    await ledger.recordAlert({
      cycleId: terminal.cycleId,
      alertCode: stableCode(terminal.errorCode),
      severity: severity || (terminal.status === "SKIPPED_BUSY" ? "WARNING" : "BLOCKER"),
    });
  }

  async function runScheduledCycle(input) {
    const schedule = normalizeScheduleInput(input);
    if (!enabled) throw controlError("V1_RUNTIME_CONTROL_PLANE_DISABLED");
    const scheduleInputDigest = inputDigest(schedule);
    await ledger.recoverStale({ limit: STALE_RECOVERY_LIMIT });
    const claim = normalizeClaim(await ledger.claimCycle({
      scheduleId: schedule.scheduleId,
      scheduledAt: schedule.scheduledAt,
      inputDigest: scheduleInputDigest,
      leaseOwner,
      leaseSeconds: CYCLE_LEASE_SECONDS,
    }), controlScopeId);
    if (claim.inputDigest !== scheduleInputDigest
      || claim.scheduleId !== schedule.scheduleId
      || claim.scheduledAt !== schedule.scheduledAt) throw persistenceError();
    if (claim.outcome === "REPLAY") {
      await ensureTerminalAlert(claim);
      return publicCycle(claim, true);
    }
    if (claim.status !== "RUNNING") throw persistenceError();

    if (killSwitch !== "DISENGAGED") {
      return finalizeFailure(
        claim,
        "FAILED_PRECONDITION",
        Object.freeze({ code: "V1_RUNTIME_CONTROL_PLANE_KILL_SWITCH_ENGAGED" }),
        1,
        "BLOCKER"
      );
    }

    const heartbeat = await startLeaseHeartbeat(claim);
    let heartbeatClosed = false;
    async function closeHeartbeat() {
      const current = await heartbeat.stop();
      heartbeatClosed = true;
      return current;
    }

    try {
      let keySummary;
      try {
        keySummary = normalizeKeyInventoryReport(await keyInventory.verify());
      } catch {
        return finalizeFailure(
          await closeHeartbeat(),
          "FAILED_PRECONDITION",
          Object.freeze({ code: "KEY_INVENTORY_VERIFICATION_FAILED" }),
          1,
          "BLOCKER"
        );
      }
      if (!keySummary.ready) {
        return finalizeFailure(
          await closeHeartbeat(),
          "FAILED_PRECONDITION",
          Object.freeze({ code: keySummary.status, keyInventory: keySummary }),
          Math.max(1, keySummary.issueCount),
          "BLOCKER"
        );
      }
      heartbeat.assertHealthy();

      let runtimeResult;
      try {
        runtimeResult = await runtime.runOneShot({
          bridgeLimit: schedule.bridgeLimit,
          workerLimit: schedule.workerLimit,
          recoveryLimit: schedule.recoveryLimit,
        });
      } catch (error) {
        const summary = safeFailureSummary(error);
        const currentLease = await closeHeartbeat();
        if (summary.code === "V1_RUNTIME_ORCHESTRATOR_BUSY") {
          return finalizeFailure(currentLease, "SKIPPED_BUSY", summary, 0, "WARNING");
        }
        const blockerCount = Math.max(
          1,
          summary.blockerCodes.length
            + summary.cycleDeadLetterCount
            + summary.newWorkerTerminalCount
        );
        if (PRECONDITION_CODES.has(summary.code)) {
          return finalizeFailure(
            currentLease,
            "FAILED_PRECONDITION",
            summary,
            blockerCount,
            "BLOCKER"
          );
        }
        return finalizeFailure(currentLease, "REVIEW_REQUIRED", summary, blockerCount, "BLOCKER");
      }

      const resultDigest = digest("myroot:v1-runtime-control-success:v1", runtimeResult);
      const currentLease = await closeHeartbeat();
      const terminal = normalizeTerminal(await ledger.finalizeCycle({
        cycleId: currentLease.cycleId,
        leaseOwner: currentLease.leaseOwner,
        leaseGeneration: currentLease.leaseGeneration,
        status: "SUCCEEDED",
        resultDigest,
        blockerCount: 0,
        errorCode: null,
      }), controlScopeId);
      return publicCycle(terminal, false);
    } finally {
      if (!heartbeatClosed) { try { await heartbeat.stop(); } catch {} }
    }
  }

  return Object.freeze({ inspect, previewScheduledCycle, runScheduledCycle });
}

function createV1RuntimeControlPlane(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !PRODUCTION_OPTION_KEYS.includes(key))
  ) {
    throw configurationError();
  }
  const env = options.env === undefined
    ? Object.freeze({ ...process.env })
    : Object.freeze({ ...options.env });
  let adapters;
  try {
    const ledgerEnv = Object.freeze({
      ...env,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: env[ENABLE_FLAG] === "true"
        ? runtimeControlScopeId(env)
        : env.MYROOT_V1_RUNTIME_ENVIRONMENT_ID,
    });
    const deliveryMode = runtimeAlertDeliveryMode(ledgerEnv);
    const poolLike = (pool) => Boolean(pool && typeof pool.getConnection === "function");
    const disabledPoolShape = deliveryMode === "DISABLED"
      && poolLike(options.pool)
      && (!options.heartbeatPool || poolLike(options.heartbeatPool))
      && !options.orchestrationPool
      && !options.registrarPool
      && !options.registrarHeartbeatPool
      && !options.runtimeAlertWorkerPool
      && !options.runtimeAlertInspectorPool;
    const authorityPoolShape = deliveryMode !== "DISABLED"
      && !options.pool
      && !options.heartbeatPool
      && poolLike(options.orchestrationPool)
      && poolLike(options.registrarPool)
      && poolLike(options.registrarHeartbeatPool)
      && poolLike(options.runtimeAlertInspectorPool)
      && (deliveryMode !== "CONTROLLED" || poolLike(options.runtimeAlertWorkerPool));
    if (!disabledPoolShape && !authorityPoolShape) throw configurationError();
    const orchestrationPool = deliveryMode === "DISABLED"
      ? options.pool : options.orchestrationPool;
    const registrarPool = deliveryMode === "DISABLED"
      ? options.pool : options.registrarPool;
    const registrarHeartbeatPool = deliveryMode === "DISABLED"
      ? options.heartbeatPool : options.registrarHeartbeatPool;
    const runtimeAlertDeliveryOptions = deliveryMode === "DISABLED"
      ? { env: ledgerEnv }
      : deliveryMode === "DRY_RUN"
        ? {
          env: ledgerEnv,
          registrarCurrentUser: options.runtimeAlertRegistrarCurrentUser,
          inspectorCurrentUser: options.runtimeAlertInspectorCurrentUser,
          inspectorPool: options.runtimeAlertInspectorPool,
        }
        : {
          env: ledgerEnv,
          registrarCurrentUser: options.runtimeAlertRegistrarCurrentUser,
          workerCurrentUser: options.runtimeAlertWorkerCurrentUser,
          inspectorCurrentUser: options.runtimeAlertInspectorCurrentUser,
          workerPool: options.runtimeAlertWorkerPool,
          inspectorPool: options.runtimeAlertInspectorPool,
        };
    const runtimeAlertDelivery = createMysqlV1RuntimeAlertDeliveryAuthorityAdapter(
      runtimeAlertDeliveryOptions
    );
    const rolePools = deliveryMode === "CONTROLLED"
      ? [
        orchestrationPool,
        registrarPool,
        registrarHeartbeatPool,
        options.runtimeAlertWorkerPool,
        options.runtimeAlertInspectorPool,
      ]
      : deliveryMode === "DRY_RUN"
        ? [
          orchestrationPool,
          registrarPool,
          registrarHeartbeatPool,
          options.runtimeAlertInspectorPool,
        ]
        : [];
    if (new Set(rolePools).size !== rolePools.length) throw configurationError();
    adapters = {
      keyInventory: createKeyInventoryReadinessFoundation({
        env,
        mysqlPool: orchestrationPool,
      }),
      ledger: createMysqlV1RuntimeControlLedger({
        pool: registrarPool,
        ...(registrarHeartbeatPool ? { heartbeatPool: registrarHeartbeatPool } : {}),
        inspectorPool: deliveryMode === "DISABLED"
          ? options.pool : options.runtimeAlertInspectorPool,
        ...(deliveryMode === "DISABLED" ? {} : {
          registrarCurrentUser: options.runtimeAlertRegistrarCurrentUser,
          inspectorCurrentUser: options.runtimeAlertInspectorCurrentUser,
        }),
        env: ledgerEnv,
        runtimeAlertDelivery,
      }),
      runtime: createV1RuntimeOrchestrationFoundation({ pool: orchestrationPool, env }),
    };
  } catch {
    throw configurationError();
  }
  return createV1RuntimeControlPlaneCore({
    env,
    adapters,
    instanceId: crypto.randomUUID().replace(/-/g, ""),
  });
}

module.exports = {
  createV1RuntimeControlPlane,
};
