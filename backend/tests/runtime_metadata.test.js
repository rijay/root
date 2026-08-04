const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRuntimeMetadata } = require("../src/runtimeMetadata");

test("runtime metadata exposes package version and optional release id", () => {
  assert.deepEqual(buildRuntimeMetadata({}), {
    version: "0.5.13",
    releaseId: "0.5.13",
    releaseIdConfigured: false,
    adminPerformanceDatasetVersion: "",
    adminPerformanceDatasetConfigured: false,
  });
  assert.deepEqual(buildRuntimeMetadata({
    ROOT_RELEASE_ID: "myroot-api-015",
    ROOT_ADMIN_PERFORMANCE_DATASET_VERSION: "ADMIN_PERFORMANCE_R0",
  }), {
    version: "0.5.13",
    releaseId: "myroot-api-015",
    releaseIdConfigured: true,
    adminPerformanceDatasetVersion: "ADMIN_PERFORMANCE_R0",
    adminPerformanceDatasetConfigured: true,
  });
});
