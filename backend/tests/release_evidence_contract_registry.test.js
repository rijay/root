const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computeReleaseEvidenceContractRegistryDigest,
  computeReleaseEvidenceDocumentDigest,
  createReleaseEvidenceContractRegistry,
  getDefaultReleaseEvidenceContractRegistry,
} = require("../src/releaseEvidenceContractRegistry");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "release-evidence",
  "v1.0.0.json"
);
const DIGESTS = Object.freeze({
  backend: "1".repeat(64),
  miniprogram: "2".repeat(64),
  cloudFunction: "3".repeat(64),
  admin: "4".repeat(64),
  content: "5".repeat(64),
  migrationArtifact: "6".repeat(64),
  routeArtifact: "7".repeat(64),
  migrationSet: "8".repeat(64),
  relationalSchema: "9".repeat(64),
  eventSchema: "a".repeat(64),
  routeRegistry: "b".repeat(64),
  runtimeConfig: "c".repeat(64),
  secretReferences: "d".repeat(64),
  requiredAdapterContract: "e".repeat(64),
  optionalAdapterContract: "f".repeat(64),
  disabledAdapterContract: "0".repeat(64),
  adapterRequirementRegistry: "01".repeat(32),
  lineage: "12".repeat(32),
  requiredAdapterProof: "23".repeat(32),
  optionalAdapterProof: "34".repeat(32),
  uat: "45".repeat(32),
  rollback: "56".repeat(32),
  signoff: "67".repeat(32),
});

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function adapterRequirements() {
  return [
    {
      adapterId: "wechat-subscription-send",
      requirement: "REQUIRED",
      adapterContractDigest: DIGESTS.requiredAdapterContract,
    },
    {
      adapterId: "youzan-coupon-read",
      requirement: "OPTIONAL",
      adapterContractDigest: DIGESTS.optionalAdapterContract,
    },
    {
      adapterId: "wework-touch",
      requirement: "DISABLED",
      adapterContractDigest: DIGESTS.disabledAdapterContract,
    },
  ];
}

function adapterRequirementRegistry(overrides = {}) {
  return {
    registryFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    registryId: "adapter-requirements-foundation-fixture-001",
    adapterRequirements: adapterRequirements(),
    createdAt: "2026-07-16T23:59:00.000Z",
    ...overrides,
  };
}

function sealedCandidateWithRequirements(registry, overrides = {}) {
  const requirementEnvelope = registry.seal(
    "ADAPTER_REQUIREMENT_REGISTRY",
    adapterRequirementRegistry()
  );
  const candidateEnvelope = registry.seal("CANDIDATE_MANIFEST", candidate({
    adapterRequirementRegistryDigest: requirementEnvelope.digest,
    ...overrides,
  }));
  return { requirementEnvelope, candidateEnvelope };
}

function candidate(overrides = {}) {
  return {
    manifestFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: "root-release-foundation-fixture-001",
    targetEnvironmentId: "isolated-foundation-fixture",
    sourceCommit: "a".repeat(40),
    artifactDigestByModule: [
      { moduleId: "ROUTE_REGISTRY", artifactDigest: DIGESTS.routeArtifact },
      { moduleId: "BACKEND", artifactDigest: DIGESTS.backend },
      { moduleId: "MINIPROGRAM", artifactDigest: DIGESTS.miniprogram },
      { moduleId: "CONTENT", artifactDigest: DIGESTS.content },
      { moduleId: "ADMIN", artifactDigest: DIGESTS.admin },
      { moduleId: "MIGRATION", artifactDigest: DIGESTS.migrationArtifact },
      { moduleId: "CLOUD_FUNCTION", artifactDigest: DIGESTS.cloudFunction },
    ],
    storeFormatVersion: "mysql-v1-foundation",
    migrationSetDigest: DIGESTS.migrationSet,
    relationalSchemaDigest: DIGESTS.relationalSchema,
    eventSchemaSetDigest: DIGESTS.eventSchema,
    routeRegistryDigest: DIGESTS.routeRegistry,
    runtimeConfigDigest: DIGESTS.runtimeConfig,
    secretReferenceVersionDigest: DIGESTS.secretReferences,
    adapterRequirementRegistryDigest: DIGESTS.adapterRequirementRegistry,
    featureFlagSnapshot: [
      { flagId: "v1-write", enabled: false },
      { flagId: "v1-read", enabled: false },
    ],
    adapterContractDigests: adapterRequirements(),
    rollbackArtifactId: `sha256:${DIGESTS.rollback}`,
    createdAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

function observedCandidate(candidateDocument, overrides = {}) {
  return {
    targetEnvironmentId: candidateDocument.targetEnvironmentId,
    sourceCommit: candidateDocument.sourceCommit,
    artifactDigestByModule: candidateDocument.artifactDigestByModule,
    storeFormatVersion: candidateDocument.storeFormatVersion,
    migrationSetDigest: candidateDocument.migrationSetDigest,
    relationalSchemaDigest: candidateDocument.relationalSchemaDigest,
    eventSchemaSetDigest: candidateDocument.eventSchemaSetDigest,
    routeRegistryDigest: candidateDocument.routeRegistryDigest,
    runtimeConfigDigest: candidateDocument.runtimeConfigDigest,
    secretReferenceVersionDigest: candidateDocument.secretReferenceVersionDigest,
    featureFlagSnapshot: candidateDocument.featureFlagSnapshot,
    adapterContractDigests: candidateDocument.adapterContractDigests,
    adapterRequirementRegistryDigest: candidateDocument.adapterRequirementRegistryDigest,
    rollbackArtifactId: candidateDocument.rollbackArtifactId,
    ...overrides,
  };
}

function migrationAttestation(candidateEnvelope, overrides = {}) {
  const source = candidateEnvelope.document;
  return {
    attestationFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: source.releaseId,
    candidateManifestDigest: candidateEnvelope.digest,
    targetEnvironmentId: source.targetEnvironmentId,
    runtimeConfigDigest: source.runtimeConfigDigest,
    sourceSnapshotId: "snapshot-foundation-fixture-001",
    sourceSnapshotRevision: "revision-001",
    migrationSetDigest: source.migrationSetDigest,
    relationalSchemaDigest: source.relationalSchemaDigest,
    lineageSummaryDigest: DIGESTS.lineage,
    rollbackDrillId: "rollback-drill-foundation-fixture-001",
    createdAt: "2026-07-17T00:01:00.000Z",
    ...overrides,
  };
}

function adapterAttestation(candidateEnvelope, adapterId, overrides = {}) {
  const source = candidateEnvelope.document;
  const contract = source.adapterContractDigests.find((entry) => entry.adapterId === adapterId);
  return {
    attestationFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: source.releaseId,
    candidateManifestDigest: candidateEnvelope.digest,
    targetEnvironmentId: source.targetEnvironmentId,
    adapterId,
    adapterRequirement: contract.requirement,
    adapterContractDigest: contract.adapterContractDigest,
    runtimeConfigDigest: source.runtimeConfigDigest,
    secretReferenceVersionDigest: source.secretReferenceVersionDigest,
    proofDigest: adapterId === "wechat-subscription-send"
      ? DIGESTS.requiredAdapterProof : DIGESTS.optionalAdapterProof,
    createdAt: "2026-07-17T00:02:00.000Z",
    ...overrides,
  };
}

function uatEvidence(candidateEnvelope, overrides = {}) {
  return {
    evidenceFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: candidateEnvelope.document.releaseId,
    candidateManifestDigest: candidateEnvelope.digest,
    targetEnvironmentId: candidateEnvelope.document.targetEnvironmentId,
    uatProofDigest: DIGESTS.uat,
    createdAt: "2026-07-17T00:03:00.000Z",
    ...overrides,
  };
}

function rollbackDrillEvidence(candidateEnvelope, overrides = {}) {
  return {
    evidenceFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: candidateEnvelope.document.releaseId,
    candidateManifestDigest: candidateEnvelope.digest,
    targetEnvironmentId: candidateEnvelope.document.targetEnvironmentId,
    rollbackDrillId: "rollback-drill-foundation-fixture-001",
    rollbackArtifactId: candidateEnvelope.document.rollbackArtifactId,
    drillProofDigest: DIGESTS.rollback,
    createdAt: "2026-07-17T00:04:00.000Z",
    ...overrides,
  };
}

function signoffEvidence(candidateEnvelope, overrides = {}) {
  const roles = [
    "PRODUCT",
    "OPERATIONS",
    "ENGINEERING",
    "QA",
    "PRIVACY",
    "HEALTH_CONTENT_REVIEW",
  ];
  return {
    evidenceFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: candidateEnvelope.document.releaseId,
    candidateManifestDigest: candidateEnvelope.digest,
    targetEnvironmentId: candidateEnvelope.document.targetEnvironmentId,
    signoffs: roles.map((role, index) => ({
      role,
      decision: "APPROVED",
      signedByActorId: `foundation-fixture-${role.toLowerCase().replaceAll("_", "-")}`,
      signedAt: `2026-07-17T00:0${index + 3}:30.000Z`,
      signatureDigest: String(index + 1).repeat(64),
    })),
    createdAt: "2026-07-17T00:09:00.000Z",
    ...overrides,
  };
}

function evidenceSet(options = {}) {
  const registry = options.registry || getDefaultReleaseEvidenceContractRegistry();
  const requirementEnvelope = options.adapterRequirementRegistry || registry.seal(
    "ADAPTER_REQUIREMENT_REGISTRY",
    adapterRequirementRegistry()
  );
  const candidateEnvelope = options.candidateManifest
    || registry.seal("CANDIDATE_MANIFEST", candidate({
      adapterRequirementRegistryDigest: requirementEnvelope.digest,
    }));
  const migrationEnvelope = options.dataMigrationAttestation || registry.seal(
    "DATA_MIGRATION_ATTESTATION",
    migrationAttestation(candidateEnvelope)
  );
  const adapterEnvelopes = options.adapterAttestations || [
    registry.seal(
      "ADAPTER_ATTESTATION",
      adapterAttestation(candidateEnvelope, "wechat-subscription-send")
    ),
    registry.seal(
      "ADAPTER_ATTESTATION",
      adapterAttestation(candidateEnvelope, "youzan-coupon-read")
    ),
  ];
  const uatEnvelope = options.uatEvidence || registry.seal(
    "UAT_EVIDENCE",
    uatEvidence(candidateEnvelope)
  );
  const rollbackEnvelope = options.rollbackDrillEvidence || registry.seal(
    "ROLLBACK_DRILL_EVIDENCE",
    rollbackDrillEvidence(candidateEnvelope)
  );
  const signoffEnvelope = options.signoffEvidence || registry.seal(
    "SIGNOFF_EVIDENCE",
    signoffEvidence(candidateEnvelope)
  );
  const indexEnvelope = options.releaseEvidenceIndex || registry.seal(
    "RELEASE_EVIDENCE_INDEX",
    {
      indexFormatVersion: 1,
      digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
      releaseId: candidateEnvelope.document.releaseId,
      candidateManifestDigest: candidateEnvelope.digest,
      targetEnvironmentId: candidateEnvelope.document.targetEnvironmentId,
      dataMigrationAttestationDigest: migrationEnvelope.digest,
      adapterAttestationDigests: adapterEnvelopes.map((entry) => ({
        adapterId: entry.document.adapterId,
        adapterAttestationDigest: entry.digest,
      })).reverse(),
      uatEvidenceDigest: uatEnvelope.digest,
      rollbackDrillEvidenceDigest: rollbackEnvelope.digest,
      signoffEvidenceDigest: signoffEnvelope.digest,
      createdAt: "2026-07-17T00:10:00.000Z",
    }
  );
  return {
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: candidateEnvelope,
    dataMigrationAttestation: migrationEnvelope,
    adapterAttestations: adapterEnvelopes,
    uatEvidence: uatEnvelope,
    rollbackDrillEvidence: rollbackEnvelope,
    signoffEvidence: signoffEnvelope,
    releaseEvidenceIndex: indexEnvelope,
  };
}

test("Registry freezes all release-evidence contracts as non-runtime Foundation", () => {
  const manifest = readManifest();
  const registry = getDefaultReleaseEvidenceContractRegistry();
  assert.deepEqual(Object.keys(registry), [
    "assertReady",
    "describe",
    "seal",
    "verify",
    "verifyEvidenceSet",
    "assessInvalidation",
  ]);
  assert.equal(Object.isFrozen(registry), true);
  assert.deepEqual(registry.assertReady(), {
    foundationContractReady: true,
    contractStatus: "NON_RUNTIME_FOUNDATION_CONTRACT",
    authoritativeAdapterRequirementRegistryReady: false,
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    releaseIdGenerationAuthorized: false,
  });
  const description = registry.describe();
  assert.equal(description.registryDigest, computeReleaseEvidenceContractRegistryDigest(manifest));
  assert.equal(description.registryDigest, "5d4462d05880d15c1405bd340d9891572684479a4e6e52f4aa7b0a41610633d6");
  assert.equal(description.authoritativeAdapterRequirementRegistryBundled, false);
  assert.deepEqual(description.documentTypes, [
    "ADAPTER_ATTESTATION",
    "ADAPTER_REQUIREMENT_REGISTRY",
    "CANDIDATE_MANIFEST",
    "DATA_MIGRATION_ATTESTATION",
    "RELEASE_EVIDENCE_INDEX",
    "ROLLBACK_DRILL_EVIDENCE",
    "SIGNOFF_EVIDENCE",
    "UAT_EVIDENCE",
  ]);
  assert.equal(description.contractStatus, "NON_RUNTIME_FOUNDATION_CONTRACT");
  assert.deepEqual(description.requiredSignoffRoles, [
    "PRODUCT",
    "OPERATIONS",
    "ENGINEERING",
    "QA",
    "PRIVACY",
    "HEALTH_CONTENT_REVIEW",
  ]);
});

test("Candidate sealing sorts configured collections and produces a stable external digest", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const first = registry.seal("CANDIDATE_MANIFEST", candidate());
  const reordered = registry.seal("CANDIDATE_MANIFEST", candidate({
    artifactDigestByModule: [...candidate().artifactDigestByModule].reverse(),
    featureFlagSnapshot: [...candidate().featureFlagSnapshot].reverse(),
    adapterContractDigests: [...candidate().adapterContractDigests].reverse(),
  }));
  assert.equal(first.digestFieldName, "candidateManifestDigest");
  assert.equal(first.digest, "ffdf0b397940fdb22ec89e3a4d33e493feae6eadb2b0351e62a84f8652a3c09c");
  assert.equal(first.digest, reordered.digest);
  assert.equal(first.digest, computeReleaseEvidenceDocumentDigest(
    "CANDIDATE_MANIFEST",
    first.document
  ));
  assert.deepEqual(first.document.artifactDigestByModule.map((entry) => entry.moduleId), [
    "ADMIN",
    "BACKEND",
    "CLOUD_FUNCTION",
    "CONTENT",
    "MIGRATION",
    "MINIPROGRAM",
    "ROUTE_REGISTRY",
  ]);
  assert.deepEqual(first.document.featureFlagSnapshot.map((entry) => entry.flagId), [
    "v1-read",
    "v1-write",
  ]);
  assert.deepEqual(first.document.adapterContractDigests.map((entry) => entry.adapterId), [
    "wechat-subscription-send",
    "wework-touch",
    "youzan-coupon-read",
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.document.adapterContractDigests), true);
  assert.equal(registry.verify(first), true);
});

test("same-source evidence set verifies Candidate, migration, Adapter and Index digests", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const result = registry.verifyEvidenceSet(evidenceSet({ registry }));
  assert.equal(result.status, "VERIFIED_NON_RUNTIME_FOUNDATION_EVIDENCE_SET");
  assert.equal(result.runtimeAuthorized, false);
  assert.equal(result.requiredAdapterCount, 1);
  assert.equal(result.adapterAttestationCount, 2);
  assert.equal(result.releaseId, "root-release-foundation-fixture-001");
  assert.match(result.adapterRequirementRegistryDigest, /^[a-f0-9]{64}$/);
});

test("document tampering fails digest verification", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const envelope = registry.seal("CANDIDATE_MANIFEST", candidate());
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.document.runtimeConfigDigest = "0".repeat(64);
  assert.throws(
    () => registry.verify(tampered),
    (error) => error && error.code === "RELEASE_EVIDENCE_DIGEST_MISMATCH"
  );
});

test("an attestation from another release cannot be rebound to a new Candidate", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { requirementEnvelope, candidateEnvelope: firstCandidate }
    = sealedCandidateWithRequirements(registry);
  const oldAdapter = registry.seal(
    "ADAPTER_ATTESTATION",
    adapterAttestation(firstCandidate, "wechat-subscription-send")
  );
  const secondCandidate = registry.seal("CANDIDATE_MANIFEST", candidate({
    releaseId: "root-release-foundation-fixture-002",
    createdAt: "2026-07-17T00:00:30.000Z",
    adapterRequirementRegistryDigest: requirementEnvelope.digest,
  }));
  const set = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: secondCandidate,
    adapterAttestations: [oldAdapter],
  });
  assert.throws(
    () => registry.verifyEvidenceSet(set),
    (error) => error && error.code === "RELEASE_EVIDENCE_ADAPTER_ATTESTATION_MISMATCH"
  );
});

test("UAT evidence from another release cannot be rebound through the Index", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { requirementEnvelope, candidateEnvelope: firstCandidate }
    = sealedCandidateWithRequirements(registry);
  const oldUat = registry.seal("UAT_EVIDENCE", uatEvidence(firstCandidate));
  const secondCandidate = registry.seal("CANDIDATE_MANIFEST", candidate({
    releaseId: "root-release-foundation-fixture-002",
    createdAt: "2026-07-17T00:00:30.000Z",
    adapterRequirementRegistryDigest: requirementEnvelope.digest,
  }));
  const set = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: secondCandidate,
    uatEvidence: oldUat,
  });
  assert.throws(
    () => registry.verifyEvidenceSet(set),
    (error) => error && error.code === "RELEASE_EVIDENCE_SAME_SOURCE_MISMATCH"
  );
});

test("target environment and Candidate digest remain part of the same-source identity", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { requirementEnvelope, candidateEnvelope }
    = sealedCandidateWithRequirements(registry);
  const wrongEnvironmentMigration = registry.seal(
    "DATA_MIGRATION_ATTESTATION",
    migrationAttestation(candidateEnvelope, {
      targetEnvironmentId: "different-foundation-environment",
    })
  );
  const set = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: candidateEnvelope,
    dataMigrationAttestation: wrongEnvironmentMigration,
  });
  assert.throws(
    () => registry.verifyEvidenceSet(set),
    (error) => error && error.code === "RELEASE_EVIDENCE_SAME_SOURCE_MISMATCH"
  );
});

test("every required Adapter needs one matching attestation and Index reference", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { requirementEnvelope, candidateEnvelope }
    = sealedCandidateWithRequirements(registry);
  const optionalOnly = registry.seal(
    "ADAPTER_ATTESTATION",
    adapterAttestation(candidateEnvelope, "youzan-coupon-read")
  );
  const set = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: candidateEnvelope,
    adapterAttestations: [optionalOnly],
  });
  assert.throws(
    () => registry.verifyEvidenceSet(set),
    (error) => error
      && error.code === "RELEASE_EVIDENCE_REQUIRED_ADAPTER_ATTESTATION_MISSING"
  );
});

test("Candidate cannot downgrade a required Adapter declared by the independent Registry", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const requirementEnvelope = registry.seal(
    "ADAPTER_REQUIREMENT_REGISTRY",
    adapterRequirementRegistry()
  );
  const downgraded = adapterRequirements().map((entry) => {
    if (entry.adapterId === "wechat-subscription-send") return { ...entry, requirement: "OPTIONAL" };
    if (entry.adapterId === "youzan-coupon-read") return { ...entry, requirement: "REQUIRED" };
    return entry;
  });
  const candidateEnvelope = registry.seal("CANDIDATE_MANIFEST", candidate({
    adapterRequirementRegistryDigest: requirementEnvelope.digest,
    adapterContractDigests: downgraded,
  }));
  const set = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: candidateEnvelope,
  });
  assert.throws(
    () => registry.verifyEvidenceSet(set),
    (error) => error
      && error.code === "RELEASE_EVIDENCE_ADAPTER_REQUIREMENT_REGISTRY_MISMATCH"
  );
});

test("secret-shaped fields and secret material are rejected before sealing", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const withSecretField = { ...candidate(), accessToken: "do-not-store" };
  const withPrivateKey = candidate({ rollbackArtifactId: "-----BEGIN PRIVATE KEY-----" });
  const withJwtIdentifier = candidate({
    releaseId: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyb290LW9wZXJhdG9yIn0.signature123456789",
  });
  const highConfidenceSecretIdentifiers = [
    withJwtIdentifier,
    candidate({ releaseId: "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==" }),
    candidate({ releaseId: "AKIAIOSFODNN7EXAMPLE" }),
    candidate({ releaseId: "AKIDabcdefghijklmnop" }),
    candidate({ releaseId: `ghp_${"a".repeat(24)}` }),
  ];
  for (const input of [withSecretField, withPrivateKey, ...highConfidenceSecretIdentifiers]) {
    assert.throws(
      () => registry.seal("CANDIDATE_MANIFEST", input),
      (error) => error && error.code === "RELEASE_EVIDENCE_SECRET_SHAPE_REJECTED"
    );
  }
  assert.doesNotThrow(() => registry.seal("CANDIDATE_MANIFEST", candidate()));
  assert.doesNotThrow(() => registry.seal("CANDIDATE_MANIFEST", candidate({
    adapterRequirementRegistryDigest: "a".repeat(64),
  })));
  assert.throws(
    () => registry.seal("CANDIDATE_MANIFEST", candidate({
      rollbackArtifactId: "rollback-foundation-fixture-001",
    })),
    (error) => error && error.code === "RELEASE_EVIDENCE_CONTRACT_INVALID"
  );
});

test("Signoff needs all six roles and Index references verified evidence envelopes only", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { candidateEnvelope } = sealedCandidateWithRequirements(registry);
  const missingHealthReview = signoffEvidence(candidateEnvelope);
  missingHealthReview.signoffs = missingHealthReview.signoffs.filter(
    (entry) => entry.role !== "HEALTH_CONTENT_REVIEW"
  );
  assert.throws(
    () => registry.seal("SIGNOFF_EVIDENCE", missingHealthReview),
    (error) => error && error.code === "RELEASE_EVIDENCE_CONTRACT_INVALID"
  );

  const set = evidenceSet({ registry });
  const falseIndexReference = registry.seal("RELEASE_EVIDENCE_INDEX", {
    ...set.releaseEvidenceIndex.document,
    signoffEvidenceDigest: "a".repeat(64),
  });
  assert.throws(
    () => registry.verifyEvidenceSet({
      ...set,
      releaseEvidenceIndex: falseIndexReference,
    }),
    (error) => error && error.code === "RELEASE_EVIDENCE_INDEX_DIGEST_MISMATCH"
  );
});

test("evidence creation is monotonic from Candidate through the Index", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const { requirementEnvelope, candidateEnvelope }
    = sealedCandidateWithRequirements(registry);
  const earlyUat = registry.seal("UAT_EVIDENCE", uatEvidence(candidateEnvelope, {
    createdAt: "2026-07-16T23:59:30.000Z",
  }));
  const earlyEvidenceSet = evidenceSet({
    registry,
    adapterRequirementRegistry: requirementEnvelope,
    candidateManifest: candidateEnvelope,
    uatEvidence: earlyUat,
  });
  assert.throws(
    () => registry.verifyEvidenceSet(earlyEvidenceSet),
    (error) => error && error.code === "RELEASE_EVIDENCE_TIME_ORDER_INVALID"
  );

  const validSet = evidenceSet({ registry });
  const earlyIndex = registry.seal("RELEASE_EVIDENCE_INDEX", {
    ...validSet.releaseEvidenceIndex.document,
    createdAt: "2026-07-17T00:08:59.999Z",
  });
  assert.throws(
    () => registry.verifyEvidenceSet({ ...validSet, releaseEvidenceIndex: earlyIndex }),
    (error) => error && error.code === "RELEASE_EVIDENCE_TIME_ORDER_INVALID"
  );
});

test("config, schema, Route Registry and Adapter contract drift each invalidate the Candidate", () => {
  const registry = getDefaultReleaseEvidenceContractRegistry();
  const candidateEnvelope = registry.seal("CANDIDATE_MANIFEST", candidate());
  const source = candidateEnvelope.document;
  const stable = registry.assessInvalidation({
    candidateManifest: candidateEnvelope,
    observedCandidateFingerprint: observedCandidate(source),
  });
  assert.equal(stable.invalidated, false);
  assert.equal(stable.requiresNewReleaseId, false);
  assert.deepEqual(stable.changes, []);

  const cases = [
    ["RUNTIME_CONFIG_CHANGED", { runtimeConfigDigest: "1".repeat(64) }],
    ["RELATIONAL_SCHEMA_CHANGED", { relationalSchemaDigest: "2".repeat(64) }],
    ["ROUTE_REGISTRY_CHANGED", { routeRegistryDigest: "3".repeat(64) }],
    ["ADAPTER_CONTRACT_CHANGED", {
      adapterContractDigests: source.adapterContractDigests.map((entry) => (
        entry.adapterId === "wechat-subscription-send"
          ? { ...entry, adapterContractDigest: "4".repeat(64) }
          : entry
      )),
    }],
  ];
  for (const [expectedRuleId, override] of cases) {
    const result = registry.assessInvalidation({
      candidateManifest: candidateEnvelope,
      observedCandidateFingerprint: observedCandidate(source, override),
    });
    assert.equal(result.invalidated, true);
    assert.equal(result.requiresNewReleaseId, true);
    assert.deepEqual(result.changes.map((entry) => entry.ruleId), [expectedRuleId]);
    assert.equal(result.priorReleaseId, source.releaseId);
  }
});

test("manifest field or invalidation-rule drift fails closed", () => {
  const source = readManifest();
  const alteredField = JSON.parse(JSON.stringify(source));
  alteredField.documents.find((entry) => entry.documentType === "CANDIDATE_MANIFEST")
    .exactFields.push("rawSecret");
  const alteredRule = JSON.parse(JSON.stringify(source));
  alteredRule.invalidationRules.find((entry) => entry.ruleId === "ROUTE_REGISTRY_CHANGED")
    .ruleId = "ROUTE_CHANGE_IGNORED";
  const reversedDocumentOrder = JSON.parse(JSON.stringify(source));
  reversedDocumentOrder.documents.reverse();
  for (const manifest of [alteredField, alteredRule, reversedDocumentOrder]) {
    assert.throws(
      () => createReleaseEvidenceContractRegistry({ manifest }),
      (error) => error && error.code === "RELEASE_EVIDENCE_CONTRACT_MANIFEST_INVALID"
    );
  }
});
