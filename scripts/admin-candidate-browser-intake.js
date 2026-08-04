#!/usr/bin/env node

const fs = require("node:fs");

const budgets = require("../admin/config/performance-budgets.json");
const {
  CANDIDATE_EVIDENCE_CLASS,
  buildCandidateProvenance,
  writeJsonExclusive,
} = require("./admin-candidate-performance-common");

const PROVENANCE_FIELDS = [
  "version", "environment", "evidenceClass", "targetOrigin", "artifactCommit", "releaseId", "releaseIdConfigured",
];

function readJson(filePath, label) {
  if (!String(filePath || "").trim()) throw new Error(`${label} path is required`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = { runtimePath: "", capturePath: "", outputPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--runtime-readback") options.runtimePath = argv[++index];
    else if (value === "--capture") options.capturePath = argv[++index];
    else if (value === "--output") options.outputPath = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.runtimePath || !options.capturePath || !options.outputPath) {
    throw new Error("runtime readback, capture and output paths are required");
  }
  return options;
}

function validateRuntimeReadback(runtime) {
  if (!runtime || runtime.schemaVersion !== 1 || runtime.evidenceClass !== CANDIDATE_EVIDENCE_CLASS) {
    throw new Error("runtime readback is not formal candidate evidence");
  }
  const provenance = buildCandidateProvenance(runtime);
  const readback = runtime.runtimeReadback || {};
  if (readback.route !== "/health" || readback.httpStatus !== 200
    || readback.version !== provenance.version
    || readback.releaseId !== provenance.releaseId
    || readback.releaseIdConfigured !== true
    || readback.adminPerformanceDatasetVersion !== budgets.fixture.version
    || readback.adminPerformanceDatasetConfigured !== true) {
    throw new Error("runtime readback does not match candidate provenance");
  }
  return provenance;
}

function exactNetworkProfile(actual = {}, expected = {}) {
  return actual.networkEmulationComplete === true
    && actual.rttMs === expected.rttMs
    && actual.downlinkMbps === expected.downlinkMbps
    && actual.uplinkMbps === expected.uplinkMbps
    && actual.packetLossRatio === expected.packetLossRatio
    && Array.isArray(actual.limitations)
    && actual.limitations.length === 0;
}

function validateRawCapture(capture) {
  if (!capture || capture.schemaVersion !== 1) throw new Error("browser capture schemaVersion must be 1");
  const dimensions = capture.dimensions || {};
  const forbidden = PROVENANCE_FIELDS.filter((field) => Object.hasOwn(dimensions, field));
  if (forbidden.length) throw new Error(`raw browser capture must not self-assert provenance: ${forbidden.join(", ")}`);
  if (dimensions.browser !== "Chrome" || !String(dimensions.browserVersion || "").trim()) {
    throw new Error("candidate browser capture must identify Chrome and its version");
  }
  if (dimensions.viewportWidth !== 1240 || dimensions.viewportHeight !== 820) {
    throw new Error("candidate browser capture viewport must be 1240x820");
  }
  if (dimensions.hardwareConcurrency < budgets.browser.minimumHardwareConcurrency
    || dimensions.deviceMemoryGiB < budgets.browser.minimumDeviceMemoryGiB) {
    throw new Error("candidate browser hardware is below the approved minimum");
  }
  const resources = capture.resources || {};
  const resourceFields = [
    "initialDomNodes", "pageDomNodes", "maxTaskMs", "maxFreezeMs", "stableMemoryMiB", "fps",
    "memoryGrowthRatio", "menuCycles", "editCycles", "journeyDurationMinutes",
  ];
  if (!resourceFields.every((field) => Number.isFinite(resources[field]))) {
    throw new Error("candidate browser resource metrics are incomplete");
  }
  const capacity = capture.capacity || {};
  if (![capacity.sessionCount, capacity.maxConcurrentReads, capacity.conflictScenarios].every(Number.isFinite)
    || capacity.sessionCount !== budgets.capacity.maximumSessions
    || capacity.maxConcurrentReads < 0
    || capacity.maxConcurrentReads > budgets.capacity.maximumConcurrentReadsAcrossSessions
    || capacity.conflictScenarios < 2) {
    throw new Error("candidate browser capacity or conflict coverage is incomplete");
  }
  if (!exactNetworkProfile(capture.networks?.office, budgets.networkProfiles.office)
    || !exactNetworkProfile(capture.networks?.weak, budgets.networkProfiles.weak)) {
    throw new Error("candidate browser network profiles do not match the approved office and weak profiles");
  }
  const expectedJourneys = Object.keys(budgets.journeys).sort();
  const observedJourneys = Object.keys(capture.journeys || {}).sort();
  if (JSON.stringify(expectedJourneys) !== JSON.stringify(observedJourneys)) {
    throw new Error("candidate browser journey set is incomplete");
  }
  expectedJourneys.forEach((scenario) => {
    ["office", "weak"].forEach((networkProfile) => {
      const samples = capture.journeys[scenario] && capture.journeys[scenario][networkProfile];
      if (!Array.isArray(samples) || samples.length < budgets.queries.samplesPerScenario
        || samples.some((value) => !Number.isFinite(value) || value < 0)) {
        throw new Error(`${scenario}/${networkProfile} requires at least ${budgets.queries.samplesPerScenario} numeric samples`);
      }
    });
  });
  if (!Array.isArray(capture.limitations) || capture.limitations.length) {
    throw new Error("formal candidate browser capture must have no unresolved limitations");
  }
  return capture;
}

function sealBrowserCapture(runtime, rawCapture) {
  const provenance = validateRuntimeReadback(runtime);
  const capture = validateRawCapture(rawCapture);
  return {
    ...capture,
    evidenceClass: CANDIDATE_EVIDENCE_CLASS,
    sealedAt: new Date().toISOString(),
    dimensions: {
      ...capture.dimensions,
      ...provenance,
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = readJson(options.runtimePath, "runtime readback");
  const capture = readJson(options.capturePath, "browser capture");
  const sealed = sealBrowserCapture(runtime, capture);
  const outputPath = writeJsonExclusive(options.outputPath, sealed);
  process.stdout.write(`${JSON.stringify({
    status: "SEALED",
    releaseId: sealed.dimensions.releaseId,
    browser: sealed.dimensions.browser,
    outputPath,
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Admin candidate browser intake failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  sealBrowserCapture,
  validateRawCapture,
  validateRuntimeReadback,
};
