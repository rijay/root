const crypto = require("node:crypto");

const {
  computeContentUedEvidencePayloadDigest,
  getDefaultContentUedAuthorizationRegistry,
} = require("./contentUedAuthorizationRegistry");

const VALIDATION_LEVEL = "TRUSTED_RECEIPT_RESOLUTION_WITHOUT_AUTHORIZATION";
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
const EVIDENCE_KINDS = Object.freeze([
  "HEALTH_CONTENT",
  "PRIVACY_COMPLIANCE",
  "ACTIVITY_OPERATIONS",
  "UED_HANDOFF",
  "PHOTOGRAPHY_RIGHTS",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_REF = /^(?:artifact|evidence|policy|asset|actor|validator|signoff|release|environment|subject):sha256:[a-f0-9]{64}$/;
const RELEASE_REF = /^release:sha256:[a-f0-9]{64}$/;
const ENVIRONMENT_REF = /^environment:sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFAULT_MAXIMUM_RECEIPT_AGE_SECONDS = 300;
const DEFAULT_MAXIMUM_REVOCATION_AGE_SECONDS = 300;

const RECEIPT_FIELDS = Object.freeze([
  "receiptType",
  "receiptVersion",
  "adapterId",
  "receiptId",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "evidenceKind",
  "subjectRef",
  "structureBundleBytesDigest",
  "evidencePayloadDigest",
  "resolvedRefs",
  "sourceBytesDigest",
  "resolvedAt",
  "validUntil",
  "revocationSnapshotDigest",
  "status",
  "facts",
  "authorization",
]);
const RESOLVED_REF_FIELDS = Object.freeze(["ref", "bytesDigest", "status"]);
const REVOCATION_FIELDS = Object.freeze([
  "receiptType",
  "receiptVersion",
  "adapterId",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "snapshotDigest",
  "sequence",
  "observedAt",
  "validUntil",
  "status",
]);

function resolverError(code) {
  const error = new Error("Content/UED trusted evidence resolution rejected the input");
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function domainDigest(domain, value) {
  return sha256(`${domain}\0${JSON.stringify(value)}`);
}

function validDigest(value) {
  return typeof value === "string"
    && SHA256.test(value)
    && !/^(.)\1{63}$/.test(value);
}

function parseTimestamp(value, code) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) throw resolverError(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw resolverError(code);
  }
  return milliseconds;
}

function trustedNow(trustedClock) {
  const value = trustedClock();
  const normalized = value instanceof Date ? value.toISOString() : value;
  return {
    iso: normalized,
    milliseconds: parseTimestamp(normalized, "CONTENT_UED_TRUSTED_CLOCK_INVALID"),
  };
}

function bytesFromInput(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === "string" && value.length > 0) return Buffer.from(value, "utf8");
  throw resolverError("CONTENT_UED_TRUSTED_BUNDLE_BYTES_REQUIRED");
}

function parseBundle(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw resolverError("CONTENT_UED_TRUSTED_BUNDLE_JSON_INVALID");
  }
  if (!plainRecord(value) || value.recordType !== "ENVIRONMENT_ACCEPTANCE_BUNDLE") {
    throw resolverError("CONTENT_UED_TRUSTED_ENVIRONMENT_BUNDLE_REQUIRED");
  }
  return value;
}

function assertExpectedBinding(bundle, expected) {
  if (bundle.releaseRef !== expected.expectedReleaseRef
    || bundle.environmentKind !== expected.expectedEnvironmentKind
    || bundle.environmentRef !== expected.expectedEnvironmentRef) {
    throw resolverError("CONTENT_UED_TRUSTED_RELEASE_ENVIRONMENT_MISMATCH");
  }
}

function assertCurrentWindow({ observedAt, validUntil, now, maximumAgeSeconds, staleCode }) {
  const observed = parseTimestamp(observedAt, staleCode);
  const until = parseTimestamp(validUntil, staleCode);
  if (observed > now.milliseconds
    || until < now.milliseconds
    || now.milliseconds - observed > maximumAgeSeconds * 1000) {
    throw resolverError(staleCode);
  }
}

function assertAuthorizationFalse(value) {
  if (!exactKeys(value, Object.keys(AUTHORIZATION))
    || Object.keys(AUTHORIZATION).some((key) => value[key] !== false)) {
    throw resolverError("CONTENT_UED_TRUSTED_AUTHORIZATION_FORBIDDEN");
  }
}

function payloadOpaqueRefs(value, output = new Set()) {
  if (typeof value === "string" && OPAQUE_REF.test(value)) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => payloadOpaqueRefs(item, output));
  else if (plainRecord(value)) Object.values(value).forEach((item) => payloadOpaqueRefs(item, output));
  return [...output].sort();
}

function resolvedRefSetDigest(resolvedRefs) {
  return domainDigest(
    "myroot-content-ued-trusted-resolved-reference-set:v1",
    resolvedRefs.map((item) => ({ ref: item.ref, bytesDigest: item.bytesDigest }))
  );
}

function validateResolvedRefs(receipt, document) {
  if (!Array.isArray(receipt.resolvedRefs)) {
    throw resolverError("CONTENT_UED_TRUSTED_REFERENCE_UNRESOLVED");
  }
  const expectedRefs = payloadOpaqueRefs(document.payload);
  const actualRefs = [];
  const seen = new Set();
  for (const entry of receipt.resolvedRefs) {
    if (!exactKeys(entry, RESOLVED_REF_FIELDS)
      || !OPAQUE_REF.test(entry.ref)
      || !validDigest(entry.bytesDigest)
      || entry.status !== "RESOLVED_CURRENT"
      || seen.has(entry.ref)) {
      throw resolverError("CONTENT_UED_TRUSTED_REFERENCE_UNRESOLVED");
    }
    seen.add(entry.ref);
    actualRefs.push(entry.ref);
  }
  actualRefs.sort();
  if (actualRefs.length !== expectedRefs.length
    || actualRefs.some((ref, index) => ref !== expectedRefs[index])) {
    throw resolverError("CONTENT_UED_TRUSTED_REFERENCE_UNRESOLVED");
  }
  const ordered = [...receipt.resolvedRefs].sort((left, right) => left.ref.localeCompare(right.ref));
  if (receipt.sourceBytesDigest !== resolvedRefSetDigest(ordered)) {
    throw resolverError("CONTENT_UED_TRUSTED_SOURCE_BYTES_MISMATCH");
  }
  return new Map(ordered.map((entry) => [entry.ref, entry.bytesDigest]));
}

function assertExactFacts(value, fields, code) {
  if (!exactKeys(value, fields)) throw resolverError(code);
}

function validateHealthFacts(receipt, document, refs) {
  const facts = receipt.facts;
  assertExactFacts(facts, [
    "contentItems",
    "commercialOnlineUseAllowed",
    "redFlagSopState",
    "humanSupportRouteState",
  ], "CONTENT_UED_TRUSTED_HEALTH_FACTS_INVALID");
  if (!Array.isArray(facts.contentItems)
    || facts.contentItems.length !== document.payload.configuredContentCount
    || facts.commercialOnlineUseAllowed !== true
    || facts.redFlagSopState !== "ACTIVE_CURRENT"
    || facts.humanSupportRouteState !== "ACTIVE_CURRENT"
    || refs.get(document.payload.contentBundleRef) !== document.payload.sourceArtifactDigest) {
    throw resolverError("CONTENT_UED_TRUSTED_HEALTH_FACTS_INVALID");
  }
  const ids = new Set();
  for (const item of facts.contentItems) {
    if (!exactKeys(item, [
      "contentId",
      "contentVersion",
      "sourceBytesDigest",
      "approvedChineseBytesDigest",
      "state",
    ])
      || typeof item.contentId !== "string" || !item.contentId
      || typeof item.contentVersion !== "string" || !item.contentVersion
      || !validDigest(item.sourceBytesDigest)
      || !validDigest(item.approvedChineseBytesDigest)
      || item.state !== "RESOLVED_CURRENT"
      || ids.has(item.contentId)) {
      throw resolverError("CONTENT_UED_TRUSTED_HEALTH_FACTS_INVALID");
    }
    ids.add(item.contentId);
  }
  return { state: "HEALTH_CONTENT_RESOLVED_CURRENT", count: facts.contentItems.length };
}

function validatePrivacyFacts(receipt, document) {
  const facts = receipt.facts;
  assertExactFacts(facts, [
    "implementationBytesDigest",
    "controlEvidenceRefs",
    "candidateRuntimeExerciseState",
    "healthWritesFailClosed",
  ], "CONTENT_UED_TRUSTED_PRIVACY_FACTS_INVALID");
  const expectedRefs = [
    "dpiaEvidenceRef",
    "dataFlowEvidenceRef",
    "processorRegisterRef",
    "retentionDeletionMatrixRef",
    "consentLifecycleEvidenceRef",
    "accessAndKeyControlEvidenceRef",
    "incidentResponseDrillEvidenceRef",
    "wechatPrivacyParityEvidenceRef",
    "candidateRuntimeExerciseEvidenceRef",
  ].map((field) => document.payload[field]).sort();
  const actualRefs = Array.isArray(facts.controlEvidenceRefs)
    ? [...facts.controlEvidenceRefs].sort()
    : [];
  if (facts.implementationBytesDigest !== document.payload.implementationSnapshotDigest
    || actualRefs.length !== expectedRefs.length
    || actualRefs.some((ref, index) => ref !== expectedRefs[index])
    || new Set(actualRefs).size !== actualRefs.length
    || facts.candidateRuntimeExerciseState !== "PASSED_CURRENT"
    || facts.healthWritesFailClosed !== true) {
    throw resolverError("CONTENT_UED_TRUSTED_PRIVACY_FACTS_INVALID");
  }
  return { state: "PRIVACY_CONTROLS_RESOLVED_CURRENT", count: actualRefs.length };
}

function validateActivityFacts(receipt, document, refs) {
  const facts = receipt.facts;
  assertExactFacts(facts, [
    "implementationBytesDigest",
    "publishedActivities",
    "contentSource",
    "placeholderExcluded",
  ], "CONTENT_UED_TRUSTED_ACTIVITY_FACTS_INVALID");
  if (!Array.isArray(facts.publishedActivities)
    || facts.implementationBytesDigest !== document.payload.implementationSnapshotDigest
    || facts.contentSource !== "OPS_BACKEND"
    || facts.placeholderExcluded !== true
    || facts.publishedActivities.length !== document.payload.publishedActivityCount) {
    throw resolverError("CONTENT_UED_TRUSTED_ACTIVITY_FACTS_INVALID");
  }
  const ids = new Set();
  for (const activity of facts.publishedActivities) {
    if (!exactKeys(activity, [
      "activityId",
      "activityVersionId",
      "publicationRequestId",
      "contentBytesDigest",
      "state",
    ])
      || typeof activity.activityId !== "string" || !activity.activityId
      || typeof activity.activityVersionId !== "string" || !activity.activityVersionId
      || typeof activity.publicationRequestId !== "string" || !activity.publicationRequestId
      || !validDigest(activity.contentBytesDigest)
      || activity.state !== "PUBLISHED"
      || ids.has(activity.activityVersionId)) {
      throw resolverError(activity.state === "WITHDRAWN"
        ? "CONTENT_UED_TRUSTED_ACTIVITY_WITHDRAWN"
        : "CONTENT_UED_TRUSTED_ACTIVITY_FACTS_INVALID");
    }
    ids.add(activity.activityVersionId);
  }
  if (facts.publishedActivities.length === 1
    && refs.get(document.payload.firstReleaseContentRef)
      !== facts.publishedActivities[0].contentBytesDigest) {
    throw resolverError("CONTENT_UED_TRUSTED_ACTIVITY_FACTS_INVALID");
  }
  return { state: "ACTIVITY_PUBLICATION_RESOLVED_CURRENT", count: facts.publishedActivities.length };
}

function validateUedFacts(receipt, document, refs) {
  const facts = receipt.facts;
  assertExactFacts(facts, [
    "screenIndexBytesDigest",
    "interactionSpecBytesDigest",
    "accessibilitySpecBytesDigest",
    "screens",
    "implementationParityState",
    "archivedPagesExcluded",
  ], "CONTENT_UED_TRUSTED_UED_FACTS_INVALID");
  if (facts.screenIndexBytesDigest !== document.payload.screenIndexDigest
    || refs.get(document.payload.controlledHandoffIndexRef) !== facts.screenIndexBytesDigest
    || facts.interactionSpecBytesDigest !== document.payload.interactionSpecDigest
    || facts.accessibilitySpecBytesDigest !== document.payload.accessibilitySpecDigest
    || !Array.isArray(facts.screens)
    || facts.screens.length !== document.payload.screenCount
    || facts.implementationParityState !== "PASSED_CURRENT"
    || facts.archivedPagesExcluded !== true) {
    throw resolverError("CONTENT_UED_TRUSTED_UED_FACTS_INVALID");
  }
  const ids = new Set();
  for (const screen of facts.screens) {
    if (!exactKeys(screen, [
      "screenId",
      "controlledNodeRef",
      "routeId",
      "acceptanceCriteriaIds",
      "canonicalStates",
      "conditionalStates",
      "screenBytesDigest",
      "archived",
    ])
      || typeof screen.screenId !== "string" || !screen.screenId
      || typeof screen.controlledNodeRef !== "string" || !screen.controlledNodeRef
      || typeof screen.routeId !== "string" || !screen.routeId
      || !Array.isArray(screen.acceptanceCriteriaIds) || screen.acceptanceCriteriaIds.length === 0
      || !Array.isArray(screen.canonicalStates) || screen.canonicalStates.length === 0
      || !Array.isArray(screen.conditionalStates) || screen.conditionalStates.length === 0
      || !validDigest(screen.screenBytesDigest)
      || screen.archived !== false
      || ids.has(screen.screenId)) {
      throw resolverError("CONTENT_UED_TRUSTED_UED_STATE_COVERAGE_MISSING");
    }
    ids.add(screen.screenId);
  }
  return { state: "UED_HANDOFF_RESOLVED_CURRENT", count: facts.screens.length };
}

function rightsMetadataProjection(asset) {
  return {
    assetRef: asset.assetRef,
    modelReleaseRequirement: asset.modelReleaseRequirement,
    modelReleaseRef: asset.modelReleaseRef,
    propertyReleaseRequirement: asset.propertyReleaseRequirement,
    propertyReleaseRef: asset.propertyReleaseRef,
    thirdPartyRightsRequirement: asset.thirdPartyRightsRequirement,
    thirdPartyRightsEvidenceRef: asset.thirdPartyRightsEvidenceRef,
    allowedUsePolicyRef: asset.allowedUsePolicyRef,
    territoryPolicyRef: asset.territoryPolicyRef,
    attributionPolicyRef: asset.attributionPolicyRef,
    expiryOwnerRef: asset.expiryOwnerRef,
    validFrom: asset.validFrom,
    validUntil: asset.validUntil,
    rightsStatus: asset.rightsStatus,
    revokedAt: asset.revokedAt,
    revocationEvidenceRef: asset.revocationEvidenceRef,
    wechatMiniProgramUseAllowed: asset.wechatMiniProgramUseAllowed,
    commercialUseAllowed: asset.commercialUseAllowed,
    cropResizeAllowed: asset.cropResizeAllowed,
    retouchCompositeAllowed: asset.retouchCompositeAllowed,
    textOverlayAllowed: asset.textOverlayAllowed,
    cleanMasterConfirmed: asset.cleanMasterConfirmed,
  };
}

function rightsMetadataDigest(asset) {
  return domainDigest("myroot-content-ued-photography-rights-metadata:v1", rightsMetadataProjection(asset));
}

function validatePhotographyFacts(receipt, document, refs) {
  const facts = receipt.facts;
  assertExactFacts(facts, ["assetRightsIndexBytesDigest", "assets"], "CONTENT_UED_TRUSTED_PHOTOGRAPHY_FACTS_INVALID");
  if (!validDigest(facts.assetRightsIndexBytesDigest)
    || refs.get(document.payload.assetRightsIndexRef) !== facts.assetRightsIndexBytesDigest
    || !Array.isArray(facts.assets)
    || facts.assets.length !== document.payload.assets.length) {
    throw resolverError("CONTENT_UED_TRUSTED_PHOTOGRAPHY_FACTS_INVALID");
  }
  const byRef = new Map(document.payload.assets.map((asset) => [asset.assetRef, asset]));
  const seen = new Set();
  for (const fact of facts.assets) {
    if (!exactKeys(fact, [
      "assetRef",
      "cleanMasterBytesDigest",
      "rightsMetadataDigest",
      "rightsState",
      "notApplicableEvidence",
    ]) || seen.has(fact.assetRef)) {
      throw resolverError("CONTENT_UED_TRUSTED_PHOTOGRAPHY_FACTS_INVALID");
    }
    const asset = byRef.get(fact.assetRef);
    if (!asset
      || fact.cleanMasterBytesDigest !== asset.cleanMasterDigest
      || fact.rightsMetadataDigest !== rightsMetadataDigest(asset)
      || fact.rightsState !== "ACTIVE_CURRENT"
      || !plainRecord(fact.notApplicableEvidence)) {
      throw resolverError("CONTENT_UED_TRUSTED_PHOTOGRAPHY_RIGHTS_DRIFT");
    }
    const expectedNa = [];
    for (const field of [
      "modelReleaseRequirement",
      "propertyReleaseRequirement",
      "thirdPartyRightsRequirement",
    ]) if (asset[field] === "NOT_APPLICABLE") expectedNa.push(field);
    if (!exactKeys(fact.notApplicableEvidence, expectedNa)
      || expectedNa.some((field) => !validDigest(fact.notApplicableEvidence[field]))) {
      throw resolverError("CONTENT_UED_TRUSTED_PHOTOGRAPHY_NA_UNSUPPORTED");
    }
    seen.add(fact.assetRef);
  }
  return { state: "PHOTOGRAPHY_RIGHTS_RESOLVED_CURRENT", count: facts.assets.length };
}

function validateDomainFacts(receipt, document, refs) {
  switch (document.evidenceKind) {
    case "HEALTH_CONTENT": return validateHealthFacts(receipt, document, refs);
    case "PRIVACY_COMPLIANCE": return validatePrivacyFacts(receipt, document);
    case "ACTIVITY_OPERATIONS": return validateActivityFacts(receipt, document, refs);
    case "UED_HANDOFF": return validateUedFacts(receipt, document, refs);
    case "PHOTOGRAPHY_RIGHTS": return validatePhotographyFacts(receipt, document, refs);
    default: throw resolverError("CONTENT_UED_TRUSTED_EVIDENCE_KIND_INVALID");
  }
}

function validateRevocationReceipt(receipt, binding, expectedAdapterId, now, maximumAgeSeconds) {
  if (!exactKeys(receipt, REVOCATION_FIELDS)
    || receipt.receiptType !== "TRUSTED_REVOCATION_SNAPSHOT_RECEIPT"
    || receipt.receiptVersion !== 1
    || receipt.adapterId !== expectedAdapterId
    || receipt.releaseRef !== binding.expectedReleaseRef
    || receipt.environmentKind !== binding.expectedEnvironmentKind
    || receipt.environmentRef !== binding.expectedEnvironmentRef
    || !validDigest(receipt.snapshotDigest)
    || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1
    || receipt.status !== "CURRENT") {
    throw resolverError("CONTENT_UED_TRUSTED_REVOCATION_RECEIPT_INVALID");
  }
  assertCurrentWindow({
    observedAt: receipt.observedAt,
    validUntil: receipt.validUntil,
    now,
    maximumAgeSeconds,
    staleCode: "CONTENT_UED_TRUSTED_REVOCATION_STALE_OR_ROLLBACK",
  });
  return receipt;
}

function validateEvidenceReceipt(receipt, document, context) {
  if (!exactKeys(receipt, RECEIPT_FIELDS)
    || receipt.receiptType !== "TRUSTED_CONTENT_UED_EVIDENCE_RECEIPT"
    || receipt.receiptVersion !== 1
    || receipt.adapterId !== context.expectedAdapterId
    || typeof receipt.receiptId !== "string" || !receipt.receiptId
    || receipt.releaseRef !== context.binding.expectedReleaseRef
    || receipt.environmentKind !== context.binding.expectedEnvironmentKind
    || receipt.environmentRef !== context.binding.expectedEnvironmentRef
    || receipt.evidenceKind !== document.evidenceKind
    || receipt.subjectRef !== document.subjectRef
    || receipt.structureBundleBytesDigest !== context.bundleBytesDigest
    || receipt.evidencePayloadDigest !== computeContentUedEvidencePayloadDigest(document)
    || receipt.revocationSnapshotDigest !== context.revocation.snapshotDigest
    || receipt.status !== "RESOLVED_CURRENT") {
    throw resolverError("CONTENT_UED_TRUSTED_RECEIPT_BINDING_INVALID");
  }
  assertAuthorizationFalse(receipt.authorization);
  assertCurrentWindow({
    observedAt: receipt.resolvedAt,
    validUntil: receipt.validUntil,
    now: context.now,
    maximumAgeSeconds: context.maximumReceiptAgeSeconds,
    staleCode: "CONTENT_UED_TRUSTED_RECEIPT_STALE_OR_ROLLBACK",
  });
  const refs = validateResolvedRefs(receipt, document);
  const derived = validateDomainFacts(receipt, document, refs);
  return deepFreeze({
    evidenceKind: document.evidenceKind,
    subjectRef: document.subjectRef,
    receiptId: receipt.receiptId,
    evidencePayloadDigest: receipt.evidencePayloadDigest,
    state: derived.state,
    derivedCount: derived.count,
    resolvedReferenceCount: refs.size,
  });
}

function createContentUedTrustedEvidenceResolver({
  trustedEvidenceAdapter,
  expectedAdapterId,
  trustedClock = () => new Date(),
  structureRegistry = getDefaultContentUedAuthorizationRegistry(),
  maximumReceiptAgeSeconds = DEFAULT_MAXIMUM_RECEIPT_AGE_SECONDS,
  maximumRevocationAgeSeconds = DEFAULT_MAXIMUM_REVOCATION_AGE_SECONDS,
} = {}) {
  if (!trustedEvidenceAdapter
    || typeof trustedEvidenceAdapter.resolveRevocationSnapshot !== "function"
    || typeof trustedEvidenceAdapter.resolveEvidenceReceipt !== "function"
    || typeof expectedAdapterId !== "string" || !expectedAdapterId
    || typeof trustedClock !== "function"
    || !structureRegistry || typeof structureRegistry.evaluate !== "function"
    || !Number.isSafeInteger(maximumReceiptAgeSeconds) || maximumReceiptAgeSeconds < 1
    || !Number.isSafeInteger(maximumRevocationAgeSeconds) || maximumRevocationAgeSeconds < 1) {
    throw resolverError("CONTENT_UED_TRUSTED_RESOLVER_CONFIGURATION_INVALID");
  }

  return deepFreeze({
    async resolveEnvironmentBundle({
      structureBundleBytes,
      expectedReleaseRef,
      expectedEnvironmentKind,
      expectedEnvironmentRef,
    } = {}) {
      const binding = { expectedReleaseRef, expectedEnvironmentKind, expectedEnvironmentRef };
      if (typeof expectedReleaseRef !== "string" || !RELEASE_REF.test(expectedReleaseRef)
        || !["CANDIDATE", "PRODUCTION"].includes(expectedEnvironmentKind)
        || typeof expectedEnvironmentRef !== "string" || !ENVIRONMENT_REF.test(expectedEnvironmentRef)) {
        throw resolverError("CONTENT_UED_TRUSTED_EXPECTED_BINDING_INVALID");
      }
      const bytes = bytesFromInput(structureBundleBytes);
      const bundleBytesDigest = sha256(bytes);
      const bundle = parseBundle(bytes);
      assertExpectedBinding(bundle, binding);
      const now = trustedNow(trustedClock);
      const revocation = validateRevocationReceipt(
        await trustedEvidenceAdapter.resolveRevocationSnapshot({
          releaseRef: expectedReleaseRef,
          environmentKind: expectedEnvironmentKind,
          environmentRef: expectedEnvironmentRef,
          observedAt: now.iso,
        }),
        binding,
        expectedAdapterId,
        now,
        maximumRevocationAgeSeconds
      );

      // The structure Registry remains an untrusted-input validator. It receives
      // only the trusted clock and current revocation snapshot, never caller time.
      const structureResult = structureRegistry.evaluate(bundle, {
        evaluatedAt: now.iso,
        revocationSnapshotDigest: revocation.snapshotDigest,
      });
      if (structureResult.validationLevel !== "STRUCTURE_ONLY_UNTRUSTED_INPUT"
        || structureResult.authorization.gateClosureAuthorized !== false) {
        throw resolverError("CONTENT_UED_TRUSTED_STRUCTURE_AUTHORITY_ESCALATION");
      }

      const evidenceResults = [];
      const seenReceiptIds = new Set();
      for (const document of bundle.evidenceDocuments) {
        const receipt = await trustedEvidenceAdapter.resolveEvidenceReceipt({
          releaseRef: expectedReleaseRef,
          environmentKind: expectedEnvironmentKind,
          environmentRef: expectedEnvironmentRef,
          evidenceKind: document.evidenceKind,
          subjectRef: document.subjectRef,
          evidencePayloadDigest: computeContentUedEvidencePayloadDigest(document),
          structureBundleBytesDigest: bundleBytesDigest,
          revocationSnapshotDigest: revocation.snapshotDigest,
          observedAt: now.iso,
        });
        const result = validateEvidenceReceipt(receipt, document, {
          expectedAdapterId,
          binding,
          bundleBytesDigest,
          revocation,
          now,
          maximumReceiptAgeSeconds,
        });
        if (seenReceiptIds.has(result.receiptId)) {
          throw resolverError("CONTENT_UED_TRUSTED_RECEIPT_REPLAY_REJECTED");
        }
        seenReceiptIds.add(result.receiptId);
        evidenceResults.push(result);
      }
      evidenceResults.sort((left, right) => EVIDENCE_KINDS.indexOf(left.evidenceKind)
        - EVIDENCE_KINDS.indexOf(right.evidenceKind));
      return deepFreeze({
        recordType: "TRUSTED_CONTENT_UED_ENVIRONMENT_RESOLUTION",
        resolutionVersion: 1,
        releaseRef: expectedReleaseRef,
        environmentKind: expectedEnvironmentKind,
        environmentRef: expectedEnvironmentRef,
        structureBundleBytesDigest: bundleBytesDigest,
        resolvedAt: now.iso,
        revocationSnapshotDigest: revocation.snapshotDigest,
        revocationSnapshotSequence: revocation.sequence,
        evidenceResults,
        allEvidenceResolvedCurrent: true,
        validationLevel: VALIDATION_LEVEL,
        authorization: clone(AUTHORIZATION),
      });
    },
  });
}

module.exports = Object.freeze({
  AUTHORIZATION,
  VALIDATION_LEVEL,
  createContentUedTrustedEvidenceResolver,
  rightsMetadataDigest,
});
