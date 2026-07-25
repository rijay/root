const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AUTHORIZATION,
  CONTRACT_VERSION,
  EVIDENCE_CLASS,
  RECIPIENT_BINDING_LIFECYCLE_PHASES,
  REQUIRED_ENVIRONMENTS,
  TARGET_MIGRATIONS,
  inspectIdentityRecipientDeploymentCompatibility,
} = require("../src/identityRecipientDeploymentCompatibility");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ref(namespace, seed) {
  return `${namespace}:sha256:${sha256(seed)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const RELEASE_REF = ref("release", "myroot-v1.0.0-identity-recipient-D0");

function verifiedEvidence(environmentKind, assertion, seed) {
  const contentDigest = sha256(`${environmentKind}:${assertion}:${seed}:document`);
  return {
    status: "VERIFIED",
    assertion,
    releaseRef: RELEASE_REF,
    environmentRef: ref("environment", environmentKind.toLowerCase()),
    evidenceRef: `evidence:sha256:${contentDigest}`,
    signerRef: ref("actor", `${environmentKind}:${assertion}:signer`),
    verifiedAt: environmentKind === "CANDIDATE"
      ? "2026-07-18T02:00:00.000Z"
      : "2026-07-18T03:00:00.000Z",
    contentDigest,
  };
}

function rollbackArtifact(environmentKind) {
  const evidence = verifiedEvidence(
    environmentKind,
    "ROLLBACK_COMPATIBLE",
    "rollback-compatibility"
  );
  const artifactDigest = sha256("myroot-v1.0.0-rollback-artifact");
  return {
    ...evidence,
    artifactRef: `artifact:sha256:${artifactDigest}`,
    artifactDigest,
    targetMigrations: [...TARGET_MIGRATIONS],
    unionidTrustStatusUnderstood: true,
    unionidProvenanceUnderstood: true,
    sameRootAppUniquenessPreserved: true,
    recipientBindingStatusUnderstood: true,
    recipientBindingFullLifecyclePreserved: true,
    recipientBindingLifecyclePhases: [...RECIPIENT_BINDING_LIFECYCLE_PHASES],
    historicalUnverifiedReviewRequiredSemanticsPreserved: true,
    historicalUnionidTrustStatus: "UNVERIFIED",
    historicalUnionidStatus: "PENDING",
    historicalRecipientBindingStatus: "UNVERIFIED",
    historicalSubscriptionGrantStatus: "REVIEW_REQUIRED",
    legacyLinkedRestoreForbidden: true,
    unboundNotificationSendForbidden: true,
    providerCallFenceStateMachineUnderstood: true,
    startedProviderCallUnknownRecoveryPreserved: true,
    providerCallAutomaticResendForbidden: true,
    historicalRequestedProviderCallReviewRequired: true,
    historicalRequestedProviderCallState: "REVIEW_REQUIRED",
    historicalProviderCallGeneration: 0,
  };
}

function environmentEvidence(environmentKind) {
  return {
    environmentKind,
    environmentRef: ref("environment", environmentKind.toLowerCase()),
    releaseRef: RELEASE_REF,
    legacyIdentityWritersDrained: verifiedEvidence(
      environmentKind,
      "LEGACY_IDENTITY_WRITERS_DRAINED",
      "identity-writer-drain"
    ),
    legacySubscriptionWritersDrained: verifiedEvidence(
      environmentKind,
      "LEGACY_SUBSCRIPTION_WRITERS_DRAINED",
      "subscription-writer-drain"
    ),
    legacyNotificationSendersDrained: verifiedEvidence(
      environmentKind,
      "LEGACY_NOTIFICATION_SENDERS_DRAINED",
      "notification-sender-drain"
    ),
    rollbackArtifact: rollbackArtifact(environmentKind),
  };
}

function compatibilityEnvelope() {
  return {
    contractVersion: CONTRACT_VERSION,
    releaseRef: RELEASE_REF,
    targetMigrations: [...TARGET_MIGRATIONS],
    environments: REQUIRED_ENVIRONMENTS.map(environmentEvidence),
  };
}

function expectBlocked(input, blocker) {
  const evaluation = inspectIdentityRecipientDeploymentCompatibility(input);
  assert.equal(evaluation.evidenceComplete, false);
  assert.equal(evaluation.ready, false);
  assert.equal(evaluation.hardBlocker, true);
  assert.equal(evaluation.blockers.includes(blocker), true, JSON.stringify(evaluation.blockers));
  return evaluation;
}

test("default inspection is a hard blocker for the exact 049 through 060 migration range", () => {
  const evaluation = inspectIdentityRecipientDeploymentCompatibility();
  assert.equal(evaluation.contractVersion, CONTRACT_VERSION);
  assert.deepEqual(evaluation.targetMigrations, [
    "049_wechat_unionid_provenance_stage.sql",
    "050_wechat_unionid_provenance_backfill.sql",
    "051_wechat_unionid_provenance_enforce.sql",
    "052_notification_recipient_binding_legacy_stage.sql",
    "053_notification_recipient_binding_v1_stage.sql",
    "054_notification_recipient_binding_legacy_backfill.sql",
    "055_notification_recipient_binding_v1_backfill.sql",
    "056_notification_recipient_binding_legacy_enforce.sql",
    "057_notification_recipient_binding_v1_enforce.sql",
    "058_notification_provider_call_fence_stage.sql",
    "059_notification_provider_call_fence_backfill.sql",
    "060_notification_provider_call_fence_enforce.sql",
  ]);
  assert.deepEqual(evaluation.requiredEnvironments, ["CANDIDATE", "PRODUCTION"]);
  assert.equal(evaluation.evidenceClass, EVIDENCE_CLASS);
  assert.equal(evaluation.evidenceComplete, false);
  assert.equal(evaluation.ready, false);
  assert.equal(evaluation.hardBlocker, true);
  assert.equal(evaluation.contentDigest, null);
  assert.equal(evaluation.blockers.includes("COMPATIBILITY_ENVELOPE_INVALID"), true);
});

test("complete dual-environment evidence is content-addressed but cannot authorize local gate closure", () => {
  const input = compatibilityEnvelope();
  const evaluation = inspectIdentityRecipientDeploymentCompatibility(input);
  assert.equal(evaluation.evidenceComplete, true);
  assert.equal(evaluation.externalVerificationRequired, true);
  assert.equal(evaluation.ready, false);
  assert.equal(evaluation.hardBlocker, true);
  assert.equal(
    evaluation.status,
    "IDENTITY_RECIPIENT_DEPLOYMENT_COMPATIBILITY_EXTERNAL_VERIFICATION_HARD_BLOCKER"
  );
  assert.deepEqual(evaluation.blockers, [
    "CONTROLLED_CANDIDATE_PRODUCTION_EVIDENCE_VERIFICATION_REQUIRED",
  ]);
  assert.match(evaluation.contentDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(evaluation.authorization, AUTHORIZATION);
  assert.equal(Object.values(evaluation.authorization).every((value) => value === false), true);
  assert.equal(Object.isFrozen(evaluation), true);
  assert.equal(Object.isFrozen(evaluation.environmentResults), true);
  assert.equal(evaluation.environmentResults.every((entry) => entry.evidenceComplete), true);

  const reversed = clone(input);
  reversed.environments.reverse();
  assert.equal(
    inspectIdentityRecipientDeploymentCompatibility(reversed).contentDigest,
    evaluation.contentDigest,
    "environment ordering must not change the compatibility content digest"
  );
});

test("local labels and a single live environment cannot self-prove Candidate and production", () => {
  const local = compatibilityEnvelope();
  local.environments = [{
    ...local.environments[0],
    environmentKind: "LOCAL",
  }];
  const localEvaluation = expectBlocked(local, "LIVE_ENVIRONMENT_EVIDENCE_REQUIRED");
  assert.equal(localEvaluation.blockers.includes("CANDIDATE_EVIDENCE_REQUIRED"), true);
  assert.equal(localEvaluation.blockers.includes("PRODUCTION_EVIDENCE_REQUIRED"), true);

  const candidateOnly = compatibilityEnvelope();
  candidateOnly.environments = [candidateOnly.environments[0]];
  expectBlocked(candidateOnly, "PRODUCTION_EVIDENCE_REQUIRED");

  const productionOnly = compatibilityEnvelope();
  productionOnly.environments = [productionOnly.environments[1]];
  expectBlocked(productionOnly, "CANDIDATE_EVIDENCE_REQUIRED");
});

test("Candidate and production separately require identity, subscription, and sender drain attestations", () => {
  for (const environmentKind of REQUIRED_ENVIRONMENTS) {
    for (const [field, blockerSuffix] of [
      ["legacyIdentityWritersDrained", "LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
      ["legacySubscriptionWritersDrained", "LEGACY_SUBSCRIPTION_WRITERS_DRAIN_NOT_VERIFIED"],
      ["legacyNotificationSendersDrained", "LEGACY_NOTIFICATION_SENDERS_DRAIN_NOT_VERIFIED"],
    ]) {
      const input = compatibilityEnvelope();
      const environment = input.environments.find((entry) => (
        entry.environmentKind === environmentKind
      ));
      environment[field].status = "PENDING";
      expectBlocked(input, `${environmentKind}_${blockerSuffix}`);
    }
  }
});

test("rollback evidence separately requires all identity, uniqueness and binding lifecycle semantics", () => {
  const mutations = [
    ["targetMigrations", [TARGET_MIGRATIONS[0]], "ROLLBACK_TARGET_MIGRATION_RANGE_NOT_VERIFIED"],
    ["unionidTrustStatusUnderstood", false, "ROLLBACK_UNIONID_TRUST_STATUS_NOT_VERIFIED"],
    ["unionidProvenanceUnderstood", false, "ROLLBACK_UNIONID_PROVENANCE_NOT_VERIFIED"],
    ["sameRootAppUniquenessPreserved", false, "ROLLBACK_SAME_ROOT_APP_UNIQUENESS_NOT_VERIFIED"],
    ["recipientBindingStatusUnderstood", false, "ROLLBACK_RECIPIENT_BINDING_STATUS_NOT_VERIFIED"],
    ["recipientBindingFullLifecyclePreserved", false, "ROLLBACK_RECIPIENT_BINDING_FULL_LIFECYCLE_NOT_VERIFIED"],
    ["recipientBindingLifecyclePhases", ["GRANT"], "ROLLBACK_RECIPIENT_BINDING_FULL_LIFECYCLE_NOT_VERIFIED"],
    ["historicalUnverifiedReviewRequiredSemanticsPreserved", false, "ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalUnionidTrustStatus", "VERIFIED", "ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalUnionidStatus", "LINKED", "ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalRecipientBindingStatus", "VERIFIED", "ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalSubscriptionGrantStatus", "AVAILABLE", "ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["legacyLinkedRestoreForbidden", false, "ROLLBACK_LEGACY_LINKED_RESTORE_FORBIDDEN_NOT_VERIFIED"],
    ["unboundNotificationSendForbidden", false, "ROLLBACK_UNBOUND_SEND_FORBIDDEN_NOT_VERIFIED"],
    ["providerCallFenceStateMachineUnderstood", false, "ROLLBACK_PROVIDER_CALL_FENCE_NOT_VERIFIED"],
    ["startedProviderCallUnknownRecoveryPreserved", false, "ROLLBACK_STARTED_PROVIDER_CALL_UNKNOWN_RECOVERY_NOT_VERIFIED"],
    ["providerCallAutomaticResendForbidden", false, "ROLLBACK_PROVIDER_CALL_AUTOMATIC_RESEND_FORBIDDEN_NOT_VERIFIED"],
    ["historicalRequestedProviderCallReviewRequired", false, "ROLLBACK_HISTORICAL_REQUESTED_PROVIDER_CALL_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalRequestedProviderCallState", "AVAILABLE", "ROLLBACK_HISTORICAL_REQUESTED_PROVIDER_CALL_REVIEW_REQUIRED_NOT_VERIFIED"],
    ["historicalProviderCallGeneration", 1, "ROLLBACK_HISTORICAL_REQUESTED_PROVIDER_CALL_REVIEW_REQUIRED_NOT_VERIFIED"],
  ];

  for (const environmentKind of REQUIRED_ENVIRONMENTS) {
    for (const [field, value, blockerSuffix] of mutations) {
      const input = compatibilityEnvelope();
      const environment = input.environments.find((entry) => (
        entry.environmentKind === environmentKind
      ));
      environment.rollbackArtifact[field] = value;
      expectBlocked(input, `${environmentKind}_${blockerSuffix}`);
    }
  }
});

test("opaque evidence, signer, timestamp and content digests fail closed when synthetic or incoherent", () => {
  const mutations = [
    [(evidence) => { evidence.evidenceRef = "local-only"; }, "CANDIDATE_LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
    [(evidence) => { evidence.signerRef = "local-test-signer"; }, "CANDIDATE_LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
    [(evidence) => { evidence.signerRef = `actor:sha256:${"0".repeat(64)}`; }, "CANDIDATE_LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
    [(evidence) => { evidence.verifiedAt = "2026-07-18T10:00:00+08:00"; }, "CANDIDATE_LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
    [(evidence) => { evidence.contentDigest = sha256("different-content"); }, "CANDIDATE_LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"],
  ];
  for (const [mutate, blocker] of mutations) {
    const input = compatibilityEnvelope();
    mutate(input.environments[0].legacyIdentityWritersDrained);
    expectBlocked(input, blocker);
  }

  const badArtifact = compatibilityEnvelope();
  badArtifact.environments[1].rollbackArtifact.artifactRef = "artifact-local-path";
  expectBlocked(badArtifact, "PRODUCTION_ROLLBACK_ARTIFACT_EVIDENCE_NOT_VERIFIED");

  const zeroArtifactDigest = compatibilityEnvelope();
  zeroArtifactDigest.environments[1].rollbackArtifact.artifactDigest = "0".repeat(64);
  zeroArtifactDigest.environments[1].rollbackArtifact.artifactRef = `artifact:sha256:${"0".repeat(64)}`;
  expectBlocked(zeroArtifactDigest, "PRODUCTION_ROLLBACK_ARTIFACT_EVIDENCE_NOT_VERIFIED");
});

test("Candidate and production environment and evidence references must remain distinct", () => {
  const sameEnvironment = compatibilityEnvelope();
  sameEnvironment.environments[1].environmentRef = sameEnvironment.environments[0].environmentRef;
  sameEnvironment.environments[1].legacyIdentityWritersDrained.environmentRef = sameEnvironment.environments[0].environmentRef;
  sameEnvironment.environments[1].legacySubscriptionWritersDrained.environmentRef = sameEnvironment.environments[0].environmentRef;
  sameEnvironment.environments[1].legacyNotificationSendersDrained.environmentRef = sameEnvironment.environments[0].environmentRef;
  sameEnvironment.environments[1].rollbackArtifact.environmentRef = sameEnvironment.environments[0].environmentRef;
  expectBlocked(
    sameEnvironment,
    "CANDIDATE_PRODUCTION_ENVIRONMENTS_MUST_BE_DISTINCT"
  );

  const reusedEvidence = compatibilityEnvelope();
  const reused = clone(reusedEvidence.environments[0].legacyIdentityWritersDrained);
  reused.releaseRef = RELEASE_REF;
  reused.environmentRef = reusedEvidence.environments[1].environmentRef;
  reused.assertion = "LEGACY_SUBSCRIPTION_WRITERS_DRAINED";
  reusedEvidence.environments[1].legacySubscriptionWritersDrained = reused;
  expectBlocked(
    reusedEvidence,
    "CANDIDATE_PRODUCTION_EVIDENCE_REFERENCES_MUST_BE_DISTINCT"
  );
});

test("migration range and every envelope shape are exact and reject silent compatibility expansion", () => {
  const missingMigration = compatibilityEnvelope();
  missingMigration.targetMigrations.pop();
  expectBlocked(missingMigration, "TARGET_MIGRATION_RANGE_NOT_VERIFIED");

  const rollbackRangeDrift = compatibilityEnvelope();
  rollbackRangeDrift.environments[0].rollbackArtifact.targetMigrations.pop();
  expectBlocked(
    rollbackRangeDrift,
    "CANDIDATE_ROLLBACK_TARGET_MIGRATION_RANGE_NOT_VERIFIED"
  );

  const extraEnvelopeField = compatibilityEnvelope();
  extraEnvelopeField.localOverride = true;
  expectBlocked(extraEnvelopeField, "COMPATIBILITY_ENVELOPE_INVALID");

  const extraEnvironmentField = compatibilityEnvelope();
  extraEnvironmentField.environments[0].legacyFallbackAllowed = true;
  expectBlocked(extraEnvironmentField, "CANDIDATE_EVIDENCE_INVALID");

  const extraRollbackField = compatibilityEnvelope();
  extraRollbackField.environments[1].rollbackArtifact.allowUnboundSend = false;
  expectBlocked(
    extraRollbackField,
    "PRODUCTION_ROLLBACK_ARTIFACT_EVIDENCE_NOT_VERIFIED"
  );
});
