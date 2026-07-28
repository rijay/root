const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const taskShare = require("./migrationContracts/taskShareSyntheticV1");

const PRODUCTION_REGISTRIES = new WeakSet();
const MANIFEST_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "contracts",
  "migration-contract-registry",
  "v1.0.0.json"
);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function registryError(code = "MIGRATION_CONTRACT_REGISTRY_INVALID") {
  const error = new Error("migration contract registry identity is invalid");
  error.code = code;
  return error;
}

const manifestWithoutDigest = {
  registryVersion: 1,
  scope: "PRODUCTION",
  contracts: [taskShare.descriptor],
};
const manifest = deepFreeze({
  ...manifestWithoutDigest,
  registryDigest: digest("myroot-migration-contract-registry:v1", manifestWithoutDigest),
});

function readCheckedManifest() {
  let checked;
  try { checked = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); } catch {
    throw registryError();
  }
  if (canonicalJson(checked) !== canonicalJson(manifest)) throw registryError();
  return manifest;
}

let defaultRegistry;

function createDefaultRegistry() {
  const checkedManifest = readCheckedManifest();
  const byId = new Map(checkedManifest.contracts.map((entry) => [entry.contractId, entry]));
  const registry = Object.freeze({
    describe() { return deepFreeze(clone(checkedManifest)); },
    assertScope(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join(",") !== "contractId,targetSchemaVersion"
        || typeof input.contractId !== "string"
        || typeof input.targetSchemaVersion !== "string") throw registryError();
      const descriptor = byId.get(input.contractId);
      if (!descriptor || descriptor.targetSchemaVersion !== input.targetSchemaVersion) {
        throw registryError("MIGRATION_CONTRACT_UNSUPPORTED");
      }
      return deepFreeze(clone({
        registryVersion: checkedManifest.registryVersion,
        registryDigest: checkedManifest.registryDigest,
        descriptor,
      }));
    },
  });
  PRODUCTION_REGISTRIES.add(registry);
  return registry;
}

function getDefaultMigrationContractRegistry() {
  if (!defaultRegistry) defaultRegistry = createDefaultRegistry();
  return defaultRegistry;
}

function assertProductionMigrationContractRegistry(registry) {
  if (!PRODUCTION_REGISTRIES.has(registry)) throw registryError();
  const described = registry.describe();
  if (described.registryDigest !== manifest.registryDigest
    || canonicalJson(described) !== canonicalJson(manifest)) throw registryError();
  return registry;
}

module.exports = Object.freeze({
  getDefaultMigrationContractRegistry,
  assertProductionMigrationContractRegistry,
});
