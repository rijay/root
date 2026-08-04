const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "release-evidence",
  "v1.0.0.json"
);
const CONTRACT_STATUS = "NON_RUNTIME_FOUNDATION_CONTRACT";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const CONTRACT_VERSION = "1.0.0";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const DOCUMENT_TYPES = Object.freeze([
  "ADAPTER_ATTESTATION",
  "ADAPTER_REQUIREMENT_REGISTRY",
  "CANDIDATE_MANIFEST",
  "DATA_MIGRATION_ATTESTATION",
  "RELEASE_EVIDENCE_INDEX",
  "ROLLBACK_DRILL_EVIDENCE",
  "SIGNOFF_EVIDENCE",
  "UAT_EVIDENCE",
]);
const REQUIRED_ARTIFACT_MODULE_IDS = Object.freeze([
  "ADMIN",
  "BACKEND",
  "CLOUD_FUNCTION",
  "CONTENT",
  "FORMAL_ROUTES",
  "MIGRATION",
  "MINIPROGRAM",
]);
const ADAPTER_REQUIREMENT_LEVELS = Object.freeze(["REQUIRED", "OPTIONAL", "DISABLED"]);
const FORBIDDEN_SECRET_FIELD_PATTERNS = Object.freeze([
  "access[_-]?key",
  "credential",
  "key[_-]?material",
  "password",
  "private[_-]?key",
  "secret",
  "token",
]);
const CANDIDATE_FIELDS = Object.freeze([
  "adapterContractDigests",
  "adapterRequirementRegistryDigest",
  "artifactDigestByModule",
  "createdAt",
  "digestCanonicalizationVersion",
  "eventSchemaSetDigest",
  "featureFlagSnapshot",
  "manifestFormatVersion",
  "migrationSetDigest",
  "relationalSchemaDigest",
  "releaseId",
  "rollbackArtifactId",
  "formalRoutesDigest",
  "runtimeConfigDigest",
  "secretReferenceVersionDigest",
  "sourceCommit",
  "storeFormatVersion",
  "targetEnvironmentId",
]);
const ADAPTER_REQUIREMENT_REGISTRY_FIELDS = Object.freeze([
  "adapterRequirements",
  "createdAt",
  "digestCanonicalizationVersion",
  "registryFormatVersion",
  "registryId",
]);
const DATA_MIGRATION_FIELDS = Object.freeze([
  "attestationFormatVersion",
  "candidateManifestDigest",
  "createdAt",
  "digestCanonicalizationVersion",
  "lineageSummaryDigest",
  "migrationSetDigest",
  "relationalSchemaDigest",
  "releaseId",
  "rollbackDrillId",
  "runtimeConfigDigest",
  "sourceSnapshotId",
  "sourceSnapshotRevision",
  "targetEnvironmentId",
]);
const ADAPTER_ATTESTATION_FIELDS = Object.freeze([
  "adapterContractDigest",
  "adapterId",
  "adapterRequirement",
  "attestationFormatVersion",
  "candidateManifestDigest",
  "createdAt",
  "digestCanonicalizationVersion",
  "proofDigest",
  "releaseId",
  "runtimeConfigDigest",
  "secretReferenceVersionDigest",
  "targetEnvironmentId",
]);
const RELEASE_INDEX_FIELDS = Object.freeze([
  "adapterAttestationDigests",
  "candidateManifestDigest",
  "createdAt",
  "dataMigrationAttestationDigest",
  "digestCanonicalizationVersion",
  "indexFormatVersion",
  "releaseId",
  "rollbackDrillEvidenceDigest",
  "signoffEvidenceDigest",
  "targetEnvironmentId",
  "uatEvidenceDigest",
]);
const ROLLBACK_DRILL_EVIDENCE_FIELDS = Object.freeze([
  "candidateManifestDigest",
  "createdAt",
  "digestCanonicalizationVersion",
  "drillProofDigest",
  "evidenceFormatVersion",
  "releaseId",
  "rollbackArtifactId",
  "rollbackDrillId",
  "targetEnvironmentId",
]);
const SIGNOFF_EVIDENCE_FIELDS = Object.freeze([
  "candidateManifestDigest",
  "createdAt",
  "digestCanonicalizationVersion",
  "evidenceFormatVersion",
  "releaseId",
  "signoffs",
  "targetEnvironmentId",
]);
const UAT_EVIDENCE_FIELDS = Object.freeze([
  "candidateManifestDigest",
  "createdAt",
  "digestCanonicalizationVersion",
  "evidenceFormatVersion",
  "releaseId",
  "targetEnvironmentId",
  "uatProofDigest",
]);
const SIGNOFF_ROLES = Object.freeze([
  "PRODUCT",
  "OPERATIONS",
  "ENGINEERING",
  "QA",
  "PRIVACY",
  "HEALTH_CONTENT_REVIEW",
]);
const OBSERVED_CANDIDATE_FIELDS = Object.freeze([
  "adapterContractDigests",
  "adapterRequirementRegistryDigest",
  "artifactDigestByModule",
  "eventSchemaSetDigest",
  "featureFlagSnapshot",
  "migrationSetDigest",
  "relationalSchemaDigest",
  "rollbackArtifactId",
  "formalRoutesDigest",
  "runtimeConfigDigest",
  "secretReferenceVersionDigest",
  "sourceCommit",
  "storeFormatVersion",
  "targetEnvironmentId",
]);
const INVALIDATION_RULES = Object.freeze([
  Object.freeze({ ruleId: "TARGET_ENVIRONMENT_CHANGED", candidateField: "targetEnvironmentId" }),
  Object.freeze({ ruleId: "SOURCE_COMMIT_CHANGED", candidateField: "sourceCommit" }),
  Object.freeze({ ruleId: "ARTIFACT_DIGEST_CHANGED", candidateField: "artifactDigestByModule" }),
  Object.freeze({ ruleId: "STORE_FORMAT_CHANGED", candidateField: "storeFormatVersion" }),
  Object.freeze({ ruleId: "MIGRATION_SET_CHANGED", candidateField: "migrationSetDigest" }),
  Object.freeze({ ruleId: "RELATIONAL_SCHEMA_CHANGED", candidateField: "relationalSchemaDigest" }),
  Object.freeze({ ruleId: "EVENT_SCHEMA_SET_CHANGED", candidateField: "eventSchemaSetDigest" }),
  Object.freeze({ ruleId: "FORMAL_ROUTES_CHANGED", candidateField: "formalRoutesDigest" }),
  Object.freeze({ ruleId: "RUNTIME_CONFIG_CHANGED", candidateField: "runtimeConfigDigest" }),
  Object.freeze({
    ruleId: "SECRET_REFERENCE_VERSION_CHANGED",
    candidateField: "secretReferenceVersionDigest",
  }),
  Object.freeze({ ruleId: "FEATURE_FLAG_SNAPSHOT_CHANGED", candidateField: "featureFlagSnapshot" }),
  Object.freeze({ ruleId: "ADAPTER_CONTRACT_CHANGED", candidateField: "adapterContractDigests" }),
  Object.freeze({
    ruleId: "ADAPTER_REQUIREMENT_REGISTRY_CHANGED",
    candidateField: "adapterRequirementRegistryDigest",
  }),
  Object.freeze({ ruleId: "ROLLBACK_ARTIFACT_CHANGED", candidateField: "rollbackArtifactId" }),
]);
const DOCUMENT_DEFINITIONS = Object.freeze({
  ADAPTER_ATTESTATION: Object.freeze({
    fields: ADAPTER_ATTESTATION_FIELDS,
    formatField: "attestationFormatVersion",
    digestFieldName: "adapterAttestationDigest",
  }),
  ADAPTER_REQUIREMENT_REGISTRY: Object.freeze({
    fields: ADAPTER_REQUIREMENT_REGISTRY_FIELDS,
    formatField: "registryFormatVersion",
    digestFieldName: "adapterRequirementRegistryDigest",
  }),
  CANDIDATE_MANIFEST: Object.freeze({
    fields: CANDIDATE_FIELDS,
    formatField: "manifestFormatVersion",
    digestFieldName: "candidateManifestDigest",
  }),
  DATA_MIGRATION_ATTESTATION: Object.freeze({
    fields: DATA_MIGRATION_FIELDS,
    formatField: "attestationFormatVersion",
    digestFieldName: "dataMigrationAttestationDigest",
  }),
  RELEASE_EVIDENCE_INDEX: Object.freeze({
    fields: RELEASE_INDEX_FIELDS,
    formatField: "indexFormatVersion",
    digestFieldName: "releaseEvidenceIndexDigest",
  }),
  ROLLBACK_DRILL_EVIDENCE: Object.freeze({
    fields: ROLLBACK_DRILL_EVIDENCE_FIELDS,
    formatField: "evidenceFormatVersion",
    digestFieldName: "rollbackDrillEvidenceDigest",
  }),
  SIGNOFF_EVIDENCE: Object.freeze({
    fields: SIGNOFF_EVIDENCE_FIELDS,
    formatField: "evidenceFormatVersion",
    digestFieldName: "signoffEvidenceDigest",
  }),
  UAT_EVIDENCE: Object.freeze({
    fields: UAT_EVIDENCE_FIELDS,
    formatField: "evidenceFormatVersion",
    digestFieldName: "uatEvidenceDigest",
  }),
});

function contractError(code = "RELEASE_EVIDENCE_CONTRACT_INVALID") {
  const error = new Error("Release Evidence Contract Registry rejected the input");
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
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw contractError("RELEASE_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw contractError("RELEASE_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw contractError("RELEASE_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) throw contractError("RELEASE_EVIDENCE_CANONICALIZATION_REJECTED");
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

function computeReleaseEvidenceContractRegistryDigest(manifest) {
  return digest("myroot-release-evidence-contract-registry:v1", manifest);
}

function computeReleaseEvidenceDocumentDigest(documentType, document) {
  if (!DOCUMENT_TYPES.includes(documentType)) throw contractError();
  return digest(`myroot-release-evidence-document:${documentType}:v1`, document);
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

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && !highConfidenceSecretText(value);
}

function releaseIdentifier(value) {
  return opaqueAscii(value, 128);
}

function environmentIdentifier(value) {
  return exactText(value, 128) && /^[a-z0-9][a-z0-9._:-]*$/.test(value)
    && !highConfidenceSecretText(value);
}

function adapterIdentifier(value) {
  return exactText(value, 128) && /^[a-z0-9][a-z0-9-]*$/.test(value)
    && !highConfidenceSecretText(value);
}

function isoInstant(value) {
  return exactText(value, 24)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function sha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function contentAddress(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function rejectSecretShape(value, keyPath = []) {
  if (highConfidenceSecretText(value)) {
    throw contractError("RELEASE_EVIDENCE_SECRET_SHAPE_REJECTED");
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretShape(entry, [...keyPath, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (!plainRecord(value)) throw contractError();
  for (const [key, nested] of Object.entries(value)) {
    const allowed = key === "secretReferenceVersionDigest";
    if (!allowed && /(?:access[_-]?key|credential|key[_-]?material|password|private[_-]?key|secret|token)/i.test(key)) {
      throw contractError("RELEASE_EVIDENCE_SECRET_SHAPE_REJECTED");
    }
    rejectSecretShape(nested, [...keyPath, key]);
  }
}

function assertUniqueSorted(entries, key, options = {}) {
  if (!Array.isArray(entries) || (options.nonEmpty && entries.length === 0)) throw contractError();
  const sorted = [...entries].sort((left, right) => (
    left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0
  ));
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index - 1][key] === sorted[index][key]) throw contractError();
  }
  return sorted;
}

function normalizeArtifacts(entries) {
  if (!Array.isArray(entries) || entries.length !== REQUIRED_ARTIFACT_MODULE_IDS.length) {
    throw contractError();
  }
  const normalized = entries.map((entry) => {
    if (!exactKeys(entry, ["moduleId", "artifactDigest"]) || !opaqueAscii(entry.moduleId, 64)
      || !sha256(entry.artifactDigest)) throw contractError();
    return { moduleId: entry.moduleId, artifactDigest: entry.artifactDigest };
  });
  const sorted = assertUniqueSorted(normalized, "moduleId", { nonEmpty: true });
  if (sorted.map((entry) => entry.moduleId).join("\0") !== REQUIRED_ARTIFACT_MODULE_IDS.join("\0")) {
    throw contractError();
  }
  return sorted;
}

function normalizeFeatureFlags(entries) {
  if (!Array.isArray(entries)) throw contractError();
  const normalized = entries.map((entry) => {
    if (!exactKeys(entry, ["flagId", "enabled"]) || !opaqueAscii(entry.flagId, 128)
      || typeof entry.enabled !== "boolean") throw contractError();
    return { flagId: entry.flagId, enabled: entry.enabled };
  });
  return assertUniqueSorted(normalized, "flagId");
}

function normalizeAdapterContracts(entries) {
  if (!Array.isArray(entries)) throw contractError();
  const normalized = entries.map((entry) => {
    if (!exactKeys(entry, ["adapterId", "requirement", "adapterContractDigest"])
      || !adapterIdentifier(entry.adapterId)
      || !ADAPTER_REQUIREMENT_LEVELS.includes(entry.requirement)
      || !sha256(entry.adapterContractDigest)) throw contractError();
    return {
      adapterId: entry.adapterId,
      requirement: entry.requirement,
      adapterContractDigest: entry.adapterContractDigest,
    };
  });
  const sorted = assertUniqueSorted(normalized, "adapterId", { nonEmpty: true });
  if (!sorted.some((entry) => entry.requirement === "REQUIRED")) throw contractError();
  return sorted;
}

function normalizeAdapterAttestationDigests(entries) {
  if (!Array.isArray(entries)) throw contractError();
  const normalized = entries.map((entry) => {
    if (!exactKeys(entry, ["adapterId", "adapterAttestationDigest"])
      || !adapterIdentifier(entry.adapterId) || !sha256(entry.adapterAttestationDigest)) {
      throw contractError();
    }
    return {
      adapterId: entry.adapterId,
      adapterAttestationDigest: entry.adapterAttestationDigest,
    };
  });
  return assertUniqueSorted(normalized, "adapterId", { nonEmpty: true });
}

function assertFoundationCommon(document, fields, formatField) {
  rejectSecretShape(document);
  if (!exactKeys(document, fields) || document[formatField] !== 1
    || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || !releaseIdentifier(document.releaseId)
    || !environmentIdentifier(document.targetEnvironmentId)
    || !isoInstant(document.createdAt)) throw contractError();
}

function normalizeCandidate(document) {
  assertFoundationCommon(document, CANDIDATE_FIELDS, "manifestFormatVersion");
  if (!SOURCE_COMMIT_PATTERN.test(document.sourceCommit)
    || !opaqueAscii(document.storeFormatVersion, 64)
    || !contentAddress(document.rollbackArtifactId)
    || ![
      document.adapterRequirementRegistryDigest,
      document.migrationSetDigest,
      document.relationalSchemaDigest,
      document.eventSchemaSetDigest,
      document.formalRoutesDigest,
      document.runtimeConfigDigest,
      document.secretReferenceVersionDigest,
    ].every(sha256)) throw contractError();
  return {
    ...clone(document),
    artifactDigestByModule: normalizeArtifacts(document.artifactDigestByModule),
    featureFlagSnapshot: normalizeFeatureFlags(document.featureFlagSnapshot),
    adapterContractDigests: normalizeAdapterContracts(document.adapterContractDigests),
  };
}

function normalizeAdapterRequirementRegistry(document) {
  rejectSecretShape(document);
  if (!exactKeys(document, ADAPTER_REQUIREMENT_REGISTRY_FIELDS)
    || document.registryFormatVersion !== 1
    || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || !opaqueAscii(document.registryId, 128)
    || !isoInstant(document.createdAt)) throw contractError();
  return {
    ...clone(document),
    adapterRequirements: normalizeAdapterContracts(document.adapterRequirements),
  };
}

function normalizeDataMigrationAttestation(document) {
  assertFoundationCommon(document, DATA_MIGRATION_FIELDS, "attestationFormatVersion");
  if (!sha256(document.candidateManifestDigest) || !sha256(document.runtimeConfigDigest)
    || !opaqueAscii(document.sourceSnapshotId, 128)
    || !opaqueAscii(document.sourceSnapshotRevision, 128)
    || !sha256(document.migrationSetDigest) || !sha256(document.relationalSchemaDigest)
    || !sha256(document.lineageSummaryDigest) || !opaqueAscii(document.rollbackDrillId, 128)) {
    throw contractError();
  }
  return clone(document);
}

function normalizeAdapterAttestation(document) {
  assertFoundationCommon(document, ADAPTER_ATTESTATION_FIELDS, "attestationFormatVersion");
  if (!sha256(document.candidateManifestDigest) || !adapterIdentifier(document.adapterId)
    || !["REQUIRED", "OPTIONAL"].includes(document.adapterRequirement)
    || !sha256(document.adapterContractDigest) || !sha256(document.runtimeConfigDigest)
    || !sha256(document.secretReferenceVersionDigest) || !sha256(document.proofDigest)) {
    throw contractError();
  }
  return clone(document);
}

function normalizeReleaseEvidenceIndex(document) {
  assertFoundationCommon(document, RELEASE_INDEX_FIELDS, "indexFormatVersion");
  if (!sha256(document.candidateManifestDigest)
    || !sha256(document.dataMigrationAttestationDigest)
    || !sha256(document.uatEvidenceDigest)
    || !sha256(document.rollbackDrillEvidenceDigest)
    || !sha256(document.signoffEvidenceDigest)) throw contractError();
  return {
    ...clone(document),
    adapterAttestationDigests: normalizeAdapterAttestationDigests(
      document.adapterAttestationDigests
    ),
  };
}

function normalizeUatEvidence(document) {
  assertFoundationCommon(document, UAT_EVIDENCE_FIELDS, "evidenceFormatVersion");
  if (!sha256(document.candidateManifestDigest) || !sha256(document.uatProofDigest)) {
    throw contractError();
  }
  return clone(document);
}

function normalizeRollbackDrillEvidence(document) {
  assertFoundationCommon(document, ROLLBACK_DRILL_EVIDENCE_FIELDS, "evidenceFormatVersion");
  if (!sha256(document.candidateManifestDigest) || !sha256(document.drillProofDigest)
    || !opaqueAscii(document.rollbackDrillId, 128)
    || !contentAddress(document.rollbackArtifactId)) throw contractError();
  return clone(document);
}

function normalizeSignoffs(entries) {
  if (!Array.isArray(entries) || entries.length !== SIGNOFF_ROLES.length) throw contractError();
  const byRole = new Map();
  for (const entry of entries) {
    rejectSecretShape(entry);
    if (!exactKeys(entry, ["role", "decision", "signedByActorId", "signedAt", "signatureDigest"])
      || !SIGNOFF_ROLES.includes(entry.role) || entry.decision !== "APPROVED"
      || !opaqueAscii(entry.signedByActorId, 128) || !isoInstant(entry.signedAt)
      || !sha256(entry.signatureDigest) || byRole.has(entry.role)) throw contractError();
    byRole.set(entry.role, clone(entry));
  }
  if (SIGNOFF_ROLES.some((role) => !byRole.has(role))) throw contractError();
  return SIGNOFF_ROLES.map((role) => byRole.get(role));
}

function normalizeSignoffEvidence(document) {
  assertFoundationCommon(document, SIGNOFF_EVIDENCE_FIELDS, "evidenceFormatVersion");
  if (!sha256(document.candidateManifestDigest)) throw contractError();
  const signoffs = normalizeSignoffs(document.signoffs);
  const createdAt = Date.parse(document.createdAt);
  if (signoffs.some((entry) => Date.parse(entry.signedAt) > createdAt)) throw contractError();
  return { ...clone(document), signoffs };
}

function normalizeDocument(documentType, document) {
  if (!plainRecord(document)) throw contractError();
  if (documentType === "ADAPTER_REQUIREMENT_REGISTRY") {
    return normalizeAdapterRequirementRegistry(document);
  }
  if (documentType === "CANDIDATE_MANIFEST") return normalizeCandidate(document);
  if (documentType === "DATA_MIGRATION_ATTESTATION") {
    return normalizeDataMigrationAttestation(document);
  }
  if (documentType === "ADAPTER_ATTESTATION") return normalizeAdapterAttestation(document);
  if (documentType === "RELEASE_EVIDENCE_INDEX") return normalizeReleaseEvidenceIndex(document);
  if (documentType === "ROLLBACK_DRILL_EVIDENCE") return normalizeRollbackDrillEvidence(document);
  if (documentType === "SIGNOFF_EVIDENCE") return normalizeSignoffEvidence(document);
  if (documentType === "UAT_EVIDENCE") return normalizeUatEvidence(document);
  throw contractError();
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, [
    "registryVersion", "contractVersion", "scope", "digestAlgorithm", "canonicalization",
    "sameSourceFields", "requiredArtifactModuleIds", "adapterRequirementLevels",
    "requiredSignoffRoles", "documents", "secretPolicy", "invalidationRules",
  ]) || manifest.registryVersion !== 1 || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.scope !== CONTRACT_STATUS || manifest.digestAlgorithm !== "SHA-256"
    || !exactKeys(manifest.canonicalization, [
      "version", "unicodeNormalization", "objectKeyOrdering", "numberEncoding",
      "arrayOrdering", "undefinedPolicy", "digestDomainSeparation",
    ]) || manifest.canonicalization.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || manifest.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || manifest.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || manifest.canonicalization.undefinedPolicy !== "REJECT"
    || manifest.canonicalization.digestDomainSeparation !== "DOCUMENT_TYPE_V1"
    || !Array.isArray(manifest.sameSourceFields) || manifest.sameSourceFields.join("\0")
      !== ["releaseId", "candidateManifestDigest", "targetEnvironmentId"].join("\0")
    || !Array.isArray(manifest.requiredArtifactModuleIds)
    || manifest.requiredArtifactModuleIds.join("\0") !== REQUIRED_ARTIFACT_MODULE_IDS.join("\0")
    || !Array.isArray(manifest.adapterRequirementLevels)
    || manifest.adapterRequirementLevels.join("\0") !== ADAPTER_REQUIREMENT_LEVELS.join("\0")
    || !Array.isArray(manifest.requiredSignoffRoles)
    || manifest.requiredSignoffRoles.join("\0") !== SIGNOFF_ROLES.join("\0")
    || !Array.isArray(manifest.documents) || manifest.documents.length !== DOCUMENT_TYPES.length) {
    throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
  }
  const documentOrder = manifest.documents.map((entry) => entry.documentType);
  const byType = new Map(manifest.documents.map((entry) => [entry.documentType, entry]));
  if (byType.size !== DOCUMENT_TYPES.length
    || documentOrder.join("\0") !== DOCUMENT_TYPES.join("\0")) {
    throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
  }
  for (const documentType of DOCUMENT_TYPES) {
    const entry = byType.get(documentType);
    const expected = DOCUMENT_DEFINITIONS[documentType];
    if (!entry || !exactKeys(entry, [
      "documentType", "formatVersionField", "formatVersion", "digestFieldName", "exactFields",
    ]) || entry.formatVersionField !== expected.formatField || entry.formatVersion !== 1
      || entry.digestFieldName !== expected.digestFieldName
      || entry.exactFields.join("\0") !== expected.fields.join("\0")) {
      throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
    }
  }
  if (!exactKeys(manifest.secretPolicy, [
    "allowedReferenceDigestFields", "forbiddenFieldNamePatterns",
  ]) || manifest.secretPolicy.allowedReferenceDigestFields.join("\0")
    !== "secretReferenceVersionDigest"
    || !Array.isArray(manifest.secretPolicy.forbiddenFieldNamePatterns)
    || manifest.secretPolicy.forbiddenFieldNamePatterns.join("\0")
      !== FORBIDDEN_SECRET_FIELD_PATTERNS.join("\0")
    || !Array.isArray(manifest.invalidationRules)
    || canonicalJson(manifest.invalidationRules) !== canonicalJson(INVALIDATION_RULES)) {
    throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
  }
  const invalidationFields = manifest.invalidationRules.map((entry) => {
    if (!exactKeys(entry, ["ruleId", "candidateField"]) || !opaqueAscii(entry.ruleId, 96)
      || !OBSERVED_CANDIDATE_FIELDS.includes(entry.candidateField)) {
      throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
    }
    return entry.candidateField;
  });
  if (new Set(invalidationFields).size !== OBSERVED_CANDIDATE_FIELDS.length) {
    throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID");
  }
  canonicalJson(manifest);
  return deepFreeze(clone(manifest));
}

function envelopeFor(documentType, document) {
  const definition = DOCUMENT_DEFINITIONS[documentType];
  return deepFreeze({
    contractStatus: CONTRACT_STATUS,
    contractVersion: CONTRACT_VERSION,
    documentType,
    digestCanonicalizationVersion: CANONICALIZATION_VERSION,
    digestFieldName: definition.digestFieldName,
    digest: computeReleaseEvidenceDocumentDigest(documentType, document),
    document: deepFreeze(clone(document)),
  });
}

function verifyEnvelope(envelope) {
  if (!exactKeys(envelope, [
    "contractStatus", "contractVersion", "documentType", "digestCanonicalizationVersion",
    "digestFieldName", "digest", "document",
  ]) || envelope.contractStatus !== CONTRACT_STATUS || envelope.contractVersion !== CONTRACT_VERSION
    || !DOCUMENT_TYPES.includes(envelope.documentType)
    || envelope.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || envelope.digestFieldName !== DOCUMENT_DEFINITIONS[envelope.documentType].digestFieldName
    || !sha256(envelope.digest)) throw contractError("RELEASE_EVIDENCE_ENVELOPE_INVALID");
  const normalized = normalizeDocument(envelope.documentType, envelope.document);
  if (canonicalJson(normalized) !== canonicalJson(envelope.document)) {
    throw contractError("RELEASE_EVIDENCE_NON_CANONICAL_DOCUMENT");
  }
  if (computeReleaseEvidenceDocumentDigest(envelope.documentType, envelope.document)
    !== envelope.digest) throw contractError("RELEASE_EVIDENCE_DIGEST_MISMATCH");
  return true;
}

function sameSource(candidate, document, candidateDigest) {
  return document.releaseId === candidate.releaseId
    && document.targetEnvironmentId === candidate.targetEnvironmentId
    && document.candidateManifestDigest === candidateDigest;
}

function normalizeObservedCandidate(candidate, observed) {
  rejectSecretShape(observed);
  if (!exactKeys(observed, OBSERVED_CANDIDATE_FIELDS)) throw contractError();
  const synthetic = normalizeCandidate({
    manifestFormatVersion: 1,
    digestCanonicalizationVersion: CANONICALIZATION_VERSION,
    releaseId: candidate.releaseId,
    createdAt: candidate.createdAt,
    ...clone(observed),
  });
  return Object.fromEntries(OBSERVED_CANDIDATE_FIELDS.map((field) => [field, synthetic[field]]));
}

function createReleaseEvidenceContractRegistry(options = {}) {
  if (!plainRecord(options) || Object.keys(options).some((key) => key !== "manifest")) {
    throw contractError();
  }
  let source;
  try {
    source = options.manifest === undefined
      ? JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"))
      : clone(options.manifest);
  } catch {
    throw contractError("RELEASE_EVIDENCE_CONTRACT_MANIFEST_UNAVAILABLE");
  }
  const manifest = validateManifest(source);
  const registryDigest = computeReleaseEvidenceContractRegistryDigest(manifest);

  const registry = {
    assertReady() {
      return deepFreeze({
        foundationContractReady: true,
        contractStatus: CONTRACT_STATUS,
        authoritativeAdapterRequirementRegistryReady: false,
        runtimeAuthorized: false,
        candidateCreationAuthorized: false,
        releaseIdGenerationAuthorized: false,
      });
    },
    describe() {
      return deepFreeze({
        contractStatus: CONTRACT_STATUS,
        contractVersion: CONTRACT_VERSION,
        registryDigest,
        digestAlgorithm: manifest.digestAlgorithm,
        digestCanonicalizationVersion: CANONICALIZATION_VERSION,
        documentTypes: clone(DOCUMENT_TYPES),
        requiredArtifactModuleIds: clone(REQUIRED_ARTIFACT_MODULE_IDS),
        requiredSignoffRoles: clone(SIGNOFF_ROLES),
        authoritativeAdapterRequirementRegistryBundled: false,
      });
    },
    seal(documentType, input) {
      rejectSecretShape(input);
      const document = normalizeDocument(documentType, input);
      return envelopeFor(documentType, document);
    },
    verify(envelope) {
      return verifyEnvelope(envelope);
    },
    verifyEvidenceSet(input) {
      if (!exactKeys(input, [
        "adapterAttestations", "adapterRequirementRegistry", "candidateManifest",
        "dataMigrationAttestation", "releaseEvidenceIndex", "rollbackDrillEvidence",
        "signoffEvidence", "uatEvidence",
      ]) || !Array.isArray(input.adapterAttestations)) throw contractError();
      verifyEnvelope(input.adapterRequirementRegistry);
      verifyEnvelope(input.candidateManifest);
      verifyEnvelope(input.dataMigrationAttestation);
      verifyEnvelope(input.releaseEvidenceIndex);
      verifyEnvelope(input.rollbackDrillEvidence);
      verifyEnvelope(input.signoffEvidence);
      verifyEnvelope(input.uatEvidence);
      input.adapterAttestations.forEach(verifyEnvelope);
      if (input.adapterRequirementRegistry.documentType !== "ADAPTER_REQUIREMENT_REGISTRY"
        || input.candidateManifest.documentType !== "CANDIDATE_MANIFEST"
        || input.dataMigrationAttestation.documentType !== "DATA_MIGRATION_ATTESTATION"
        || input.releaseEvidenceIndex.documentType !== "RELEASE_EVIDENCE_INDEX"
        || input.rollbackDrillEvidence.documentType !== "ROLLBACK_DRILL_EVIDENCE"
        || input.signoffEvidence.documentType !== "SIGNOFF_EVIDENCE"
        || input.uatEvidence.documentType !== "UAT_EVIDENCE"
        || input.adapterAttestations.some((entry) => entry.documentType !== "ADAPTER_ATTESTATION")) {
        throw contractError("RELEASE_EVIDENCE_DOCUMENT_TYPE_MISMATCH");
      }
      const requirementEnvelope = input.adapterRequirementRegistry;
      const requirementRegistry = requirementEnvelope.document;
      const candidateEnvelope = input.candidateManifest;
      const candidate = candidateEnvelope.document;
      const migrationEnvelope = input.dataMigrationAttestation;
      const migration = migrationEnvelope.document;
      const rollbackEnvelope = input.rollbackDrillEvidence;
      const rollback = rollbackEnvelope.document;
      const signoffEnvelope = input.signoffEvidence;
      const signoff = signoffEnvelope.document;
      const uatEnvelope = input.uatEvidence;
      const uat = uatEnvelope.document;
      const index = input.releaseEvidenceIndex.document;
      if (candidate.adapterRequirementRegistryDigest !== requirementEnvelope.digest
        || canonicalJson(candidate.adapterContractDigests)
          !== canonicalJson(requirementRegistry.adapterRequirements)) {
        throw contractError("RELEASE_EVIDENCE_ADAPTER_REQUIREMENT_REGISTRY_MISMATCH");
      }
      if (!sameSource(candidate, migration, candidateEnvelope.digest)
        || !sameSource(candidate, rollback, candidateEnvelope.digest)
        || !sameSource(candidate, signoff, candidateEnvelope.digest)
        || !sameSource(candidate, uat, candidateEnvelope.digest)
        || !sameSource(candidate, index, candidateEnvelope.digest)
        || migration.runtimeConfigDigest !== candidate.runtimeConfigDigest
        || migration.migrationSetDigest !== candidate.migrationSetDigest
        || migration.relationalSchemaDigest !== candidate.relationalSchemaDigest
        || migration.rollbackDrillId !== rollback.rollbackDrillId
        || rollback.rollbackArtifactId !== candidate.rollbackArtifactId) {
        throw contractError("RELEASE_EVIDENCE_SAME_SOURCE_MISMATCH");
      }
      if (index.dataMigrationAttestationDigest !== migrationEnvelope.digest
        || index.rollbackDrillEvidenceDigest !== rollbackEnvelope.digest
        || index.signoffEvidenceDigest !== signoffEnvelope.digest
        || index.uatEvidenceDigest !== uatEnvelope.digest) {
        throw contractError("RELEASE_EVIDENCE_INDEX_DIGEST_MISMATCH");
      }
      const candidateCreatedAt = Date.parse(candidate.createdAt);
      const evidenceEnvelopes = [
        migrationEnvelope,
        ...input.adapterAttestations,
        rollbackEnvelope,
        signoffEnvelope,
        uatEnvelope,
      ];
      if (Date.parse(requirementRegistry.createdAt) > candidateCreatedAt
        || evidenceEnvelopes.some((envelope) => Date.parse(envelope.document.createdAt)
          < candidateCreatedAt)
        || signoff.signoffs.some((entry) => Date.parse(entry.signedAt) < candidateCreatedAt)
        || evidenceEnvelopes.some((envelope) => Date.parse(index.createdAt)
          < Date.parse(envelope.document.createdAt))) {
        throw contractError("RELEASE_EVIDENCE_TIME_ORDER_INVALID");
      }
      const contracts = new Map(
        requirementRegistry.adapterRequirements.map((entry) => [entry.adapterId, entry])
      );
      const attestations = new Map();
      for (const envelope of input.adapterAttestations) {
        const attestation = envelope.document;
        const contract = contracts.get(attestation.adapterId);
        if (attestations.has(attestation.adapterId) || !contract || contract.requirement === "DISABLED"
          || attestation.adapterRequirement !== contract.requirement
          || attestation.adapterContractDigest !== contract.adapterContractDigest
          || attestation.runtimeConfigDigest !== candidate.runtimeConfigDigest
          || attestation.secretReferenceVersionDigest !== candidate.secretReferenceVersionDigest
          || !sameSource(candidate, attestation, candidateEnvelope.digest)) {
          throw contractError("RELEASE_EVIDENCE_ADAPTER_ATTESTATION_MISMATCH");
        }
        attestations.set(attestation.adapterId, envelope);
      }
      const requiredIds = requirementRegistry.adapterRequirements
        .filter((entry) => entry.requirement === "REQUIRED").map((entry) => entry.adapterId);
      const missingRequiredAdapterIds = requiredIds.filter((adapterId) => !attestations.has(adapterId));
      if (missingRequiredAdapterIds.length > 0) {
        throw contractError("RELEASE_EVIDENCE_REQUIRED_ADAPTER_ATTESTATION_MISSING");
      }
      if (index.adapterAttestationDigests.length !== attestations.size) {
        throw contractError("RELEASE_EVIDENCE_INDEX_INCOMPLETE");
      }
      for (const reference of index.adapterAttestationDigests) {
        const envelope = attestations.get(reference.adapterId);
        if (!envelope || envelope.digest !== reference.adapterAttestationDigest) {
          throw contractError("RELEASE_EVIDENCE_INDEX_DIGEST_MISMATCH");
        }
      }
      return deepFreeze({
        status: "VERIFIED_NON_RUNTIME_FOUNDATION_EVIDENCE_SET",
        runtimeAuthorized: false,
        releaseId: candidate.releaseId,
        candidateManifestDigest: candidateEnvelope.digest,
        targetEnvironmentId: candidate.targetEnvironmentId,
        adapterRequirementRegistryDigest: requirementEnvelope.digest,
        requiredAdapterCount: requiredIds.length,
        adapterAttestationCount: attestations.size,
      });
    },
    assessInvalidation(input) {
      if (!exactKeys(input, ["candidateManifest", "observedCandidateFingerprint"])) {
        throw contractError();
      }
      verifyEnvelope(input.candidateManifest);
      if (input.candidateManifest.documentType !== "CANDIDATE_MANIFEST") {
        throw contractError("RELEASE_EVIDENCE_DOCUMENT_TYPE_MISMATCH");
      }
      const candidate = input.candidateManifest.document;
      const observed = normalizeObservedCandidate(candidate, input.observedCandidateFingerprint);
      const changes = manifest.invalidationRules.filter((rule) => (
        canonicalJson(candidate[rule.candidateField]) !== canonicalJson(observed[rule.candidateField])
      )).map((rule) => ({
        ruleId: rule.ruleId,
        candidateField: rule.candidateField,
      }));
      return deepFreeze({
        contractStatus: CONTRACT_STATUS,
        invalidated: changes.length > 0,
        requiresNewReleaseId: changes.length > 0,
        priorReleaseId: candidate.releaseId,
        candidateManifestDigest: input.candidateManifest.digest,
        changes,
      });
    },
  };
  return deepFreeze(registry);
}

let defaultRegistry;
function getDefaultReleaseEvidenceContractRegistry() {
  if (!defaultRegistry) defaultRegistry = createReleaseEvidenceContractRegistry();
  return defaultRegistry;
}

module.exports = {
  computeReleaseEvidenceContractRegistryDigest,
  computeReleaseEvidenceDocumentDigest,
  createReleaseEvidenceContractRegistry,
  getDefaultReleaseEvidenceContractRegistry,
};
