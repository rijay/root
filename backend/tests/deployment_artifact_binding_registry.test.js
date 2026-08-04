const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computeCloudFunctionDeploymentSetDigest,
  computeDeploymentArtifactBindingPayloadDigest,
  computeDeploymentArtifactBindingRegistryDigest,
  computeDeploymentArtifactBindingSignoffPayloadDigest,
  computeSourceProvenancePayloadDigest,
  createDeploymentArtifactBindingRegistry,
  getDefaultDeploymentArtifactBindingRegistry,
} = require("../src/deploymentArtifactBindingRegistry");
const {
  getDefaultReleaseEvidenceContractRegistry,
} = require("../src/releaseEvidenceContractRegistry");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "deployment-artifact-binding",
  "v1.0.0.json"
);
const SOURCE_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "artifact-provenance",
  "v1.0.0.json"
);
const PACKAGE_PATH = path.join(REPOSITORY_ROOT, "package.json");
const CLOUDBASERC_PATH = path.join(REPOSITORY_ROOT, "cloudbaserc.json");

const MODULE_IDS = Object.freeze([
  "ADMIN",
  "BACKEND",
  "CLOUD_FUNCTION",
  "CONTENT",
  "FORMAL_ROUTES",
  "MIGRATION",
  "MINIPROGRAM",
]);
const FUNCTION_KEYS = Object.freeze([
  "MYROOT_HEALTH_RETENTION",
  "MYROOT_JOB_DISPATCHER",
]);
const ARTIFACT_KINDS = Object.freeze({
  ADMIN: "STATIC_ADMIN_BUNDLE_SHA256_V1",
  BACKEND: "OCI_IMAGE_SHA256_V1",
  CLOUD_FUNCTION: "CLOUD_FUNCTION_ARCHIVE_SET_SHA256_V1",
  CONTENT: "CONTENT_SET_SHA256_V1",
  MIGRATION: "MIGRATION_SET_SHA256_V1",
  MINIPROGRAM: "WECHAT_UPLOAD_PACKAGE_SHA256_V1",
  FORMAL_ROUTES: "FORMAL_ROUTES_BUNDLE_SHA256_V1",
});
const EVALUATED_AT = "2026-07-18T10:00:00.000Z";
const VERIFIED_AT = "2026-07-18T10:30:00.000Z";

function sha256(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function ref(namespace, seed) {
  return `${namespace}:sha256:${sha256(seed)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function adapterContracts() {
  return [{
    adapterId: "wechat-subscription-send",
    requirement: "REQUIRED",
    adapterContractDigest: sha256("adapter-contract:wechat-subscription-send"),
  }];
}

function functionReadbacks() {
  return FUNCTION_KEYS.map((functionKey) => ({
    functionKey,
    archiveDigest: sha256(`cloud-function-archive:${functionKey}`),
    platformSubjectRef: ref("subject", `cloud-function:${functionKey}`),
    platformRevisionRef: ref("revision", `cloud-function:${functionKey}:revision`),
    readbackSubjectRef: ref("subject", `cloud-function:${functionKey}`),
    readbackRevisionRef: ref("revision", `cloud-function:${functionKey}:revision`),
    readbackArchiveDigest: sha256(`cloud-function-archive:${functionKey}`),
    platformUploadReceiptRef: ref("receipt", `cloud-function:${functionKey}:receipt`),
    remoteReadbackEvidenceRef: ref("evidence", `cloud-function:${functionKey}:readback`),
    observedAt: "2026-07-18T08:30:00.000Z",
  }));
}

function deploymentDigests(functions = functionReadbacks()) {
  return Object.freeze({
    ADMIN: sha256("deployment:admin-static-bundle"),
    BACKEND: sha256("deployment:backend-oci-image"),
    CLOUD_FUNCTION: computeCloudFunctionDeploymentSetDigest(functions),
    CONTENT: sha256("deployment:content-set"),
    MIGRATION: sha256("deployment:migration-set"),
    MINIPROGRAM: sha256("deployment:miniprogram-upload-package"),
    FORMAL_ROUTES: sha256("deployment:formal-routes-bundle"),
  });
}

function sourceDigests() {
  return Object.freeze(Object.fromEntries(MODULE_IDS.map((moduleId) => [
    moduleId,
    sha256(`source-provenance-module:${moduleId}`),
  ])));
}

function sourceProvenance(sourceArtifactDigests = sourceDigests()) {
  const sourceManifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
  const payload = {
    schemaVersion: 1,
    contractStatus: "NON_RUNTIME_LOCAL_PROVENANCE_FOUNDATION",
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    sourceCommit: sha256("source-commit:v1.0.0").slice(0, 40),
    sourceSet: {
      fileCount: 412,
      totalBytes: 1234567,
      manifestSha256: sha256("source-set-manifest"),
    },
    artifactDigestByModule: MODULE_IDS.map((moduleId, index) => ({
      moduleId,
      artifactKind: "DETERMINISTIC_SOURCE_MODULE_V1",
      fileCount: index + 1,
      totalBytes: (index + 1) * 100,
      artifactDigest: sourceArtifactDigests[moduleId],
    })),
    sourceArchive: {
      format: "USTAR_FIXED_V1",
      fileName: "candidate-source.tar",
      bytes: 7654321,
      entryCount: 412,
      sha256: sha256("candidate-source-archive"),
    },
    governanceDigestSet: sourceManifest.governanceSourcePaths.map((governancePath, index) => ({
      refId: `governance-${String(index + 1).padStart(2, "0")}`,
      path: governancePath,
      sha256: sha256(`governance:${governancePath}`),
    })),
  };
  return {
    payloadDigest: computeSourceProvenancePayloadDigest(payload),
    payload,
  };
}

function candidateManifest(source, candidateArtifactDigests) {
  const releaseRegistry = getDefaultReleaseEvidenceContractRegistry();
  return releaseRegistry.seal("CANDIDATE_MANIFEST", {
    manifestFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    releaseId: ref("release", "myroot-v1.0.0-release"),
    targetEnvironmentId: ref("environment", "myroot-candidate-environment"),
    sourceCommit: source.payload.sourceCommit,
    artifactDigestByModule: [...MODULE_IDS].reverse().map((moduleId) => ({
      moduleId,
      artifactDigest: candidateArtifactDigests[moduleId],
    })),
    storeFormatVersion: "mysql-v1-foundation",
    migrationSetDigest: sha256("candidate:migration-set"),
    relationalSchemaDigest: sha256("candidate:relational-schema"),
    eventSchemaSetDigest: sha256("candidate:event-schema-set"),
    formalRoutesDigest: sha256("candidate:route-registry"),
    runtimeConfigDigest: sha256("candidate:runtime-config"),
    secretReferenceVersionDigest: sha256("candidate:secret-reference-version"),
    adapterRequirementRegistryDigest: sha256("candidate:adapter-requirement-registry"),
    featureFlagSnapshot: [
      { flagId: "v1-write", enabled: false },
      { flagId: "v1-read", enabled: false },
    ],
    adapterContractDigests: adapterContracts(),
    rollbackArtifactId: `sha256:${sha256("candidate:rollback-artifact")}`,
    createdAt: "2026-07-18T07:30:00.000Z",
  });
}

function platformBinding(moduleId, deploymentArtifactDigest) {
  return {
    platformSubjectRef: ref("subject", `${moduleId}:platform-subject`),
    platformRevisionRef: ref("revision", `${moduleId}:platform-revision`),
    readbackSubjectRef: ref("subject", `${moduleId}:platform-subject`),
    readbackRevisionRef: ref("revision", `${moduleId}:platform-revision`),
    readbackArtifactDigest: deploymentArtifactDigest,
    observedAt: "2026-07-18T08:30:00.000Z",
  };
}

function moduleBinding(moduleId, sourceArtifactDigest, deploymentArtifactDigest, functions) {
  const module = {
    moduleId,
    sourceArtifactDigest,
    deploymentArtifactDigest,
    artifactKind: ARTIFACT_KINDS[moduleId],
    remoteReadbackEvidenceRef: ref("evidence", `${moduleId}:module-readback`),
    platformBinding: platformBinding(moduleId, deploymentArtifactDigest),
  };
  if (moduleId === "BACKEND") {
    module.backend = {
      ociImageDigest: `sha256:${deploymentArtifactDigest}`,
      runtimeReadbackImageDigest: `sha256:${deploymentArtifactDigest}`,
    };
  } else if (moduleId === "MINIPROGRAM") {
    module.miniprogram = {
      uploadPackageDigest: deploymentArtifactDigest,
      uploadVersion: "0.5.13",
      platformUploadReceiptRef: ref("receipt", "miniprogram:upload-receipt"),
    };
  } else if (moduleId === "CLOUD_FUNCTION") {
    module.cloudFunctions = { functions: clone(functions) };
  }
  return module;
}

function refreshSignoff(signoff) {
  signoff.signedPayloadDigest = computeDeploymentArtifactBindingSignoffPayloadDigest(signoff);
  return signoff;
}

function attachSignoffs(document) {
  const bindingPayloadDigest = computeDeploymentArtifactBindingPayloadDigest(document);
  document.signoffs = ["ENGINEERING", "QA", "PLATFORM_SECURITY"].map((role) => refreshSignoff({
    signoffId: ref("signoff", `deployment-binding:${role}`),
    signerRef: ref("actor", `deployment-binding:${role}`),
    role,
    bindingPayloadDigest,
    decision: "APPROVED",
    signedAt: "2026-07-18T09:10:00.000Z",
    validUntil: document.validUntil,
    signatureMethod: "CONTROLLED_APPROVAL_RECORD_V1",
    signedPayloadDigest: sha256("temporary-signoff-payload"),
    signatureDigest: sha256(`deployment-binding-signature:${role}`),
    validatorRef: ref("validator", `deployment-binding:${role}`),
    validationStatus: "VALIDATED",
    validationEvidenceRef: ref("evidence", `deployment-binding-validation:${role}`),
    revocationStatus: "ACTIVE",
    revokedAt: null,
    revocationEvidenceRef: null,
  }));
  return document;
}

function fixture() {
  const functions = functionReadbacks();
  const sourceArtifactDigests = sourceDigests();
  const candidateArtifactDigests = deploymentDigests(functions);
  const source = sourceProvenance(sourceArtifactDigests);
  const candidate = candidateManifest(source, candidateArtifactDigests);
  const document = attachSignoffs({
    recordType: "DEPLOYMENT_ARTIFACT_BINDING",
    bindingFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    buildVersion: "0.5.13",
    sourceCommit: source.payload.sourceCommit,
    sourceProvenancePayloadDigest: source.payloadDigest,
    candidateManifestDigest: candidate.digest,
    releaseId: candidate.document.releaseId,
    targetEnvironmentRef: candidate.document.targetEnvironmentId,
    modules: MODULE_IDS.map((moduleId) => moduleBinding(
      moduleId,
      sourceArtifactDigests[moduleId],
      candidateArtifactDigests[moduleId],
      functions
    )),
    revocationSnapshotDigest: sha256("revocation-snapshot:2026-07-18"),
    validFrom: "2026-07-18T08:00:00.000Z",
    validUntil: "2026-07-25T08:00:00.000Z",
    collectedAt: "2026-07-18T09:00:00.000Z",
    revocationStatus: "ACTIVE",
    revokedAt: null,
    revocationEvidenceRef: null,
    signoffs: [],
  });
  return {
    document,
    context: {
      evaluatedAt: EVALUATED_AT,
      revocationSnapshotDigest: document.revocationSnapshotDigest,
      sourceProvenance: source,
      candidateManifest: candidate,
    },
    verificationContext: {
      verifiedAt: VERIFIED_AT,
      revocationSnapshotDigest: document.revocationSnapshotDigest,
      sourceProvenance: source,
      candidateManifest: candidate,
    },
  };
}

test("Contract fixes the seven Module kinds, full cloud-function set, and zero authority", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const sourceManifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
  const packageManifest = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  const cloudbaserc = JSON.parse(fs.readFileSync(CLOUDBASERC_PATH, "utf8"));
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const description = registry.describe();

  assert.equal(description.registryDigest, computeDeploymentArtifactBindingRegistryDigest(manifest));
  assert.equal(description.sourceProvenanceEvidenceClass, "SOURCE_PROVENANCE_ONLY");
  assert.equal(sourceManifest.remoteClosureRequirements.evidenceClass, "SOURCE_PROVENANCE_ONLY");
  assert.equal(description.validationLevel, "STRUCTURE_ONLY_UNTRUSTED_INPUT");
  assert.equal(description.buildVersion, "0.5.13");
  assert.equal(packageManifest.version, "0.5.13");
  assert.deepEqual(description.requiredArtifactModuleIds, MODULE_IDS);
  assert.deepEqual(description.requiredCloudFunctionKeys, FUNCTION_KEYS);
  assert.deepEqual(cloudbaserc.functions.map((entry) => entry.name).sort(), [
    "myroot-health-retention",
    "myroot-job-dispatcher",
  ]);
  assert.deepEqual(description.authorization, {
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    attestationAuthorized: false,
    platformMutationAuthorized: false,
    gateClosureAuthorized: false,
  });
});

test("complete bindings remain structure-only and cannot be sealed closed", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const { document, context, verificationContext } = fixture();
  const result = registry.evaluate(document, context);
  assert.equal(result.status, "STRUCTURE_ONLY_UNTRUSTED_INPUT");
  assert.equal(result.allBindingsStructurallyComplete, true);
  assert.equal(result.platformReadbackTrust, "OPAQUE_REFERENCES_NOT_DEREFERENCED");
  assert.equal(result.sealClosed, false);
  assert.equal(result.authorization.candidateCreationAuthorized, false);
  assert.equal(result.authorization.deploymentAuthorized, false);
  assert.equal(result.authorization.attestationAuthorized, false);
  assert.equal(result.authorization.gateClosureAuthorized, false);
  assert.deepEqual(result.moduleResults.map((entry) => entry.moduleId), MODULE_IDS);

  const envelope = registry.seal(document, context);
  assert.equal(envelope.sealStatus, "STRUCTURE_SEALED_NOT_GATE_CLOSED");
  assert.equal(registry.verify(envelope, verificationContext), true);
  expectCode(
    () => registry.sealClosed(document, context),
    "DEPLOYMENT_ARTIFACT_BINDING_UNTRUSTED_CANNOT_CLOSE"
  );
});

test("source and deployment digest classes cannot be swapped or collapsed", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const swapped = fixture();
  const backend = swapped.document.modules.find((entry) => entry.moduleId === "BACKEND");
  [backend.sourceArtifactDigest, backend.deploymentArtifactDigest] = [
    backend.deploymentArtifactDigest,
    backend.sourceArtifactDigest,
  ];
  expectCode(
    () => registry.evaluate(swapped.document, swapped.context),
    "DEPLOYMENT_ARTIFACT_BINDING_SOURCE_ARTIFACT_DIGEST_MISMATCH"
  );

  const collapsed = fixture();
  const admin = collapsed.document.modules.find((entry) => entry.moduleId === "ADMIN");
  const candidateDocument = clone(collapsed.context.candidateManifest.document);
  candidateDocument.artifactDigestByModule.find((entry) => entry.moduleId === "ADMIN")
    .artifactDigest = admin.sourceArtifactDigest;
  collapsed.context.candidateManifest = getDefaultReleaseEvidenceContractRegistry()
    .seal("CANDIDATE_MANIFEST", candidateDocument);
  collapsed.document.candidateManifestDigest = collapsed.context.candidateManifest.digest;
  admin.deploymentArtifactDigest = admin.sourceArtifactDigest;
  admin.platformBinding.readbackArtifactDigest = admin.sourceArtifactDigest;
  collapsed.document.signoffs = [];
  attachSignoffs(collapsed.document);
  expectCode(
    () => registry.evaluate(collapsed.document, collapsed.context),
    "DEPLOYMENT_ARTIFACT_BINDING_DIGEST_CLASS_MIXED"
  );
});

test("missing or duplicate Module entries fail closed", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const missing = fixture();
  missing.document.modules.pop();
  expectCode(
    () => registry.evaluate(missing.document, missing.context),
    "DEPLOYMENT_ARTIFACT_BINDING_MODULE_SET_INVALID"
  );

  const duplicate = fixture();
  duplicate.document.modules[6] = clone(duplicate.document.modules[0]);
  expectCode(
    () => registry.evaluate(duplicate.document, duplicate.context),
    "DEPLOYMENT_ARTIFACT_BINDING_MODULE_DUPLICATE_OR_UNKNOWN"
  );
});

test("cloud-function set is exact and rejects missing or duplicate functions", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const missing = fixture();
  const missingFunctions = missing.document.modules.find(
    (entry) => entry.moduleId === "CLOUD_FUNCTION"
  ).cloudFunctions.functions;
  missingFunctions.pop();
  expectCode(
    () => registry.evaluate(missing.document, missing.context),
    "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_SET_INVALID"
  );

  const duplicate = fixture();
  const duplicateFunctions = duplicate.document.modules.find(
    (entry) => entry.moduleId === "CLOUD_FUNCTION"
  ).cloudFunctions.functions;
  duplicateFunctions[1] = clone(duplicateFunctions[0]);
  expectCode(
    () => registry.evaluate(duplicate.document, duplicate.context),
    "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_DUPLICATE_OR_UNKNOWN"
  );
});

test("Candidate artifact digest mismatch fails before platform evidence can mask it", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const candidateMismatch = fixture();
  const content = candidateMismatch.document.modules.find((entry) => entry.moduleId === "CONTENT");
  content.deploymentArtifactDigest = sha256("replacement-content-deployment");
  content.platformBinding.readbackArtifactDigest = content.deploymentArtifactDigest;
  expectCode(
    () => registry.evaluate(candidateMismatch.document, candidateMismatch.context),
    "DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_ARTIFACT_DIGEST_MISMATCH"
  );
});

test("Cloud Run image and platform revision mismatches fail closed", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const imageMismatch = fixture();
  imageMismatch.document.modules.find((entry) => entry.moduleId === "BACKEND")
    .backend.runtimeReadbackImageDigest = `sha256:${sha256("wrong-runtime-image")}`;
  expectCode(
    () => registry.evaluate(imageMismatch.document, imageMismatch.context),
    "DEPLOYMENT_ARTIFACT_BINDING_BACKEND_IMAGE_MISMATCH"
  );

  const revisionMismatch = fixture();
  revisionMismatch.document.modules.find((entry) => entry.moduleId === "BACKEND")
    .platformBinding.readbackRevisionRef = ref("revision", "wrong-cloud-run-revision");
  expectCode(
    () => registry.evaluate(revisionMismatch.document, revisionMismatch.context),
    "DEPLOYMENT_ARTIFACT_BINDING_PLATFORM_READBACK_MISMATCH"
  );

  const functionRevisionMismatch = fixture();
  functionRevisionMismatch.document.modules.find((entry) => entry.moduleId === "CLOUD_FUNCTION")
    .cloudFunctions.functions[0].readbackRevisionRef = ref(
      "revision",
      "wrong-cloud-function-revision"
    );
  expectCode(
    () => registry.evaluate(functionRevisionMismatch.document, functionRevisionMismatch.context),
    "DEPLOYMENT_ARTIFACT_BINDING_CLOUD_FUNCTION_READBACK_MISMATCH"
  );
});

test("missing readback, raw URL, secret fields, and raw environment values are rejected", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const missingReadback = fixture();
  delete missingReadback.document.modules[0].remoteReadbackEvidenceRef;
  assert.throws(() => registry.sealClosed(missingReadback.document, missingReadback.context));

  const rawUrl = fixture();
  rawUrl.document.modules[0].remoteReadbackEvidenceRef =
    "https://platform.example.invalid/readback?token=raw";
  expectCode(
    () => registry.evaluate(rawUrl.document, rawUrl.context),
    "DEPLOYMENT_ARTIFACT_BINDING_RAW_MATERIAL_REJECTED"
  );

  const rawSecret = fixture();
  rawSecret.document.modules[0].accessToken = "do-not-store";
  expectCode(
    () => registry.evaluate(rawSecret.document, rawSecret.context),
    "DEPLOYMENT_ARTIFACT_BINDING_RAW_MATERIAL_REJECTED"
  );

  const rawEnvironment = fixture();
  rawEnvironment.document.targetEnvironmentRef = "myroot-prod-raw-environment";
  expectCode(
    () => registry.evaluate(rawEnvironment.document, rawEnvironment.context),
    "DEPLOYMENT_ARTIFACT_BINDING_DOCUMENT_INVALID"
  );
});

test("expiry, revocation, observedAt, and revocation snapshots are enforced", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const expired = fixture();
  expired.context.evaluatedAt = "2026-08-01T10:00:00.000Z";
  expectCode(
    () => registry.evaluate(expired.document, expired.context),
    "DEPLOYMENT_ARTIFACT_BINDING_EXPIRED_OR_REVOKED"
  );

  const revoked = fixture();
  revoked.document.revocationStatus = "REVOKED";
  revoked.document.revokedAt = "2026-07-18T09:30:00.000Z";
  revoked.document.revocationEvidenceRef = ref("evidence", "binding-revocation");
  assert.throws(() => registry.evaluate(revoked.document, revoked.context));

  const futureObservation = fixture();
  futureObservation.document.modules[0].platformBinding.observedAt =
    "2026-07-18T11:00:00.000Z";
  expectCode(
    () => registry.evaluate(futureObservation.document, futureObservation.context),
    "DEPLOYMENT_ARTIFACT_BINDING_OBSERVED_AT_INVALID"
  );

  const snapshotMismatch = fixture();
  snapshotMismatch.context.revocationSnapshotDigest = sha256("new-revocation-snapshot");
  expectCode(
    () => registry.evaluate(snapshotMismatch.document, snapshotMismatch.context),
    "DEPLOYMENT_ARTIFACT_BINDING_EXPIRED_OR_REVOKED"
  );
});

test("required duties cannot share a signer and revoked signoffs fail closed", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const conflict = fixture();
  conflict.document.signoffs[1].signerRef = conflict.document.signoffs[0].signerRef;
  refreshSignoff(conflict.document.signoffs[1]);
  expectCode(
    () => registry.evaluate(conflict.document, conflict.context),
    "DEPLOYMENT_ARTIFACT_BINDING_SIGNOFF_DUTY_CONFLICT"
  );

  const revoked = fixture();
  revoked.document.signoffs[0].revocationStatus = "REVOKED";
  revoked.document.signoffs[0].revokedAt = "2026-07-18T09:30:00.000Z";
  revoked.document.signoffs[0].revocationEvidenceRef = ref("evidence", "signoff-revocation");
  assert.throws(() => registry.evaluate(revoked.document, revoked.context));
});

test("source payload and Candidate envelope tampering cannot be rebound", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const sourceTamper = fixture();
  sourceTamper.context.sourceProvenance.payload.sourceSet.fileCount += 1;
  expectCode(
    () => registry.evaluate(sourceTamper.document, sourceTamper.context),
    "DEPLOYMENT_ARTIFACT_BINDING_SOURCE_PROVENANCE_DIGEST_MISMATCH"
  );

  const candidateTamper = fixture();
  candidateTamper.context.candidateManifest = clone(candidateTamper.context.candidateManifest);
  candidateTamper.context.candidateManifest.document.runtimeConfigDigest = sha256(
    "tampered-runtime-config"
  );
  expectCode(
    () => registry.evaluate(candidateTamper.document, candidateTamper.context),
    "DEPLOYMENT_ARTIFACT_BINDING_CANDIDATE_MANIFEST_INVALID"
  );
});

test("sealed-envelope tampering and stale verification context are detected", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const original = fixture();
  const envelope = registry.seal(original.document, original.context);

  const documentTamper = clone(envelope);
  documentTamper.document.modules[0].platformBinding.readbackArtifactDigest = sha256(
    "tampered-readback"
  );
  assert.equal(registry.verify(documentTamper, original.verificationContext), false);

  const resultTamper = clone(envelope);
  resultTamper.result.authorization.gateClosureAuthorized = true;
  assert.equal(registry.verify(resultTamper, original.verificationContext), false);

  const evaluatedAtTamper = clone(envelope);
  evaluatedAtTamper.evaluatedAt = "2026-07-18T09:30:00.000Z";
  assert.equal(registry.verify(evaluatedAtTamper, original.verificationContext), false);

  const staleSnapshot = clone(original.verificationContext);
  staleSnapshot.revocationSnapshotDigest = sha256("later-revocation-snapshot");
  assert.equal(registry.verify(envelope, staleSnapshot), false);

  const expired = clone(original.verificationContext);
  expired.verifiedAt = "2026-08-01T10:00:00.000Z";
  assert.equal(registry.verify(envelope, expired), false);
});

test("Module, function, and signoff ordering has one stable canonical digest", () => {
  const registry = getDefaultDeploymentArtifactBindingRegistry();
  const first = fixture();
  const reordered = fixture();
  reordered.document.modules.reverse();
  reordered.document.modules.find((entry) => entry.moduleId === "CLOUD_FUNCTION")
    .cloudFunctions.functions.reverse();
  reordered.document.signoffs.reverse();

  const firstEnvelope = registry.seal(first.document, first.context);
  const reorderedEnvelope = registry.seal(reordered.document, reordered.context);
  assert.equal(firstEnvelope.documentDigest, reorderedEnvelope.documentDigest);
  assert.equal(firstEnvelope.resultDigest, reorderedEnvelope.resultDigest);
  assert.deepEqual(reorderedEnvelope.document.modules.map((entry) => entry.moduleId), MODULE_IDS);
  assert.deepEqual(
    reorderedEnvelope.document.modules.find((entry) => entry.moduleId === "CLOUD_FUNCTION")
      .cloudFunctions.functions.map((entry) => entry.functionKey),
    FUNCTION_KEYS
  );
  assert.deepEqual(
    reorderedEnvelope.document.signoffs.map((entry) => entry.role),
    ["ENGINEERING", "QA", "PLATFORM_SECURITY"]
  );
});

test("Contract authority drift fails before the Registry Interface is exposed", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.authorization.deploymentAuthorized = true;
  expectCode(
    () => createDeploymentArtifactBindingRegistry({ manifest }),
    "DEPLOYMENT_ARTIFACT_BINDING_CONTRACT_INVALID"
  );

  const sourceManifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
  sourceManifest.remoteClosureRequirements.evidenceClass = "DEPLOYMENT_PROVENANCE";
  expectCode(
    () => createDeploymentArtifactBindingRegistry({ sourceProvenanceManifest: sourceManifest }),
    "DEPLOYMENT_ARTIFACT_BINDING_SOURCE_CONTRACT_INVALID"
  );
});
