const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildExecutionInputManifest,
  buildExecutionToolchainBinding,
} = require("../src/mysqlLocalAuthorizedRunner");

const ROOT = path.join(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/v1.0.0");
const SOURCE = path.join(EVIDENCE_ROOT,
  "mysql_001_066_local_authorization_packet_2026-07-20_r21.json");
const TARGET_RELATIVE =
  "docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-25_r22.json";
const TARGET = path.join(ROOT, TARGET_RELATIVE);
const PRIOR_ATTEMPT =
  "docs/evidence/v1.0.0/mysql_001_066_local_execution_result_2026-07-20_attempt20.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileDigest(relative) {
  return sha256(fs.readFileSync(path.join(ROOT, relative)));
}

function main() {
  const nonce = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(String(nonce || ""))) {
    throw new Error("R22_NONCE_REQUIRED");
  }
  const packet = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  packet.schemaVersion = "myroot.local-mysql-authorization-packet.v19";
  packet.generatedAt = new Date().toISOString();
  packet.attempt = 22;
  packet.supersedesPacketSha256 = fileDigest(path.relative(ROOT, SOURCE));
  packet.priorAttemptEvidence.push({
    path: PRIOR_ATTEMPT,
    sha256: fileDigest(PRIOR_ATTEMPT),
    status: "FAIL_SINGLE_WALL_CLOCK_YOUZAN_TEST_CLEANED",
  });
  packet.runnerCommand = `npm run v1:mysql-local-authorized:run -- --packet ${TARGET_RELATIVE}`;
  packet.executionPolicy.singleUseNonce = nonce;
  packet.executionPolicy.packageJsonSha256 = fileDigest("package.json");
  packet.executionPolicy.reason =
    "supersede consumed R21 and freeze the current post-R21 migration verification implementation and execution command bytes";
  packet.executionPolicy.executionInputManifest = buildExecutionInputManifest(ROOT);
  packet.executionPolicy.toolchainBinding = buildExecutionToolchainBinding({
    npmVersion: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  });
  packet.testGroups = packet.testGroups.map((item) => ({
    ...item,
    sha256: fileDigest(item.file),
  }));
  for (const file of [
    "backend/src/keyInventoryReadinessFoundation.js",
    "backend/src/keyInventorySchemaAttestation.js",
    "backend/tests/key_inventory_schema_attestation.test.js",
    "backend/tests/youzan_token_policy.test.js",
  ]) {
    if (!packet.supportingInputs.some((item) => item.file === file)) {
      packet.supportingInputs.push({ file, sha256: fileDigest(file) });
    }
  }
  packet.supportingInputs = packet.supportingInputs.map((item) => ({
    ...item,
    sha256: fileDigest(item.file),
  }));
  packet.orchestrationCorrections.dockerDaemonPrecheckBeforeNonceConsumption = true;
  packet.orchestrationCorrections.pinnedImagePrecheckBeforeNonceConsumption = true;
  packet.orchestrationCorrections.schemaVerifyByteEqualityAndProvenanceSeparated = true;
  packet.orchestrationCorrections.structuredFinalVerifyFailureLabels = true;
  packet.orchestrationCorrections.structuredBackendTestFailureDetails = true;
  packet.orchestrationCorrections.structuredBackendTerminationMetadata = true;
  packet.orchestrationCorrections.backendTestsUseTapReporter = true;
  packet.orchestrationCorrections.keyInventoryCheckAttestationDiagnostic = true;
  packet.orchestrationCorrections.keyInventoryNormalizedCheckDigestsAligned = true;
  packet.orchestrationCorrections.youzanTokenPolicyFixtureUsesStableFutureExpiry = true;
  packet.authorization = { requestedInThisPacket: false, granted: false, executed: false };
  packet.supersedesReason =
    "R21 completed the local 001-066 closure. Subsequent v1 development changed mysqlMigrations.js and package execution bytes, so the consumed R21 packet cannot authorize the current source set. R22 freezes the exact current bytes and reruns the same bounded local-only closure.";

  const bytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(TARGET, bytes, { mode: 0o644 });
  const packetSha = sha256(bytes);
  const companion = [
    "# R22 本机 MySQL 8.0.43 一次性授权包",
    "",
    "- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`",
    `- packet SHA-256：\`${packetSha}\``,
    `- single-use nonce：\`${nonce}\``,
    "- 仅允许本机 `127.0.0.1` 随机临时端口及一次性 MySQL 8.0.43 容器。",
    "- 不连接 Candidate/生产，不授权提交、推送、部署、真实发送或正式 Gate 关闭。",
    "- 本包不构成授权；必须由用户再次精确确认 packet SHA 与 nonce 后才能执行。",
    "- 失败立即停止、恢复可变输出，并删除本任务拥有的一次性容器。",
    "",
  ].join("\n");
  fs.writeFileSync(TARGET.replace(/\.json$/, ".md"), companion, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ packet: TARGET_RELATIVE, packetSha256: packetSha, nonce })}\n`);
}

main();
