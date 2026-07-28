const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "baseline-signoff-execution",
  "v1.0.0.json"
);
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const PRODUCT_VERSION = "v1.0.0";
const EXECUTION_FIELDS = Object.freeze([
  "executionFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "approvalSystemRef",
  "workflowInstanceRef",
  "workflowOwnerSignerRef",
  "evidenceCustodianSignerRef",
  "openedAt",
  "dueAt",
  "escalationPolicyRef",
  "revocationSourceRef",
  "sourceInputBindingDigest",
]);
const WORKFLOW_RECEIPT_FIELDS = Object.freeze([
  "receiptFormatVersion",
  "approvalSystemRef",
  "workflowInstanceRef",
  "executionControlDigest",
  "status",
  "observedAt",
  "validUntil",
  "evidenceRef",
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  approvalCollectionAuthorized: false,
  approvalMutationAuthorized: false,
  deploymentAuthorized: false,
  gateClosureAuthorized: false,
  formalLaunchAuthorized: false,
});

function executionError(code = "BASELINE_SIGNOFF_EXECUTION_CONTROL_INVALID") {
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

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw executionError("BASELINE_SIGNOFF_EXECUTION_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw executionError("BASELINE_SIGNOFF_EXECUTION_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw executionError("BASELINE_SIGNOFF_EXECUTION_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) {
      throw executionError("BASELINE_SIGNOFF_EXECUTION_CANONICALIZATION_REJECTED");
    }
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

function computeBaselineSignoffExecutionControlDigest(control) {
  return digest("myroot-baseline-signoff-execution-control:v1", control);
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

function validateManifest(manifest) {
  if (!plainRecord(manifest)
    || manifest.registryVersion !== 1
    || manifest.contractVersion !== "1.0.0"
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.scope !== "NON_RUNTIME_BASELINE_SIGNOFF_EXECUTION_CONTROL"
    || manifest.digestAlgorithm !== "SHA-256"
    || manifest.canonicalization?.version !== CANONICALIZATION_VERSION
    || !exactKeys(manifest.authorization, Object.keys(AUTHORIZATION))
    || canonicalJson(manifest.authorization) !== canonicalJson(AUTHORIZATION)
    || !exactKeys(manifest.executionControlSchema, [
      "exactFields",
      "workflowReceiptExactFields",
      "approvalReceiptExactFields",
      "revocationReceiptExactFields",
      "opaqueReferencePatterns",
    ])
    || canonicalJson(manifest.executionControlSchema.exactFields) !== canonicalJson(EXECUTION_FIELDS)
    || canonicalJson(manifest.executionControlSchema.workflowReceiptExactFields)
      !== canonicalJson(WORKFLOW_RECEIPT_FIELDS)
    || canonicalJson(manifest.allowedWorkflowStatuses) !== canonicalJson([
      "OPEN", "CANCELLED", "COMPLETED",
    ])) throw executionError("BASELINE_SIGNOFF_EXECUTION_MANIFEST_INVALID");
  return deepFreeze(clone(manifest));
}

function normalizeControl(value) {
  if (!exactKeys(value, EXECUTION_FIELDS)
    || value.executionFormatVersion !== 1
    || value.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || value.productVersion !== PRODUCT_VERSION
    || !opaqueRef(value.approvalSystemRef, "system")
    || !opaqueRef(value.workflowInstanceRef, "workflow")
    || !opaqueRef(value.workflowOwnerSignerRef, "actor")
    || !opaqueRef(value.evidenceCustodianSignerRef, "actor")
    || value.workflowOwnerSignerRef === value.evidenceCustodianSignerRef
    || !isoInstant(value.openedAt)
    || !isoInstant(value.dueAt)
    || Date.parse(value.dueAt) <= Date.parse(value.openedAt)
    || !opaqueRef(value.escalationPolicyRef, "policy")
    || !opaqueRef(value.revocationSourceRef, "source")
    || !sha256(value.sourceInputBindingDigest)) {
    throw executionError("BASELINE_SIGNOFF_EXECUTION_CONTROL_INVALID");
  }
  return deepFreeze(clone(value));
}

function normalizeWorkflowReceipt(value, control, controlDigest, evaluatedAt) {
  if (!exactKeys(value, WORKFLOW_RECEIPT_FIELDS)
    || value.receiptFormatVersion !== 1
    || value.approvalSystemRef !== control.approvalSystemRef
    || value.workflowInstanceRef !== control.workflowInstanceRef
    || value.executionControlDigest !== controlDigest
    || !["OPEN", "CANCELLED", "COMPLETED"].includes(value.status)
    || !isoInstant(value.observedAt)
    || !isoInstant(value.validUntil)
    || !opaqueRef(value.evidenceRef, "evidence")
    || Date.parse(value.observedAt) < Date.parse(control.openedAt)
    || Date.parse(value.observedAt) > Date.parse(evaluatedAt)
    || Date.parse(value.validUntil) < Date.parse(evaluatedAt)) {
    throw executionError("BASELINE_SIGNOFF_WORKFLOW_RECEIPT_INVALID");
  }
  if (value.status !== "OPEN") {
    throw executionError("BASELINE_SIGNOFF_WORKFLOW_NOT_OPEN");
  }
  return deepFreeze(clone(value));
}

function createBaselineSignoffExecutionControlRegistry(options = {}) {
  const manifest = validateManifest(options.manifest || JSON.parse(fs.readFileSync(
    options.manifestPath || DEFAULT_MANIFEST_PATH,
    "utf8"
  )));
  const workflowReceiptAdapter = options.workflowReceiptAdapter;
  if (!workflowReceiptAdapter || typeof workflowReceiptAdapter.readWorkflowReceipt !== "function") {
    throw executionError("BASELINE_SIGNOFF_WORKFLOW_ADAPTER_REQUIRED");
  }
  return deepFreeze({
    describe() {
      return deepFreeze({
        contractVersion: manifest.contractVersion,
        productVersion: manifest.productVersion,
        authorization: clone(AUTHORIZATION),
      });
    },
    validate(input, context = {}) {
      const control = normalizeControl(input);
      if (!isoInstant(context.evaluatedAt)) {
        throw executionError("BASELINE_SIGNOFF_EVALUATED_AT_REQUIRED");
      }
      if (Date.parse(context.evaluatedAt) < Date.parse(control.openedAt)
        || Date.parse(context.evaluatedAt) > Date.parse(control.dueAt)) {
        throw executionError("BASELINE_SIGNOFF_WORKFLOW_EXPIRED");
      }
      const executionControlDigest = computeBaselineSignoffExecutionControlDigest(control);
      const receipt = workflowReceiptAdapter.readWorkflowReceipt({
        approvalSystemRef: control.approvalSystemRef,
        workflowInstanceRef: control.workflowInstanceRef,
        executionControlDigest,
      });
      const workflowReceipt = normalizeWorkflowReceipt(
        receipt,
        control,
        executionControlDigest,
        context.evaluatedAt
      );
      return deepFreeze({
        status: "SIGNOFF_EXECUTION_CONTROL_VERIFIED",
        executionControlDigest,
        workflowReceipt,
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
  computeBaselineSignoffExecutionControlDigest,
  createBaselineSignoffExecutionControlRegistry,
};
