const { version: packageVersion } = require("../package.json");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildRuntimeMetadata(env = process.env) {
  const version = text(packageVersion, "unknown");
  const configuredReleaseId = text(env.ROOT_RELEASE_ID);
  const adminPerformanceDatasetVersion = text(env.ROOT_ADMIN_PERFORMANCE_DATASET_VERSION);
  return {
    version,
    releaseId: configuredReleaseId || version,
    releaseIdConfigured: Boolean(configuredReleaseId),
    adminPerformanceDatasetVersion,
    adminPerformanceDatasetConfigured: Boolean(adminPerformanceDatasetVersion),
  };
}

module.exports = {
  buildRuntimeMetadata,
};
