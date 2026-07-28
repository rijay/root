const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  computeBaselineSignoffPayloadDigest,
} = require("../src/baselineSignoffContractRegistry");
const {
  createBaselineSignoffExecutionControlRegistry,
} = require("../src/baselineSignoffExecutionControlRegistry");
const {
  createBaselineSignoffEvidenceVerifier,
} = require("../src/baselineSignoffEvidenceVerifier");

const EVALUATED_AT = "2026-07-20T02:00:00.000Z";

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ref(namespace, seed) {
  return `${namespace}:sha256:${sha(seed)}`;
}

function executionControl() {
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

function signoff(signatureMethod = "CONTROLLED_APPROVAL_RECORD_V1") {
  const value = {
    signoffId: ref("signoff", "D-001-product"),
    signerRef: ref("actor", "product-owner"),
    role: "PRODUCT",
    decisionId: "D-001",
    decision: "APPROVED",
    conditions: [],
    inputBindingDigest: executionControl().sourceInputBindingDigest,
    evidenceRef: ref("evidence", "caller-approval-claim"),
    signedAt: "2026-07-20T01:20:00.000Z",
    signatureMethod,
    signedPayloadDigest: "0".repeat(64),
    signatureDigest: sha("trusted-signature"),
    validatorRef: ref("validator", "caller-validator"),
    validationStatus: "VALIDATED",
    validationEvidenceRef: ref("evidence", "caller-validation"),
    validatedAt: "2026-07-20T01:21:00.000Z",
    revocationStatus: "ACTIVE",
    revocationEvidenceRef: null,
  };
  value.signedPayloadDigest = computeBaselineSignoffPayloadDigest(value);
  return value;
}

function executionRegistry(control = executionControl()) {
  return createBaselineSignoffExecutionControlRegistry({
    workflowReceiptAdapter: {
      readWorkflowReceipt(input) {
        return {
          receiptFormatVersion: 1,
          approvalSystemRef: input.approvalSystemRef,
          workflowInstanceRef: input.workflowInstanceRef,
          executionControlDigest: input.executionControlDigest,
          status: "OPEN",
          observedAt: "2026-07-20T01:30:00.000Z",
          validUntil: "2026-07-20T03:00:00.000Z",
          evidenceRef: ref("evidence", "workflow-readback"),
        };
      },
    },
  });
}

function approvalReceiptFor(value, control = executionControl(), overrides = {}) {
  return {
    receiptFormatVersion: 1,
    approvalSystemRef: control.approvalSystemRef,
    workflowInstanceRef: control.workflowInstanceRef,
    signoffId: value.signoffId,
    signerRef: value.signerRef,
    role: value.role,
    decisionId: value.decisionId,
    decision: value.decision,
    sourceInputBindingDigest: control.sourceInputBindingDigest,
    signedPayloadDigest: value.signedPayloadDigest,
    signatureDigest: value.signatureDigest,
    signatureVerified: true,
    authorityEvidenceRef: ref("evidence", "signer-authority"),
    approvalEvidenceRef: ref("evidence", "approval-record"),
    observedAt: "2026-07-20T01:31:00.000Z",
    validUntil: "2026-07-20T03:00:00.000Z",
    ...overrides,
  };
}

function revocationReceiptFor(value, control = executionControl(), overrides = {}) {
  return {
    receiptFormatVersion: 1,
    revocationSourceRef: control.revocationSourceRef,
    workflowInstanceRef: control.workflowInstanceRef,
    signoffId: value.signoffId,
    status: "ACTIVE",
    observedAt: "2026-07-20T01:32:00.000Z",
    validUntil: "2026-07-20T03:00:00.000Z",
    evidenceRef: ref("evidence", "revocation-readback"),
    ...overrides,
  };
}

function verifierFor({ value, control, approvalOverrides, revocationOverrides, detached } = {}) {
  const actualControl = control || executionControl();
  const actualSignoff = value || signoff();
  return createBaselineSignoffEvidenceVerifier({
    executionControlRegistry: executionRegistry(actualControl),
    approvalReceiptAdapter: {
      readApprovalReceipt() {
        return approvalReceiptFor(actualSignoff, actualControl, approvalOverrides);
      },
    },
    revocationReceiptAdapter: {
      readRevocationReceipt() {
        return revocationReceiptFor(actualSignoff, actualControl, revocationOverrides);
      },
    },
    ...(detached ? { detachedSignatureAdapter: detached } : {}),
  });
}

test("trusted controlled approval and fresh revocation receipts verify and authorize nothing", () => {
  const control = executionControl();
  const value = signoff();
  const result = verifierFor({ value, control }).verify({
    signoff: value,
    executionControl: control,
    evaluatedAt: EVALUATED_AT,
  });
  assert.equal(result.status, "BASELINE_SIGNOFF_TRUSTED_EVIDENCE_VERIFIED");
  assert.equal(result.role, "PRODUCT");
  assert.equal(result.runtimeAuthorized, false);
  assert.equal(result.approvalCollectionAuthorized, false);
  assert.equal(result.approvalMutationAuthorized, false);
  assert.equal(result.gateClosureAuthorized, false);
  assert.equal(result.formalLaunchAuthorized, false);
});

test("caller self-reported VALIDATED/ACTIVE and a plausible 64-hex signature are not trusted", () => {
  const control = executionControl();
  const value = signoff();
  value.signatureDigest = "a".repeat(64);
  value.signedPayloadDigest = computeBaselineSignoffPayloadDigest(value);
  const verifier = verifierFor({
    value,
    control,
    approvalOverrides: { signatureDigest: sha("actual-controlled-signature") },
  });
  assert.throws(
    () => verifier.verify({ signoff: value, executionControl: control, evaluatedAt: EVALUATED_AT }),
    { code: "BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID" }
  );
});

test("wrong role or payload from the approval Adapter fails closed", () => {
  const control = executionControl();
  const value = signoff();
  for (const approvalOverrides of [
    { role: "QA" },
    { signedPayloadDigest: "f".repeat(64) },
  ]) {
    assert.throws(
      () => verifierFor({ value, control, approvalOverrides }).verify({
        signoff: value,
        executionControl: control,
        evaluatedAt: EVALUATED_AT,
      }),
      { code: "BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID" }
    );
  }
});

test("stale, revoked and cross-workflow receipts fail closed", () => {
  const control = executionControl();
  const value = signoff();
  assert.throws(
    () => verifierFor({
      value,
      control,
      approvalOverrides: { validUntil: "2026-07-20T01:59:59.000Z" },
    }).verify({ signoff: value, executionControl: control, evaluatedAt: EVALUATED_AT }),
    { code: "BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID" }
  );
  assert.throws(
    () => verifierFor({
      value,
      control,
      approvalOverrides: { observedAt: "2026-07-20T01:19:59.000Z" },
    }).verify({ signoff: value, executionControl: control, evaluatedAt: EVALUATED_AT }),
    { code: "BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID" }
  );
  assert.throws(
    () => verifierFor({ value, control, revocationOverrides: { status: "REVOKED" } }).verify({
      signoff: value,
      executionControl: control,
      evaluatedAt: EVALUATED_AT,
    }),
    { code: "BASELINE_SIGNOFF_REVOKED" }
  );
  assert.throws(
    () => verifierFor({
      value,
      control,
      revocationOverrides: { observedAt: "2026-07-20T01:30:59.000Z" },
    }).verify({ signoff: value, executionControl: control, evaluatedAt: EVALUATED_AT }),
    { code: "BASELINE_SIGNOFF_REVOCATION_RECEIPT_INVALID" }
  );
  assert.throws(
    () => verifierFor({
      value,
      control,
      approvalOverrides: { workflowInstanceRef: ref("workflow", "another-workflow") },
    }).verify({ signoff: value, executionControl: control, evaluatedAt: EVALUATED_AT }),
    { code: "BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID" }
  );
});

test("detached signature method is rejected when no real Adapter is installed", () => {
  const control = executionControl();
  const value = signoff("DETACHED_DIGITAL_SIGNATURE_V1");
  assert.throws(
    () => verifierFor({ value, control }).verify({
      signoff: value,
      executionControl: control,
      evaluatedAt: EVALUATED_AT,
    }),
    { code: "BASELINE_SIGNOFF_DETACHED_SIGNATURE_ADAPTER_REQUIRED" }
  );
});
