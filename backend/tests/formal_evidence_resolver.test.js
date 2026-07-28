const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createFormalEvidenceByteResolver,
} = require("../src/formalEvidenceByteResolver");
const {
  RECEIPT_DIGEST_FIELDS,
  computeFormalGateTrustedReceiptDigest,
  createFormalGateEvidenceResolver,
  isVerifiedFormalGateReceipt,
} = require("../src/formalGateEvidenceResolver");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "formal-evidence-"));
  const evidencePath = "docs/evidence/v1.0.0/readback.json";
  const absolutePath = path.join(root, evidencePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(JSON.stringify({ evidenceKind: "TEST_READBACK", value: 1 }));
  fs.writeFileSync(absolutePath, bytes);
  return { root, evidencePath, absolutePath, bytes, digest: sha256(bytes) };
}

function receipt(input, override = {}) {
  const fields = {
    receiptFormatVersion: 1,
    evidenceKind: "TEST_READBACK",
    evidenceSha256: input.evidenceSha256,
    releaseTarget: input.releaseTarget,
    environmentKinds: input.environmentKinds,
    subjectDigest: "1".repeat(64),
    adapterId: "TEST:READBACK",
    adapterImplementationDigest: "2".repeat(64),
    adapterPolicyDigest: "3".repeat(64),
    observedAt: "2026-07-19T12:49:00.000Z",
    validUntil: "2026-07-19T13:00:00.000Z",
    revocationSequence: 0,
    revocationReadbackDigest: "4".repeat(64),
    verificationStatus: "VERIFIED_EXTERNAL_READBACK",
    reasonCodes: [],
    ...override,
  };
  return {
    ...fields,
    receiptDigest: computeFormalGateTrustedReceiptDigest(Object.fromEntries(
      RECEIPT_DIGEST_FIELDS.map((field) => [field, fields[field]])
    )),
  };
}

test("byte resolver reads one regular contained file and binds digest plus evidence kind", () => {
  const value = fixture();
  const resolver = createFormalEvidenceByteResolver({ repositoryRoot: value.root });
  const resolved = resolver.resolve({
    evidencePath: value.evidencePath,
    expectedSha256: value.digest,
    expectedEvidenceKind: "TEST_READBACK",
  });
  assert.equal(resolved.sha256, value.digest);
  assert.equal(resolved.parsedDocument.value, 1);
  assert.equal(resolved.structureOnly, true);
  fs.rmSync(value.root, { recursive: true, force: true });
});

test("byte resolver rejects path escape, missing file, digest mismatch, kind mismatch, symlink, and oversize", () => {
  const value = fixture();
  const resolver = createFormalEvidenceByteResolver({ repositoryRoot: value.root, maximumBytes: 80 });
  const base = {
    evidencePath: value.evidencePath,
    expectedSha256: value.digest,
    expectedEvidenceKind: "TEST_READBACK",
  };
  assert.throws(() => resolver.resolve({ ...base, evidencePath: "../outside.json" }), {
    code: "FORMAL_EVIDENCE_PATH_INVALID",
  });
  assert.throws(() => resolver.resolve({ ...base, evidencePath: "docs/evidence/v1.0.0/missing.json" }), {
    code: "FORMAL_EVIDENCE_FILE_MISSING",
  });
  assert.throws(() => resolver.resolve({ ...base, expectedSha256: "0".repeat(64) }), {
    code: "FORMAL_EVIDENCE_DIGEST_MISMATCH",
  });
  assert.throws(() => resolver.resolve({ ...base, expectedEvidenceKind: "WRONG_KIND" }), {
    code: "FORMAL_EVIDENCE_KIND_MISMATCH",
  });
  const linkPath = path.join(value.root, "docs/evidence/v1.0.0/link.json");
  fs.symlinkSync(value.absolutePath, linkPath);
  assert.throws(() => resolver.resolve({ ...base, evidencePath: "docs/evidence/v1.0.0/link.json" }), {
    code: "FORMAL_EVIDENCE_SYMLINK_REJECTED",
  });
  fs.writeFileSync(value.absolutePath, Buffer.alloc(81, 0x20));
  assert.throws(() => resolver.resolve({
    ...base,
    expectedSha256: sha256(Buffer.alloc(81, 0x20)),
  }), { code: "FORMAL_EVIDENCE_SIZE_LIMIT_EXCEEDED" });
  fs.rmSync(value.root, { recursive: true, force: true });
});

test("gate resolver brands only a receipt produced by the selected verifier adapter", () => {
  const value = fixture();
  const byteResolver = createFormalEvidenceByteResolver({ repositoryRoot: value.root });
  const verifierAdapters = {
    TEST_READBACK: { verify: (input) => receipt(input) },
  };
  const resolver = createFormalGateEvidenceResolver({ byteResolver, verifierAdapters });
  const trusted = resolver.resolveClosureEvidence({
    policy: { closureEvidenceKind: "TEST_READBACK", requiredEnvironmentKinds: ["RELEASE"] },
    evidence: { evidencePath: value.evidencePath, sha256: value.digest },
    releaseTarget: "v1.0.0",
    evaluatedAt: "2026-07-19T12:50:00.000Z",
  });
  assert.equal(isVerifiedFormalGateReceipt(trusted), true);
  assert.equal(isVerifiedFormalGateReceipt({ ...trusted }), false);
  fs.rmSync(value.root, { recursive: true, force: true });
});

test("gate resolver rejects missing adapters, forged receipt digest, wrong target, and stale receipts", () => {
  for (const [adapters, expected] of [
    [{}, "FORMAL_GATE_TRUSTED_ADAPTER_MISSING"],
    [{ TEST_READBACK: { verify: (input) => ({ ...receipt(input), receiptDigest: "0".repeat(64) }) } },
      "FORMAL_GATE_TRUSTED_RECEIPT_DIGEST_MISMATCH"],
    [{ TEST_READBACK: { verify: (input) => receipt(input, { releaseTarget: "v9.9.9" }) } },
      "FORMAL_GATE_TRUSTED_RECEIPT_INVALID"],
    [{ TEST_READBACK: { verify: (input) => receipt(input, {
      observedAt: "2026-07-19T11:00:00.000Z",
      validUntil: "2026-07-19T11:01:00.000Z",
    }) } }, "FORMAL_GATE_TRUSTED_RECEIPT_STALE"],
  ]) {
    const value = fixture();
    const resolver = createFormalGateEvidenceResolver({
      byteResolver: createFormalEvidenceByteResolver({ repositoryRoot: value.root }),
      verifierAdapters: adapters,
    });
    assert.throws(() => resolver.resolveClosureEvidence({
      policy: { closureEvidenceKind: "TEST_READBACK", requiredEnvironmentKinds: ["RELEASE"] },
      evidence: { evidencePath: value.evidencePath, sha256: value.digest },
      releaseTarget: "v1.0.0",
      evaluatedAt: "2026-07-19T12:50:00.000Z",
    }), { code: expected });
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});
