const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AUTHORIZATION,
  createRemoteCiEvidenceRegistry,
} = require("../src/remoteCiEvidenceRegistry");

const APP_REF =
  "app:sha256:e67ea24b2a6c1075f14393573a7043b7dffc4d12c37340053fd0639c2e6310ae";
const EVALUATED_AT = "2026-07-20T10:00:00.000Z";
const CHECKS = [
  ["candidate-provenance", "Source provenance only"],
  ["verify", "Full verification"],
  ["cloudfunctions-node18", "Cloud Functions Node.js 18 compatibility"],
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function buildRun({ role, eventName, testedShaRole, testedSha, id, hour, prHeadSha, baseSha }) {
  const startedAt = `2026-07-20T0${hour}:00:00.000Z`;
  const completedAt = `2026-07-20T0${hour}:15:00.000Z`;
  const artifactBytes = Buffer.from(`candidate provenance bytes for ${role}`, "utf8");
  const artifactRef = `artifact:sha256:${sha256(Buffer.from(`${role}:ref`))}`;
  return {
    run: {
      runRole: role,
      workflowRunId: String(id),
      runAttempt: 1,
      eventName,
      workflowPath: ".github/workflows/ci.yml",
      workflowName: "CI Gate",
      workflowBlobSha256: "a".repeat(64),
      testedShaRole,
      testedSha,
      prHeadSha,
      baseSha,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      startedAt,
      completedAt,
      jobs: CHECKS.map(([jobId, checkName], index) => ({
        jobId,
        jobRunId: String(id * 100 + index + 1),
        checkRunId: String(id * 100 + index + 51),
        checkName,
        checkAppIdentityRef: APP_REF,
        workflowRunId: String(id),
        runAttempt: 1,
        headSha: testedSha,
        status: "COMPLETED",
        conclusion: "SUCCESS",
        skippedCount: 0,
        startedAt: `2026-07-20T0${hour}:0${index + 1}:00.000Z`,
        completedAt: `2026-07-20T0${hour}:1${index}:00.000Z`,
      })),
      artifacts: [{
        artifactRef,
        artifactId: String(id * 1000 + 1),
        artifactClass: "SOURCE_PROVENANCE_ONLY",
        name: `candidate-provenance-${testedSha}`,
        workflowRunId: String(id),
        runAttempt: 1,
        headSha: testedSha,
        sizeBytes: artifactBytes.length,
        providerDigest: sha256(artifactBytes),
        downloadedSha256: sha256(artifactBytes),
        uploadedAt: `2026-07-20T0${hour}:09:00.000Z`,
        expiresAt: "2026-07-21T10:00:00.000Z",
      }],
    },
    artifactRef,
    artifactBytes,
  };
}

function fixture() {
  const shaBinding = {
    prHeadSha: "1".repeat(40),
    testedMergeSha: "2".repeat(40),
    baseSha: "3".repeat(40),
    postMergeMainSha: "4".repeat(40),
  };
  const pullRequest = buildRun({
    role: "PULL_REQUEST_VERIFICATION",
    eventName: "pull_request",
    testedShaRole: "TESTED_MERGE",
    testedSha: shaBinding.testedMergeSha,
    id: 101,
    hour: 8,
    prHeadSha: shaBinding.prHeadSha,
    baseSha: shaBinding.baseSha,
  });
  const postMerge = buildRun({
    role: "POST_MERGE_MAIN_VERIFICATION",
    eventName: "push",
    testedShaRole: "POST_MERGE_MAIN",
    testedSha: shaBinding.postMergeMainSha,
    id: 102,
    hour: 9,
    prHeadSha: null,
    baseSha: null,
  });
  const document = {
    recordType: "REMOTE_CI_REQUIRED_CHECK_AND_ARTIFACT_READBACK",
    formatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    repository: "rijay/root",
    targetRef: "refs/heads/main",
    workflowPath: ".github/workflows/ci.yml",
    workflowName: "CI Gate",
    workflowBlobSha256: "a".repeat(64),
    shaBinding,
    runs: [pullRequest.run, postMerge.run],
    protectionReadback: {
      mode: "RULESET",
      targetRef: "refs/heads/main",
      active: true,
      strictHeadShaBinding: true,
      pullRequestRequired: true,
      administratorBypassAllowed: false,
      forcePushAllowed: false,
      branchDeletionAllowed: false,
      postMergeMainRunRequired: true,
      requiredChecks: CHECKS.map(([, expectedName]) => ({
        expectedName,
        checkAppIdentityRef: APP_REF,
      })),
      observedAt: "2026-07-20T09:30:00.000Z",
      ruleChangeAuditRef: `audit:sha256:${"b".repeat(64)}`,
      readbackDigest: "c".repeat(64),
    },
    collectedAt: "2026-07-20T09:40:00.000Z",
    validUntil: "2026-07-21T09:40:00.000Z",
    revocationSnapshotDigest: "d".repeat(64),
  };
  const context = {
    evaluatedAt: EVALUATED_AT,
    revocationSnapshotDigest: document.revocationSnapshotDigest,
    artifactBytesByRef: {
      [pullRequest.artifactRef]: pullRequest.artifactBytes,
      [postMerge.artifactRef]: postMerge.artifactBytes,
    },
  };
  return { document, context };
}

test("valid evidence binds all four SHA roles and remains entirely unauthorized", () => {
  const registry = createRemoteCiEvidenceRegistry();
  const { document, context } = fixture();
  const evaluated = registry.evaluate(document, context);

  assert.deepEqual(evaluated.document.shaBinding, document.shaBinding);
  assert.equal(evaluated.result.runCount, 2);
  assert.equal(evaluated.result.checkCount, 6);
  assert.equal(evaluated.result.artifactCount, 2);
  assert.deepEqual(evaluated.result.authorization, AUTHORIZATION);
  assert.equal(Object.values(evaluated.result.authorization).every((value) => value === false), true);
  assert.equal(evaluated.result.status,
    "STRUCTURE_AND_ARTIFACT_BYTES_VERIFIED_NOT_TRUSTED_REMOTE_READBACK");

  const envelope = registry.seal(document, context);
  assert.equal(registry.verify(envelope, context), true);
  assert.deepEqual(envelope.authorization, AUTHORIZATION);
  expectCode(() => registry.sealClosed(),
    "REMOTE_CI_EVIDENCE_UNTRUSTED_CANNOT_CLOSE_GATE");
});

test("TESTED_MERGE may become POST_MERGE_MAIN without collapsing semantic SHA roles", () => {
  const registry = createRemoteCiEvidenceRegistry();
  const { document, context } = fixture();
  document.shaBinding.postMergeMainSha = document.shaBinding.testedMergeSha;
  document.runs[1].testedSha = document.shaBinding.testedMergeSha;
  document.runs[1].jobs.forEach((job) => { job.headSha = document.shaBinding.testedMergeSha; });
  const artifact = document.runs[1].artifacts[0];
  artifact.headSha = document.shaBinding.testedMergeSha;
  artifact.name = `candidate-provenance-${document.shaBinding.testedMergeSha}`;
  assert.equal(registry.evaluate(document, context).result.runCount, 2);
});

test("same check names from a different App fail closed", () => {
  const registry = createRemoteCiEvidenceRegistry();
  const { document, context } = fixture();
  document.runs[0].jobs[0].checkAppIdentityRef = `app:sha256:${"e".repeat(64)}`;
  expectCode(() => registry.evaluate(document, context), "REMOTE_CI_EVIDENCE_JOB_INVALID");
});

test("old runs, mixed attempts, wrong SHAs, skip and neutral all fail closed", async (t) => {
  const registry = createRemoteCiEvidenceRegistry();
  const cases = [
    ["old run", (d) => {
      const run = d.runs[0];
      run.startedAt = "2026-07-01T08:00:00.000Z";
      run.completedAt = "2026-07-01T08:15:00.000Z";
    }, "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["mixed job attempt", (d) => { d.runs[0].jobs[0].runAttempt = 2; },
      "REMOTE_CI_EVIDENCE_JOB_INVALID"],
    ["mixed artifact attempt", (d) => { d.runs[0].artifacts[0].runAttempt = 2; },
      "REMOTE_CI_EVIDENCE_ARTIFACT_INVALID"],
    ["wrong job SHA", (d) => { d.runs[0].jobs[0].headSha = d.shaBinding.prHeadSha; },
      "REMOTE_CI_EVIDENCE_JOB_INVALID"],
    ["wrong run SHA", (d) => { d.runs[0].testedSha = d.shaBinding.prHeadSha; },
      "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["skipped step", (d) => { d.runs[0].jobs[0].skippedCount = 1; },
      "REMOTE_CI_EVIDENCE_JOB_INVALID"],
    ["neutral check", (d) => { d.runs[0].jobs[0].conclusion = "NEUTRAL"; },
      "REMOTE_CI_EVIDENCE_JOB_INVALID"],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const { document, context } = fixture();
      mutate(document);
      expectCode(() => registry.evaluate(document, context), code);
    });
  }
});

test("artifact provider metadata and downloaded bytes must match exactly", async (t) => {
  const registry = createRemoteCiEvidenceRegistry();
  await t.test("downloaded byte mismatch", () => {
    const { document, context } = fixture();
    const ref = document.runs[0].artifacts[0].artifactRef;
    context.artifactBytesByRef[ref] = Buffer.from("substituted artifact bytes");
    expectCode(() => registry.evaluate(document, context),
      "REMOTE_CI_EVIDENCE_ARTIFACT_BYTES_MISMATCH");
  });
  await t.test("provider digest mismatch", () => {
    const { document, context } = fixture();
    document.runs[0].artifacts[0].providerDigest = "f".repeat(64);
    expectCode(() => registry.evaluate(document, context),
      "REMOTE_CI_EVIDENCE_ARTIFACT_BYTES_MISMATCH");
  });
});

test("strict false, bypass, force-push and deletion protection states fail closed", async (t) => {
  const registry = createRemoteCiEvidenceRegistry();
  const cases = [
    ["strict false", "strictHeadShaBinding", false],
    ["administrator bypass", "administratorBypassAllowed", true],
    ["force push", "forcePushAllowed", true],
    ["branch deletion", "branchDeletionAllowed", true],
  ];
  for (const [name, field, value] of cases) {
    await t.test(name, () => {
      const { document, context } = fixture();
      document.protectionReadback[field] = value;
      expectCode(() => registry.evaluate(document, context),
        "REMOTE_CI_EVIDENCE_PROTECTION_INVALID");
    });
  }
});

test("repository, workflow path/blob, event, run and protection check App are pinned", async (t) => {
  const registry = createRemoteCiEvidenceRegistry();
  const cases = [
    ["repository", (d) => { d.repository = "attacker/fork"; },
      "REMOTE_CI_EVIDENCE_DOCUMENT_INVALID"],
    ["workflow path", (d) => { d.runs[0].workflowPath = ".github/workflows/fake.yml"; },
      "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["workflow blob", (d) => { d.runs[0].workflowBlobSha256 = "e".repeat(64); },
      "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["event", (d) => { d.runs[0].eventName = "workflow_dispatch"; },
      "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["duplicate run", (d) => { d.runs[1].workflowRunId = d.runs[0].workflowRunId; },
      "REMOTE_CI_EVIDENCE_RUN_INVALID"],
    ["protection App", (d) => {
      d.protectionReadback.requiredChecks[0].checkAppIdentityRef =
        `app:sha256:${"e".repeat(64)}`;
    }, "REMOTE_CI_EVIDENCE_PROTECTION_CHECK_INVALID"],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const { document, context } = fixture();
      mutate(document);
      expectCode(() => registry.evaluate(document, context), code);
    });
  }
});

test("schema-defined ordering yields a stable seal while extra envelope fields fail verify", () => {
  const registry = createRemoteCiEvidenceRegistry();
  const first = fixture();
  const second = fixture();
  second.document.runs.reverse();
  second.document.runs.forEach((run) => run.jobs.reverse());
  second.document.protectionReadback.requiredChecks.reverse();

  const firstSeal = registry.seal(first.document, first.context);
  const secondSeal = registry.seal(second.document, second.context);
  assert.equal(secondSeal.documentDigest, firstSeal.documentDigest);
  assert.equal(secondSeal.resultDigest, firstSeal.resultDigest);

  const extended = { ...clone(firstSeal), unexpectedAuthority: true };
  assert.equal(registry.verify(extended, first.context), false);
  const tampered = clone(firstSeal);
  tampered.document.workflowBlobSha256 = "f".repeat(64);
  assert.equal(registry.verify(tampered, first.context), false);
});
