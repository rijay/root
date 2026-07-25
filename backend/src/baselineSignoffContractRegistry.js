const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "baseline-signoff",
  "v1.0.0.json"
);

const CONTRACT_STATUS = "NON_RUNTIME_CONTRACT";
const CONTRACT_VERSION = "1.0.0";
const PRODUCT_VERSION = "v1.0.0";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const REQUIRED_ROLES = Object.freeze([
  "PRODUCT",
  "OPERATIONS",
  "ENGINEERING",
  "QA",
  "PRIVACY",
  "HEALTH_CONTENT_REVIEW",
]);
const DECISION_MATRIX = Object.freeze([
  Object.freeze({ decisionId: "D-001", requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "ENGINEERING"]) }),
  Object.freeze({ decisionId: "D-002", requiredRoles: Object.freeze(["PRODUCT", "PRIVACY", "ENGINEERING"]) }),
  Object.freeze({ decisionId: "D-003", requiredRoles: Object.freeze(["PRODUCT", "HEALTH_CONTENT_REVIEW", "PRIVACY"]) }),
  Object.freeze({ decisionId: "D-004", requiredRoles: Object.freeze(["PRODUCT", "HEALTH_CONTENT_REVIEW", "OPERATIONS"]) }),
  Object.freeze({ decisionId: "D-005", requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "QA"]) }),
  Object.freeze({ decisionId: "D-006", requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "ENGINEERING", "QA"]) }),
  Object.freeze({ decisionId: "D-007", requiredRoles: Object.freeze(["PRODUCT", "PRIVACY", "ENGINEERING"]) }),
  Object.freeze({ decisionId: "D-008", requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "ENGINEERING", "QA"]) }),
  Object.freeze({ decisionId: "D-009", requiredRoles: Object.freeze(["PRODUCT", "HEALTH_CONTENT_REVIEW", "PRIVACY"]) }),
  Object.freeze({ decisionId: "D-010", requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "PRIVACY", "ENGINEERING", "QA"]) }),
]);
const ALLOWED_DECISIONS = Object.freeze([
  "APPROVED",
  "REJECTED",
  "APPROVED_WITH_CONDITIONS",
]);
const ALLOWED_SIGNATURE_METHODS = Object.freeze([
  "CONTROLLED_APPROVAL_RECORD_V1",
  "DETACHED_DIGITAL_SIGNATURE_V1",
]);
const VALIDATION_STATUSES = Object.freeze(["VALIDATED", "INVALID"]);
const REVOCATION_STATUSES = Object.freeze(["ACTIVE", "REVOKED"]);
const CONDITION_STATUSES = Object.freeze(["OPEN", "CLOSED"]);
const SEPARATION_OF_DUTIES = Object.freeze([
  Object.freeze({
    role: "PRODUCT",
    mustUseDifferentSignerFrom: Object.freeze(["PRIVACY", "HEALTH_CONTENT_REVIEW"]),
  }),
  Object.freeze({
    role: "ENGINEERING",
    mustUseDifferentSignerFrom: Object.freeze(["QA"]),
  }),
]);
const EXPECTED_INPUT_BINDING = Object.freeze({
  productVersion: PRODUCT_VERSION,
  prdSha256: "c7973c271bd60666196644b84655c9c56eda73835d7239072085c80290b39f81",
  designSha256: "5a2f774adb5db2f385985add6efd5c00df7a95fd6d05f0cf78b8a49af1bc5a44",
  gateDecisionSha256: "abc86917520c533942588991907e4b81622f30e9fba37b56af1074e6c0c59109",
});

const MANIFEST_FIELDS = Object.freeze([
  "registryVersion",
  "contractVersion",
  "productVersion",
  "scope",
  "digestAlgorithm",
  "canonicalization",
  "inputBinding",
  "requiredRoles",
  "decisions",
  "allowedDecisions",
  "allowedSignatureMethods",
  "validationStatuses",
  "revocationStatuses",
  "conditionStatuses",
  "separationOfDuties",
  "documentSchema",
  "authorization",
]);
const DOCUMENT_FIELDS = Object.freeze([
  "baselineFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "baselineId",
  "inputBinding",
  "signoffs",
  "createdAt",
]);
const SIGNOFF_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "decisionId",
  "decision",
  "conditions",
  "inputBindingDigest",
  "evidenceRef",
  "signedAt",
  "signatureMethod",
  "signedPayloadDigest",
  "signatureDigest",
  "validatorRef",
  "validationStatus",
  "validationEvidenceRef",
  "validatedAt",
  "revocationStatus",
  "revocationEvidenceRef",
]);
const CONDITION_FIELDS = Object.freeze([
  "conditionId",
  "ownerRef",
  "deadline",
  "status",
  "closureEvidenceRef",
]);
const SIGNED_PAYLOAD_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "decisionId",
  "decision",
  "conditions",
  "inputBindingDigest",
  "evidenceRef",
  "signedAt",
  "signatureMethod",
]);
const SIGNED_CONDITION_FIELDS = Object.freeze([
  "conditionId",
  "ownerRef",
  "deadline",
]);
const OPAQUE_REFERENCE_PATTERNS = Object.freeze({
  baseline: "^baseline:sha256:[a-f0-9]{64}$",
  signoff: "^signoff:sha256:[a-f0-9]{64}$",
  actor: "^actor:sha256:[a-f0-9]{64}$",
  evidence: "^evidence:sha256:[a-f0-9]{64}$",
  condition: "^condition:sha256:[a-f0-9]{64}$",
  validator: "^validator:sha256:[a-f0-9]{64}$",
});

function contractError(code = "BASELINE_SIGNOFF_CONTRACT_INVALID") {
  const error = new Error("Baseline Signoff Contract Registry rejected the input");
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
    throw contractError("BASELINE_SIGNOFF_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw contractError("BASELINE_SIGNOFF_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw contractError("BASELINE_SIGNOFF_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) {
      throw contractError("BASELINE_SIGNOFF_CANONICALIZATION_REJECTED");
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

function computeBaselineSignoffContractRegistryDigest(manifest) {
  return digest("myroot-baseline-signoff-contract-registry:v1", manifest);
}

function computeBaselineInputBindingDigest(inputBinding) {
  return digest("myroot-baseline-signoff-input-binding:v1", inputBinding);
}

function conditionPayload(condition) {
  return {
    conditionId: condition.conditionId,
    ownerRef: condition.ownerRef,
    deadline: condition.deadline,
  };
}

function signoffPayload(signoff) {
  return {
    signoffId: signoff.signoffId,
    signerRef: signoff.signerRef,
    role: signoff.role,
    decisionId: signoff.decisionId,
    decision: signoff.decision,
    conditions: Array.isArray(signoff.conditions)
      ? signoff.conditions.map(conditionPayload).sort((left, right) => (
        left.conditionId < right.conditionId ? -1 : left.conditionId > right.conditionId ? 1 : 0
      )) : signoff.conditions,
    inputBindingDigest: signoff.inputBindingDigest,
    evidenceRef: signoff.evidenceRef,
    signedAt: signoff.signedAt,
    signatureMethod: signoff.signatureMethod,
  };
}

function computeBaselineSignoffPayloadDigest(signoff) {
  return digest("myroot-baseline-signoff-payload:v1", signoffPayload(signoff));
}

function computeBaselineSignoffDocumentDigest(document) {
  return digest("myroot-baseline-signoff-document:v1", document);
}

function exactText(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && value === value.normalize("NFC")
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function highConfidenceSecretText(value) {
  return typeof value === "string" && (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /(?:^|\s)(?:Basic|Bearer)\s+[A-Za-z0-9+/_=-]{8,}/i.test(value)
    || /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(value)
    || /^AKIA[0-9A-Z]{16}$/.test(value)
    || /^AKID[0-9A-Za-z]{13,40}$/.test(value)
    || /^gh[pousr]_[A-Za-z0-9]{20,}$/.test(value)
  );
}

function rejectSecretShape(value) {
  if (highConfidenceSecretText(value)) {
    throw contractError("BASELINE_SIGNOFF_SECRET_SHAPE_REJECTED");
  }
  if (Array.isArray(value)) {
    value.forEach(rejectSecretShape);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (!plainRecord(value)) throw contractError();
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:access[_-]?key|credential|key[_-]?material|password|private[_-]?key|secret|token)/i.test(key)) {
      throw contractError("BASELINE_SIGNOFF_SECRET_SHAPE_REJECTED");
    }
    rejectSecretShape(nested);
  }
}

function sha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function opaqueRef(value, namespace) {
  return typeof value === "string"
    && new RegExp(`^${namespace}:sha256:[a-f0-9]{64}$`).test(value);
}

function isoInstant(value) {
  return exactText(value, 24)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function normalizeInputBinding(value) {
  if (!exactKeys(value, [
    "productVersion",
    "prdSha256",
    "designSha256",
    "gateDecisionSha256",
  ]) || value.productVersion !== PRODUCT_VERSION
    || !sha256(value.prdSha256)
    || !sha256(value.designSha256)
    || !sha256(value.gateDecisionSha256)) {
    throw contractError("BASELINE_SIGNOFF_INPUT_BINDING_INVALID");
  }
  if (canonicalJson(value) !== canonicalJson(EXPECTED_INPUT_BINDING)) {
    throw contractError("BASELINE_SIGNOFF_INPUT_BINDING_MISMATCH");
  }
  return clone(value);
}

function normalizeCondition(value) {
  if (!exactKeys(value, CONDITION_FIELDS)
    || !opaqueRef(value.conditionId, "condition")
    || !opaqueRef(value.ownerRef, "actor")
    || !isoInstant(value.deadline)
    || !CONDITION_STATUSES.includes(value.status)) throw contractError();
  if (value.status === "OPEN" && value.closureEvidenceRef !== null) throw contractError();
  if (value.status === "CLOSED" && !opaqueRef(value.closureEvidenceRef, "evidence")) {
    throw contractError();
  }
  return clone(value);
}

function normalizeConditions(entries, decision) {
  if (!Array.isArray(entries)) throw contractError();
  const normalized = entries.map(normalizeCondition).sort((left, right) => (
    left.conditionId < right.conditionId ? -1 : left.conditionId > right.conditionId ? 1 : 0
  ));
  if (new Set(normalized.map((entry) => entry.conditionId)).size !== normalized.length) {
    throw contractError("BASELINE_SIGNOFF_DUPLICATE_CONDITION");
  }
  if (decision === "APPROVED_WITH_CONDITIONS" && normalized.length === 0) throw contractError();
  if (decision !== "APPROVED_WITH_CONDITIONS" && normalized.length !== 0) throw contractError();
  return normalized;
}

function normalizeSignoff(value, inputBindingDigest, matrixByDecision) {
  rejectSecretShape(value);
  if (!exactKeys(value, SIGNOFF_FIELDS)
    || !opaqueRef(value.signoffId, "signoff")
    || !opaqueRef(value.signerRef, "actor")
    || !REQUIRED_ROLES.includes(value.role)
    || !matrixByDecision.has(value.decisionId)
    || !ALLOWED_DECISIONS.includes(value.decision)
    || !opaqueRef(value.evidenceRef, "evidence")
    || !isoInstant(value.signedAt)
    || !ALLOWED_SIGNATURE_METHODS.includes(value.signatureMethod)
    || !sha256(value.signedPayloadDigest)
    || !sha256(value.signatureDigest)
    || !opaqueRef(value.validatorRef, "validator")
    || !VALIDATION_STATUSES.includes(value.validationStatus)
    || !opaqueRef(value.validationEvidenceRef, "evidence")
    || !isoInstant(value.validatedAt)
    || !REVOCATION_STATUSES.includes(value.revocationStatus)) throw contractError();
  if (value.inputBindingDigest !== inputBindingDigest) {
    throw contractError("BASELINE_SIGNOFF_CROSS_DIGEST");
  }
  if (!matrixByDecision.get(value.decisionId).requiredRoles.includes(value.role)) {
    throw contractError("BASELINE_SIGNOFF_ROLE_NOT_REQUIRED");
  }
  if (Date.parse(value.validatedAt) < Date.parse(value.signedAt)) {
    throw contractError("BASELINE_SIGNOFF_TIME_ORDER_INVALID");
  }
  if (value.revocationStatus === "ACTIVE" && value.revocationEvidenceRef !== null) {
    throw contractError();
  }
  if (value.revocationStatus === "REVOKED"
    && !opaqueRef(value.revocationEvidenceRef, "evidence")) throw contractError();
  const normalized = {
    ...clone(value),
    conditions: normalizeConditions(value.conditions, value.decision),
  };
  if (computeBaselineSignoffPayloadDigest(normalized) !== normalized.signedPayloadDigest) {
    throw contractError("BASELINE_SIGNOFF_SIGNED_PAYLOAD_DIGEST_MISMATCH");
  }
  return normalized;
}

function sortSignoffs(entries, decisionOrder, roleOrder) {
  return [...entries].sort((left, right) => (
    decisionOrder.get(left.decisionId) - decisionOrder.get(right.decisionId)
    || roleOrder.get(left.role) - roleOrder.get(right.role)
    || (left.signerRef < right.signerRef ? -1 : left.signerRef > right.signerRef ? 1 : 0)
    || (left.signoffId < right.signoffId ? -1 : left.signoffId > right.signoffId ? 1 : 0)
  ));
}

function normalizeDocument(document, manifest) {
  rejectSecretShape(document);
  if (!exactKeys(document, DOCUMENT_FIELDS)
    || document.baselineFormatVersion !== 1
    || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || document.productVersion !== PRODUCT_VERSION
    || !opaqueRef(document.baselineId, "baseline")
    || !Array.isArray(document.signoffs)
    || !isoInstant(document.createdAt)) throw contractError();

  const inputBinding = normalizeInputBinding(document.inputBinding);
  const inputBindingDigest = computeBaselineInputBindingDigest(inputBinding);
  const matrixByDecision = new Map(manifest.decisions.map((entry) => [entry.decisionId, entry]));
  const decisionOrder = new Map(manifest.decisions.map((entry, index) => [entry.decisionId, index]));
  const roleOrder = new Map(manifest.requiredRoles.map((entry, index) => [entry, index]));
  const signoffs = document.signoffs.map((entry) => (
    normalizeSignoff(entry, inputBindingDigest, matrixByDecision)
  ));
  const signoffIds = new Set();
  const signerRoleDecision = new Set();
  for (const signoff of signoffs) {
    const tuple = `${signoff.signerRef}\0${signoff.role}\0${signoff.decisionId}`;
    if (signoffIds.has(signoff.signoffId) || signerRoleDecision.has(tuple)) {
      throw contractError("BASELINE_SIGNOFF_DUPLICATE");
    }
    signoffIds.add(signoff.signoffId);
    signerRoleDecision.add(tuple);
    if (Date.parse(signoff.validatedAt) > Date.parse(document.createdAt)) {
      throw contractError("BASELINE_SIGNOFF_TIME_ORDER_INVALID");
    }
  }
  for (const policy of manifest.separationOfDuties) {
    for (const decision of manifest.decisions) {
      const protectedSignerRefs = new Set(signoffs
        .filter((entry) => entry.decisionId === decision.decisionId && entry.role === policy.role)
        .map((entry) => entry.signerRef));
      const conflict = signoffs.some((entry) => (
        entry.decisionId === decision.decisionId
        && policy.mustUseDifferentSignerFrom.includes(entry.role)
        && protectedSignerRefs.has(entry.signerRef)
      ));
      if (conflict) {
        throw contractError("BASELINE_SIGNOFF_SEPARATION_OF_DUTIES_VIOLATION");
      }
    }
  }
  return {
    ...clone(document),
    inputBinding,
    signoffs: sortSignoffs(signoffs, decisionOrder, roleOrder),
  };
}

function uniqueRoles(entries) {
  const roleOrder = new Map(REQUIRED_ROLES.map((entry, index) => [entry, index]));
  return [...new Set(entries)].sort((left, right) => roleOrder.get(left) - roleOrder.get(right));
}

function deriveClosure(document, manifest) {
  const byDecisionAndRole = new Map();
  for (const signoff of document.signoffs) {
    const key = `${signoff.decisionId}\0${signoff.role}`;
    if (!byDecisionAndRole.has(key)) byDecisionAndRole.set(key, []);
    byDecisionAndRole.get(key).push(signoff);
  }
  const decisionResults = manifest.decisions.map((entry) => {
    const missingRoles = [];
    const rejectedRoles = [];
    const conditionalOpenRoles = [];
    const invalidRoles = [];
    const revokedRoles = [];
    const uncoveredRoles = [];
    for (const role of entry.requiredRoles) {
      const signoffs = byDecisionAndRole.get(`${entry.decisionId}\0${role}`) || [];
      if (signoffs.length === 0) {
        missingRoles.push(role);
        continue;
      }
      if (signoffs.some((item) => item.decision === "REJECTED")) rejectedRoles.push(role);
      if (signoffs.some((item) => item.decision === "APPROVED_WITH_CONDITIONS"
        && item.conditions.some((condition) => condition.status !== "CLOSED"))) {
        conditionalOpenRoles.push(role);
      }
      if (signoffs.some((item) => item.validationStatus !== "VALIDATED")) invalidRoles.push(role);
      if (signoffs.some((item) => item.revocationStatus !== "ACTIVE")) revokedRoles.push(role);
      const hasValidApproval = signoffs.some((item) => (
        item.validationStatus === "VALIDATED"
        && item.revocationStatus === "ACTIVE"
        && item.decision !== "REJECTED"
        && item.conditions.every((condition) => condition.status === "CLOSED")
      ));
      if (!hasValidApproval) uncoveredRoles.push(role);
    }
    const result = {
      decisionId: entry.decisionId,
      closed: [
        missingRoles,
        rejectedRoles,
        conditionalOpenRoles,
        invalidRoles,
        revokedRoles,
        uncoveredRoles,
      ].every((items) => items.length === 0),
      missingRoles: uniqueRoles(missingRoles),
      rejectedRoles: uniqueRoles(rejectedRoles),
      conditionalOpenRoles: uniqueRoles(conditionalOpenRoles),
      invalidRoles: uniqueRoles(invalidRoles),
      revokedRoles: uniqueRoles(revokedRoles),
      uncoveredRoles: uniqueRoles(uncoveredRoles),
    };
    return deepFreeze(result);
  });
  return deepFreeze({
    derivedAllDecisionIdsClosed: decisionResults.every((entry) => entry.closed),
    decisionResults,
  });
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_FIELDS)
    || manifest.registryVersion !== 1
    || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.scope !== CONTRACT_STATUS
    || manifest.digestAlgorithm !== "SHA-256"
    || !exactKeys(manifest.canonicalization, [
      "version",
      "unicodeNormalization",
      "objectKeyOrdering",
      "numberEncoding",
      "arrayOrdering",
      "undefinedPolicy",
      "digestDomainSeparation",
    ])
    || manifest.canonicalization.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || manifest.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || manifest.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || manifest.canonicalization.undefinedPolicy !== "REJECT"
    || manifest.canonicalization.digestDomainSeparation !== "BASELINE_SIGNOFF_V1"
    || canonicalJson(manifest.inputBinding) !== canonicalJson(EXPECTED_INPUT_BINDING)
    || !sameArray(manifest.requiredRoles, REQUIRED_ROLES)
    || !sameArray(manifest.allowedDecisions, ALLOWED_DECISIONS)
    || !sameArray(manifest.allowedSignatureMethods, ALLOWED_SIGNATURE_METHODS)
    || !sameArray(manifest.validationStatuses, VALIDATION_STATUSES)
    || !sameArray(manifest.revocationStatuses, REVOCATION_STATUSES)
    || !sameArray(manifest.conditionStatuses, CONDITION_STATUSES)
    || !Array.isArray(manifest.separationOfDuties)
    || canonicalJson(manifest.separationOfDuties) !== canonicalJson(SEPARATION_OF_DUTIES)
    || !exactKeys(manifest.documentSchema, [
      "digestFieldName",
      "baselineExactFields",
      "signoffExactFields",
      "conditionExactFields",
      "signedPayloadExactFields",
      "signedConditionExactFields",
      "opaqueReferencePatterns",
    ])
    || manifest.documentSchema.digestFieldName !== "baselineDigest"
    || !sameArray(manifest.documentSchema.baselineExactFields, DOCUMENT_FIELDS)
    || !sameArray(manifest.documentSchema.signoffExactFields, SIGNOFF_FIELDS)
    || !sameArray(manifest.documentSchema.conditionExactFields, CONDITION_FIELDS)
    || !sameArray(manifest.documentSchema.signedPayloadExactFields, SIGNED_PAYLOAD_FIELDS)
    || !sameArray(manifest.documentSchema.signedConditionExactFields, SIGNED_CONDITION_FIELDS)
    || canonicalJson(manifest.documentSchema.opaqueReferencePatterns)
      !== canonicalJson(OPAQUE_REFERENCE_PATTERNS)
    || !exactKeys(manifest.authorization, [
      "runtimeAuthorized",
      "candidateCreationAuthorized",
      "deploymentAuthorized",
    ])
    || manifest.authorization.runtimeAuthorized !== false
    || manifest.authorization.candidateCreationAuthorized !== false
    || manifest.authorization.deploymentAuthorized !== false
    || !Array.isArray(manifest.decisions)
    || manifest.decisions.length !== DECISION_MATRIX.length) {
    throw contractError("BASELINE_SIGNOFF_CONTRACT_MANIFEST_INVALID");
  }
  for (let index = 0; index < DECISION_MATRIX.length; index += 1) {
    const actual = manifest.decisions[index];
    const expected = DECISION_MATRIX[index];
    if (!exactKeys(actual, ["decisionId", "requiredRoles"])
      || actual.decisionId !== expected.decisionId
      || !sameArray(actual.requiredRoles, expected.requiredRoles)) {
      throw contractError("BASELINE_SIGNOFF_CONTRACT_MANIFEST_INVALID");
    }
  }
  canonicalJson(manifest);
  return deepFreeze(clone(manifest));
}

function evaluateNormalized(document, manifest) {
  const closure = deriveClosure(document, manifest);
  return deepFreeze({
    contractStatus: CONTRACT_STATUS,
    contractVersion: CONTRACT_VERSION,
    productVersion: PRODUCT_VERSION,
    status: closure.derivedAllDecisionIdsClosed ? "BASELINE_CLOSED" : "BASELINE_OPEN",
    baselineDigest: computeBaselineSignoffDocumentDigest(document),
    inputBindingDigest: computeBaselineInputBindingDigest(document.inputBinding),
    derivedAllDecisionIdsClosed: closure.derivedAllDecisionIdsClosed,
    decisionResults: closure.decisionResults,
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
  });
}

function envelopeFor(document, evaluation) {
  return deepFreeze({
    contractStatus: CONTRACT_STATUS,
    contractVersion: CONTRACT_VERSION,
    productVersion: PRODUCT_VERSION,
    digestCanonicalizationVersion: CANONICALIZATION_VERSION,
    baselineDigest: evaluation.baselineDigest,
    inputBindingDigest: evaluation.inputBindingDigest,
    derivedAllDecisionIdsClosed: true,
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    document: deepFreeze(clone(document)),
  });
}

function verifyEnvelope(envelope, manifest) {
  if (!exactKeys(envelope, [
    "contractStatus",
    "contractVersion",
    "productVersion",
    "digestCanonicalizationVersion",
    "baselineDigest",
    "inputBindingDigest",
    "derivedAllDecisionIdsClosed",
    "runtimeAuthorized",
    "candidateCreationAuthorized",
    "deploymentAuthorized",
    "document",
  ])
    || envelope.contractStatus !== CONTRACT_STATUS
    || envelope.contractVersion !== CONTRACT_VERSION
    || envelope.productVersion !== PRODUCT_VERSION
    || envelope.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || !sha256(envelope.baselineDigest)
    || !sha256(envelope.inputBindingDigest)
    || envelope.derivedAllDecisionIdsClosed !== true
    || envelope.runtimeAuthorized !== false
    || envelope.candidateCreationAuthorized !== false
    || envelope.deploymentAuthorized !== false) {
    throw contractError("BASELINE_SIGNOFF_ENVELOPE_INVALID");
  }
  const document = normalizeDocument(envelope.document, manifest);
  if (canonicalJson(document) !== canonicalJson(envelope.document)) {
    throw contractError("BASELINE_SIGNOFF_NON_CANONICAL_DOCUMENT");
  }
  const evaluation = evaluateNormalized(document, manifest);
  if (!evaluation.derivedAllDecisionIdsClosed) {
    throw contractError("BASELINE_SIGNOFF_NOT_CLOSED");
  }
  if (evaluation.baselineDigest !== envelope.baselineDigest) {
    throw contractError("BASELINE_SIGNOFF_DIGEST_MISMATCH");
  }
  if (evaluation.inputBindingDigest !== envelope.inputBindingDigest) {
    throw contractError("BASELINE_SIGNOFF_INPUT_BINDING_MISMATCH");
  }
  return true;
}

function createBaselineSignoffContractRegistry(options = {}) {
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;
  const manifest = validateManifest(
    options.manifest || JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  );
  const registryDigest = computeBaselineSignoffContractRegistryDigest(manifest);
  const inputBindingDigest = computeBaselineInputBindingDigest(manifest.inputBinding);
  const registry = {
    describe() {
      return deepFreeze({
        contractStatus: CONTRACT_STATUS,
        contractVersion: CONTRACT_VERSION,
        productVersion: PRODUCT_VERSION,
        registryDigest,
        inputBindingDigest,
        requiredRoles: clone(manifest.requiredRoles),
        decisionMatrix: clone(manifest.decisions),
        runtimeAuthorized: false,
        candidateCreationAuthorized: false,
        deploymentAuthorized: false,
      });
    },
    evaluate(input) {
      const document = normalizeDocument(input, manifest);
      return evaluateNormalized(document, manifest);
    },
    seal(input) {
      const document = normalizeDocument(input, manifest);
      const evaluation = evaluateNormalized(document, manifest);
      if (!evaluation.derivedAllDecisionIdsClosed) {
        throw contractError("BASELINE_SIGNOFF_NOT_CLOSED");
      }
      return envelopeFor(document, evaluation);
    },
    verify(envelope) {
      return verifyEnvelope(envelope, manifest);
    },
  };
  return deepFreeze(registry);
}

let defaultRegistry;
function getDefaultBaselineSignoffContractRegistry() {
  if (!defaultRegistry) defaultRegistry = createBaselineSignoffContractRegistry();
  return defaultRegistry;
}

module.exports = {
  computeBaselineInputBindingDigest,
  computeBaselineSignoffContractRegistryDigest,
  computeBaselineSignoffDocumentDigest,
  computeBaselineSignoffPayloadDigest,
  createBaselineSignoffContractRegistry,
  getDefaultBaselineSignoffContractRegistry,
};
