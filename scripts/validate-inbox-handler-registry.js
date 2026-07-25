#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  assertResolvedInboxHandlerRegistration,
  computeInboxHandlerAssemblyDigest,
  computeInboxHandlerDescriptorDigest,
  computeInboxHandlerRegistrationDigest,
  computeInboxHandlerRegistryDigest,
  computeInboxHandlerSourceDigest,
  createInboxHandlerRegistry,
} = require("../backend/src/inboxHandlerRegistry");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "inbox-handler-registry",
  "v1.0.0.json"
);
const SAFE_NODE_MODULES = Object.freeze(new Set(["node:crypto"]));
const NETWORK_MODULES = Object.freeze(new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:dns",
  "node:dns/promises",
]));

function validationError(code, sourcePath = null) {
  const error = new Error("Inbox Handler Registry validation failed");
  error.code = code;
  error.sourcePath = sourcePath;
  return error;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw validationError("INBOX_HANDLER_MANIFEST_UNAVAILABLE");
  }
}

function sourceBytes(repositoryRoot, sourcePath) {
  const resolved = path.resolve(repositoryRoot, sourcePath);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw validationError("INBOX_HANDLER_SOURCE_UNAVAILABLE", sourcePath);
  }
  if (real !== resolved || !real.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw validationError("INBOX_HANDLER_SOURCE_UNAVAILABLE", sourcePath);
  }
  return fs.readFileSync(real);
}

function resolveLocalSource(sourcePath, moduleName) {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), moduleName));
  return path.posix.extname(candidate) ? candidate : `${candidate}.js`;
}

function scanInboxHandlerSource(source, options = {}) {
  const sourcePath = options.sourcePath;
  const allowedSourcePaths = new Set(options.allowedSourcePaths || []);
  if (typeof sourcePath !== "string" || !sourcePath || !(Buffer.isBuffer(source) || typeof source === "string")) {
    throw validationError("INBOX_HANDLER_SOURCE_SCAN_INPUT_INVALID", sourcePath || null);
  }
  const text = Buffer.isBuffer(source) ? source.toString("utf8") : source;
  const forbidden = [
    ["INBOX_HANDLER_PROCESS_ENV_FORBIDDEN", /\bprocess\s*(?:\.\s*env|\[\s*["']env["']\s*\])/],
    ["INBOX_HANDLER_EVAL_FORBIDDEN", /\beval\s*\(/],
    ["INBOX_HANDLER_FUNCTION_CONSTRUCTOR_FORBIDDEN", /\b(?:new\s+)?Function\s*\(/],
    ["INBOX_HANDLER_DYNAMIC_IMPORT_FORBIDDEN", /\bimport\s*\(/],
    ["INBOX_HANDLER_NETWORK_GLOBAL_FORBIDDEN", /(?:\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(?|\[\s*["'](?:fetch|XMLHttpRequest|WebSocket|EventSource)["']\s*\])/],
  ];
  for (const [code, pattern] of forbidden) {
    if (pattern.test(text)) throw validationError(code, sourcePath);
  }

  const dependencies = [];
  const requireTokens = text.matchAll(/\brequire\b/g);
  for (const token of requireTokens) {
    const call = text.slice(token.index).match(/^require\s*\(\s*(["'])([^"']+)\1\s*\)/);
    if (!call) throw validationError("INBOX_HANDLER_DYNAMIC_REQUIRE_FORBIDDEN", sourcePath);
    const literal = call[2];
    const moduleName = literal;
    if (NETWORK_MODULES.has(moduleName)) {
      throw validationError("INBOX_HANDLER_NETWORK_MODULE_FORBIDDEN", sourcePath);
    }
    if (moduleName.startsWith("./") || moduleName.startsWith("../")) {
      const localSource = resolveLocalSource(sourcePath, moduleName);
      if (!allowedSourcePaths.has(localSource)) {
        throw validationError("INBOX_HANDLER_UNDECLARED_LOCAL_SOURCE", sourcePath);
      }
    } else if (!SAFE_NODE_MODULES.has(moduleName)) {
      throw validationError("INBOX_HANDLER_EXTERNAL_MODULE_FORBIDDEN", sourcePath);
    }
    dependencies.push(moduleName);
  }

  return Object.freeze({
    sourcePath,
    dependencyCount: dependencies.length,
    dependencies: Object.freeze([...dependencies].sort()),
  });
}

function validateProductionInboxHandlerRegistry(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || PROJECT_ROOT);
  const manifestPath = path.resolve(options.manifestPath || MANIFEST_PATH);
  const manifest = readJson(manifestPath);
  const registry = createInboxHandlerRegistry({ manifest });
  registry.assertReady();
  const description = registry.describe();
  if (description.scope !== "PRODUCTION") {
    throw validationError("INBOX_HANDLER_PRODUCTION_SCOPE_REQUIRED");
  }
  if (description.registryDigest !== computeInboxHandlerRegistryDigest(manifest)) {
    throw validationError("INBOX_HANDLER_REGISTRY_DIGEST_MISMATCH");
  }
  const assemblyReader = (sourcePath) => sourceBytes(repositoryRoot, sourcePath);
  if (description.assemblySourceDigest !== computeInboxHandlerAssemblyDigest(
    manifest.assemblySourcePaths,
    assemblyReader
  )) {
    throw validationError("INBOX_HANDLER_ASSEMBLY_DIGEST_MISMATCH");
  }

  const sources = [];
  const handlers = [];
  for (const entry of manifest.handlers) {
    const descriptor = entry.descriptor;
    const registration = assertResolvedInboxHandlerRegistration(registry.assertScope({
      consumerName: descriptor.consumerName,
      handlerVersion: descriptor.handlerVersion,
      sourceName: descriptor.sourceName,
      eventType: descriptor.eventType,
      schemaVersion: descriptor.schemaVersion,
      aggregateType: descriptor.aggregateType,
    }));
    const reader = (sourcePath) => sourceBytes(repositoryRoot, sourcePath);
    const actualSourceDigest = computeInboxHandlerSourceDigest(
      registration.descriptor.sourcePaths,
      reader,
      registration.registryScope
    );
    if (actualSourceDigest !== registration.descriptor.sourceDigest) {
      throw validationError("INBOX_HANDLER_SOURCE_DIGEST_MISMATCH");
    }
    if (computeInboxHandlerDescriptorDigest(registration.descriptor)
      !== registration.descriptor.descriptorDigest) {
      throw validationError("INBOX_HANDLER_DESCRIPTOR_DIGEST_MISMATCH");
    }
    if (computeInboxHandlerRegistrationDigest(entry, registration.assemblySourceDigest)
      !== registration.registrationDigest) {
      throw validationError("INBOX_HANDLER_REGISTRATION_DIGEST_MISMATCH");
    }
    for (const sourcePath of registration.descriptor.sourcePaths) {
      sources.push(scanInboxHandlerSource(reader(sourcePath), {
        sourcePath,
        allowedSourcePaths: registration.descriptor.sourcePaths,
      }));
    }
    handlers.push(Object.freeze({
      handlerId: registration.descriptor.handlerId,
      descriptorDigest: registration.descriptor.descriptorDigest,
      sourceDigest: registration.descriptor.sourceDigest,
      registrationDigest: registration.registrationDigest,
      applyStatementCount: registration.descriptor.applyStatementIds.length,
      verifyStatementCount: registration.descriptor.verifyStatementIds.length,
      outboxContractCount: registration.descriptor.outboxContractIds.length,
    }));
  }

  return Object.freeze({
    status: "PASS",
    scope: description.scope,
    registryVersion: description.registryVersion,
    registryDigest: description.registryDigest,
    assemblySourceDigest: description.assemblySourceDigest,
    handlerCount: handlers.length,
    sourceCount: sources.length,
    handlers: Object.freeze(handlers),
    sources: Object.freeze(sources),
  });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(validateProductionInboxHandlerRegistry(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error && error.code ? error.code : "INBOX_HANDLER_REGISTRY_VALIDATION_FAILED",
      sourcePath: error && error.sourcePath ? error.sourcePath : null,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  scanInboxHandlerSource,
  validateProductionInboxHandlerRegistry,
};
