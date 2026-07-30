#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = "contracts/artifact-provenance/v1.0.0.json";
const CONTRACT_STATUS = "NON_RUNTIME_LOCAL_PROVENANCE_FOUNDATION";
const CANONICALIZATION_VERSION = "MYROOT_CANONICAL_JSON_V1";
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OUTPUT_NAME_PATTERN = /^myroot-candidate-provenance(?:-[A-Za-z0-9._-]+)?$/;
const REQUIRED_MODULE_IDS = Object.freeze([
  "ADMIN",
  "BACKEND",
  "CLOUD_FUNCTION",
  "CONTENT",
  "MIGRATION",
  "MINIPROGRAM",
  "ROUTE_REGISTRY",
]);
const MODULE_SOURCE_POLICIES = Object.freeze([
  Object.freeze({ moduleId: "ADMIN", includePrefixes: Object.freeze(["admin/"]), includeFiles: Object.freeze([]) }),
  Object.freeze({
    moduleId: "BACKEND",
    includePrefixes: Object.freeze(["backend/", "contracts/"]),
    includeFiles: Object.freeze([]),
  }),
  Object.freeze({
    moduleId: "CLOUD_FUNCTION",
    includePrefixes: Object.freeze(["cloudfunctions/"]),
    includeFiles: Object.freeze(["cloudbaserc.json"]),
  }),
  Object.freeze({
    moduleId: "CONTENT",
    includePrefixes: Object.freeze([]),
    includeFiles: Object.freeze([
      "docs/design.md",
      "docs/v1.0.0_gate_and_document_authority_decision_2026-07-15.md",
      "docs/v1.0.0_product_requirements.md",
    ]),
  }),
  Object.freeze({
    moduleId: "MIGRATION",
    includePrefixes: Object.freeze(["backend/db/migrations/"]),
    includeFiles: Object.freeze(["backend/db/schema.sql"]),
  }),
  Object.freeze({ moduleId: "MINIPROGRAM", includePrefixes: Object.freeze(["miniprogram/"]), includeFiles: Object.freeze([]) }),
  Object.freeze({
    moduleId: "ROUTE_REGISTRY",
    includePrefixes: Object.freeze(["contracts/route-registry/"]),
    includeFiles: Object.freeze([
      "scripts/lib/route-registry.js",
      "scripts/route-registry-v1.test.js",
      "scripts/validate-v1-route-registry.js",
    ]),
  }),
]);
const GOVERNANCE_SOURCE_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "contracts/artifact-provenance/v1.0.0.json",
  "contracts/baseline-signoff/v1.0.0.json",
  "contracts/formal-launch-readiness/v1.0.0.json",
  "contracts/platform-control-evidence/v1.0.0.json",
  "contracts/required-checks/v1.0.0.json",
  "contracts/release-evidence/v1.0.0.json",
  "package.json",
  "scripts/build-candidate-provenance.js",
  "scripts/final-verification.js",
  "scripts/validate-formal-launch-readiness.js",
]);
const ARCHIVE_POLICY = Object.freeze({
  format: "USTAR_FIXED_V1",
  pathPrefix: "source/",
  mtimeSeconds: 0,
  uid: 0,
  gid: 0,
  fileMode: 420,
  executableMode: 493,
  terminalZeroBlockCount: 2,
});
const LIMITS = Object.freeze({
  maximumFileCount: 10000,
  maximumFileBytes: 20971520,
  maximumArchiveBytes: 262144000,
});
const PAYLOAD_FIELDS = Object.freeze([
  "schemaVersion",
  "contractStatus",
  "digestCanonicalizationVersion",
  "sourceCommit",
  "sourceSet",
  "artifactDigestByModule",
  "sourceArchive",
  "governanceDigestSet",
]);
const SOURCE_SET_FIELDS = Object.freeze(["fileCount", "totalBytes", "manifestSha256"]);
const MODULE_FIELDS = Object.freeze([
  "moduleId",
  "artifactKind",
  "fileCount",
  "totalBytes",
  "artifactDigest",
]);
const ARCHIVE_FIELDS = Object.freeze(["format", "fileName", "bytes", "entryCount", "sha256"]);
const GOVERNANCE_REF_FIELDS = Object.freeze(["refId", "path", "sha256"]);
const BUILDER_ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion",
  "contractStatus",
  "payloadFile",
  "payloadDigest",
  "sourceArchiveFile",
  "sourceArchiveSha256",
  "builder",
  "governance",
  "authorization",
]);
const BUILDER_FIELDS = Object.freeze([
  "provider",
  "repositoryRef",
  "workflowRef",
  "runRef",
  "eventName",
]);
const GOVERNANCE_FIELDS = Object.freeze([
  "expectedRequiredCheckName",
  "requiredCheckStatus",
  "actionPinningStatus",
  "mutableActionRefs",
  "oidcAttestationStatus",
  "attestationPermissionsGranted",
  "remoteArtifactReadbackStatus",
]);
const PINNED_ACTION_REFS = Object.freeze([
  "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
]);
const AUTHORIZATION = Object.freeze({
  runtimeAuthorized: false,
  candidateCreationAuthorized: false,
  deploymentAuthorized: false,
  attestationAuthorized: false,
  gateClosureAuthorized: false,
});
const FORBIDDEN_FILE_PATTERN = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]+\.(?:log|pem|p12|pfx|key|sqlite(?:-[^/]*)?))$/i;

function provenanceError(code, message = "Candidate source provenance rejected the input") {
  const error = new Error(message);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw provenanceError("CANDIDATE_PROVENANCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw provenanceError("CANDIDATE_PROVENANCE_CANONICALIZATION_REJECTED");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw provenanceError("CANDIDATE_PROVENANCE_CANONICALIZATION_REJECTED");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    if (!plainRecord(value)) {
      throw provenanceError("CANDIDATE_PROVENANCE_CANONICALIZATION_REJECTED");
    }
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function safeText(value, maximumLength = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && value === value.normalize("NFC")
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeOuterRef(value, maximumLength = 320) {
  return safeText(value, maximumLength)
    && /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/.test(value);
}

function sha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function safeRepositoryPath(value) {
  if (!safeText(value, 512) || value.startsWith("/") || value.includes("\\")) return false;
  if (path.posix.normalize(value) !== value) return false;
  if (value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return false;
  }
  return !FORBIDDEN_FILE_PATTERN.test(value);
}

function git(repositoryRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8") : String(result.stderr || "");
    throw provenanceError(
      "CANDIDATE_PROVENANCE_GIT_FAILED",
      stderr.trim() || `git ${args[0]} exited with ${result.status}`
    );
  }
  return result.stdout;
}

function resolveSourceCommit(repositoryRoot, sourceCommit) {
  const requested = String(sourceCommit || "").trim().toLowerCase();
  if (!SOURCE_COMMIT_PATTERN.test(requested)) {
    throw provenanceError("CANDIDATE_PROVENANCE_SOURCE_COMMIT_INVALID");
  }
  const resolved = String(git(repositoryRoot, ["rev-parse", "--verify", `${requested}^{commit}`]))
    .trim().toLowerCase();
  if (resolved !== requested) {
    throw provenanceError("CANDIDATE_PROVENANCE_SOURCE_COMMIT_MISMATCH");
  }
  return resolved;
}

function readTree(repositoryRoot, sourceCommit) {
  const raw = git(
    repositoryRoot,
    ["ls-tree", "-r", "-z", "--full-tree", sourceCommit],
    { encoding: null }
  );
  const entries = new Map();
  for (const recordBuffer of raw.subarray(0, Math.max(0, raw.length - 1)).toString("utf8").split("\0")) {
    if (!recordBuffer) continue;
    const separator = recordBuffer.indexOf("\t");
    if (separator <= 0) throw provenanceError("CANDIDATE_PROVENANCE_TREE_INVALID");
    const metadata = recordBuffer.slice(0, separator).split(" ");
    const relativePath = recordBuffer.slice(separator + 1);
    if (metadata.length !== 3 || !safeRepositoryPath(relativePath) || entries.has(relativePath)) {
      throw provenanceError("CANDIDATE_PROVENANCE_TREE_INVALID");
    }
    const [mode, type, objectId] = metadata;
    if (!/^(?:100644|100755|120000)$/.test(mode)
      || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(objectId)) {
      throw provenanceError("CANDIDATE_PROVENANCE_TREE_INVALID");
    }
    entries.set(relativePath, { mode, type, objectId, path: relativePath });
  }
  return entries;
}

function readBlob(repositoryRoot, entry, maximumFileBytes) {
  if (entry.type !== "blob" || entry.mode === "120000") {
    throw provenanceError("CANDIDATE_PROVENANCE_UNSUPPORTED_TREE_ENTRY");
  }
  const value = git(repositoryRoot, ["cat-file", "blob", entry.objectId], {
    encoding: null,
    maxBuffer: maximumFileBytes + 1024,
  });
  if (value.length > maximumFileBytes) {
    throw provenanceError("CANDIDATE_PROVENANCE_FILE_LIMIT_EXCEEDED");
  }
  return value;
}

function policyMatches(relativePath, policy) {
  return policy.includeFiles.includes(relativePath)
    || policy.includePrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function rowView(entry) {
  return {
    path: entry.path,
    mode: entry.mode,
    bytes: entry.data.length,
    sha256: sha256Buffer(entry.data),
  };
}

function splitTarPath(relativePath) {
  if (Buffer.byteLength(relativePath) <= 100) return { name: relativePath, prefix: "" };
  const separators = [];
  for (let index = 0; index < relativePath.length; index += 1) {
    if (relativePath[index] === "/") separators.push(index);
  }
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const prefix = relativePath.slice(0, separators[index]);
    const name = relativePath.slice(separators[index] + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw provenanceError("CANDIDATE_PROVENANCE_TAR_PATH_TOO_LONG");
}

function writeTarText(header, offset, length, value) {
  const bytes = Buffer.from(String(value), "utf8");
  if (bytes.length > length) throw provenanceError("CANDIDATE_PROVENANCE_TAR_FIELD_TOO_LONG");
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const text = Number(value).toString(8).padStart(length - 1, "0");
  if (text.length >= length) throw provenanceError("CANDIDATE_PROVENANCE_TAR_FIELD_TOO_LONG");
  writeTarText(header, offset, length, `${text}\0`);
}

function tarHeader(entry, archivePolicy) {
  const archivePath = `${archivePolicy.pathPrefix}${entry.path}`;
  const { name, prefix } = splitTarPath(archivePath);
  const header = Buffer.alloc(512, 0);
  writeTarText(header, 0, 100, name);
  writeTarOctal(
    header,
    100,
    8,
    entry.mode === "100755" ? archivePolicy.executableMode : archivePolicy.fileMode
  );
  writeTarOctal(header, 108, 8, archivePolicy.uid);
  writeTarOctal(header, 116, 8, archivePolicy.gid);
  writeTarOctal(header, 124, 12, entry.data.length);
  writeTarOctal(header, 136, 12, archivePolicy.mtimeSeconds);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeTarText(header, 257, 6, "ustar\0");
  writeTarText(header, 263, 2, "00");
  writeTarText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function buildTar(entries, archivePolicy, limits) {
  const chunks = [];
  let bytes = 0;
  for (const entry of entries) {
    const header = tarHeader(entry, archivePolicy);
    const padding = Buffer.alloc((512 - (entry.data.length % 512)) % 512, 0);
    chunks.push(header, entry.data, padding);
    bytes += header.length + entry.data.length + padding.length;
    if (bytes > limits.maximumArchiveBytes) {
      throw provenanceError("CANDIDATE_PROVENANCE_ARCHIVE_LIMIT_EXCEEDED");
    }
  }
  const terminal = Buffer.alloc(512 * archivePolicy.terminalZeroBlockCount, 0);
  if (bytes + terminal.length > limits.maximumArchiveBytes) {
    throw provenanceError("CANDIDATE_PROVENANCE_ARCHIVE_LIMIT_EXCEEDED");
  }
  chunks.push(terminal);
  return Buffer.concat(chunks);
}

function validateContract(contract) {
  if (!exactKeys(contract, [
    "schemaVersion",
    "contractVersion",
    "scope",
    "digestAlgorithm",
    "canonicalization",
    "requiredArtifactModuleIds",
    "moduleSourcePolicies",
    "overlapPolicy",
    "governanceSourcePaths",
    "archive",
    "limits",
    "payloadSchema",
    "builderEnvelopeSchema",
    "actionPolicy",
    "remoteClosureRequirements",
    "authorization",
  ])
    || contract.schemaVersion !== 1
    || contract.contractVersion !== "1.0.0"
    || contract.scope !== CONTRACT_STATUS
    || contract.digestAlgorithm !== "SHA-256"
    || !exactKeys(contract.canonicalization, [
      "version",
      "unicodeNormalization",
      "objectKeyOrdering",
      "numberEncoding",
      "arrayOrdering",
      "undefinedPolicy",
      "digestDomainSeparation",
    ])
    || contract.canonicalization.version !== CANONICALIZATION_VERSION
    || contract.canonicalization.unicodeNormalization !== "NFC_REQUIRED"
    || contract.canonicalization.objectKeyOrdering !== "UTF16_CODE_UNIT_ASCENDING"
    || contract.canonicalization.numberEncoding !== "SAFE_INTEGER_JSON"
    || contract.canonicalization.arrayOrdering !== "SCHEMA_DEFINED_DETERMINISTIC"
    || contract.canonicalization.undefinedPolicy !== "REJECT"
    || contract.canonicalization.digestDomainSeparation !== "ARTIFACT_PROVENANCE_V1"
    || !sameArray(contract.requiredArtifactModuleIds, REQUIRED_MODULE_IDS)
    || canonicalJson(contract.moduleSourcePolicies) !== canonicalJson(MODULE_SOURCE_POLICIES)
    || contract.overlapPolicy !== "ALLOWED_AND_DOMAIN_SEPARATED"
    || !sameArray(contract.governanceSourcePaths, GOVERNANCE_SOURCE_PATHS)
    || canonicalJson(contract.archive) !== canonicalJson(ARCHIVE_POLICY)
    || canonicalJson(contract.limits) !== canonicalJson(LIMITS)
    || !exactKeys(contract.payloadSchema, [
      "exactFields",
      "sourceSetExactFields",
      "moduleExactFields",
      "archiveExactFields",
      "governanceRefExactFields",
    ])
    || !sameArray(contract.payloadSchema.exactFields, PAYLOAD_FIELDS)
    || !sameArray(contract.payloadSchema.sourceSetExactFields, SOURCE_SET_FIELDS)
    || !sameArray(contract.payloadSchema.moduleExactFields, MODULE_FIELDS)
    || !sameArray(contract.payloadSchema.archiveExactFields, ARCHIVE_FIELDS)
    || !sameArray(contract.payloadSchema.governanceRefExactFields, GOVERNANCE_REF_FIELDS)
    || !exactKeys(contract.builderEnvelopeSchema, [
      "exactFields",
      "builderExactFields",
      "governanceExactFields",
    ])
    || !sameArray(contract.builderEnvelopeSchema.exactFields, BUILDER_ENVELOPE_FIELDS)
    || !sameArray(contract.builderEnvelopeSchema.builderExactFields, BUILDER_FIELDS)
    || !sameArray(contract.builderEnvelopeSchema.governanceExactFields, GOVERNANCE_FIELDS)
    || !exactKeys(contract.actionPolicy, [
      "immutableShaRequiredForClosure",
      "status",
      "locallyVerifiedImmutableActionRefs",
      "mutableActionRefs",
    ])
    || contract.actionPolicy.immutableShaRequiredForClosure !== true
    || contract.actionPolicy.status
      !== "IMMUTABLE_ACTION_SHAS_VERIFIED_FROM_OFFICIAL_GITHUB_TAG_REFS_2026_07_17"
    || !sameArray(contract.actionPolicy.locallyVerifiedImmutableActionRefs, PINNED_ACTION_REFS)
    || !sameArray(contract.actionPolicy.mutableActionRefs, [])
    || !exactKeys(contract.remoteClosureRequirements, [
      "evidenceClass",
      "expectedRequiredCheckName",
      "requiredCheckProtectionProofRequired",
      "remoteArtifactReadbackRequired",
      "oidcAttestationRequiresExplicitAuthorization",
      "requiredAttestationPermissions",
    ])
    || contract.remoteClosureRequirements.evidenceClass !== "SOURCE_PROVENANCE_ONLY"
    || contract.remoteClosureRequirements.expectedRequiredCheckName !== "Source provenance only"
    || contract.remoteClosureRequirements.requiredCheckProtectionProofRequired !== true
    || contract.remoteClosureRequirements.remoteArtifactReadbackRequired !== true
    || contract.remoteClosureRequirements.oidcAttestationRequiresExplicitAuthorization !== true
    || !sameArray(
      contract.remoteClosureRequirements.requiredAttestationPermissions,
      ["attestations:write", "id-token:write"]
    )
    || canonicalJson(contract.authorization) !== canonicalJson(AUTHORIZATION)) {
    throw provenanceError("CANDIDATE_PROVENANCE_CONTRACT_INVALID");
  }
  canonicalJson(contract);
  return clone(contract);
}

function governanceRefId(relativePath) {
  const mapping = {
    ".github/workflows/ci.yml": "CI_WORKFLOW",
    "contracts/artifact-provenance/v1.0.0.json": "ARTIFACT_PROVENANCE_CONTRACT",
    "contracts/baseline-signoff/v1.0.0.json": "BASELINE_SIGNOFF_CONTRACT",
    "contracts/formal-launch-readiness/v1.0.0.json": "FORMAL_LAUNCH_READINESS_CONTRACT",
    "contracts/platform-control-evidence/v1.0.0.json": "PLATFORM_CONTROL_EVIDENCE_CONTRACT",
    "contracts/required-checks/v1.0.0.json": "REQUIRED_CHECKS_CONTRACT",
    "contracts/release-evidence/v1.0.0.json": "RELEASE_EVIDENCE_CONTRACT",
    "package.json": "ROOT_PACKAGE_MANIFEST",
    "scripts/build-candidate-provenance.js": "PROVENANCE_BUILDER",
    "scripts/final-verification.js": "FINAL_VERIFICATION_GATE",
    "scripts/validate-formal-launch-readiness.js": "FORMAL_LAUNCH_READINESS_VALIDATOR",
  };
  const refId = mapping[relativePath];
  if (!refId) throw provenanceError("CANDIDATE_PROVENANCE_GOVERNANCE_REF_UNKNOWN");
  return refId;
}

function loadSourceModel(repositoryRoot, requestedCommit) {
  const sourceCommit = resolveSourceCommit(repositoryRoot, requestedCommit);
  const tree = readTree(repositoryRoot, sourceCommit);
  const contractEntry = tree.get(CONTRACT_PATH);
  if (!contractEntry) throw provenanceError("CANDIDATE_PROVENANCE_CONTRACT_MISSING");
  const contractBytes = readBlob(repositoryRoot, contractEntry, LIMITS.maximumFileBytes);
  let contract;
  try {
    contract = validateContract(JSON.parse(contractBytes.toString("utf8")));
  } catch (error) {
    if (error && error.code) throw error;
    throw provenanceError("CANDIDATE_PROVENANCE_CONTRACT_INVALID");
  }

  const selectedPaths = new Set(contract.governanceSourcePaths);
  const modulePaths = new Map();
  for (const policy of contract.moduleSourcePolicies) {
    const paths = [...tree.keys()].filter((relativePath) => policyMatches(relativePath, policy)).sort();
    if (paths.length === 0) {
      throw provenanceError("CANDIDATE_PROVENANCE_REQUIRED_MODULE_EMPTY", policy.moduleId);
    }
    modulePaths.set(policy.moduleId, paths);
    paths.forEach((relativePath) => selectedPaths.add(relativePath));
  }
  for (const relativePath of contract.governanceSourcePaths) {
    if (!tree.has(relativePath)) {
      throw provenanceError("CANDIDATE_PROVENANCE_GOVERNANCE_SOURCE_MISSING", relativePath);
    }
  }
  const paths = [...selectedPaths].sort();
  if (paths.length > contract.limits.maximumFileCount) {
    throw provenanceError("CANDIDATE_PROVENANCE_FILE_LIMIT_EXCEEDED");
  }
  const entries = paths.map((relativePath) => {
    const treeEntry = tree.get(relativePath);
    if (!treeEntry) throw provenanceError("CANDIDATE_PROVENANCE_SOURCE_MISSING");
    return {
      ...treeEntry,
      data: readBlob(repositoryRoot, treeEntry, contract.limits.maximumFileBytes),
    };
  });
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  return { contract, contractBytes, entries, entriesByPath, modulePaths, sourceCommit };
}

function deriveDeterministicProvenance(repositoryRoot, requestedCommit) {
  const model = loadSourceModel(repositoryRoot, requestedCommit);
  const rows = model.entries.map(rowView);
  const sourceArchiveBuffer = buildTar(model.entries, model.contract.archive, model.contract.limits);
  const artifactDigestByModule = model.contract.requiredArtifactModuleIds.map((moduleId) => {
    const moduleRows = model.modulePaths.get(moduleId).map((relativePath) => (
      rowView(model.entriesByPath.get(relativePath))
    ));
    return {
      moduleId,
      artifactKind: "DETERMINISTIC_SOURCE_MODULE_V1",
      fileCount: moduleRows.length,
      totalBytes: moduleRows.reduce((total, row) => total + row.bytes, 0),
      artifactDigest: digest(`myroot-candidate-source-module:${moduleId}:v1`, moduleRows),
    };
  });
  const governanceDigestSet = model.contract.governanceSourcePaths.map((relativePath) => ({
    refId: governanceRefId(relativePath),
    path: relativePath,
    sha256: sha256Buffer(model.entriesByPath.get(relativePath).data),
  })).sort((left, right) => (
    left.refId < right.refId ? -1 : left.refId > right.refId ? 1 : 0
  ));
  const payload = {
    schemaVersion: 1,
    contractStatus: CONTRACT_STATUS,
    digestCanonicalizationVersion: CANONICALIZATION_VERSION,
    sourceCommit: model.sourceCommit,
    sourceSet: {
      fileCount: rows.length,
      totalBytes: rows.reduce((total, row) => total + row.bytes, 0),
      manifestSha256: digest("myroot-candidate-source-set:v1", rows),
    },
    artifactDigestByModule,
    sourceArchive: {
      format: model.contract.archive.format,
      fileName: "candidate-source.tar",
      bytes: sourceArchiveBuffer.length,
      entryCount: rows.length,
      sha256: sha256Buffer(sourceArchiveBuffer),
    },
    governanceDigestSet,
  };
  return {
    contract: model.contract,
    payload,
    payloadDigest: digest("myroot-candidate-provenance-payload:v1", payload),
    sourceArchiveBuffer,
  };
}

function normalizeBuilderContext(input = {}) {
  const builder = {
    provider: String(input.provider || "LOCAL").trim(),
    repositoryRef: String(input.repositoryRef || "local/unbound").trim(),
    workflowRef: String(input.workflowRef || "local:unbound").trim(),
    runRef: String(input.runRef || "local:unbound").trim(),
    eventName: String(input.eventName || "local").trim(),
  };
  if (!exactKeys(builder, BUILDER_FIELDS)
    || !["GITHUB_ACTIONS", "LOCAL"].includes(builder.provider)
    || !safeOuterRef(builder.repositoryRef)
    || !safeOuterRef(builder.workflowRef)
    || !safeOuterRef(builder.runRef)
    || !safeOuterRef(builder.eventName, 64)) {
    throw provenanceError("CANDIDATE_PROVENANCE_BUILDER_CONTEXT_INVALID");
  }
  return builder;
}

function builderEnvelopeFor(deterministic, builderInput) {
  return {
    schemaVersion: 1,
    contractStatus: CONTRACT_STATUS,
    payloadFile: "candidate-provenance.payload.json",
    payloadDigest: deterministic.payloadDigest,
    sourceArchiveFile: deterministic.payload.sourceArchive.fileName,
    sourceArchiveSha256: deterministic.payload.sourceArchive.sha256,
    builder: normalizeBuilderContext(builderInput),
    governance: {
      expectedRequiredCheckName:
        deterministic.contract.remoteClosureRequirements.expectedRequiredCheckName,
      requiredCheckStatus: "REMOTE_CONFIGURATION_REQUIRED",
      actionPinningStatus: deterministic.contract.actionPolicy.status,
      mutableActionRefs: clone(deterministic.contract.actionPolicy.mutableActionRefs),
      oidcAttestationStatus: "REMOTE_ONLY_NOT_AUTHORIZED",
      attestationPermissionsGranted: false,
      remoteArtifactReadbackStatus: "PENDING",
    },
    authorization: clone(deterministic.contract.authorization),
  };
}

function assertOutputDirectory(repositoryRoot, outputDirectory) {
  const resolved = path.resolve(String(outputDirectory || ""));
  const relative = path.relative(path.resolve(repositoryRoot), resolved);
  if (!OUTPUT_NAME_PATTERN.test(path.basename(resolved))
    || relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw provenanceError("CANDIDATE_PROVENANCE_OUTPUT_PATH_INVALID");
  }
  if (fs.existsSync(resolved)) {
    if (!fs.statSync(resolved).isDirectory() || fs.readdirSync(resolved).length > 0) {
      throw provenanceError("CANDIDATE_PROVENANCE_OUTPUT_NOT_EMPTY");
    }
  } else {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  return resolved;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function buildCandidateProvenance(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const outputDirectory = assertOutputDirectory(repositoryRoot, options.outputDirectory);
  const deterministic = deriveDeterministicProvenance(repositoryRoot, options.sourceCommit);
  const builderEnvelope = builderEnvelopeFor(deterministic, options.builder);
  const payloadPath = path.join(outputDirectory, builderEnvelope.payloadFile);
  const archivePath = path.join(outputDirectory, builderEnvelope.sourceArchiveFile);
  const builderEnvelopePath = path.join(outputDirectory, "candidate-provenance.builder.json");
  writeJson(payloadPath, deterministic.payload);
  fs.writeFileSync(archivePath, deterministic.sourceArchiveBuffer, { mode: 0o600 });
  writeJson(builderEnvelopePath, builderEnvelope);
  return {
    contractStatus: CONTRACT_STATUS,
    sourceCommit: deterministic.payload.sourceCommit,
    payloadDigest: deterministic.payloadDigest,
    sourceArchiveSha256: deterministic.payload.sourceArchive.sha256,
    builderEnvelopeDigest: digest("myroot-candidate-provenance-builder-envelope:v1", builderEnvelope),
    outputFiles: [
      path.basename(payloadPath),
      path.basename(archivePath),
      path.basename(builderEnvelopePath),
    ],
  };
}

function validatePayloadShape(payload, contract) {
  if (!exactKeys(payload, PAYLOAD_FIELDS)
    || payload.schemaVersion !== 1
    || payload.contractStatus !== CONTRACT_STATUS
    || payload.digestCanonicalizationVersion !== CANONICALIZATION_VERSION
    || !SOURCE_COMMIT_PATTERN.test(payload.sourceCommit)
    || !exactKeys(payload.sourceSet, SOURCE_SET_FIELDS)
    || !Number.isSafeInteger(payload.sourceSet.fileCount) || payload.sourceSet.fileCount <= 0
    || !Number.isSafeInteger(payload.sourceSet.totalBytes) || payload.sourceSet.totalBytes < 0
    || !sha256(payload.sourceSet.manifestSha256)
    || !Array.isArray(payload.artifactDigestByModule)
    || payload.artifactDigestByModule.length !== REQUIRED_MODULE_IDS.length
    || !exactKeys(payload.sourceArchive, ARCHIVE_FIELDS)
    || payload.sourceArchive.format !== contract.archive.format
    || payload.sourceArchive.fileName !== "candidate-source.tar"
    || !Number.isSafeInteger(payload.sourceArchive.bytes) || payload.sourceArchive.bytes <= 0
    || !Number.isSafeInteger(payload.sourceArchive.entryCount)
    || !sha256(payload.sourceArchive.sha256)
    || !Array.isArray(payload.governanceDigestSet)
    || payload.governanceDigestSet.length !== GOVERNANCE_SOURCE_PATHS.length) {
    throw provenanceError("CANDIDATE_PROVENANCE_PAYLOAD_INVALID");
  }
  payload.artifactDigestByModule.forEach((entry, index) => {
    if (!exactKeys(entry, MODULE_FIELDS)
      || entry.moduleId !== REQUIRED_MODULE_IDS[index]
      || entry.artifactKind !== "DETERMINISTIC_SOURCE_MODULE_V1"
      || !Number.isSafeInteger(entry.fileCount) || entry.fileCount <= 0
      || !Number.isSafeInteger(entry.totalBytes) || entry.totalBytes < 0
      || !sha256(entry.artifactDigest)) {
      throw provenanceError("CANDIDATE_PROVENANCE_PAYLOAD_INVALID");
    }
  });
  payload.governanceDigestSet.forEach((entry) => {
    if (!exactKeys(entry, GOVERNANCE_REF_FIELDS)
      || !safeOuterRef(entry.refId, 64)
      || !safeRepositoryPath(entry.path)
      || !sha256(entry.sha256)) {
      throw provenanceError("CANDIDATE_PROVENANCE_PAYLOAD_INVALID");
    }
  });
}

function validateBuilderEnvelope(envelope, contract) {
  if (!exactKeys(envelope, BUILDER_ENVELOPE_FIELDS)
    || envelope.schemaVersion !== 1
    || envelope.contractStatus !== CONTRACT_STATUS
    || envelope.payloadFile !== "candidate-provenance.payload.json"
    || !sha256(envelope.payloadDigest)
    || envelope.sourceArchiveFile !== "candidate-source.tar"
    || !sha256(envelope.sourceArchiveSha256)
    || !exactKeys(envelope.builder, BUILDER_FIELDS)
    || !["GITHUB_ACTIONS", "LOCAL"].includes(envelope.builder.provider)
    || !safeOuterRef(envelope.builder.repositoryRef)
    || !safeOuterRef(envelope.builder.workflowRef)
    || !safeOuterRef(envelope.builder.runRef)
    || !safeOuterRef(envelope.builder.eventName, 64)
    || !exactKeys(envelope.governance, GOVERNANCE_FIELDS)
    || envelope.governance.expectedRequiredCheckName
      !== contract.remoteClosureRequirements.expectedRequiredCheckName
    || envelope.governance.requiredCheckStatus !== "REMOTE_CONFIGURATION_REQUIRED"
    || envelope.governance.actionPinningStatus !== contract.actionPolicy.status
    || !sameArray(envelope.governance.mutableActionRefs, contract.actionPolicy.mutableActionRefs)
    || envelope.governance.oidcAttestationStatus !== "REMOTE_ONLY_NOT_AUTHORIZED"
    || envelope.governance.attestationPermissionsGranted !== false
    || envelope.governance.remoteArtifactReadbackStatus !== "PENDING"
    || canonicalJson(envelope.authorization) !== canonicalJson(AUTHORIZATION)) {
    throw provenanceError("CANDIDATE_PROVENANCE_BUILDER_ENVELOPE_INVALID");
  }
}

function verifyCandidateProvenance(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const outputDirectory = path.resolve(String(options.outputDirectory || ""));
  const payloadPath = path.join(outputDirectory, "candidate-provenance.payload.json");
  const archivePath = path.join(outputDirectory, "candidate-source.tar");
  const builderEnvelopePath = path.join(outputDirectory, "candidate-provenance.builder.json");
  let payload;
  let builderEnvelope;
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    builderEnvelope = JSON.parse(fs.readFileSync(builderEnvelopePath, "utf8"));
  } catch (error) {
    throw provenanceError("CANDIDATE_PROVENANCE_OUTPUT_INVALID");
  }
  const deterministic = deriveDeterministicProvenance(repositoryRoot, options.sourceCommit);
  validatePayloadShape(payload, deterministic.contract);
  validateBuilderEnvelope(builderEnvelope, deterministic.contract);
  if (canonicalJson(payload) !== canonicalJson(deterministic.payload)) {
    throw provenanceError("CANDIDATE_PROVENANCE_PAYLOAD_MISMATCH");
  }
  const payloadDigest = digest("myroot-candidate-provenance-payload:v1", payload);
  if (payloadDigest !== builderEnvelope.payloadDigest) {
    throw provenanceError("CANDIDATE_PROVENANCE_PAYLOAD_DIGEST_MISMATCH");
  }
  const archive = fs.readFileSync(archivePath);
  const archiveSha256 = sha256Buffer(archive);
  if (!archive.equals(deterministic.sourceArchiveBuffer)
    || archiveSha256 !== payload.sourceArchive.sha256
    || archiveSha256 !== builderEnvelope.sourceArchiveSha256) {
    throw provenanceError("CANDIDATE_PROVENANCE_ARCHIVE_MISMATCH");
  }
  return {
    contractStatus: CONTRACT_STATUS,
    status: "VERIFIED_LOCAL_PROVENANCE_FOUNDATION",
    sourceCommit: payload.sourceCommit,
    payloadDigest,
    sourceArchiveSha256: archiveSha256,
    builderEnvelopeDigest: digest(
      "myroot-candidate-provenance-builder-envelope:v1",
      builderEnvelope
    ),
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    attestationAuthorized: false,
    gateClosureAuthorized: false,
  };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    verify: false,
    builder: {
      provider: env.GITHUB_ACTIONS === "true" ? "GITHUB_ACTIONS" : "LOCAL",
      repositoryRef: env.GITHUB_REPOSITORY || "local/unbound",
      workflowRef: env.GITHUB_WORKFLOW_REF || "local:unbound",
      runRef: env.GITHUB_RUN_ID
        ? `github-actions:run:${env.GITHUB_RUN_ID}:attempt:${env.GITHUB_RUN_ATTEMPT || "1"}`
        : "local:unbound",
      eventName: env.GITHUB_EVENT_NAME || "local",
    },
    sourceCommit: env.GITHUB_SHA || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => argv[++index];
    if (item === "--verify") options.verify = true;
    else if (item === "--repository-root") options.repositoryRoot = next();
    else if (item === "--source-commit") options.sourceCommit = next();
    else if (item === "--output-dir") options.outputDirectory = next();
    else if (item === "--builder-provider") options.builder.provider = next();
    else if (item === "--builder-repository-ref") options.builder.repositoryRef = next();
    else if (item === "--builder-workflow-ref") options.builder.workflowRef = next();
    else if (item === "--builder-run-ref") options.builder.runRef = next();
    else if (item === "--builder-event-name") options.builder.eventName = next();
    else throw provenanceError("CANDIDATE_PROVENANCE_ARGUMENT_INVALID", `Unknown argument: ${item}`);
  }
  if (!options.sourceCommit) {
    throw provenanceError("CANDIDATE_PROVENANCE_ARGUMENT_INVALID", "--source-commit is required");
  }
  if (!options.outputDirectory) {
    throw provenanceError("CANDIDATE_PROVENANCE_ARGUMENT_INVALID", "--output-dir is required");
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs();
    const report = options.verify
      ? verifyCandidateProvenance(options)
      : buildCandidateProvenance(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || "CANDIDATE_PROVENANCE_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCandidateProvenance,
  buildTar,
  canonicalJson,
  deriveDeterministicProvenance,
  parseArgs,
  validateContract,
  verifyCandidateProvenance,
};
