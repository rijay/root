const CONTRACT_VERSION = "TASK_EVENT_IDEMPOTENCY_DEPLOYMENT_COMPATIBILITY:v1";
const TARGET_MIGRATION = "048_task_event_idempotency_scope_enforce.sql";
const LIVE_ENVIRONMENTS = new Set(["candidate", "production"]);

function text(value, maximumLength = 256) {
  return typeof value === "string" && value.trim() && value.length <= maximumLength
    ? value.trim()
    : "";
}

function verifiedEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.status === "VERIFIED"
    && Boolean(text(value.evidenceRef, 512))
    && Boolean(text(value.signerRef, 160))
    && Number.isFinite(Date.parse(value.verifiedAt || ""));
}

function verifiedRollbackArtifact(value) {
  return verifiedEvidence(value)
    && /^[a-f0-9]{64}$/.test(String(value.artifactDigest || ""))
    && value.scopedLookupIncluded === true
    && value.stagedColumnsWriteCompatible === true;
}

// This Module deliberately cannot infer live deployment state from local code.
// Its Interface accepts only explicit Candidate/production evidence and keeps
// migration 048 a hard blocker until both mixed-version risks are closed.
function inspectTaskEventIdempotencyDeploymentCompatibility(input = {}) {
  const environment = text(input.environment, 32).toLowerCase();
  const blockers = [];
  if (!LIVE_ENVIRONMENTS.has(environment)) blockers.push("LIVE_ENVIRONMENT_EVIDENCE_REQUIRED");
  if (!verifiedEvidence(input.legacyInstancesDrained)) {
    blockers.push("LEGACY_INSTANCES_DRAIN_NOT_VERIFIED");
  }
  if (!verifiedRollbackArtifact(input.rollbackArtifact)) {
    blockers.push("ROLLBACK_ARTIFACT_NOT_VERIFIED");
  }
  const ready = blockers.length === 0;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    targetMigration: TARGET_MIGRATION,
    environment: environment || "unknown",
    ready,
    hardBlocker: !ready,
    status: ready
      ? "TASK_EVENT_IDEMPOTENCY_DEPLOYMENT_COMPATIBILITY_VERIFIED"
      : "TASK_EVENT_IDEMPOTENCY_DEPLOYMENT_COMPATIBILITY_HARD_BLOCKER",
    blockers: Object.freeze(blockers),
  });
}

module.exports = {
  CONTRACT_VERSION,
  TARGET_MIGRATION,
  inspectTaskEventIdempotencyDeploymentCompatibility,
};
