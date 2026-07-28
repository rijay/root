const crypto = require("node:crypto");
const { isVerifiedFormalGateReceipt } = require("./formalGateEvidenceResolver");

const MATRIX_KEYS = Object.freeze([
  "schemaVersion",
  "observedAt",
  "releaseTarget",
  "runtimePackageVersion",
  "overallStatus",
  "scope",
  "gates",
  "authorization",
]);
const OPEN_GATE_KEYS = Object.freeze([
  "gateId",
  "status",
  "localImplementation",
  "proved",
  "missing",
  "externalWriteRequired",
  "nextAuthorization",
]);
const CLOSED_GATE_KEYS = Object.freeze([
  "gateId",
  "status",
  "localImplementation",
  "proved",
  "closureEvidence",
  "externalWriteRequired",
]);
const CLOSURE_EVIDENCE_KEYS = Object.freeze([
  "kind",
  "evidencePath",
  "sha256",
  "verificationClass",
  "verifiedAt",
  "environmentKinds",
]);

function readinessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function exactText(value, maximum = 4096) {
  return typeof value === "string" && value.trim() === value
    && value.length >= 1 && value.length <= maximum;
}

function exactIsoInstant(value) {
  return exactText(value, 64)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validateContract(contract) {
  if (!contract || contract.schemaVersion !== "myroot.formal-launch-readiness-contract.v1"
    || contract.releaseTarget !== "v1.0.0"
    || contract.runtimePackageVersion !== "0.5.13"
    || contract.classification !== "READINESS_ONLY_NON_AUTHORIZING"
    || contract.modulePath !== "backend/src/formalLaunchReadinessRegistry.js"
    || contract.evidenceByteResolverPath !== "backend/src/formalEvidenceByteResolver.js"
    || contract.gateEvidenceResolverPath !== "backend/src/formalGateEvidenceResolver.js"
    || contract.validatorPath !== "scripts/validate-formal-launch-readiness.js"
    || contract.testPath !== "backend/tests/formal_launch_readiness_registry.test.js"
    || !/^docs\/evidence\/v1\.0\.0\/[a-z0-9_.-]+\.json$/.test(contract.matrixPath || "")
    || contract.matrixSchemaVersion !== "myroot.formal-launch-gate-readiness-matrix.v1"
    || contract.matrixScope !== "READ_ONLY_EXTERNAL_STATE_AND_LOCAL_IMPLEMENTATION_EVIDENCE"
    || contract.openOverallStatus !== "NOT_READY_FORMAL_LAUNCH_GATES_OPEN"
    || contract.readyOverallStatus !== "READY_FOR_SEPARATE_FORMAL_LAUNCH_DECISION"
    || contract.closedGateStatus !== "CLOSED_BY_SEALED_EVIDENCE"
    || !Array.isArray(contract.gates) || contract.gates.length !== 14
    || new Set(contract.gates.map((gate) => gate.gateId)).size !== 14
    || !exactKeys(contract.authorizationExact, [
      "candidateConnectionAuthorized",
      "productionConnectionAuthorized",
      "remoteWriteAuthorized",
      "deploymentAuthorized",
      "realSendAuthorized",
      "formalLaunchAuthorized",
    ])
    || Object.values(contract.authorizationExact).some((value) => value !== false)) {
    throw readinessError("FORMAL_LAUNCH_READINESS_CONTRACT_INVALID");
  }
  for (const gate of contract.gates) {
    if (!exactText(gate.gateId, 64) || !/^OPEN(?:_HARD_BLOCKER)?$/.test(gate.openStatus || "")
      || typeof gate.externalWriteRequiredWhileOpen !== "boolean"
      || !/^[A-Z0-9_]{3,96}$/.test(gate.closureEvidenceKind || "")
      || !Array.isArray(gate.requiredEnvironmentKinds)
      || gate.requiredEnvironmentKinds.length < 1
      || new Set(gate.requiredEnvironmentKinds).size !== gate.requiredEnvironmentKinds.length
      || gate.requiredEnvironmentKinds.some((kind) =>
        !["RELEASE", "REMOTE_REPOSITORY", "CANDIDATE", "PRODUCTION"].includes(kind))) {
      throw readinessError("FORMAL_LAUNCH_READINESS_GATE_POLICY_INVALID");
    }
  }
  return contract;
}

function validateOpenGate(gate, policy) {
  if (!exactKeys(gate, OPEN_GATE_KEYS)
    || gate.status !== policy.openStatus
    || gate.externalWriteRequired !== policy.externalWriteRequiredWhileOpen
    || !exactText(gate.localImplementation)
    || !exactText(gate.proved)
    || !exactText(gate.missing)
    || !exactText(gate.nextAuthorization)
    || /\b(?:TODO|TBD|PLACEHOLDER)\b/i.test(stableJson(gate))) {
    throw readinessError("FORMAL_LAUNCH_READINESS_OPEN_GATE_INVALID");
  }
}

function validateClosedGate(gate, policy, closedStatus, {
  evidenceResolver,
  releaseTarget,
  evaluatedAt,
}) {
  const evidence = gate.closureEvidence;
  if (!exactKeys(gate, CLOSED_GATE_KEYS)
    || gate.status !== closedStatus
    || gate.externalWriteRequired !== false
    || !exactText(gate.localImplementation)
    || !exactText(gate.proved)
    || !exactKeys(evidence, CLOSURE_EVIDENCE_KEYS)
    || evidence.kind !== policy.closureEvidenceKind
    || !/^docs\/evidence\/v1\.0\.0\/[a-z0-9_.-]+\.json$/.test(evidence.evidencePath || "")
    || !/^[0-9a-f]{64}$/.test(evidence.sha256 || "")
    || evidence.verificationClass !== "CONTROLLED_EXTERNAL_READBACK"
    || !exactIsoInstant(evidence.verifiedAt)
    || JSON.stringify(evidence.environmentKinds) !== JSON.stringify(policy.requiredEnvironmentKinds)) {
    throw readinessError("FORMAL_LAUNCH_READINESS_CLOSED_GATE_INVALID");
  }
  if (!evidenceResolver || typeof evidenceResolver.resolveClosureEvidence !== "function") {
    throw readinessError("FORMAL_LAUNCH_READINESS_EVIDENCE_RESOLVER_REQUIRED");
  }
  const receipt = evidenceResolver.resolveClosureEvidence({
    policy,
    evidence,
    releaseTarget,
    evaluatedAt,
  });
  if (!isVerifiedFormalGateReceipt(receipt)) {
    throw readinessError("FORMAL_LAUNCH_READINESS_EVIDENCE_UNVERIFIED");
  }
}

function validateFormalLaunchReadiness({ contract: inputContract, matrix, evidenceResolver }) {
  const contract = validateContract(inputContract);
  if (!exactKeys(matrix, MATRIX_KEYS)
    || matrix.schemaVersion !== contract.matrixSchemaVersion
    || matrix.releaseTarget !== contract.releaseTarget
    || matrix.runtimePackageVersion !== contract.runtimePackageVersion
    || matrix.scope !== contract.matrixScope
    || !exactIsoInstant(matrix.observedAt)
    || !Array.isArray(matrix.gates)
    || matrix.gates.length !== contract.gates.length
    || JSON.stringify(matrix.authorization) !== JSON.stringify(contract.authorizationExact)) {
    throw readinessError("FORMAL_LAUNCH_READINESS_MATRIX_INVALID");
  }
  let openGateCount = 0;
  let hardBlockerCount = 0;
  let closedGateCount = 0;
  matrix.gates.forEach((gate, index) => {
    const policy = contract.gates[index];
    if (!gate || gate.gateId !== policy.gateId) {
      throw readinessError("FORMAL_LAUNCH_READINESS_GATE_SET_INVALID");
    }
    if (gate.status === contract.closedGateStatus) {
      validateClosedGate(gate, policy, contract.closedGateStatus, {
        evidenceResolver,
        releaseTarget: contract.releaseTarget,
        evaluatedAt: matrix.observedAt,
      });
      closedGateCount += 1;
    } else {
      validateOpenGate(gate, policy);
      openGateCount += 1;
      if (gate.status === "OPEN_HARD_BLOCKER") hardBlockerCount += 1;
    }
  });
  const expectedOverall = openGateCount === 0
    ? contract.readyOverallStatus
    : contract.openOverallStatus;
  if (matrix.overallStatus !== expectedOverall) {
    throw readinessError("FORMAL_LAUNCH_READINESS_OVERALL_STATUS_INVALID");
  }
  return Object.freeze({
    status: openGateCount === 0 ? "READY_FOR_SEPARATE_FORMAL_LAUNCH_DECISION" : "NOT_READY",
    gateCount: matrix.gates.length,
    openGateCount,
    hardBlockerCount,
    closedGateCount,
    formalLaunchAuthorized: false,
    matrixDigest: sha256(Buffer.from(stableJson(matrix))),
  });
}

module.exports = {
  validateFormalLaunchReadiness,
};
