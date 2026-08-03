const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const taskShareCompletionProjectionV1 = require("./inboxHandlers/taskShareCompletionProjectionV1");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "inbox-handler-registry",
  "v1.0.0.json"
);
const SOURCE_DIGEST_DOMAIN = "myroot-inbox-handler-source:v1";
const ASSEMBLY_DIGEST_DOMAIN = "myroot-inbox-handler-assembly:v1";
const DESCRIPTOR_DIGEST_DOMAIN = "myroot-inbox-handler-descriptor:v1";
const REGISTRATION_DIGEST_DOMAIN = "myroot-inbox-handler-registration:v1";
const REGISTRY_DIGEST_DOMAIN = "myroot-inbox-handler-registry:v1";
const RESOLVED_HANDLER_BRAND = Symbol("myroot.resolvedInboxHandlerRegistration");
const REGISTRY_SCOPES = Object.freeze(["PRODUCTION", "TEST_ONLY"]);
const STATEMENT_PHASES = Object.freeze(["APPLY_READ", "APPLY_WRITE", "VERIFY_READ"]);
const RESULT_MODES = Object.freeze([
  "ROWS",
  "AFFECTED_ONE",
  "AFFECTED_ZERO_OR_ONE",
]);
const PARAMETER_TYPES = Object.freeze(["TEXT", "INTEGER", "SHA256", "MYSQL_DATETIME"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const PRODUCTION_IMPLEMENTATIONS = Object.freeze({
  "task-share-completion-projection-v1": taskShareCompletionProjectionV1,
});

function registryError(code = "INBOX_HANDLER_REGISTRY_INVALID") {
  const error = new Error("Inbox Handler Registry is invalid");
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function exactText(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim();
}

function opaqueId(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { throw registryError(); }
}

function sha256(domain, value) {
  return crypto.createHash("sha256").update(`${domain}\0`, "utf8").update(value).digest("hex");
}

function sortedUnique(values) {
  return Array.isArray(values)
    && values.length === new Set(values).size
    && values.every((value, index) => index === 0 || values[index - 1] < value);
}

function validateRelativeSourcePath(sourcePath, scope) {
  if (!exactText(sourcePath, 240)
    || path.isAbsolute(sourcePath)
    || sourcePath.includes("\\")
    || sourcePath.split("/").some((part) => !part || part === "." || part === "..")) throw registryError();
  const allowedPrefix = scope === "PRODUCTION"
    ? "backend/src/inboxHandlers/"
    : "backend/tests/fixtures/";
  if (!sourcePath.startsWith(allowedPrefix) || !sourcePath.endsWith(".js")) throw registryError();
  return sourcePath;
}

function defaultSourceReader(sourcePath) {
  const resolved = path.resolve(REPOSITORY_ROOT, sourcePath);
  let real;
  try { real = fs.realpathSync(resolved); } catch { throw registryError("INBOX_HANDLER_SOURCE_UNAVAILABLE"); }
  if (real !== resolved || !real.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw registryError("INBOX_HANDLER_SOURCE_UNAVAILABLE");
  }
  return fs.readFileSync(real);
}

function computeInboxHandlerSourceDigest(sourcePaths, sourceReader, scope) {
  if (!sortedUnique(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 16) throw registryError();
  const hash = crypto.createHash("sha256").update(`${SOURCE_DIGEST_DOMAIN}\0`, "utf8");
  for (const sourcePath of sourcePaths) {
    validateRelativeSourcePath(sourcePath, scope);
    let bytes;
    try { bytes = sourceReader(sourcePath); } catch { throw registryError("INBOX_HANDLER_SOURCE_UNAVAILABLE"); }
    if (!(Buffer.isBuffer(bytes) || typeof bytes === "string")) throw registryError();
    const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
    hash.update(sourcePath, "utf8").update("\0").update(sourceHash, "utf8").update("\0");
  }
  return hash.digest("hex");
}

function computeInboxHandlerAssemblyDigest(sourcePaths, sourceReader) {
  if (!sortedUnique(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 8) throw registryError();
  const hash = crypto.createHash("sha256").update(`${ASSEMBLY_DIGEST_DOMAIN}\0`, "utf8");
  for (const sourcePath of sourcePaths) {
    if (!exactText(sourcePath, 240)
      || path.isAbsolute(sourcePath)
      || sourcePath.includes("\\")
      || sourcePath.split("/").some((part) => !part || part === "." || part === "..")
      || !sourcePath.startsWith("backend/src/")
      || !sourcePath.endsWith(".js")) throw registryError();
    let bytes;
    try { bytes = sourceReader(sourcePath); } catch { throw registryError("INBOX_HANDLER_ASSEMBLY_UNAVAILABLE"); }
    if (!(Buffer.isBuffer(bytes) || typeof bytes === "string")) throw registryError();
    const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
    hash.update(sourcePath, "utf8").update("\0").update(sourceHash, "utf8").update("\0");
  }
  return hash.digest("hex");
}

const DESCRIPTOR_KEYS = Object.freeze([
  "descriptorVersion",
  "handlerId",
  "ownerModule",
  "consumerName",
  "handlerVersion",
  "sourceName",
  "eventType",
  "schemaVersion",
  "aggregateType",
  "kind",
  "replaySafe",
  "applyStatementIds",
  "applyExecutionProfiles",
  "verifyStatementIds",
  "requiredVerifyStatementIds",
  "outboxContractIds",
  "sourcePaths",
  "sourceDigest",
  "descriptorDigest",
]);

function descriptorDigestPayload(descriptor) {
  const payload = {};
  for (const key of DESCRIPTOR_KEYS) {
    if (key !== "descriptorDigest") payload[key] = descriptor[key];
  }
  return payload;
}

function computeInboxHandlerDescriptorDigest(descriptor) {
  return sha256(DESCRIPTOR_DIGEST_DOMAIN, canonicalJson(descriptorDigestPayload(descriptor)));
}

function normalizedHandlerDefinition(handler) {
  const compareOpaqueIds = (left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  );
  return {
    descriptor: handler.descriptor,
    statements: [...handler.statements].sort((left, right) => compareOpaqueIds(
      left.statementId,
      right.statementId
    )),
    outboxContracts: [...handler.outboxContracts]
      .sort((left, right) => compareOpaqueIds(left.contractId, right.contractId)),
  };
}

function computeInboxHandlerRegistrationDigest(handler, assemblySourceDigest) {
  if (!plainRecord(handler) || !SHA256_PATTERN.test(assemblySourceDigest)) throw registryError();
  return sha256(REGISTRATION_DIGEST_DOMAIN, canonicalJson({
    assemblySourceDigest,
    handler: normalizedHandlerDefinition(handler),
  }));
}

function computeInboxHandlerRegistryDigest(manifest) {
  if (!plainRecord(manifest)) throw registryError();
  const normalized = {
    ...manifest,
    handlers: Array.isArray(manifest.handlers)
      ? [...manifest.handlers]
        .map(normalizedHandlerDefinition)
        .sort((left, right) => (
          left.descriptor.handlerId < right.descriptor.handlerId
            ? -1
            : left.descriptor.handlerId > right.descriptor.handlerId ? 1 : 0
        ))
      : manifest.handlers,
  };
  return sha256(REGISTRY_DIGEST_DOMAIN, canonicalJson(normalized));
}

function validateParameterRule(rule, parameterName) {
  if (!exactKeys(rule, ["name", "type", "nullable", "maximumLength", "minimum", "maximum"])
    || rule.name !== parameterName
    || !PARAMETER_TYPES.includes(rule.type)
    || typeof rule.nullable !== "boolean") throw registryError();
  if (rule.type === "INTEGER") {
    if (rule.maximumLength !== null
      || !Number.isSafeInteger(rule.minimum)
      || !Number.isSafeInteger(rule.maximum)
      || rule.minimum > rule.maximum) throw registryError();
  } else if (!Number.isSafeInteger(rule.maximumLength)
    || rule.maximumLength < 1
    || rule.maximumLength > 8_192
    || rule.minimum !== null
    || rule.maximum !== null) throw registryError();
  if (rule.type === "SHA256" && rule.maximumLength !== 64) throw registryError();
  if (rule.type === "MYSQL_DATETIME" && rule.maximumLength !== 23) throw registryError();
  return deepFreeze(clone(rule));
}

function validateStatement(statement) {
  if (!exactKeys(statement, ["statementId", "phase", "sql", "parameterNames", "parameterRules", "resultMode"])
    || !opaqueId(statement.statementId, 128)
    || !STATEMENT_PHASES.includes(statement.phase)
    || !exactText(statement.sql, 8_192)
    || !Array.isArray(statement.parameterNames)
    || statement.parameterNames.length > 32
    || !sortedUnique([...statement.parameterNames].sort())
    || statement.parameterNames.some((name) => !opaqueId(name, 64))
    || !Array.isArray(statement.parameterRules)
    || statement.parameterRules.length !== statement.parameterNames.length
    || !RESULT_MODES.includes(statement.resultMode)) throw registryError();
  const sql = statement.sql.trim();
  const read = /^(?:SELECT)\b/i.test(sql);
  const write = /^(?:INSERT|UPDATE|DELETE)\b/i.test(sql);
  if ((statement.phase === "APPLY_WRITE" && !write)
    || (statement.phase !== "APPLY_WRITE" && !read)
    || (statement.phase === "VERIFY_READ" && /\bFOR\s+UPDATE\b/i.test(sql))
    || (statement.phase === "VERIFY_READ" && (
      /@|:=/.test(sql)
      || /\bLAST_INSERT_ID\s*\(/i.test(sql)
    ))
    || /;|--|#|\/\*/.test(sql)
    || /\b(?:COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT|START\s+TRANSACTION|BEGIN|SET|ALTER|CREATE|DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL|DO|HANDLER|LOAD\s+DATA|INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE|SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK|LOCK\s+TABLES|UNLOCK\s+TABLES)\b/i.test(sql)
    || /\b(?:outbox_event|inbox_receipt|consumer_checkpoint|event_dead_letter|command_idempotency|schema_migrations|store_snapshot)\b/i.test(sql)
    || (sql.match(/\?/g) || []).length !== statement.parameterNames.length) throw registryError();
  const normalized = clone(statement);
  normalized.parameterRules = statement.parameterRules.map((rule, index) => (
    validateParameterRule(rule, statement.parameterNames[index])
  ));
  return deepFreeze(normalized);
}

function validateDescriptor(input, statements, scope, sourceReader) {
  if (!exactKeys(input, DESCRIPTOR_KEYS)
    || input.descriptorVersion !== 1
    || !opaqueId(input.handlerId, 96)
    || !opaqueId(input.ownerModule, 96)
    || !exactText(input.consumerName, 128)
    || !opaqueId(input.handlerVersion, 64)
    || !exactText(input.sourceName, 96)
    || !exactText(input.eventType, 128)
    || !opaqueId(input.schemaVersion, 32)
    || !exactText(input.aggregateType, 96)
    || input.kind !== "DATABASE_ONLY"
    || input.replaySafe !== true
    || !sortedUnique(input.applyStatementIds)
    || input.applyStatementIds.length === 0
    || !Array.isArray(input.applyExecutionProfiles)
    || input.applyExecutionProfiles.length === 0
    || input.applyExecutionProfiles.some((profile) => (
      !Array.isArray(profile)
      || profile.length === 0
      || profile.length !== new Set(profile).size
      || profile.some((statementId) => !opaqueId(statementId, 128))
    ))
    || new Set(input.applyExecutionProfiles.map((profile) => profile.join("\0"))).size
      !== input.applyExecutionProfiles.length
    || input.applyExecutionProfiles.some((profile, index, profiles) => (
      index > 0 && profiles[index - 1].join("\0") >= profile.join("\0")
    ))
    || !sortedUnique(input.verifyStatementIds)
    || input.verifyStatementIds.length === 0
    || !sortedUnique(input.requiredVerifyStatementIds)
    || input.requiredVerifyStatementIds.length === 0
    || !sortedUnique(input.outboxContractIds)
    || !sortedUnique(input.sourcePaths)
    || !SHA256_PATTERN.test(input.sourceDigest)
    || !SHA256_PATTERN.test(input.descriptorDigest)) throw registryError();
  const statementById = new Map(statements.map((statement) => [statement.statementId, statement]));
  if (statementById.size !== statements.length
    || input.applyStatementIds.some((id) => !statementById.has(id)
      || !["APPLY_READ", "APPLY_WRITE"].includes(statementById.get(id).phase))
    || input.verifyStatementIds.some((id) => !statementById.has(id)
      || statementById.get(id).phase !== "VERIFY_READ")
    || input.applyExecutionProfiles.some((profile) => profile.some((id) => !input.applyStatementIds.includes(id)))
    || input.applyStatementIds.some((id) => !input.applyExecutionProfiles.some((profile) => profile.includes(id)))
    || input.requiredVerifyStatementIds.some((id) => !input.verifyStatementIds.includes(id))
    || statements.some((statement) => !input.applyStatementIds.includes(statement.statementId)
      && !input.verifyStatementIds.includes(statement.statementId))) throw registryError();
  const actualSourceDigest = computeInboxHandlerSourceDigest(input.sourcePaths, sourceReader, scope);
  if (actualSourceDigest !== input.sourceDigest
    || computeInboxHandlerDescriptorDigest(input) !== input.descriptorDigest) {
    throw registryError("INBOX_HANDLER_SOURCE_DRIFT");
  }
  return deepFreeze(clone(input));
}

function registrationKey(descriptor) {
  return canonicalJson({
    consumerName: descriptor.consumerName,
    handlerVersion: descriptor.handlerVersion,
    sourceName: descriptor.sourceName,
    eventType: descriptor.eventType,
    schemaVersion: descriptor.schemaVersion,
    aggregateType: descriptor.aggregateType,
  });
}

const RESOLVE_KEYS = Object.freeze([
  "consumerName",
  "handlerVersion",
  "sourceName",
  "eventType",
  "schemaVersion",
  "aggregateType",
]);

function normalizeResolveInput(input) {
  if (!exactKeys(input, RESOLVE_KEYS)
    || !exactText(input.consumerName, 128)
    || !opaqueId(input.handlerVersion, 64)
    || !exactText(input.sourceName, 96)
    || !exactText(input.eventType, 128)
    || !opaqueId(input.schemaVersion, 32)
    || !exactText(input.aggregateType, 96)) throw registryError("INBOX_HANDLER_SCOPE_INVALID");
  return input;
}

function buildRegistration({ manifest, handler, implementation, statements, descriptor, registryDigest }) {
  if (!plainRecord(implementation)
    || !exactKeys(implementation, ["apply", "verify", "outboxBuilders"])
    || typeof implementation.apply !== "function"
    || typeof implementation.verify !== "function"
    || !plainRecord(implementation.outboxBuilders)) throw registryError();
  const contracts = handler.outboxContracts.map((contract) => {
    if (!exactKeys(contract, [
      "contractId",
      "topic",
      "eventType",
      "schemaVersion",
      "sourceName",
      "maximumPerInvocation",
    ])
      || !opaqueId(contract.contractId, 128)
      || !exactText(contract.topic, 128)
      || !exactText(contract.eventType, 128)
      || !opaqueId(contract.schemaVersion, 32)
      || !exactText(contract.sourceName, 96)
      || !Number.isSafeInteger(contract.maximumPerInvocation)
      || contract.maximumPerInvocation < 1
      || contract.maximumPerInvocation > 32
      || typeof implementation.outboxBuilders[contract.contractId] !== "function") throw registryError();
    return deepFreeze({ ...clone(contract), build: implementation.outboxBuilders[contract.contractId] });
  });
  if (new Set(contracts.map((contract) => contract.contractId)).size !== contracts.length
    || Object.keys(implementation.outboxBuilders).sort().join("\0")
      !== contracts.map((contract) => contract.contractId).sort().join("\0")
    || descriptor.outboxContractIds.join("\0")
      !== contracts.map((contract) => contract.contractId).sort().join("\0")) throw registryError();
  const registration = {
    registryScope: manifest.scope,
    registryVersion: manifest.registryVersion,
    registryDigest,
    assemblySourceDigest: manifest.assemblySourceDigest,
    registrationDigest: computeInboxHandlerRegistrationDigest({
      descriptor,
      statements,
      outboxContracts: handler.outboxContracts,
    }, manifest.assemblySourceDigest),
    descriptor,
    statements: deepFreeze(statements),
    outboxContracts: deepFreeze(contracts),
    apply: implementation.apply,
    verify: implementation.verify,
  };
  Object.defineProperty(registration, RESOLVED_HANDLER_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(registration);
}

function createInboxHandlerRegistry(options = {}) {
  if (!plainRecord(options)
    || Object.keys(options).some((key) => !["manifest", "implementations", "sourceReader"].includes(key))) {
    throw registryError();
  }
  let manifest;
  try {
    manifest = options.manifest === undefined
      ? JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"))
      : clone(options.manifest);
  } catch {
    throw registryError("INBOX_HANDLER_MANIFEST_UNAVAILABLE");
  }
  const implementations = options.implementations === undefined
    ? PRODUCTION_IMPLEMENTATIONS
    : options.implementations;
  const sourceReader = options.sourceReader || defaultSourceReader;
  if (!exactKeys(manifest, [
    "registryVersion",
    "scope",
    "assemblySourcePaths",
    "assemblySourceDigest",
    "handlers",
  ])
    || manifest.registryVersion !== 1
    || !REGISTRY_SCOPES.includes(manifest.scope)
    || !Array.isArray(manifest.handlers)
    || manifest.handlers.length === 0
    || manifest.handlers.length > 32
    || !plainRecord(implementations)
    || typeof sourceReader !== "function"
    || (options.manifest === undefined && manifest.scope !== "PRODUCTION")) throw registryError();
  const actualAssemblySourceDigest = computeInboxHandlerAssemblyDigest(
    manifest.assemblySourcePaths,
    sourceReader
  );
  if (!SHA256_PATTERN.test(manifest.assemblySourceDigest)
    || actualAssemblySourceDigest !== manifest.assemblySourceDigest) {
    throw registryError("INBOX_HANDLER_ASSEMBLY_DRIFT");
  }

  const registryDigest = computeInboxHandlerRegistryDigest(manifest);
  const registrations = new Map();
  const handlerIds = new Set();
  for (const handler of manifest.handlers) {
    if (!exactKeys(handler, ["descriptor", "statements", "outboxContracts"])
      || !Array.isArray(handler.statements)
      || handler.statements.length === 0
      || !Array.isArray(handler.outboxContracts)) throw registryError();
    const statements = handler.statements.map(validateStatement);
    const descriptor = validateDescriptor(handler.descriptor, statements, manifest.scope, sourceReader);
    const implementation = implementations[descriptor.handlerId];
    if (handlerIds.has(descriptor.handlerId)) throw registryError();
    handlerIds.add(descriptor.handlerId);
    const key = registrationKey(descriptor);
    if (registrations.has(key)) throw registryError();
    registrations.set(key, buildRegistration({
      manifest,
      handler,
      implementation,
      statements,
      descriptor,
      registryDigest,
    }));
  }
  if (Object.keys(implementations).sort().join("\0") !== [...handlerIds].sort().join("\0")) throw registryError();

  function resolve(input) {
    const normalized = normalizeResolveInput(input);
    return registrations.get(canonicalJson(normalized)) || null;
  }

  const registry = {
    assertReady() { return true; },
    assertScope(input) {
      const registration = resolve(input);
      if (!registration) throw registryError("INBOX_HANDLER_NOT_REGISTERED");
      return registration;
    },
    describe() {
      return deepFreeze({
        ready: true,
        scope: manifest.scope,
        registryVersion: manifest.registryVersion,
        registryDigest,
        assemblySourceDigest: manifest.assemblySourceDigest,
        handlerCount: registrations.size,
        handlers: [...registrations.values()].map((registration) => ({
          handlerId: registration.descriptor.handlerId,
          consumerName: registration.descriptor.consumerName,
          handlerVersion: registration.descriptor.handlerVersion,
          sourceName: registration.descriptor.sourceName,
          eventType: registration.descriptor.eventType,
          schemaVersion: registration.descriptor.schemaVersion,
          aggregateType: registration.descriptor.aggregateType,
          descriptorDigest: registration.descriptor.descriptorDigest,
          sourceDigest: registration.descriptor.sourceDigest,
          registrationDigest: registration.registrationDigest,
        })),
      });
    },
    resolve,
  };
  return deepFreeze(registry);
}

let defaultRegistry;
function getDefaultInboxHandlerRegistry() {
  if (!defaultRegistry) defaultRegistry = createInboxHandlerRegistry();
  return defaultRegistry;
}

function assertResolvedInboxHandlerRegistration(value) {
  if (!plainRecord(value)
    || value[RESOLVED_HANDLER_BRAND] !== true
    || !exactKeys(value, [
      "registryScope",
      "registryVersion",
      "registryDigest",
      "assemblySourceDigest",
      "registrationDigest",
      "descriptor",
      "statements",
      "outboxContracts",
      "apply",
      "verify",
    ])) throw registryError();
  return value;
}

module.exports = {
  assertResolvedInboxHandlerRegistration,
  computeInboxHandlerAssemblyDigest,
  computeInboxHandlerDescriptorDigest,
  computeInboxHandlerRegistrationDigest,
  computeInboxHandlerRegistryDigest,
  computeInboxHandlerSourceDigest,
  createInboxHandlerRegistry,
  getDefaultInboxHandlerRegistry,
};
