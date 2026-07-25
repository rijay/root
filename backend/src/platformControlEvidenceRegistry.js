const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "platform-control-evidence",
  "v1.0.0.json"
);

const CONTRACT_STATUS = "NON_RUNTIME_PLATFORM_CONTROL_EVIDENCE";
const PRODUCT_VERSION = "v1.0.0";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const ENVIRONMENT_KINDS = Object.freeze(["CANDIDATE", "PRODUCTION"]);
const EVIDENCE_ROLES = Object.freeze({
  TIMER_ONLY_IAM: Object.freeze(["PLATFORM_SECURITY", "ENGINEERING", "QA"]),
  ALERT_RECEIVER: Object.freeze([
    "OPERATIONS_ON_CALL",
    "PLATFORM_SECURITY",
    "ENGINEERING",
    "QA",
  ]),
});
const SIGNATURE_METHODS = Object.freeze([
  "CONTROLLED_APPROVAL_RECORD_V1",
  "DETACHED_DIGITAL_SIGNATURE_V1",
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  deploymentAuthorized: false,
  iamMutationAuthorized: false,
  alertChannelMutationAuthorized: false,
  syntheticSendAuthorized: false,
  productionWriteAuthorized: false,
  gateClosureAuthorized: false,
});
const DOCUMENT_FIELDS = Object.freeze([
  "evidenceFormatVersion",
  "digestCanonicalizationVersion",
  "productVersion",
  "releaseRef",
  "environmentKind",
  "environmentRef",
  "timerOnlyIam",
  "alertReceiver",
  "signoffs",
  "collectedAt",
]);
const TIMER_FIELDS = Object.freeze([
  "functionRef",
  "revisionRef",
  "triggerRef",
  "triggerType",
  "invocationPolicyRef",
  "principalRef",
  "allowedActions",
  "resourceRef",
  "executionMode",
  "timerSucceeded",
  "nonTimerDenied",
  "timerSuccessEvidenceRef",
  "nonTimerDenyEvidenceRef",
  "configSnapshotDigest",
  "observedAt",
]);
const ALERT_FIELDS = Object.freeze([
  "receiverRef",
  "onCallOwnerRef",
  "channelClass",
  "signingPolicyRef",
  "persistencePolicyRef",
  "ackPolicyRef",
  "retryPolicyRef",
  "deadLetterPolicyRef",
  "warningSloSeconds",
  "criticalSloSeconds",
  "syntheticSendAuthorizationRef",
  "syntheticWarningEvidenceRef",
  "syntheticCriticalEvidenceRef",
  "receiverAcknowledgementRef",
  "observedAt",
]);
const SIGNOFF_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "evidenceKind",
  "environmentKind",
  "controlPayloadDigest",
  "decision",
  "signedAt",
  "signatureMethod",
  "signedPayloadDigest",
  "signatureDigest",
  "validatorRef",
  "validationStatus",
  "validationEvidenceRef",
  "revocationStatus",
  "revocationEvidenceRef",
]);
const SIGNED_PAYLOAD_FIELDS = Object.freeze([
  "signoffId",
  "signerRef",
  "role",
  "evidenceKind",
  "environmentKind",
  "controlPayloadDigest",
  "decision",
  "signedAt",
  "signatureMethod",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MANIFEST_FIELDS = Object.freeze([
  "registryVersion",
  "contractVersion",
  "productVersion",
  "scope",
  "digestAlgorithm",
  "canonicalization",
  "requiredEnvironmentKinds",
  "evidenceKinds",
  "allowedSignatureMethods",
  "documentSchema",
  "authorization",
]);
const CANONICALIZATION_FIELDS = Object.freeze([
  "version",
  "unicodeNormalization",
  "objectKeyOrdering",
  "numberEncoding",
  "arrayOrdering",
  "undefinedPolicy",
  "digestDomainSeparation",
]);
const DOCUMENT_SCHEMA_FIELDS = Object.freeze([
  "exactFields",
  "timerOnlyIamExactFields",
  "alertReceiverExactFields",
  "signoffExactFields",
  "opaqueReferencePatterns",
]);
const OPAQUE_PATTERNS = Object.freeze({
  release: /^release:sha256:[a-f0-9]{64}$/,
  environment: /^environment:sha256:[a-f0-9]{64}$/,
  resource: /^resource:sha256:[a-f0-9]{64}$/,
  actor: /^actor:sha256:[a-f0-9]{64}$/,
  evidence: /^evidence:sha256:[a-f0-9]{64}$/,
  policy: /^policy:sha256:[a-f0-9]{64}$/,
  signoff: /^signoff:sha256:[a-f0-9]{64}$/,
  validator: /^validator:sha256:[a-f0-9]{64}$/,
});
const OPAQUE_PATTERN_SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(OPAQUE_PATTERNS).map(([key, value]) => [key, value.source])
));

function registryError(code = "PLATFORM_CONTROL_EVIDENCE_INVALID") {
  const error = new Error("Platform Control Evidence Registry rejected the input");
  error.code = code;
  return error;
}

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

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index]);
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

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw registryError("PLATFORM_CONTROL_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw registryError("PLATFORM_CONTROL_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw registryError("PLATFORM_CONTROL_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) throw registryError("PLATFORM_CONTROL_CANONICALIZATION_REJECTED");
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

function computePlatformControlRegistryDigest(manifest) {
  return digest("myroot-platform-control-registry:v1", manifest);
}

function controlPayload(document) {
  return {
    evidenceFormatVersion: document.evidenceFormatVersion,
    digestCanonicalizationVersion: document.digestCanonicalizationVersion,
    productVersion: document.productVersion,
    releaseRef: document.releaseRef,
    environmentKind: document.environmentKind,
    environmentRef: document.environmentRef,
    timerOnlyIam: document.timerOnlyIam,
    alertReceiver: document.alertReceiver,
    collectedAt: document.collectedAt,
  };
}

function computePlatformControlPayloadDigest(document) {
  return digest("myroot-platform-control-payload:v1", controlPayload(document));
}

function signoffPayload(signoff) {
  return Object.fromEntries(SIGNED_PAYLOAD_FIELDS.map((field) => [field, signoff[field]]));
}

function computePlatformControlSignoffPayloadDigest(signoff) {
  return digest("myroot-platform-control-signoff:v1", signoffPayload(signoff));
}

function computePlatformControlDocumentDigest(document) {
  return digest("myroot-platform-control-document:v1", document);
}

function computePlatformControlBundleDigest(environmentEnvelopes) {
  return digest("myroot-platform-control-environment-bundle:v1", environmentEnvelopes.map((entry) => ({
    environmentKind: entry.document.environmentKind,
    environmentRef: entry.document.environmentRef,
    documentDigest: entry.documentDigest,
  })));
}

function environmentResourceRefs(document) {
  return Object.freeze([
    document.timerOnlyIam.functionRef,
    document.timerOnlyIam.revisionRef,
    document.timerOnlyIam.triggerRef,
    document.timerOnlyIam.principalRef,
    document.timerOnlyIam.resourceRef,
    document.alertReceiver.receiverRef,
  ]);
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}

function opaque(value, kind) {
  return typeof value === "string" && OPAQUE_PATTERNS[kind].test(value);
}

function validateManifest(manifest) {
  const expectedEvidenceKinds = Object.entries(EVIDENCE_ROLES).map(([evidenceKind, requiredRoles]) => ({
    evidenceKind,
    requiredRoles: [...requiredRoles],
  }));
  if (!exactKeys(manifest, MANIFEST_FIELDS)
    || manifest.registryVersion !== 1
    || manifest.contractVersion !== "1.0.0"
    || manifest.productVersion !== PRODUCT_VERSION
    || manifest.scope !== CONTRACT_STATUS
    || manifest.digestAlgorithm !== "SHA-256"
    || !exactKeys(manifest.canonicalization, CANONICALIZATION_FIELDS)
    || manifest.canonicalization.version !== CANONICALIZATION_VERSION
    || manifest.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || manifest.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || manifest.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || manifest.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || manifest.canonicalization.undefinedPolicy !== "REJECT"
    || manifest.canonicalization.digestDomainSeparation !== "PLATFORM_CONTROL_EVIDENCE_V1"
    || !sameArray(manifest.requiredEnvironmentKinds, ENVIRONMENT_KINDS)
    || canonicalJson(manifest.evidenceKinds) !== canonicalJson(expectedEvidenceKinds)
    || !sameArray(manifest.allowedSignatureMethods, SIGNATURE_METHODS)
    || !exactKeys(manifest.documentSchema, DOCUMENT_SCHEMA_FIELDS)
    || !sameArray(manifest.documentSchema.exactFields, DOCUMENT_FIELDS)
    || !sameArray(manifest.documentSchema.timerOnlyIamExactFields, TIMER_FIELDS)
    || !sameArray(manifest.documentSchema.alertReceiverExactFields, ALERT_FIELDS)
    || !sameArray(manifest.documentSchema.signoffExactFields, SIGNOFF_FIELDS)
    || canonicalJson(manifest.documentSchema.opaqueReferencePatterns)
      !== canonicalJson(OPAQUE_PATTERN_SOURCES)
    || !exactKeys(manifest.authorization, Object.keys(AUTHORIZATION))
    || canonicalJson(manifest.authorization) !== canonicalJson(AUTHORIZATION)) {
    throw registryError("PLATFORM_CONTROL_CONTRACT_INVALID");
  }
  return deepFreeze(clone(manifest));
}

function validateTimer(timer) {
  if (!exactKeys(timer, TIMER_FIELDS)
    || !opaque(timer.functionRef, "resource")
    || !opaque(timer.revisionRef, "resource")
    || !opaque(timer.triggerRef, "resource")
    || timer.triggerType !== "TIMER"
    || !opaque(timer.invocationPolicyRef, "policy")
    || !opaque(timer.principalRef, "actor")
    || !sameArray(timer.allowedActions, ["INVOKE_FUNCTION"])
    || !opaque(timer.resourceRef, "resource")
    || timer.executionMode !== "PREVIEW"
    || timer.timerSucceeded !== true
    || timer.nonTimerDenied !== true
    || !opaque(timer.timerSuccessEvidenceRef, "evidence")
    || !opaque(timer.nonTimerDenyEvidenceRef, "evidence")
    || !SHA256_PATTERN.test(timer.configSnapshotDigest)
    || !canonicalTimestamp(timer.observedAt)) {
    throw registryError("PLATFORM_CONTROL_TIMER_EVIDENCE_INVALID");
  }
}

function validateAlert(alert) {
  if (!exactKeys(alert, ALERT_FIELDS)
    || !opaque(alert.receiverRef, "resource")
    || !opaque(alert.onCallOwnerRef, "actor")
    || !["INCIDENT_MANAGEMENT", "ENTERPRISE_MESSAGING", "WEBHOOK_GATEWAY"]
      .includes(alert.channelClass)
    || !opaque(alert.signingPolicyRef, "policy")
    || !opaque(alert.persistencePolicyRef, "policy")
    || !opaque(alert.ackPolicyRef, "policy")
    || !opaque(alert.retryPolicyRef, "policy")
    || !opaque(alert.deadLetterPolicyRef, "policy")
    || !Number.isSafeInteger(alert.warningSloSeconds)
    || alert.warningSloSeconds < 1
    || !Number.isSafeInteger(alert.criticalSloSeconds)
    || alert.criticalSloSeconds < 1
    || alert.criticalSloSeconds > alert.warningSloSeconds
    || !opaque(alert.syntheticSendAuthorizationRef, "evidence")
    || !opaque(alert.syntheticWarningEvidenceRef, "evidence")
    || !opaque(alert.syntheticCriticalEvidenceRef, "evidence")
    || !opaque(alert.receiverAcknowledgementRef, "evidence")
    || !canonicalTimestamp(alert.observedAt)) {
    throw registryError("PLATFORM_CONTROL_ALERT_EVIDENCE_INVALID");
  }
}

function validateSignoff(signoff, document, controlPayloadDigest) {
  if (!exactKeys(signoff, SIGNOFF_FIELDS)
    || !opaque(signoff.signoffId, "signoff")
    || !opaque(signoff.signerRef, "actor")
    || !Object.hasOwn(EVIDENCE_ROLES, signoff.evidenceKind)
    || !EVIDENCE_ROLES[signoff.evidenceKind].includes(signoff.role)
    || signoff.environmentKind !== document.environmentKind
    || signoff.controlPayloadDigest !== controlPayloadDigest
    || signoff.decision !== "APPROVED"
    || !canonicalTimestamp(signoff.signedAt)
    || !SIGNATURE_METHODS.includes(signoff.signatureMethod)
    || !SHA256_PATTERN.test(signoff.signedPayloadDigest)
    || signoff.signedPayloadDigest !== computePlatformControlSignoffPayloadDigest(signoff)
    || !SHA256_PATTERN.test(signoff.signatureDigest)
    || !opaque(signoff.validatorRef, "validator")
    || signoff.validationStatus !== "VALIDATED"
    || !opaque(signoff.validationEvidenceRef, "evidence")
    || signoff.revocationStatus !== "ACTIVE"
    || signoff.revocationEvidenceRef !== null) {
    throw registryError("PLATFORM_CONTROL_SIGNOFF_INVALID");
  }
}

function createPlatformControlEvidenceRegistry(options = {}) {
  const manifest = validateManifest(options.manifest || JSON.parse(
    fs.readFileSync(options.manifestPath || DEFAULT_MANIFEST_PATH, "utf8")
  ));
  const registryDigest = computePlatformControlRegistryDigest(manifest);

  function evaluate(documentInput) {
    const document = clone(documentInput);
    if (!exactKeys(document, DOCUMENT_FIELDS)
      || document.evidenceFormatVersion !== 1
      || document.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
      || document.productVersion !== PRODUCT_VERSION
      || !opaque(document.releaseRef, "release")
      || !ENVIRONMENT_KINDS.includes(document.environmentKind)
      || !opaque(document.environmentRef, "environment")
      || !canonicalTimestamp(document.collectedAt)
      || !Array.isArray(document.signoffs)) {
      throw registryError("PLATFORM_CONTROL_DOCUMENT_INVALID");
    }
    validateTimer(document.timerOnlyIam);
    validateAlert(document.alertReceiver);
    const payloadDigest = computePlatformControlPayloadDigest(document);
    const tupleSet = new Set();
    const signerByKind = new Map();
    for (const signoff of document.signoffs) {
      validateSignoff(signoff, document, payloadDigest);
      const tuple = `${signoff.evidenceKind}\0${signoff.role}`;
      if (tupleSet.has(tuple)) throw registryError("PLATFORM_CONTROL_SIGNOFF_DUPLICATE");
      tupleSet.add(tuple);
      const signerSet = signerByKind.get(signoff.evidenceKind) || new Set();
      if (signerSet.has(signoff.signerRef)) {
        throw registryError("PLATFORM_CONTROL_DUTY_SEPARATION_FAILED");
      }
      signerSet.add(signoff.signerRef);
      signerByKind.set(signoff.evidenceKind, signerSet);
    }
    const controlResults = Object.entries(EVIDENCE_ROLES).map(([evidenceKind, roles]) => {
      const missingRoles = roles.filter((role) => !tupleSet.has(`${evidenceKind}\0${role}`));
      return { evidenceKind, missingRoles, closed: missingRoles.length === 0 };
    });
    return deepFreeze({
      contractStatus: CONTRACT_STATUS,
      registryDigest,
      controlPayloadDigest: payloadDigest,
      documentDigest: computePlatformControlDocumentDigest(document),
      environmentKind: document.environmentKind,
      environmentRef: document.environmentRef,
      controlResults,
      derivedAllControlsClosed: controlResults.every((entry) => entry.closed),
      authorization: clone(AUTHORIZATION),
    });
  }

  function seal(documentInput) {
    const evaluation = evaluate(documentInput);
    if (!evaluation.derivedAllControlsClosed) {
      throw registryError("PLATFORM_CONTROL_EVIDENCE_NOT_CLOSED");
    }
    return deepFreeze({
      registryDigest,
      controlPayloadDigest: evaluation.controlPayloadDigest,
      documentDigest: evaluation.documentDigest,
      derivedAllControlsClosed: true,
      document: clone(documentInput),
      authorization: clone(AUTHORIZATION),
    });
  }

  function verify(envelope) {
    if (!exactKeys(envelope, [
      "registryDigest",
      "controlPayloadDigest",
      "documentDigest",
      "derivedAllControlsClosed",
      "document",
      "authorization",
    ])
      || envelope.registryDigest !== registryDigest
      || envelope.derivedAllControlsClosed !== true
      || canonicalJson(envelope.authorization) !== canonicalJson(AUTHORIZATION)) return false;
    try {
      const evaluation = evaluate(envelope.document);
      return evaluation.derivedAllControlsClosed
        && envelope.controlPayloadDigest === evaluation.controlPayloadDigest
        && envelope.documentDigest === evaluation.documentDigest;
    } catch {
      return false;
    }
  }

  function evaluateBundle(documentsInput) {
    if (!Array.isArray(documentsInput) || documentsInput.length !== ENVIRONMENT_KINDS.length) {
      throw registryError("PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID");
    }
    const evaluations = documentsInput.map(evaluate);
    const byKind = new Map(evaluations.map((entry) => [entry.environmentKind, entry]));
    const releaseRefs = new Set(documentsInput.map((document) => document.releaseRef));
    const resourceColumns = environmentResourceRefs(documentsInput[0]).map((_, index) => (
      new Set(documentsInput.map((document) => environmentResourceRefs(document)[index]))
    ));
    if (byKind.size !== ENVIRONMENT_KINDS.length
      || !ENVIRONMENT_KINDS.every((kind) => byKind.has(kind))
      || releaseRefs.size !== 1
      || resourceColumns.some((refs) => refs.size !== ENVIRONMENT_KINDS.length)
      || new Set(evaluations.map((entry) => entry.environmentRef)).size !== evaluations.length) {
      throw registryError("PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_INVALID");
    }
    return deepFreeze({
      contractStatus: CONTRACT_STATUS,
      registryDigest,
      environments: ENVIRONMENT_KINDS.map((kind) => byKind.get(kind)),
      derivedAllEnvironmentsClosed: evaluations.every((entry) => entry.derivedAllControlsClosed),
      authorization: clone(AUTHORIZATION),
    });
  }

  function sealBundle(documentsInput) {
    const evaluation = evaluateBundle(documentsInput);
    if (!evaluation.derivedAllEnvironmentsClosed) {
      throw registryError("PLATFORM_CONTROL_ENVIRONMENT_BUNDLE_NOT_CLOSED");
    }
    const byKind = new Map(documentsInput.map((document) => [document.environmentKind, document]));
    const environmentEnvelopes = ENVIRONMENT_KINDS.map((kind) => seal(byKind.get(kind)));
    return deepFreeze({
      registryDigest,
      bundleDigest: computePlatformControlBundleDigest(environmentEnvelopes),
      environmentEnvelopes,
      derivedAllEnvironmentsClosed: true,
      authorization: clone(AUTHORIZATION),
    });
  }

  function verifyBundle(bundle) {
    if (!exactKeys(bundle, [
      "registryDigest",
      "bundleDigest",
      "environmentEnvelopes",
      "derivedAllEnvironmentsClosed",
      "authorization",
    ])
      || bundle.registryDigest !== registryDigest
      || !SHA256_PATTERN.test(bundle.bundleDigest)
      || bundle.derivedAllEnvironmentsClosed !== true
      || canonicalJson(bundle.authorization) !== canonicalJson(AUTHORIZATION)
      || !Array.isArray(bundle.environmentEnvelopes)
      || bundle.environmentEnvelopes.length !== ENVIRONMENT_KINDS.length
      || !bundle.environmentEnvelopes.every(verify)
      || !sameArray(
        bundle.environmentEnvelopes.map((entry) => entry.document.environmentKind),
        ENVIRONMENT_KINDS
      )
      || new Set(bundle.environmentEnvelopes.map((entry) => entry.document.environmentRef)).size
      !== ENVIRONMENT_KINDS.length) return false;
    try {
      const documents = bundle.environmentEnvelopes.map((entry) => entry.document);
      const evaluation = evaluateBundle(documents);
      return evaluation.derivedAllEnvironmentsClosed
        && bundle.bundleDigest === computePlatformControlBundleDigest(bundle.environmentEnvelopes);
    } catch {
      return false;
    }
  }

  return deepFreeze({
    describe: () => deepFreeze({
      contractStatus: CONTRACT_STATUS,
      contractVersion: manifest.contractVersion,
      productVersion: PRODUCT_VERSION,
      registryDigest,
      requiredEnvironmentKinds: [...ENVIRONMENT_KINDS],
      authorization: clone(AUTHORIZATION),
    }),
    evaluate,
    seal,
    verify,
    evaluateBundle,
    sealBundle,
    verifyBundle,
  });
}

let defaultRegistry;
function getDefaultPlatformControlEvidenceRegistry() {
  if (!defaultRegistry) defaultRegistry = createPlatformControlEvidenceRegistry();
  return defaultRegistry;
}

module.exports = {
  computePlatformControlDocumentDigest,
  computePlatformControlBundleDigest,
  computePlatformControlPayloadDigest,
  computePlatformControlRegistryDigest,
  computePlatformControlSignoffPayloadDigest,
  createPlatformControlEvidenceRegistry,
  getDefaultPlatformControlEvidenceRegistry,
};
