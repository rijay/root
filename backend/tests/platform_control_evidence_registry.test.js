const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  computePlatformControlBundleDigest,
  computePlatformControlPayloadDigest,
  computePlatformControlRegistryDigest,
  computePlatformControlSignoffPayloadDigest,
  createPlatformControlEvidenceRegistry,
  getDefaultPlatformControlEvidenceRegistry,
} = require("../src/platformControlEvidenceRegistry");

const MANIFEST_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "contracts",
  "platform-control-evidence",
  "v1.0.0.json"
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ref(namespace, seed) {
  return `${namespace}:sha256:${sha256(seed)}`;
}

function refreshSignoff(signoff) {
  signoff.signedPayloadDigest = computePlatformControlSignoffPayloadDigest(signoff);
  signoff.signatureDigest = sha256(`signature:${signoff.signedPayloadDigest}`);
  return signoff;
}

function makeSignoff(document, evidenceKind, role) {
  const seed = `${document.environmentKind}:${evidenceKind}:${role}`;
  return refreshSignoff({
    signoffId: ref("signoff", seed),
    signerRef: ref("actor", seed),
    role,
    evidenceKind,
    environmentKind: document.environmentKind,
    controlPayloadDigest: computePlatformControlPayloadDigest(document),
    decision: "APPROVED",
    signedAt: "2026-07-17T09:00:00.000Z",
    signatureMethod: "CONTROLLED_APPROVAL_RECORD_V1",
    signedPayloadDigest: "0".repeat(64),
    signatureDigest: "0".repeat(64),
    validatorRef: ref("validator", "platform-controls-v1"),
    validationStatus: "VALIDATED",
    validationEvidenceRef: ref("evidence", `validation:${seed}`),
    revocationStatus: "ACTIVE",
    revocationEvidenceRef: null,
  });
}

const ROLE_SETS = Object.freeze({
  TIMER_ONLY_IAM: Object.freeze(["PLATFORM_SECURITY", "ENGINEERING", "QA"]),
  ALERT_RECEIVER: Object.freeze([
    "OPERATIONS_ON_CALL",
    "PLATFORM_SECURITY",
    "ENGINEERING",
    "QA",
  ]),
});

function attachSignoffs(document) {
  document.signoffs = Object.entries(ROLE_SETS).flatMap(([kind, roles]) => (
    roles.map((role) => makeSignoff(document, kind, role))
  ));
  return document;
}

function evidenceDocument(environmentKind = "CANDIDATE") {
  const suffix = environmentKind.toLowerCase();
  const document = {
    evidenceFormatVersion: 1,
    digestCanonicalizationVersion: "MYROOT_CANONICAL_JSON_V1",
    productVersion: "v1.0.0",
    releaseRef: ref("release", "v1.0.0-D0"),
    environmentKind,
    environmentRef: ref("environment", suffix),
    timerOnlyIam: {
      functionRef: ref("resource", `${suffix}:function`),
      revisionRef: ref("resource", `${suffix}:revision`),
      triggerRef: ref("resource", `${suffix}:trigger`),
      triggerType: "TIMER",
      invocationPolicyRef: ref("policy", `${suffix}:timer-invocation`),
      principalRef: ref("actor", `${suffix}:platform-timer`),
      allowedActions: ["INVOKE_FUNCTION"],
      resourceRef: ref("resource", `${suffix}:timer-resource`),
      executionMode: "PREVIEW",
      timerSucceeded: true,
      nonTimerDenied: true,
      timerSuccessEvidenceRef: ref("evidence", `${suffix}:timer-success`),
      nonTimerDenyEvidenceRef: ref("evidence", `${suffix}:non-timer-deny`),
      configSnapshotDigest: sha256(`${suffix}:config`),
      observedAt: "2026-07-17T08:00:00.000Z",
    },
    alertReceiver: {
      receiverRef: ref("resource", `${suffix}:alert-receiver`),
      onCallOwnerRef: ref("actor", `${suffix}:on-call-owner`),
      channelClass: "INCIDENT_MANAGEMENT",
      signingPolicyRef: ref("policy", `${suffix}:alert-signing`),
      persistencePolicyRef: ref("policy", `${suffix}:alert-persistence`),
      ackPolicyRef: ref("policy", `${suffix}:alert-ack`),
      retryPolicyRef: ref("policy", `${suffix}:alert-retry`),
      deadLetterPolicyRef: ref("policy", `${suffix}:alert-dead-letter`),
      warningSloSeconds: 900,
      criticalSloSeconds: 300,
      syntheticSendAuthorizationRef: ref("evidence", `${suffix}:synthetic-auth`),
      syntheticWarningEvidenceRef: ref("evidence", `${suffix}:synthetic-warning`),
      syntheticCriticalEvidenceRef: ref("evidence", `${suffix}:synthetic-critical`),
      receiverAcknowledgementRef: ref("evidence", `${suffix}:receiver-ack`),
      observedAt: "2026-07-17T08:30:00.000Z",
    },
    signoffs: [],
    collectedAt: "2026-07-17T09:30:00.000Z",
  };
  return attachSignoffs(document);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test("static registry is non-runtime and authorizes no platform mutation or send", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const description = registry.describe();
  assert.equal(description.registryDigest, computePlatformControlRegistryDigest(manifest));
  assert.deepEqual(description.requiredEnvironmentKinds, ["CANDIDATE", "PRODUCTION"]);
  assert.deepEqual(description.authorization, {
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    iamMutationAuthorized: false,
    alertChannelMutationAuthorized: false,
    syntheticSendAuthorized: false,
    productionWriteAuthorized: false,
    gateClosureAuthorized: false,
  });
});

test("complete timer and alert evidence closes one environment without granting authority", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const document = evidenceDocument();
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.derivedAllControlsClosed, true);
  assert.equal(evaluation.controlResults.every((entry) => entry.closed), true);
  assert.equal(evaluation.authorization.gateClosureAuthorized, false);
  assert.equal(evaluation.authorization.syntheticSendAuthorized, false);
  const envelope = registry.seal(document);
  assert.equal(registry.verify(envelope), true);
});

test("full bundle requires distinct Candidate and Production evidence", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const candidate = evidenceDocument("CANDIDATE");
  const production = evidenceDocument("PRODUCTION");
  const evaluation = registry.evaluateBundle([production, candidate]);
  assert.equal(evaluation.derivedAllEnvironmentsClosed, true);
  assert.deepEqual(
    evaluation.environments.map((entry) => entry.environmentKind),
    ["CANDIDATE", "PRODUCTION"]
  );
  const sealed = registry.sealBundle([production, candidate]);
  assert.equal(registry.verifyBundle(sealed), true);
  assert.equal(sealed.authorization.gateClosureAuthorized, false);

  const duplicate = clone(production);
  duplicate.environmentRef = candidate.environmentRef;
  attachSignoffs(duplicate);
  expectCode(
    () => registry.evaluateBundle([candidate, duplicate]),
    "PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID"
  );
  expectCode(
    () => registry.evaluateBundle([candidate]),
    "PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID"
  );

  const crossRelease = evidenceDocument("PRODUCTION");
  crossRelease.releaseRef = ref("release", "v1.0.0-D1");
  attachSignoffs(crossRelease);
  expectCode(
    () => registry.evaluateBundle([candidate, crossRelease]),
    "PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID"
  );

  const aliasedResources = evidenceDocument("PRODUCTION");
  for (const field of ["functionRef", "revisionRef", "triggerRef", "principalRef", "resourceRef"]) {
    aliasedResources.timerOnlyIam[field] = candidate.timerOnlyIam[field];
  }
  aliasedResources.alertReceiver.receiverRef = candidate.alertReceiver.receiverRef;
  attachSignoffs(aliasedResources);
  expectCode(
    () => registry.evaluateBundle([candidate, aliasedResources]),
    "PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID"
  );
});

test("bundle verification cannot bypass same-release and environment-resource isolation", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const candidate = evidenceDocument("CANDIDATE");
  const crossRelease = evidenceDocument("PRODUCTION");
  crossRelease.releaseRef = ref("release", "v1.0.0-D1");
  attachSignoffs(crossRelease);
  const environmentEnvelopes = [registry.seal(candidate), registry.seal(crossRelease)];
  const forgedBundle = {
    registryDigest: environmentEnvelopes[0].registryDigest,
    bundleDigest: computePlatformControlBundleDigest(environmentEnvelopes),
    environmentEnvelopes,
    derivedAllEnvironmentsClosed: true,
    authorization: environmentEnvelopes[0].authorization,
  };
  assert.equal(registry.verifyBundle(forgedBundle), false);
});

test("missing required role remains open and cannot be sealed", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const document = evidenceDocument();
  document.signoffs = document.signoffs.filter((entry) => !(
    entry.evidenceKind === "ALERT_RECEIVER" && entry.role === "QA"
  ));
  const evaluation = registry.evaluate(document);
  assert.equal(evaluation.derivedAllControlsClosed, false);
  assert.deepEqual(
    evaluation.controlResults.find((entry) => entry.evidenceKind === "ALERT_RECEIVER")
      .missingRoles,
    ["QA"]
  );
  expectCode(() => registry.seal(document), "PLATFORM_CONTROL_EVIDENCE_NOT_CLOSED");
});

test("timer proof requires one exact action, preview success and non-timer denial", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  for (const mutate of [
    (doc) => { doc.timerOnlyIam.allowedActions.push("WRITE_CONFIG"); },
    (doc) => { doc.timerOnlyIam.executionMode = "EXECUTE"; },
    (doc) => { doc.timerOnlyIam.nonTimerDenied = false; },
    (doc) => { doc.timerOnlyIam.principalRef = "timer@example.invalid"; },
  ]) {
    const document = evidenceDocument();
    mutate(document);
    expectCode(
      () => registry.evaluate(document),
      "PLATFORM_CONTROL_TIMER_EVIDENCE_INVALID"
    );
  }
});

test("alert proof requires signed persistence, ack, retry, dead-letter and both synthetic paths", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  for (const mutate of [
    (doc) => { doc.alertReceiver.receiverRef = "https://secret.example.invalid/hook"; },
    (doc) => { doc.alertReceiver.deadLetterPolicyRef = null; },
    (doc) => { doc.alertReceiver.syntheticCriticalEvidenceRef = null; },
    (doc) => { doc.alertReceiver.criticalSloSeconds = 901; },
  ]) {
    const document = evidenceDocument();
    mutate(document);
    expectCode(
      () => registry.evaluate(document),
      "PLATFORM_CONTROL_ALERT_EVIDENCE_INVALID"
    );
  }
});

test("signoff tampering, revocation, duplicate duties and raw extra fields fail closed", () => {
  const registry = getDefaultPlatformControlEvidenceRegistry();
  const tampered = evidenceDocument();
  tampered.signoffs[0].decision = "REJECTED";
  expectCode(() => registry.evaluate(tampered), "PLATFORM_CONTROL_SIGNOFF_INVALID");

  const revoked = evidenceDocument();
  revoked.signoffs[0].revocationStatus = "REVOKED";
  revoked.signoffs[0].revocationEvidenceRef = ref("evidence", "revoked");
  expectCode(() => registry.evaluate(revoked), "PLATFORM_CONTROL_SIGNOFF_INVALID");

  const duplicateDuty = evidenceDocument();
  const timerSecurity = duplicateDuty.signoffs.find((entry) => (
    entry.evidenceKind === "TIMER_ONLY_IAM" && entry.role === "PLATFORM_SECURITY"
  ));
  const timerEngineering = duplicateDuty.signoffs.find((entry) => (
    entry.evidenceKind === "TIMER_ONLY_IAM" && entry.role === "ENGINEERING"
  ));
  timerEngineering.signerRef = timerSecurity.signerRef;
  refreshSignoff(timerEngineering);
  expectCode(
    () => registry.evaluate(duplicateDuty),
    "PLATFORM_CONTROL_DUTY_SEPARATION_FAILED"
  );

  const rawEndpoint = evidenceDocument();
  rawEndpoint.alertReceiver.endpoint = "https://secret.example.invalid/hook";
  expectCode(
    () => registry.evaluate(rawEndpoint),
    "PLATFORM_CONTROL_ALERT_EVIDENCE_INVALID"
  );
});

test("manifest authority drift and sealed envelope tampering are detected", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.authorization.syntheticSendAuthorized = true;
  expectCode(
    () => createPlatformControlEvidenceRegistry({ manifest }),
    "PLATFORM_CONTROL_CONTRACT_INVALID"
  );

  const registry = getDefaultPlatformControlEvidenceRegistry();
  const envelope = clone(registry.seal(evidenceDocument()));
  envelope.document.alertReceiver.warningSloSeconds = 901;
  assert.equal(registry.verify(envelope), false);

  const bundle = clone(registry.sealBundle([
    evidenceDocument("CANDIDATE"),
    evidenceDocument("PRODUCTION"),
  ]));
  bundle.environmentEnvelopes[0].document.timerOnlyIam.timerSucceeded = false;
  assert.equal(registry.verifyBundle(bundle), false);
});
