#!/usr/bin/env node

const path = require("node:path");
const { loadAndValidateRegistry } = require("./lib/route-registry");

const projectRoot = path.resolve(__dirname, "..");
const result = loadAndValidateRegistry(
  path.join(projectRoot, "contracts/route-registry/v1.0.0-draft.8.json"),
  { appJsonPath: path.join(projectRoot, "miniprogram/app.json") },
);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  contractStatus: result.status,
  frozenLegacyManifestSha256: result.frozenLegacyManifestSha256,
  currentV1ManifestStatus: result.currentV1Manifest.manifestStatus,
  currentV1RegisteredPathCount: result.currentV1Manifest.registeredPaths.length,
  currentV1TabPaths: result.currentV1Manifest.tabPaths,
  registryVersion: result.registryVersion,
  routeCount: result.routes.length,
  logicalFieldCount: result.fieldNames.length,
  legacyRouteCount: result.legacyRegisteredPaths.length,
  legacyFallbackCount: result.legacyFallbackPaths.length,
  digest: result.digest,
}, null, 2)}\n`);
