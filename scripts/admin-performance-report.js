#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function evaluateMetric(value, limits) {
  const status = value > limits.hardLimit ? "BLOCK" : value > limits.target ? "WARN" : "PASS";
  return { status, value, target: limits.target, hardLimit: limits.hardLimit };
}

function parseTargetOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return url.origin === String(value || "").replace(/\/$/, "") ? url : null;
  } catch (_) {
    return null;
  }
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function evaluateEvidenceProvenance(events, expectedEvidenceClass) {
  if (!expectedEvidenceClass) return { status: "PASS", expectedEvidenceClass: "UNSPECIFIED" };
  const first = events[0] || {};
  const target = parseTargetOrigin(first.targetOrigin);
  const shared = Boolean(events.length)
    && events.every((event) => event.evidenceClass === first.evidenceClass
      && event.targetOrigin === first.targetOrigin
      && event.artifactCommit === first.artifactCommit);
  const base = {
    expectedEvidenceClass,
    observedEvidenceClass: String(first.evidenceClass || ""),
    targetOrigin: String(first.targetOrigin || ""),
    artifactCommit: String(first.artifactCommit || ""),
  };
  if (!shared || first.evidenceClass !== expectedEvidenceClass || !target) {
    return { ...base, status: "BLOCK", reason: "EVIDENCE_PROVENANCE_MISSING_OR_MIXED" };
  }
  if (expectedEvidenceClass === "FORMAL_LAUNCH_CANDIDATE") {
    const environment = String(first.environment || "").toLowerCase();
    const candidateTarget = target.protocol === "https:" && !isLoopbackHost(target.hostname);
    const candidateEnvironment = Boolean(environment)
      && !/(^|[-_])(local|localhost|test|development|dev)([-_]|$)/.test(environment);
    const candidateCommit = /^[0-9a-f]{7,40}$/i.test(String(first.artifactCommit || ""));
    if (!candidateTarget || !candidateEnvironment || !candidateCommit) {
      return { ...base, status: "BLOCK", reason: "CANDIDATE_PROVENANCE_INVALID" };
    }
  }
  return { ...base, status: "PASS" };
}

function gzipBytes(filePath) {
  return zlib.gzipSync(fs.readFileSync(filePath), { level: 9 }).byteLength;
}

function listFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, absolutePath);
    return [{ absolutePath, relativePath: path.relative(root, absolutePath).split(path.sep).join("/") }];
  });
}

function collectManifestFiles(manifest, key, output = new Set()) {
  const item = manifest[key];
  if (!item) return output;
  if (item.file) output.add(item.file);
  (item.css || []).forEach((file) => output.add(file));
  (item.assets || []).forEach((file) => output.add(file));
  (item.imports || []).forEach((dependency) => collectManifestFiles(manifest, dependency, output));
  return output;
}

function bytesFor(files, sizeByFile) {
  return Array.from(files).reduce((total, file) => total + (sizeByFile.get(file) || 0), 0);
}

function buildAdminPerformanceReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, ".."));
  const adminRoot = path.join(projectRoot, "admin");
  const distRoot = path.resolve(options.distRoot || path.join(adminRoot, "dist"));
  const budgets = options.budgets || readJson(path.join(adminRoot, "config", "performance-budgets.json"));
  const manifestPath = path.join(distRoot, ".vite", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("admin build manifest missing; run npm run build --prefix admin first");
  const manifest = readJson(manifestPath);
  const outputFiles = listFiles(distRoot)
    .filter((file) => file.relativePath !== ".vite/manifest.json" && !file.relativePath.endsWith(".map"));
  const sizeByFile = new Map(outputFiles.map((file) => [file.relativePath, gzipBytes(file.absolutePath)]));
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entryKey) throw new Error("admin build entry missing from manifest");

  const initialFiles = collectManifestFiles(manifest, entryKey);
  const firstScreenFiles = new Set(["index.html", ...initialFiles]);
  const asyncEntries = Object.entries(manifest).filter(([, item]) => item.isDynamicEntry);
  const asyncPages = asyncEntries.map(([key, item]) => {
    const files = collectManifestFiles(manifest, key);
    initialFiles.forEach((file) => files.delete(file));
    const compressedBytes = bytesFor(files, sizeByFile);
    return {
      source: item.src || key,
      files: Array.from(files).sort(),
      compressedBytes,
      budget: evaluateMetric(compressedBytes, {
        target: budgets.build.singleAsyncPageCompressed.targetBytes,
        hardLimit: budgets.build.singleAsyncPageCompressed.hardLimitBytes,
      }),
    };
  }).sort((left, right) => right.compressedBytes - left.compressedBytes);

  const initialCompressedBytes = bytesFor(initialFiles, sizeByFile);
  const firstScreenCompressedBytes = bytesFor(firstScreenFiles, sizeByFile);
  const totalCompressedBytes = Array.from(sizeByFile.values()).reduce((sum, value) => sum + value, 0);
  const metrics = {
    initialCompressed: evaluateMetric(initialCompressedBytes, {
      target: budgets.build.initialCompressed.targetBytes,
      hardLimit: budgets.build.initialCompressed.hardLimitBytes,
    }),
    firstScreenCompressed: evaluateMetric(firstScreenCompressedBytes, {
      target: budgets.build.firstScreenCompressed.targetBytes,
      hardLimit: budgets.build.firstScreenCompressed.hardLimitBytes,
    }),
    totalCompressed: evaluateMetric(totalCompressedBytes, {
      target: budgets.build.totalCompressed.targetBytes,
      hardLimit: budgets.build.totalCompressed.hardLimitBytes,
    }),
  };
  const evaluations = [...Object.values(metrics), ...asyncPages.map((item) => item.budget)];
  const status = evaluations.some((item) => item.status === "BLOCK")
    ? "BLOCK"
    : evaluations.some((item) => item.status === "WARN") ? "WARN" : "PASS";
  return {
    schemaVersion: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    evidenceClass: options.evidenceClass || "LOCAL_FORMAL_BUILD",
    gate: "BUILD",
    status,
    releaseGateEligible: false,
    distState: "VITE_PRODUCTION_BUILD",
    metrics,
    initialFiles: Array.from(initialFiles).sort(),
    asyncPages,
    warnings: ["构建门禁通过不等于正式上线性能门禁通过；仍需查询与浏览器证据"],
  };
}

function queryResponseLimit(scenario, budgets) {
  if (scenario === "list") return budgets.responses.listHardLimitBytes;
  if (scenario === "detail") return budgets.responses.detailHardLimitBytes;
  if (scenario === "write") return budgets.responses.writeHardLimitBytes;
  return budgets.responses.auditHardLimitBytes;
}

function aggregateQueryEvidence(events, budgets, expectedEvidenceClass = "") {
  const required = ["list", "detail", "write", "audit"];
  const expectedDatasetVersion = budgets.fixture.version;
  const evidenceDimensions = events.length ? {
    version: String(events[0].version || ""),
    environment: String(events[0].environment || ""),
    datasetVersion: String(events[0].datasetVersion || ""),
    evidenceClass: String(events[0].evidenceClass || ""),
    targetOrigin: String(events[0].targetOrigin || ""),
    artifactCommit: String(events[0].artifactCommit || ""),
  } : { version: "", environment: "", datasetVersion: "" };
  const provenance = evaluateEvidenceProvenance(events, expectedEvidenceClass);
  const dimensionsValid = Boolean(evidenceDimensions.version && evidenceDimensions.environment)
    && evidenceDimensions.datasetVersion === expectedDatasetVersion
    && events.every((event) => event.version === evidenceDimensions.version
      && event.environment === evidenceDimensions.environment
      && event.datasetVersion === evidenceDimensions.datasetVersion)
    && provenance.status === "PASS";
  const scenarios = required.map((scenario) => {
    const samples = events.filter((event) => event && event.scenario === scenario
      && Number.isFinite(event.durationMs) && Number.isFinite(event.responseBytes));
    const durations = samples.map((event) => event.durationMs);
    const p75Ms = percentile(durations, 0.75);
    const p95Ms = percentile(durations, 0.95);
    const maxResponseBytes = samples.length ? Math.max(...samples.map((event) => event.responseBytes)) : null;
    const limits = budgets.queries[scenario];
    const status = !dimensionsValid || samples.length < budgets.queries.samplesPerScenario
      || p75Ms > limits.p75Ms
      || p95Ms > limits.p95Ms
      || maxResponseBytes > queryResponseLimit(scenario, budgets) ? "BLOCK" : "PASS";
    return { scenario, sampleCount: samples.length, p75Ms, p95Ms, maxResponseBytes, status };
  });
  return {
    status: dimensionsValid && scenarios.every((item) => item.status === "PASS") ? "PASS" : "BLOCK",
    dimensions: evidenceDimensions,
    provenance,
    scenarios,
  };
}

function expandBrowserEvidence(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object" || Array.isArray(input.journeys)) {
    throw new Error("browser evidence must be an event array or compact browser session object");
  }
  const dimensions = input.dimensions || {};
  const resources = input.resources || {};
  const capacity = input.capacity || {};
  const networks = input.networks || {};
  return Object.entries(input.journeys || {}).flatMap(([scenario, profiles]) => (
    Object.entries(profiles || {}).flatMap(([networkProfile, durations]) => {
      if (!Array.isArray(durations)) throw new Error(`browser journey ${scenario}/${networkProfile} must be an array`);
      const network = networks[networkProfile] || {};
      return durations.map((durationMs) => ({
        ...resources,
        ...capacity,
        version: dimensions.version,
        environment: dimensions.environment,
        evidenceClass: dimensions.evidenceClass,
        targetOrigin: dimensions.targetOrigin,
        artifactCommit: dimensions.artifactCommit,
        browser: dimensions.browser,
        browserVersion: dimensions.browserVersion || "",
        hardwareConcurrency: dimensions.hardwareConcurrency,
        deviceMemoryGiB: dimensions.deviceMemoryGiB,
        viewportWidth: dimensions.viewportWidth,
        viewportHeight: dimensions.viewportHeight,
        scenario,
        networkProfile,
        networkEmulationComplete: network.networkEmulationComplete === true,
        networkLimitations: network.limitations || [],
        evidenceLimitations: input.limitations || [],
        durationMs,
      }));
    })
  ));
}

function aggregateBrowserEvidence(events, budgets, expectedEvidenceClass = "") {
  if (!events.length) return { status: "BLOCK", sampleCount: 0, reason: "MISSING_BROWSER_EVIDENCE" };
  const requiredBrowsers = Array.isArray(budgets.browser.supportedBrowsers)
    ? budgets.browser.supportedBrowsers
    : [];
  if (!requiredBrowsers.length) return { status: "BLOCK", sampleCount: 0, reason: "MISSING_BROWSER_SCOPE" };
  const requiredNumbers = [
    "initialDomNodes", "pageDomNodes", "maxTaskMs", "maxFreezeMs", "stableMemoryMiB",
    "fps", "memoryGrowthRatio", "menuCycles", "editCycles", "journeyDurationMinutes",
    "durationMs", "viewportWidth", "viewportHeight", "sessionCount", "maxConcurrentReads", "conflictScenarios",
    "hardwareConcurrency", "deviceMemoryGiB",
  ];
  const first = events[0] || {};
  const dimensions = {
    version: String(first.version || ""),
    environment: String(first.environment || ""),
    evidenceClass: String(first.evidenceClass || ""),
    targetOrigin: String(first.targetOrigin || ""),
    artifactCommit: String(first.artifactCommit || ""),
  };
  const provenance = evaluateEvidenceProvenance(events, expectedEvidenceClass);
  const valid = events.filter((event) => requiredNumbers.every((field) => Number.isFinite(event?.[field]))
    && typeof event.scenario === "string"
    && requiredBrowsers.includes(event.browser)
    && typeof event.browserVersion === "string" && Boolean(event.browserVersion.trim())
    && Object.hasOwn(budgets.networkProfiles, event.networkProfile)
    && event.networkEmulationComplete === true
    && event.version === dimensions.version
    && event.environment === dimensions.environment);
  const browsers = new Set(valid.map((event) => event.browser));
  const networkProfiles = new Set(valid.map((event) => event.networkProfile));
  const maximum = (field) => valid.length ? Math.max(...valid.map((event) => event[field])) : null;
  const minimum = (field) => valid.length ? Math.min(...valid.map((event) => event[field])) : null;
  const upperCheck = (value, hardLimit, target = hardLimit) => ({
    value,
    target,
    hardLimit,
    status: value === null || value > hardLimit ? "BLOCK" : value > target ? "WARN" : "PASS",
  });
  const minimumCheck = (value, required) => ({
    value,
    required,
    status: value !== null && value >= required ? "PASS" : "BLOCK",
  });
  const resources = {
    initialDomNodes: upperCheck(maximum("initialDomNodes"), budgets.browser.initialDomNodes.hardLimit, budgets.browser.initialDomNodes.target),
    pageDomNodes: upperCheck(maximum("pageDomNodes"), budgets.browser.pageDomNodes.hardLimit, budgets.browser.pageDomNodes.target),
    maxTaskMs: upperCheck(maximum("maxTaskMs"), budgets.browser.singleSynchronousTaskHardLimitMs),
    maxFreezeMs: upperCheck(maximum("maxFreezeMs"), budgets.browser.continuousFreezeHardLimitMs),
    stableMemoryMiB: upperCheck(maximum("stableMemoryMiB"), budgets.browser.stableMemory.hardLimitMiB, budgets.browser.stableMemory.targetMiB),
    fps: minimumCheck(minimum("fps"), budgets.browser.fpsMinimum),
    memoryGrowthRatio: upperCheck(maximum("memoryGrowthRatio"), budgets.browser.menuCycleGrowthHardLimitRatio),
    menuCycles: minimumCheck(minimum("menuCycles"), budgets.browser.menuCycles),
    editCycles: minimumCheck(minimum("editCycles"), budgets.browser.editCycles),
    journeyDurationMinutes: minimumCheck(minimum("journeyDurationMinutes"), budgets.browser.journeyDurationMinutes),
    sessionCount: minimumCheck(minimum("sessionCount"), budgets.capacity.maximumSessions),
    maxConcurrentReads: upperCheck(maximum("maxConcurrentReads"), budgets.capacity.maximumConcurrentReadsAcrossSessions),
    conflictScenarios: minimumCheck(minimum("conflictScenarios"), 2),
    hardwareConcurrency: minimumCheck(minimum("hardwareConcurrency"), budgets.browser.minimumHardwareConcurrency),
    deviceMemoryGiB: minimumCheck(minimum("deviceMemoryGiB"), budgets.browser.minimumDeviceMemoryGiB),
  };
  const resourcePasses = Boolean(dimensions.version && dimensions.environment)
    && provenance.status === "PASS"
    && valid.length === events.length
    && requiredBrowsers.every((browser) => browsers.has(browser))
    && networkProfiles.has("office") && networkProfiles.has("weak")
    && Object.values(resources).every((item) => item.status !== "BLOCK")
    && valid.every((event) => event.viewportWidth === 1240 && event.viewportHeight === 820);
  const journeys = Object.entries(budgets.journeys).map(([scenario, limits]) => {
    const groups = requiredBrowsers.flatMap((browser) => ["office", "weak"].map((networkProfile) => {
      const observedSamples = events
        .filter((event) => event.scenario === scenario
          && event.browser === browser
          && event.networkProfile === networkProfile)
        .map((event) => event.durationMs);
      const samples = valid
        .filter((event) => event.scenario === scenario
          && event.browser === browser
          && event.networkProfile === networkProfile)
        .map((event) => event.durationMs);
      const p75Ms = percentile(samples, 0.75);
      const p95Ms = percentile(samples, 0.95);
      const maximumMs = samples.length ? Math.max(...samples) : null;
      const enoughSamples = samples.length >= budgets.queries.samplesPerScenario;
      const timingPass = networkProfile === "weak"
        || (p75Ms <= limits.p75Ms && maximumMs <= limits.hardLimitMs);
      return {
        browser,
        networkProfile,
        sampleCount: samples.length,
        observedSampleCount: observedSamples.length,
        p75Ms,
        p95Ms,
        maximumMs,
        observedP75Ms: percentile(observedSamples, 0.75),
        observedP95Ms: percentile(observedSamples, 0.95),
        observedMaximumMs: observedSamples.length ? Math.max(...observedSamples) : null,
        timingGateApplied: networkProfile === "office",
        status: enoughSamples && timingPass ? "PASS" : "BLOCK",
      };
    }));
    const officeSamples = groups
      .filter((group) => group.networkProfile === "office")
      .flatMap((group) => valid
        .filter((event) => event.scenario === scenario
          && event.browser === group.browser
          && event.networkProfile === "office")
        .map((event) => event.durationMs));
    return {
      scenario,
      sampleCount: groups.reduce((total, group) => total + group.sampleCount, 0),
      p75Ms: percentile(officeSamples, 0.75),
      p95Ms: percentile(officeSamples, 0.95),
      maximumMs: officeSamples.length ? Math.max(...officeSamples) : null,
      groups,
      status: groups.every((group) => group.status === "PASS") ? "PASS" : "BLOCK",
    };
  });
  const status = resourcePasses && journeys.every((journey) => journey.status === "PASS") ? "PASS" : "BLOCK";
  return {
    status,
    sampleCount: valid.length,
    invalidSampleCount: events.length - valid.length,
    dimensions: {
      ...dimensions,
      browsers: Array.from(browsers).sort(),
      networkProfiles: Array.from(networkProfiles).sort(),
      viewport: "1240x820",
    },
    limitations: Array.from(new Set(events.flatMap((event) => [
      ...(Array.isArray(event.evidenceLimitations) ? event.evidenceLimitations : []),
      ...(Array.isArray(event.networkLimitations) ? event.networkLimitations : []),
    ]))).sort(),
    provenance,
    resources,
    journeys,
  };
}

function evaluateCandidateBinding(query, browser, evidenceClass) {
  if (evidenceClass !== "FORMAL_LAUNCH_CANDIDATE") return { status: "NOT_APPLICABLE" };
  const queryDimensions = query?.dimensions || {};
  const browserDimensions = browser?.dimensions || {};
  const matches = query?.provenance?.status === "PASS"
    && browser?.provenance?.status === "PASS"
    && queryDimensions.artifactCommit === browserDimensions.artifactCommit
    && queryDimensions.targetOrigin === browserDimensions.targetOrigin;
  return {
    status: matches ? "PASS" : "BLOCK",
    artifactCommit: matches ? queryDimensions.artifactCommit : "",
    targetOrigin: matches ? queryDimensions.targetOrigin : "",
  };
}

function parseArgs(argv) {
  const options = {
    evidenceClass: "LOCAL_FORMAL_BUILD",
    distRoot: "",
    outputPath: "",
    queryEventsPath: "",
    browserEventsPath: "",
    buildGate: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--legacy") options.evidenceClass = "LEGACY_NON_GATE_BASELINE";
    else if (value === "--rehearsal") options.evidenceClass = "LOCAL_REHEARSAL";
    else if (value === "--candidate") options.evidenceClass = "FORMAL_LAUNCH_CANDIDATE";
    else if (value === "--build-gate") options.buildGate = true;
    else if (value === "--dist") options.distRoot = argv[++index];
    else if (value === "--query-events") options.queryEventsPath = argv[++index];
    else if (value === "--browser-events") options.browserEventsPath = argv[++index];
    else if (value === "--output") options.outputPath = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, "..");
  const budgets = readJson(path.join(projectRoot, "admin", "config", "performance-budgets.json"));
  const build = buildAdminPerformanceReport({
    projectRoot,
    distRoot: options.distRoot || undefined,
    budgets,
    evidenceClass: options.evidenceClass,
  });
  const queryEvents = options.queryEventsPath ? readJson(path.resolve(options.queryEventsPath)) : [];
  const browserEvidence = options.browserEventsPath ? readJson(path.resolve(options.browserEventsPath)) : [];
  if (!Array.isArray(queryEvents)) throw new Error("query performance evidence file must contain an array");
  const browserEvents = expandBrowserEvidence(browserEvidence);
  const query = aggregateQueryEvidence(queryEvents, budgets, options.evidenceClass);
  const browser = aggregateBrowserEvidence(browserEvents, budgets, options.evidenceClass);
  const candidateBinding = evaluateCandidateBinding(query, browser, options.evidenceClass);
  const report = {
    ...build,
    evidenceClass: options.evidenceClass,
    gates: { build: build.status, query: query.status, browser: browser.status },
    query,
    browser,
    candidateBinding,
  };
  report.releaseGateEligible = options.evidenceClass === "FORMAL_LAUNCH_CANDIDATE"
    && build.status !== "BLOCK" && query.status === "PASS" && browser.status === "PASS"
    && candidateBinding.status === "PASS";
  if (options.evidenceClass === "LEGACY_NON_GATE_BASELINE") {
    report.warnings.push("旧后台或本地样本不得作为正式上线 Gate 通过证据");
  }
  if (options.evidenceClass === "LOCAL_REHEARSAL") {
    report.warnings.push("本地固定夹具仅用于开发排障，不得作为候选或正式上线 Gate 通过证据");
  }
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) fs.writeFileSync(path.resolve(options.outputPath), output, "utf8");
  else process.stdout.write(output);
  if ((options.buildGate && build.status === "BLOCK")
    || (options.evidenceClass === "FORMAL_LAUNCH_CANDIDATE" && !report.releaseGateEligible)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Admin performance report failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  aggregateBrowserEvidence,
  aggregateQueryEvidence,
  buildAdminPerformanceReport,
  evaluateCandidateBinding,
  evaluateEvidenceProvenance,
  evaluateMetric,
  expandBrowserEvidence,
  parseArgs,
  percentile,
};
