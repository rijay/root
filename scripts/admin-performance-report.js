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

function aggregateQueryEvidence(events, budgets) {
  const required = ["list", "detail", "write", "audit"];
  const expectedDatasetVersion = budgets.fixture.version;
  const evidenceDimensions = events.length ? {
    version: String(events[0].version || ""),
    environment: String(events[0].environment || ""),
    datasetVersion: String(events[0].datasetVersion || ""),
  } : { version: "", environment: "", datasetVersion: "" };
  const dimensionsValid = Boolean(evidenceDimensions.version && evidenceDimensions.environment)
    && evidenceDimensions.datasetVersion === expectedDatasetVersion
    && events.every((event) => event.version === evidenceDimensions.version
      && event.environment === evidenceDimensions.environment
      && event.datasetVersion === evidenceDimensions.datasetVersion);
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
    scenarios,
  };
}

function aggregateBrowserEvidence(events, budgets) {
  if (!events.length) return { status: "BLOCK", sampleCount: 0, reason: "MISSING_BROWSER_EVIDENCE" };
  const requiredNumbers = [
    "initialDomNodes", "pageDomNodes", "maxTaskMs", "maxFreezeMs", "stableMemoryMiB",
    "fps", "memoryGrowthRatio", "menuCycles", "editCycles", "journeyDurationMinutes",
    "durationMs", "viewportWidth", "viewportHeight", "sessionCount", "maxConcurrentReads", "conflictScenarios",
  ];
  const first = events[0] || {};
  const dimensions = { version: String(first.version || ""), environment: String(first.environment || "") };
  const valid = events.filter((event) => requiredNumbers.every((field) => Number.isFinite(event?.[field]))
    && typeof event.scenario === "string"
    && ["Chrome", "Edge"].includes(event.browser)
    && Object.hasOwn(budgets.networkProfiles, event.networkProfile)
    && event.version === dimensions.version
    && event.environment === dimensions.environment);
  const browsers = new Set(valid.map((event) => event.browser));
  const networkProfiles = new Set(valid.map((event) => event.networkProfile));
  const resourcePasses = Boolean(dimensions.version && dimensions.environment)
    && valid.length === events.length
    && browsers.has("Chrome") && browsers.has("Edge")
    && networkProfiles.has("office") && networkProfiles.has("weak")
    && valid.every((event) => (
    event.initialDomNodes <= budgets.browser.initialDomNodes.hardLimit
      && event.pageDomNodes <= budgets.browser.pageDomNodes.hardLimit
      && event.maxTaskMs <= budgets.browser.singleSynchronousTaskHardLimitMs
      && event.maxFreezeMs <= budgets.browser.continuousFreezeHardLimitMs
      && event.stableMemoryMiB <= budgets.browser.stableMemory.hardLimitMiB
      && event.fps >= budgets.browser.fpsMinimum
      && event.memoryGrowthRatio <= budgets.browser.menuCycleGrowthHardLimitRatio
      && event.menuCycles >= budgets.browser.menuCycles
      && event.editCycles >= budgets.browser.editCycles
      && event.journeyDurationMinutes >= budgets.browser.journeyDurationMinutes
      && event.viewportWidth === 1240
      && event.viewportHeight === 820
      && event.sessionCount >= budgets.capacity.maximumSessions
      && event.maxConcurrentReads <= budgets.capacity.maximumConcurrentReadsAcrossSessions
      && event.conflictScenarios >= 2
  ));
  const journeys = Object.entries(budgets.journeys).map(([scenario, limits]) => {
    const samples = valid.filter((event) => event.scenario === scenario).map((event) => event.durationMs);
    const p75Ms = percentile(samples, 0.75);
    const p95Ms = percentile(samples, 0.95);
    const maximumMs = samples.length ? Math.max(...samples) : null;
    const status = samples.length >= budgets.queries.samplesPerScenario
      && p75Ms <= limits.p75Ms && maximumMs <= limits.hardLimitMs ? "PASS" : "BLOCK";
    return { scenario, sampleCount: samples.length, p75Ms, p95Ms, maximumMs, status };
  });
  const status = resourcePasses && journeys.every((journey) => journey.status === "PASS") ? "PASS" : "BLOCK";
  return {
    status,
    sampleCount: valid.length,
    dimensions: {
      ...dimensions,
      browsers: Array.from(browsers).sort(),
      networkProfiles: Array.from(networkProfiles).sort(),
      viewport: "1240x820",
    },
    journeys,
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
  const browserEvents = options.browserEventsPath ? readJson(path.resolve(options.browserEventsPath)) : [];
  if (!Array.isArray(queryEvents) || !Array.isArray(browserEvents)) throw new Error("performance evidence files must contain arrays");
  const query = aggregateQueryEvidence(queryEvents, budgets);
  const browser = aggregateBrowserEvidence(browserEvents, budgets);
  const report = {
    ...build,
    evidenceClass: options.evidenceClass,
    gates: { build: build.status, query: query.status, browser: browser.status },
    query,
    browser,
  };
  report.releaseGateEligible = options.evidenceClass === "FORMAL_LAUNCH_CANDIDATE"
    && build.status !== "BLOCK" && query.status === "PASS" && browser.status === "PASS";
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
  evaluateMetric,
  parseArgs,
  percentile,
};
