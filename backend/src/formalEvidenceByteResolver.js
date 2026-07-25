const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_PATH_PATTERN = /^docs\/evidence\/v1\.0\.0\/[a-z0-9_.-]+\.json$/;

function resolverError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assertNoSymlinkSegments(root, relativePath) {
  const segments = relativePath.split("/");
  let current = path.resolve(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") throw resolverError("FORMAL_EVIDENCE_FILE_MISSING");
      throw error;
    }
    if (stat.isSymbolicLink()) throw resolverError("FORMAL_EVIDENCE_SYMLINK_REJECTED");
  }
}

function createFormalEvidenceByteResolver({
  repositoryRoot,
  maximumBytes = DEFAULT_MAXIMUM_BYTES,
} = {}) {
  const root = path.resolve(repositoryRoot || path.join(__dirname, "../.."));
  const evidenceRoot = path.join(root, "docs", "evidence", "v1.0.0");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > DEFAULT_MAXIMUM_BYTES) {
    throw resolverError("FORMAL_EVIDENCE_SIZE_POLICY_INVALID");
  }

  function resolve({ evidencePath, expectedSha256, expectedEvidenceKind }) {
    if (!EVIDENCE_PATH_PATTERN.test(String(evidencePath || ""))) {
      throw resolverError("FORMAL_EVIDENCE_PATH_INVALID");
    }
    if (!SHA256_PATTERN.test(String(expectedSha256 || ""))) {
      throw resolverError("FORMAL_EVIDENCE_EXPECTED_DIGEST_INVALID");
    }
    if (!/^[A-Z0-9_]{3,96}$/.test(String(expectedEvidenceKind || ""))) {
      throw resolverError("FORMAL_EVIDENCE_EXPECTED_KIND_INVALID");
    }
    assertNoSymlinkSegments(root, evidencePath);
    const absolutePath = path.resolve(root, evidencePath);
    const relativeToEvidenceRoot = path.relative(evidenceRoot, absolutePath);
    if (!relativeToEvidenceRoot || relativeToEvidenceRoot.startsWith("..")
      || path.isAbsolute(relativeToEvidenceRoot)) {
      throw resolverError("FORMAL_EVIDENCE_PATH_OUTSIDE_ROOT");
    }
    let descriptor;
    try {
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(absolutePath, flags);
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw resolverError("FORMAL_EVIDENCE_NON_REGULAR_FILE");
      if (stat.size > maximumBytes) throw resolverError("FORMAL_EVIDENCE_SIZE_LIMIT_EXCEEDED");
      const bytes = fs.readFileSync(descriptor);
      if (bytes.length !== stat.size || bytes.length > maximumBytes) {
        throw resolverError("FORMAL_EVIDENCE_READ_INCONSISTENT");
      }
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== expectedSha256) {
        throw resolverError("FORMAL_EVIDENCE_DIGEST_MISMATCH");
      }
      let document;
      try {
        document = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw resolverError("FORMAL_EVIDENCE_JSON_INVALID");
      }
      if (!document || typeof document !== "object" || Array.isArray(document)
        || document.evidenceKind !== expectedEvidenceKind) {
        throw resolverError("FORMAL_EVIDENCE_KIND_MISMATCH");
      }
      return Object.freeze({
        resolvedRelativePath: evidencePath,
        byteLength: bytes.length,
        sha256: actualSha256,
        evidenceKind: expectedEvidenceKind,
        parsedDocument: Object.freeze(document),
        structureOnly: true,
      });
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  return Object.freeze({ resolve });
}

module.exports = {
  DEFAULT_MAXIMUM_BYTES,
  createFormalEvidenceByteResolver,
};
