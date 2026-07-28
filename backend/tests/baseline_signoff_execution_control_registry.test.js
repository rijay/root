const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  computeBaselineSignoffExecutionControlDigest,
  createBaselineSignoffExecutionControlRegistry,
} = require("../src/baselineSignoffExecutionControlRegistry");

function ref(namespace, seed) {
  return `${namespace}:sha256:${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

function control() {
  return {
    executionFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    approvalSystemRef: ref("system", "approval-system"),
    workflowInstanceRef: ref("workflow", "workflow-1"),
    workflowOwnerSignerRef: ref("actor", "workflow-owner"),
    evidenceCustodianSignerRef: ref("actor", "evidence-custodian"),
    openedAt: "2026-07-20T01:00:00.000Z",
    dueAt: "2026-07-21T01:00:00.000Z",
    escalationPolicyRef: ref("policy", "escalation-policy"),
    revocationSourceRef: ref("source", "revocation-source"),
    sourceInputBindingDigest: "8f1147e6efd6dfb0a3d0a9f89143f355042248c09e4d4c4bcb4a91ca53778960",
  };
}

function registryFor({ status = "OPEN", observedAt, validUntil } = {}) {
  return createBaselineSignoffExecutionControlRegistry({
    workflowReceiptAdapter: {
      readWorkflowReceipt(input) {
        return {
          receiptFormatVersion: 1,
          approvalSystemRef: input.approvalSystemRef,
          workflowInstanceRef: input.workflowInstanceRef,
          executionControlDigest: input.executionControlDigest,
          status,
          observedAt: observedAt || "2026-07-20T01:30:00.000Z",
          validUntil: validUntil || "2026-07-20T03:00:00.000Z",
          evidenceRef: ref("evidence", "workflow-readback"),
        };
      },
    },
  });
}

test("execution control requires exact owner, custodian and dueAt fields", () => {
  const registry = registryFor();
  for (const field of ["workflowOwnerSignerRef", "evidenceCustodianSignerRef", "dueAt"]) {
    const input = control();
    delete input[field];
    assert.throws(
      () => registry.validate(input, { evaluatedAt: "2026-07-20T02:00:00.000Z" }),
      { code: "BASELINE_SIGNOFF_EXECUTION_CONTROL_INVALID" }
    );
  }

  const sameOwner = control();
  sameOwner.evidenceCustodianSignerRef = sameOwner.workflowOwnerSignerRef;
  assert.throws(
    () => registry.validate(sameOwner, { evaluatedAt: "2026-07-20T02:00:00.000Z" }),
    { code: "BASELINE_SIGNOFF_EXECUTION_CONTROL_INVALID" }
  );
});

test("workflow state comes from the receipt Adapter and cancelled workflows fail closed", () => {
  const input = control();
  input.workflowStatus = "OPEN";
  assert.throws(
    () => registryFor().validate(input, { evaluatedAt: "2026-07-20T02:00:00.000Z" }),
    { code: "BASELINE_SIGNOFF_EXECUTION_CONTROL_INVALID" },
    "caller supplied workflow status is not part of the trusted interface"
  );
  assert.throws(
    () => registryFor({ status: "CANCELLED" }).validate(control(), {
      evaluatedAt: "2026-07-20T02:00:00.000Z",
    }),
    { code: "BASELINE_SIGNOFF_WORKFLOW_NOT_OPEN" }
  );
});

test("expired control or stale workflow readback fails closed", () => {
  assert.throws(
    () => registryFor().validate(control(), { evaluatedAt: "2026-07-22T02:00:00.000Z" }),
    { code: "BASELINE_SIGNOFF_WORKFLOW_EXPIRED" }
  );
  assert.throws(
    () => registryFor({ validUntil: "2026-07-20T01:45:00.000Z" }).validate(control(), {
      evaluatedAt: "2026-07-20T02:00:00.000Z",
    }),
    { code: "BASELINE_SIGNOFF_WORKFLOW_RECEIPT_INVALID" }
  );
  assert.throws(
    () => registryFor({ observedAt: "2026-07-20T00:59:59.000Z" }).validate(control(), {
      evaluatedAt: "2026-07-20T02:00:00.000Z",
    }),
    { code: "BASELINE_SIGNOFF_WORKFLOW_RECEIPT_INVALID" }
  );
});

test("valid execution control binds the trusted workflow receipt and authorizes nothing", () => {
  const input = control();
  const result = registryFor().validate(input, { evaluatedAt: "2026-07-20T02:00:00.000Z" });
  assert.equal(result.status, "SIGNOFF_EXECUTION_CONTROL_VERIFIED");
  assert.equal(result.executionControlDigest, computeBaselineSignoffExecutionControlDigest(input));
  assert.equal(result.workflowReceipt.status, "OPEN");
  assert.equal(result.runtimeAuthorized, false);
  assert.equal(result.approvalCollectionAuthorized, false);
  assert.equal(result.approvalMutationAuthorized, false);
  assert.equal(result.gateClosureAuthorized, false);
  assert.equal(result.formalLaunchAuthorized, false);
});
