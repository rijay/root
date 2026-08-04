const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LOOPBACK_HOST = "127.0.0.1";
const MARKER_DATABASE = "myroot_schema_snapshot_sandbox_marker";
const AUTHENTICATED_READINESS_SQL = [
  "SELECT 1 AS `readiness_ok`",
  "VERSION() AS `mysql_version`",
  "CURRENT_USER() AS `authenticated_account`",
  "@@server_uuid AS `instance_uuid`",
].join(", ");
const RETRYABLE_READINESS_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ER_ACCESS_DENIED_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  "PROTOCOL_CONNECTION_LOST",
]);
const POST_SUCCESS_COMMANDS = Object.freeze([
  "npm run db:schema-snapshot:write",
  "npm run db:schema-snapshot:verify",
  "npm run verify -- --json",
]);
const EXECUTION_PLAN = Object.freeze([
  Object.freeze({ id: "REAL_ENGINE_TESTS", executable: "npm",
    args: Object.freeze(["run", "v1:mysql-001-068-authorized:check"]) }),
  Object.freeze({ id: "SCHEMA_SNAPSHOT_WRITE", executable: "node",
    args: Object.freeze(["backend/scripts/mysql-schema-snapshot.js", "--write"]) }),
  Object.freeze({ id: "SCHEMA_SNAPSHOT_VERIFY", executable: "node",
    args: Object.freeze(["backend/scripts/mysql-schema-snapshot.js", "--verify"]) }),
  Object.freeze({ id: "FINAL_REPOSITORY_VERIFY", executable: "node",
    args: Object.freeze(["scripts/final-verification.js", "--json"]) }),
]);
const FINAL_VERIFICATION_LABELS = Object.freeze([
  "formal route surface",
  "backend tests",
  "miniprogram formal scope and performance",
  "admin checks",
  "admin production build",
]);
const EXECUTION_INPUT_ROOTS = Object.freeze([
  "package.json",
  "admin",
  "backend",
  "cloudbaserc.json",
  "cloudfunctions",
  "contracts",
  "miniprogram",
  "scripts",
]);
const EXECUTION_INPUT_EXCLUDED_PATHS = Object.freeze([
  "admin/dist",
  "backend/data",
  "backend/db/schema.sql",
  "backend/public/admin-dist",
  "miniprogram/project.private.config.json",
  "scripts/cloudbase-clone-conditional-candidate.js",
]);
const MUTABLE_OUTPUT_PATHS = Object.freeze([
  "backend/db/schema.sql",
  "admin/dist",
  "backend/public/admin-dist",
]);
const EXECUTION_INPUT_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "build",
  "coverage",
  "miniprogram_npm",
  "node_modules",
]);
const CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL = 4096;
const CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABELS = 32;
const CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABEL_UTF8_BYTES = 512;
const CHILD_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "CI",
]);
const CHILD_FAILURE_DIAGNOSTIC_POLICY = Object.freeze({
  channels: Object.freeze(["stdout", "stderr"]),
  retention: "TAIL",
  maximumRetainedUtf8BytesPerChannel: CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL,
  digestInput: "FULL_REDACTED_CHANNEL",
  emptyOutputReason: "NO_CHILD_OUTPUT",
  secretVariants: Object.freeze(["RAW", "URI_COMPONENT", "JSON_ESCAPED", "BASE64", "BASE64URL"]),
  ansiAndControlCharactersStripped: true,
  ephemeralPortRedacted: true,
  structuredTapFailureLabels: Object.freeze({
    source: "FULL_REDACTED_STDOUT",
    maximumLabels: CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABELS,
    maximumUtf8BytesPerLabel: CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABEL_UTF8_BYTES,
  }),
});

function runnerError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ""));
}

function safeRelativeFile(root, relative) {
  const normalized = String(relative || "");
  if (!normalized || path.isAbsolute(normalized) || normalized.includes("\0")) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FILE_PATH_INVALID");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FILE_PATH_INVALID");
  }
  const segments = path.relative(resolvedRoot, resolved).split(path.sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw runnerError("MYSQL_LOCAL_RUNNER_FILE_PATH_SYMLINK", normalized);
    }
  }
  return resolved;
}

function assertFrozenFile(root, item, readFile = fs.readFileSync) {
  if (!item || !isSha256(item.sha256)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FROZEN_INPUT_INVALID");
  }
  const file = safeRelativeFile(root, item.file || item.path);
  if (fs.lstatSync(file).isSymbolicLink()) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FROZEN_INPUT_SYMLINK", item.file || item.path);
  }
  let bytes;
  try {
    bytes = readFile(file);
  } catch {
    throw runnerError("MYSQL_LOCAL_RUNNER_FROZEN_INPUT_MISSING", item.file || item.path);
  }
  if (sha256(bytes) !== item.sha256) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FROZEN_INPUT_DRIFT", item.file || item.path);
  }
}

function buildExecutionInputManifest(root, readFile = fs.readFileSync) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const excluded = new Set(EXECUTION_INPUT_EXCLUDED_PATHS);

  function visit(relative) {
    const normalized = relative.split(path.sep).join("/");
    if (excluded.has(normalized)) return;
    const absolute = safeRelativeFile(resolvedRoot, normalized);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      throw runnerError("MYSQL_LOCAL_RUNNER_EXECUTION_INPUT_MISSING", normalized);
    }
    if (stat.isSymbolicLink()) {
      throw runnerError("MYSQL_LOCAL_RUNNER_EXECUTION_INPUT_SYMLINK", normalized);
    }
    if (stat.isDirectory()) {
      if (EXECUTION_INPUT_EXCLUDED_DIRECTORY_NAMES.has(path.basename(normalized))) return;
      for (const entry of fs.readdirSync(absolute).sort()) {
        if (entry === ".DS_Store") continue;
        visit(path.posix.join(normalized, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      throw runnerError("MYSQL_LOCAL_RUNNER_EXECUTION_INPUT_TYPE_INVALID", normalized);
    }
    files.push(Object.freeze({ file: normalized, sha256: sha256(readFile(absolute)) }));
  }

  for (const relative of EXECUTION_INPUT_ROOTS) visit(relative);
  files.sort((left, right) => left.file.localeCompare(right.file));
  const digestInput = files.map((item) => `${item.file}\0${item.sha256}\n`).join("");
  return Object.freeze({
    schemaVersion: "myroot.local-mysql-execution-input-manifest.v1",
    roots: EXECUTION_INPUT_ROOTS,
    excludedPaths: EXECUTION_INPUT_EXCLUDED_PATHS,
    fileCount: files.length,
    aggregateSha256: sha256(Buffer.from(digestInput)),
  });
}

function buildExecutionToolchainBinding({ npmVersion, nodeExecutable = process.execPath,
  readFile = fs.readFileSync } = {}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(npmVersion || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_NPM_VERSION_INVALID");
  }
  const executable = path.resolve(nodeExecutable);
  if (fs.lstatSync(executable).isSymbolicLink()) {
    throw runnerError("MYSQL_LOCAL_RUNNER_NODE_EXECUTABLE_SYMLINK");
  }
  return Object.freeze({
    schemaVersion: "myroot.local-mysql-toolchain-binding.v1",
    nodeVersion: process.version,
    nodePlatform: process.platform,
    nodeArch: process.arch,
    nodeExecutableSha256: sha256(readFile(executable)),
    npmVersion: String(npmVersion),
  });
}

function validateAuthorizationPacket({
  root,
  packetBytes,
  expectedSha256,
  readFile = fs.readFileSync,
  migrationDescriptor,
  runtimeToolchainBinding,
}) {
  if (!isSha256(expectedSha256) || sha256(packetBytes) !== expectedSha256) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_SHA_MISMATCH");
  }
  let packet;
  try {
    packet = JSON.parse(packetBytes.toString("utf8"));
  } catch {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_JSON_INVALID");
  }
  if (packet.schemaVersion !== "myroot.local-mysql-authorization-packet.v19"
    || packet.status !== "PREPARED_NOT_AUTHORIZED_NOT_EXECUTED"
    || packet.releaseVersion !== "v1.0.0"
    || packet.runtimePackageVersion !== "0.5.13"
    || packet.scope?.host !== LOOPBACK_HOST
    || packet.scope?.port !== "EPHEMERAL_RANDOM_HOST_PORT"
    || packet.scope?.candidateConnectionAuthorized !== false
    || packet.scope?.productionConnectionAuthorized !== false
    || packet.scope?.deploymentAuthorized !== false
    || packet.scope?.commitAuthorized !== false
    || packet.scope?.pushAuthorized !== false) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_SCOPE_INVALID");
  }
  if (packet.container?.bindAddress !== LOOPBACK_HOST
    || packet.container?.removeAfterRun !== true
    || packet.container?.sandboxMarkerDatabase !== MARKER_DATABASE
    || !/^mysql:8\.0\.43@sha256:[0-9a-f]{64}$/.test(String(packet.container?.image || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_POLICY_INVALID");
  }
  if (!/^npm run [a-z0-9:_-]+$/.test(String(packet.executionCommand || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_COMMAND_INVALID");
  }
  if (JSON.stringify(packet.postSuccessCommands) !== JSON.stringify(POST_SUCCESS_COMMANDS)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_POST_SUCCESS_COMMANDS_INVALID");
  }
  if (JSON.stringify(packet.executionPlan) !== JSON.stringify(EXECUTION_PLAN)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_EXECUTION_PLAN_INVALID");
  }
  if (JSON.stringify(packet.mutableOutputs) !== JSON.stringify(MUTABLE_OUTPUT_PATHS)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_MUTABLE_OUTPUT_POLICY_INVALID");
  }
  const packagePath = path.join(path.resolve(root), "package.json");
  const packageBytes = readFile(packagePath);
  if (packet.executionPolicy?.testFileConcurrency !== 1
    || packet.executionPolicy?.packageJsonSha256 !== sha256(packageBytes)
    || packet.executionPolicy?.authenticatedReadinessSqlSha256
      !== sha256(Buffer.from(AUTHENTICATED_READINESS_SQL))
    || JSON.stringify(packet.executionPolicy?.childFailureDiagnostic)
      !== JSON.stringify(CHILD_FAILURE_DIAGNOSTIC_POLICY)
    || packet.executionPolicy?.childEnvironment?.inheritance !== "ALLOWLIST_ONLY"
    || JSON.stringify(packet.executionPolicy?.childEnvironment?.allowlist)
      !== JSON.stringify(CHILD_ENV_ALLOWLIST)
    || packet.executionPolicy?.childEnvironment?.explicitOverlay
      !== "FROZEN_TEST_ENABLE_VARIABLES_AND_SANDBOX_MYSQL_ONLY") {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKAGE_DRIFT");
  }
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  const scriptName = packet.executionCommand.slice("npm run ".length);
  const script = packageJson.scripts?.[scriptName];
  if (typeof script !== "string" || !script.includes("--test-concurrency=1")
    || !script.includes("--test-reporter=tap")) {
    throw runnerError("MYSQL_LOCAL_RUNNER_COMMAND_DRIFT");
  }
  const frozenTestFiles = packet.testGroups?.map((item) => item.file) || [];
  const commandTestFiles = script.match(/backend\/tests\/[a-z0-9_]+\.integration\.test\.js/g) || [];
  if (frozenTestFiles.length !== 7
    || new Set(frozenTestFiles).size !== frozenTestFiles.length
    || frozenTestFiles[0] !== "backend/tests/mysql_local_readiness.integration.test.js"
    || JSON.stringify(commandTestFiles) !== JSON.stringify(frozenTestFiles)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_TEST_SET_DRIFT");
  }
  const frozenInputPaths = [
    ...frozenTestFiles,
    ...(packet.supportingInputs || []).map((item) => item.file),
    ...(packet.priorAttemptEvidence || []).map((item) => item.path),
  ];
  if (frozenInputPaths.some((item) => typeof item !== "string")
    || new Set(frozenInputPaths).size !== frozenInputPaths.length) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FROZEN_INPUT_DUPLICATE");
  }
  for (const item of packet.testGroups || []) assertFrozenFile(root, item, readFile);
  if (packet.requiredOutcomes?.allEnabledTests !== 13
    || packet.requiredOutcomes?.allEnabledTestsPass !== 13
    || packet.requiredOutcomes?.enabledTestsFail !== 0
    || packet.requiredOutcomes?.enabledTestsSkip !== 0) {
    throw runnerError("MYSQL_LOCAL_RUNNER_TEST_OUTCOME_CONTRACT_INVALID");
  }
  if (JSON.stringify(packet.requiredOutcomes?.finalVerificationLabels)
    !== JSON.stringify(FINAL_VERIFICATION_LABELS)
    || packet.requiredOutcomes?.finalVerificationPassed !== FINAL_VERIFICATION_LABELS.length
    || packet.requiredOutcomes?.finalVerificationFailed !== 0) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FINAL_OUTCOME_CONTRACT_INVALID");
  }
  for (const item of packet.supportingInputs || []) assertFrozenFile(root, item, readFile);
  const priorAttempts = Array.isArray(packet.priorAttemptEvidence)
    ? packet.priorAttemptEvidence
    : packet.priorAttemptEvidence ? [packet.priorAttemptEvidence] : [];
  for (const item of priorAttempts) assertFrozenFile(root, item, readFile);
  const actualExecutionInputManifest = buildExecutionInputManifest(root, readFile);
  if (JSON.stringify(packet.executionPolicy?.executionInputManifest)
    !== JSON.stringify(actualExecutionInputManifest)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_EXECUTION_INPUT_DRIFT");
  }
  if (!runtimeToolchainBinding
    || JSON.stringify(packet.executionPolicy?.toolchainBinding)
      !== JSON.stringify(runtimeToolchainBinding)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_TOOLCHAIN_DRIFT");
  }
  if (migrationDescriptor) {
    const migrations = migrationDescriptor.migrations || [];
    const expected = {
      first: migrations[0]?.file,
      last: migrations.at(-1)?.file,
      count: migrations.length,
      lastChecksum: migrations.at(-1)?.checksum,
      expectedDigest: migrationDescriptor.migrationSetDigest,
    };
    if (JSON.stringify(packet.migrationSet) !== JSON.stringify(expected)) {
      throw runnerError("MYSQL_LOCAL_RUNNER_MIGRATION_SET_DRIFT");
    }
  }
  return Object.freeze({ packet, scriptName });
}

function assertExternalAuthorization(env = process.env) {
  if (env.MYROOT_LOCAL_MYSQL_AUTHORIZED !== "true") {
    throw runnerError("MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED");
  }
  if (!isSha256(env.MYROOT_LOCAL_MYSQL_PACKET_SHA256)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_AUTHORIZED_SHA_INVALID");
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(env.MYROOT_LOCAL_MYSQL_AUTHORIZATION_NONCE || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_AUTHORIZED_NONCE_INVALID");
  }
  return Object.freeze({
    packetSha256: env.MYROOT_LOCAL_MYSQL_PACKET_SHA256,
    nonce: env.MYROOT_LOCAL_MYSQL_AUTHORIZATION_NONCE,
  });
}

function consumeAuthorization({ root, packetSha256, nonce }) {
  if (!isSha256(packetSha256) || !/^[0-9a-f-]{36}$/i.test(String(nonce || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_AUTHORIZATION_CONSUMPTION_INVALID");
  }
  const directory = path.join(path.resolve(root), ".local-state", "mysql-authorizations");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${packetSha256}-${nonce}.consumed`);
  try {
    fs.writeFileSync(file, `${new Date().toISOString()}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") throw runnerError("MYSQL_LOCAL_RUNNER_AUTHORIZATION_ALREADY_CONSUMED");
    throw error;
  }
  return file;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== "--packet" || !argv[1]) {
    throw runnerError(
      "MYSQL_LOCAL_RUNNER_USAGE_INVALID",
      "Usage: mysql-local-authorized-runner.js --packet <repository-relative-json>"
    );
  }
  return Object.freeze({ packet: argv[1] });
}

function resolvePacketPath(root, relative) {
  if (!/^docs\/evidence\/v1\.0\.0\/[a-z0-9_.-]+\.json$/.test(String(relative || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_PATH_INVALID");
  }
  let file;
  try {
    file = safeRelativeFile(root, relative);
  } catch (error) {
    if (error.code === "MYSQL_LOCAL_RUNNER_FILE_PATH_SYMLINK") {
      throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_SYMLINK");
    }
    throw error;
  }
  if (fs.lstatSync(file).isSymbolicLink()) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PACKET_SYMLINK");
  }
  return file;
}

function parseLoopbackPort(value) {
  const match = String(value || "").trim().match(/^127\.0\.0\.1:(\d{1,5})$/);
  const port = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw runnerError("MYSQL_LOCAL_RUNNER_NON_LOOPBACK_PORT");
  }
  return port;
}

function parseOwnedContainerInspect(value, { containerId, ownershipToken }) {
  let records;
  try {
    records = JSON.parse(String(value || ""));
  } catch {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_INSPECT_INVALID");
  }
  if (!Array.isArray(records) || records.length !== 1) {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_INSPECT_INVALID");
  }
  const record = records[0];
  if (String(record.Id || "") !== containerId
    || record.Config?.Labels?.["com.myroot.local-mysql-proof"] !== ownershipToken) {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_OWNERSHIP_UNPROVEN");
  }
  const bindings = record.NetworkSettings?.Ports?.["3306/tcp"];
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    throw runnerError("MYSQL_LOCAL_RUNNER_EPHEMERAL_PORT_UNAVAILABLE");
  }
  return Object.freeze({
    containerId,
    ownershipToken,
    port: parseLoopbackPort(`${bindings[0].HostIp}:${bindings[0].HostPort}`),
  });
}

function authenticatedReady(rows) {
  return Array.isArray(rows)
    && rows.length === 1
    && Number(rows[0]?.readiness_ok) === 1
    && String(rows[0]?.mysql_version || "") === "8.0.43"
    && String(rows[0]?.authenticated_account || "").startsWith("root@")
    && /^[0-9a-f-]{36}$/i.test(String(rows[0]?.instance_uuid || ""));
}

function sanitizeMysqlDiagnostic(error) {
  const cleanToken = (value, pattern) => {
    const token = String(value || "");
    return pattern.test(token) ? token : "UNKNOWN";
  };
  const rawMessage = String(error?.sqlMessage || error?.message || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b(password|passwd|pwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return Object.freeze({
    code: cleanToken(error?.code, /^[A-Z][A-Z0-9_]{1,63}$/),
    errno: Number.isSafeInteger(error?.errno) ? error.errno : null,
    sqlState: cleanToken(error?.sqlState, /^[0-9A-Z]{5}$/),
    message: rawMessage,
  });
}

function isRetryableReadinessError(error) {
  return RETRYABLE_READINESS_ERROR_CODES.has(String(error?.code || ""));
}

async function waitForAuthenticatedMysql({
  connect,
  timeoutMs = 90000,
  pollIntervalMs = 250,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  verifyDisposableServer = async () => {},
  requiredConsecutive = 2,
}) {
  if (typeof connect !== "function" || typeof verifyDisposableServer !== "function"
    || timeoutMs < 1 || pollIntervalMs < 1 || requiredConsecutive < 1) {
    throw runnerError("MYSQL_LOCAL_RUNNER_READINESS_CONFIG_INVALID");
  }
  const startedAt = now();
  let lastDiagnostic = Object.freeze({
    code: "MYSQL_NOT_READY",
    errno: null,
    sqlState: "UNKNOWN",
    message: "",
  });
  let priorUuid = "";
  let consecutive = 0;
  while (now() - startedAt <= timeoutMs) {
    let connection;
    try {
      connection = await connect();
      const [rows] = await connection.query(AUTHENTICATED_READINESS_SQL);
      if (!authenticatedReady(rows)) {
        lastDiagnostic = Object.freeze({
          code: "MYSQL_LOCAL_RUNNER_READINESS_RESULT_INVALID",
          errno: null,
          sqlState: "UNKNOWN",
          message: "Authenticated readiness row did not match the pinned contract",
        });
        priorUuid = "";
        consecutive = 0;
      } else {
        await verifyDisposableServer(connection);
        const uuid = String(rows[0].instance_uuid);
        consecutive = uuid === priorUuid ? consecutive + 1 : 1;
        priorUuid = uuid;
        if (consecutive >= requiredConsecutive) {
          return Object.freeze({
            version: String(rows[0].mysql_version),
            currentUser: String(rows[0].authenticated_account),
            serverUuid: uuid,
          });
        }
      }
    } catch (error) {
      lastDiagnostic = sanitizeMysqlDiagnostic(error);
      if (!isRetryableReadinessError(error)) {
        throw runnerError(
          "MYSQL_LOCAL_RUNNER_READINESS_DETERMINISTIC_FAILURE",
          `MYSQL_LOCAL_RUNNER_READINESS_DETERMINISTIC_FAILURE:${JSON.stringify(lastDiagnostic)}`
        );
      }
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
    await wait(pollIntervalMs);
  }
  throw runnerError(
    "MYSQL_LOCAL_RUNNER_AUTHENTICATED_READINESS_TIMEOUT",
    `MYSQL_LOCAL_RUNNER_AUTHENTICATED_READINESS_TIMEOUT:${JSON.stringify(lastDiagnostic)}`
  );
}

function parseNodeTestSummary(output, expectedTests = 12) {
  const value = String(output || "");
  if (!Number.isSafeInteger(expectedTests) || expectedTests < 1) {
    throw runnerError("MYSQL_LOCAL_RUNNER_REAL_ENGINE_EXPECTATION_INVALID");
  }
  const field = (name) => {
    const matches = [...value.matchAll(
      new RegExp(`(?:^|\\n)[^\\n]*\\b${name}\\s+(\\d+)\\s*(?=\\n|$)`, "g")
    )];
    return matches.length === 1 ? Number(matches[0][1]) : -1;
  };
  const summary = Object.freeze({
    tests: field("tests"),
    passed: field("pass"),
    failed: field("fail"),
    skipped: field("skipped"),
  });
  if (/(?:^|\n)[^\n]*#\s*SKIP\b/i.test(value)
    || summary.tests !== expectedTests || summary.passed !== expectedTests
    || summary.failed !== 0 || summary.skipped !== 0) {
    throw runnerError("MYSQL_LOCAL_RUNNER_REAL_ENGINE_SUMMARY_INVALID");
  }
  return summary;
}

function parseJsonCommandOutput(value, errorCode) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch {
    throw runnerError(errorCode);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw runnerError(errorCode);
  }
  return parsed;
}

function parseSchemaSnapshotVerification(value, expectedMigrationSetDigest) {
  const parsed = parseJsonCommandOutput(value, "MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_OUTPUT_INVALID");
  const keys = Object.keys(parsed).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    "actualSha256", "expectedSha256", "matches", "snapshotPath",
  ])
    || parsed.matches !== true
    || typeof parsed.snapshotPath !== "string"
    || !isSha256(parsed.expectedSha256)
    || parsed.actualSha256 !== parsed.expectedSha256
    || !isSha256(expectedMigrationSetDigest)) {
    throw runnerError("MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_OUTCOME_INVALID");
  }
  return Object.freeze({
    matches: true,
    migrationSetDigest: expectedMigrationSetDigest,
    snapshotSha256: parsed.actualSha256,
  });
}

function parseFinalVerificationReport(value) {
  const parsed = parseJsonCommandOutput(value, "MYSQL_LOCAL_RUNNER_FINAL_VERIFY_OUTPUT_INVALID");
  const labels = Array.isArray(parsed.results) ? parsed.results.map((item) => item?.label) : [];
  if (parsed.summary?.status !== "PASS"
    || parsed.summary?.passed !== FINAL_VERIFICATION_LABELS.length
    || parsed.summary?.failed !== 0
    || parsed.summary?.total !== FINAL_VERIFICATION_LABELS.length
    || JSON.stringify(labels) !== JSON.stringify(FINAL_VERIFICATION_LABELS)
    || parsed.results.some((item) => item?.status !== "PASS")) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FINAL_VERIFY_OUTCOME_INVALID");
  }
  return Object.freeze({
    status: "PASS",
    passed: parsed.summary.passed,
    failed: 0,
    total: parsed.summary.total,
    labels: FINAL_VERIFICATION_LABELS,
  });
}

function parseFinalVerificationFailureLabels(value) {
  const parsed = parseJsonCommandOutput(value, "MYSQL_LOCAL_RUNNER_FINAL_VERIFY_OUTPUT_INVALID");
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const failures = results
    .filter((item) => item && item.status !== "PASS")
    .map((item) => String(item.label || ""));
  if (parsed.summary?.status !== "FAIL"
    || !Number.isSafeInteger(parsed.summary?.failed)
    || parsed.summary.failed !== failures.length
    || failures.length < 1
    || failures.length > FINAL_VERIFICATION_LABELS.length
    || failures.some((label) => !FINAL_VERIFICATION_LABELS.includes(label))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FINAL_VERIFY_FAILURE_REPORT_INVALID");
  }
  return Object.freeze([...failures]);
}

function parseObservedNodeTestSummary(value) {
  const source = String(value || "");
  const field = (name) => {
    const matches = [...source.matchAll(
      new RegExp(`(?:^|\\n)[^\\n]*\\b${name}\\s+(\\d+)\\s*(?=\\n|$)`, "g")
    )];
    return matches.length === 1 ? Number(matches[0][1]) : null;
  };
  return Object.freeze({
    tests: field("tests"),
    passed: field("pass"),
    failed: field("fail"),
    cancelled: field("cancelled"),
    skipped: field("skipped"),
    todo: field("todo"),
  });
}

function finalVerificationResultTermination(item) {
  if (item.errorCode === "ENOBUFS") {
    return Object.freeze({ kind: "BUFFER_LIMIT", exitCode: null, signal: null, errorCode: "ENOBUFS" });
  }
  if (typeof item.errorCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(item.errorCode)) {
    return Object.freeze({ kind: "SPAWN_ERROR", exitCode: null, signal: null, errorCode: item.errorCode });
  }
  if (typeof item.signal === "string" && /^SIG[A-Z0-9]+$/.test(item.signal)) {
    return Object.freeze({ kind: "SIGNAL", exitCode: null, signal: item.signal, errorCode: null });
  }
  return Object.freeze({
    kind: "EXIT",
    exitCode: Number.isInteger(item.code) ? item.code : null,
    signal: null,
    errorCode: null,
  });
}

function channelMetadata(value) {
  const source = String(value || "");
  return Object.freeze({
    present: source.length > 0,
    utf8Bytes: Buffer.byteLength(source),
    sha256: sha256(Buffer.from(source)),
  });
}

function parseFinalVerificationFailureDetails(value) {
  const parsed = parseJsonCommandOutput(value, "MYSQL_LOCAL_RUNNER_FINAL_VERIFY_OUTPUT_INVALID");
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const details = [];
  for (const item of results) {
    if (!item || item.status === "PASS" || !FINAL_VERIFICATION_LABELS.includes(item.label)) continue;
    const detail = {
      label: item.label,
      termination: finalVerificationResultTermination(item),
      stdout: channelMetadata(item.stdout),
      stderr: channelMetadata(item.stderr),
    };
    if (item.label === "backend tests") {
      detail.testFailures = parseTapFailureLabels(item.stdout || "");
      detail.testSummary = parseObservedNodeTestSummary(item.stdout || "");
    }
    details.push(Object.freeze(detail));
  }
  if (parsed.summary?.status !== "FAIL"
    || details.length !== parsed.summary?.failed
    || details.length < 1
    || details.length > FINAL_VERIFICATION_LABELS.length) {
    throw runnerError("MYSQL_LOCAL_RUNNER_FINAL_VERIFY_FAILURE_REPORT_INVALID");
  }
  return Object.freeze(details);
}

function redactSecrets(value, secrets = []) {
  let output = String(value || "");
  for (const secret of secrets) {
    const token = String(secret || "");
    if (token) output = output.replaceAll(token, "[REDACTED]");
  }
  return output;
}

function secretVariants(secrets = []) {
  const variants = new Set();
  for (const secret of secrets) {
    const token = String(secret || "");
    if (!token) continue;
    variants.add(token);
    variants.add(encodeURIComponent(token));
    variants.add(JSON.stringify(token).slice(1, -1));
    variants.add(Buffer.from(token).toString("base64"));
    variants.add(Buffer.from(token).toString("base64url"));
  }
  return [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
}

function redactChildOutput(value, { secrets = [], ephemeralPort } = {}) {
  let output = String(value || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  output = redactSecrets(output, secretVariants(secrets));
  output = output
    .replace(/\b(mysql(?:2)?:\/\/)([^@\s]+)@/gi, "$1[REDACTED]@")
    .replace(/\b(password|passwd|pwd|token|secret|cookie)\b(\s*["']?\s*[:=]\s*["']?)([^"',;\s}]+)/gi,
      "$1$2[REDACTED]")
    .replace(/(--(?:password|passwd|token|secret)(?:=|\s+))([^\s]+)/gi, "$1[REDACTED]");
  const port = Number(ephemeralPort);
  if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) {
    output = output.replaceAll(String(port), "[EPHEMERAL_PORT]");
  }
  return output;
}

function utf8Tail(value, maximumBytes) {
  const bytes = Buffer.from(String(value || ""));
  if (bytes.length <= maximumBytes) return bytes.toString("utf8");
  let start = bytes.length - maximumBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function utf8Head(value, maximumBytes) {
  const bytes = Buffer.from(String(value || ""));
  if (bytes.length <= maximumBytes) return bytes.toString("utf8");
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function parseTapFailureLabels(value) {
  const source = String(value || "");
  const failures = [];
  const pattern = /^not ok\s+(\d+)\s+-\s+(.+)$/gm;
  const matches = [...source.matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (failures.length >= CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABELS) break;
    const ordinal = Number(match[1]);
    const name = utf8Head(match[2].trim(), CHILD_DIAGNOSTIC_MAX_TAP_FAILURE_LABEL_UTF8_BYTES);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || !name) continue;
    const block = source.slice(match.index, matches[index + 1]?.index || source.length);
    const errorCodeMatch = block.match(/^\s{2}code: '([A-Z][A-Z0-9_]{1,63})'$/m);
    const failureTypeMatch = block.match(/^\s{2}failureType: '([A-Za-z][A-Za-z0-9]{1,63})'$/m);
    const failureType = ["testCodeFailure", "hookFailed", "cancelledByParent", "subtestsFailed"]
      .includes(failureTypeMatch?.[1]) ? failureTypeMatch[1] : "UNKNOWN";
    failures.push(Object.freeze({
      ordinal,
      name,
      nameSha256: sha256(Buffer.from(name)),
      errorCode: errorCodeMatch?.[1] || "UNKNOWN",
      failureType,
      diagnosticSha256: sha256(Buffer.from(block)),
    }));
  }
  return Object.freeze({
    failures: Object.freeze(failures),
    truncated: matches.length > failures.length,
  });
}

function channelDiagnostic(value, options = {}) {
  const raw = String(value || "");
  const redacted = redactChildOutput(raw, options);
  const redactedBytes = Buffer.byteLength(redacted);
  const maximumBytes = options.maximumBytes
    || CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL;
  return Object.freeze({
    present: raw.length > 0,
    redactedBytes,
    truncated: redactedBytes > maximumBytes,
    redactedSha256: sha256(Buffer.from(redacted)),
    retainedTail: utf8Tail(redacted, maximumBytes),
  });
}

function childTermination(result = {}) {
  if (result.error?.code === "ENOBUFS") {
    return Object.freeze({ kind: "BUFFER_LIMIT", exitCode: null, signal: null, errorCode: "ENOBUFS" });
  }
  if (result.error) {
    const errorCode = /^[A-Z][A-Z0-9_]{1,63}$/.test(String(result.error.code || ""))
      ? String(result.error.code)
      : "UNKNOWN";
    return Object.freeze({ kind: "SPAWN_ERROR", exitCode: null, signal: null, errorCode });
  }
  if (result.signal) {
    const signal = /^SIG[A-Z0-9]+$/.test(String(result.signal)) ? String(result.signal) : "UNKNOWN";
    return Object.freeze({ kind: "SIGNAL", exitCode: null, signal, errorCode: null });
  }
  return Object.freeze({
    kind: "EXIT",
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: null,
    errorCode: null,
  });
}

function buildChildCommandDiagnostic(result = {}, options = {}) {
  const stdout = channelDiagnostic(result.stdout, options);
  const stderr = channelDiagnostic(result.stderr, options);
  const tapFailureSummary = parseTapFailureLabels(redactChildOutput(result.stdout, options));
  return Object.freeze({
    termination: childTermination(result),
    outputReason: stdout.present || stderr.present ? "CHILD_OUTPUT_RETAINED" : "NO_CHILD_OUTPUT",
    tapFailureSummary,
    stdout,
    stderr,
  });
}

function buildChildEnv(baseEnv = {}, overlay = {}) {
  const environment = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (typeof baseEnv[key] === "string" && baseEnv[key]) environment[key] = baseEnv[key];
  }
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value === "string") environment[key] = value;
  }
  environment.NO_COLOR = "1";
  environment.FORCE_COLOR = "0";
  return Object.freeze(environment);
}

function buildDockerRunSpec({ containerName, ownershipToken, image, rootPassword }) {
  if (!/^myroot-mysql-authorized-[0-9]+-[0-9]+$/.test(String(containerName || ""))
    || !/^[0-9a-f-]{36}$/i.test(String(ownershipToken || ""))
    || !/^mysql:8\.0\.43@sha256:[0-9a-f]{64}$/.test(String(image || ""))
    || String(rootPassword || "").length < 32) {
    throw runnerError("MYSQL_LOCAL_RUNNER_DOCKER_SPEC_INVALID");
  }
  return Object.freeze({
    command: "docker",
    args: Object.freeze([
      "run", "-d", "--name", containerName,
      "--label", `com.myroot.local-mysql-proof=${ownershipToken}`,
      "-e", "MYSQL_ROOT_PASSWORD",
      "-e", "MYSQL_ROOT_HOST",
      "-e", "MYSQL_DATABASE",
      "-p", `${LOOPBACK_HOST}::3306`,
      image,
      "--default-authentication-plugin=mysql_native_password",
    ]),
    env: Object.freeze({
      MYSQL_ROOT_PASSWORD: rootPassword,
      MYSQL_ROOT_HOST: "%",
      MYSQL_DATABASE: MARKER_DATABASE,
    }),
  });
}

function assertDockerDaemonAvailable(run) {
  if (typeof run !== "function") {
    throw runnerError("MYSQL_LOCAL_RUNNER_DOCKER_ADAPTER_INVALID");
  }
  const result = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (result?.error || result?.status !== 0 || !String(result?.stdout || "").trim()) {
    throw runnerError("MYSQL_LOCAL_RUNNER_DOCKER_DAEMON_UNAVAILABLE");
  }
  return Object.freeze({ serverVersion: String(result.stdout).trim() });
}

function assertPinnedImagePresent(image, run) {
  if (typeof run !== "function") {
    throw runnerError("MYSQL_LOCAL_RUNNER_DOCKER_ADAPTER_INVALID");
  }
  const match = String(image || "").match(/@(?<digest>sha256:[a-f0-9]{64})$/);
  if (!match) throw runnerError("MYSQL_LOCAL_RUNNER_PINNED_IMAGE_REFERENCE_INVALID");
  const result = run("docker", ["image", "inspect", image]);
  if (result?.error || result?.status !== 0) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PINNED_IMAGE_MISSING");
  }
  let records;
  try {
    records = JSON.parse(String(result.stdout || ""));
  } catch {
    throw runnerError("MYSQL_LOCAL_RUNNER_PINNED_IMAGE_INSPECT_INVALID");
  }
  if (!Array.isArray(records) || records.length !== 1
    || !Array.isArray(records[0]?.RepoDigests)
    || !records[0].RepoDigests.some((value) => String(value).endsWith(`@${match.groups.digest}`))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_PINNED_IMAGE_DIGEST_MISMATCH");
  }
  return Object.freeze({
    imageId: String(records[0].Id || ""),
    digest: match.groups.digest,
  });
}

function cleanupOwnedContainer({ containerId, containerName, ownershipToken, run }) {
  if (typeof run !== "function") throw runnerError("MYSQL_LOCAL_RUNNER_CLEANUP_ADAPTER_INVALID");
  const target = containerId || containerName;
  const inspected = run("docker", ["inspect", target]);
  if (inspected.status !== 0) {
    return Object.freeze({ removed: true, alreadyAbsent: true, containerId: containerId || "" });
  }
  let records;
  try {
    records = JSON.parse(String(inspected.stdout || ""));
  } catch {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_INSPECT_INVALID");
  }
  if (!Array.isArray(records) || records.length !== 1
    || records[0].Config?.Labels?.["com.myroot.local-mysql-proof"] !== ownershipToken
    || !/^[0-9a-f]{64}$/.test(String(records[0].Id || ""))) {
    throw runnerError("MYSQL_LOCAL_RUNNER_CONTAINER_OWNERSHIP_UNPROVEN");
  }
  const exactId = String(records[0].Id);
  const removed = run("docker", ["rm", "-f", exactId]);
  if (removed.status !== 0) throw runnerError("MYSQL_LOCAL_RUNNER_CLEANUP_FAILED");
  const absent = run("docker", ["inspect", exactId]);
  if (absent.status === 0) throw runnerError("MYSQL_LOCAL_RUNNER_CLEANUP_FAILED");
  return Object.freeze({ removed: true, alreadyAbsent: false, containerId: exactId });
}

module.exports = {
  LOOPBACK_HOST,
  MARKER_DATABASE,
  POST_SUCCESS_COMMANDS,
  AUTHENTICATED_READINESS_SQL,
  EXECUTION_PLAN,
  FINAL_VERIFICATION_LABELS,
  MUTABLE_OUTPUT_PATHS,
  EXECUTION_INPUT_EXCLUDED_PATHS,
  EXECUTION_INPUT_ROOTS,
  CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL,
  CHILD_ENV_ALLOWLIST,
  CHILD_FAILURE_DIAGNOSTIC_POLICY,
  assertDockerDaemonAvailable,
  assertExternalAuthorization,
  assertPinnedImagePresent,
  authenticatedReady,
  buildDockerRunSpec,
  buildExecutionInputManifest,
  buildExecutionToolchainBinding,
  buildChildCommandDiagnostic,
  buildChildEnv,
  cleanupOwnedContainer,
  consumeAuthorization,
  parseCliArgs,
  parseTapFailureLabels,
  parseNodeTestSummary,
  parseFinalVerificationReport,
  parseFinalVerificationFailureLabels,
  parseFinalVerificationFailureDetails,
  parseSchemaSnapshotVerification,
  parseOwnedContainerInspect,
  parseLoopbackPort,
  resolvePacketPath,
  redactSecrets,
  runnerError,
  sanitizeMysqlDiagnostic,
  isRetryableReadinessError,
  sha256,
  validateAuthorizationPacket,
  waitForAuthenticatedMysql,
};
