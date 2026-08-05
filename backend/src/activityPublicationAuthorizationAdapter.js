const crypto = require("node:crypto");

const EVIDENCE_FIELDS = Object.freeze([
  "controlledApprovalRef",
  "contentAuthorizationDigest",
  "uedAcceptanceDigest",
  "photographyAuthorizationDigest",
  "artifactProvenanceDigest",
]);

function text(value) {
  return String(value || "").trim();
}

function configuredApprovals(env = process.env) {
  const raw = text(env.ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON must be a JSON array");
  }
  return parsed.map((approval, index) => {
    const normalized = {
      activityVersionId: text(approval && (approval.activityVersionId || approval.activity_version_id)),
      activityId: text(approval && (approval.activityId || approval.activity_id)),
      principalOperatorId: text(approval && (approval.principalOperatorId || approval.principal_operator_id)),
      publishOwnerSignerRef: text(approval && (approval.publishOwnerSignerRef || approval.publish_owner_signer_ref)),
    };
    EVIDENCE_FIELDS.forEach((field) => {
      normalized[field] = text(approval && approval[field]).toLowerCase();
    });
    const required = [
      normalized.activityVersionId,
      normalized.activityId,
      normalized.principalOperatorId,
      normalized.publishOwnerSignerRef,
      ...EVIDENCE_FIELDS.map((field) => normalized[field]),
    ];
    if (required.some((value) => !value)) {
      throw new Error(`ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON[${index}] is incomplete`);
    }
    if (normalized.publishOwnerSignerRef !== normalized.principalOperatorId) {
      throw new Error(`ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON[${index}] signer must match principal`);
    }
    return Object.freeze(normalized);
  });
}

function exactApproval(approval, request) {
  return approval.activityVersionId === text(request.activity && request.activity.activityVersionId)
    && approval.activityId === text(request.activity && request.activity.activityId)
    && approval.principalOperatorId === text(request.principal && request.principal.operatorId)
    && EVIDENCE_FIELDS.every((field) => approval[field] === text(request.evidence && request.evidence[field]).toLowerCase());
}

function decisionRef(approval) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(approval)).digest("hex").slice(0, 32);
  return `ACTIVITY_PUBLICATION_APPROVAL_${digest}`;
}

function createEnvironmentActivityPublicationAuthorizationAdapter(env = process.env, options = {}) {
  const approvals = configuredApprovals(env);
  const now = typeof options.now === "function"
    ? options.now
    : () => new Date(Date.now() - 1_000).toISOString();
  return Object.freeze({
    authorizeActivityPublication(request = {}) {
      if (request.operation !== "ACTIVITY_PUBLISH"
        || !request.principal
        || request.principal.tokenConfigured !== true) {
        return Object.freeze({ authorized: false });
      }
      const approval = approvals.find((item) => exactApproval(item, request));
      if (!approval) return Object.freeze({ authorized: false });
      return Object.freeze({
        authorized: true,
        adapterId: "ROOT_ACTIVITY_APPROVAL_LEDGER_V1",
        decisionRef: decisionRef(approval),
        publishOwnerSignerRef: approval.publishOwnerSignerRef,
        verifiedAt: now(),
        evidence: request.evidence,
        principalOperatorId: request.principal.operatorId,
        activityVersionId: request.activity.activityVersionId,
        activityId: request.activity.activityId,
        requestId: request.requestId,
      });
    },
  });
}

module.exports = {
  EVIDENCE_FIELDS,
  configuredApprovals,
  createEnvironmentActivityPublicationAuthorizationAdapter,
};
