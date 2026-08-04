#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { collectReleaseSourceFiles } = require("./miniprogram-release-manifest");

const MEDIA_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf)$/i;

function evaluateMetric(value, limits) {
  const status = value > limits.hardLimit ? "BLOCK" : value > limits.target ? "WARN" : "PASS";
  return { status, value, target: limits.target, hardLimit: limits.hardLimit };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packageLimits(config) {
  return { target: config.targetBytes, hardLimit: config.hardLimitBytes };
}

function imageLimits(relativePath, budgets) {
  if (/^static\/(?:brand|tabbar)\//i.test(relativePath)) {
    return {
      target: budgets.images.logoOrTabIcon.targetMaxBytes,
      hardLimit: budgets.images.logoOrTabIcon.hardLimitBytes,
      category: "LOGO_OR_TAB_ICON",
    };
  }
  if (/^static\/banner\//i.test(relativePath)) {
    return {
      target: budgets.images.activityCover.targetMaxBytes,
      hardLimit: budgets.images.activityCover.hardLimitBytes,
      category: "ACTIVITY_COVER",
    };
  }
  return {
    target: budgets.images.immersiveDetail.targetMaxBytes,
    hardLimit: budgets.images.immersiveDetail.hardLimitBytes,
    category: "GENERAL_LOCAL_MEDIA",
  };
}

function buildPackageBudgetReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, ".."));
  const miniprogramRoot = path.join(projectRoot, "miniprogram");
  const budgets = options.budgets || readJson(path.join(miniprogramRoot, "config", "performance-budgets.json"));
  const projectConfig = readJson(path.join(miniprogramRoot, "project.config.json"));
  const appConfig = readJson(path.join(miniprogramRoot, "app.json"));
  const subpackageRoots = (appConfig.subPackages || appConfig.subpackages || [])
    .map((subpackage) => String(subpackage.root || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  const files = collectReleaseSourceFiles(miniprogramRoot, projectConfig.packOptions || {}).map((file) => ({
    ...file,
    bytes: fs.statSync(file.absolutePath).size,
  }));
  const buckets = new Map(subpackageRoots.map((root) => [root, []]));
  const mainFiles = [];
  files.forEach((file) => {
    const root = subpackageRoots.find((candidate) => file.relativePath.startsWith(`${candidate}/`));
    if (root) buckets.get(root).push(file);
    else mainFiles.push(file);
  });
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const mainBytes = mainFiles.reduce((sum, file) => sum + file.bytes, 0);
  const mainMediaBytes = mainFiles
    .filter((file) => MEDIA_PATTERN.test(file.relativePath))
    .reduce((sum, file) => sum + file.bytes, 0);
  const subpackages = Array.from(buckets, ([root, bucketFiles]) => {
    const bytes = bucketFiles.reduce((sum, file) => sum + file.bytes, 0);
    return {
      root,
      bytes,
      fileCount: bucketFiles.length,
      budget: evaluateMetric(bytes, packageLimits(budgets.packages.singleSubpackage)),
    };
  });
  const localMedia = files.filter((file) => MEDIA_PATTERN.test(file.relativePath)).map((file) => {
    const limits = imageLimits(file.relativePath, budgets);
    return {
      path: file.relativePath,
      bytes: file.bytes,
      category: limits.category,
      budget: evaluateMetric(file.bytes, limits),
    };
  });
  const evidenceClass = options.evidenceClass || "LEGACY_NON_FORMAL_BASELINE";
  const blocking = [
    evaluateMetric(mainBytes, packageLimits(budgets.packages.main)),
    evaluateMetric(totalBytes, packageLimits(budgets.packages.total)),
    evaluateMetric(mainMediaBytes, packageLimits(budgets.packages.mainLocalMedia)),
    ...subpackages.map((item) => item.budget),
    ...localMedia.map((item) => item.budget),
  ].some((item) => item.status === "BLOCK");
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    evidenceClass,
    releaseGateEligible: evidenceClass === "FORMAL_LAUNCH_CANDIDATE" && !blocking,
    packageState: "LOCAL_SOURCE_ESTIMATE",
    status: blocking ? "BLOCK" : "PASS",
    baseLibrary: budgets.baseLibrary,
    packages: {
      main: {
        bytes: mainBytes,
        fileCount: mainFiles.length,
        budget: evaluateMetric(mainBytes, packageLimits(budgets.packages.main)),
      },
      subpackages,
      total: {
        bytes: totalBytes,
        fileCount: files.length,
        budget: evaluateMetric(totalBytes, packageLimits(budgets.packages.total)),
      },
      mainLocalMedia: {
        bytes: mainMediaBytes,
        fileCount: mainFiles.filter((file) => MEDIA_PATTERN.test(file.relativePath)).length,
        budget: evaluateMetric(mainMediaBytes, packageLimits(budgets.packages.mainLocalMedia)),
      },
    },
    globalDependencies: {
      componentCount: Object.keys(appConfig.usingComponents || {}).length,
      components: Object.keys(appConfig.usingComponents || {}).sort(),
    },
    localMedia,
    warnings: evidenceClass === "LEGACY_NON_FORMAL_BASELINE"
      ? ["旧产品数据不得作为正式上线 Gate 通过证据", "微信构建产物体积仍需由开发者工具回读"]
      : ["本地源码估算必须与微信构建产物报告交叉验证"],
  });
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function aggregateJourneyEvents(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    if (!event || !Number.isFinite(event.durationMs)) return;
    const key = [
      event.version,
      event.platform,
      event.osVersion,
      event.wechatVersion,
      event.baseLibraryVersion,
      event.deviceTier,
      event.networkType,
      event.entry,
      event.packageState,
      event.name,
      event.page || event.route || "",
    ].map((value) => String(value || "UNKNOWN")).join("|");
    const group = groups.get(key) || { key, samples: [], dimensions: {} };
    group.samples.push(event.durationMs);
    group.dimensions = {
      version: event.version || "UNKNOWN",
      platform: event.platform || "UNKNOWN",
      osVersion: event.osVersion || "UNKNOWN",
      wechatVersion: event.wechatVersion || "UNKNOWN",
      baseLibraryVersion: event.baseLibraryVersion || "UNKNOWN",
      deviceTier: event.deviceTier || "UNKNOWN",
      networkType: event.networkType || "UNKNOWN",
      entry: event.entry || "UNKNOWN",
      packageState: event.packageState || "UNKNOWN",
      eventName: event.name || "UNKNOWN",
      target: event.page || event.route || "UNKNOWN",
    };
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    ...group.dimensions,
    sampleCount: group.samples.length,
    p75Ms: percentile(group.samples, 0.75),
    p95Ms: percentile(group.samples, 0.95),
    differenceConclusion: "NO_APPROVED_FORMAL_BASELINE",
  }));
}

function parseArgs(argv) {
  const options = { evidenceClass: "LEGACY_NON_FORMAL_BASELINE", eventsPath: "", outputPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--legacy") options.evidenceClass = "LEGACY_NON_FORMAL_BASELINE";
    else if (value === "--candidate") options.evidenceClass = "FORMAL_LAUNCH_CANDIDATE";
    else if (value === "--events") options.eventsPath = argv[++index];
    else if (value === "--output") options.outputPath = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, "..");
  const packageReport = buildPackageBudgetReport({ projectRoot, evidenceClass: options.evidenceClass });
  const events = options.eventsPath ? readJson(path.resolve(options.eventsPath)) : [];
  if (!Array.isArray(events)) throw new Error("Performance events file must contain an array");
  const journeys = aggregateJourneyEvents(events);
  const report = {
    ...packageReport,
    journeys,
    measurementStatus: options.evidenceClass === "LEGACY_NON_FORMAL_BASELINE"
      ? "NON_FORMAL_BASELINE_ONLY"
      : journeys.some((item) => item.sampleCount < 30)
        ? "BLOCKED_INSUFFICIENT_SAMPLES"
        : "CANDIDATE_SAMPLES_READY",
  };
  report.releaseGateEligible = packageReport.releaseGateEligible
    && report.measurementStatus === "CANDIDATE_SAMPLES_READY";
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) fs.writeFileSync(path.resolve(options.outputPath), output, "utf8");
  else process.stdout.write(output);
  if (options.evidenceClass === "FORMAL_LAUNCH_CANDIDATE"
    && (report.status === "BLOCK" || report.measurementStatus !== "CANDIDATE_SAMPLES_READY")) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Mini-program performance report failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  aggregateJourneyEvents,
  buildPackageBudgetReport,
  evaluateMetric,
  percentile,
};
