const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { migrationSetDescriptor } = require("../src/mysqlSchemaSnapshot");
const {
  CHILD_ENV_ALLOWLIST,
  CHILD_FAILURE_DIAGNOSTIC_POLICY,
  EXECUTION_PLAN,
  FINAL_VERIFICATION_LABELS,
  MUTABLE_OUTPUT_PATHS,
  buildExecutionToolchainBinding,
} = require("../src/mysqlLocalAuthorizedRunner");

const ROOT = path.join(__dirname, "../..");
const PACKET_RELATIVE =
  "docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-25_r22.json";
const PACKET_PATH = path.join(ROOT, PACKET_RELATIVE);
const COMPANION_PATH = PACKET_PATH.replace(/\.json$/, ".md");
const PACKAGE_PATH = path.join(ROOT, "package.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function packet() {
  return JSON.parse(fs.readFileSync(PACKET_PATH, "utf8"));
}

function runtimeToolchainBinding() {
  return buildExecutionToolchainBinding({
    npmVersion: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  });
}

test("R22 freezes the exact 001-066 execution closure and real-engine test bytes", () => {
  const value = packet();
  const descriptor = migrationSetDescriptor();
  assert.equal(value.status, "PREPARED_NOT_AUTHORIZED_NOT_EXECUTED");
  assert.deepEqual(value.migrationSet, {
    first: descriptor.migrations[0].file,
    last: descriptor.migrations.at(-1).file,
    count: descriptor.migrations.length,
    lastChecksum: descriptor.migrations.at(-1).checksum,
    expectedDigest: descriptor.migrationSetDigest,
  });
  assert.equal(value.testGroups.length, 7);
  assert.equal(value.testGroups[0].file,
    "backend/tests/mysql_local_readiness.integration.test.js");
  assert.equal(new Set(value.testGroups.map((item) => item.file)).size, 7);
  assert.equal(new Set(value.testGroups.map((item) => item.enableVariable)).size, 7);
  for (const group of value.testGroups) {
    assert.match(group.file, /^backend\/tests\/[a-z0-9_]+\.integration\.test\.js$/);
    assert.match(group.enableVariable, /^[A-Z0-9_]+_ENABLED$/);
    assert.equal(group.sha256, sha256(path.join(ROOT, group.file)), group.file);
  }
  assert.equal(value.schemaVersion, "myroot.local-mysql-authorization-packet.v19");
  assert.equal(value.attempt, 22);
  assert.equal(value.supersedesPacketSha256,
    sha256(path.join(ROOT,
      "docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-20_r21.json")));
  assert.equal(value.priorAttemptEvidence.length, 20);
  for (const input of value.priorAttemptEvidence) {
    assert.equal(input.sha256, sha256(path.join(ROOT, input.path)), input.path);
  }
  assert.equal(value.supportingInputs.length, 37);
  assert.equal(new Set(value.supportingInputs.map((item) => item.file)).size, 37);
  for (const input of value.supportingInputs) {
    assert.match(input.file, /^(?:backend|docs|scripts)\//);
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
  }
});

test("the packet command executes exactly the seven frozen test groups", () => {
  const value = packet();
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  const scriptName = value.executionCommand.replace(/^npm run /, "");
  assert.equal(value.executionCommand, `npm run ${scriptName}`);
  const command = packageJson.scripts[scriptName];
  assert.equal(typeof command, "string");
  const files = command.match(/backend\/tests\/[a-z0-9_]+\.integration\.test\.js/g) || [];
  assert.deepEqual(files, value.testGroups.map((item) => item.file));
  assert.equal(command, `node --test --test-reporter=tap --test-concurrency=1 ${files.join(" ")}`);
  assert.equal(value.executionPolicy.testFileConcurrency, 1);
  assert.equal(value.executionPolicy.packageJsonSha256, sha256(PACKAGE_PATH));
  assert.match(value.executionPolicy.authenticatedReadinessSqlSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(value.executionPolicy.childFailureDiagnostic,
    CHILD_FAILURE_DIAGNOSTIC_POLICY);
  assert.deepEqual(value.executionPolicy.childEnvironment, {
    inheritance: "ALLOWLIST_ONLY",
    allowlist: CHILD_ENV_ALLOWLIST,
    explicitOverlay: "FROZEN_TEST_ENABLE_VARIABLES_AND_SANDBOX_MYSQL_ONLY",
  });
  assert.match(value.executionPolicy.singleUseNonce, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(value.executionPolicy.executionInputManifest, {
    schemaVersion: "myroot.local-mysql-execution-input-manifest.v1",
    roots: [
      "package.json",
      "admin",
      "backend",
      "cloudbaserc.json",
      "cloudfunctions",
      "contracts",
      "miniprogram",
      "scripts",
    ],
    excludedPaths: [
      "admin/dist",
      "backend/db/schema.sql",
      "backend/public/admin-dist",
    ],
    fileCount: 708,
    aggregateSha256: "89dfcef1063a6fd70d61d9ce7593a73d08807cd94bc9e0a4096e63c16adb2b9e",
  });
  assert.deepEqual(value.executionPolicy.toolchainBinding, runtimeToolchainBinding());
  assert.deepEqual(value.executionPlan, EXECUTION_PLAN);
  assert.deepEqual(value.mutableOutputs, MUTABLE_OUTPUT_PATHS);
  assert.equal(value.requiredOutcomes.allEnabledTests, 13);
  assert.equal(value.requiredOutcomes.allEnabledTestsPass, 13);
  assert.equal(value.requiredOutcomes.enabledTestsFail, 0);
  assert.equal(value.requiredOutcomes.enabledTestsSkip, 0);
  assert.deepEqual(value.requiredOutcomes.finalVerificationLabels, FINAL_VERIFICATION_LABELS);
  assert.equal(value.requiredOutcomes.finalVerificationPassed, 18);
  assert.equal(value.requiredOutcomes.finalVerificationFailed, 0);
  assert.equal(value.orchestrationCorrections.boundedChildFailureDiagnostic, true);
  assert.equal(value.orchestrationCorrections.stdoutStderrSeparated, true);
  assert.equal(value.orchestrationCorrections.fullRedactionBeforeUtf8Tail, true);
  assert.equal(value.orchestrationCorrections.rawChildOutputSuppressed, true);
  assert.equal(value.orchestrationCorrections.childEnvironmentAllowlist, true);
  assert.equal(value.orchestrationCorrections.structuredTapFailureDiagnostics, true);
  assert.equal(value.orchestrationCorrections.dockerDaemonPrecheckBeforeNonceConsumption, true);
  assert.equal(value.orchestrationCorrections.pinnedImagePrecheckBeforeNonceConsumption, true);
  assert.equal(value.orchestrationCorrections.schemaVerifyByteEqualityAndProvenanceSeparated, true);
  assert.equal(value.orchestrationCorrections.structuredFinalVerifyFailureLabels, true);
  assert.equal(value.orchestrationCorrections.structuredBackendTestFailureDetails, true);
  assert.equal(value.orchestrationCorrections.structuredBackendTerminationMetadata, true);
  assert.equal(value.orchestrationCorrections.backendTestsUseTapReporter, true);
  assert.equal(value.orchestrationCorrections.keyInventoryCheckAttestationDiagnostic, true);
  assert.equal(value.orchestrationCorrections.keyInventoryNormalizedCheckDigestsAligned, true);
  assert.equal(value.orchestrationCorrections.youzanTokenPolicyFixtureUsesStableFutureExpiry, true);
  assert.deepEqual(value.postSuccessCommands, [
    "npm run db:schema-snapshot:write",
    "npm run db:schema-snapshot:verify",
    "npm run verify -- --json",
  ]);
  assert.equal(value.runnerCommand,
    `npm run v1:mysql-local-authorized:run -- --packet ${PACKET_RELATIVE}`);
  const runnerScript = packageJson.scripts["v1:mysql-local-authorized:run"];
  assert.equal(runnerScript, "node backend/scripts/mysql-local-authorized-runner.js");
});

test("the packet and companion cannot be mistaken for authorization or formal Gate closure", () => {
  const value = packet();
  assert.deepEqual(value.authorization, {
    requestedInThisPacket: false,
    granted: false,
    executed: false,
  });
  assert.deepEqual(value.formalGateEffect, {
    localMysqlEngineProofMayAdvance: true,
    candidateMysqlGateClosed: false,
    productionMysqlGateClosed: false,
    capacityGateClosed: false,
    liveDeliveryGateClosed: false,
    runtimeDatabaseWriteAuthorityGateClosed: false,
  });
  const companion = fs.readFileSync(COMPANION_PATH, "utf8");
  assert.match(companion, /状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`/);
  assert.match(companion, new RegExp(sha256(PACKET_PATH)));
  assert.match(companion, /本包不构成授权/);
});
