const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computeContentUedAuthorizationRegistryDigest,
  computeContentUedEvidencePayloadDigest,
  computeContentUedSignoffPayloadDigest,
  createContentUedAuthorizationRegistry,
  getDefaultContentUedAuthorizationRegistry,
} = require("../src/contentUedAuthorizationRegistry");

const MANIFEST_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "contracts",
  "content-ued-authorization",
  "v1.0.0.json"
);
const EVALUATED_AT = "2026-07-18T08:00:00.000Z";
const REVOCATION_SNAPSHOT_DIGEST = sha256("revocation-snapshot:2026-07-18");
const PHOTOGRAPHY_ASSET_SET_DIGEST_DOMAIN = "myroot-content-ued-photography-asset-set:v1";
const EVIDENCE_KINDS = Object.freeze([
  "HEALTH_CONTENT",
  "PRIVACY_COMPLIANCE",
  "ACTIVITY_OPERATIONS",
  "UED_HANDOFF",
  "PHOTOGRAPHY_RIGHTS",
]);
const ROLE_SETS = Object.freeze({
  HEALTH_CONTENT: Object.freeze([
    "PRODUCT",
    "PRIVACY",
    "HEALTH_CONTENT_REVIEW",
    "OPERATIONS",
  ]),
  PRIVACY_COMPLIANCE: Object.freeze(["PRIVACY", "ENGINEERING", "QA"]),
  ACTIVITY_OPERATIONS: Object.freeze(["PRODUCT", "OPERATIONS", "PRIVACY", "QA"]),
  UED_HANDOFF: Object.freeze(["PRODUCT", "UED_OWNER", "ENGINEERING", "QA"]),
  PHOTOGRAPHY_RIGHTS: Object.freeze([
    "PRODUCT",
    "PRIVACY",
    "UED_OWNER",
    "RIGHTS_CLEARANCE",
  ]),
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function evaluationOptions(evaluatedAt = EVALUATED_AT) {
  return { evaluatedAt, revocationSnapshotDigest: REVOCATION_SNAPSHOT_DIGEST };
}

function ref(namespace, seed) {
  return `${namespace}:sha256:${sha256(seed)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function photographyAssetSetDigest(assets) {
  const normalizedAssets = assets.map(({ assetRef, cleanMasterDigest }) => ({
    assetRef,
    cleanMasterDigest,
  })).sort((left, right) => {
    if (left.assetRef < right.assetRef) return -1;
    if (left.assetRef > right.assetRef) return 1;
    if (left.cleanMasterDigest < right.cleanMasterDigest) return -1;
    if (left.cleanMasterDigest > right.cleanMasterDigest) return 1;
    return 0;
  });
  return crypto.createHash("sha256")
    .update(`${PHOTOGRAPHY_ASSET_SET_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(normalizedAssets), "utf8")
    .digest("hex");
}

function inputBinding() {
  return {
    prdDigest: sha256("prd:v1.0.0"),
    designDigest: sha256("design:v1.0.0"),
    authorizationPacketDigest: sha256("authorization-packet:v1.0.0"),
    candidateManifestDigest: sha256("candidate-manifest:v1.0.0"),
    formalRoutesDigest: sha256("route-registry:v1.0.0"),
    artifactProvenanceDigest: sha256("artifact-provenance:v1.0.0"),
  };
}

function payloadFor(kind, binding, suffix) {
  if (kind === "HEALTH_CONTENT") {
    return {
      contentBundleRef: ref("artifact", `${suffix}:health-content`),
      rightsEvidenceRef: ref("evidence", `${suffix}:health-rights`),
      approvedChineseVersionRef: ref("artifact", `${suffix}:health-cn`),
      populationRulesRef: ref("policy", `${suffix}:health-population`),
      scoringThresholdInterpretationRef: ref("policy", `${suffix}:health-scoring`),
      redFlagSopRef: ref("policy", `${suffix}:health-red-flag-sop`),
      redFlagScenarioDrillEvidenceRef: ref("evidence", `${suffix}:health-red-flag-drill`),
      humanSupportRouteRef: ref("policy", `${suffix}:health-support-route`),
      sourceArtifactDigest: sha256(`${suffix}:health-source`),
      configuredContentCount: 3,
      commercialOnlineUseAllowed: true,
    };
  }
  if (kind === "PRIVACY_COMPLIANCE") {
    return {
      dpiaEvidenceRef: ref("evidence", `${suffix}:privacy-dpia`),
      dataFlowEvidenceRef: ref("evidence", `${suffix}:privacy-data-flow`),
      processorRegisterRef: ref("evidence", `${suffix}:privacy-processors`),
      retentionDeletionMatrixRef: ref("evidence", `${suffix}:privacy-retention`),
      consentLifecycleEvidenceRef: ref("evidence", `${suffix}:privacy-consent`),
      accessAndKeyControlEvidenceRef: ref("evidence", `${suffix}:privacy-access`),
      incidentResponseDrillEvidenceRef: ref("evidence", `${suffix}:privacy-incident`),
      wechatPrivacyParityEvidenceRef: ref("evidence", `${suffix}:privacy-wechat`),
      candidateRuntimeExerciseEvidenceRef: ref("evidence", `${suffix}:privacy-runtime`),
      implementationSnapshotDigest: sha256(`${suffix}:privacy-implementation`),
      healthWritesFailClosedBeforeH04R: true,
    };
  }
  if (kind === "ACTIVITY_OPERATIONS") {
    return {
      firstReleaseContentRef: ref("artifact", `${suffix}:activity-content`),
      operationsSopRef: ref("policy", `${suffix}:activity-sop`),
      capacityPolicyRef: ref("policy", `${suffix}:activity-capacity`),
      cancellationPolicyRef: ref("policy", `${suffix}:activity-cancellation`),
      customerSupportScriptRef: ref("policy", `${suffix}:activity-support`),
      photographyNoticeRef: ref("policy", `${suffix}:activity-photography`),
      privacyNoticeRef: ref("policy", `${suffix}:activity-privacy`),
      canonicalScenarioDrillEvidenceRef: ref("evidence", `${suffix}:activity-drill`),
      adminPublicationEvidenceRef: ref("evidence", `${suffix}:activity-admin`),
      runtimeQueryEvidenceRef: ref("evidence", `${suffix}:activity-query`),
      implementationSnapshotDigest: sha256(`${suffix}:activity-implementation`),
      publishedActivityCount: 1,
      contentSource: "OPS_BACKEND",
      uedPlaceholderExcludedFromRuntime: true,
    };
  }
  if (kind === "UED_HANDOFF") {
    return {
      controlledHandoffIndexRef: ref("evidence", `${suffix}:ued-index`),
      controlledArdotEvidenceRef: ref("evidence", `${suffix}:ued-ardot`),
      prdBindingDigest: binding.prdDigest,
      designBindingDigest: binding.designDigest,
      screenIndexDigest: sha256(`${suffix}:ued-screen-index`),
      interactionSpecDigest: sha256(`${suffix}:ued-interactions`),
      accessibilitySpecDigest: sha256(`${suffix}:ued-accessibility`),
      implementationParityEvidenceRef: ref("evidence", `${suffix}:ued-parity`),
      screenCount: 64,
      archivedPagesExcluded: true,
      allCanonicalStatesCovered: true,
    };
  }
  const assets = ["a", "b"].map((asset) => ({
    assetRef: ref("asset", `${suffix}:photo:${asset}`),
    cleanMasterDigest: sha256(`${suffix}:photo:${asset}:clean-master`),
    rightsEvidenceRef: ref("evidence", `${suffix}:photo:${asset}:rights`),
    chainOfTitleRef: ref("evidence", `${suffix}:photo:${asset}:chain`),
    modelReleaseRequirement: asset === "a" ? "REQUIRED_AND_VERIFIED" : "NOT_APPLICABLE",
    modelReleaseRef: asset === "a" ? ref("evidence", `${suffix}:photo:${asset}:model`) : null,
    propertyReleaseRequirement: asset === "b" ? "REQUIRED_AND_VERIFIED" : "NOT_APPLICABLE",
    propertyReleaseRef: asset === "b" ? ref("evidence", `${suffix}:photo:${asset}:property`) : null,
    thirdPartyRightsRequirement: "NOT_APPLICABLE",
    thirdPartyRightsEvidenceRef: null,
    allowedUsePolicyRef: ref("policy", `${suffix}:photo:${asset}:allowed-use`),
    territoryPolicyRef: ref("policy", `${suffix}:photo:${asset}:territory`),
    attributionPolicyRef: ref("policy", `${suffix}:photo:${asset}:attribution`),
    expiryOwnerRef: ref("actor", `${suffix}:photo:${asset}:expiry-owner`),
    validFrom: "2026-01-01T00:00:00.000Z",
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
  }));
  const assetSetDigest = photographyAssetSetDigest(assets);
  return {
    assetRightsIndexRef: ref("evidence", `${suffix}:photo-rights-index`),
    candidateAssetSetDigest: assetSetDigest,
    uedAssetSetDigest: assetSetDigest,
    runtimeAssetSetDigest: assetSetDigest,
    publishedAssetCount: 2,
    assets,
  };
}

function refreshSignoff(signoff) {
  signoff.signedPayloadDigest = computeContentUedSignoffPayloadDigest(signoff);
  signoff.signatureDigest = sha256(`signature:${signoff.signedPayloadDigest}`);
  return signoff;
}

function attachSignoffs(document) {
  const payloadDigest = computeContentUedEvidencePayloadDigest(document);
  document.signoffs = ROLE_SETS[document.evidenceKind].map((role) => {
    const seed = `${document.environmentKind}:${document.evidenceKind}:${role}`;
    return refreshSignoff({
      signoffId: ref("signoff", seed),
      signerRef: ref("actor", seed),
      role,
      evidenceKind: document.evidenceKind,
      releaseRef: document.releaseRef,
      environmentKind: document.environmentKind,
      environmentRef: document.environmentRef,
      evidencePayloadDigest: payloadDigest,
      decision: "APPROVED",
      signedAt: "2026-07-10T08:00:00.000Z",
      validUntil: document.validUntil,
      signatureMethod: "CONTROLLED_APPROVAL_RECORD_V1",
      signedPayloadDigest: sha256("temporary"),
      signatureDigest: sha256("temporary-signature"),
      validatorRef: ref("validator", "content-ued-authorization-v1"),
      validationStatus: "VALIDATED",
      validationEvidenceRef: ref("evidence", `${seed}:validation`),
      authorizationChainRef: ref("evidence", `${seed}:authorization-chain`),
      revocationStatus: "ACTIVE",
      revocationEvidenceRef: null,
    });
  });
  return document;
}

function evidenceDocument(kind, environmentKind = "CANDIDATE", binding = inputBinding()) {
  const suffix = `${environmentKind.toLowerCase()}:${kind.toLowerCase()}`;
  const document = {
    recordType: "ACCEPTANCE_EVIDENCE",
    evidenceFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    releaseRef: ref("release", "v1.0.0:D0"),
    environmentKind,
    environmentRef: ref("environment", environmentKind.toLowerCase()),
    evidenceKind: kind,
    subjectRef: ref("subject", suffix),
    inputBinding: clone(binding),
    payload: payloadFor(kind, binding, suffix),
    revocationSnapshotDigest: REVOCATION_SNAPSHOT_DIGEST,
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-11-01T00:00:00.000Z",
    collectedAt: "2026-07-11T08:00:00.000Z",
    signoffs: [],
  };
  return attachSignoffs(document);
}

function environmentBundle(environmentKind = "CANDIDATE", binding = inputBinding()) {
  return {
    recordType: "ENVIRONMENT_ACCEPTANCE_BUNDLE",
    bundleFormatVersion: 1,
    productVersion: "v1.0.0",
    releaseRef: ref("release", "v1.0.0:D0"),
    environmentKind,
    environmentRef: ref("environment", environmentKind.toLowerCase()),
    inputBinding: clone(binding),
    evidenceDocuments: EVIDENCE_KINDS.map((kind) => (
      evidenceDocument(kind, environmentKind, binding)
    )),
  };
}

function releaseBundle() {
  const binding = inputBinding();
  return {
    recordType: "RELEASE_ACCEPTANCE_BUNDLE",
    bundleFormatVersion: 1,
    productVersion: "v1.0.0",
    releaseRef: ref("release", "v1.0.0:D0"),
    inputBinding: clone(binding),
    environmentBundles: [
      environmentBundle("CANDIDATE", binding),
      environmentBundle("PRODUCTION", binding),
    ],
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test("registry is one non-runtime Interface and grants no publication or Gate authority", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const registry = getDefaultContentUedAuthorizationRegistry();
  assert.deepEqual(Object.keys(registry).sort(), ["describe", "evaluate", "seal", "verify"]);
  const description = registry.describe();
  assert.equal(description.registryDigest, computeContentUedAuthorizationRegistryDigest(manifest));
  assert.deepEqual(description.requiredEnvironmentKinds, ["CANDIDATE", "PRODUCTION"]);
  assert.deepEqual(description.authorization, {
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
});

test("each domain evaluates independently and emits only opaque summary data", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  for (const kind of EVIDENCE_KINDS) {
    const result = registry.evaluate(evidenceDocument(kind), evaluationOptions());
    assert.equal(result.evidenceKind, kind);
    assert.equal(result.structureValid, true);
    assert.equal(result.validationLevel, "STRUCTURE_ONLY_UNTRUSTED_INPUT");
    const output = JSON.stringify(result);
    assert.doesNotMatch(
      output,
      /"signerRef"|"signatureDigest"|"payload"|"rightsHolder"|"creator"|"endpoint"|"secret"/i
    );
  }
});

test("complete environment and release bundles are deterministic but never self-authorize", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const environment = registry.evaluate(environmentBundle(), evaluationOptions());
  assert.equal(environment.allEvidenceStructureValid, true);
  assert.deepEqual(environment.evidenceResults.map((entry) => entry.evidenceKind), EVIDENCE_KINDS);
  assert.equal(environment.authorization.gateClosureAuthorized, false);

  const release = releaseBundle();
  const releaseResult = registry.evaluate(release, evaluationOptions());
  assert.equal(releaseResult.allEnvironmentStructuresValid, true);
  assert.deepEqual(
    releaseResult.environments.map((entry) => entry.environmentKind),
    ["CANDIDATE", "PRODUCTION"]
  );
  const envelope = registry.seal(release, evaluationOptions());
  assert.equal(registry.verify(envelope, {
    verifiedAt: EVALUATED_AT,
    revocationSnapshotDigest: REVOCATION_SNAPSHOT_DIGEST,
  }), true);
  assert.equal(envelope.authorization.gateClosureAuthorized, false);
});

test("blank, explicit placeholder and placeholder digests fail closed", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const blank = evidenceDocument("ACTIVITY_OPERATIONS");
  blank.payload.contentSource = "";
  expectCode(
    () => registry.evaluate(blank, evaluationOptions()),
    "CONTENT_UED_PLACEHOLDER_REJECTED"
  );

  const pending = evidenceDocument("ACTIVITY_OPERATIONS");
  pending.payload.contentSource = "PENDING";
  expectCode(
    () => registry.evaluate(pending, evaluationOptions()),
    "CONTENT_UED_PLACEHOLDER_REJECTED"
  );

  const placeholderDigest = evidenceDocument("HEALTH_CONTENT");
  placeholderDigest.payload.sourceArtifactDigest = sha256("pending");
  attachSignoffs(placeholderDigest);
  expectCode(
    () => registry.evaluate(placeholderDigest, evaluationOptions()),
    "CONTENT_UED_HEALTH_EVIDENCE_INVALID"
  );
});

test("expired, not-yet-valid and overlong domain evidence is rejected", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const expired = evidenceDocument("PRIVACY_COMPLIANCE");
  expectCode(
    () => registry.evaluate(expired, evaluationOptions("2027-01-01T00:00:00.000Z")),
    "CONTENT_UED_EVIDENCE_EXPIRED_OR_NOT_YET_VALID"
  );

  const future = evidenceDocument("HEALTH_CONTENT");
  expectCode(
    () => registry.evaluate(future, evaluationOptions("2026-06-30T23:59:59.000Z")),
    "CONTENT_UED_EVIDENCE_EXPIRED_OR_NOT_YET_VALID"
  );

  const overlong = evidenceDocument("ACTIVITY_OPERATIONS");
  overlong.validUntil = "2027-07-01T00:00:00.000Z";
  attachSignoffs(overlong);
  expectCode(
    () => registry.evaluate(overlong, evaluationOptions()),
    "CONTENT_UED_EVIDENCE_EXPIRED_OR_NOT_YET_VALID"
  );
});

test("environment bundles reject cross-environment documents and input-binding drift", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const mixed = environmentBundle("CANDIDATE");
  mixed.evidenceDocuments[0] = evidenceDocument("HEALTH_CONTENT", "PRODUCTION", mixed.inputBinding);
  expectCode(
    () => registry.evaluate(mixed, evaluationOptions()),
    "CONTENT_UED_CROSS_ENVIRONMENT_MIXING_REJECTED"
  );

  const drifted = environmentBundle("CANDIDATE");
  drifted.evidenceDocuments[0].inputBinding.prdDigest = sha256("different-prd");
  attachSignoffs(drifted.evidenceDocuments[0]);
  expectCode(
    () => registry.evaluate(drifted, evaluationOptions()),
    "CONTENT_UED_CROSS_ENVIRONMENT_MIXING_REJECTED"
  );

  const release = releaseBundle();
  release.environmentBundles[1].environmentRef = release.environmentBundles[0].environmentRef;
  expectCode(
    () => registry.evaluate(release, evaluationOptions()),
    "CONTENT_UED_CROSS_ENVIRONMENT_MIXING_REJECTED"
  );
});

test("missing domain, duplicate duty, tampering and revocation fail closed", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const missing = environmentBundle();
  missing.evidenceDocuments.pop();
  expectCode(
    () => registry.evaluate(missing, evaluationOptions()),
    "CONTENT_UED_ENVIRONMENT_BUNDLE_INVALID"
  );

  const duplicateDuty = evidenceDocument("HEALTH_CONTENT");
  duplicateDuty.signoffs[1].signerRef = duplicateDuty.signoffs[0].signerRef;
  refreshSignoff(duplicateDuty.signoffs[1]);
  expectCode(
    () => registry.evaluate(duplicateDuty, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_INVALID"
  );

  const replayedSignature = evidenceDocument("ACTIVITY_OPERATIONS");
  replayedSignature.signoffs[1].signatureDigest = replayedSignature.signoffs[0].signatureDigest;
  expectCode(
    () => registry.evaluate(replayedSignature, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_INVALID"
  );

  const tampered = evidenceDocument("UED_HANDOFF");
  tampered.payload.screenCount += 1;
  expectCode(
    () => registry.evaluate(tampered, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_INVALID"
  );

  const revoked = evidenceDocument("PRIVACY_COMPLIANCE");
  revoked.signoffs[0].revocationStatus = "REVOKED";
  revoked.signoffs[0].revocationEvidenceRef = ref("evidence", "privacy-revocation");
  expectCode(
    () => registry.evaluate(revoked, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_INVALID"
  );
});

test("all five domain payloads enforce the release-critical positive assertion", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const mutations = [
    ["HEALTH_CONTENT", (doc) => { doc.payload.commercialOnlineUseAllowed = false; }],
    ["PRIVACY_COMPLIANCE", (doc) => { doc.payload.healthWritesFailClosedBeforeH04R = false; }],
    ["ACTIVITY_OPERATIONS", (doc) => { doc.payload.publishedActivityCount = 0; }],
    ["UED_HANDOFF", (doc) => { doc.payload.archivedPagesExcluded = false; }],
    ["PHOTOGRAPHY_RIGHTS", (doc) => { doc.payload.assets[0].cleanMasterConfirmed = false; }],
    ["PHOTOGRAPHY_RIGHTS", (doc) => { doc.payload.assets[0].modelReleaseRef = null; }],
  ];
  for (const [kind, mutate] of mutations) {
    const document = evidenceDocument(kind);
    mutate(document);
    attachSignoffs(document);
    assert.throws(() => registry.evaluate(document, evaluationOptions()));
  }
});

test("activity source and photography runtime asset set are bound to actual implementation terms", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const wrongSource = evidenceDocument("ACTIVITY_OPERATIONS");
  wrongSource.payload.contentSource = "OPERATIONS_ADMIN";
  attachSignoffs(wrongSource);
  expectCode(
    () => registry.evaluate(wrongSource, evaluationOptions()),
    "CONTENT_UED_ACTIVITY_EVIDENCE_INVALID"
  );

  const driftedAssetSet = evidenceDocument("PHOTOGRAPHY_RIGHTS");
  driftedAssetSet.payload.runtimeAssetSetDigest = sha256("different-runtime-asset-set");
  attachSignoffs(driftedAssetSet);
  expectCode(
    () => registry.evaluate(driftedAssetSet, evaluationOptions()),
    "CONTENT_UED_PHOTOGRAPHY_ASSET_SET_MISMATCH"
  );
});

test("photography asset-set digest is normalized and rejects substituted assets retaining old digest", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const reordered = evidenceDocument("PHOTOGRAPHY_RIGHTS");
  reordered.payload.assets.reverse();
  attachSignoffs(reordered);
  assert.equal(registry.evaluate(reordered, evaluationOptions()).structureValid, true);

  const substituted = evidenceDocument("PHOTOGRAPHY_RIGHTS");
  substituted.payload.assets[0].assetRef = ref("asset", "replacement-photo-asset");
  substituted.payload.assets[0].cleanMasterDigest = sha256("replacement-photo-clean-master");
  attachSignoffs(substituted);
  expectCode(
    () => registry.evaluate(substituted, evaluationOptions()),
    "CONTENT_UED_PHOTOGRAPHY_ASSET_SET_MISMATCH"
  );
});

test("release-level replay and conflicting duties fail closed", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const replayed = environmentBundle();
  replayed.evidenceDocuments[1].signoffs[0].signoffId = replayed.evidenceDocuments[0].signoffs[0].signoffId;
  refreshSignoff(replayed.evidenceDocuments[1].signoffs[0]);
  expectCode(
    () => registry.evaluate(replayed, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_REPLAY_REJECTED"
  );

  const conflict = environmentBundle();
  const product = conflict.evidenceDocuments.find((item) => item.evidenceKind === "HEALTH_CONTENT")
    .signoffs.find((item) => item.role === "PRODUCT");
  const privacy = conflict.evidenceDocuments.find((item) => item.evidenceKind === "PRIVACY_COMPLIANCE")
    .signoffs.find((item) => item.role === "PRIVACY");
  privacy.signerRef = product.signerRef;
  refreshSignoff(privacy);
  expectCode(
    () => registry.evaluate(conflict, evaluationOptions()),
    "CONTENT_UED_SIGNOFF_DUTY_CONFLICT"
  );
});

test("sealed structure expires at current verification time and requires the current revocation snapshot", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const envelope = registry.seal(releaseBundle(), evaluationOptions());
  assert.equal(registry.verify(envelope, {
    verifiedAt: "2027-01-01T00:00:00.000Z",
    revocationSnapshotDigest: REVOCATION_SNAPSHOT_DIGEST,
  }), false);
  assert.equal(registry.verify(envelope, {
    verifiedAt: EVALUATED_AT,
    revocationSnapshotDigest: sha256("new-revocation-snapshot"),
  }), false);
});

test("raw fields, contract authority drift and sealed-envelope tampering are detected", () => {
  const registry = getDefaultContentUedAuthorizationRegistry();
  const raw = evidenceDocument("PHOTOGRAPHY_RIGHTS");
  raw.payload.assets[0].creatorOrPhotographer = "raw name must not be stored";
  expectCode(
    () => registry.evaluate(raw, evaluationOptions()),
    "CONTENT_UED_PHOTOGRAPHY_EVIDENCE_INVALID"
  );

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.authorization.assetPublicationAuthorized = true;
  expectCode(
    () => createContentUedAuthorizationRegistry({ manifest }),
    "CONTENT_UED_AUTHORIZATION_CONTRACT_INVALID"
  );

  const envelope = clone(registry.seal(releaseBundle(), evaluationOptions()));
  envelope.input.environmentBundles[0].evidenceDocuments[0].payload.configuredContentCount += 1;
  assert.equal(registry.verify(envelope, {
    verifiedAt: EVALUATED_AT,
    revocationSnapshotDigest: REVOCATION_SNAPSHOT_DIGEST,
  }), false);
});
