const fs = require("node:fs");
const path = require("node:path");

const {
  computeBaselineSignoffPayloadDigest,
} = require("./baselineSignoffContractRegistry");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "baseline-signoff-execution",
  "v1.0.0.json"
);
const APPROVAL_RECEIPT_FIELDS = Object.freeze([
  "receiptFormatVersion",
  "approvalSystemRef",
  "workflowInstanceRef",
  "signoffId",
  "signerRef",
  "role",
  "decisionId",
  "decision",
  "sourceInputBindingDigest",
  "signedPayloadDigest",
  "signatureDigest",
  "signatureVerified",
  "authorityEvidenceRef",
  "approvalEvidenceRef",
  "observedAt",
  "validUntil",
]);
const REVOCATION_RECEIPT_FIELDS = Object.freeze([
  "receiptFormatVersion",
  "revocationSourceRef",
  "workflowInstanceRef",
  "signoffId",
  "status",
  "observedAt",
  "validUntil",
  "evidenceRef",
]);
const REQUIRED_SIGNOFF_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "decisionId",
  "decision",
  "signedAt",
  "inputBindingDigest",
  "signedPayloadDigest",
  "signatureMethod",
  "signatureDigest",
]);
const ROLES = Object.freeze([
  "PRODUCT",
  "OPERATIONS",
  "ENGINEERING",
  "QA",
  "PRIVACY",
  "HEALTH_CONTENT_REVIEW",
]);
const DECISIONS = Object.freeze(["APPROVED", "REJECTED", "APPROVED_WITH_CONDITIONS"]);

function evidenceError(code = "BASELINE_SIGNOFF_EVIDENCE_INVALID") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return plainRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function hasFields(value, fields) {
  return plainRecord(value) && fields.every((field) => Object.hasOwn(value, field));
}

function opaqueRef(value, namespace) {
  return typeof value === "string"
    && new RegExp(`^${namespace}:sha256:[a-f0-9]{64}$`).test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isoInstant(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function currentReceiptWindow(receipt, evaluatedAt) {
  return isoInstant(receipt.observedAt)
    && isoInstant(receipt.validUntil)
    && Date.parse(receipt.observedAt) <= Date.parse(evaluatedAt)
    && Date.parse(receipt.validUntil) >= Date.parse(evaluatedAt);
}

function validateManifest(manifest) {
  if (!plainRecord(manifest)
    || manifest.scope !== "NON_RUNTIME_BASELINE_SIGNOFF_EXECUTION_CONTROL"
    || manifest.productVersion !== "v1.0.0"
    || !Array.isArray(manifest.allowedSignatureMethods)
    || !manifest.allowedSignatureMethods.includes("CONTROLLED_APPROVAL_RECORD_V1")
    || !manifest.allowedSignatureMethods.includes("DETACHED_DIGITAL_SIGNATURE_V1")
    || !exactKeys(manifest.authorization, [
      "runtimeAuthorized",
      "candidateCreationAuthorized",
      "approvalCollectionAuthorized",
      "approvalMutationAuthorized",
      "deploymentAuthorized",
      "gateClosureAuthorized",
      "formalLaunchAuthorized",
    ])
    || Object.values(manifest.authorization).some((value) => value !== false)
    || JSON.stringify(manifest.executionControlSchema?.approvalReceiptExactFields)
      !== JSON.stringify(APPROVAL_RECEIPT_FIELDS)
    || JSON.stringify(manifest.executionControlSchema?.revocationReceiptExactFields)
      !== JSON.stringify(REVOCATION_RECEIPT_FIELDS)) {
    throw evidenceError("BASELINE_SIGNOFF_EVIDENCE_MANIFEST_INVALID");
  }
  return deepFreeze(clone(manifest));
}

function normalizeSignoff(signoff) {
  if (!hasFields(signoff, REQUIRED_SIGNOFF_FIELDS)
    || !opaqueRef(signoff.signoffId, "signoff")
    || !opaqueRef(signoff.signerRef, "actor")
    || !ROLES.includes(signoff.role)
    || !/^D-\d{3}$/.test(signoff.decisionId || "")
    || !DECISIONS.includes(signoff.decision)
    || !isoInstant(signoff.signedAt)
    || !sha256(signoff.inputBindingDigest)
    || !sha256(signoff.signedPayloadDigest)
    || !sha256(signoff.signatureDigest)
    || !["CONTROLLED_APPROVAL_RECORD_V1", "DETACHED_DIGITAL_SIGNATURE_V1"]
      .includes(signoff.signatureMethod)
    || computeBaselineSignoffPayloadDigest(signoff) !== signoff.signedPayloadDigest) {
    throw evidenceError("BASELINE_SIGNOFF_PAYLOAD_INVALID");
  }
  return deepFreeze(clone(signoff));
}

function normalizeApprovalReceipt(receipt, signoff, executionControl, evaluatedAt) {
  if (!exactKeys(receipt, APPROVAL_RECEIPT_FIELDS)
    || receipt.receiptFormatVersion !== 1
    || receipt.approvalSystemRef !== executionControl.approvalSystemRef
    || receipt.workflowInstanceRef !== executionControl.workflowInstanceRef
    || receipt.signoffId !== signoff.signoffId
    || receipt.signerRef !== signoff.signerRef
    || receipt.role !== signoff.role
    || receipt.decisionId !== signoff.decisionId
    || receipt.decision !== signoff.decision
    || receipt.sourceInputBindingDigest !== executionControl.sourceInputBindingDigest
    || receipt.sourceInputBindingDigest !== signoff.inputBindingDigest
    || receipt.signedPayloadDigest !== signoff.signedPayloadDigest
    || receipt.signatureDigest !== signoff.signatureDigest
    || receipt.signatureVerified !== true
    || !opaqueRef(receipt.authorityEvidenceRef, "evidence")
    || !opaqueRef(receipt.approvalEvidenceRef, "evidence")
    || Date.parse(receipt.observedAt) < Date.parse(signoff.signedAt)
    || !currentReceiptWindow(receipt, evaluatedAt)) {
    throw evidenceError("BASELINE_SIGNOFF_APPROVAL_RECEIPT_INVALID");
  }
  return deepFreeze(clone(receipt));
}

function normalizeRevocationReceipt(
  receipt,
  signoff,
  executionControl,
  approvalReceipt,
  evaluatedAt
) {
  if (!exactKeys(receipt, REVOCATION_RECEIPT_FIELDS)
    || receipt.receiptFormatVersion !== 1
    || receipt.revocationSourceRef !== executionControl.revocationSourceRef
    || receipt.workflowInstanceRef !== executionControl.workflowInstanceRef
    || receipt.signoffId !== signoff.signoffId
    || !["ACTIVE", "REVOKED"].includes(receipt.status)
    || !opaqueRef(receipt.evidenceRef, "evidence")
    || Date.parse(receipt.observedAt) < Date.parse(approvalReceipt.observedAt)
    || !currentReceiptWindow(receipt, evaluatedAt)) {
    throw evidenceError("BASELINE_SIGNOFF_REVOCATION_RECEIPT_INVALID");
  }
  if (receipt.status !== "ACTIVE") {
    throw evidenceError("BASELINE_SIGNOFF_REVOKED");
  }
  return deepFreeze(clone(receipt));
}

function createBaselineSignoffEvidenceVerifier(options = {}) {
  const manifest = validateManifest(options.manifest || JSON.parse(fs.readFileSync(
    options.manifestPath || DEFAULT_MANIFEST_PATH,
    "utf8"
  )));
  const executionControlRegistry = options.executionControlRegistry;
  const approvalReceiptAdapter = options.approvalReceiptAdapter;
  const revocationReceiptAdapter = options.revocationReceiptAdapter;
  const detachedSignatureAdapter = options.detachedSignatureAdapter || null;
  if (!executionControlRegistry || typeof executionControlRegistry.validate !== "function") {
    throw evidenceError("BASELINE_SIGNOFF_EXECUTION_REGISTRY_REQUIRED");
  }
  if (!approvalReceiptAdapter || typeof approvalReceiptAdapter.readApprovalReceipt !== "function") {
    throw evidenceError("BASELINE_SIGNOFF_APPROVAL_ADAPTER_REQUIRED");
  }
  if (!revocationReceiptAdapter || typeof revocationReceiptAdapter.readRevocationReceipt !== "function") {
    throw evidenceError("BASELINE_SIGNOFF_REVOCATION_ADAPTER_REQUIRED");
  }
  return deepFreeze({
    describe() {
      return deepFreeze({
        contractVersion: manifest.contractVersion,
        productVersion: manifest.productVersion,
        detachedSignatureAdapterAvailable: Boolean(detachedSignatureAdapter),
        authorization: clone(manifest.authorization),
      });
    },
    verify(input) {
      if (!plainRecord(input) || !isoInstant(input.evaluatedAt)) {
        throw evidenceError("BASELINE_SIGNOFF_VERIFICATION_INPUT_INVALID");
      }
      const executionVerification = executionControlRegistry.validate(input.executionControl, {
        evaluatedAt: input.evaluatedAt,
      });
      const signoff = normalizeSignoff(input.signoff);
      const approvalReceipt = normalizeApprovalReceipt(
        approvalReceiptAdapter.readApprovalReceipt({
          approvalSystemRef: input.executionControl.approvalSystemRef,
          workflowInstanceRef: input.executionControl.workflowInstanceRef,
          signoffId: signoff.signoffId,
        }),
        signoff,
        input.executionControl,
        input.evaluatedAt
      );
      if (signoff.signatureMethod === "DETACHED_DIGITAL_SIGNATURE_V1") {
        if (!detachedSignatureAdapter
          || typeof detachedSignatureAdapter.verifyDetachedSignature !== "function") {
          throw evidenceError("BASELINE_SIGNOFF_DETACHED_SIGNATURE_ADAPTER_REQUIRED");
        }
        const detachedResult = detachedSignatureAdapter.verifyDetachedSignature({
          signoff,
          approvalReceipt,
          evaluatedAt: input.evaluatedAt,
        });
        if (!exactKeys(detachedResult, ["verified", "evidenceRef"])
          || detachedResult.verified !== true
          || !opaqueRef(detachedResult.evidenceRef, "evidence")) {
          throw evidenceError("BASELINE_SIGNOFF_DETACHED_SIGNATURE_INVALID");
        }
      }
      const revocationReceipt = normalizeRevocationReceipt(
        revocationReceiptAdapter.readRevocationReceipt({
          revocationSourceRef: input.executionControl.revocationSourceRef,
          workflowInstanceRef: input.executionControl.workflowInstanceRef,
          signoffId: signoff.signoffId,
        }),
        signoff,
        input.executionControl,
        approvalReceipt,
        input.evaluatedAt
      );
      return deepFreeze({
        status: "BASELINE_SIGNOFF_TRUSTED_EVIDENCE_VERIFIED",
        executionControlDigest: executionVerification.executionControlDigest,
        signoffId: signoff.signoffId,
        signerRef: signoff.signerRef,
        role: signoff.role,
        decisionId: signoff.decisionId,
        decision: signoff.decision,
        approvalEvidenceRef: approvalReceipt.approvalEvidenceRef,
        authorityEvidenceRef: approvalReceipt.authorityEvidenceRef,
        revocationEvidenceRef: revocationReceipt.evidenceRef,
        verifiedAt: input.evaluatedAt,
        runtimeAuthorized: false,
        candidateCreationAuthorized: false,
        approvalCollectionAuthorized: false,
        approvalMutationAuthorized: false,
        deploymentAuthorized: false,
        gateClosureAuthorized: false,
        formalLaunchAuthorized: false,
      });
    },
  });
}

module.exports = {
  createBaselineSignoffEvidenceVerifier,
};
