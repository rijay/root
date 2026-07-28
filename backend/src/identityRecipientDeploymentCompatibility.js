const crypto = require("node:crypto");

const CONTRACT_VERSION = "IDENTITY_RECIPIENT_PROVIDER_CALL_DEPLOYMENT_COMPATIBILITY:v2";
const TARGET_MIGRATIONS = Object.freeze([
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
const REQUIRED_ENVIRONMENTS = Object.freeze(["CANDIDATE", "PRODUCTION"]);
const RECIPIENT_BINDING_LIFECYCLE_PHASES = Object.freeze([
  "DECISION",
  "GRANT",
  "SCHEDULE",
  "SEND_ATTEMPT",
  "TERMINAL_READBACK",
]);
const EVIDENCE_CLASS = "STRUCTURE_ONLY_UNTRUSTED_INPUT";
const AUTHORIZATION = Object.freeze({
  candidateDeploymentAuthorized: false,
  productionDeploymentAuthorized: false,
  rollbackAuthorized: false,
  legacyWriterMutationAuthorized: false,
  notificationSendAuthorized: false,
  gateClosureAuthorized: false,
});

const INPUT_FIELDS = Object.freeze([
  "contractVersion",
  "releaseRef",
  "targetMigrations",
  "environments",
]);
const ENVIRONMENT_FIELDS = Object.freeze([
  "environmentKind",
  "environmentRef",
  "releaseRef",
  "legacyIdentityWritersDrained",
  "legacySubscriptionWritersDrained",
  "legacyNotificationSendersDrained",
  "rollbackArtifact",
]);
const VERIFIED_EVIDENCE_FIELDS = Object.freeze([
  "status",
  "assertion",
  "releaseRef",
  "environmentRef",
  "evidenceRef",
  "signerRef",
  "verifiedAt",
  "contentDigest",
]);
const ROLLBACK_ARTIFACT_FIELDS = Object.freeze([
  ...VERIFIED_EVIDENCE_FIELDS,
  "artifactRef",
  "artifactDigest",
  "targetMigrations",
  "unionidTrustStatusUnderstood",
  "unionidProvenanceUnderstood",
  "sameRootAppUniquenessPreserved",
  "recipientBindingStatusUnderstood",
  "recipientBindingFullLifecyclePreserved",
  "recipientBindingLifecyclePhases",
  "historicalUnverifiedReviewRequiredSemanticsPreserved",
  "historicalUnionidTrustStatus",
  "historicalUnionidStatus",
  "historicalRecipientBindingStatus",
  "historicalSubscriptionGrantStatus",
  "legacyLinkedRestoreForbidden",
  "unboundNotificationSendForbidden",
  "providerCallFenceStateMachineUnderstood",
  "startedProviderCallUnknownRecoveryPreserved",
  "providerCallAutomaticResendForbidden",
  "historicalRequestedProviderCallReviewRequired",
  "historicalRequestedProviderCallState",
  "historicalProviderCallGeneration",
]);

const SHA256_PATTERN = /^(?!([a-f0-9])\1{63}$)[a-f0-9]{64}$/;
const OPAQUE_REFERENCE_PATTERNS = Object.freeze({
  release: /^release:sha256:[a-f0-9]{64}$/,
  environment: /^environment:sha256:[a-f0-9]{64}$/,
  evidence: /^evidence:sha256:[a-f0-9]{64}$/,
  actor: /^actor:sha256:[a-f0-9]{64}$/,
  artifact: /^artifact:sha256:[a-f0-9]{64}$/,
});

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

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function canonicalTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function digest(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function opaqueReference(value, kind) {
  return typeof value === "string"
    && OPAQUE_REFERENCE_PATTERNS[kind].test(value)
    && digest(value.slice(-64));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compatibilityDigest(value) {
  return crypto.createHash("sha256")
    .update("myroot-identity-recipient-provider-call-deployment-compatibility:v2\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function verifiedEvidence(value, expectedAssertion, environment) {
  if (!exactKeys(value, VERIFIED_EVIDENCE_FIELDS)) return false;
  return value.status === "VERIFIED"
    && value.assertion === expectedAssertion
    && value.releaseRef === environment.releaseRef
    && value.environmentRef === environment.environmentRef
    && opaqueReference(value.releaseRef, "release")
    && opaqueReference(value.environmentRef, "environment")
    && opaqueReference(value.evidenceRef, "evidence")
    && opaqueReference(value.signerRef, "actor")
    && canonicalTimestamp(value.verifiedAt)
    && digest(value.contentDigest)
    && value.evidenceRef === `evidence:sha256:${value.contentDigest}`;
}

function rollbackEvidenceVerified(value, environment) {
  if (!exactKeys(value, ROLLBACK_ARTIFACT_FIELDS)) return false;
  const commonEvidence = Object.fromEntries(
    VERIFIED_EVIDENCE_FIELDS.map((field) => [field, value[field]])
  );
  return verifiedEvidence(commonEvidence, "ROLLBACK_COMPATIBLE", environment)
    && opaqueReference(value.artifactRef, "artifact")
    && digest(value.artifactDigest)
    && value.artifactRef === `artifact:sha256:${value.artifactDigest}`;
}

function addBlocker(blockers, code) {
  if (!blockers.includes(code)) blockers.push(code);
}

function environmentBlocker(environmentKind, suffix) {
  return `${environmentKind}_${suffix}`;
}

function validateRollbackSemantics(value, environmentKind, blockers) {
  const prefix = (suffix) => environmentBlocker(environmentKind, suffix);
  if (!exactArray(value.targetMigrations, TARGET_MIGRATIONS)) {
    addBlocker(blockers, prefix("ROLLBACK_TARGET_MIGRATION_RANGE_NOT_VERIFIED"));
  }
  if (value.unionidTrustStatusUnderstood !== true) {
    addBlocker(blockers, prefix("ROLLBACK_UNIONID_TRUST_STATUS_NOT_VERIFIED"));
  }
  if (value.unionidProvenanceUnderstood !== true) {
    addBlocker(blockers, prefix("ROLLBACK_UNIONID_PROVENANCE_NOT_VERIFIED"));
  }
  if (value.sameRootAppUniquenessPreserved !== true) {
    addBlocker(blockers, prefix("ROLLBACK_SAME_ROOT_APP_UNIQUENESS_NOT_VERIFIED"));
  }
  if (value.recipientBindingStatusUnderstood !== true) {
    addBlocker(blockers, prefix("ROLLBACK_RECIPIENT_BINDING_STATUS_NOT_VERIFIED"));
  }
  if (value.recipientBindingFullLifecyclePreserved !== true
    || !exactArray(value.recipientBindingLifecyclePhases, RECIPIENT_BINDING_LIFECYCLE_PHASES)) {
    addBlocker(blockers, prefix("ROLLBACK_RECIPIENT_BINDING_FULL_LIFECYCLE_NOT_VERIFIED"));
  }
  if (value.historicalUnverifiedReviewRequiredSemanticsPreserved !== true
    || value.historicalUnionidTrustStatus !== "UNVERIFIED"
    || value.historicalUnionidStatus !== "PENDING"
    || value.historicalRecipientBindingStatus !== "UNVERIFIED"
    || value.historicalSubscriptionGrantStatus !== "REVIEW_REQUIRED") {
    addBlocker(blockers, prefix("ROLLBACK_HISTORICAL_UNVERIFIED_REVIEW_REQUIRED_NOT_VERIFIED"));
  }
  if (value.legacyLinkedRestoreForbidden !== true) {
    addBlocker(blockers, prefix("ROLLBACK_LEGACY_LINKED_RESTORE_FORBIDDEN_NOT_VERIFIED"));
  }
  if (value.unboundNotificationSendForbidden !== true) {
    addBlocker(blockers, prefix("ROLLBACK_UNBOUND_SEND_FORBIDDEN_NOT_VERIFIED"));
  }
  if (value.providerCallFenceStateMachineUnderstood !== true) {
    addBlocker(blockers, prefix("ROLLBACK_PROVIDER_CALL_FENCE_NOT_VERIFIED"));
  }
  if (value.startedProviderCallUnknownRecoveryPreserved !== true) {
    addBlocker(blockers, prefix("ROLLBACK_STARTED_PROVIDER_CALL_UNKNOWN_RECOVERY_NOT_VERIFIED"));
  }
  if (value.providerCallAutomaticResendForbidden !== true) {
    addBlocker(blockers, prefix("ROLLBACK_PROVIDER_CALL_AUTOMATIC_RESEND_FORBIDDEN_NOT_VERIFIED"));
  }
  if (value.historicalRequestedProviderCallReviewRequired !== true
    || value.historicalRequestedProviderCallState !== "REVIEW_REQUIRED"
    || value.historicalProviderCallGeneration !== 0) {
    addBlocker(
      blockers,
      prefix("ROLLBACK_HISTORICAL_REQUESTED_PROVIDER_CALL_REVIEW_REQUIRED_NOT_VERIFIED")
    );
  }
}

function validateEnvironment(environment, expectedKind, expectedReleaseRef) {
  const blockers = [];
  const prefix = (suffix) => environmentBlocker(expectedKind, suffix);
  if (!exactKeys(environment, ENVIRONMENT_FIELDS)) {
    addBlocker(blockers, prefix("EVIDENCE_INVALID"));
    return Object.freeze({ environmentKind: expectedKind, evidenceComplete: false, blockers });
  }
  if (environment.environmentKind !== expectedKind
    || environment.releaseRef !== expectedReleaseRef
    || !opaqueReference(environment.releaseRef, "release")
    || !opaqueReference(environment.environmentRef, "environment")) {
    addBlocker(blockers, prefix("ENVIRONMENT_BINDING_NOT_VERIFIED"));
  }
  if (!verifiedEvidence(
    environment.legacyIdentityWritersDrained,
    "LEGACY_IDENTITY_WRITERS_DRAINED",
    environment
  )) {
    addBlocker(blockers, prefix("LEGACY_IDENTITY_WRITERS_DRAIN_NOT_VERIFIED"));
  }
  if (!verifiedEvidence(
    environment.legacySubscriptionWritersDrained,
    "LEGACY_SUBSCRIPTION_WRITERS_DRAINED",
    environment
  )) {
    addBlocker(blockers, prefix("LEGACY_SUBSCRIPTION_WRITERS_DRAIN_NOT_VERIFIED"));
  }
  if (!verifiedEvidence(
    environment.legacyNotificationSendersDrained,
    "LEGACY_NOTIFICATION_SENDERS_DRAINED",
    environment
  )) {
    addBlocker(blockers, prefix("LEGACY_NOTIFICATION_SENDERS_DRAIN_NOT_VERIFIED"));
  }
  if (!rollbackEvidenceVerified(environment.rollbackArtifact, environment)) {
    addBlocker(blockers, prefix("ROLLBACK_ARTIFACT_EVIDENCE_NOT_VERIFIED"));
  } else {
    validateRollbackSemantics(environment.rollbackArtifact, expectedKind, blockers);
  }
  return Object.freeze({
    environmentKind: expectedKind,
    evidenceComplete: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

// This Module is deliberately non-runtime. It can prove that an envelope has
// the exact content-addressed shape needed for controlled review, but local
// callers cannot authenticate the referenced Candidate/production records or
// authorize a deployment, rollback, legacy writer, or notification send.
function inspectIdentityRecipientDeploymentCompatibility(input = {}) {
  const blockers = [];
  const environmentResults = [];

  if (!exactKeys(input, INPUT_FIELDS)) {
    addBlocker(blockers, "COMPATIBILITY_ENVELOPE_INVALID");
  } else {
    if (input.contractVersion !== CONTRACT_VERSION) {
      addBlocker(blockers, "CONTRACT_VERSION_NOT_VERIFIED");
    }
    if (!opaqueReference(input.releaseRef, "release")) {
      addBlocker(blockers, "RELEASE_BINDING_NOT_VERIFIED");
    }
    if (!exactArray(input.targetMigrations, TARGET_MIGRATIONS)) {
      addBlocker(blockers, "TARGET_MIGRATION_RANGE_NOT_VERIFIED");
    }
    if (!Array.isArray(input.environments)) {
      addBlocker(blockers, "LIVE_ENVIRONMENT_EVIDENCE_REQUIRED");
    } else {
      const byKind = new Map();
      for (const environment of input.environments) {
        const kind = plainRecord(environment) ? environment.environmentKind : "";
        if (!REQUIRED_ENVIRONMENTS.includes(kind)) {
          addBlocker(blockers, "LIVE_ENVIRONMENT_EVIDENCE_REQUIRED");
          continue;
        }
        if (byKind.has(kind)) {
          addBlocker(blockers, `${kind}_EVIDENCE_MUST_BE_UNIQUE`);
          continue;
        }
        byKind.set(kind, environment);
      }

      for (const kind of REQUIRED_ENVIRONMENTS) {
        const environment = byKind.get(kind);
        if (!environment) {
          addBlocker(blockers, `${kind}_EVIDENCE_REQUIRED`);
          continue;
        }
        const result = validateEnvironment(environment, kind, input.releaseRef);
        environmentResults.push(result);
        result.blockers.forEach((blocker) => addBlocker(blockers, blocker));
      }

      const candidate = byKind.get("CANDIDATE");
      const production = byKind.get("PRODUCTION");
      if (exactKeys(candidate, ENVIRONMENT_FIELDS)
        && exactKeys(production, ENVIRONMENT_FIELDS)) {
        if (candidate.environmentRef === production.environmentRef) {
          addBlocker(blockers, "CANDIDATE_PRODUCTION_ENVIRONMENTS_MUST_BE_DISTINCT");
        }
        const evidenceRefs = [
          candidate.legacyIdentityWritersDrained,
          candidate.legacySubscriptionWritersDrained,
          candidate.legacyNotificationSendersDrained,
          candidate.rollbackArtifact,
          production.legacyIdentityWritersDrained,
          production.legacySubscriptionWritersDrained,
          production.legacyNotificationSendersDrained,
          production.rollbackArtifact,
        ].map((evidence) => plainRecord(evidence) ? evidence.evidenceRef : null)
          .filter((value) => opaqueReference(value, "evidence"));
        if (new Set(evidenceRefs).size !== evidenceRefs.length) {
          addBlocker(blockers, "CANDIDATE_PRODUCTION_EVIDENCE_REFERENCES_MUST_BE_DISTINCT");
        }
      }
    }
  }

  const evidenceComplete = blockers.length === 0;
  const normalizedEnvelope = evidenceComplete
    ? {
      contractVersion: input.contractVersion,
      releaseRef: input.releaseRef,
      targetMigrations: [...input.targetMigrations],
      environments: [...input.environments].sort((left, right) => (
        REQUIRED_ENVIRONMENTS.indexOf(left.environmentKind)
          - REQUIRED_ENVIRONMENTS.indexOf(right.environmentKind)
      )),
    }
    : null;
  const outputBlockers = evidenceComplete
    ? ["CONTROLLED_CANDIDATE_PRODUCTION_EVIDENCE_VERIFICATION_REQUIRED"]
    : blockers;

  return deepFreeze({
    contractVersion: CONTRACT_VERSION,
    targetMigrations: [...TARGET_MIGRATIONS],
    requiredEnvironments: [...REQUIRED_ENVIRONMENTS],
    evidenceClass: EVIDENCE_CLASS,
    evidenceComplete,
    externalVerificationRequired: true,
    contentDigest: normalizedEnvelope ? compatibilityDigest(normalizedEnvelope) : null,
    ready: false,
    hardBlocker: true,
    status: evidenceComplete
      ? "IDENTITY_RECIPIENT_DEPLOYMENT_COMPATIBILITY_EXTERNAL_VERIFICATION_HARD_BLOCKER"
      : "IDENTITY_RECIPIENT_DEPLOYMENT_COMPATIBILITY_HARD_BLOCKER",
    environmentResults,
    blockers: outputBlockers,
    authorization: AUTHORIZATION,
  });
}

module.exports = {
  AUTHORIZATION,
  CONTRACT_VERSION,
  EVIDENCE_CLASS,
  RECIPIENT_BINDING_LIFECYCLE_PHASES,
  REQUIRED_ENVIRONMENTS,
  TARGET_MIGRATIONS,
  inspectIdentityRecipientDeploymentCompatibility,
};
