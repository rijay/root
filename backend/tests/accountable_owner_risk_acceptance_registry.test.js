const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  computeAccountableOwnerInputBindingDigest,
  createAccountableOwnerRiskAcceptanceRegistry,
  getDefaultAccountableOwnerRiskAcceptanceRegistry,
} = require("../src/accountableOwnerRiskAcceptanceRegistry");

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  ROOT,
  "contracts",
  "accountable-owner-risk-acceptance",
  "v2.0.0.json"
);
const ACCEPTED_AT = "2026-07-28T09:54:20.000Z";

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function acceptanceDocument() {
  const contract = manifest();
  return {
    acceptanceFormatVersion: 2,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    acceptanceId: `acceptance:sha256:${"1".repeat(64)}`,
    accountableOwnerRef: `actor:sha256:${"2".repeat(64)}`,
    inputBinding: contract.inputBinding,
    sourceInputBindingDigest: computeAccountableOwnerInputBindingDigest(contract.inputBinding),
    coveredDecisionIds: contract.requiredDecisionIds,
    acceptedRiskCategories: contract.requiredRiskCategories,
    directive: contract.requiredDirective,
    directiveDigest: "f5725a324d16e4b662fb90439b95a8700b58a2caba0dab3f0849f23db60916b7",
    authorizationMethod: contract.authorizationMethod,
    authorizationEvidenceRef: `evidence:sha256:${"3".repeat(64)}`,
    acceptedAt: ACCEPTED_AT,
    revocationStatus: "ACTIVE",
    revocationEvidenceRef: null,
    supersedes: contract.supersedes,
    createdAt: ACCEPTED_AT,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(action, code) {
  assert.throws(action, (error) => error?.code === code);
}

test("single accountable owner closes only the baseline approval Gate", () => {
  const registry = getDefaultAccountableOwnerRiskAcceptanceRegistry();
  const evaluation = registry.evaluate(acceptanceDocument());
  assert.equal(evaluation.status, "OWNER_RISK_ACCEPTANCE_CLOSED");
  assert.equal(evaluation.coveredDecisionIds.length, 10);
  assert.equal(evaluation.acceptedRiskCategories.length, 6);
  assert.equal(evaluation.baselineApprovalGateClosureAuthorized, true);
  assert.equal(evaluation.runtimeAuthorized, false);
  assert.equal(evaluation.candidateCreationAuthorized, false);
  assert.equal(evaluation.deploymentAuthorized, false);
  assert.equal(evaluation.formalLaunchAuthorized, false);
});

test("sealed V2 envelope verifies without mutating or deleting V1", () => {
  const registry = getDefaultAccountableOwnerRiskAcceptanceRegistry();
  const envelope = registry.seal(acceptanceDocument());
  assert.equal(registry.verify(envelope), true);
  assert.equal(envelope.document.supersedes.status, "SUPERSEDED_NOT_DELETED");
  assert.equal(fs.existsSync(path.join(ROOT, envelope.document.supersedes.contractPath)), true);
});

test("directive, source binding, decision coverage, risk coverage, and revocation fail closed", () => {
  const registry = getDefaultAccountableOwnerRiskAcceptanceRegistry();
  for (const mutate of [
    (document) => { document.directive = "直接通过"; },
    (document) => { document.directiveDigest = "0".repeat(64); },
    (document) => { document.sourceInputBindingDigest = "0".repeat(64); },
    (document) => { document.coveredDecisionIds.pop(); },
    (document) => { document.acceptedRiskCategories.pop(); },
    (document) => {
      document.revocationStatus = "REVOKED";
      document.revocationEvidenceRef = `evidence:sha256:${"4".repeat(64)}`;
    },
  ]) {
    const input = acceptanceDocument();
    mutate(input);
    assert.throws(() => registry.evaluate(input));
  }
});

test("manual launch authorization and extra identity fields are rejected", () => {
  const registry = getDefaultAccountableOwnerRiskAcceptanceRegistry();
  const extraIdentity = acceptanceDocument();
  extraIdentity.ownerName = "not allowed";
  expectCode(() => registry.evaluate(extraIdentity), "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_INVALID");

  const envelope = clone(registry.seal(acceptanceDocument()));
  envelope.formalLaunchAuthorized = true;
  expectCode(
    () => registry.verify(envelope),
    "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_ENVELOPE_INVALID"
  );
});

test("manifest cannot broaden Candidate, deployment, or formal launch authorization", () => {
  for (const field of [
    "candidateCreationAuthorized",
    "deploymentAuthorized",
    "formalLaunchAuthorized",
  ]) {
    const changed = manifest();
    changed.authorization[field] = true;
    expectCode(
      () => createAccountableOwnerRiskAcceptanceRegistry({ manifest: changed }),
      "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_MANIFEST_INVALID"
    );
  }
});

test("repository source bytes and the superseded V1 Contract are re-read at the Registry seam", () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "owner-risk-acceptance-"));
  expectCode(
    () => createAccountableOwnerRiskAcceptanceRegistry({
      manifest: manifest(),
      repositoryRoot: emptyRoot,
    }),
    "ACCOUNTABLE_OWNER_REPOSITORY_SOURCE_BINDING_MISMATCH"
  );
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});
