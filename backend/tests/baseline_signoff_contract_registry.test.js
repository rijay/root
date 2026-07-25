const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computeBaselineInputBindingDigest,
  computeBaselineSignoffContractRegistryDigest,
  computeBaselineSignoffDocumentDigest,
  computeBaselineSignoffPayloadDigest,
  createBaselineSignoffContractRegistry,
  getDefaultBaselineSignoffContractRegistry,
} = require("../src/baselineSignoffContractRegistry");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "baseline-signoff",
  "v1.0.0.json"
);
const SOURCE_PATHS = Object.freeze({
  prdSha256: path.join(REPOSITORY_ROOT, "docs", "v1.0.0_product_requirements.md"),
  designSha256: path.join(REPOSITORY_ROOT, "docs", "design.md"),
  gateDecisionSha256: path.join(
    REPOSITORY_ROOT,
    "docs",
    "v1.0.0_gate_and_document_authority_decision_2026-07-15.md"
  ),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function opaqueRef(namespace, seed) {
  return `${namespace}:sha256:${sha256(seed)}`;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function refreshSignedMaterial(signoff) {
  signoff.signedPayloadDigest = computeBaselineSignoffPayloadDigest(signoff);
  signoff.signatureDigest = sha256(`fixture-signature:${signoff.signedPayloadDigest}`);
  return signoff;
}

function makeSignoff({ decisionId, role, inputBindingDigest }) {
  const identity = `${decisionId}:${role}`;
  return refreshSignedMaterial({
    signoffId: opaqueRef("signoff", identity),
    signerRef: opaqueRef("actor", `actor:${role}`),
    role,
    decisionId,
    decision: "APPROVED",
    conditions: [],
    inputBindingDigest,
    evidenceRef: opaqueRef("evidence", `approval:${identity}`),
    signedAt: "2026-07-17T00:00:00.000Z",
    signatureMethod: "CONTROLLED_APPROVAL_RECORD_V1",
    signedPayloadDigest: "0".repeat(64),
    signatureDigest: "0".repeat(64),
    validatorRef: opaqueRef("validator", "baseline-validator-v1"),
    validationStatus: "VALIDATED",
    validationEvidenceRef: opaqueRef("evidence", `validation:${identity}`),
    validatedAt: "2026-07-17T00:01:00.000Z",
    revocationStatus: "ACTIVE",
    revocationEvidenceRef: null,
  });
}

function baselineDocument() {
  const manifest = readManifest();
  const inputBindingDigest = computeBaselineInputBindingDigest(manifest.inputBinding);
  const signoffs = manifest.decisions.flatMap((decision) => (
    decision.requiredRoles.map((role) => makeSignoff({
      decisionId: decision.decisionId,
      role,
      inputBindingDigest,
    }))
  ));
  return {
    baselineFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    baselineId: opaqueRef("baseline", "myroot-v1-baseline-fixture"),
    inputBinding: clone(manifest.inputBinding),
    signoffs,
    createdAt: "2026-07-17T00:02:00.000Z",
  };
}

function findSignoff(document, decisionId, role) {
  return document.signoffs.find((entry) => (
    entry.decisionId === decisionId && entry.role === role
  ));
}

test("static contract binds the exact v1.0.0 PRD, Design and Gate bytes", () => {
  const manifest = readManifest();
  for (const [digestField, sourcePath] of Object.entries(SOURCE_PATHS)) {
    assert.equal(manifest.inputBinding[digestField], sha256(fs.readFileSync(sourcePath)));
  }
  const registry = getDefaultBaselineSignoffContractRegistry();
  const description = registry.describe();
  assert.equal(description.contractStatus, "NON_RUNTIME_CONTRACT");
  assert.equal(description.contractVersion, "1.0.0");
  assert.equal(description.productVersion, "v1.0.0");
  assert.match(description.registryDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    description.registryDigest,
    computeBaselineSignoffContractRegistryDigest(manifest)
  );
  assert.equal(description.inputBindingDigest, computeBaselineInputBindingDigest(manifest.inputBinding));
  assert.equal(description.runtimeAuthorized, false);
  assert.equal(description.candidateCreationAuthorized, false);
  assert.equal(description.deploymentAuthorized, false);
  assert.equal(Object.hasOwn(description, "releaseId"), false);
  assert.equal(Object.hasOwn(description, "targetEnvironmentId"), false);
  assert.equal(Object.hasOwn(description, "candidateManifestDigest"), false);
});

test("all required decision-role approvals derive closure and emit a baseline digest", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const document = baselineDocument();
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.status, "BASELINE_CLOSED");
  assert.equal(evaluation.derivedAllDecisionIdsClosed, true);
  assert.equal(evaluation.decisionResults.length, 10);
  assert.equal(evaluation.decisionResults.every((entry) => entry.closed), true);
  assert.match(evaluation.baselineDigest, /^[a-f0-9]{64}$/);
  assert.equal(evaluation.runtimeAuthorized, false);
  assert.equal(evaluation.candidateCreationAuthorized, false);
  assert.equal(evaluation.deploymentAuthorized, false);

  const envelope = registry.seal(document);
  assert.equal(envelope.baselineDigest, evaluation.baselineDigest);
  assert.equal(envelope.baselineDigest, computeBaselineSignoffDocumentDigest(envelope.document));
  assert.equal(envelope.derivedAllDecisionIdsClosed, true);
  assert.equal(envelope.runtimeAuthorized, false);
  assert.equal(envelope.candidateCreationAuthorized, false);
  assert.equal(envelope.deploymentAuthorized, false);
  assert.equal(registry.verify(envelope), true);
});

test("acceptance closure is derived without rewriting the signed source bytes", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const manifest = readManifest();
  const sourceBytesBefore = Object.fromEntries(Object.entries(SOURCE_PATHS).map(([
    digestField,
    sourcePath,
  ]) => [digestField, fs.readFileSync(sourcePath)]));

  assert.match(
    sourceBytesBefore.prdSha256.toString("utf8"),
    /BASELINE_SIGNOFF_PENDING/,
    "the frozen source may retain its pre-acceptance snapshot label"
  );
  const envelope = registry.seal(baselineDocument());
  assert.equal(envelope.derivedAllDecisionIdsClosed, true);
  assert.equal(registry.verify(envelope), true);

  for (const [digestField, sourcePath] of Object.entries(SOURCE_PATHS)) {
    const sourceBytesAfter = fs.readFileSync(sourcePath);
    assert.deepEqual(sourceBytesAfter, sourceBytesBefore[digestField]);
    assert.equal(sha256(sourceBytesAfter), manifest.inputBinding[digestField]);
  }
});

test("missing a required role remains open and cannot be sealed", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const document = baselineDocument();
  document.signoffs = document.signoffs.filter((entry) => !(
    entry.decisionId === "D-001" && entry.role === "ENGINEERING"
  ));
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.derivedAllDecisionIdsClosed, false);
  assert.deepEqual(evaluation.decisionResults[0].missingRoles, ["ENGINEERING"]);
  expectCode(() => registry.seal(document), "BASELINE_SIGNOFF_NOT_CLOSED");
});

test("an open structured condition remains open while a closed condition can seal", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const open = baselineDocument();
  const signoff = findSignoff(open, "D-004", "HEALTH_CONTENT_REVIEW");
  signoff.decision = "APPROVED_WITH_CONDITIONS";
  signoff.conditions = [{
    conditionId: opaqueRef("condition", "D-004-health-condition"),
    ownerRef: opaqueRef("actor", "condition-owner-health"),
    deadline: "2026-07-31T00:00:00.000Z",
    status: "OPEN",
    closureEvidenceRef: null,
  }];
  refreshSignedMaterial(signoff);
  const openEvaluation = registry.evaluate(open);
  assert.equal(openEvaluation.derivedAllDecisionIdsClosed, false);
  assert.deepEqual(
    openEvaluation.decisionResults.find((entry) => entry.decisionId === "D-004")
      .conditionalOpenRoles,
    ["HEALTH_CONTENT_REVIEW"]
  );

  const closed = clone(open);
  const closedSignoff = findSignoff(closed, "D-004", "HEALTH_CONTENT_REVIEW");
  closedSignoff.conditions[0].status = "CLOSED";
  closedSignoff.conditions[0].closureEvidenceRef = opaqueRef(
    "evidence",
    "D-004-health-condition-closed"
  );
  assert.equal(
    closedSignoff.signedPayloadDigest,
    computeBaselineSignoffPayloadDigest(closedSignoff),
    "closure proof does not rewrite the signer-approved condition payload"
  );
  assert.equal(registry.evaluate(closed).derivedAllDecisionIdsClosed, true);
  assert.equal(registry.verify(registry.seal(closed)), true);
});

test("a rejection is structurally valid but fails derived closure", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const document = baselineDocument();
  const signoff = findSignoff(document, "D-006", "QA");
  signoff.decision = "REJECTED";
  refreshSignedMaterial(signoff);
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.derivedAllDecisionIdsClosed, false);
  assert.deepEqual(
    evaluation.decisionResults.find((entry) => entry.decisionId === "D-006").rejectedRoles,
    ["QA"]
  );
  expectCode(() => registry.seal(document), "BASELINE_SIGNOFF_NOT_CLOSED");
});

test("a revoked signoff fails derived closure", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const document = baselineDocument();
  const signoff = findSignoff(document, "D-007", "PRIVACY");
  signoff.revocationStatus = "REVOKED";
  signoff.revocationEvidenceRef = opaqueRef("evidence", "D-007-privacy-revocation");
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.derivedAllDecisionIdsClosed, false);
  assert.deepEqual(
    evaluation.decisionResults.find((entry) => entry.decisionId === "D-007").revokedRoles,
    ["PRIVACY"]
  );
  expectCode(() => registry.seal(document), "BASELINE_SIGNOFF_NOT_CLOSED");
});

test("cross-digest signoffs and source-binding drift fail closed", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const crossDigest = baselineDocument();
  const signoff = findSignoff(crossDigest, "D-002", "PRIVACY");
  signoff.inputBindingDigest = "f".repeat(64);
  refreshSignedMaterial(signoff);
  expectCode(() => registry.evaluate(crossDigest), "BASELINE_SIGNOFF_CROSS_DIGEST");

  const sourceDrift = baselineDocument();
  sourceDrift.inputBinding.prdSha256 = "0".repeat(64);
  expectCode(
    () => registry.evaluate(sourceDrift),
    "BASELINE_SIGNOFF_INPUT_BINDING_MISMATCH"
  );
});

test("signed-payload tampering and sealed-envelope tampering are detected", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const payloadTamper = baselineDocument();
  findSignoff(payloadTamper, "D-005", "QA").decision = "REJECTED";
  expectCode(
    () => registry.evaluate(payloadTamper),
    "BASELINE_SIGNOFF_SIGNED_PAYLOAD_DIGEST_MISMATCH"
  );

  const envelopeTamper = clone(registry.seal(baselineDocument()));
  envelopeTamper.document.createdAt = "2026-07-17T00:03:00.000Z";
  expectCode(() => registry.verify(envelopeTamper), "BASELINE_SIGNOFF_DIGEST_MISMATCH");
});

test("one signer cannot combine protected duties on the same decision", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const productPrivacy = baselineDocument();
  const product = findSignoff(productPrivacy, "D-002", "PRODUCT");
  const privacy = findSignoff(productPrivacy, "D-002", "PRIVACY");
  privacy.signerRef = product.signerRef;
  refreshSignedMaterial(privacy);
  expectCode(
    () => registry.evaluate(productPrivacy),
    "BASELINE_SIGNOFF_SEPARATION_OF_DUTIES_VIOLATION"
  );

  const engineeringQa = baselineDocument();
  const engineering = findSignoff(engineeringQa, "D-006", "ENGINEERING");
  const qa = findSignoff(engineeringQa, "D-006", "QA");
  qa.signerRef = engineering.signerRef;
  refreshSignedMaterial(qa);
  expectCode(
    () => registry.evaluate(engineeringQa),
    "BASELINE_SIGNOFF_SEPARATION_OF_DUTIES_VIOLATION"
  );
});

test("the signer-role-decision tuple is unique and personal fields are rejected", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const duplicate = baselineDocument();
  const copy = clone(findSignoff(duplicate, "D-001", "PRODUCT"));
  copy.signoffId = opaqueRef("signoff", "duplicate-signoff-id");
  refreshSignedMaterial(copy);
  duplicate.signoffs.push(copy);
  expectCode(() => registry.evaluate(duplicate), "BASELINE_SIGNOFF_DUPLICATE");

  const personalField = baselineDocument();
  findSignoff(personalField, "D-001", "PRODUCT").fullName = "not-allowed";
  expectCode(() => registry.evaluate(personalField), "BASELINE_SIGNOFF_CONTRACT_INVALID");

  const nonOpaqueRef = baselineDocument();
  findSignoff(nonOpaqueRef, "D-001", "PRODUCT").signerRef = "person-name";
  expectCode(() => registry.evaluate(nonOpaqueRef), "BASELINE_SIGNOFF_CONTRACT_INVALID");
});

test("closure is derived only; an injected manual boolean is rejected", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const document = baselineDocument();
  document.derivedAllDecisionIdsClosed = true;
  expectCode(() => registry.evaluate(document), "BASELINE_SIGNOFF_CONTRACT_INVALID");
});

test("signature methods are allowlisted and runtime identity fields are not part of the contract", () => {
  const registry = getDefaultBaselineSignoffContractRegistry();
  const unsupportedMethod = baselineDocument();
  const signoff = findSignoff(unsupportedMethod, "D-003", "PRIVACY");
  signoff.signatureMethod = "UNCONTROLLED_TEXT_CONFIRMATION";
  refreshSignedMaterial(signoff);
  expectCode(
    () => registry.evaluate(unsupportedMethod),
    "BASELINE_SIGNOFF_CONTRACT_INVALID"
  );

  for (const field of ["releaseId", "targetEnvironmentId", "candidateManifestDigest"]) {
    const runtimeCoupled = baselineDocument();
    runtimeCoupled[field] = "not-part-of-baseline-signoff";
    expectCode(
      () => registry.evaluate(runtimeCoupled),
      "BASELINE_SIGNOFF_CONTRACT_INVALID"
    );
  }
});

test("manifest drift in decision policy or authorization fails closed", () => {
  const decisionDrift = readManifest();
  decisionDrift.decisions[0].requiredRoles = ["PRODUCT"];
  expectCode(
    () => createBaselineSignoffContractRegistry({ manifest: decisionDrift }),
    "BASELINE_SIGNOFF_CONTRACT_MANIFEST_INVALID"
  );

  const authorizationDrift = readManifest();
  authorizationDrift.authorization.candidateCreationAuthorized = true;
  expectCode(
    () => createBaselineSignoffContractRegistry({ manifest: authorizationDrift }),
    "BASELINE_SIGNOFF_CONTRACT_MANIFEST_INVALID"
  );
});
