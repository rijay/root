const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const taskShareShadowReplayV1 = require("./inboxReplayExecutors/taskShareShadowReplayV1");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "inbox-replay-executor-registry",
  "v1.0.0.json"
);
const SOURCE_DOMAIN = "myroot-inbox-replay-executor-source:v1";
const ASSEMBLY_DOMAIN = "myroot-inbox-replay-executor-assembly:v1";
const DESCRIPTOR_DOMAIN = "myroot-inbox-replay-executor-descriptor:v1";
const REGISTRATION_DOMAIN = "myroot-inbox-replay-executor-registration:v1";
const REGISTRY_DOMAIN = "myroot-inbox-replay-executor-registry:v1";
const STATEMENT_SQL_DOMAIN = "myroot-inbox-replay-statement-sql:v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRODUCTION_REGISTRATIONS = new WeakSet();
const SHADOW_TABLE = "task_share_completion_shadow_projection";
const STATEMENT_CONTRACTS = Object.freeze({
  "task_share_shadow.insert.v1": Object.freeze({
    phase: "APPLY_WRITE",
    resultMode: "AFFECTED_ONE",
    placeholderCount: 18,
    sqlDigest: "72b4e24c6a582aedaa3e356098aefeabf80c24d18db2691b8602251b80ece12c",
  }),
  "task_share_shadow.select_conflicts_for_update.v1": Object.freeze({
    phase: "APPLY_READ",
    resultMode: "ROWS",
    placeholderCount: 5,
    sqlDigest: "c478baebb24160c21175f3607d87379aa7fb595761b1c4da8b5fb51859e852a6",
  }),
  "task_share_shadow.verify_by_run_receipt.v1": Object.freeze({
    phase: "VERIFY_READ",
    resultMode: "ROWS",
    placeholderCount: 2,
    sqlDigest: "569d7daba771c5c16111f74beb7145f24d44cc1d09ede2c4f02573d401d886a0",
  }),
});
const PRODUCTION_IMPLEMENTATIONS = Object.freeze({
  "task-share-completion-shadow-v1": taskShareShadowReplayV1,
});

function registryError(code = "INBOX_REPLAY_EXECUTOR_REGISTRY_INVALID") {
  const error = new Error("Inbox replay executor Registry is invalid");
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
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function opaqueAscii(value, maximumLength) {
  return exactText(value, maximumLength) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function sourceReader(sourcePath) {
  const absolute = path.resolve(REPOSITORY_ROOT, sourcePath);
  if (!absolute.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw registryError();
  return fs.readFileSync(absolute);
}

function validateSourcePaths(paths, requiredPrefix) {
  if (!Array.isArray(paths) || paths.length === 0
    || paths.some((entry, index) => !exactText(entry, 256)
      || path.isAbsolute(entry) || entry.includes("..") || !entry.startsWith(requiredPrefix)
      || (index > 0 && paths[index - 1] >= entry))) throw registryError();
  return paths;
}

function computeInboxReplayExecutorSourceDigest(paths, read = sourceReader) {
  validateSourcePaths(paths, "backend/src/inboxReplayExecutors/");
  const hash = crypto.createHash("sha256").update(`${SOURCE_DOMAIN}\0`, "utf8");
  for (const sourcePath of paths) {
    const bytes = read(sourcePath);
    if (!Buffer.isBuffer(bytes)) throw registryError();
    hash.update(sourcePath, "utf8").update("\0", "utf8").update(bytes).update("\0", "utf8");
  }
  return hash.digest("hex");
}

function computeInboxReplayExecutorAssemblyDigest(paths, read = sourceReader) {
  validateSourcePaths(paths, "backend/src/");
  const hash = crypto.createHash("sha256").update(`${ASSEMBLY_DOMAIN}\0`, "utf8");
  for (const sourcePath of paths) {
    const bytes = read(sourcePath);
    if (!Buffer.isBuffer(bytes)) throw registryError();
    hash.update(sourcePath, "utf8").update("\0", "utf8").update(bytes).update("\0", "utf8");
  }
  return hash.digest("hex");
}

function descriptorPayload(descriptor) {
  const payload = clone(descriptor);
  delete payload.sourceDigest;
  delete payload.descriptorDigest;
  return payload;
}

function computeInboxReplayExecutorDescriptorDigest(descriptor) {
  return digest(DESCRIPTOR_DOMAIN, descriptorPayload(descriptor));
}

function computeInboxReplayExecutorRegistrationDigest(executor, assemblySourceDigest) {
  return digest(REGISTRATION_DOMAIN, {
    descriptor: executor.descriptor,
    statements: executor.statements,
    assemblySourceDigest,
  });
}

function computeInboxReplayExecutorRegistryDigest(manifest) {
  return digest(REGISTRY_DOMAIN, manifest);
}

function computeInboxReplayStatementSqlDigest(sql) {
  if (!exactText(sql, 8_192)) throw registryError();
  return crypto.createHash("sha256")
    .update(`${STATEMENT_SQL_DOMAIN}\0`, "utf8")
    .update(sql, "utf8")
    .digest("hex");
}

function placeholderCount(sql) {
  let count = 0;
  for (const character of sql) if (character === "?") count += 1;
  return count;
}

function validateStatementSql(statement, contract) {
  if (/[;#`'\"]|--|\/\*|\*\//.test(statement.sql)
    || /\b(?:WITH|UNION|INTERSECT|EXCEPT)\b/i.test(statement.sql)
    || /\(\s*SELECT\b/i.test(statement.sql)
    || computeInboxReplayStatementSqlDigest(statement.sql) !== contract.sqlDigest
    || statement.sqlDigest !== contract.sqlDigest
    || statement.placeholderCount !== contract.placeholderCount
    || placeholderCount(statement.sql) !== contract.placeholderCount) throw registryError();
  const tables = [...statement.sql.matchAll(
    /\b(?:FROM|JOIN|INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
  )].map((match) => match[1]);
  if (tables.length !== 1 || tables[0] !== SHADOW_TABLE) throw registryError();
}

function validateParameterRule(rule, expectedName) {
  if (!exactKeys(rule, ["name", "type", "nullable", "maximumLength", "minimum", "maximum"])
    || rule.name !== expectedName || !["TEXT", "INTEGER", "SHA256", "MYSQL_DATETIME"].includes(rule.type)
    || rule.nullable !== false
    || !(rule.maximumLength === null || Number.isSafeInteger(rule.maximumLength))
    || !(rule.minimum === null || Number.isSafeInteger(rule.minimum))
    || !(rule.maximum === null || Number.isSafeInteger(rule.maximum))) throw registryError();
  return deepFreeze(clone(rule));
}

function validateStatement(statement) {
  if (!exactKeys(statement, [
    "statementId", "phase", "sql", "sqlDigest", "placeholderCount",
    "parameterNames", "parameterRules", "resultMode",
  ]) || !opaqueAscii(statement.statementId, 128)
    || !["APPLY_READ", "APPLY_WRITE", "VERIFY_READ"].includes(statement.phase)
    || !exactText(statement.sql, 8_192)
    || !Array.isArray(statement.parameterNames)
    || !Array.isArray(statement.parameterRules)
    || statement.parameterNames.length !== statement.parameterRules.length
    || new Set(statement.parameterNames).size !== statement.parameterNames.length
    || !SHA256_PATTERN.test(statement.sqlDigest)
    || !Number.isSafeInteger(statement.placeholderCount)
    || !["ROWS", "AFFECTED_ONE"].includes(statement.resultMode)) throw registryError();
  const contract = STATEMENT_CONTRACTS[statement.statementId];
  if (!contract || statement.phase !== contract.phase
    || statement.resultMode !== contract.resultMode
    || statement.parameterNames.length !== contract.placeholderCount) throw registryError();
  validateStatementSql(statement, contract);
  const mutationScanSql = statement.phase === "APPLY_READ"
    ? statement.sql.replace(/\s+FOR UPDATE\s*$/i, "")
    : statement.sql;
  if (!/task_share_completion_shadow_projection/.test(statement.sql)
    || /\b(?:outbox_event|inbox_receipt|consumer_checkpoint|task_share_completion_projection)\b/i.test(
      statement.sql.replaceAll("task_share_completion_shadow_projection", "")
    )
    || /\b(?:UPDATE|DELETE|REPLACE|CALL|LOAD|GRANT|CREATE|ALTER|DROP)\b/i.test(mutationScanSql)
    || (statement.phase === "APPLY_WRITE" && !/^INSERT INTO /i.test(statement.sql))
    || (statement.phase !== "APPLY_WRITE" && !/^SELECT /i.test(statement.sql))) throw registryError();
  const parameterRules = statement.parameterRules.map((rule, index) => (
    validateParameterRule(rule, statement.parameterNames[index])
  ));
  return deepFreeze({ ...clone(statement), parameterRules });
}

function validateDescriptor(descriptor, statements, read) {
  if (!exactKeys(descriptor, [
    "descriptorVersion", "executorId", "executorVersion", "ownerModule", "policyId",
    "mode", "targetProjectionPolicy", "allowsOutbox", "allowsNetwork",
    "applyStatementIds", "applyExecutionProfiles", "verifyStatementIds",
    "requiredVerifyStatementIds", "sourcePaths", "sourceDigest", "descriptorDigest",
  ]) || descriptor.descriptorVersion !== 1
    || !opaqueAscii(descriptor.executorId, 96) || !opaqueAscii(descriptor.executorVersion, 64)
    || descriptor.ownerModule !== "TaskShareShadowReplayExecutor"
    || descriptor.policyId !== "TASK_SHARE_SHADOW_REBUILD_V1"
    || descriptor.mode !== "SHADOW_REBUILD"
    || descriptor.targetProjectionPolicy !== "SHADOW_GENERATION_GE_2"
    || descriptor.allowsOutbox !== false || descriptor.allowsNetwork !== false
    || !Array.isArray(descriptor.applyStatementIds)
    || !Array.isArray(descriptor.applyExecutionProfiles)
    || !Array.isArray(descriptor.verifyStatementIds)
    || !Array.isArray(descriptor.requiredVerifyStatementIds)
    || !SHA256_PATTERN.test(descriptor.sourceDigest)
    || !SHA256_PATTERN.test(descriptor.descriptorDigest)) throw registryError();
  validateSourcePaths(descriptor.sourcePaths, "backend/src/inboxReplayExecutors/");
  const byPhase = (phase) => statements.filter((entry) => entry.phase === phase)
    .map((entry) => entry.statementId).sort();
  const applyIds = [...byPhase("APPLY_READ"), ...byPhase("APPLY_WRITE")].sort();
  const verifyIds = byPhase("VERIFY_READ");
  if (descriptor.applyStatementIds.join("\0") !== applyIds.join("\0")
    || descriptor.verifyStatementIds.join("\0") !== verifyIds.join("\0")
    || descriptor.requiredVerifyStatementIds.join("\0") !== verifyIds.join("\0")
    || descriptor.applyExecutionProfiles.length !== 2
    || descriptor.applyExecutionProfiles[0].join("\0")
      !== "task_share_shadow.select_conflicts_for_update.v1"
    || descriptor.applyExecutionProfiles[1].join("\0") !== [
      "task_share_shadow.select_conflicts_for_update.v1",
      "task_share_shadow.insert.v1",
    ].join("\0")
    || computeInboxReplayExecutorSourceDigest(descriptor.sourcePaths, read) !== descriptor.sourceDigest
    || computeInboxReplayExecutorDescriptorDigest(descriptor) !== descriptor.descriptorDigest) {
    throw registryError("INBOX_REPLAY_EXECUTOR_SOURCE_DRIFT");
  }
  return deepFreeze(clone(descriptor));
}

function buildInboxReplayExecutorRegistry({ manifest, read, expectedScope, production }) {
  const implementations = PRODUCTION_IMPLEMENTATIONS;
  if (!exactKeys(manifest, [
    "registryVersion", "scope", "assemblySourcePaths", "assemblySourceDigest", "executors",
  ]) || manifest.registryVersion !== 1 || manifest.scope !== expectedScope
    || !Array.isArray(manifest.executors) || manifest.executors.length !== 1
    || !plainRecord(implementations) || typeof read !== "function"
    || !SHA256_PATTERN.test(manifest.assemblySourceDigest)
    || computeInboxReplayExecutorAssemblyDigest(manifest.assemblySourcePaths, read)
      !== manifest.assemblySourceDigest) throw registryError("INBOX_REPLAY_EXECUTOR_ASSEMBLY_DRIFT");

  const entry = manifest.executors[0];
  if (!exactKeys(entry, ["descriptor", "statements"])) throw registryError();
  if (entry.statements.map((statement) => statement.statementId).join("\0")
    !== Object.keys(STATEMENT_CONTRACTS).join("\0")) throw registryError();
  const statements = entry.statements.map(validateStatement);
  const descriptor = validateDescriptor(entry.descriptor, statements, read);
  const implementation = implementations[descriptor.executorId];
  if (!plainRecord(implementation) || !exactKeys(implementation, ["apply", "verify"])
    || typeof implementation.apply !== "function" || typeof implementation.verify !== "function"
    || Object.keys(implementations).join("\0") !== descriptor.executorId) throw registryError();
  const registryDigest = computeInboxReplayExecutorRegistryDigest(manifest);
  const registration = {
    registryVersion: manifest.registryVersion,
    registryDigest,
    assemblySourceDigest: manifest.assemblySourceDigest,
    descriptor,
    registrationDigest: computeInboxReplayExecutorRegistrationDigest(
      { descriptor, statements }, manifest.assemblySourceDigest
    ),
    statements: deepFreeze(statements),
    apply: implementation.apply,
    verify: implementation.verify,
  };
  if (production) {
    PRODUCTION_REGISTRATIONS.add(registration);
  }
  deepFreeze(registration);

  function resolve(input) {
    if (!exactKeys(input, ["executorId", "executorVersion", "policyId", "mode"])
      || input.executorId !== descriptor.executorId
      || input.executorVersion !== descriptor.executorVersion
      || input.policyId !== descriptor.policyId || input.mode !== descriptor.mode) return null;
    return registration;
  }

  return deepFreeze({
    assertReady() { return true; },
    describe() {
      return deepFreeze({
        ready: true,
        scope: manifest.scope,
        registryVersion: manifest.registryVersion,
        registryDigest,
        assemblySourceDigest: manifest.assemblySourceDigest,
        executorCount: 1,
        executors: [{
          executorId: descriptor.executorId,
          executorVersion: descriptor.executorVersion,
          policyId: descriptor.policyId,
          mode: descriptor.mode,
          descriptorDigest: descriptor.descriptorDigest,
          sourceDigest: descriptor.sourceDigest,
          registrationDigest: registration.registrationDigest,
        }],
      });
    },
    resolve,
  });
}

function createInboxReplayExecutorRegistry() {
  if (arguments.length !== 0) throw registryError();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"));
  } catch { throw registryError("INBOX_REPLAY_EXECUTOR_MANIFEST_UNAVAILABLE"); }
  return buildInboxReplayExecutorRegistry({
    manifest,
    read: sourceReader,
    expectedScope: "PRODUCTION",
    production: true,
  });
}

function validateInboxReplayExecutorRegistryForTest(options = {}) {
  if (!exactKeys(options, ["scope", "manifest", "sourceReader"])
    || options.scope !== "TEST_ONLY"
    || typeof options.sourceReader !== "function") throw registryError();
  const manifest = clone(options.manifest);
  if (manifest.scope !== "TEST_ONLY") throw registryError();
  return buildInboxReplayExecutorRegistry({
    manifest,
    read: options.sourceReader,
    expectedScope: "TEST_ONLY",
    production: false,
  });
}

let defaultRegistry;
function getDefaultInboxReplayExecutorRegistry() {
  if (!defaultRegistry) defaultRegistry = createInboxReplayExecutorRegistry();
  return defaultRegistry;
}

function assertResolvedInboxReplayExecutorRegistration(value) {
  if (!plainRecord(value) || !PRODUCTION_REGISTRATIONS.has(value)) throw registryError();
  return value;
}

module.exports = {
  assertResolvedInboxReplayExecutorRegistration,
  computeInboxReplayExecutorAssemblyDigest,
  computeInboxReplayExecutorDescriptorDigest,
  computeInboxReplayExecutorRegistrationDigest,
  computeInboxReplayExecutorRegistryDigest,
  computeInboxReplayExecutorSourceDigest,
  computeInboxReplayStatementSqlDigest,
  createInboxReplayExecutorRegistry,
  getDefaultInboxReplayExecutorRegistry,
  validateInboxReplayExecutorRegistryForTest,
};
