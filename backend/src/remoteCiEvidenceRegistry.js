const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// This Module validates a read-only evidence Interface. The Implementation
// verifies downloaded artifact bytes supplied by the caller, but never calls a
// remote provider and never grants workflow, protection, deployment, Gate, or
// formal-launch authority.

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "remote-ci-evidence",
  "v1.0.0.json"
);
const CONTRACT_STATUS = "NON_RUNTIME_REMOTE_CI_EVIDENCE_STRUCTURE_AND_BYTES_VALIDATION";
const VALIDATION_LEVEL =
  "STRUCTURE_AND_DOWNLOADED_ARTIFACT_BYTES_UNTRUSTED_REMOTE_READBACK";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const EXPECTED_APP_REF =
  "app:sha256:e67ea24b2a6c1075f14393573a7043b7dffc4d12c37340053fd0639c2e6310ae";
const SHA_ROLES = Object.freeze(["PR_HEAD", "TESTED_MERGE", "BASE", "POST_MERGE_MAIN"]);
const RUN_ROLES = Object.freeze([
  Object.freeze({
    runRole: "PULL_REQUEST_VERIFICATION",
    eventName: "pull_request",
    testedShaRole: "TESTED_MERGE",
  }),
  Object.freeze({
    runRole: "POST_MERGE_MAIN_VERIFICATION",
    eventName: "push",
    testedShaRole: "POST_MERGE_MAIN",
  }),
]);
const REQUIRED_CHECKS = Object.freeze([
  Object.freeze({
    jobId: "candidate-provenance",
    expectedName: "Source provenance only",
    artifactClass: "SOURCE_PROVENANCE_ONLY",
    artifactRequired: true,
    zeroSkipRequired: true,
  }),
  Object.freeze({
    jobId: "verify",
    expectedName: "Full verification",
    artifactClass: "VERIFICATION_LOG",
    artifactRequired: false,
    zeroSkipRequired: true,
  }),
  Object.freeze({
    jobId: "cloudfunctions-node18",
    expectedName: "Cloud Functions Node.js 18 compatibility",
    artifactClass: "CHECK_RUN_RESULT",
    artifactRequired: false,
    zeroSkipRequired: true,
  }),
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  remoteReadAuthorized: false,
  workflowExecutionAuthorized: false,
  protectionMutationAuthorized: false,
  artifactAttestationAuthorized: false,
  gateClosureAuthorized: false,
  deploymentAuthorized: false,
  formalLaunchAuthorized: false,
});

const DOCUMENT_FIELDS = Object.freeze([
  "recordType",
  "formatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "repository",
  "targetRef",
  "workflowPath",
  "workflowName",
  "workflowBlobSha256",
  "shaBinding",
  "runs",
  "protectionReadback",
  "collectedAt",
  "validUntil",
  "revocationSnapshotDigest",
]);
const SHA_BINDING_FIELDS = Object.freeze([
  "prHeadSha",
  "testedMergeSha",
  "baseSha",
  "postMergeMainSha",
]);
const RUN_FIELDS = Object.freeze([
  "runRole",
  "workflowRunId",
  "runAttempt",
  "eventName",
  "workflowPath",
  "workflowName",
  "workflowBlobSha256",
  "testedShaRole",
  "testedSha",
  "prHeadSha",
  "baseSha",
  "status",
  "conclusion",
  "startedAt",
  "completedAt",
  "jobs",
  "artifacts",
]);
const JOB_FIELDS = Object.freeze([
  "jobId",
  "jobRunId",
  "checkRunId",
  "checkName",
  "checkAppIdentityRef",
  "workflowRunId",
  "runAttempt",
  "headSha",
  "status",
  "conclusion",
  "skippedCount",
  "startedAt",
  "completedAt",
]);
const ARTIFACT_FIELDS = Object.freeze([
  "artifactRef",
  "artifactId",
  "artifactClass",
  "name",
  "workflowRunId",
  "runAttempt",
  "headSha",
  "sizeBytes",
  "providerDigest",
  "downloadedSha256",
  "uploadedAt",
  "expiresAt",
]);
const PROTECTION_FIELDS = Object.freeze([
  "mode",
  "targetRef",
  "active",
  "strictHeadShaBinding",
  "pullRequestRequired",
  "administratorBypassAllowed",
  "forcePushAllowed",
  "branchDeletionAllowed",
  "postMergeMainRunRequired",
  "requiredChecks",
  "observedAt",
  "ruleChangeAuditRef",
  "readbackDigest",
]);
const PROTECTION_CHECK_FIELDS = Object.freeze([
  "expectedName",
  "checkAppIdentityRef",
]);
const CONTEXT_FIELDS = Object.freeze([
  "evaluatedAt",
  "revocationSnapshotDigest",
  "artifactBytesByRef",
]);
const ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion",
  "contractStatus",
  "sealStatus",
  "evaluatedAt",
  "documentDigest",
  "resultDigest",
  "document",
  "result",
  "authorization",
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const ID_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/;
const ARTIFACT_REF_PATTERN = /^artifact:sha256:[a-f0-9]{64}$/;
const AUDIT_REF_PATTERN = /^audit:sha256:[a-f0-9]{64}$/;
const APP_REF_PATTERN = /^app:sha256:[a-f0-9]{64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function registryError(code = "REMOTE_CI_EVIDENCE_INVALID") {
  const error = new Error("Remote CI Evidence Registry rejected the input");
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, fields) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw registryError("REMOTE_CI_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw registryError("REMOTE_CI_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw registryError("REMOTE_CI_EVIDENCE_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) {
      throw registryError("REMOTE_CI_EVIDENCE_CANONICALIZATION_REJECTED");
    }
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

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timestamp(value) {
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds : null;
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

function validateManifest(manifest) {
  const canonical = {
    schemaVersion: 1,
    contractVersion: "1.0.0",
    productVersion: "v1.0.0",
    scope: CONTRACT_STATUS,
    validationLevel: VALIDATION_LEVEL,
    digestAlgorithm: "SHA-256",
    canonicalization: {
      version: CANONICALIZATION_VERSION,
      unicodeNormalization: "NFC_REQUIRED",
      objectKeyOrdering: "UTF16_CODE_UNIT_ASCENDING",
      numberEncoding: "SAFE_INTEGER_JSON",
      arrayOrdering: "SCHEMA_DEFINED_DETERMINISTIC",
      undefinedPolicy: "REJECT",
      digestDomainSeparation: "REMOTE_CI_EVIDENCE_V1",
    },
    repositoryPolicy: {
      repository: "rijay/root",
      targetRef: "refs/heads/main",
      workflowPath: ".github/workflows/ci.yml",
      workflowName: "CI Gate",
      provider: "GITHUB_ACTIONS",
      expectedCheckAppIdentityRef: EXPECTED_APP_REF,
    },
    shaRoles: [...SHA_ROLES],
    runPolicies: RUN_ROLES.map((entry) => ({ ...entry })),
    requiredChecks: REQUIRED_CHECKS.map((entry) => ({ ...entry })),
    evidencePolicy: {
      maximumAgeSeconds: 604800,
      maximumFutureSkewSeconds: 300,
      maximumValiditySeconds: 604800,
      requiredProtectionMode: "RULESET_OR_BRANCH_PROTECTION",
      exactRequiredCheckSet: true,
      strictHeadShaBinding: true,
      pullRequestRequired: true,
      administratorBypassAllowed: false,
      forcePushAllowed: false,
      branchDeletionAllowed: false,
      postMergeMainRunRequired: true,
      downloadedArtifactBytesRequired: true,
    },
    authorization: { ...AUTHORIZATION },
  };
  if (canonicalJson(manifest) !== canonicalJson(canonical)) {
    throw registryError("REMOTE_CI_EVIDENCE_CONTRACT_DRIFT");
  }
  return deepFreeze(clone(manifest));
}

function shaBindings(document) {
  if (!exactKeys(document.shaBinding, SHA_BINDING_FIELDS)) {
    throw registryError("REMOTE_CI_EVIDENCE_SHA_BINDING_INVALID");
  }
  const values = Object.values(document.shaBinding);
  if (!values.every((value) => COMMIT_PATTERN.test(value))
    || document.shaBinding.prHeadSha === document.shaBinding.baseSha
    || document.shaBinding.testedMergeSha === document.shaBinding.prHeadSha
    || document.shaBinding.testedMergeSha === document.shaBinding.baseSha
    || document.shaBinding.postMergeMainSha === document.shaBinding.prHeadSha
    || document.shaBinding.postMergeMainSha === document.shaBinding.baseSha) {
    throw registryError("REMOTE_CI_EVIDENCE_SHA_BINDING_INVALID");
  }
  return document.shaBinding;
}

function artifactBytes(context, artifactRef) {
  const source = context.artifactBytesByRef;
  const bytes = source instanceof Map ? source.get(artifactRef) : source[artifactRef];
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw registryError("REMOTE_CI_EVIDENCE_ARTIFACT_BYTES_MISSING");
  }
  return Buffer.from(bytes);
}

function validateArtifact(artifact, run, context, seenIds, seenRefs, evaluatedAt) {
  if (!exactKeys(artifact, ARTIFACT_FIELDS)
    || !ARTIFACT_REF_PATTERN.test(artifact.artifactRef)
    || !ID_PATTERN.test(artifact.artifactId)
    || artifact.artifactClass !== "SOURCE_PROVENANCE_ONLY"
    || artifact.name !== `candidate-provenance-${run.testedSha}`
    || artifact.workflowRunId !== run.workflowRunId
    || artifact.runAttempt !== run.runAttempt
    || artifact.headSha !== run.testedSha
    || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1
    || !SHA256_PATTERN.test(artifact.providerDigest)
    || !SHA256_PATTERN.test(artifact.downloadedSha256)
    || timestamp(artifact.uploadedAt) === null
    || timestamp(artifact.expiresAt) === null
    || timestamp(artifact.uploadedAt) < timestamp(run.startedAt)
    || timestamp(artifact.uploadedAt) > timestamp(run.completedAt)
    || timestamp(artifact.expiresAt) <= evaluatedAt
    || seenIds.has(artifact.artifactId) || seenRefs.has(artifact.artifactRef)) {
    throw registryError("REMOTE_CI_EVIDENCE_ARTIFACT_INVALID");
  }
  const bytes = artifactBytes(context, artifact.artifactRef);
  const actualDigest = sha256Bytes(bytes);
  if (bytes.length !== artifact.sizeBytes
    || actualDigest !== artifact.providerDigest
    || actualDigest !== artifact.downloadedSha256) {
    throw registryError("REMOTE_CI_EVIDENCE_ARTIFACT_BYTES_MISMATCH");
  }
  seenIds.add(artifact.artifactId);
  seenRefs.add(artifact.artifactRef);
}

function validateRun(run, policy, document, bindings, context, globalState, evaluatedAt) {
  if (!exactKeys(run, RUN_FIELDS)
    || run.runRole !== policy.runRole
    || !ID_PATTERN.test(run.workflowRunId)
    || !Number.isSafeInteger(run.runAttempt) || run.runAttempt < 1
    || run.eventName !== policy.eventName
    || run.workflowPath !== document.workflowPath
    || run.workflowName !== document.workflowName
    || run.workflowBlobSha256 !== document.workflowBlobSha256
    || run.testedShaRole !== policy.testedShaRole
    || run.testedSha !== (policy.testedShaRole === "TESTED_MERGE"
      ? bindings.testedMergeSha : bindings.postMergeMainSha)
    || run.status !== "COMPLETED" || run.conclusion !== "SUCCESS"
    || timestamp(run.startedAt) === null || timestamp(run.completedAt) === null
    || timestamp(run.startedAt) > timestamp(run.completedAt)
    || timestamp(run.completedAt) > evaluatedAt + 300000
    || evaluatedAt - timestamp(run.completedAt) > 604800000
    || globalState.runIds.has(run.workflowRunId)) {
    throw registryError("REMOTE_CI_EVIDENCE_RUN_INVALID");
  }
  if (policy.runRole === "PULL_REQUEST_VERIFICATION") {
    if (run.prHeadSha !== bindings.prHeadSha || run.baseSha !== bindings.baseSha) {
      throw registryError("REMOTE_CI_EVIDENCE_RUN_SHA_MISMATCH");
    }
  } else if (run.prHeadSha !== null || run.baseSha !== null) {
    throw registryError("REMOTE_CI_EVIDENCE_RUN_SHA_MISMATCH");
  }
  globalState.runIds.add(run.workflowRunId);

  if (!Array.isArray(run.jobs) || run.jobs.length !== REQUIRED_CHECKS.length) {
    throw registryError("REMOTE_CI_EVIDENCE_JOB_SET_INVALID");
  }
  const jobs = new Map();
  for (const job of run.jobs) {
    if (!exactKeys(job, JOB_FIELDS) || jobs.has(job.jobId)) {
      throw registryError("REMOTE_CI_EVIDENCE_JOB_INVALID");
    }
    jobs.set(job.jobId, job);
  }
  for (const requirement of REQUIRED_CHECKS) {
    const job = jobs.get(requirement.jobId);
    if (!job || job.checkName !== requirement.expectedName
      || !ID_PATTERN.test(job.jobRunId) || !ID_PATTERN.test(job.checkRunId)
      || !APP_REF_PATTERN.test(job.checkAppIdentityRef)
      || job.checkAppIdentityRef !== EXPECTED_APP_REF
      || job.workflowRunId !== run.workflowRunId || job.runAttempt !== run.runAttempt
      || job.headSha !== run.testedSha
      || job.status !== "COMPLETED" || job.conclusion !== "SUCCESS"
      || !Number.isSafeInteger(job.skippedCount) || job.skippedCount !== 0
      || timestamp(job.startedAt) === null || timestamp(job.completedAt) === null
      || timestamp(job.startedAt) < timestamp(run.startedAt)
      || timestamp(job.completedAt) > timestamp(run.completedAt)
      || timestamp(job.startedAt) > timestamp(job.completedAt)
      || globalState.jobRunIds.has(job.jobRunId)
      || globalState.checkRunIds.has(job.checkRunId)) {
      throw registryError("REMOTE_CI_EVIDENCE_JOB_INVALID");
    }
    globalState.jobRunIds.add(job.jobRunId);
    globalState.checkRunIds.add(job.checkRunId);
  }

  if (!Array.isArray(run.artifacts) || run.artifacts.length !== 1) {
    throw registryError("REMOTE_CI_EVIDENCE_ARTIFACT_SET_INVALID");
  }
  validateArtifact(
    run.artifacts[0],
    run,
    context,
    globalState.artifactIds,
    globalState.artifactRefs,
    evaluatedAt
  );
}

function validateProtection(value, document, evaluatedAt) {
  if (!exactKeys(value, PROTECTION_FIELDS)
    || !["RULESET", "BRANCH_PROTECTION"].includes(value.mode)
    || value.targetRef !== document.targetRef
    || value.active !== true
    || value.strictHeadShaBinding !== true
    || value.pullRequestRequired !== true
    || value.administratorBypassAllowed !== false
    || value.forcePushAllowed !== false
    || value.branchDeletionAllowed !== false
    || value.postMergeMainRunRequired !== true
    || timestamp(value.observedAt) === null
    || timestamp(value.observedAt) > evaluatedAt + 300000
    || evaluatedAt - timestamp(value.observedAt) > 604800000
    || !AUDIT_REF_PATTERN.test(value.ruleChangeAuditRef)
    || !SHA256_PATTERN.test(value.readbackDigest)
    || !Array.isArray(value.requiredChecks)
    || value.requiredChecks.length !== REQUIRED_CHECKS.length) {
    throw registryError("REMOTE_CI_EVIDENCE_PROTECTION_INVALID");
  }
  const checks = new Map();
  for (const check of value.requiredChecks) {
    if (!exactKeys(check, PROTECTION_CHECK_FIELDS)
      || checks.has(check.expectedName)
      || check.checkAppIdentityRef !== EXPECTED_APP_REF) {
      throw registryError("REMOTE_CI_EVIDENCE_PROTECTION_CHECK_INVALID");
    }
    checks.set(check.expectedName, check);
  }
  for (const requirement of REQUIRED_CHECKS) {
    if (!checks.has(requirement.expectedName)) {
      throw registryError("REMOTE_CI_EVIDENCE_PROTECTION_CHECK_INVALID");
    }
  }
}

function createRemoteCiEvidenceRegistry(options = {}) {
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));

  function evaluate(inputDocument, inputContext) {
    const document = clone(inputDocument);
    const context = inputContext;
    if (!exactKeys(document, DOCUMENT_FIELDS)
      || !exactKeys(context, CONTEXT_FIELDS)
      || document.recordType !== "REMOTE_CI_REQUIRED_CHECK_AND_ARTIFACT_READBACK"
      || document.formatVersion !== 1
      || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
      || document.productVersion !== "v1.0.0"
      || document.repository !== manifest.repositoryPolicy.repository
      || document.targetRef !== manifest.repositoryPolicy.targetRef
      || document.workflowPath !== manifest.repositoryPolicy.workflowPath
      || document.workflowName !== manifest.repositoryPolicy.workflowName
      || !SHA256_PATTERN.test(document.workflowBlobSha256)
      || !SHA256_PATTERN.test(document.revocationSnapshotDigest)
      || context.revocationSnapshotDigest !== document.revocationSnapshotDigest
      || !plainRecord(context.artifactBytesByRef)
      || timestamp(document.collectedAt) === null || timestamp(document.validUntil) === null
      || timestamp(context.evaluatedAt) === null
      || timestamp(document.collectedAt) > timestamp(context.evaluatedAt) + 300000
      || timestamp(context.evaluatedAt) > timestamp(document.validUntil)
      || timestamp(document.validUntil) - timestamp(document.collectedAt) > 604800000) {
      throw registryError("REMOTE_CI_EVIDENCE_DOCUMENT_INVALID");
    }
    const bindings = shaBindings(document);
    if (!Array.isArray(document.runs) || document.runs.length !== RUN_ROLES.length) {
      throw registryError("REMOTE_CI_EVIDENCE_RUN_SET_INVALID");
    }
    const runs = new Map();
    for (const run of document.runs) {
      if (!plainRecord(run) || runs.has(run.runRole)) {
        throw registryError("REMOTE_CI_EVIDENCE_RUN_SET_INVALID");
      }
      runs.set(run.runRole, run);
    }
    const globalState = {
      runIds: new Set(),
      jobRunIds: new Set(),
      checkRunIds: new Set(),
      artifactIds: new Set(),
      artifactRefs: new Set(),
    };
    for (const policy of RUN_ROLES) {
      const run = runs.get(policy.runRole);
      if (!run) throw registryError("REMOTE_CI_EVIDENCE_RUN_SET_INVALID");
      validateRun(
        run,
        policy,
        document,
        bindings,
        context,
        globalState,
        timestamp(context.evaluatedAt)
      );
    }
    validateProtection(document.protectionReadback, document, timestamp(context.evaluatedAt));

    const normalized = deepFreeze({
      ...document,
      runs: RUN_ROLES.map((policy) => {
        const run = runs.get(policy.runRole);
        return {
          ...run,
          jobs: REQUIRED_CHECKS.map((requirement) => (
            run.jobs.find((job) => job.jobId === requirement.jobId)
          )),
          artifacts: [...run.artifacts].sort((left, right) => (
            left.artifactRef.localeCompare(right.artifactRef)
          )),
        };
      }),
      protectionReadback: {
        ...document.protectionReadback,
        requiredChecks: REQUIRED_CHECKS.map((requirement) => (
          document.protectionReadback.requiredChecks.find(
            (entry) => entry.expectedName === requirement.expectedName
          )
        )),
      },
    });
    const result = deepFreeze({
      validationLevel: VALIDATION_LEVEL,
      status: "STRUCTURE_AND_ARTIFACT_BYTES_VERIFIED_NOT_TRUSTED_REMOTE_READBACK",
      evidenceReadyForTrustedReadbackAdapter: true,
      runCount: normalized.runs.length,
      checkCount: normalized.runs.reduce((sum, run) => sum + run.jobs.length, 0),
      artifactCount: normalized.runs.reduce((sum, run) => sum + run.artifacts.length, 0),
      authorization: { ...AUTHORIZATION },
    });
    return deepFreeze({ document: normalized, result });
  }

  function seal(document, context) {
    const evaluated = evaluate(document, context);
    const evaluatedAt = context.evaluatedAt;
    const documentDigest = digest("myroot-remote-ci-evidence-document:v1", evaluated.document);
    const resultDigest = digest("myroot-remote-ci-evidence-result:v1", {
      documentDigest,
      evaluatedAt,
      result: evaluated.result,
    });
    return deepFreeze({
      schemaVersion: 1,
      contractStatus: CONTRACT_STATUS,
      sealStatus: "STRUCTURE_AND_BYTES_SEALED_NOT_GATE_CLOSED",
      evaluatedAt,
      documentDigest,
      resultDigest,
      document: evaluated.document,
      result: evaluated.result,
      authorization: { ...AUTHORIZATION },
    });
  }

  function verify(envelope, context) {
    try {
      if (!exactKeys(envelope, ENVELOPE_FIELDS)
        || envelope.schemaVersion !== 1
        || envelope.contractStatus !== CONTRACT_STATUS
        || envelope.sealStatus !== "STRUCTURE_AND_BYTES_SEALED_NOT_GATE_CLOSED"
        || envelope.evaluatedAt !== context.evaluatedAt
        || canonicalJson(envelope.authorization) !== canonicalJson(AUTHORIZATION)) return false;
      const evaluated = evaluate(envelope.document, context);
      const documentDigest = digest("myroot-remote-ci-evidence-document:v1", evaluated.document);
      const resultDigest = digest("myroot-remote-ci-evidence-result:v1", {
        documentDigest,
        evaluatedAt: context.evaluatedAt,
        result: evaluated.result,
      });
      return envelope.documentDigest === documentDigest
        && envelope.resultDigest === resultDigest
        && canonicalJson(envelope.result) === canonicalJson(evaluated.result);
    } catch {
      return false;
    }
  }

  function sealClosed() {
    throw registryError("REMOTE_CI_EVIDENCE_UNTRUSTED_CANNOT_CLOSE_GATE");
  }

  return deepFreeze({
    contractVersion: manifest.contractVersion,
    contractStatus: CONTRACT_STATUS,
    validationLevel: VALIDATION_LEVEL,
    authorization: { ...AUTHORIZATION },
    evaluate,
    seal,
    verify,
    sealClosed,
  });
}

let defaultRegistry;
function getDefaultRemoteCiEvidenceRegistry() {
  if (!defaultRegistry) defaultRegistry = createRemoteCiEvidenceRegistry();
  return defaultRegistry;
}

module.exports = {
  AUTHORIZATION,
  REQUIRED_CHECKS,
  RUN_ROLES,
  SHA_ROLES,
  canonicalJson,
  createRemoteCiEvidenceRegistry,
  digest,
  getDefaultRemoteCiEvidenceRegistry,
};
