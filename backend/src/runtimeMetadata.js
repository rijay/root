const { version: packageVersion } = require("../package.json");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildRuntimeMetadata(env = process.env) {
  const version = text(packageVersion, "unknown");
  return {
    version,
    releaseId: text(env.ROOT_RELEASE_ID, version),
  };
}

module.exports = {
  buildRuntimeMetadata,
};
