const crypto = require("node:crypto");

const RECEIPT_FIELDS = Object.freeze([
  "receiptFormatVersion",
  "evidenceKind",
  "evidenceSha256",
  "releaseTarget",
  "environmentKinds",
  "subjectDigest",
  "adapterId",
  "adapterImplementationDigest",
  "adapterPolicyDigest",
  "observedAt",
  "validUntil",
  "revocationSequence",
  "revocationReadbackDigest",
  "verificationStatus",
  "reasonCodes",
  "receiptDigest",
]);
const RECEIPT_DIGEST_FIELDS = Object.freeze(RECEIPT_FIELDS.filter((field) => field !== "receiptDigest"));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const verifiedReceipts = new WeakSet();

function resolutionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256")
    .update("myroot-formal-gate-trusted-receipt:v1\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex");
}

function isoInstant(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function validateTrustedReceipt(receipt, {
  expectedKind,
  expectedSha256,
  expectedReleaseTarget,
  expectedEnvironmentKinds,
  evaluatedAt,
}) {
  if (!exactKeys(receipt, RECEIPT_FIELDS)
    || receipt.receiptFormatVersion !== 1
    || receipt.evidenceKind !== expectedKind
    || receipt.evidenceSha256 !== expectedSha256
    || receipt.releaseTarget !== expectedReleaseTarget
    || JSON.stringify(receipt.environmentKinds) !== JSON.stringify(expectedEnvironmentKinds)
    || !SHA256_PATTERN.test(receipt.subjectDigest || "")
    || !/^[A-Z0-9_:-]{3,128}$/.test(receipt.adapterId || "")
    || !SHA256_PATTERN.test(receipt.adapterImplementationDigest || "")
    || !SHA256_PATTERN.test(receipt.adapterPolicyDigest || "")
    || !isoInstant(receipt.observedAt)
    || !isoInstant(receipt.validUntil)
    || !Number.isSafeInteger(receipt.revocationSequence)
    || receipt.revocationSequence < 0
    || !SHA256_PATTERN.test(receipt.revocationReadbackDigest || "")
    || receipt.verificationStatus !== "VERIFIED_EXTERNAL_READBACK"
    || !Array.isArray(receipt.reasonCodes)
    || receipt.reasonCodes.length !== 0
    || !SHA256_PATTERN.test(receipt.receiptDigest || "")) {
    throw resolutionError("FORMAL_GATE_TRUSTED_RECEIPT_INVALID");
  }
  const expectedDigest = digest(Object.fromEntries(
    RECEIPT_DIGEST_FIELDS.map((field) => [field, receipt[field]])
  ));
  if (receipt.receiptDigest !== expectedDigest) {
    throw resolutionError("FORMAL_GATE_TRUSTED_RECEIPT_DIGEST_MISMATCH");
  }
  const evaluatedTime = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedTime)
    || Date.parse(receipt.observedAt) > evaluatedTime
    || Date.parse(receipt.validUntil) < evaluatedTime) {
    throw resolutionError("FORMAL_GATE_TRUSTED_RECEIPT_STALE");
  }
  return Object.freeze({ ...receipt, environmentKinds: Object.freeze([...receipt.environmentKinds]) });
}

function createFormalGateEvidenceResolver({ byteResolver, verifierAdapters } = {}) {
  if (!byteResolver || typeof byteResolver.resolve !== "function") {
    throw resolutionError("FORMAL_GATE_BYTE_RESOLVER_INVALID");
  }
  if (!verifierAdapters || typeof verifierAdapters !== "object" || Array.isArray(verifierAdapters)) {
    throw resolutionError("FORMAL_GATE_VERIFIER_ADAPTERS_INVALID");
  }

  function resolveClosureEvidence({ policy, evidence, releaseTarget, evaluatedAt }) {
    const resolved = byteResolver.resolve({
      evidencePath: evidence.evidencePath,
      expectedSha256: evidence.sha256,
      expectedEvidenceKind: policy.closureEvidenceKind,
    });
    const adapter = verifierAdapters[policy.closureEvidenceKind];
    if (!adapter || typeof adapter.verify !== "function") {
      throw resolutionError("FORMAL_GATE_TRUSTED_ADAPTER_MISSING");
    }
    const rawReceipt = adapter.verify(Object.freeze({
      evidenceDocument: resolved.parsedDocument,
      evidenceSha256: resolved.sha256,
      releaseTarget,
      environmentKinds: Object.freeze([...policy.requiredEnvironmentKinds]),
      evaluatedAt,
    }));
    const receipt = validateTrustedReceipt(rawReceipt, {
      expectedKind: policy.closureEvidenceKind,
      expectedSha256: resolved.sha256,
      expectedReleaseTarget: releaseTarget,
      expectedEnvironmentKinds: policy.requiredEnvironmentKinds,
      evaluatedAt,
    });
    verifiedReceipts.add(receipt);
    return receipt;
  }

  return Object.freeze({ resolveClosureEvidence });
}

function isVerifiedFormalGateReceipt(value) {
  return verifiedReceipts.has(value);
}

function computeFormalGateTrustedReceiptDigest(fields) {
  return digest(fields);
}

module.exports = {
  RECEIPT_DIGEST_FIELDS,
  RECEIPT_FIELDS,
  computeFormalGateTrustedReceiptDigest,
  createFormalGateEvidenceResolver,
  isVerifiedFormalGateReceipt,
};
