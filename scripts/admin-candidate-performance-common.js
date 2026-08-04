const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const budgets = require("../admin/config/performance-budgets.json");
const { evaluateEvidenceProvenance } = require("./admin-performance-report");

const CANDIDATE_EVIDENCE_CLASS = "FORMAL_LAUNCH_CANDIDATE";
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function buildCandidateProvenance(input = {}) {
  const provenance = {
    version: requiredText(input.version, "version"),
    environment: requiredText(input.environment, "environment"),
    evidenceClass: CANDIDATE_EVIDENCE_CLASS,
    targetOrigin: requiredText(input.targetOrigin, "target origin").replace(/\/$/, ""),
    artifactCommit: requiredText(input.artifactCommit, "artifact commit").toLowerCase(),
    releaseId: requiredText(input.releaseId, "release id"),
    releaseIdConfigured: true,
  };
  if (!SOURCE_COMMIT_PATTERN.test(provenance.artifactCommit)) {
    throw new Error("artifact commit must be the full 40-character Git commit");
  }
  const evaluated = evaluateEvidenceProvenance([provenance], CANDIDATE_EVIDENCE_CLASS);
  if (evaluated.status !== "PASS") throw new Error(`candidate provenance rejected: ${evaluated.reason}`);
  return Object.freeze(provenance);
}

async function requestJson(fetchImpl, targetOrigin, route, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const startedAt = performance.now();
  const response = await fetchImpl(`${targetOrigin}${route}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { "X-Admin-Token": options.token } : {}),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    throw new Error(`${route} returned non-JSON response`);
  }
  return {
    status: response.status,
    body,
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    responseBytes: Buffer.byteLength(text),
  };
}

function requireSuccess(result, label) {
  if (result.status !== 200 || !result.body || result.body.code !== 0) {
    throw new Error(`${label} failed with HTTP ${result.status} / code ${result.body && result.body.code}`);
  }
  return result.body.data;
}

async function readCandidateRuntime(fetchImpl, provenance) {
  const result = await requestJson(fetchImpl, provenance.targetOrigin, "/health", { timeoutMs: 8000 });
  const data = requireSuccess(result, "candidate /health");
  if (data.version !== provenance.version) throw new Error("candidate /health version does not match requested version");
  if (data.releaseId !== provenance.releaseId) throw new Error("candidate /health releaseId does not match requested release id");
  if (data.releaseIdConfigured !== true) throw new Error("candidate /health releaseId is not explicitly configured");
  if (data.adminPerformanceDatasetVersion !== budgets.fixture.version
    || data.adminPerformanceDatasetConfigured !== true) {
    throw new Error(`candidate /health must explicitly bind ${budgets.fixture.version}`);
  }
  return {
    schemaVersion: 1,
    ...provenance,
    observedAt: new Date().toISOString(),
    runtimeReadback: {
      route: "/health",
      httpStatus: result.status,
      version: data.version,
      releaseId: data.releaseId,
      releaseIdConfigured: data.releaseIdConfigured,
      adminPerformanceDatasetVersion: data.adminPerformanceDatasetVersion,
      adminPerformanceDatasetConfigured: data.adminPerformanceDatasetConfigured,
    },
  };
}

function writeJsonExclusive(filePath, value) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return absolutePath;
}

module.exports = {
  CANDIDATE_EVIDENCE_CLASS,
  buildCandidateProvenance,
  readCandidateRuntime,
  requestJson,
  requireSuccess,
  requiredText,
  writeJsonExclusive,
};
