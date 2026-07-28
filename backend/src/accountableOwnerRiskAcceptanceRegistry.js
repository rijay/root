const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "accountable-owner-risk-acceptance",
  "v2.0.0.json"
);
const PRODUCT_VERSION = "v1.0.0";
const CONTRACT_VERSION = "2.0.0";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const CONTRACT_SCOPE = "NON_RUNTIME_ACCOUNTABLE_OWNER_RISK_ACCEPTANCE";
const CLASSIFICATION = "DIRECT_OWNER_DIRECTIVE_SELF_ATTESTED";
const AUTHORIZATION_METHOD = "DIRECT_ACCOUNTABLE_OWNER_DIRECTIVE_V1";
const REQUIRED_DIRECTIVE = "允许将 v1.0.0 六角色审批机制替换为单一责任人风险接受机制，并重新生成审批基线。";
const REQUIRED_DECISION_IDS = Object.freeze([
  "D-001", "D-002", "D-003", "D-004", "D-005",
  "D-006", "D-007", "D-008", "D-009", "D-010",
]);
const REQUIRED_RISK_CATEGORIES = Object.freeze([
  "PRODUCT_SCOPE",
  "OPERATIONS_READINESS",
  "ENGINEERING_READINESS",
  "QA_QUALITY",
  "PRIVACY_COMPLIANCE",
  "HEALTH_CONTENT_SAFETY",
]);
const EXPECTED_INPUT_BINDING = Object.freeze({
  productVersion: PRODUCT_VERSION,
  prdSha256: "c7973c271bd60666196644b84655c9c56eda73835d7239072085c80290b39f81",
  designSha256: "5a2f774adb5db2f385985add6efd5c00df7a95fd6d05f0cf78b8a49af1bc5a44",
  gateDecisionSha256: "abc86917520c533942588991907e4b81622f30e9fba37b56af1074e6c0c59109",
});
const EXPECTED_SUPERSESSION = Object.freeze({
  contractPath: "contracts/baseline-signoff/v1.0.0.json",
  contractSha256: "0b61952718ca4d8e819f6aff4f7c34ba9ef9087c1325b55930f1374e201699f3",
  status: "SUPERSEDED_NOT_DELETED",
});
const AUTHORIZATION = Object.freeze({
  baselineApprovalGateClosureAuthorized: true,
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  deploymentAuthorized: false,
  formalLaunchAuthorized: false,
});
const DOCUMENT_FIELDS = Object.freeze([
  "acceptanceFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "acceptanceId",
  "accountableOwnerRef",
  "inputBinding",
  "sourceInputBindingDigest",
  "coveredDecisionIds",
  "acceptedRiskCategories",
  "directive",
  "directiveDigest",
  "authorizationMethod",
  "authorizationEvidenceRef",
  "acceptedAt",
  "revocationStatus",
  "revocationEvidenceRef",
  "supersedes",
  "createdAt",
]);

function acceptanceError(code = "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_INVALID") {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw acceptanceError("ACCOUNTABLE_OWNER_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw acceptanceError("ACCOUNTABLE_OWNER_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw acceptanceError("ACCOUNTABLE_OWNER_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) {
      throw acceptanceError("ACCOUNTABLE_OWNER_CANONICALIZATION_REJECTED");
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

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function computeAccountableOwnerInputBindingDigest(inputBinding) {
  return digest("myroot-baseline-signoff-input-binding:v1", inputBinding);
}

function computeAccountableOwnerRiskAcceptanceDigest(document) {
  return digest("myroot-accountable-owner-risk-acceptance:v2", document);
}

function computeAccountableOwnerRiskAcceptanceRegistryDigest(manifest) {
  return digest("myroot-accountable-owner-risk-acceptance-registry:v2", manifest);
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
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

function rejectSecretShape(value) {
  if (Array.isArray(value)) {
    value.forEach(rejectSecretShape);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (!plainRecord(value)) throw acceptanceError();
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:access[_-]?key|credential|password|private[_-]?key|secret|token)/i.test(key)) {
      throw acceptanceError("ACCOUNTABLE_OWNER_SECRET_SHAPE_REJECTED");
    }
    rejectSecretShape(nested);
  }
}

function validateManifest(manifest) {
  if (!plainRecord(manifest)
    || manifest.registryVersion !== 2
    || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.scope !== CONTRACT_SCOPE
    || manifest.classification !== CLASSIFICATION
    || manifest.digestAlgorithm !== "SHA-256"
    || manifest.canonicalization?.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization?.digestDomainSeparation !== "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_V2"
    || canonicalJson(manifest.inputBinding) !== canonicalJson(EXPECTED_INPUT_BINDING)
    || !sameArray(manifest.requiredDecisionIds, REQUIRED_DECISION_IDS)
    || !sameArray(manifest.requiredRiskCategories, REQUIRED_RISK_CATEGORIES)
    || manifest.requiredDirective !== REQUIRED_DIRECTIVE
    || manifest.authorizationMethod !== AUTHORIZATION_METHOD
    || canonicalJson(manifest.supersedes) !== canonicalJson(EXPECTED_SUPERSESSION)
    || !exactKeys(manifest.documentSchema, [
      "acceptanceExactFields",
      "opaqueReferencePatterns",
    ])
    || !sameArray(manifest.documentSchema.acceptanceExactFields, DOCUMENT_FIELDS)
    || !exactKeys(manifest.authorization, Object.keys(AUTHORIZATION))
    || canonicalJson(manifest.authorization) !== canonicalJson(AUTHORIZATION)) {
    throw acceptanceError("ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_MANIFEST_INVALID");
  }
  canonicalJson(manifest);
  return deepFreeze(clone(manifest));
}

function normalizeInputBinding(value) {
  if (!exactKeys(value, [
    "productVersion", "prdSha256", "designSha256", "gateDecisionSha256",
  ]) || canonicalJson(value) !== canonicalJson(EXPECTED_INPUT_BINDING)) {
    throw acceptanceError("ACCOUNTABLE_OWNER_INPUT_BINDING_INVALID");
  }
  return clone(value);
}

function normalizeDocument(value) {
  rejectSecretShape(value);
  if (!exactKeys(value, DOCUMENT_FIELDS)
    || value.acceptanceFormatVersion !== 2
    || value.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || value.productVersion !== PRODUCT_VERSION
    || !opaqueRef(value.acceptanceId, "acceptance")
    || !opaqueRef(value.accountableOwnerRef, "actor")
    || !sameArray(value.coveredDecisionIds, REQUIRED_DECISION_IDS)
    || !sameArray(value.acceptedRiskCategories, REQUIRED_RISK_CATEGORIES)
    || value.directive !== REQUIRED_DIRECTIVE
    || value.directiveDigest !== sha256Text(REQUIRED_DIRECTIVE)
    || value.authorizationMethod !== AUTHORIZATION_METHOD
    || !opaqueRef(value.authorizationEvidenceRef, "evidence")
    || !isoInstant(value.acceptedAt)
    || value.revocationStatus !== "ACTIVE"
    || value.revocationEvidenceRef !== null
    || canonicalJson(value.supersedes) !== canonicalJson(EXPECTED_SUPERSESSION)
    || !isoInstant(value.createdAt)
    || Date.parse(value.createdAt) < Date.parse(value.acceptedAt)) {
    throw acceptanceError();
  }
  const inputBinding = normalizeInputBinding(value.inputBinding);
  if (value.sourceInputBindingDigest !== computeAccountableOwnerInputBindingDigest(inputBinding)) {
    throw acceptanceError("ACCOUNTABLE_OWNER_INPUT_BINDING_DIGEST_MISMATCH");
  }
  return deepFreeze({ ...clone(value), inputBinding });
}

function validateRepositoryBinding(repositoryRoot, manifest) {
  const sourcePaths = {
    prdSha256: path.join(repositoryRoot, "docs", "v1.0.0_product_requirements.md"),
    designSha256: path.join(repositoryRoot, "docs", "design.md"),
    gateDecisionSha256: path.join(
      repositoryRoot,
      "docs",
      "v1.0.0_gate_and_document_authority_decision_2026-07-15.md"
    ),
  };
  for (const [digestField, sourcePath] of Object.entries(sourcePaths)) {
    if (!fs.existsSync(sourcePath)
      || sha256File(sourcePath) !== manifest.inputBinding[digestField]) {
      throw acceptanceError("ACCOUNTABLE_OWNER_REPOSITORY_SOURCE_BINDING_MISMATCH");
    }
  }
  const supersededPath = path.join(repositoryRoot, manifest.supersedes.contractPath);
  if (!fs.existsSync(supersededPath)
    || sha256File(supersededPath) !== manifest.supersedes.contractSha256) {
    throw acceptanceError("ACCOUNTABLE_OWNER_SUPERSEDED_CONTRACT_BINDING_MISMATCH");
  }
}

function evaluationFor(document) {
  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    productVersion: PRODUCT_VERSION,
    classification: CLASSIFICATION,
    status: "OWNER_RISK_ACCEPTANCE_CLOSED",
    acceptanceDigest: computeAccountableOwnerRiskAcceptanceDigest(document),
    inputBindingDigest: computeAccountableOwnerInputBindingDigest(document.inputBinding),
    coveredDecisionIds: clone(REQUIRED_DECISION_IDS),
    acceptedRiskCategories: clone(REQUIRED_RISK_CATEGORIES),
    baselineApprovalGateClosureAuthorized: true,
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    formalLaunchAuthorized: false,
  });
}

function createAccountableOwnerRiskAcceptanceRegistry(options = {}) {
  const manifest = validateManifest(options.manifest || JSON.parse(fs.readFileSync(
    options.manifestPath || DEFAULT_MANIFEST_PATH,
    "utf8"
  )));
  validateRepositoryBinding(options.repositoryRoot || REPOSITORY_ROOT, manifest);
  const registryDigest = computeAccountableOwnerRiskAcceptanceRegistryDigest(manifest);
  return deepFreeze({
    describe() {
      return deepFreeze({
        contractVersion: CONTRACT_VERSION,
        productVersion: PRODUCT_VERSION,
        classification: CLASSIFICATION,
        registryDigest,
        inputBindingDigest: computeAccountableOwnerInputBindingDigest(manifest.inputBinding),
        supersedes: clone(EXPECTED_SUPERSESSION),
        authorization: clone(AUTHORIZATION),
      });
    },
    evaluate(input) {
      return evaluationFor(normalizeDocument(input));
    },
    seal(input) {
      const document = normalizeDocument(input);
      const evaluation = evaluationFor(document);
      return deepFreeze({
        envelopeFormatVersion: 2,
        contractVersion: CONTRACT_VERSION,
        productVersion: PRODUCT_VERSION,
        classification: CLASSIFICATION,
        acceptanceDigest: evaluation.acceptanceDigest,
        inputBindingDigest: evaluation.inputBindingDigest,
        baselineApprovalGateClosureAuthorized: true,
        runtimeAuthorized: false,
        candidateCreationAuthorized: false,
        deploymentAuthorized: false,
        formalLaunchAuthorized: false,
        document,
      });
    },
    verify(envelope) {
      if (!exactKeys(envelope, [
        "envelopeFormatVersion",
        "contractVersion",
        "productVersion",
        "classification",
        "acceptanceDigest",
        "inputBindingDigest",
        "baselineApprovalGateClosureAuthorized",
        "runtimeAuthorized",
        "candidateCreationAuthorized",
        "deploymentAuthorized",
        "formalLaunchAuthorized",
        "document",
      ])
        || envelope.envelopeFormatVersion !== 2
        || envelope.contractVersion !== CONTRACT_VERSION
        || envelope.productVersion !== PRODUCT_VERSION
        || envelope.classification !== CLASSIFICATION
        || !sha256(envelope.acceptanceDigest)
        || !sha256(envelope.inputBindingDigest)
        || envelope.baselineApprovalGateClosureAuthorized !== true
        || envelope.runtimeAuthorized !== false
        || envelope.candidateCreationAuthorized !== false
        || envelope.deploymentAuthorized !== false
        || envelope.formalLaunchAuthorized !== false) {
        throw acceptanceError("ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_ENVELOPE_INVALID");
      }
      const document = normalizeDocument(envelope.document);
      const evaluation = evaluationFor(document);
      if (evaluation.acceptanceDigest !== envelope.acceptanceDigest
        || evaluation.inputBindingDigest !== envelope.inputBindingDigest) {
        throw acceptanceError("ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_ENVELOPE_DIGEST_MISMATCH");
      }
      return true;
    },
  });
}

let defaultRegistry;
function getDefaultAccountableOwnerRiskAcceptanceRegistry() {
  if (!defaultRegistry) defaultRegistry = createAccountableOwnerRiskAcceptanceRegistry();
  return defaultRegistry;
}

module.exports = {
  computeAccountableOwnerInputBindingDigest,
  computeAccountableOwnerRiskAcceptanceDigest,
  computeAccountableOwnerRiskAcceptanceRegistryDigest,
  createAccountableOwnerRiskAcceptanceRegistry,
  getDefaultAccountableOwnerRiskAcceptanceRegistry,
};
