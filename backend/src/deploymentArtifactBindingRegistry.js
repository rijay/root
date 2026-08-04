const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalJson,
} = require("../../scripts/build-candidate-provenance");
const {
  getDefaultReleaseEvidenceContractRegistry,
} = require("./releaseEvidenceContractRegistry");

// This Registry Module validates one local, non-runtime Interface. Its
// Implementation never dereferences a remote evidence ref and never grants
// Candidate, deployment, attestation, or Gate authority.

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "deployment-artifact-binding",
  "v1.0.0.json"
);
const DEFAULT_SOURCE_PROVENANCE_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "artifact-provenance",
  "v1.0.0.json"
);

const CONTRACT_VERSION = "1.0.0";
const PRODUCT_VERSION = "v1.0.0";
const BUILD_VERSION = "0.5.13";
const CONTRACT_STATUS = "NON_RUNTIME_DEPLOYMENT_ARTIFACT_BINDING_STRUCTURE_VALIDATION";
const SOURCE_PROVENANCE_EVIDENCE_CLASS = "SOURCE_PROVENANCE_ONLY";
const VALIDATION_LEVEL = "STRUCTURE_ONLY_UNTRUSTED_INPUT";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const SOURCE_PROVENANCE_PAYLOAD_DIGEST_DOMAIN = "myroot-candidate-provenance-payload:v1";
const CLOUD_FUNCTION_SET_DIGEST_DOMAIN =
  "myroot-deployment-artifact-binding-cloud-function-set:v1";
const BINDING_PAYLOAD_DIGEST_DOMAIN = "myroot-deployment-artifact-binding-payload:v1";
const MAX_VALIDITY_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const REQUIRED_MODULE_IDS = Object.freeze([
  "ADMIN",
  "BACKEND",
  "CLOUD_FUNCTION",
  "CONTENT",
  "FORMAL_ROUTES",
  "MIGRATION",
  "MINIPROGRAM",
]);
const ARTIFACT_KIND_BY_MODULE = Object.freeze({
  ADMIN: "STATIC_ADMIN_BUNDLE_SHA256_V1",
  BACKEND: "OCI_IMAGE_SHA256_V1",
  CLOUD_FUNCTION: "CLOUD_FUNCTION_ARCHIVE_SET_SHA256_V1",
  CONTENT: "CONTENT_SET_SHA256_V1",
  MIGRATION: "MIGRATION_SET_SHA256_V1",
  MINIPROGRAM: "WECHAT_UPLOAD_PACKAGE_SHA256_V1",
  FORMAL_ROUTES: "FORMAL_ROUTES_BUNDLE_SHA256_V1",
});
const ARTIFACT_KINDS = Object.freeze(REQUIRED_MODULE_IDS.map((moduleId) => Object.freeze({
  moduleId,
  artifactKind: ARTIFACT_KIND_BY_MODULE[moduleId],
})));
const REQUIRED_CLOUD_FUNCTION_KEYS = Object.freeze([
  "MYROOT_HEALTH_RETENTION",
  "MYROOT_JOB_DISPATCHER",
]);
const REQUIRED_SIGNOFF_ROLES = Object.freeze([
  "ENGINEERING",
  "QA",
  "PLATFORM_SECURITY",
]);
const SIGNATURE_METHODS = Object.freeze([
  "CONTROLLED_APPROVAL_RECORD_V1",
  "DETACHED_DIGITAL_SIGNATURE_V1",
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  deploymentAuthorized: false,
  attestationAuthorized: false,
  platformMutationAuthorized: false,
  gateClosureAuthorized: false,
});

const DOCUMENT_FIELDS = Object.freeze([
  "recordType",
  "bindingFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "buildVersion",
  "sourceCommit",
  "sourceProvenancePayloadDigest",
  "candidateManifestDigest",
  "releaseId",
  "targetEnvironmentRef",
  "modules",
  "revocationSnapshotDigest",
  "validFrom",
  "validUntil",
  "collectedAt",
  "revocationStatus",
  "revokedAt",
  "revocationEvidenceRef",
  "signoffs",
]);
const MODULE_BASE_FIELDS = Object.freeze([
  "moduleId",
  "sourceArtifactDigest",
  "deploymentArtifactDigest",
  "artifactKind",
  "remoteReadbackEvidenceRef",
  "platformBinding",
]);
const PLATFORM_BINDING_FIELDS = Object.freeze([
  "platformSubjectRef",
  "platformRevisionRef",
  "readbackSubjectRef",
  "readbackRevisionRef",
  "readbackArtifactDigest",
  "observedAt",
]);
const BACKEND_FIELDS = Object.freeze([
  "ociImageDigest",
  "runtimeReadbackImageDigest",
]);
const MINIPROGRAM_FIELDS = Object.freeze([
  "uploadPackageDigest",
  "uploadVersion",
  "platformUploadReceiptRef",
]);
const CLOUD_FUNCTIONS_FIELDS = Object.freeze(["functions"]);
const CLOUD_FUNCTION_FIELDS = Object.freeze([
  "functionKey",
  "archiveDigest",
  "platformSubjectRef",
  "platformRevisionRef",
  "readbackSubjectRef",
  "readbackRevisionRef",
  "readbackArchiveDigest",
  "platformUploadReceiptRef",
  "remoteReadbackEvidenceRef",
  "observedAt",
]);
const SIGNOFF_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "bindingPayloadDigest",
  "decision",
  "signedAt",
  "validUntil",
  "signatureMethod",
  "signedPayloadDigest",
  "signatureDigest",
  "validatorRef",
  "validationStatus",
  "validationEvidenceRef",
  "revocationStatus",
  "revokedAt",
  "revocationEvidenceRef",
]);
const SIGNED_PAYLOAD_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "bindingPayloadDigest",
  "decision",
  "signedAt",
  "validUntil",
  "signatureMethod",
]);

const SOURCE_PAYLOAD_FIELDS = Object.freeze([
  "schemaVersion",
  "contractStatus",
  "digestCanonicalizationVersion",
  "sourceCommit",
  "sourceSet",
  "artifactDigestByModule",
  "sourceArchive",
  "governanceDigestSet",
]);
const SOURCE_SET_FIELDS = Object.freeze(["fileCount", "totalBytes", "manifestSha256"]);
const SOURCE_MODULE_FIELDS = Object.freeze([
  "moduleId",
  "artifactKind",
  "fileCount",
  "totalBytes",
  "artifactDigest",
]);
const SOURCE_ARCHIVE_FIELDS = Object.freeze([
  "format",
  "fileName",
  "bytes",
  "entryCount",
  "sha256",
]);
const GOVERNANCE_REF_FIELDS = Object.freeze(["refId", "path", "sha256"]);

const MANIFEST_FIELDS = Object.freeze([
  "registryVersion",
  "contractVersion",
  "productVersion",
  "buildVersion",
  "scope",
  "sourceProvenanceEvidenceClass",
  "validationLevel",
  "digestAlgorithm",
  "canonicalization",
  "requiredArtifactModuleIds",
  "artifactKinds",
  "requiredCloudFunctionKeys",
  "requiredSignoffRoles",
  "allowedSignatureMethods",
  "maxValidityDays",
  "recordSchema",
  "authorization",
]);
const CANONICALIZATION_FIELDS = Object.freeze([
  "version",
  "unicodeNormalization",
  "objectKeyOrdering",
  "numberEncoding",
  "arrayOrdering",
  "undefinedPolicy",
  "digestDomainSeparation",
  "sourceProvenancePayloadDigestDomain",
  "cloudFunctionSetDigestDomain",
  "bindingPayloadDigestDomain",
]);
const RECORD_SCHEMA_FIELDS = Object.freeze([
  "documentExactFields",
  "moduleBaseExactFields",
  "platformBindingExactFields",
  "backendExactFields",
  "miniprogramExactFields",
  "cloudFunctionsExactFields",
  "cloudFunctionExactFields",
  "signoffExactFields",
  "opaqueReferencePatterns",
]);

const OPAQUE_PATTERNS = Object.freeze({
  release: /^release:sha256:[a-f0-9]{64}$/,
  environment: /^environment:sha256:[a-f0-9]{64}$/,
  subject: /^subject:sha256:[a-f0-9]{64}$/,
  revision: /^revision:sha256:[a-f0-9]{64}$/,
  evidence: /^evidence:sha256:[a-f0-9]{64}$/,
  receipt: /^receipt:sha256:[a-f0-9]{64}$/,
  signoff: /^signoff:sha256:[a-f0-9]{64}$/,
  actor: /^actor:sha256:[a-f0-9]{64}$/,
  validator: /^validator:sha256:[a-f0-9]{64}$/,
});
const OPAQUE_PATTERN_SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(OPAQUE_PATTERNS).map(([key, value]) => [key, value.source])
));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OCI_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLACEHOLDER_DIGESTS = new Set(
  ["", "pending", "tbd", "todo", "placeholder", "example", "dummy", "unknown", "not set"]
    .map((value) => crypto.createHash("sha256").update(value).digest("hex"))
);
const FORBIDDEN_FIELD_PATTERN = /(?:url|uri|endpoint|accesskey|credential|password|privatekey|secret|token|rawenvironment|environmentid|envid|email|phone)/i;
const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /^[a-z][a-z0-9+.-]*:\/\//i,
  /^(?:bearer|basic)\s+/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^(?:AKIA|ASIA)[A-Z0-9]{16}$/,
  /^(?:ghp|github_pat)_[A-Za-z0-9_]{20,}$/,
]);

function registryError(code = "DEPLOYMENT_ARTIFACT_BINDING_INVALID") {
  const error = new Error("Deployment Artifact Binding Registry rejected the input");
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

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
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

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function validDigest(value) {
  return typeof value === "string"
    && SHA256_PATTERN.test(value)
    && !PLACEHOLDER_DIGESTS.has(value)
    && !/^(.)\1{63}$/.test(value);
}

function validOpaqueRef(value, namespace) {
  if (typeof value !== "string" || !OPAQUE_PATTERNS[namespace].test(value)) return false;
  return validDigest(value.slice(value.lastIndexOf(":") + 1));
}

function parseTimestamp(value, code = "DEPLOYMENT_ARTIFACT_BINDING_TIMESTAMP_INVALID") {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw registryError(code);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw registryError(code);
  }
  return milliseconds;
}

function rejectRawMaterial(value) {
  if (typeof value === "string") {
    if (value.length === 0 || value !== value.trim() || value !== value.normalize("NFC")
      || FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_RAW_MATERIAL_REJECTED");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectRawMaterial);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_PATTERN.test(key.replace(/[^A-Za-z0-9]/g, ""))) {
        throw registryError("DEPLOYMENT_ARTIFACT_BINDING_RAW_MATERIAL_REJECTED");
      }
      rejectRawMaterial(nested);
    }
  }
}

function assertDigest(value, code) {
  if (!validDigest(value)) throw registryError(code);
}

function assertOpaqueRef(value, namespace, code) {
  if (!validOpaqueRef(value, namespace)) throw registryError(code);
}

function computeSourceProvenancePayloadDigest(payload) {
  return digest(SOURCE_PROVENANCE_PAYLOAD_DIGEST_DOMAIN, payload);
}

function normalizeCloudFunctionProjection(functions) {
  if (!Array.isArray(functions)) return functions;
  return functions.map((entry) => ({
    functionKey: entry.functionKey,
    archiveDigest: entry.archiveDigest,
  })).sort((left, right) => (
    left.functionKey < right.functionKey ? -1 : left.functionKey > right.functionKey ? 1 : 0
  ));
}

function computeCloudFunctionDeploymentSetDigest(functions) {
  return digest(CLOUD_FUNCTION_SET_DIGEST_DOMAIN, normalizeCloudFunctionProjection(functions));
}

function normalizeDocumentArrays(input) {
  const document = clone(input);
  if (Array.isArray(document.modules)) {
    document.modules.sort((left, right) => (
      REQUIRED_MODULE_IDS.indexOf(left.moduleId) - REQUIRED_MODULE_IDS.indexOf(right.moduleId)
    ));
    const cloudFunctionModule = document.modules.find((entry) => entry.moduleId === "CLOUD_FUNCTION");
    if (cloudFunctionModule && cloudFunctionModule.cloudFunctions
      && Array.isArray(cloudFunctionModule.cloudFunctions.functions)) {
      cloudFunctionModule.cloudFunctions.functions.sort((left, right) => (
        REQUIRED_CLOUD_FUNCTION_KEYS.indexOf(left.functionKey)
        - REQUIRED_CLOUD_FUNCTION_KEYS.indexOf(right.functionKey)
      ));
    }
  }
  if (Array.isArray(document.signoffs)) {
    document.signoffs.sort((left, right) => (
      REQUIRED_SIGNOFF_ROLES.indexOf(left.role) - REQUIRED_SIGNOFF_ROLES.indexOf(right.role)
    ));
  }
  return document;
}

function bindingPayload(documentInput) {
  const document = normalizeDocumentArrays(documentInput);
  return Object.fromEntries(
    DOCUMENT_FIELDS.filter((field) => field !== "signoffs")
      .map((field) => [field, document[field]])
  );
}

function computeDeploymentArtifactBindingPayloadDigest(document) {
  return digest(BINDING_PAYLOAD_DIGEST_DOMAIN, bindingPayload(document));
}

function signoffPayload(signoff) {
  return Object.fromEntries(SIGNED_PAYLOAD_FIELDS.map((field) => [field, signoff[field]]));
}

function computeDeploymentArtifactBindingSignoffPayloadDigest(signoff) {
  return digest("myroot-deployment-artifact-binding-signoff-payload:v1", signoffPayload(signoff));
}

function computeDeploymentArtifactBindingRegistryDigest(manifest) {
  return digest("myroot-deployment-artifact-binding-registry:v1", manifest);
}

function validateSourceProvenanceContract(manifest) {
  if (!plainRecord(manifest)
    || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.scope !== "NON_RUNTIME_LOCAL_PROVENANCE_FOUNDATION"
    || manifest.digestAlgorithm !== "SHA-256"
    || !plainRecord(manifest.canonicalization)
    || manifest.canonicalization.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || manifest.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || manifest.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || manifest.canonicalization.undefinedPolicy !== "REJECT"
    || manifest.canonicalization.digestDomainSeparation !== "ARTIFACT_PROVENANCE_V1"
    || !sameArray(manifest.requiredArtifactModuleIds, REQUIRED_MODULE_IDS)
    || !plainRecord(manifest.remoteClosureRequirements)
    || manifest.remoteClosureRequirements.evidenceClass !== SOURCE_PROVENANCE_EVIDENCE_CLASS) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_CONTRACT_INVALID");
  }
}

function validateManifest(manifest) {
  const schema = manifest && manifest.recordSchema;
  const canonicalization = manifest && manifest.canonicalization;
  if (!exactKeys(manifest, MANIFEST_FIELDS)
    || manifest.registryVersion !== 1
    || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.buildVersion !== BUILD_VERSION
    || manifest.scope !== CONTRACT_STATUS
    || manifest.sourceProvenanceEvidenceClass !== SOURCE_PROVENANCE_EVIDENCE_CLASS
    || manifest.validationLevel !== VALIDATION_LEVEL
    || manifest.digestAlgorithm !== "SHA-256"
    || !exactKeys(canonicalization, CANONICALIZATION_FIELDS)
    || canonicalization.version !== CANONICALIZATION_VERSION
    || canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || canonicalization.undefinedPolicy !== "REJECT"
    || canonicalization.digestDomainSeparation !== "DEPLOYMENT_ARTIFACT_BINDING_V1"
    || canonicalization.sourceProvenancePayloadDigestDomain
      !== SOURCE_PROVENANCE_PAYLOAD_DIGEST_DOMAIN
    || canonicalization.cloudFunctionSetDigestDomain !== CLOUD_FUNCTION_SET_DIGEST_DOMAIN
    || canonicalization.bindingPayloadDigestDomain !== BINDING_PAYLOAD_DIGEST_DOMAIN
    || !sameArray(manifest.requiredArtifactModuleIds, REQUIRED_MODULE_IDS)
    || canonicalJson(manifest.artifactKinds) !== canonicalJson(ARTIFACT_KINDS)
    || !sameArray(manifest.requiredCloudFunctionKeys, REQUIRED_CLOUD_FUNCTION_KEYS)
    || !sameArray(manifest.requiredSignoffRoles, REQUIRED_SIGNOFF_ROLES)
    || !sameArray(manifest.allowedSignatureMethods, SIGNATURE_METHODS)
    || manifest.maxValidityDays !== MAX_VALIDITY_DAYS
    || !exactKeys(schema, RECORD_SCHEMA_FIELDS)
    || !sameArray(schema.documentExactFields, DOCUMENT_FIELDS)
    || !sameArray(schema.moduleBaseExactFields, MODULE_BASE_FIELDS)
    || !sameArray(schema.platformBindingExactFields, PLATFORM_BINDING_FIELDS)
    || !sameArray(schema.backendExactFields, BACKEND_FIELDS)
    || !sameArray(schema.miniprogramExactFields, MINIPROGRAM_FIELDS)
    || !sameArray(schema.cloudFunctionsExactFields, CLOUD_FUNCTIONS_FIELDS)
    || !sameArray(schema.cloudFunctionExactFields, CLOUD_FUNCTION_FIELDS)
    || !sameArray(schema.signoffExactFields, SIGNOFF_FIELDS)
    || canonicalJson(schema.opaqueReferencePatterns) !== canonicalJson(OPAQUE_PATTERN_SOURCES)
    || !exactKeys(manifest.authorization, Object.keys(AUTHORIZATION))
    || canonicalJson(manifest.authorization) !== canonicalJson(AUTHORIZATION)) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CONTRACT_INVALID");
  }
  canonicalJson(manifest);
  return deepFreeze(clone(manifest));
}

function validateSourceProvenance(sourceProvenance, sourceManifest) {
  if (!exactKeys(sourceProvenance, ["payloadDigest", "payload"])) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_INVALID");
  }
  const payload = sourceProvenance.payload;
  if (!exactKeys(payload, SOURCE_PAYLOAD_FIELDS)
    || payload.schemaVersion !== 1
    || payload.contractStatus !== "NON_RUNTIME_LOCAL_PROVENANCE_FOUNDATION"
    || payload.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || !SOURCE_COMMIT_PATTERN.test(payload.sourceCommit)
    || !exactKeys(payload.sourceSet, SOURCE_SET_FIELDS)
    || !Number.isSafeInteger(payload.sourceSet.fileCount) || payload.sourceSet.fileCount < 1
    || !Number.isSafeInteger(payload.sourceSet.totalBytes) || payload.sourceSet.totalBytes < 0
    || !validDigest(payload.sourceSet.manifestSha256)
    || !exactKeys(payload.sourceArchive, SOURCE_ARCHIVE_FIELDS)
    || payload.sourceArchive.format !== "USTAR_FIXED_V1"
    || payload.sourceArchive.fileName !== "candidate-source.tar"
    || !Number.isSafeInteger(payload.sourceArchive.bytes) || payload.sourceArchive.bytes < 1
    || !Number.isSafeInteger(payload.sourceArchive.entryCount) || payload.sourceArchive.entryCount < 1
    || !validDigest(payload.sourceArchive.sha256)
    || !Array.isArray(payload.artifactDigestByModule)
    || payload.artifactDigestByModule.length !== REQUIRED_MODULE_IDS.length
    || !Array.isArray(payload.governanceDigestSet)
    || payload.governanceDigestSet.length !== sourceManifest.governanceSourcePaths.length) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_INVALID");
  }
  const sourceDigests = new Map();
  for (let index = 0; index < payload.artifactDigestByModule.length; index += 1) {
    const entry = payload.artifactDigestByModule[index];
    if (!exactKeys(entry, SOURCE_MODULE_FIELDS)
      || entry.moduleId !== REQUIRED_MODULE_IDS[index]
      || sourceDigests.has(entry.moduleId)
      || entry.artifactKind !== "DETERMINISTIC_SOURCE_MODULE_V1"
      || !Number.isSafeInteger(entry.fileCount) || entry.fileCount < 1
      || !Number.isSafeInteger(entry.totalBytes) || entry.totalBytes < 0
      || !validDigest(entry.artifactDigest)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_INVALID");
    }
    sourceDigests.set(entry.moduleId, entry.artifactDigest);
  }
  if (!REQUIRED_MODULE_IDS.every((moduleId) => sourceDigests.has(moduleId))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_INVALID");
  }
  const governancePaths = new Set();
  for (let index = 0; index < payload.governanceDigestSet.length; index += 1) {
    const entry = payload.governanceDigestSet[index];
    if (!exactKeys(entry, GOVERNANCE_REF_FIELDS)
      || typeof entry.refId !== "string" || entry.refId.length < 1 || entry.refId.length > 64
      || entry.path !== sourceManifest.governanceSourcePaths[index]
      || governancePaths.has(entry.path)
      || !validDigest(entry.sha256)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_INVALID");
    }
    governancePaths.add(entry.path);
  }
  const computedDigest = computeSourceProvenancePayloadDigest(payload);
  if (!validDigest(sourceProvenance.payloadDigest)
    || sourceProvenance.payloadDigest !== computedDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_DIGEST_MISMATCH");
  }
  return { payload, sourceDigests, payloadDigest: computedDigest };
}

function validateCandidateManifest(candidateManifest, releaseRegistry) {
  try {
    releaseRegistry.verify(candidateManifest);
  } catch {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_MANIFEST_INVALID");
  }
  if (candidateManifest.documentType !== "CANDIDATE_MANIFEST") {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_MANIFEST_INVALID");
  }
  const candidate = candidateManifest.document;
  const candidateDigests = new Map();
  for (const entry of candidate.artifactDigestByModule) {
    if (candidateDigests.has(entry.moduleId)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_MANIFEST_INVALID");
    }
    candidateDigests.set(entry.moduleId, entry.artifactDigest);
  }
  if (!REQUIRED_MODULE_IDS.every((moduleId) => candidateDigests.has(moduleId))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_MANIFEST_INVALID");
  }
  return { candidate, candidateDigests, candidateDigest: candidateManifest.digest };
}

function validateObservedAt(value, temporal) {
  const observedAt = parseTimestamp(
    value,
    "DEPLOYMENT_ARTIFACT_BINDING_OBSERVED_AT_INVALID"
  );
  if (observedAt < temporal.validFrom
    || observedAt < temporal.candidateCreatedAt
    || observedAt > temporal.collectedAt
    || observedAt > temporal.evaluatedAt) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_OBSERVED_AT_INVALID");
  }
}

function validatePlatformBinding(binding, deploymentArtifactDigest, temporal) {
  if (!exactKeys(binding, PLATFORM_BINDING_FIELDS)) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID");
  }
  assertOpaqueRef(
    binding.platformSubjectRef,
    "subject",
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID"
  );
  assertOpaqueRef(
    binding.platformRevisionRef,
    "revision",
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID"
  );
  assertOpaqueRef(
    binding.readbackSubjectRef,
    "subject",
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID"
  );
  assertOpaqueRef(
    binding.readbackRevisionRef,
    "revision",
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID"
  );
  assertDigest(
    binding.readbackArtifactDigest,
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_INVALID"
  );
  validateObservedAt(binding.observedAt, temporal);
  if (binding.platformSubjectRef !== binding.readbackSubjectRef
    || binding.platformRevisionRef !== binding.readbackRevisionRef
    || binding.readbackArtifactDigest !== deploymentArtifactDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_MISMATCH");
  }
}

function validateCloudFunctions(module, temporal, refInventory) {
  if (!exactKeys(module.cloudFunctions, CLOUD_FUNCTIONS_FIELDS)
    || !Array.isArray(module.cloudFunctions.functions)
    || module.cloudFunctions.functions.length !== REQUIRED_CLOUD_FUNCTION_KEYS.length) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_SET_INVALID");
  }
  const seenKeys = new Set();
  const seenSubjects = new Set();
  const seenRevisions = new Set();
  for (const entry of module.cloudFunctions.functions) {
    if (!exactKeys(entry, CLOUD_FUNCTION_FIELDS)
      || !REQUIRED_CLOUD_FUNCTION_KEYS.includes(entry.functionKey)
      || seenKeys.has(entry.functionKey)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_DUPLICATE_OR_UNKNOWN");
    }
    seenKeys.add(entry.functionKey);
    assertDigest(entry.archiveDigest, "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID");
    assertDigest(entry.readbackArchiveDigest, "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID");
    assertOpaqueRef(
      entry.platformSubjectRef,
      "subject",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    assertOpaqueRef(
      entry.readbackSubjectRef,
      "subject",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    assertOpaqueRef(
      entry.platformRevisionRef,
      "revision",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    assertOpaqueRef(
      entry.readbackRevisionRef,
      "revision",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    assertOpaqueRef(
      entry.platformUploadReceiptRef,
      "receipt",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    assertOpaqueRef(
      entry.remoteReadbackEvidenceRef,
      "evidence",
      "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_INVALID"
    );
    validateObservedAt(entry.observedAt, temporal);
    if (entry.archiveDigest !== entry.readbackArchiveDigest
      || entry.platformSubjectRef !== entry.readbackSubjectRef
      || entry.platformRevisionRef !== entry.readbackRevisionRef
      || seenSubjects.has(entry.platformSubjectRef)
      || seenRevisions.has(entry.platformRevisionRef)
      || refInventory.subjects.has(entry.platformSubjectRef)
      || refInventory.revisions.has(entry.platformRevisionRef)
      || refInventory.receipts.has(entry.platformUploadReceiptRef)
      || refInventory.evidence.has(entry.remoteReadbackEvidenceRef)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_READBACK_MISMATCH");
    }
    seenSubjects.add(entry.platformSubjectRef);
    seenRevisions.add(entry.platformRevisionRef);
    refInventory.subjects.add(entry.platformSubjectRef);
    refInventory.revisions.add(entry.platformRevisionRef);
    refInventory.receipts.add(entry.platformUploadReceiptRef);
    refInventory.evidence.add(entry.remoteReadbackEvidenceRef);
  }
  if (!REQUIRED_CLOUD_FUNCTION_KEYS.every((key) => seenKeys.has(key))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_SET_INVALID");
  }
  if (computeCloudFunctionDeploymentSetDigest(module.cloudFunctions.functions)
    !== module.deploymentArtifactDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_SET_DIGEST_MISMATCH");
  }
}

function expectedModuleFields(moduleId) {
  if (moduleId === "BACKEND") return [...MODULE_BASE_FIELDS, "backend"];
  if (moduleId === "CLOUD_FUNCTION") return [...MODULE_BASE_FIELDS, "cloudFunctions"];
  if (moduleId === "MINIPROGRAM") return [...MODULE_BASE_FIELDS, "miniprogram"];
  return MODULE_BASE_FIELDS;
}

function validateModule(module, sourceDigest, candidateDigest, temporal, refInventory) {
  if (!exactKeys(module, expectedModuleFields(module.moduleId))
    || module.artifactKind !== ARTIFACT_KIND_BY_MODULE[module.moduleId]) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_MODULE_INVALID");
  }
  assertDigest(module.sourceArtifactDigest, "DEPLOYMENT_ARTIFACT_BINDING_MODULE_INVALID");
  assertDigest(module.deploymentArtifactDigest, "DEPLOYMENT_ARTIFACT_BINDING_MODULE_INVALID");
  assertOpaqueRef(
    module.remoteReadbackEvidenceRef,
    "evidence",
    "DEPLOYMENT_ARTIFACT_BINDING_MODULE_INVALID"
  );
  if (refInventory.evidence.has(module.remoteReadbackEvidenceRef)) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_EVIDENCE_REPLAY_REJECTED");
  }
  refInventory.evidence.add(module.remoteReadbackEvidenceRef);
  if (module.sourceArtifactDigest !== sourceDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_ARTIFACT_DIGEST_MISMATCH");
  }
  if (module.deploymentArtifactDigest !== candidateDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_ARTIFACT_DIGEST_MISMATCH");
  }
  if (module.sourceArtifactDigest === module.deploymentArtifactDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_DIGEST_CLASS_MIXED");
  }
  validatePlatformBinding(module.platformBinding, module.deploymentArtifactDigest, temporal);
  if (refInventory.subjects.has(module.platformBinding.platformSubjectRef)
    || refInventory.revisions.has(module.platformBinding.platformRevisionRef)) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_REUSED");
  }
  refInventory.subjects.add(module.platformBinding.platformSubjectRef);
  refInventory.revisions.add(module.platformBinding.platformRevisionRef);
  if (module.moduleId === "BACKEND") {
    if (!exactKeys(module.backend, BACKEND_FIELDS)
      || !OCI_DIGEST_PATTERN.test(module.backend.ociImageDigest)
      || !OCI_DIGEST_PATTERN.test(module.backend.runtimeReadbackImageDigest)
      || !validDigest(module.backend.ociImageDigest.slice("sha256:".length))
      || module.backend.ociImageDigest !== module.backend.runtimeReadbackImageDigest
      || module.backend.ociImageDigest !== `sha256:${module.deploymentArtifactDigest}`) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_BACKEND_IMAGE_MISMATCH");
    }
  } else if (module.moduleId === "MINIPROGRAM") {
    if (!exactKeys(module.miniprogram, MINIPROGRAM_FIELDS)
      || module.miniprogram.uploadPackageDigest !== module.deploymentArtifactDigest
      || module.miniprogram.uploadVersion !== BUILD_VERSION
      || !validDigest(module.miniprogram.uploadPackageDigest)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_MINIPROGRAM_PACKAGE_MISMATCH");
    }
    assertOpaqueRef(
      module.miniprogram.platformUploadReceiptRef,
      "receipt",
      "DEPLOYMENT_ARTIFACT_BINDING_MINIPROGRAM_RECEIPT_INVALID"
    );
    if (refInventory.receipts.has(module.miniprogram.platformUploadReceiptRef)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_EVIDENCE_REPLAY_REJECTED");
    }
    refInventory.receipts.add(module.miniprogram.platformUploadReceiptRef);
  } else if (module.moduleId === "CLOUD_FUNCTION") {
    validateCloudFunctions(module, temporal, refInventory);
  }
}

function validateSignoffs(document, temporal) {
  if (!Array.isArray(document.signoffs)
    || document.signoffs.length !== REQUIRED_SIGNOFF_ROLES.length) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID");
  }
  const bindingDigest = computeDeploymentArtifactBindingPayloadDigest(document);
  const seenRoles = new Set();
  const seenSigners = new Set();
  const seenSignoffIds = new Set();
  const seenSignatureDigests = new Set();
  const seenValidationEvidenceRefs = new Set();
  for (const signoff of document.signoffs) {
    if (!exactKeys(signoff, SIGNOFF_FIELDS)
      || !REQUIRED_SIGNOFF_ROLES.includes(signoff.role)
      || seenRoles.has(signoff.role)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID");
    }
    assertOpaqueRef(
      signoff.signoffId,
      "signoff",
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    assertOpaqueRef(
      signoff.signerRef,
      "actor",
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    assertOpaqueRef(
      signoff.validatorRef,
      "validator",
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    assertOpaqueRef(
      signoff.validationEvidenceRef,
      "evidence",
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    const signedAt = parseTimestamp(
      signoff.signedAt,
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    const signoffValidUntil = parseTimestamp(
      signoff.validUntil,
      "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID"
    );
    if (signoff.bindingPayloadDigest !== bindingDigest
      || signoff.decision !== "APPROVED"
      || signedAt < temporal.collectedAt
      || signedAt > temporal.evaluatedAt
      || signoffValidUntil !== temporal.validUntil
      || signoffValidUntil < temporal.evaluatedAt
      || !SIGNATURE_METHODS.includes(signoff.signatureMethod)
      || signoff.signedPayloadDigest
        !== computeDeploymentArtifactBindingSignoffPayloadDigest(signoff)
      || !validDigest(signoff.signatureDigest)
      || signoff.validationStatus !== "VALIDATED"
      || signoff.revocationStatus !== "ACTIVE"
      || signoff.revokedAt !== null
      || signoff.revocationEvidenceRef !== null
      || seenSignoffIds.has(signoff.signoffId)
      || seenSignatureDigests.has(signoff.signatureDigest)
      || seenValidationEvidenceRefs.has(signoff.validationEvidenceRef)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID");
    }
    if (seenSigners.has(signoff.signerRef)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_DUTY_CONFLICT");
    }
    seenRoles.add(signoff.role);
    seenSigners.add(signoff.signerRef);
    seenSignoffIds.add(signoff.signoffId);
    seenSignatureDigests.add(signoff.signatureDigest);
    seenValidationEvidenceRefs.add(signoff.validationEvidenceRef);
  }
  if (!REQUIRED_SIGNOFF_ROLES.every((role) => seenRoles.has(role))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_INVALID");
  }
}

function validateDocument(documentInput, context, dependencies) {
  canonicalJson(documentInput);
  rejectRawMaterial(documentInput);
  const document = normalizeDocumentArrays(documentInput);
  if (!exactKeys(document, DOCUMENT_FIELDS)
    || document.recordType !== "DEPLOYMENT_ARTIFACT_BINDING"
    || document.bindingFormatVersion !== 1
    || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || document.productVersion !== PRODUCT_VERSION
    || document.buildVersion !== BUILD_VERSION
    || !SOURCE_COMMIT_PATTERN.test(document.sourceCommit)
    || document.revocationStatus !== "ACTIVE"
    || document.revokedAt !== null
    || document.revocationEvidenceRef !== null) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID");
  }
  assertDigest(
    document.sourceProvenancePayloadDigest,
    "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID"
  );
  assertDigest(
    document.candidateManifestDigest,
    "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID"
  );
  assertDigest(
    document.revocationSnapshotDigest,
    "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID"
  );
  assertOpaqueRef(document.releaseId, "release", "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID");
  assertOpaqueRef(
    document.targetEnvironmentRef,
    "environment",
    "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID"
  );
  const validFrom = parseTimestamp(document.validFrom);
  const validUntil = parseTimestamp(document.validUntil);
  const collectedAt = parseTimestamp(document.collectedAt);
  const evaluatedAt = parseTimestamp(
    context.evaluatedAt,
    "DEPLOYMENT_ARTIFACT_BINDING_EVALUATION_CONTEXT_INVALID"
  );
  if (validFrom > collectedAt
    || collectedAt > evaluatedAt
    || evaluatedAt > validUntil
    || validUntil <= validFrom
    || validUntil - validFrom > MAX_VALIDITY_DAYS * MILLISECONDS_PER_DAY
    || document.revocationSnapshotDigest !== context.revocationSnapshotDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_EXPIRED_OR_REVOKED");
  }
  const source = validateSourceProvenance(
    context.sourceProvenance,
    dependencies.sourceProvenanceManifest
  );
  const candidate = validateCandidateManifest(
    context.candidateManifest,
    dependencies.releaseRegistry
  );
  if (document.sourceCommit !== source.payload.sourceCommit
    || document.sourceCommit !== candidate.candidate.sourceCommit
    || document.sourceProvenancePayloadDigest !== source.payloadDigest) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_SOURCE_IDENTITY_MISMATCH");
  }
  if (document.candidateManifestDigest !== candidate.candidateDigest
    || document.releaseId !== candidate.candidate.releaseId
    || document.targetEnvironmentRef !== candidate.candidate.targetEnvironmentId) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_IDENTITY_MISMATCH");
  }
  if (parseTimestamp(candidate.candidate.createdAt) > collectedAt
    || parseTimestamp(candidate.candidate.createdAt) > evaluatedAt) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_IDENTITY_MISMATCH");
  }
  const temporal = {
    validFrom,
    validUntil,
    collectedAt,
    evaluatedAt,
    candidateCreatedAt: parseTimestamp(candidate.candidate.createdAt),
  };
  if (!Array.isArray(document.modules) || document.modules.length !== REQUIRED_MODULE_IDS.length) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_MODULE_SET_INVALID");
  }
  const seenModules = new Set();
  const sourceDigestInventory = new Set();
  const deploymentDigestInventory = new Set();
  const refInventory = {
    evidence: new Set(),
    receipts: new Set(),
    subjects: new Set(),
    revisions: new Set(),
  };
  for (const module of document.modules) {
    if (!plainRecord(module) || !REQUIRED_MODULE_IDS.includes(module.moduleId)
      || seenModules.has(module.moduleId)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_MODULE_DUPLICATE_OR_UNKNOWN");
    }
    seenModules.add(module.moduleId);
    validateModule(
      module,
      source.sourceDigests.get(module.moduleId),
      candidate.candidateDigests.get(module.moduleId),
      temporal,
      refInventory
    );
    if (sourceDigestInventory.has(module.sourceArtifactDigest)
      || deploymentDigestInventory.has(module.deploymentArtifactDigest)) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CROSS_MODULE_DIGEST_REUSE_REJECTED");
    }
    sourceDigestInventory.add(module.sourceArtifactDigest);
    deploymentDigestInventory.add(module.deploymentArtifactDigest);
  }
  if (!REQUIRED_MODULE_IDS.every((moduleId) => seenModules.has(moduleId))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_MODULE_SET_INVALID");
  }
  validateSignoffs(document, temporal);
  const moduleResults = document.modules.map((module) => deepFreeze({
    moduleId: module.moduleId,
    artifactKind: module.artifactKind,
    sourceArtifactDigest: module.sourceArtifactDigest,
    deploymentArtifactDigest: module.deploymentArtifactDigest,
    platformReadbackStructurePresent: true,
  }));
  const result = deepFreeze({
    status: VALIDATION_LEVEL,
    contractStatus: CONTRACT_STATUS,
    productVersion: PRODUCT_VERSION,
    buildVersion: BUILD_VERSION,
    sourceCommit: document.sourceCommit,
    sourceProvenanceEvidenceClass: SOURCE_PROVENANCE_EVIDENCE_CLASS,
    sourceProvenancePayloadDigest: document.sourceProvenancePayloadDigest,
    candidateManifestDigest: document.candidateManifestDigest,
    releaseId: document.releaseId,
    targetEnvironmentRef: document.targetEnvironmentRef,
    moduleResults,
    allBindingsStructurallyComplete: true,
    platformReadbackTrust: "OPAQUE_REFERENCES_NOT_DEREFERENCED",
    sealClosed: false,
    authorization: clone(AUTHORIZATION),
  });
  return { document: deepFreeze(document), result };
}

function createDeploymentArtifactBindingRegistry(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !["manifest", "sourceProvenanceManifest"].includes(key))) {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_REGISTRY_OPTIONS_INVALID");
  }
  let manifest;
  let sourceProvenanceManifest;
  try {
    manifest = options.manifest === undefined
      ? JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"))
      : clone(options.manifest);
    sourceProvenanceManifest = options.sourceProvenanceManifest === undefined
      ? JSON.parse(fs.readFileSync(DEFAULT_SOURCE_PROVENANCE_MANIFEST_PATH, "utf8"))
      : clone(options.sourceProvenanceManifest);
  } catch {
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_CONTRACT_UNAVAILABLE");
  }
  const frozenManifest = validateManifest(manifest);
  validateSourceProvenanceContract(sourceProvenanceManifest);
  const dependencies = deepFreeze({
    sourceProvenanceManifest: clone(sourceProvenanceManifest),
    releaseRegistry: getDefaultReleaseEvidenceContractRegistry(),
  });
  const registryDigest = computeDeploymentArtifactBindingRegistryDigest(frozenManifest);

  function validateContext(context, timeField) {
    const expectedTimeField = timeField || "evaluatedAt";
    if (!exactKeys(context, [
      expectedTimeField,
      "revocationSnapshotDigest",
      "sourceProvenance",
      "candidateManifest",
    ])) {
      throw registryError("DEPLOYMENT_ARTIFACT_BINDING_EVALUATION_CONTEXT_INVALID");
    }
    assertDigest(
      context.revocationSnapshotDigest,
      "DEPLOYMENT_ARTIFACT_BINDING_EVALUATION_CONTEXT_INVALID"
    );
    canonicalJson(context.sourceProvenance);
    canonicalJson(context.candidateManifest);
    return expectedTimeField === "evaluatedAt" ? context : {
      evaluatedAt: context.verifiedAt,
      revocationSnapshotDigest: context.revocationSnapshotDigest,
      sourceProvenance: context.sourceProvenance,
      candidateManifest: context.candidateManifest,
    };
  }

  function evaluate(documentInput, contextInput) {
    const context = validateContext(contextInput, "evaluatedAt");
    return validateDocument(documentInput, context, dependencies).result;
  }

  function seal(documentInput, contextInput) {
    const context = validateContext(contextInput, "evaluatedAt");
    const { document, result } = validateDocument(documentInput, context, dependencies);
    return deepFreeze({
      envelopeFormatVersion: 1,
      sealStatus: "STRUCTURE_SEALED_NOT_GATE_CLOSED",
      evaluatedAt: context.evaluatedAt,
      revocationSnapshotDigest: context.revocationSnapshotDigest,
      document: clone(document),
      documentDigest: digest("myroot-deployment-artifact-binding-document:v1", document),
      result,
      resultDigest: digest("myroot-deployment-artifact-binding-evaluation:v1", {
        evaluatedAt: context.evaluatedAt,
        result,
      }),
      authorization: clone(AUTHORIZATION),
    });
  }

  function sealClosed(documentInput, contextInput) {
    const context = validateContext(contextInput, "evaluatedAt");
    validateDocument(documentInput, context, dependencies);
    throw registryError("DEPLOYMENT_ARTIFACT_BINDING_UNTRUSTED_CANNOT_CLOSE");
  }

  function verify(envelope, contextInput) {
    try {
      const context = validateContext(contextInput, "verifiedAt");
      if (!exactKeys(envelope, [
        "envelopeFormatVersion",
        "sealStatus",
        "evaluatedAt",
        "revocationSnapshotDigest",
        "document",
        "documentDigest",
        "result",
        "resultDigest",
        "authorization",
      ])
        || envelope.envelopeFormatVersion !== 1
        || envelope.sealStatus !== "STRUCTURE_SEALED_NOT_GATE_CLOSED"
        || parseTimestamp(context.evaluatedAt) < parseTimestamp(envelope.evaluatedAt)
        || envelope.revocationSnapshotDigest !== context.revocationSnapshotDigest) return false;
      const { document, result } = validateDocument(envelope.document, context, dependencies);
      return envelope.documentDigest
          === digest("myroot-deployment-artifact-binding-document:v1", document)
        && envelope.resultDigest
          === digest("myroot-deployment-artifact-binding-evaluation:v1", {
            evaluatedAt: envelope.evaluatedAt,
            result,
          })
        && canonicalJson(envelope.document) === canonicalJson(document)
        && canonicalJson(envelope.result) === canonicalJson(result)
        && canonicalJson(envelope.authorization) === canonicalJson(AUTHORIZATION);
    } catch {
      return false;
    }
  }

  return deepFreeze({
    describe() {
      return deepFreeze({
        contractStatus: CONTRACT_STATUS,
        contractVersion: CONTRACT_VERSION,
        productVersion: PRODUCT_VERSION,
        buildVersion: BUILD_VERSION,
        sourceProvenanceEvidenceClass: SOURCE_PROVENANCE_EVIDENCE_CLASS,
        validationLevel: VALIDATION_LEVEL,
        registryDigest,
        requiredArtifactModuleIds: clone(REQUIRED_MODULE_IDS),
        artifactKinds: clone(ARTIFACT_KINDS),
        requiredCloudFunctionKeys: clone(REQUIRED_CLOUD_FUNCTION_KEYS),
        requiredSignoffRoles: clone(REQUIRED_SIGNOFF_ROLES),
        authorization: clone(AUTHORIZATION),
      });
    },
    evaluate,
    seal,
    sealClosed,
    verify,
  });
}

let defaultRegistry;
function getDefaultDeploymentArtifactBindingRegistry() {
  if (!defaultRegistry) defaultRegistry = createDeploymentArtifactBindingRegistry();
  return defaultRegistry;
}

module.exports = {
  computeCloudFunctionDeploymentSetDigest,
  computeDeploymentArtifactBindingPayloadDigest,
  computeDeploymentArtifactBindingRegistryDigest,
  computeDeploymentArtifactBindingSignoffPayloadDigest,
  computeSourceProvenancePayloadDigest,
  createDeploymentArtifactBindingRegistry,
  getDefaultDeploymentArtifactBindingRegistry,
};
