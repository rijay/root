const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRuntimeMetadata } = require("../src/runtimeMetadata");

test("runtime metadata exposes package version and optional release id", () => {
  assert.deepEqual(buildRuntimeMetadata({}), {
    version: "0.5.12",
    releaseId: "0.5.12",
    releaseIdConfigured: false,
  });
  assert.deepEqual(buildRuntimeMetadata({ ROOT_RELEASE_ID: "myroot-api-015" }), {
    version: "0.5.12",
    releaseId: "myroot-api-015",
    releaseIdConfigured: true,
  });
});
