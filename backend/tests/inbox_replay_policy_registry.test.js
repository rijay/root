const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computeInboxReplayPolicyDigest,
  computeInboxReplayPolicyRegistryDigest,
  computeInboxReplaySelectionQueryDigest,
  createInboxReplayPolicyRegistry,
  getDefaultInboxReplayPolicyRegistry,
} = require("../src/inboxReplayPolicyRegistry");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "inbox-replay-policy-registry",
  "v1.0.0.json"
);
const DIGEST = "a".repeat(64);

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function authorization(policyId = "TASK_SHARE_VERIFY_V1", overrides = {}) {
  return {
    policyId,
    replayRunId: "replay-run-20260716-001",
    requestedByActorId: "root-operator-requester",
    authorizedByActorId: "root-operator-authorizer",
    reasonCode: policyId === "TASK_SHARE_VERIFY_V1"
      ? "INCIDENT_VERIFICATION"
      : "HANDLER_UPGRADE_VALIDATION",
    authorizationTicketDigest: DIGEST,
    requestedAt: "2026-07-16T10:00:00.000Z",
    authorizedAt: "2026-07-16T10:01:00.000Z",
    authorizationExpiresAt: "2026-07-16T11:01:00.000Z",
    ...overrides,
  };
}

function selection(authorizedPolicy, overrides = {}) {
  return {
    authorizedPolicy,
    selectionSnapshotAt: "2026-07-16T10:02:00.000Z",
    lowerCursor: null,
    upperCursor: {
      receivedAt: "2026-07-16T09:59:59.999Z",
      receiptId: "inbox-replay-source-001",
    },
    selectedCount: 1,
    selectionDigest: "b".repeat(64),
    selectionQueryDigest: authorizedPolicy.selectionQueryDigest,
    ...overrides,
  };
}

test("production Replay Policy Registry is deterministic and exposes only its frozen Interface", () => {
  const source = manifest();
  const registry = getDefaultInboxReplayPolicyRegistry();
  assert.deepEqual(Object.keys(registry), [
    "assertReady",
    "authorize",
    "describe",
    "resolveExecution",
    "sealSelection",
  ]);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry.assertReady(), true);
  const description = registry.describe();
  assert.equal(Object.isFrozen(description), true);
  assert.equal(description.scope, "PRODUCTION");
  assert.equal(description.registryVersion, 1);
  assert.equal(description.registryDigest, computeInboxReplayPolicyRegistryDigest(source));
  assert.equal(description.policyCount, 2);
  assert.deepEqual(description.policies.map((policy) => policy.policyId), [
    "TASK_SHARE_SHADOW_REBUILD_V1",
    "TASK_SHARE_VERIFY_V1",
  ]);
  for (const [index, policy] of source.policies.entries()) {
    assert.equal(
      description.policies[index].policyDigest,
      computeInboxReplayPolicyDigest(policy)
    );
    assert.equal(
      policy.selectionQueryDigest,
      computeInboxReplaySelectionQueryDigest(policy)
    );
    assert.equal(description.policies[index].selectionQueryId, policy.selectionQueryId);
    assert.equal(
      description.policies[index].executionConsumerPrefix,
      policy.execution.consumerPrefix
    );
  }
});

test("authorization freezes two named actors, TTL, reason and derived execution consumer", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  const authorized = registry.authorize(authorization());
  assert.equal(Object.isFrozen(authorized), true);
  assert.equal(Object.isFrozen(authorized.sourceScope), true);
  assert.equal(authorized.mode, "VERIFY_ONLY");
  assert.equal(authorized.requestedByActorId, "root-operator-requester");
  assert.equal(authorized.authorizedByActorId, "root-operator-authorizer");
  assert.match(authorized.executionConsumerName, /^task-share-verify-v1:[a-f0-9]{32}$/);
  assert.deepEqual(authorized.requiredCapabilities, [
    "inbox.replay.authorize",
    "inbox.replay.execute",
  ]);
  assert.equal(authorized.sourceScope.receiptStatus, "SUCCEEDED");
  assert.match(authorized.sourceScope.handlerRegistrationDigest, /^[a-f0-9]{64}$/);
  assert.equal(authorized.execution.allowsApplyWrite, false);
  assert.equal(authorized.execution.allowsOutbox, false);
  assert.equal(authorized.execution.allowsNetwork, false);
  assert.equal(
    registry.authorize(authorization()).executionConsumerName,
    authorized.executionConsumerName
  );
});

test("authorization rejects self-approval, excess TTL, unknown reason and caller-selected execution facts", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  const invalid = [
    authorization("TASK_SHARE_VERIFY_V1", {
      authorizedByActorId: "root-operator-requester",
    }),
    authorization("TASK_SHARE_VERIFY_V1", {
      authorizationExpiresAt: "2026-07-16T11:01:00.001Z",
    }),
    authorization("TASK_SHARE_VERIFY_V1", { reasonCode: "UNREGISTERED_REASON" }),
    authorization("TASK_SHARE_VERIFY_V1", { requestedByActorId: "root requester" }),
    authorization("TASK_SHARE_VERIFY_V1", { authorizedByActorId: "root\nauthorizer" }),
    authorization("TASK_SHARE_UNKNOWN_V1"),
    { ...authorization(), mode: "SHADOW_REBUILD" },
    { ...authorization(), sourceScope: {} },
    { ...authorization(), handlerId: "caller-handler" },
    { ...authorization(), executionConsumerName: "caller-consumer" },
    { ...authorization(), sql: "SELECT 1" },
  ];
  for (const input of invalid) {
    assert.throws(
      () => registry.authorize(input),
      (error) => error && error.code === "INBOX_REPLAY_AUTHORIZATION_INVALID"
    );
  }
});

test("selection sealing freezes the independent cursor and execution stays no-outbox/no-network", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  const authorized = registry.authorize(authorization());
  const sealed = registry.sealSelection(selection(authorized));
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.upperCursor), true);
  const execution = registry.resolveExecution({ sealedSelection: sealed });
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(execution.mode, "VERIFY_ONLY");
  assert.equal(execution.handlerId, "task-share-completion-verify-v1");
  assert.equal(execution.targetProjectionPolicy, "PRODUCTION_GENERATION_1_READ_ONLY");
  assert.equal(execution.allowsApplyWrite, false);
  assert.equal(execution.allowsOutbox, false);
  assert.equal(execution.allowsNetwork, false);
  assert.equal(execution.executorRegistryVersion, null);
  assert.equal(execution.executorRegistryDigest, null);
  assert.equal(execution.executorDescriptorDigest, null);
  assert.equal(execution.executorSourceDigest, null);
  assert.equal(execution.executorRegistrationDigest, null);
  assert.equal(execution.selection.cursorType, "FIRST_RECEIVED_AT_RECEIPT_ID_V1");
  assert.equal(execution.selection.selectedCount, 1);
  assert.deepEqual(Object.keys(execution).sort(), [
    "allowsApplyWrite",
    "allowsNetwork",
    "allowsOutbox",
    "executionConsumerName",
    "executorDescriptorDigest",
    "executorRegistrationDigest",
    "executorRegistryDigest",
    "executorRegistryVersion",
    "executorSourceDigest",
    "handlerId",
    "handlerVersion",
    "mode",
    "policyDigest",
    "policyId",
    "policyVersion",
    "replayRunId",
    "requiredCapability",
    "selection",
    "sourceScope",
    "targetProjectionPolicy",
  ].sort());
});

test("shadow rebuild is isolated from generation one and never gains Outbox or network capability", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  const authorized = registry.authorize(authorization("TASK_SHARE_SHADOW_REBUILD_V1"));
  const sealed = registry.sealSelection(selection(authorized));
  const execution = registry.resolveExecution({ sealedSelection: sealed });
  assert.equal(execution.mode, "SHADOW_REBUILD");
  assert.equal(execution.handlerId, "task-share-completion-shadow-v1");
  assert.equal(execution.targetProjectionPolicy, "SHADOW_GENERATION_GE_2");
  assert.equal(execution.allowsApplyWrite, true);
  assert.equal(execution.allowsOutbox, false);
  assert.equal(execution.allowsNetwork, false);
  assert.equal(execution.executorRegistryVersion, 1);
  assert.match(execution.executorRegistryDigest, /^[a-f0-9]{64}$/);
  assert.match(execution.executorDescriptorDigest, /^[a-f0-9]{64}$/);
  assert.match(execution.executorSourceDigest, /^[a-f0-9]{64}$/);
  assert.match(execution.executorRegistrationDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(execution.executionConsumerName, registry.resolveExecution({
    sealedSelection: registry.sealSelection(selection(
      registry.authorize(authorization("TASK_SHARE_VERIFY_V1"))
    )),
  }).executionConsumerName);
});

test("selection rejects expired authorization, unstable cursors, mismatched query and oversized sets", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  const authorized = registry.authorize(authorization());
  const invalid = [
    selection(authorized, { selectionSnapshotAt: authorized.authorizationExpiresAt }),
    selection(authorized, { selectionQueryDigest: "c".repeat(64) }),
    selection(authorized, { selectedCount: 10_001 }),
    selection(authorized, { selectedCount: 0 }),
    selection(authorized, { selectedCount: 1, upperCursor: null }),
    selection(authorized, {
      lowerCursor: {
        receivedAt: "2026-07-16T09:59:59.999Z",
        receiptId: "inbox-replay-source-002",
      },
      upperCursor: {
        receivedAt: "2026-07-16T09:59:59.999Z",
        receiptId: "inbox-replay-source-001",
      },
    }),
    selection(authorized, {
      upperCursor: {
        receivedAt: "2026-07-16 09:59:59.999",
        receiptId: "inbox-replay-source-001",
      },
    }),
  ];
  for (const input of invalid) {
    assert.throws(
      () => registry.sealSelection(input),
      (error) => error && error.code === "INBOX_REPLAY_SELECTION_INVALID"
    );
  }
});

test("plain objects cannot cross the sealed execution Interface", () => {
  const registry = getDefaultInboxReplayPolicyRegistry();
  assert.throws(
    () => registry.sealSelection(selection({
      ...registry.authorize(authorization()),
    })),
    (error) => error && error.code === "INBOX_REPLAY_SELECTION_INVALID"
  );
  const sealed = registry.sealSelection(selection(registry.authorize(authorization())));
  assert.throws(
    () => registry.resolveExecution({ sealedSelection: { ...sealed } }),
    (error) => error && error.code === "INBOX_REPLAY_EXECUTION_INVALID"
  );
});

test("manifest drift fails closed for source registration, query semantics and execution capability", () => {
  const mutations = [
    ["INBOX_REPLAY_SOURCE_REGISTRATION_DRIFT", (source) => {
      source.policies[0].sourceScope.handlerRegistrationDigest = "f".repeat(64);
    }],
    ["INBOX_REPLAY_SELECTION_QUERY_DRIFT", (source) => {
      source.policies[0].selectionQueryDigest = "f".repeat(64);
    }],
    ["INBOX_REPLAY_POLICY_INVALID", (source) => {
      source.policies[1].execution.allowsApplyWrite = true;
    }],
    ["INBOX_REPLAY_POLICY_INVALID", (source) => {
      source.policies[0].execution.executorRegistrationDigest = "f".repeat(64);
    }],
    ["INBOX_REPLAY_POLICY_INVALID", (source) => {
      source.policies[0].requiredCapabilities = ["inbox.replay.authorize"];
    }],
    ["INBOX_REPLAY_POLICY_INVALID", (source) => {
      source.policies.reverse();
    }],
  ];
  for (const [code, mutate] of mutations) {
    const source = manifest();
    mutate(source);
    assert.throws(
      () => createInboxReplayPolicyRegistry({ manifest: source }),
      (error) => error && error.code === code,
      code
    );
  }
});

test("policy authorization TTL can never exceed one hour even when the manifest asks for more", () => {
  const source = manifest();
  source.policies[0].maximumAuthorizationTtlSeconds = 3_601;
  assert.throws(
    () => createInboxReplayPolicyRegistry({ manifest: source }),
    (error) => error && error.code === "INBOX_REPLAY_POLICY_INVALID"
  );
});
