#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const {
  LOOPBACK_HOST,
  MARKER_DATABASE,
  assertDockerDaemonAvailable,
  assertExternalAuthorization,
  assertPinnedImagePresent,
  buildChildCommandDiagnostic,
  buildChildEnv,
  buildDockerRunSpec,
  buildExecutionToolchainBinding,
  cleanupOwnedContainer,
  consumeAuthorization,
  parseCliArgs,
  parseNodeTestSummary,
  parseFinalVerificationReport,
  parseFinalVerificationFailureLabels,
  parseFinalVerificationFailureDetails,
  parseSchemaSnapshotVerification,
  parseOwnedContainerInspect,
  resolvePacketPath,
  validateAuthorizationPacket,
  waitForAuthenticatedMysql,
} = require("../src/mysqlLocalAuthorizedRunner");
const {
  assertDisposableSnapshotServer,
  inspectCommittedSnapshotProvenance,
  migrationSetDescriptor,
} = require("../src/mysqlSchemaSnapshot");
const {
  inspectSnapshotCheckAttestation,
} = require("../src/keyInventorySchemaAttestation");

const ROOT = path.join(__dirname, "../..");

function captureMutableOutputs(root, relativePaths) {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-mysql-runner-outputs-"));
  const records = [];
  try {
    for (const relative of relativePaths) {
      const source = path.join(root, relative);
      const backup = path.join(backupRoot, relative);
      if (!fs.existsSync(source)) {
        records.push({ relative, existed: false });
        continue;
      }
      if (fs.lstatSync(source).isSymbolicLink()) {
        const error = new Error("MYSQL_LOCAL_RUNNER_MUTABLE_OUTPUT_SYMLINK");
        error.code = "MYSQL_LOCAL_RUNNER_MUTABLE_OUTPUT_SYMLINK";
        throw error;
      }
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.cpSync(source, backup, { recursive: true, preserveTimestamps: true });
      records.push({ relative, existed: true });
    }
    return { backupRoot, records };
  } catch (error) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

function restoreMutableOutputs(root, snapshot) {
  for (const record of snapshot.records) {
    const target = path.join(root, record.relative);
    fs.rmSync(target, { recursive: true, force: true });
    if (record.existed) {
      const backup = path.join(snapshot.backupRoot, record.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(backup, target, { recursive: true, preserveTimestamps: true });
    }
  }
  fs.rmSync(snapshot.backupRoot, { recursive: true, force: true });
}

function discardMutableOutputSnapshot(snapshot) {
  if (snapshot) fs.rmSync(snapshot.backupRoot, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function commandFailed(result) {
  return result.error || result.status !== 0;
}

function stableFailure(command, result, diagnosticOptions = {}) {
  const diagnostic = buildChildCommandDiagnostic(result, diagnosticOptions);
  const termination = diagnostic.termination;
  const code = termination.kind === "EXIT"
    ? `EXIT_${termination.exitCode}`
    : termination.kind === "SIGNAL"
      ? `SIGNAL_${termination.signal}`
      : `${termination.kind}_${termination.errorCode}`;
  const error = new Error(`MYSQL_LOCAL_RUNNER_COMMAND_FAILED:${command}:${code}`);
  error.code = "MYSQL_LOCAL_RUNNER_COMMAND_FAILED";
  error.commandDiagnostic = Object.freeze({ command, ...diagnostic });
  return error;
}

function writeCommandResult(command, result, diagnosticOptions = {}, summary) {
  process.stdout.write(JSON.stringify({
    event: "MYSQL_LOCAL_RUNNER_COMMAND_RESULT",
    command,
    summary: summary || null,
    ...buildChildCommandDiagnostic(result, diagnosticOptions),
  }) + "\n");
}

async function main() {
  const { packet: packetRelative } = parseCliArgs();
  const externalAuthorization = assertExternalAuthorization();
  const expectedSha256 = externalAuthorization.packetSha256;
  const packetPath = resolvePacketPath(ROOT, packetRelative);
  const packetBytes = fs.readFileSync(packetPath);
  const npmVersionResult = run("npm", ["--version"]);
  if (commandFailed(npmVersionResult)) throw stableFailure("npm --version", npmVersionResult);
  const runtimeToolchainBinding = buildExecutionToolchainBinding({
    npmVersion: String(npmVersionResult.stdout || "").trim(),
  });
  const { packet } = validateAuthorizationPacket({
    root: ROOT,
    packetBytes,
    expectedSha256,
    migrationDescriptor: migrationSetDescriptor(),
    runtimeToolchainBinding,
  });
  if (packet.executionPolicy?.singleUseNonce !== externalAuthorization.nonce) {
    const error = new Error("MYSQL_LOCAL_RUNNER_AUTHORIZED_NONCE_MISMATCH");
    error.code = "MYSQL_LOCAL_RUNNER_AUTHORIZED_NONCE_MISMATCH";
    throw error;
  }
  assertDockerDaemonAvailable(run);
  assertPinnedImagePresent(packet.container.image, run);
  consumeAuthorization({
    root: ROOT,
    packetSha256: expectedSha256,
    nonce: externalAuthorization.nonce,
  });
  assertDockerDaemonAvailable(run);
  assertPinnedImagePresent(packet.container.image, run);

  const containerName = `myroot-mysql-authorized-${Date.now()}-${process.pid}`;
  const ownershipToken = crypto.randomUUID();
  const rootPassword = crypto.randomBytes(32).toString("base64url");
  let containerStarted = false;
  let containerId = "";
  let cleaned = false;

  function cleanup() {
    if (cleaned) return true;
    cleaned = true;
    if (!containerStarted) return true;
    try {
      const result = cleanupOwnedContainer({
        containerId,
        containerName,
        ownershipToken,
        run,
      });
      containerId = result.containerId || containerId;
      return result.removed;
    } catch {
      return false;
    }
  }

  function onSignal(signal, exitCode) {
    const removed = cleanup();
    process.stderr.write(`MYSQL_LOCAL_RUNNER_SIGNAL:${signal}:container_removed=${removed}\n`);
    process.exit(removed ? exitCode : 97);
  }

  const signalHandlers = new Map([
    ["SIGINT", () => onSignal("SIGINT", 130)],
    ["SIGTERM", () => onSignal("SIGTERM", 143)],
    ["SIGHUP", () => onSignal("SIGHUP", 129)],
  ]);
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  let primaryError;
  let removed = false;
  let mutableOutputSnapshot;
  let postSuccessComplete = false;
  try {
    const dockerSpec = buildDockerRunSpec({
      containerName,
      ownershipToken,
      image: packet.container.image,
      rootPassword,
    });
    const started = run(dockerSpec.command, dockerSpec.args, {
      env: {
        ...process.env,
        ...dockerSpec.env,
      },
    });
    if (commandFailed(started)) throw stableFailure("docker run", started, { secrets: [rootPassword] });
    containerStarted = true;
    containerId = String(started.stdout || "").trim();
    if (!/^[0-9a-f]{64}$/.test(containerId)) {
      const error = new Error("MYSQL_LOCAL_RUNNER_CONTAINER_ID_INVALID");
      error.code = "MYSQL_LOCAL_RUNNER_CONTAINER_ID_INVALID";
      throw error;
    }

    let ownership;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const inspectResult = run("docker", ["inspect", containerId]);
      if (!commandFailed(inspectResult)) {
        try {
          ownership = parseOwnedContainerInspect(inspectResult.stdout, { containerId, ownershipToken });
          break;
        } catch (error) {
          if (error.code === "MYSQL_LOCAL_RUNNER_CONTAINER_OWNERSHIP_UNPROVEN") throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ownership) {
      const error = new Error("MYSQL_LOCAL_RUNNER_EPHEMERAL_PORT_UNAVAILABLE");
      error.code = "MYSQL_LOCAL_RUNNER_EPHEMERAL_PORT_UNAVAILABLE";
      throw error;
    }
    const port = ownership.port;

    const connectionConfig = {
      host: LOOPBACK_HOST,
      port,
      user: "root",
      password: rootPassword,
      charset: "utf8mb4",
      timezone: "+08:00",
    };
    await waitForAuthenticatedMysql({
      connect: () => mysql.createConnection(connectionConfig),
      verifyDisposableServer: assertDisposableSnapshotServer,
    });

    validateAuthorizationPacket({
      root: ROOT,
      packetBytes: fs.readFileSync(packetPath),
      expectedSha256,
      migrationDescriptor: migrationSetDescriptor(),
      runtimeToolchainBinding,
    });

    const enabled = Object.fromEntries(packet.testGroups.map((group) => [group.enableVariable, "true"]));
    process.stdout.write(JSON.stringify({
      event: "MYSQL_LOCAL_RUNNER_READY",
      bindAddress: LOOPBACK_HOST,
      hostPort: "EPHEMERAL_RANDOM",
      image: packet.container.image,
      packetSha256: expectedSha256,
    }) + "\n");
    const engineStage = packet.executionPlan[0];
    const checked = run(engineStage.executable, engineStage.args, {
      env: buildChildEnv(process.env, {
        ...enabled,
        SCHEMA_SNAPSHOT_MYSQL_HOST: LOOPBACK_HOST,
        SCHEMA_SNAPSHOT_MYSQL_PORT: String(port),
        SCHEMA_SNAPSHOT_MYSQL_USER: "root",
        SCHEMA_SNAPSHOT_MYSQL_PASSWORD: rootPassword,
        SCHEMA_SNAPSHOT_MYSQL_SANDBOX_MARKER_DATABASE: MARKER_DATABASE,
      }),
    });
    const diagnosticOptions = { secrets: [rootPassword], ephemeralPort: port };
    if (commandFailed(checked)) throw stableFailure(packet.executionCommand, checked, diagnosticOptions);
    const combinedOutput = `${checked.stdout || ""}\n${checked.stderr || ""}`;
    const summary = parseNodeTestSummary(combinedOutput, packet.requiredOutcomes.allEnabledTests);
    writeCommandResult(packet.executionCommand, checked, diagnosticOptions, summary);

    mutableOutputSnapshot = captureMutableOutputs(ROOT, packet.mutableOutputs);
    for (const stage of packet.executionPlan.slice(1)) {
      validateAuthorizationPacket({
        root: ROOT,
        packetBytes: fs.readFileSync(packetPath),
        expectedSha256,
        migrationDescriptor: migrationSetDescriptor(),
        runtimeToolchainBinding,
      });
      const executable = stage.executable === "node" ? process.execPath : stage.executable;
      const completed = run(executable, stage.args, {
        env: buildChildEnv(process.env, {
          SCHEMA_SNAPSHOT_MYSQL_HOST: LOOPBACK_HOST,
          SCHEMA_SNAPSHOT_MYSQL_PORT: String(port),
          SCHEMA_SNAPSHOT_MYSQL_USER: "root",
          SCHEMA_SNAPSHOT_MYSQL_PASSWORD: rootPassword,
          SCHEMA_SNAPSHOT_MYSQL_SANDBOX_MARKER_DATABASE: MARKER_DATABASE,
        }),
      });
      const command = `${stage.executable} ${stage.args.join(" ")}`;
      if (commandFailed(completed)) {
        if (stage.id === "FINAL_REPOSITORY_VERIFY") {
          let failureLabels;
          let failureDetails;
          try {
            failureLabels = parseFinalVerificationFailureLabels(completed.stdout);
            failureDetails = parseFinalVerificationFailureDetails(completed.stdout);
          } catch {
            failureLabels = Object.freeze(["UNPARSEABLE_FINAL_VERIFICATION_REPORT"]);
            failureDetails = Object.freeze([]);
          }
          process.stdout.write(`${JSON.stringify({
            event: "MYSQL_LOCAL_RUNNER_FINAL_VERIFY_FAILURES",
            failureLabels,
            failureDetails,
          })}\n`);
        }
        throw stableFailure(command, completed, diagnosticOptions);
      }
      let stageSummary = null;
      if (stage.id === "SCHEMA_SNAPSHOT_WRITE") {
        const inspection = inspectCommittedSnapshotProvenance();
        if (!inspection.matches
          || inspection.migrationSetDigest !== packet.migrationSet.expectedDigest) {
          const error = new Error("MYSQL_LOCAL_RUNNER_SCHEMA_WRITE_OUTCOME_INVALID");
          error.code = "MYSQL_LOCAL_RUNNER_SCHEMA_WRITE_OUTCOME_INVALID";
          throw error;
        }
        stageSummary = Object.freeze({
          ...inspection,
          keyInventoryCheckAttestation: inspectSnapshotCheckAttestation(
            fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8")
          ),
        });
      } else if (stage.id === "SCHEMA_SNAPSHOT_VERIFY") {
        stageSummary = parseSchemaSnapshotVerification(
          completed.stdout,
          packet.migrationSet.expectedDigest
        );
        const inspection = inspectCommittedSnapshotProvenance();
        if (!inspection.matches
          || inspection.migrationSetDigest !== packet.migrationSet.expectedDigest) {
          const error = new Error("MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_PROVENANCE_INVALID");
          error.code = "MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_PROVENANCE_INVALID";
          throw error;
        }
        stageSummary = Object.freeze({ ...stageSummary, provenance: inspection });
      } else if (stage.id === "FINAL_REPOSITORY_VERIFY") {
        stageSummary = parseFinalVerificationReport(completed.stdout);
      }
      writeCommandResult(command, completed, diagnosticOptions, stageSummary);
      validateAuthorizationPacket({
        root: ROOT,
        packetBytes: fs.readFileSync(packetPath),
        expectedSha256,
        migrationDescriptor: migrationSetDescriptor(),
        runtimeToolchainBinding,
      });
    }
    postSuccessComplete = true;
    discardMutableOutputSnapshot(mutableOutputSnapshot);
    mutableOutputSnapshot = undefined;
  } catch (error) {
    primaryError = error;
    if (mutableOutputSnapshot && !postSuccessComplete) {
      try {
        restoreMutableOutputs(ROOT, mutableOutputSnapshot);
        mutableOutputSnapshot = undefined;
      } catch (restoreError) {
        const aggregate = new AggregateError([error, restoreError],
          `${error.code || "MYSQL_LOCAL_RUNNER_ERROR"}+MYSQL_LOCAL_RUNNER_OUTPUT_ROLLBACK_FAILED`);
        aggregate.code = "MYSQL_LOCAL_RUNNER_OUTPUT_ROLLBACK_FAILED";
        if (error.commandDiagnostic) aggregate.commandDiagnostic = error.commandDiagnostic;
        primaryError = aggregate;
      }
    }
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    removed = cleanup();
    process.stdout.write(JSON.stringify({
      event: "MYSQL_LOCAL_RUNNER_CLEANUP",
      containerRemoved: removed,
    }) + "\n");
  }
  if (!removed) {
    const cleanupError = new Error("MYSQL_LOCAL_RUNNER_CLEANUP_FAILED");
    cleanupError.code = "MYSQL_LOCAL_RUNNER_CLEANUP_FAILED";
    if (primaryError) {
      const aggregate = new AggregateError([primaryError, cleanupError],
        `${primaryError.code || "MYSQL_LOCAL_RUNNER_ERROR"}+MYSQL_LOCAL_RUNNER_CLEANUP_FAILED`);
      aggregate.code = "MYSQL_LOCAL_RUNNER_COMMAND_AND_CLEANUP_FAILED";
      if (primaryError.commandDiagnostic) aggregate.commandDiagnostic = primaryError.commandDiagnostic;
      throw aggregate;
    }
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}

if (require.main === module) {
  main().catch((error) => {
    if (error.commandDiagnostic) {
      process.stderr.write(JSON.stringify({
        event: "MYSQL_LOCAL_RUNNER_COMMAND_DIAGNOSTIC",
        ...error.commandDiagnostic,
      }) + "\n");
    }
    process.stderr.write(`${error.code || "MYSQL_LOCAL_RUNNER_ERROR"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  captureMutableOutputs,
  discardMutableOutputSnapshot,
  main,
  restoreMutableOutputs,
};
