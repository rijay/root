const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AUTHORIZATION,
  VALIDATION_LEVEL,
  createContentUedTrustedEvidenceResolver,
  rightsMetadataDigest,
} = require("../src/contentUedTrustedEvidenceResolver");
const {
  computeContentUedEvidencePayloadDigest,
  computeContentUedSignoffPayloadDigest,
} = require("../src/contentUedAuthorizationRegistry");

const NOW = "2026-07-20T08:00:00.000Z";
const ADAPTER_ID = "controlled-evidence-adapter-v1";
const KINDS = [
  "HEALTH_CONTENT",
  "PRIVACY_COMPLIANCE",
  "ACTIVITY_OPERATIONS",
  "UED_HANDOFF",
  "PHOTOGRAPHY_RIGHTS",
];
const ROLES = {
  HEALTH_CONTENT: ["PRODUCT", "PRIVACY", "HEALTH_CONTENT_REVIEW", "OPERATIONS"],
  PRIVACY_COMPLIANCE: ["PRIVACY", "ENGINEERING", "QA"],
  ACTIVITY_OPERATIONS: ["PRODUCT", "OPERATIONS", "PRIVACY", "QA"],
  UED_HANDOFF: ["PRODUCT", "UED_OWNER", "ENGINEERING", "QA"],
  PHOTOGRAPHY_RIGHTS: ["PRODUCT", "PRIVACY", "UED_OWNER", "RIGHTS_CLEARANCE"],
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ref(namespace, value) {
  return `${namespace}:sha256:${sha256(value)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function domainDigest(domain, value) {
  return sha256(`${domain}\0${JSON.stringify(value)}`);
}

function inputBinding() {
  return {
    prdDigest: sha256("trusted-prd"),
    designDigest: sha256("trusted-design"),
    authorizationPacketDigest: sha256("trusted-authorization-packet"),
    candidateManifestDigest: sha256("trusted-candidate-manifest"),
    routeRegistryDigest: sha256("trusted-route-registry"),
    artifactProvenanceDigest: sha256("trusted-artifact-provenance"),
  };
}

function photographyAssetSetDigest(assets) {
  const projection = assets.map((asset) => ({
    assetRef: asset.assetRef,
    cleanMasterDigest: asset.cleanMasterDigest,
  })).sort((left, right) => {
    if (left.assetRef < right.assetRef) return -1;
    if (left.assetRef > right.assetRef) return 1;
    if (left.cleanMasterDigest < right.cleanMasterDigest) return -1;
    if (left.cleanMasterDigest > right.cleanMasterDigest) return 1;
    return 0;
  });
  return domainDigest("myroot-content-ued-photography-asset-set:v1", projection);
}

function payload(kind, binding) {
  if (kind === "HEALTH_CONTENT") {
    const contentBundleRef = ref("artifact", "health-content-bundle");
    return {
      contentBundleRef,
      rightsEvidenceRef: ref("evidence", "health-rights"),
      approvedChineseVersionRef: ref("artifact", "health-chinese"),
      populationRulesRef: ref("policy", "health-population"),
      scoringThresholdInterpretationRef: ref("policy", "health-scoring"),
      redFlagSopRef: ref("policy", "health-red-flag"),
      redFlagScenarioDrillEvidenceRef: ref("evidence", "health-drill"),
      humanSupportRouteRef: ref("policy", "health-human-route"),
      sourceArtifactDigest: sha256(`bytes:${contentBundleRef}`),
      configuredContentCount: 1,
      commercialOnlineUseAllowed: true,
    };
  }
  if (kind === "PRIVACY_COMPLIANCE") {
    return {
      dpiaEvidenceRef: ref("evidence", "privacy-dpia"),
      dataFlowEvidenceRef: ref("evidence", "privacy-flow"),
      processorRegisterRef: ref("evidence", "privacy-processors"),
      retentionDeletionMatrixRef: ref("evidence", "privacy-retention"),
      consentLifecycleEvidenceRef: ref("evidence", "privacy-consent"),
      accessAndKeyControlEvidenceRef: ref("evidence", "privacy-access"),
      incidentResponseDrillEvidenceRef: ref("evidence", "privacy-incident"),
      wechatPrivacyParityEvidenceRef: ref("evidence", "privacy-wechat"),
      candidateRuntimeExerciseEvidenceRef: ref("evidence", "privacy-runtime"),
      implementationSnapshotDigest: sha256("privacy-implementation-bytes"),
      healthWritesFailClosedBeforeH04R: true,
    };
  }
  if (kind === "ACTIVITY_OPERATIONS") {
    return {
      firstReleaseContentRef: ref("artifact", "activity-content"),
      operationsSopRef: ref("policy", "activity-sop"),
      capacityPolicyRef: ref("policy", "activity-capacity"),
      cancellationPolicyRef: ref("policy", "activity-cancellation"),
      customerSupportScriptRef: ref("policy", "activity-support"),
      photographyNoticeRef: ref("policy", "activity-photo-notice"),
      privacyNoticeRef: ref("policy", "activity-privacy-notice"),
      canonicalScenarioDrillEvidenceRef: ref("evidence", "activity-drill"),
      adminPublicationEvidenceRef: ref("evidence", "activity-publication"),
      runtimeQueryEvidenceRef: ref("evidence", "activity-query"),
      implementationSnapshotDigest: sha256("activity-implementation-bytes"),
      publishedActivityCount: 1,
      contentSource: "OPS_BACKEND",
      uedPlaceholderExcludedFromRuntime: true,
    };
  }
  if (kind === "UED_HANDOFF") {
    return {
      controlledHandoffIndexRef: ref("evidence", "ued-handoff-index"),
      controlledArdotEvidenceRef: ref("evidence", "ued-ardot"),
      prdBindingDigest: binding.prdDigest,
      designBindingDigest: binding.designDigest,
      screenIndexDigest: sha256("ued-screen-index-bytes"),
      interactionSpecDigest: sha256("ued-interaction-bytes"),
      accessibilitySpecDigest: sha256("ued-accessibility-bytes"),
      implementationParityEvidenceRef: ref("evidence", "ued-parity"),
      screenCount: 1,
      archivedPagesExcluded: true,
      allCanonicalStatesCovered: true,
    };
  }
  const asset = {
    assetRef: ref("asset", "photo-clean-master"),
    cleanMasterDigest: sha256("photo-clean-master-bytes"),
    rightsEvidenceRef: ref("evidence", "photo-rights"),
    chainOfTitleRef: ref("evidence", "photo-chain"),
    modelReleaseRequirement: "REQUIRED_AND_VERIFIED",
    modelReleaseRef: ref("evidence", "photo-model-release"),
    propertyReleaseRequirement: "NOT_APPLICABLE",
    propertyReleaseRef: null,
    thirdPartyRightsRequirement: "NOT_APPLICABLE",
    thirdPartyRightsEvidenceRef: null,
    allowedUsePolicyRef: ref("policy", "photo-use"),
    territoryPolicyRef: ref("policy", "photo-territory"),
    attributionPolicyRef: ref("policy", "photo-attribution"),
    expiryOwnerRef: ref("actor", "photo-expiry-owner"),
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: "2027-12-31T23:59:59.000Z",
    rightsStatus: "ACTIVE",
    revokedAt: null,
    revocationEvidenceRef: null,
    wechatMiniProgramUseAllowed: true,
    commercialUseAllowed: true,
    cropResizeAllowed: true,
    retouchCompositeAllowed: true,
    textOverlayAllowed: true,
    cleanMasterConfirmed: true,
  };
  const setDigest = photographyAssetSetDigest([asset]);
  return {
    assetRightsIndexRef: ref("evidence", "photo-rights-index"),
    candidateAssetSetDigest: setDigest,
    uedAssetSetDigest: setDigest,
    runtimeAssetSetDigest: setDigest,
    publishedAssetCount: 1,
    assets: [asset],
  };
}

function attachSignoffs(document) {
  const evidencePayloadDigest = computeContentUedEvidencePayloadDigest(document);
  document.signoffs = ROLES[document.evidenceKind].map((role) => {
    const signoff = {
      signoffId: ref("signoff", `${document.evidenceKind}:${role}`),
      signerRef: ref("actor", `${document.evidenceKind}:${role}`),
      role,
      evidenceKind: document.evidenceKind,
      releaseRef: document.releaseRef,
      environmentKind: document.environmentKind,
      environmentRef: document.environmentRef,
      evidencePayloadDigest,
      decision: "APPROVED",
      signedAt: "2026-07-10T08:00:00.000Z",
      validUntil: document.validUntil,
      signatureMethod: "CONTROLLED_APPROVAL_RECORD_V1",
      signedPayloadDigest: sha256("temporary"),
      signatureDigest: sha256(`signature:${document.evidenceKind}:${role}`),
      validatorRef: ref("validator", `${document.evidenceKind}:${role}`),
      validationStatus: "VALIDATED",
      validationEvidenceRef: ref("evidence", `validation:${document.evidenceKind}:${role}`),
      authorizationChainRef: ref("evidence", `authority:${document.evidenceKind}:${role}`),
      revocationStatus: "ACTIVE",
      revocationEvidenceRef: null,
    };
    signoff.signedPayloadDigest = computeContentUedSignoffPayloadDigest(signoff);
    return signoff;
  });
  return document;
}

function environmentBundle() {
  const binding = inputBinding();
  const releaseRef = ref("release", "trusted-release-v1"), environmentRef = ref("environment", "candidate");
  return {
    recordType: "ENVIRONMENT_ACCEPTANCE_BUNDLE",
    bundleFormatVersion: 1,
    productVersion: "v1.0.0",
    releaseRef,
    environmentKind: "CANDIDATE",
    environmentRef,
    inputBinding: binding,
    evidenceDocuments: KINDS.map((evidenceKind) => attachSignoffs({
      recordType: "ACCEPTANCE_EVIDENCE",
      evidenceFormatVersion: 1,
      digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
      productVersion: "v1.0.0",
      releaseRef,
      environmentKind: "CANDIDATE",
      environmentRef,
      evidenceKind,
      subjectRef: ref("subject", `subject:${evidenceKind}`),
      inputBinding: clone(binding),
      payload: payload(evidenceKind, binding),
      revocationSnapshotDigest: sha256("trusted-revocation-snapshot"),
      validFrom: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-10-01T00:00:00.000Z",
      collectedAt: "2026-07-15T08:00:00.000Z",
      signoffs: [],
    })),
  };
}

function opaqueRefs(value, output = new Set()) {
  if (typeof value === "string" && /^(?:artifact|evidence|policy|asset|actor|validator|signoff|release|environment|subject):sha256:[a-f0-9]{64}$/.test(value)) {
    output.add(value);
  } else if (Array.isArray(value)) value.forEach((item) => opaqueRefs(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => opaqueRefs(item, output));
  return [...output].sort();
}

function factsFor(document) {
  const p = document.payload;
  if (document.evidenceKind === "HEALTH_CONTENT") return {
    contentItems: [{
      contentId: "root-health-1",
      contentVersion: "v1",
      sourceBytesDigest: sha256("health-item-source"),
      approvedChineseBytesDigest: sha256("health-item-chinese"),
      state: "RESOLVED_CURRENT",
    }],
    commercialOnlineUseAllowed: true,
    redFlagSopState: "ACTIVE_CURRENT",
    humanSupportRouteState: "ACTIVE_CURRENT",
  };
  if (document.evidenceKind === "PRIVACY_COMPLIANCE") return {
    implementationBytesDigest: p.implementationSnapshotDigest,
    controlEvidenceRefs: [
      p.dpiaEvidenceRef,
      p.dataFlowEvidenceRef,
      p.processorRegisterRef,
      p.retentionDeletionMatrixRef,
      p.consentLifecycleEvidenceRef,
      p.accessAndKeyControlEvidenceRef,
      p.incidentResponseDrillEvidenceRef,
      p.wechatPrivacyParityEvidenceRef,
      p.candidateRuntimeExerciseEvidenceRef,
    ],
    candidateRuntimeExerciseState: "PASSED_CURRENT",
    healthWritesFailClosed: true,
  };
  if (document.evidenceKind === "ACTIVITY_OPERATIONS") return {
    implementationBytesDigest: p.implementationSnapshotDigest,
    publishedActivities: [{
      activityId: "activity-1",
      activityVersionId: "activity-1-v1",
      publicationRequestId: "publish-request-1",
      contentBytesDigest: sha256("activity-content-bytes"),
      state: "PUBLISHED",
    }],
    contentSource: "OPS_BACKEND",
    placeholderExcluded: true,
  };
  if (document.evidenceKind === "UED_HANDOFF") return {
    screenIndexBytesDigest: p.screenIndexDigest,
    interactionSpecBytesDigest: p.interactionSpecDigest,
    accessibilitySpecBytesDigest: p.accessibilitySpecDigest,
    screens: [{
      screenId: "HOME-01",
      controlledNodeRef: "controlled-node:home-01",
      routeId: "/pages/home/index",
      acceptanceCriteriaIds: ["AC-HOME-01"],
      canonicalStates: ["MEMBER"],
      conditionalStates: ["LOADING", "EMPTY", "ERROR", "RECOVERY"],
      screenBytesDigest: sha256("screen-home-01-bytes"),
      archived: false,
    }],
    implementationParityState: "PASSED_CURRENT",
    archivedPagesExcluded: true,
  };
  const asset = p.assets[0];
  return {
    assetRightsIndexBytesDigest: sha256("photo-rights-index-bytes"),
    assets: [{
      assetRef: asset.assetRef,
      cleanMasterBytesDigest: asset.cleanMasterDigest,
      rightsMetadataDigest: rightsMetadataDigest(asset),
      rightsState: "ACTIVE_CURRENT",
      notApplicableEvidence: {
        propertyReleaseRequirement: sha256("photo-property-na-review"),
        thirdPartyRightsRequirement: sha256("photo-third-party-na-review"),
      },
    }],
  };
}

function buildHarness(bundle = environmentBundle()) {
  const bytes = Buffer.from(JSON.stringify(bundle), "utf8");
  const bundleBytesDigest = sha256(bytes);
  const receipts = new Map();
  for (const document of bundle.evidenceDocuments) {
    const facts = factsFor(document);
    const resolvedRefs = opaqueRefs(document.payload).map((value) => ({
      ref: value,
      bytesDigest: value === document.payload.contentBundleRef
        ? document.payload.sourceArtifactDigest
        : value === document.payload.firstReleaseContentRef
          ? facts.publishedActivities[0].contentBytesDigest
          : value === document.payload.controlledHandoffIndexRef
            ? facts.screenIndexBytesDigest
            : value === document.payload.assetRightsIndexRef
              ? facts.assetRightsIndexBytesDigest
              : sha256(`bytes:${value}`),
      status: "RESOLVED_CURRENT",
    }));
    const sourceBytesDigest = domainDigest(
      "myroot-content-ued-trusted-resolved-reference-set:v1",
      resolvedRefs.map(({ ref: value, bytesDigest }) => ({ ref: value, bytesDigest }))
    );
    receipts.set(document.evidenceKind, {
      receiptType: "TRUSTED_CONTENT_UED_EVIDENCE_RECEIPT",
      receiptVersion: 1,
      adapterId: ADAPTER_ID,
      receiptId: `receipt:${document.evidenceKind}`,
      releaseRef: bundle.releaseRef,
      environmentKind: bundle.environmentKind,
      environmentRef: bundle.environmentRef,
      evidenceKind: document.evidenceKind,
      subjectRef: document.subjectRef,
      structureBundleBytesDigest: bundleBytesDigest,
      evidencePayloadDigest: computeContentUedEvidencePayloadDigest(document),
      resolvedRefs,
      sourceBytesDigest,
      resolvedAt: "2026-07-20T07:59:00.000Z",
      validUntil: "2026-07-20T08:04:00.000Z",
      revocationSnapshotDigest: document.revocationSnapshotDigest,
      status: "RESOLVED_CURRENT",
      facts,
      authorization: clone(AUTHORIZATION),
    });
  }
  const revocation = {
    receiptType: "TRUSTED_REVOCATION_SNAPSHOT_RECEIPT",
    receiptVersion: 1,
    adapterId: ADAPTER_ID,
    releaseRef: bundle.releaseRef,
    environmentKind: bundle.environmentKind,
    environmentRef: bundle.environmentRef,
    snapshotDigest: bundle.evidenceDocuments[0].revocationSnapshotDigest,
    sequence: 7,
    observedAt: "2026-07-20T07:59:00.000Z",
    validUntil: "2026-07-20T08:04:00.000Z",
    status: "CURRENT",
  };
  const adapter = {
    async resolveRevocationSnapshot() { return clone(revocation); },
    async resolveEvidenceReceipt({ evidenceKind }) { return clone(receipts.get(evidenceKind)); },
  };
  const resolver = createContentUedTrustedEvidenceResolver({
    trustedEvidenceAdapter: adapter,
    expectedAdapterId: ADAPTER_ID,
    trustedClock: () => NOW,
  });
  const input = {
    structureBundleBytes: bytes,
    expectedReleaseRef: bundle.releaseRef,
    expectedEnvironmentKind: bundle.environmentKind,
    expectedEnvironmentRef: bundle.environmentRef,
  };
  return { adapter, bundle, bytes, input, receipts, resolver, revocation };
}

function expectCode(promise, code) {
  return assert.rejects(promise, (error) => error && error.code === code);
}

test("trusted resolver derives current count/state from receipts and never grants authority", async () => {
  const harness = buildHarness();
  const result = await harness.resolver.resolveEnvironmentBundle(harness.input);
  assert.equal(result.validationLevel, VALIDATION_LEVEL);
  assert.equal(result.allEvidenceResolvedCurrent, true);
  assert.deepEqual(result.evidenceResults.map((item) => item.evidenceKind), KINDS);
  assert.deepEqual(result.evidenceResults.map((item) => item.derivedCount), [1, 9, 1, 1, 1]);
  assert.deepEqual(result.authorization, AUTHORIZATION);
  assert.equal(Object.values(result.authorization).every((value) => value === false), true);
  assert.equal(Object.isFrozen(result), true);
});

test("unresolved references and exact-byte receipt drift fail closed", async () => {
  const unresolved = buildHarness();
  unresolved.receipts.get("HEALTH_CONTENT").resolvedRefs.pop();
  await expectCode(
    unresolved.resolver.resolveEnvironmentBundle(unresolved.input),
    "CONTENT_UED_TRUSTED_REFERENCE_UNRESOLVED"
  );

  const byteDrift = buildHarness();
  byteDrift.receipts.get("HEALTH_CONTENT").structureBundleBytesDigest = sha256("different-bytes");
  await expectCode(
    byteDrift.resolver.resolveEnvironmentBundle(byteDrift.input),
    "CONTENT_UED_TRUSTED_RECEIPT_BINDING_INVALID"
  );
});

test("trusted clock rejects time rollback and stale revocation receipts", async () => {
  const rollback = buildHarness();
  rollback.revocation.observedAt = "2026-07-20T08:00:01.000Z";
  await expectCode(
    rollback.resolver.resolveEnvironmentBundle(rollback.input),
    "CONTENT_UED_TRUSTED_REVOCATION_STALE_OR_ROLLBACK"
  );

  const stale = buildHarness();
  stale.revocation.observedAt = "2026-07-20T07:50:00.000Z";
  await expectCode(
    stale.resolver.resolveEnvironmentBundle(stale.input),
    "CONTENT_UED_TRUSTED_REVOCATION_STALE_OR_ROLLBACK"
  );
});

test("wrong release, environment, subject and Adapter receipts fail closed", async () => {
  const wrongExpected = buildHarness();
  await expectCode(
    wrongExpected.resolver.resolveEnvironmentBundle({
      ...wrongExpected.input,
      expectedReleaseRef: ref("release", "wrong-release"),
    }),
    "CONTENT_UED_TRUSTED_RELEASE_ENVIRONMENT_MISMATCH"
  );

  const wrongReceipt = buildHarness();
  wrongReceipt.receipts.get("PRIVACY_COMPLIANCE").subjectRef = ref("subject", "wrong-subject");
  await expectCode(
    wrongReceipt.resolver.resolveEnvironmentBundle(wrongReceipt.input),
    "CONTENT_UED_TRUSTED_RECEIPT_BINDING_INVALID"
  );

  const wrongAdapter = buildHarness();
  wrongAdapter.receipts.get("HEALTH_CONTENT").adapterId = "untrusted-adapter";
  await expectCode(
    wrongAdapter.resolver.resolveEnvironmentBundle(wrongAdapter.input),
    "CONTENT_UED_TRUSTED_RECEIPT_BINDING_INVALID"
  );
});

test("self-reported activity count cannot replace trusted current publication state", async () => {
  const bundle = environmentBundle();
  const activityDocument = bundle.evidenceDocuments.find((item) => item.evidenceKind === "ACTIVITY_OPERATIONS");
  activityDocument.payload.publishedActivityCount = 2;
  attachSignoffs(activityDocument);
  const harness = buildHarness(bundle);
  await expectCode(
    harness.resolver.resolveEnvironmentBundle(harness.input),
    "CONTENT_UED_TRUSTED_ACTIVITY_FACTS_INVALID"
  );

  const withdrawn = buildHarness();
  withdrawn.receipts.get("ACTIVITY_OPERATIONS").facts.publishedActivities[0].state = "WITHDRAWN";
  await expectCode(
    withdrawn.resolver.resolveEnvironmentBundle(withdrawn.input),
    "CONTENT_UED_TRUSTED_ACTIVITY_WITHDRAWN"
  );
});

test("UED receipts require per-screen canonical and conditional state coverage", async () => {
  const harness = buildHarness();
  harness.receipts.get("UED_HANDOFF").facts.screens[0].conditionalStates = [];
  await expectCode(
    harness.resolver.resolveEnvironmentBundle(harness.input),
    "CONTENT_UED_TRUSTED_UED_STATE_COVERAGE_MISSING"
  );
});

test("photography clean-master, rights metadata, and N/A evidence drift fail closed", async () => {
  const cleanMaster = buildHarness();
  cleanMaster.receipts.get("PHOTOGRAPHY_RIGHTS").facts.assets[0].cleanMasterBytesDigest = sha256("substituted-clean-master");
  await expectCode(
    cleanMaster.resolver.resolveEnvironmentBundle(cleanMaster.input),
    "CONTENT_UED_TRUSTED_PHOTOGRAPHY_RIGHTS_DRIFT"
  );

  const rights = buildHarness();
  rights.receipts.get("PHOTOGRAPHY_RIGHTS").facts.assets[0].rightsMetadataDigest = sha256("stale-rights-metadata");
  await expectCode(
    rights.resolver.resolveEnvironmentBundle(rights.input),
    "CONTENT_UED_TRUSTED_PHOTOGRAPHY_RIGHTS_DRIFT"
  );

  const unsupportedNa = buildHarness();
  delete unsupportedNa.receipts.get("PHOTOGRAPHY_RIGHTS")
    .facts.assets[0].notApplicableEvidence.propertyReleaseRequirement;
  await expectCode(
    unsupportedNa.resolver.resolveEnvironmentBundle(unsupportedNa.input),
    "CONTENT_UED_TRUSTED_PHOTOGRAPHY_NA_UNSUPPORTED"
  );
});

test("trusted receipts cannot escalate any publication or Gate authorization", async () => {
  const harness = buildHarness();
  harness.receipts.get("HEALTH_CONTENT").authorization.gateClosureAuthorized = true;
  await expectCode(
    harness.resolver.resolveEnvironmentBundle(harness.input),
    "CONTENT_UED_TRUSTED_AUTHORIZATION_FORBIDDEN"
  );
});
