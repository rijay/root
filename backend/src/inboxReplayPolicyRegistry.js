const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { getDefaultInboxHandlerRegistry } = require("./inboxHandlerRegistry");
const { getDefaultInboxReplayExecutorRegistry } = require("./inboxReplayExecutorRegistry");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "inbox-replay-policy-registry",
  "v1.0.0.json"
);
const REGISTRY_DIGEST_DOMAIN = "myroot-inbox-replay-policy-registry:v1";
const POLICY_DIGEST_DOMAIN = "myroot-inbox-replay-policy:v1";
const SELECTION_QUERY_DIGEST_DOMAIN = "myroot-inbox-replay-selection-query:v1";
const EXECUTION_CONSUMER_DIGEST_DOMAIN = "myroot-inbox-replay-execution-consumer:v1";
const AUTHORIZED_BRAND = Symbol("myroot.authorizedInboxReplayPolicy");
const SEALED_BRAND = Symbol("myroot.sealedInboxReplaySelection");
const POLICY_MODES = Object.freeze(["VERIFY_ONLY", "SHADOW_REBUILD"]);
const TARGET_POLICIES = Object.freeze([
  "PRODUCTION_GENERATION_1_READ_ONLY",
  "SHADOW_GENERATION_GE_2",
]);
const SOURCE_STATUS = "SUCCEEDED";
const CURSOR_TYPE = "FIRST_RECEIVED_AT_RECEIPT_ID_V1";
const MAXIMUM_AUTHORIZATION_TTL_SECONDS = 3_600;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORIZATION_KEYS = Object.freeze([
  "policyId",
  "replayRunId",
  "requestedByActorId",
  "authorizedByActorId",
  "reasonCode",
  "authorizationTicketDigest",
  "requestedAt",
  "authorizedAt",
  "authorizationExpiresAt",
]);
const SELECTION_KEYS = Object.freeze([
  "authorizedPolicy",
  "selectionSnapshotAt",
  "lowerCursor",
  "upperCursor",
  "selectedCount",
  "selectionDigest",
  "selectionQueryDigest",
]);

function replayPolicyError(code = "INBOX_REPLAY_POLICY_INVALID") {
  const error = new Error("Inbox replay policy is invalid");
  error.code = code;
  return error;
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

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function principalId(value) {
  return exactText(value, 128)
    && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
}

function sortedUnique(values) {
  return Array.isArray(values)
    && values.length === new Set(values).size
    && values.every((value, index) => (
      opaqueAscii(value, 128) && (index === 0 || values[index - 1] < value)
    ));
}

function byteEqual(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { throw replayPolicyError(); }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function timestamp(value) {
  if (!RFC3339_MILLIS_PATTERN.test(value)) throw replayPolicyError("INBOX_REPLAY_AUTHORIZATION_INVALID");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw replayPolicyError("INBOX_REPLAY_AUTHORIZATION_INVALID");
  }
  return milliseconds;
}

function selectionTimestamp(value) {
  try { return timestamp(value); } catch { throw replayPolicyError("INBOX_REPLAY_SELECTION_INVALID"); }
}

function computeInboxReplaySelectionQueryDigest(policy) {
  if (!plainRecord(policy)) throw replayPolicyError();
  return digest(SELECTION_QUERY_DIGEST_DOMAIN, {
    cursorType: policy.selectionCursorType,
    queryId: policy.selectionQueryId,
    sourceScope: policy.sourceScope,
    ordering: ["first_received_at", "inbox_receipt_id"],
    lowerBound: "EXCLUSIVE",
    upperBound: "INCLUSIVE",
  });
}

function computeInboxReplayPolicyDigest(policy) {
  if (!plainRecord(policy)) throw replayPolicyError();
  return digest(POLICY_DIGEST_DOMAIN, policy);
}

function computeInboxReplayPolicyRegistryDigest(manifest) {
  if (!plainRecord(manifest)) throw replayPolicyError();
  return digest(REGISTRY_DIGEST_DOMAIN, manifest);
}

const SOURCE_SCOPE_KEYS = Object.freeze([
  "consumerName",
  "sourceName",
  "eventType",
  "schemaVersion",
  "aggregateType",
  "receiptStatus",
  "handlerId",
  "handlerVersion",
  "handlerRegistryVersion",
  "handlerDescriptorDigest",
  "handlerSourceDigest",
  "handlerRegistrationDigest",
]);

function validateSourceScope(scope) {
  if (!exactKeys(scope, SOURCE_SCOPE_KEYS)
    || !exactText(scope.consumerName, 128)
    || !exactText(scope.sourceName, 96)
    || !exactText(scope.eventType, 128)
    || !opaqueAscii(scope.schemaVersion, 32)
    || !exactText(scope.aggregateType, 96)
    || scope.receiptStatus !== SOURCE_STATUS
    || !opaqueAscii(scope.handlerId, 96)
    || !opaqueAscii(scope.handlerVersion, 64)
    || !Number.isSafeInteger(scope.handlerRegistryVersion)
    || scope.handlerRegistryVersion < 1
    || !SHA256_PATTERN.test(scope.handlerDescriptorDigest)
    || !SHA256_PATTERN.test(scope.handlerSourceDigest)
    || !SHA256_PATTERN.test(scope.handlerRegistrationDigest)) throw replayPolicyError();
  return deepFreeze(clone(scope));
}

const EXECUTION_KEYS = Object.freeze([
  "consumerPrefix",
  "handlerId",
  "handlerVersion",
  "targetProjectionPolicy",
  "allowsApplyWrite",
  "allowsOutbox",
  "allowsNetwork",
  "executorRegistryVersion",
  "executorRegistryDigest",
  "executorDescriptorDigest",
  "executorSourceDigest",
  "executorRegistrationDigest",
]);

function validateExecution(execution, mode, executorRegistration) {
  if (!exactKeys(execution, EXECUTION_KEYS)
    || !opaqueAscii(execution.consumerPrefix, 64)
    || !opaqueAscii(execution.handlerId, 96)
    || !opaqueAscii(execution.handlerVersion, 64)
    || !TARGET_POLICIES.includes(execution.targetProjectionPolicy)
    || typeof execution.allowsApplyWrite !== "boolean"
    || execution.allowsOutbox !== false
    || execution.allowsNetwork !== false
    || (mode === "VERIFY_ONLY" && (
      execution.targetProjectionPolicy !== "PRODUCTION_GENERATION_1_READ_ONLY"
      || execution.allowsApplyWrite !== false
      || execution.executorRegistryVersion !== null
      || execution.executorRegistryDigest !== null
      || execution.executorDescriptorDigest !== null
      || execution.executorSourceDigest !== null
      || execution.executorRegistrationDigest !== null
    ))
    || (mode === "SHADOW_REBUILD" && (
      execution.targetProjectionPolicy !== "SHADOW_GENERATION_GE_2"
      || execution.allowsApplyWrite !== true
      || !executorRegistration
      || execution.executorRegistryVersion !== executorRegistration.registryVersion
      || !byteEqual(execution.executorRegistryDigest, executorRegistration.registryDigest)
      || !byteEqual(
        execution.executorDescriptorDigest,
        executorRegistration.descriptor.descriptorDigest
      )
      || !byteEqual(execution.executorSourceDigest, executorRegistration.descriptor.sourceDigest)
      || !byteEqual(
        execution.executorRegistrationDigest,
        executorRegistration.registrationDigest
      )
    ))) throw replayPolicyError();
  return deepFreeze(clone(execution));
}

const POLICY_KEYS = Object.freeze([
  "policyId",
  "policyVersion",
  "mode",
  "reasonCodes",
  "maximumAuthorizationTtlSeconds",
  "maximumSelectedCount",
  "selectionCursorType",
  "selectionQueryId",
  "selectionQueryDigest",
  "requiredCapabilities",
  "sourceScope",
  "execution",
]);

function validatePolicy(input, sourceRegistration, executorRegistration) {
  if (!exactKeys(input, POLICY_KEYS)
    || !opaqueAscii(input.policyId, 96)
    || !Number.isSafeInteger(input.policyVersion)
    || input.policyVersion < 1
    || !POLICY_MODES.includes(input.mode)
    || !sortedUnique(input.reasonCodes)
    || input.reasonCodes.length === 0
    || !Number.isSafeInteger(input.maximumAuthorizationTtlSeconds)
    || input.maximumAuthorizationTtlSeconds < 60
    || input.maximumAuthorizationTtlSeconds > MAXIMUM_AUTHORIZATION_TTL_SECONDS
    || !Number.isSafeInteger(input.maximumSelectedCount)
    || input.maximumSelectedCount < 1
    || input.maximumSelectedCount > 100_000
    || input.selectionCursorType !== CURSOR_TYPE
    || !opaqueAscii(input.selectionQueryId, 128)
    || !SHA256_PATTERN.test(input.selectionQueryDigest)
    || !sortedUnique(input.requiredCapabilities)
    || input.requiredCapabilities.join("\0") !== [
      "inbox.replay.authorize",
      "inbox.replay.execute",
    ].join("\0")) throw replayPolicyError();
  const sourceScope = validateSourceScope(input.sourceScope);
  const execution = validateExecution(input.execution, input.mode, executorRegistration);
  const descriptor = sourceRegistration.descriptor;
  if (!byteEqual(sourceScope.consumerName, descriptor.consumerName)
    || !byteEqual(sourceScope.sourceName, descriptor.sourceName)
    || !byteEqual(sourceScope.eventType, descriptor.eventType)
    || !byteEqual(sourceScope.schemaVersion, descriptor.schemaVersion)
    || !byteEqual(sourceScope.aggregateType, descriptor.aggregateType)
    || !byteEqual(sourceScope.handlerId, descriptor.handlerId)
    || !byteEqual(sourceScope.handlerVersion, descriptor.handlerVersion)
    || sourceScope.handlerRegistryVersion !== sourceRegistration.registryVersion
    || !byteEqual(sourceScope.handlerDescriptorDigest, descriptor.descriptorDigest)
    || !byteEqual(sourceScope.handlerSourceDigest, descriptor.sourceDigest)
    || !byteEqual(sourceScope.handlerRegistrationDigest, sourceRegistration.registrationDigest)) {
    throw replayPolicyError("INBOX_REPLAY_SOURCE_REGISTRATION_DRIFT");
  }
  const policy = deepFreeze({
    ...clone(input),
    sourceScope,
    execution,
  });
  if (computeInboxReplaySelectionQueryDigest(policy) !== policy.selectionQueryDigest) {
    throw replayPolicyError("INBOX_REPLAY_SELECTION_QUERY_DRIFT");
  }
  return policy;
}

function deriveExecutionConsumerName(policy, replayRunId) {
  const suffix = crypto.createHash("sha256")
    .update(`${EXECUTION_CONSUMER_DIGEST_DOMAIN}\0`, "utf8")
    .update(replayRunId, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${policy.execution.consumerPrefix}:${suffix}`;
}

function normalizeCursor(value) {
  if (value === null) return null;
  if (!exactKeys(value, ["receivedAt", "receiptId"])
    || !opaqueAscii(value.receiptId, 64)) throw replayPolicyError("INBOX_REPLAY_SELECTION_INVALID");
  selectionTimestamp(value.receivedAt);
  return deepFreeze(clone(value));
}

function compareCursor(left, right) {
  const timeDelta = selectionTimestamp(left.receivedAt) - selectionTimestamp(right.receivedAt);
  if (timeDelta !== 0) return timeDelta < 0 ? -1 : 1;
  return Buffer.compare(Buffer.from(left.receiptId, "utf8"), Buffer.from(right.receiptId, "utf8"));
}

function createInboxReplayPolicyRegistry(options = {}) {
  if (!plainRecord(options) || Object.keys(options).some((key) => key !== "manifest")) {
    throw replayPolicyError();
  }
  let manifest;
  try {
    manifest = options.manifest === undefined
      ? JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"))
      : clone(options.manifest);
  } catch {
    throw replayPolicyError("INBOX_REPLAY_POLICY_MANIFEST_UNAVAILABLE");
  }
  if (!exactKeys(manifest, ["registryVersion", "scope", "policies"])
    || manifest.registryVersion !== 1
    || manifest.scope !== "PRODUCTION"
    || !Array.isArray(manifest.policies)
    || manifest.policies.length !== 2
    || manifest.policies.some((policy, index, policies) => (
      index > 0 && policies[index - 1].policyId >= policy.policyId
    ))) throw replayPolicyError();

  let sourceRegistration;
  try {
    sourceRegistration = getDefaultInboxHandlerRegistry().assertScope({
      consumerName: "task-share-completion-projection",
      handlerVersion: "task-share-completion-v1",
      sourceName: "myroot-api",
      eventType: "task.event.recorded.v1",
      schemaVersion: "1",
      aggregateType: "TASK_EVENT",
    });
  } catch {
    throw replayPolicyError("INBOX_REPLAY_SOURCE_REGISTRATION_UNAVAILABLE");
  }
  let executorRegistration;
  try {
    executorRegistration = getDefaultInboxReplayExecutorRegistry().resolve({
      executorId: "task-share-completion-shadow-v1",
      executorVersion: "task-share-shadow-v1",
      policyId: "TASK_SHARE_SHADOW_REBUILD_V1",
      mode: "SHADOW_REBUILD",
    });
    if (!executorRegistration) throw new Error("executor unavailable");
  } catch {
    throw replayPolicyError("INBOX_REPLAY_EXECUTOR_REGISTRATION_UNAVAILABLE");
  }
  const policies = manifest.policies.map((policy) => validatePolicy(
    policy,
    sourceRegistration,
    policy.mode === "SHADOW_REBUILD" ? executorRegistration : null
  ));
  const policyById = new Map(policies.map((policy) => [policy.policyId, policy]));
  if (policyById.size !== policies.length
    || !policyById.has("TASK_SHARE_VERIFY_V1")
    || !policyById.has("TASK_SHARE_SHADOW_REBUILD_V1")) throw replayPolicyError();
  const registryDigest = computeInboxReplayPolicyRegistryDigest(manifest);

  function authorize(input) {
    if (!exactKeys(input, AUTHORIZATION_KEYS)
      || !opaqueAscii(input.policyId, 96)
      || !opaqueAscii(input.replayRunId, 64)
      || !principalId(input.requestedByActorId)
      || !principalId(input.authorizedByActorId)
      || byteEqual(input.requestedByActorId, input.authorizedByActorId)
      || !opaqueAscii(input.reasonCode, 64)
      || !SHA256_PATTERN.test(input.authorizationTicketDigest)) {
      throw replayPolicyError("INBOX_REPLAY_AUTHORIZATION_INVALID");
    }
    const policy = policyById.get(input.policyId);
    if (!policy || !policy.reasonCodes.includes(input.reasonCode)) {
      throw replayPolicyError("INBOX_REPLAY_AUTHORIZATION_INVALID");
    }
    const requestedAt = timestamp(input.requestedAt);
    const authorizedAt = timestamp(input.authorizedAt);
    const expiresAt = timestamp(input.authorizationExpiresAt);
    if (authorizedAt < requestedAt
      || expiresAt <= authorizedAt
      || expiresAt - authorizedAt > policy.maximumAuthorizationTtlSeconds * 1_000) {
      throw replayPolicyError("INBOX_REPLAY_AUTHORIZATION_INVALID");
    }
    const authorized = {
      replayRunId: input.replayRunId,
      registryVersion: manifest.registryVersion,
      registryDigest,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyDigest: computeInboxReplayPolicyDigest(policy),
      mode: policy.mode,
      reasonCode: input.reasonCode,
      authorizationTicketDigest: input.authorizationTicketDigest,
      requestedByActorId: input.requestedByActorId,
      authorizedByActorId: input.authorizedByActorId,
      requestedAt: input.requestedAt,
      authorizedAt: input.authorizedAt,
      authorizationExpiresAt: input.authorizationExpiresAt,
      executionConsumerName: deriveExecutionConsumerName(policy, input.replayRunId),
      requiredCapabilities: policy.requiredCapabilities,
      sourceScope: policy.sourceScope,
      selectionCursorType: policy.selectionCursorType,
      selectionQueryId: policy.selectionQueryId,
      selectionQueryDigest: policy.selectionQueryDigest,
      maximumSelectedCount: policy.maximumSelectedCount,
      execution: policy.execution,
    };
    Object.defineProperty(authorized, AUTHORIZED_BRAND, { value: true });
    return deepFreeze(authorized);
  }

  function sealSelection(input) {
    if (!exactKeys(input, SELECTION_KEYS)
      || !plainRecord(input.authorizedPolicy)
      || input.authorizedPolicy[AUTHORIZED_BRAND] !== true
      || !Number.isSafeInteger(input.selectedCount)
    || input.selectedCount < 1
      || input.selectedCount > input.authorizedPolicy.maximumSelectedCount
      || !SHA256_PATTERN.test(input.selectionDigest)
      || !SHA256_PATTERN.test(input.selectionQueryDigest)
      || !byteEqual(input.selectionQueryDigest, input.authorizedPolicy.selectionQueryDigest)) {
      throw replayPolicyError("INBOX_REPLAY_SELECTION_INVALID");
    }
    const snapshotAt = selectionTimestamp(input.selectionSnapshotAt);
    if (snapshotAt < timestamp(input.authorizedPolicy.authorizedAt)
      || snapshotAt >= timestamp(input.authorizedPolicy.authorizationExpiresAt)) {
      throw replayPolicyError("INBOX_REPLAY_SELECTION_INVALID");
    }
    const lowerCursor = normalizeCursor(input.lowerCursor);
    const upperCursor = normalizeCursor(input.upperCursor);
    if (upperCursor === null
      || (lowerCursor && upperCursor && compareCursor(lowerCursor, upperCursor) >= 0)) {
      throw replayPolicyError("INBOX_REPLAY_SELECTION_INVALID");
    }
    const sealed = {
      ...input.authorizedPolicy,
      selectionSnapshotAt: input.selectionSnapshotAt,
      lowerCursor,
      upperCursor,
      selectedCount: input.selectedCount,
      selectionDigest: input.selectionDigest,
    };
    Object.defineProperty(sealed, SEALED_BRAND, { value: true });
    return deepFreeze(sealed);
  }

  function resolveExecution(input) {
    if (!exactKeys(input, ["sealedSelection"])
      || !plainRecord(input.sealedSelection)
      || input.sealedSelection[SEALED_BRAND] !== true) {
      throw replayPolicyError("INBOX_REPLAY_EXECUTION_INVALID");
    }
    return deepFreeze({
      replayRunId: input.sealedSelection.replayRunId,
      policyId: input.sealedSelection.policyId,
      policyVersion: input.sealedSelection.policyVersion,
      policyDigest: input.sealedSelection.policyDigest,
      mode: input.sealedSelection.mode,
      executionConsumerName: input.sealedSelection.executionConsumerName,
      sourceScope: input.sealedSelection.sourceScope,
      selection: {
        cursorType: input.sealedSelection.selectionCursorType,
        queryId: input.sealedSelection.selectionQueryId,
        queryDigest: input.sealedSelection.selectionQueryDigest,
        snapshotAt: input.sealedSelection.selectionSnapshotAt,
        lowerCursor: input.sealedSelection.lowerCursor,
        upperCursor: input.sealedSelection.upperCursor,
        selectedCount: input.sealedSelection.selectedCount,
        selectionDigest: input.sealedSelection.selectionDigest,
      },
      handlerId: input.sealedSelection.execution.handlerId,
      handlerVersion: input.sealedSelection.execution.handlerVersion,
      executorRegistryVersion: input.sealedSelection.execution.executorRegistryVersion,
      executorRegistryDigest: input.sealedSelection.execution.executorRegistryDigest,
      executorDescriptorDigest: input.sealedSelection.execution.executorDescriptorDigest,
      executorSourceDigest: input.sealedSelection.execution.executorSourceDigest,
      executorRegistrationDigest: input.sealedSelection.execution.executorRegistrationDigest,
      targetProjectionPolicy: input.sealedSelection.execution.targetProjectionPolicy,
      allowsApplyWrite: input.sealedSelection.execution.allowsApplyWrite,
      allowsOutbox: false,
      allowsNetwork: false,
      requiredCapability: "inbox.replay.execute",
    });
  }

  return deepFreeze({
    assertReady() { return true; },
    authorize,
    describe() {
      return deepFreeze({
        ready: true,
        scope: manifest.scope,
        registryVersion: manifest.registryVersion,
        registryDigest,
        policyCount: policies.length,
        policies: policies.map((policy) => ({
          policyId: policy.policyId,
          policyVersion: policy.policyVersion,
          policyDigest: computeInboxReplayPolicyDigest(policy),
          mode: policy.mode,
          maximumSelectedCount: policy.maximumSelectedCount,
          selectionCursorType: policy.selectionCursorType,
          selectionQueryId: policy.selectionQueryId,
          selectionQueryDigest: policy.selectionQueryDigest,
          executionConsumerPrefix: policy.execution.consumerPrefix,
          handlerId: policy.execution.handlerId,
          handlerVersion: policy.execution.handlerVersion,
          executorRegistryVersion: policy.execution.executorRegistryVersion,
          executorRegistryDigest: policy.execution.executorRegistryDigest,
          executorDescriptorDigest: policy.execution.executorDescriptorDigest,
          executorSourceDigest: policy.execution.executorSourceDigest,
          executorRegistrationDigest: policy.execution.executorRegistrationDigest,
          targetProjectionPolicy: policy.execution.targetProjectionPolicy,
        })),
      });
    },
    resolveExecution,
    sealSelection,
  });
}

let defaultRegistry;
function getDefaultInboxReplayPolicyRegistry() {
  if (!defaultRegistry) defaultRegistry = createInboxReplayPolicyRegistry();
  return defaultRegistry;
}

module.exports = {
  computeInboxReplayPolicyDigest,
  computeInboxReplayPolicyRegistryDigest,
  computeInboxReplaySelectionQueryDigest,
  createInboxReplayPolicyRegistry,
  getDefaultInboxReplayPolicyRegistry,
};
