const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  validateFormalLaunchReadiness,
} = require("../src/formalLaunchReadinessRegistry");
const {
  createFormalEvidenceByteResolver,
} = require("../src/formalEvidenceByteResolver");
const {
  RECEIPT_DIGEST_FIELDS,
  computeFormalGateTrustedReceiptDigest,
  createFormalGateEvidenceResolver,
} = require("../src/formalGateEvidenceResolver");

const ROOT = path.join(__dirname, "../..");
const CONTRACT_PATH = path.join(ROOT, "contracts/formal-launch-readiness/v1.0.0.json");

function fixture() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, contract.matrixPath), "utf8"));
  return { contract, matrix };
}

function stableReceipt({ evidenceKind, evidenceSha256, releaseTarget, environmentKinds }) {
  const fields = {
    receiptFormatVersion: 1,
    evidenceKind,
    evidenceSha256,
    releaseTarget,
    environmentKinds,
    subjectDigest: "1".repeat(64),
    adapterId: "TEST:CONTROLLED_READBACK",
    adapterImplementationDigest: "2".repeat(64),
    adapterPolicyDigest: "3".repeat(64),
    observedAt: "2026-07-19T20:49:00.000Z",
    validUntil: "2026-07-19T21:00:00.000Z",
    revocationSequence: 0,
    revocationReadbackDigest: "4".repeat(64),
    verificationStatus: "VERIFIED_EXTERNAL_READBACK",
    reasonCodes: [],
  };
  return {
    ...fields,
    receiptDigest: computeFormalGateTrustedReceiptDigest(Object.fromEntries(
      RECEIPT_DIGEST_FIELDS.map((field) => [field, fields[field]])
    )),
  };
}

function trustedEvidenceFixture(policy) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "formal-launch-readiness-"));
  const relativePath = "docs/evidence/v1.0.0/baseline_acceptance_controlled_readback.json";
  const absolutePath = path.join(repositoryRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(JSON.stringify({
    evidenceKind: policy.closureEvidenceKind,
    controlledReadback: true,
  }));
  fs.writeFileSync(absolutePath, bytes);
  const sha256 = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const evidenceResolver = createFormalGateEvidenceResolver({
    byteResolver: createFormalEvidenceByteResolver({ repositoryRoot }),
    verifierAdapters: {
      [policy.closureEvidenceKind]: {
        verify: ({ evidenceSha256, releaseTarget, environmentKinds }) => stableReceipt({
          evidenceKind: policy.closureEvidenceKind,
          evidenceSha256,
          releaseTarget,
          environmentKinds,
        }),
      },
    },
  });
  return { repositoryRoot, relativePath, sha256, evidenceResolver };
}

test("current formal launch matrix is exact, non-authorizing, and derives all 14 gates open", () => {
  const result = validateFormalLaunchReadiness(fixture());
  assert.deepEqual(result, {
    status: "NOT_READY",
    gateCount: 14,
    openGateCount: 14,
    hardBlockerCount: 3,
    closedGateCount: 0,
    formalLaunchAuthorized: false,
    matrixDigest: result.matrixDigest,
  });
  assert.match(result.matrixDigest, /^[0-9a-f]{64}$/);
});

test("missing, duplicate, reordered, or unknown gates fail closed", () => {
  for (const mutate of [
    (matrix) => { matrix.gates.pop(); },
    (matrix) => { matrix.gates[1] = structuredClone(matrix.gates[0]); },
    (matrix) => { [matrix.gates[0], matrix.gates[1]] = [matrix.gates[1], matrix.gates[0]]; },
    (matrix) => { matrix.gates[0].gateId = "UNKNOWN_GATE"; },
  ]) {
    const input = fixture();
    mutate(input.matrix);
    assert.throws(() => validateFormalLaunchReadiness(input));
  }
});

test("manual READY, launch authorization, or relaxed blocker status cannot create closure", () => {
  for (const mutate of [
    (matrix) => { matrix.overallStatus = "READY_FOR_SEPARATE_FORMAL_LAUNCH_DECISION"; },
    (matrix) => { matrix.authorization.formalLaunchAuthorized = true; },
    (matrix) => { matrix.authorization.deploymentAuthorized = true; },
    (matrix) => { matrix.gates[2].status = "OPEN"; },
    (matrix) => { matrix.gates[0].externalWriteRequired = false; },
  ]) {
    const input = fixture();
    mutate(input.matrix);
    assert.throws(() => validateFormalLaunchReadiness(input));
  }
});

test("open evidence rejects placeholders, missing next actions, and unbounded extra fields", () => {
  for (const mutate of [
    (matrix) => { matrix.gates[0].missing = "TBD"; },
    (matrix) => { matrix.gates[0].nextAuthorization = ""; },
    (matrix) => { matrix.gates[0].signerName = "Alice"; },
    (matrix) => { delete matrix.gates[0].proved; },
  ]) {
    const input = fixture();
    mutate(input.matrix);
    assert.throws(() => validateFormalLaunchReadiness(input));
  }
});

test("a closed gate requires its exact evidence kind, environments, digest, and controlled readback", () => {
  const input = fixture();
  const policy = input.contract.gates[0];
  const trusted = trustedEvidenceFixture(policy);
  input.matrix.gates[0] = {
    gateId: policy.gateId,
    status: input.contract.closedGateStatus,
    localImplementation: "CONTRACT_AND_VALIDATOR_READY",
    proved: "Controlled approval readback and the sealed baseline envelope were independently verified.",
    closureEvidence: {
      kind: policy.closureEvidenceKind,
      evidencePath: trusted.relativePath,
      sha256: trusted.sha256,
      verificationClass: "CONTROLLED_EXTERNAL_READBACK",
      verifiedAt: "2026-07-19T20:50:00+08:00",
      environmentKinds: policy.requiredEnvironmentKinds,
    },
    externalWriteRequired: false,
  };
  assert.throws(() => validateFormalLaunchReadiness(input), {
    code: "FORMAL_LAUNCH_READINESS_EVIDENCE_RESOLVER_REQUIRED",
  });
  const result = validateFormalLaunchReadiness({ ...input, evidenceResolver: trusted.evidenceResolver });
  assert.equal(result.closedGateCount, 1);
  assert.equal(result.openGateCount, 13);
  for (const mutate of [
    (evidence) => { evidence.kind = "WRONG"; },
    (evidence) => { evidence.sha256 = "synthetic"; },
    (evidence) => { evidence.verificationClass = "LOCAL_STRUCTURE_ONLY"; },
    (evidence) => { evidence.environmentKinds = ["PRODUCTION"]; },
  ]) {
    const changed = structuredClone(input);
    mutate(changed.matrix.gates[0].closureEvidence);
    assert.throws(() => validateFormalLaunchReadiness({
      ...changed,
      evidenceResolver: trusted.evidenceResolver,
    }), {
      code: "FORMAL_LAUNCH_READINESS_CLOSED_GATE_INVALID",
    });
  }
  fs.rmSync(trusted.repositoryRoot, { recursive: true, force: true });
});

test("even fourteen structurally closed gates cannot derive readiness without trusted evidence resolution", () => {
  const input = fixture();
  input.matrix.gates = input.contract.gates.map((policy) => ({
    gateId: policy.gateId,
    status: input.contract.closedGateStatus,
    localImplementation: "LOCAL_IMPLEMENTATION_REVIEWED",
    proved: "Controlled external evidence readback is bound to this exact release gate.",
    closureEvidence: {
      kind: policy.closureEvidenceKind,
      evidencePath: `docs/evidence/v1.0.0/${policy.gateId.toLowerCase()}_controlled_readback.json`,
      sha256: "b".repeat(64),
      verificationClass: "CONTROLLED_EXTERNAL_READBACK",
      verifiedAt: "2026-07-19T20:50:00+08:00",
      environmentKinds: policy.requiredEnvironmentKinds,
    },
    externalWriteRequired: false,
  }));
  input.matrix.overallStatus = input.contract.readyOverallStatus;
  assert.throws(() => validateFormalLaunchReadiness(input), {
    code: "FORMAL_LAUNCH_READINESS_EVIDENCE_RESOLVER_REQUIRED",
  });
});

test("fixed CLI validates only the repository matrix and emits a non-authorizing summary", () => {
  const script = path.join(ROOT, "scripts/validate-formal-launch-readiness.js");
  const result = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "NOT_READY");
  assert.equal(output.openGateCount, 14);
  assert.equal(output.formalLaunchAuthorized, false);
  const rejected = spawnSync(process.execPath, [script, "--matrix", "/tmp/forged.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /FORMAL_LAUNCH_READINESS_CLI_ARGUMENTS_FORBIDDEN/);
});
