const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "content-ued-authorization",
  "v1.0.0.json"
);

const CONTRACT_STATUS = "NON_RUNTIME_CONTENT_UED_AUTHORIZATION_STRUCTURE_VALIDATION";
const CONTRACT_VERSION = "1.0.0";
const PRODUCT_VERSION = "v1.0.0";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const PHOTOGRAPHY_ASSET_SET_DIGEST_DOMAIN = "myroot-content-ued-photography-asset-set:v1";
const ENVIRONMENT_KINDS = Object.freeze(["CANDIDATE", "PRODUCTION"]);
const EVIDENCE_CONFIG = Object.freeze([
  Object.freeze({
    evidenceKind: "HEALTH_CONTENT",
    requiredRoles: Object.freeze([
      "PRODUCT",
      "PRIVACY",
      "HEALTH_CONTENT_REVIEW",
      "OPERATIONS",
    ]),
    maxValidityDays: 730,
  }),
  Object.freeze({
    evidenceKind: "PRIVACY_COMPLIANCE",
    requiredRoles: Object.freeze(["PRIVACY", "ENGINEERING", "QA"]),
    maxValidityDays: 365,
  }),
  Object.freeze({
    evidenceKind: "ACTIVITY_OPERATIONS",
    requiredRoles: Object.freeze(["PRODUCT", "OPERATIONS", "PRIVACY", "QA"]),
    maxValidityDays: 180,
  }),
  Object.freeze({
    evidenceKind: "UED_HANDOFF",
    requiredRoles: Object.freeze(["PRODUCT", "UED_OWNER", "ENGINEERING", "QA"]),
    maxValidityDays: 180,
  }),
  Object.freeze({
    evidenceKind: "PHOTOGRAPHY_RIGHTS",
    requiredRoles: Object.freeze([
      "PRODUCT",
      "PRIVACY",
      "UED_OWNER",
      "RIGHTS_CLEARANCE",
    ]),
    maxValidityDays: 3660,
  }),
]);
const EVIDENCE_KINDS = Object.freeze(EVIDENCE_CONFIG.map((entry) => entry.evidenceKind));
const CONFIG_BY_KIND = Object.freeze(Object.fromEntries(
  EVIDENCE_CONFIG.map((entry) => [entry.evidenceKind, entry])
));
const SIGNATURE_METHODS = Object.freeze([
  "CONTROLLED_APPROVAL_RECORD_V1",
  "DETACHED_DIGITAL_SIGNATURE_V1",
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  deploymentAuthorized: false,
  contentPublicationAuthorized: false,
  healthWriteAuthorized: false,
  activityPublicationAuthorized: false,
  assetPublicationAuthorized: false,
  productionWriteAuthorized: false,
  gateClosureAuthorized: false,
});

const MANIFEST_FIELDS = Object.freeze([
  "registryVersion",
  "contractVersion",
  "productVersion",
  "scope",
  "digestAlgorithm",
  "canonicalization",
  "requiredEnvironmentKinds",
  "evidenceKinds",
  "allowedSignatureMethods",
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
  "photographyAssetSetProjection",
  "photographyAssetSetOrdering",
  "photographyAssetSetDigestDomain",
]);
const RECORD_SCHEMA_FIELDS = Object.freeze([
  "evidenceExactFields",
  "environmentBundleExactFields",
  "releaseBundleExactFields",
  "inputBindingExactFields",
  "signoffExactFields",
  "healthContentPayloadExactFields",
  "privacyCompliancePayloadExactFields",
  "activityOperationsPayloadExactFields",
  "uedHandoffPayloadExactFields",
  "photographyRightsPayloadExactFields",
  "photographyAssetExactFields",
  "opaqueReferencePatterns",
]);
const EVIDENCE_FIELDS = Object.freeze([
  "recordType",
  "evidenceFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "evidenceKind",
  "subjectRef",
  "inputBinding",
  "payload",
  "revocationSnapshotDigest",
  "validFrom",
  "validUntil",
  "collectedAt",
  "signoffs",
]);
const ENVIRONMENT_BUNDLE_FIELDS = Object.freeze([
  "recordType",
  "bundleFormatVersion",
  "productVersion",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "inputBinding",
  "evidenceDocuments",
]);
const RELEASE_BUNDLE_FIELDS = Object.freeze([
  "recordType",
  "bundleFormatVersion",
  "productVersion",
  "releaseRef",
  "inputBinding",
  "environmentBundles",
]);
const INPUT_BINDING_FIELDS = Object.freeze([
  "prdDigest",
  "designDigest",
  "authorizationPacketDigest",
  "candidateManifestDigest",
  "routeRegistryDigest",
  "artifactProvenanceDigest",
]);
const SIGNOFF_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "evidenceKind",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "evidencePayloadDigest",
  "decision",
  "signedAt",
  "validUntil",
  "signatureMethod",
  "signedPayloadDigest",
  "signatureDigest",
  "validatorRef",
  "validationStatus",
  "validationEvidenceRef",
  "authorizationChainRef",
  "revocationStatus",
  "revocationEvidenceRef",
]);
const SIGNED_PAYLOAD_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "evidenceKind",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "evidencePayloadDigest",
  "decision",
  "signedAt",
  "validUntil",
  "signatureMethod",
]);
const HEALTH_FIELDS = Object.freeze([
  "contentBundleRef",
  "rightsEvidenceRef",
  "approvedChineseVersionRef",
  "populationRulesRef",
  "scoringThresholdInterpretationRef",
  "redFlagSopRef",
  "redFlagScenarioDrillEvidenceRef",
  "humanSupportRouteRef",
  "sourceArtifactDigest",
  "configuredContentCount",
  "commercialOnlineUseAllowed",
]);
const PRIVACY_FIELDS = Object.freeze([
  "dpiaEvidenceRef",
  "dataFlowEvidenceRef",
  "processorRegisterRef",
  "retentionDeletionMatrixRef",
  "consentLifecycleEvidenceRef",
  "accessAndKeyControlEvidenceRef",
  "incidentResponseDrillEvidenceRef",
  "wechatPrivacyParityEvidenceRef",
  "candidateRuntimeExerciseEvidenceRef",
  "implementationSnapshotDigest",
  "healthWritesFailClosedBeforeH04R",
]);
const ACTIVITY_FIELDS = Object.freeze([
  "firstReleaseContentRef",
  "operationsSopRef",
  "capacityPolicyRef",
  "cancellationPolicyRef",
  "customerSupportScriptRef",
  "photographyNoticeRef",
  "privacyNoticeRef",
  "canonicalScenarioDrillEvidenceRef",
  "adminPublicationEvidenceRef",
  "runtimeQueryEvidenceRef",
  "implementationSnapshotDigest",
  "publishedActivityCount",
  "contentSource",
  "uedPlaceholderExcludedFromRuntime",
]);
const UED_FIELDS = Object.freeze([
  "controlledHandoffIndexRef",
  "controlledArdotEvidenceRef",
  "prdBindingDigest",
  "designBindingDigest",
  "screenIndexDigest",
  "interactionSpecDigest",
  "accessibilitySpecDigest",
  "implementationParityEvidenceRef",
  "screenCount",
  "archivedPagesExcluded",
  "allCanonicalStatesCovered",
]);
const PHOTOGRAPHY_FIELDS = Object.freeze([
  "assetRightsIndexRef",
  "candidateAssetSetDigest",
  "uedAssetSetDigest",
  "runtimeAssetSetDigest",
  "publishedAssetCount",
  "assets",
]);
const PHOTOGRAPHY_ASSET_FIELDS = Object.freeze([
  "assetRef",
  "cleanMasterDigest",
  "rightsEvidenceRef",
  "chainOfTitleRef",
  "modelReleaseRequirement",
  "modelReleaseRef",
  "propertyReleaseRequirement",
  "propertyReleaseRef",
  "thirdPartyRightsRequirement",
  "thirdPartyRightsEvidenceRef",
  "allowedUsePolicyRef",
  "territoryPolicyRef",
  "attributionPolicyRef",
  "expiryOwnerRef",
  "validFrom",
  "validUntil",
  "rightsStatus",
  "revokedAt",
  "revocationEvidenceRef",
  "wechatMiniProgramUseAllowed",
  "commercialUseAllowed",
  "cropResizeAllowed",
  "retouchCompositeAllowed",
  "textOverlayAllowed",
  "cleanMasterConfirmed",
]);
const PAYLOAD_FIELDS = Object.freeze({
  HEALTH_CONTENT: HEALTH_FIELDS,
  PRIVACY_COMPLIANCE: PRIVACY_FIELDS,
  ACTIVITY_OPERATIONS: ACTIVITY_FIELDS,
  UED_HANDOFF: UED_FIELDS,
  PHOTOGRAPHY_RIGHTS: PHOTOGRAPHY_FIELDS,
});
const SCHEMA_FIELD_BINDINGS = Object.freeze({
  evidenceExactFields: EVIDENCE_FIELDS,
  environmentBundleExactFields: ENVIRONMENT_BUNDLE_FIELDS,
  releaseBundleExactFields: RELEASE_BUNDLE_FIELDS,
  inputBindingExactFields: INPUT_BINDING_FIELDS,
  signoffExactFields: SIGNOFF_FIELDS,
  healthContentPayloadExactFields: HEALTH_FIELDS,
  privacyCompliancePayloadExactFields: PRIVACY_FIELDS,
  activityOperationsPayloadExactFields: ACTIVITY_FIELDS,
  uedHandoffPayloadExactFields: UED_FIELDS,
  photographyRightsPayloadExactFields: PHOTOGRAPHY_FIELDS,
  photographyAssetExactFields: PHOTOGRAPHY_ASSET_FIELDS,
});
const OPAQUE_PATTERNS = Object.freeze({
  release: /^release:sha256:[a-f0-9]{64}$/,
  environment: /^environment:sha256:[a-f0-9]{64}$/,
  subject: /^subject:sha256:[a-f0-9]{64}$/,
  actor: /^actor:sha256:[a-f0-9]{64}$/,
  evidence: /^evidence:sha256:[a-f0-9]{64}$/,
  artifact: /^artifact:sha256:[a-f0-9]{64}$/,
  policy: /^policy:sha256:[a-f0-9]{64}$/,
  signoff: /^signoff:sha256:[a-f0-9]{64}$/,
  validator: /^validator:sha256:[a-f0-9]{64}$/,
  asset: /^asset:sha256:[a-f0-9]{64}$/,
});
const OPAQUE_PATTERN_SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(OPAQUE_PATTERNS).map(([key, value]) => [key, value.source])
));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLACEHOLDER_TEXT_PATTERN = /(?:^|[\s:_-])(tbd|todo|pending|placeholder|example|dummy|unknown|not[\s_-]?set|xxx)(?:$|[\s:_-])/i;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ROLE_CONFLICTS = Object.freeze([
  Object.freeze(["PRODUCT", "PRIVACY"]),
  Object.freeze(["PRODUCT", "HEALTH_CONTENT_REVIEW"]),
  Object.freeze(["PRODUCT", "RIGHTS_CLEARANCE"]),
  Object.freeze(["ENGINEERING", "QA"]),
]);
const PLACEHOLDER_DIGESTS = new Set(
  ["", "pending", "tbd", "todo", "placeholder", "example", "dummy", "unknown", "not set"]
    .map((value) => crypto.createHash("sha256").update(value).digest("hex"))
);

function registryError(code = "CONTENT_UED_AUTHORIZATION_INVALID") {
  const error = new Error("Content and UED Authorization Registry rejected the input");
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
    && left.every((value, index) => value === right[index]);
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
    throw registryError("CONTENT_UED_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw registryError("CONTENT_UED_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw registryError("CONTENT_UED_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) throw registryError("CONTENT_UED_CANONICALIZATION_REJECTED");
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

function computePhotographyAssetSetDigest(assets) {
  const normalizedAssets = assets.map((asset) => ({
    assetRef: asset.assetRef,
    cleanMasterDigest: asset.cleanMasterDigest,
  })).sort((left, right) => {
    if (left.assetRef < right.assetRef) return -1;
    if (left.assetRef > right.assetRef) return 1;
    if (left.cleanMasterDigest < right.cleanMasterDigest) return -1;
    if (left.cleanMasterDigest > right.cleanMasterDigest) return 1;
    return 0;
  });
  return digest(PHOTOGRAPHY_ASSET_SET_DIGEST_DOMAIN, normalizedAssets);
}

function computeContentUedAuthorizationRegistryDigest(manifest) {
  return digest("myroot-content-ued-authorization-registry:v1", manifest);
}

function evidencePayload(document) {
  return Object.fromEntries(
    EVIDENCE_FIELDS.filter((field) => field !== "signoffs")
      .map((field) => [field, document[field]])
  );
}

function computeContentUedEvidencePayloadDigest(document) {
  return digest("myroot-content-ued-evidence-payload:v1", evidencePayload(document));
}

function signoffPayload(signoff) {
  return Object.fromEntries(SIGNED_PAYLOAD_FIELDS.map((field) => [field, signoff[field]]));
}

function computeContentUedSignoffPayloadDigest(signoff) {
  return digest("myroot-content-ued-signoff-payload:v1", signoffPayload(signoff));
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

function parseTimestamp(value, code = "CONTENT_UED_TIMESTAMP_INVALID") {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw registryError(code);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw registryError(code);
  }
  return milliseconds;
}

function rejectPlaceholderStrings(value) {
  if (typeof value === "string") {
    if (value.length === 0 || value.trim() !== value || PLACEHOLDER_TEXT_PATTERN.test(value)) {
      throw registryError("CONTENT_UED_PLACEHOLDER_REJECTED");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectPlaceholderStrings);
    return;
  }
  if (value && typeof value === "object") Object.values(value).forEach(rejectPlaceholderStrings);
}

function assertOpaqueRef(value, namespace, code) {
  if (!validOpaqueRef(value, namespace)) throw registryError(code);
}

function assertDigest(value, code) {
  if (!validDigest(value)) throw registryError(code);
}

function assertPositiveInteger(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw registryError(code);
}

function validateInputBinding(inputBinding) {
  if (!exactKeys(inputBinding, INPUT_BINDING_FIELDS)) {
    throw registryError("CONTENT_UED_INPUT_BINDING_INVALID");
  }
  for (const field of INPUT_BINDING_FIELDS) {
    assertDigest(inputBinding[field], "CONTENT_UED_INPUT_BINDING_INVALID");
  }
  if (new Set(INPUT_BINDING_FIELDS.map((field) => inputBinding[field])).size !== INPUT_BINDING_FIELDS.length) {
    throw registryError("CONTENT_UED_INPUT_BINDING_INVALID");
  }
}

function validateHealthPayload(payload) {
  for (const [field, namespace] of [
    ["contentBundleRef", "artifact"],
    ["rightsEvidenceRef", "evidence"],
    ["approvedChineseVersionRef", "artifact"],
    ["populationRulesRef", "policy"],
    ["scoringThresholdInterpretationRef", "policy"],
    ["redFlagSopRef", "policy"],
    ["redFlagScenarioDrillEvidenceRef", "evidence"],
    ["humanSupportRouteRef", "policy"],
  ]) assertOpaqueRef(payload[field], namespace, "CONTENT_UED_HEALTH_EVIDENCE_INVALID");
  assertDigest(payload.sourceArtifactDigest, "CONTENT_UED_HEALTH_EVIDENCE_INVALID");
  assertPositiveInteger(payload.configuredContentCount, 1000, "CONTENT_UED_HEALTH_EVIDENCE_INVALID");
  if (payload.commercialOnlineUseAllowed !== true) {
    throw registryError("CONTENT_UED_HEALTH_EVIDENCE_INVALID");
  }
}

function validatePrivacyPayload(payload) {
  for (const field of [
    "dpiaEvidenceRef",
    "dataFlowEvidenceRef",
    "processorRegisterRef",
    "retentionDeletionMatrixRef",
    "consentLifecycleEvidenceRef",
    "accessAndKeyControlEvidenceRef",
    "incidentResponseDrillEvidenceRef",
    "wechatPrivacyParityEvidenceRef",
    "candidateRuntimeExerciseEvidenceRef",
  ]) assertOpaqueRef(payload[field], "evidence", "CONTENT_UED_PRIVACY_EVIDENCE_INVALID");
  assertDigest(payload.implementationSnapshotDigest, "CONTENT_UED_PRIVACY_EVIDENCE_INVALID");
  if (payload.healthWritesFailClosedBeforeH04R !== true) {
    throw registryError("CONTENT_UED_PRIVACY_EVIDENCE_INVALID");
  }
}

function validateActivityPayload(payload) {
  for (const [field, namespace] of [
    ["firstReleaseContentRef", "artifact"],
    ["operationsSopRef", "policy"],
    ["capacityPolicyRef", "policy"],
    ["cancellationPolicyRef", "policy"],
    ["customerSupportScriptRef", "policy"],
    ["photographyNoticeRef", "policy"],
    ["privacyNoticeRef", "policy"],
    ["canonicalScenarioDrillEvidenceRef", "evidence"],
    ["adminPublicationEvidenceRef", "evidence"],
    ["runtimeQueryEvidenceRef", "evidence"],
  ]) assertOpaqueRef(payload[field], namespace, "CONTENT_UED_ACTIVITY_EVIDENCE_INVALID");
  assertDigest(payload.implementationSnapshotDigest, "CONTENT_UED_ACTIVITY_EVIDENCE_INVALID");
  assertPositiveInteger(payload.publishedActivityCount, 10000, "CONTENT_UED_ACTIVITY_EVIDENCE_INVALID");
  if (payload.contentSource !== "OPS_BACKEND" || payload.uedPlaceholderExcludedFromRuntime !== true) {
    throw registryError("CONTENT_UED_ACTIVITY_EVIDENCE_INVALID");
  }
}

function validateUedPayload(payload, inputBinding) {
  assertOpaqueRef(
    payload.controlledHandoffIndexRef,
    "evidence",
    "CONTENT_UED_HANDOFF_EVIDENCE_INVALID"
  );
  assertOpaqueRef(
    payload.controlledArdotEvidenceRef,
    "evidence",
    "CONTENT_UED_HANDOFF_EVIDENCE_INVALID"
  );
  for (const field of [
    "prdBindingDigest",
    "designBindingDigest",
    "screenIndexDigest",
    "interactionSpecDigest",
    "accessibilitySpecDigest",
  ]) assertDigest(payload[field], "CONTENT_UED_HANDOFF_EVIDENCE_INVALID");
  assertOpaqueRef(
    payload.implementationParityEvidenceRef,
    "evidence",
    "CONTENT_UED_HANDOFF_EVIDENCE_INVALID"
  );
  assertPositiveInteger(payload.screenCount, 1000, "CONTENT_UED_HANDOFF_EVIDENCE_INVALID");
  if (
    payload.prdBindingDigest !== inputBinding.prdDigest
    || payload.designBindingDigest !== inputBinding.designDigest
    || payload.archivedPagesExcluded !== true
    || payload.allCanonicalStatesCovered !== true
  ) throw registryError("CONTENT_UED_HANDOFF_EVIDENCE_INVALID");
}

function validatePhotographyPayload(payload, evaluatedAt, document) {
  assertOpaqueRef(
    payload.assetRightsIndexRef,
    "evidence",
    "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID"
  );
  assertPositiveInteger(
    payload.publishedAssetCount,
    1000,
    "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID"
  );
  for (const field of ["candidateAssetSetDigest", "uedAssetSetDigest", "runtimeAssetSetDigest"]) {
    assertDigest(payload[field], "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
  }
  if (!Array.isArray(payload.assets) || payload.assets.length !== payload.publishedAssetCount) {
    throw registryError("CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
  }
  const assetRefs = new Set();
  const cleanMasterDigests = new Set();
  const documentFrom = parseTimestamp(document.validFrom);
  const documentUntil = parseTimestamp(document.validUntil);
  for (const asset of payload.assets) {
    if (!exactKeys(asset, PHOTOGRAPHY_ASSET_FIELDS)) {
      throw registryError("CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    }
    assertOpaqueRef(asset.assetRef, "asset", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertDigest(asset.cleanMasterDigest, "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertOpaqueRef(asset.rightsEvidenceRef, "evidence", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertOpaqueRef(asset.chainOfTitleRef, "evidence", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    for (const [requirementField, evidenceField] of [
      ["modelReleaseRequirement", "modelReleaseRef"],
      ["propertyReleaseRequirement", "propertyReleaseRef"],
      ["thirdPartyRightsRequirement", "thirdPartyRightsEvidenceRef"],
    ]) {
      const requirement = asset[requirementField];
      if (requirement === "REQUIRED_AND_VERIFIED") {
        assertOpaqueRef(
          asset[evidenceField],
          "evidence",
          "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID"
        );
      } else if (requirement !== "NOT_APPLICABLE" || asset[evidenceField] !== null) {
        throw registryError("CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
      }
    }
    assertOpaqueRef(asset.allowedUsePolicyRef, "policy", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertOpaqueRef(asset.territoryPolicyRef, "policy", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertOpaqueRef(asset.attributionPolicyRef, "policy", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    assertOpaqueRef(asset.expiryOwnerRef, "actor", "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    const assetFrom = parseTimestamp(asset.validFrom);
    const assetUntil = parseTimestamp(asset.validUntil);
    if (
      assetFrom > documentFrom
      || assetUntil < documentUntil
      || evaluatedAt < assetFrom
      || evaluatedAt > assetUntil
      || asset.rightsStatus !== "ACTIVE"
      || asset.revokedAt !== null
      || asset.revocationEvidenceRef !== null
      || asset.wechatMiniProgramUseAllowed !== true
      || asset.commercialUseAllowed !== true
      || asset.cropResizeAllowed !== true
      || asset.retouchCompositeAllowed !== true
      || asset.textOverlayAllowed !== true
      || asset.cleanMasterConfirmed !== true
    ) throw registryError("CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    if (assetRefs.has(asset.assetRef) || cleanMasterDigests.has(asset.cleanMasterDigest)) {
      throw registryError("CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID");
    }
    assetRefs.add(asset.assetRef);
    cleanMasterDigests.add(asset.cleanMasterDigest);
  }
  const computedAssetSetDigest = computePhotographyAssetSetDigest(payload.assets);
  if (
    payload.candidateAssetSetDigest !== computedAssetSetDigest
    || payload.uedAssetSetDigest !== computedAssetSetDigest
    || payload.runtimeAssetSetDigest !== computedAssetSetDigest
  ) throw registryError("CONTENT_UED_PHOTOGRAPHY_ASSET_SET_MISMATCH");
}

function validatePayload(document, evaluatedAt) {
  const expectedFields = PAYLOAD_FIELDS[document.evidenceKind];
  if (!expectedFields || !exactKeys(document.payload, expectedFields)) {
    throw registryError("CONTENT_UED_DOMAIN_EVIDENCE_INVALID");
  }
  switch (document.evidenceKind) {
    case "HEALTH_CONTENT":
      validateHealthPayload(document.payload);
      break;
    case "PRIVACY_COMPLIANCE":
      validatePrivacyPayload(document.payload);
      break;
    case "ACTIVITY_OPERATIONS":
      validateActivityPayload(document.payload);
      break;
    case "UED_HANDOFF":
      validateUedPayload(document.payload, document.inputBinding);
      break;
    case "PHOTOGRAPHY_RIGHTS":
      validatePhotographyPayload(document.payload, evaluatedAt, document);
      break;
    default:
      throw registryError("CONTENT_UED_DOMAIN_EVIDENCE_INVALID");
  }
}

function validateSignoffs(document, evaluatedAt) {
  const config = CONFIG_BY_KIND[document.evidenceKind];
  if (!Array.isArray(document.signoffs) || document.signoffs.length !== config.requiredRoles.length) {
    throw registryError("CONTENT_UED_SIGNOFF_INVALID");
  }
  const payloadDigest = computeContentUedEvidencePayloadDigest(document);
  const seenRoles = new Set();
  const seenSignerRefs = new Set();
  const seenSignoffIds = new Set();
  const seenSignatureDigests = new Set();
  const seenValidationEvidenceRefs = new Set();
  const seenAuthorizationChainRefs = new Set();
  const documentFrom = parseTimestamp(document.validFrom);
  const documentUntil = parseTimestamp(document.validUntil);
  for (const signoff of document.signoffs) {
    if (!exactKeys(signoff, SIGNOFF_FIELDS)) throw registryError("CONTENT_UED_SIGNOFF_INVALID");
    assertOpaqueRef(signoff.signoffId, "signoff", "CONTENT_UED_SIGNOFF_INVALID");
    assertOpaqueRef(signoff.signerRef, "actor", "CONTENT_UED_SIGNOFF_INVALID");
    assertOpaqueRef(signoff.validatorRef, "validator", "CONTENT_UED_SIGNOFF_INVALID");
    assertOpaqueRef(signoff.validationEvidenceRef, "evidence", "CONTENT_UED_SIGNOFF_INVALID");
    assertOpaqueRef(signoff.authorizationChainRef, "evidence", "CONTENT_UED_SIGNOFF_INVALID");
    const signedAt = parseTimestamp(signoff.signedAt, "CONTENT_UED_SIGNOFF_INVALID");
    const signoffUntil = parseTimestamp(signoff.validUntil, "CONTENT_UED_SIGNOFF_INVALID");
    if (
      !config.requiredRoles.includes(signoff.role)
      || signoff.evidenceKind !== document.evidenceKind
      || signoff.releaseRef !== document.releaseRef
      || signoff.environmentKind !== document.environmentKind
      || signoff.environmentRef !== document.environmentRef
      || signoff.evidencePayloadDigest !== payloadDigest
      || signoff.decision !== "APPROVED"
      || signedAt < documentFrom
      || signedAt > parseTimestamp(document.collectedAt)
      || signedAt > evaluatedAt
      || signoffUntil !== documentUntil
      || signoffUntil < evaluatedAt
      || !SIGNATURE_METHODS.includes(signoff.signatureMethod)
      || signoff.signedPayloadDigest !== computeContentUedSignoffPayloadDigest(signoff)
      || !validDigest(signoff.signatureDigest)
      || signoff.validationStatus !== "VALIDATED"
      || signoff.revocationStatus !== "ACTIVE"
      || signoff.revocationEvidenceRef !== null
      || seenRoles.has(signoff.role)
      || seenSignerRefs.has(signoff.signerRef)
      || seenSignoffIds.has(signoff.signoffId)
      || seenSignatureDigests.has(signoff.signatureDigest)
      || seenValidationEvidenceRefs.has(signoff.validationEvidenceRef)
      || seenAuthorizationChainRefs.has(signoff.authorizationChainRef)
    ) throw registryError("CONTENT_UED_SIGNOFF_INVALID");
    seenRoles.add(signoff.role);
    seenSignerRefs.add(signoff.signerRef);
    seenSignoffIds.add(signoff.signoffId);
    seenSignatureDigests.add(signoff.signatureDigest);
    seenValidationEvidenceRefs.add(signoff.validationEvidenceRef);
    seenAuthorizationChainRefs.add(signoff.authorizationChainRef);
  }
}

function validateEvidenceDocument(document, evaluatedAt, revocationSnapshotDigest) {
  if (!exactKeys(document, EVIDENCE_FIELDS) || document.recordType !== "ACCEPTANCE_EVIDENCE") {
    throw registryError("CONTENT_UED_EVIDENCE_INVALID");
  }
  rejectPlaceholderStrings(document);
  if (
    document.evidenceFormatVersion !== 1
    || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || document.productVersion !== PRODUCT_VERSION
    || !ENVIRONMENT_KINDS.includes(document.environmentKind)
    || !EVIDENCE_KINDS.includes(document.evidenceKind)
  ) throw registryError("CONTENT_UED_EVIDENCE_INVALID");
  assertOpaqueRef(document.releaseRef, "release", "CONTENT_UED_EVIDENCE_INVALID");
  assertOpaqueRef(document.environmentRef, "environment", "CONTENT_UED_EVIDENCE_INVALID");
  assertOpaqueRef(document.subjectRef, "subject", "CONTENT_UED_EVIDENCE_INVALID");
  assertDigest(document.revocationSnapshotDigest, "CONTENT_UED_REVOCATION_SNAPSHOT_INVALID");
  if (document.revocationSnapshotDigest !== revocationSnapshotDigest) {
    throw registryError("CONTENT_UED_REVOCATION_SNAPSHOT_INVALID");
  }
  validateInputBinding(document.inputBinding);
  const validFrom = parseTimestamp(document.validFrom);
  const validUntil = parseTimestamp(document.validUntil);
  const collectedAt = parseTimestamp(document.collectedAt);
  const maxValidity = CONFIG_BY_KIND[document.evidenceKind].maxValidityDays * MILLISECONDS_PER_DAY;
  if (
    validFrom > collectedAt
    || collectedAt > evaluatedAt
    || evaluatedAt > validUntil
    || validUntil <= validFrom
    || validUntil - validFrom > maxValidity
  ) throw registryError("CONTENT_UED_EVIDENCE_EXPIRED_OR_NOT_YET_VALID");
  validatePayload(document, evaluatedAt);
  validateSignoffs(document, evaluatedAt);
  return deepFreeze({
    recordType: document.recordType,
    productVersion: document.productVersion,
    releaseRef: document.releaseRef,
    environmentKind: document.environmentKind,
    environmentRef: document.environmentRef,
    evidenceKind: document.evidenceKind,
    subjectRef: document.subjectRef,
    evidencePayloadDigest: computeContentUedEvidencePayloadDigest(document),
    validUntil: document.validUntil,
    signoffCount: document.signoffs.length,
    validationLevel: "STRUCTURE_ONLY_UNTRUSTED_INPUT",
    structureValid: true,
    authorization: clone(AUTHORIZATION),
  });
}

function sameBinding(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertReleaseLevelDutySeparation(documents) {
  const rolesBySigner = new Map();
  const seenSignoffIds = new Set();
  const seenSignatureDigests = new Set();
  for (const document of documents) {
    for (const signoff of document.signoffs) {
      if (seenSignoffIds.has(signoff.signoffId) || seenSignatureDigests.has(signoff.signatureDigest)) {
        throw registryError("CONTENT_UED_SIGNOFF_REPLAY_REJECTED");
      }
      seenSignoffIds.add(signoff.signoffId);
      seenSignatureDigests.add(signoff.signatureDigest);
      const roles = rolesBySigner.get(signoff.signerRef) || new Set();
      roles.add(signoff.role);
      rolesBySigner.set(signoff.signerRef, roles);
    }
  }
  for (const roles of rolesBySigner.values()) {
    if (ROLE_CONFLICTS.some(([left, right]) => roles.has(left) && roles.has(right))) {
      throw registryError("CONTENT_UED_SIGNOFF_DUTY_CONFLICT");
    }
  }
}

function validateEnvironmentBundle(bundle, evaluatedAt, revocationSnapshotDigest) {
  if (!exactKeys(bundle, ENVIRONMENT_BUNDLE_FIELDS)
    || bundle.recordType !== "ENVIRONMENT_ACCEPTANCE_BUNDLE") {
    throw registryError("CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID");
  }
  rejectPlaceholderStrings(bundle);
  if (
    bundle.bundleFormatVersion !== 1
    || bundle.productVersion !== PRODUCT_VERSION
    || !ENVIRONMENT_KINDS.includes(bundle.environmentKind)
  ) throw registryError("CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID");
  assertOpaqueRef(bundle.releaseRef, "release", "CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID");
  assertOpaqueRef(
    bundle.environmentRef,
    "environment",
    "CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID"
  );
  validateInputBinding(bundle.inputBinding);
  if (!Array.isArray(bundle.evidenceDocuments) || bundle.evidenceDocuments.length !== EVIDENCE_KINDS.length) {
    throw registryError("CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID");
  }
  const evidenceResults = [];
  const seenKinds = new Set();
  for (const document of bundle.evidenceDocuments) {
    if (
      document.releaseRef !== bundle.releaseRef
      || document.environmentKind !== bundle.environmentKind
      || document.environmentRef !== bundle.environmentRef
      || !sameBinding(document.inputBinding, bundle.inputBinding)
      || seenKinds.has(document.evidenceKind)
    ) throw registryError("CONTENT_UED_CROSS_ENVIRONMENT_MIXING_REJECTED");
    const result = validateEvidenceDocument(document, evaluatedAt, revocationSnapshotDigest);
    seenKinds.add(document.evidenceKind);
    evidenceResults.push(result);
  }
  if (!EVIDENCE_KINDS.every((kind) => seenKinds.has(kind))) {
    throw registryError("CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID");
  }
  assertReleaseLevelDutySeparation(bundle.evidenceDocuments);
  evidenceResults.sort((left, right) => EVIDENCE_KINDS.indexOf(left.evidenceKind)
    - EVIDENCE_KINDS.indexOf(right.evidenceKind));
  return deepFreeze({
    recordType: bundle.recordType,
    productVersion: bundle.productVersion,
    releaseRef: bundle.releaseRef,
    environmentKind: bundle.environmentKind,
    environmentRef: bundle.environmentRef,
    evidenceResults,
    validationLevel: "STRUCTURE_ONLY_UNTRUSTED_INPUT",
    allEvidenceStructureValid: true,
    authorization: clone(AUTHORIZATION),
  });
}

function validateReleaseBundle(bundle, evaluatedAt, revocationSnapshotDigest) {
  if (!exactKeys(bundle, RELEASE_BUNDLE_FIELDS) || bundle.recordType !== "RELEASE_ACCEPTANCE_BUNDLE") {
    throw registryError("CONTENT_UED_RELEASE_BUNDLE_INVALID");
  }
  rejectPlaceholderStrings(bundle);
  if (bundle.bundleFormatVersion !== 1 || bundle.productVersion !== PRODUCT_VERSION) {
    throw registryError("CONTENT_UED_RELEASE_BUNDLE_INVALID");
  }
  assertOpaqueRef(bundle.releaseRef, "release", "CONTENT_UED_RELEASE_BUNDLE_INVALID");
  validateInputBinding(bundle.inputBinding);
  if (!Array.isArray(bundle.environmentBundles)
    || bundle.environmentBundles.length !== ENVIRONMENT_KINDS.length) {
    throw registryError("CONTENT_UED_RELEASE_BUNDLE_INVALID");
  }
  const environments = [];
  const seenKinds = new Set();
  const seenRefs = new Set();
  for (const environmentBundle of bundle.environmentBundles) {
    if (
      environmentBundle.releaseRef !== bundle.releaseRef
      || !sameBinding(environmentBundle.inputBinding, bundle.inputBinding)
      || seenKinds.has(environmentBundle.environmentKind)
      || seenRefs.has(environmentBundle.environmentRef)
    ) throw registryError("CONTENT_UED_CROSS_ENVIRONMENT_MIXING_REJECTED");
    const result = validateEnvironmentBundle(environmentBundle, evaluatedAt, revocationSnapshotDigest);
    seenKinds.add(result.environmentKind);
    seenRefs.add(result.environmentRef);
    environments.push(result);
  }
  if (!ENVIRONMENT_KINDS.every((kind) => seenKinds.has(kind))) {
    throw registryError("CONTENT_UED_RELEASE_BUNDLE_INVALID");
  }
  assertReleaseLevelDutySeparation(bundle.environmentBundles.flatMap((item) => item.evidenceDocuments));
  environments.sort((left, right) => ENVIRONMENT_KINDS.indexOf(left.environmentKind)
    - ENVIRONMENT_KINDS.indexOf(right.environmentKind));
  return deepFreeze({
    recordType: bundle.recordType,
    productVersion: bundle.productVersion,
    releaseRef: bundle.releaseRef,
    environments,
    validationLevel: "STRUCTURE_ONLY_UNTRUSTED_INPUT",
    allEnvironmentStructuresValid: true,
    authorization: clone(AUTHORIZATION),
  });
}

function validateContract(manifest) {
  if (!exactKeys(manifest, MANIFEST_FIELDS)
    || manifest.registryVersion !== 1
    || manifest.contractVersion !== CONTRACT_VERSION
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.scope !== CONTRACT_STATUS
    || manifest.digestAlgorithm !== "SHA-256"
    || !sameArray(manifest.requiredEnvironmentKinds, ENVIRONMENT_KINDS)
    || !sameArray(manifest.allowedSignatureMethods, SIGNATURE_METHODS)
    || !exactKeys(manifest.canonicalization, CANONICALIZATION_FIELDS)
    || manifest.canonicalization.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || manifest.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || manifest.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || manifest.canonicalization.undefinedPolicy !== "REJECT"
    || manifest.canonicalization.digestDomainSeparation !== "CONTENT_UED_AUTHORIZATION_EVIDENCE_V1"
    || manifest.canonicalization.photographyAssetSetProjection
      !== "ASSET_REF_AND_CLEAN_MASTER_DIGEST_ONLY"
    || manifest.canonicalization.photographyAssetSetOrdering
      !== "ASSET_REF_THEN_CLEAN_MASTER_DIGEST_UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.photographyAssetSetDigestDomain
      !== PHOTOGRAPHY_ASSET_SET_DIGEST_DOMAIN
    || !exactKeys(manifest.recordSchema, RECORD_SCHEMA_FIELDS)
    || !exactKeys(manifest.authorization, Object.keys(AUTHORIZATION))
    || canonicalJson(manifest.authorization) !== canonicalJson(AUTHORIZATION)
  ) throw registryError("CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID");
  if (!Array.isArray(manifest.evidenceKinds) || manifest.evidenceKinds.length !== EVIDENCE_CONFIG.length) {
    throw registryError("CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID");
  }
  for (let index = 0; index < EVIDENCE_CONFIG.length; index += 1) {
    const actual = manifest.evidenceKinds[index];
    const expected = EVIDENCE_CONFIG[index];
    if (
      !exactKeys(actual, ["evidenceKind", "requiredRoles", "maxValidityDays"])
      || actual.evidenceKind !== expected.evidenceKind
      || !sameArray(actual.requiredRoles, expected.requiredRoles)
      || actual.maxValidityDays !== expected.maxValidityDays
    ) throw registryError("CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID");
  }
  for (const [field, expected] of Object.entries(SCHEMA_FIELD_BINDINGS)) {
    if (!sameArray(manifest.recordSchema[field], expected)) {
      throw registryError("CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID");
    }
  }
  if (canonicalJson(manifest.recordSchema.opaqueReferencePatterns)
    !== canonicalJson(OPAQUE_PATTERN_SOURCES)) {
    throw registryError("CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID");
  }
}

function evaluateInput(input, evaluatedAt, revocationSnapshotDigest) {
  if (!plainRecord(input)) throw registryError("CONTENT_UED_RECORD_INVALID");
  switch (input.recordType) {
    case "ACCEPTANCE_EVIDENCE":
      return validateEvidenceDocument(input, evaluatedAt, revocationSnapshotDigest);
    case "ENVIRONMENT_ACCEPTANCE_BUNDLE":
      return validateEnvironmentBundle(input, evaluatedAt, revocationSnapshotDigest);
    case "RELEASE_ACCEPTANCE_BUNDLE":
      return validateReleaseBundle(input, evaluatedAt, revocationSnapshotDigest);
    default:
      throw registryError("CONTENT_UED_RECORD_INVALID");
  }
}

function createContentUedAuthorizationRegistry({ manifest } = {}) {
  const loadedManifest = manifest || JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"));
  validateContract(loadedManifest);
  const frozenManifest = deepFreeze(clone(loadedManifest));
  const registryDigest = computeContentUedAuthorizationRegistryDigest(frozenManifest);

  function evaluate(input, options) {
    if (!exactKeys(options, ["evaluatedAt", "revocationSnapshotDigest"])) {
      throw registryError("CONTENT_UED_EVALUATION_CONTEXT_INVALID");
    }
    const evaluatedAt = parseTimestamp(options.evaluatedAt, "CONTENT_UED_EVALUATION_CONTEXT_INVALID");
    assertDigest(options.revocationSnapshotDigest, "CONTENT_UED_EVALUATION_CONTEXT_INVALID");
    return evaluateInput(input, evaluatedAt, options.revocationSnapshotDigest);
  }

  function seal(input, options) {
    const result = evaluate(input, options);
    return deepFreeze({
      envelopeFormatVersion: 1,
      evaluatedAt: options.evaluatedAt,
      revocationSnapshotDigest: options.revocationSnapshotDigest,
      input: clone(input),
      inputDigest: digest("myroot-content-ued-record:v1", input),
      result,
      resultDigest: digest("myroot-content-ued-evaluation:v1", result),
      authorization: clone(AUTHORIZATION),
    });
  }

  function verify(envelope, options) {
    try {
      if (!exactKeys(options, ["verifiedAt", "revocationSnapshotDigest"])) return false;
      const verifiedAt = parseTimestamp(options.verifiedAt, "CONTENT_UED_VERIFICATION_CONTEXT_INVALID");
      assertDigest(options.revocationSnapshotDigest, "CONTENT_UED_VERIFICATION_CONTEXT_INVALID");
      if (!exactKeys(envelope, [
        "envelopeFormatVersion",
        "evaluatedAt",
        "revocationSnapshotDigest",
        "input",
        "inputDigest",
        "result",
        "resultDigest",
        "authorization",
      ]) || envelope.envelopeFormatVersion !== 1) return false;
      if (
        verifiedAt < parseTimestamp(envelope.evaluatedAt)
        || options.revocationSnapshotDigest !== envelope.revocationSnapshotDigest
      ) return false;
      const result = evaluate(envelope.input, {
        evaluatedAt: options.verifiedAt,
        revocationSnapshotDigest: options.revocationSnapshotDigest,
      });
      return envelope.inputDigest === digest("myroot-content-ued-record:v1", envelope.input)
        && envelope.resultDigest === digest("myroot-content-ued-evaluation:v1", result)
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
        registryDigest,
        requiredEnvironmentKinds: clone(ENVIRONMENT_KINDS),
        evidenceKinds: clone(EVIDENCE_CONFIG),
        authorization: clone(AUTHORIZATION),
      });
    },
    evaluate,
    seal,
    verify,
  });
}

let defaultRegistry;

function getDefaultContentUedAuthorizationRegistry() {
  if (!defaultRegistry) defaultRegistry = createContentUedAuthorizationRegistry();
  return defaultRegistry;
}

module.exports = {
  computeContentUedAuthorizationRegistryDigest,
  computeContentUedEvidencePayloadDigest,
  computeContentUedSignoffPayloadDigest,
  createContentUedAuthorizationRegistry,
  getDefaultContentUedAuthorizationRegistry,
};
