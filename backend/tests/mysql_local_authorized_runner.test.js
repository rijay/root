const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  AUTHENTICATED_READINESS_SQL,
  CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL,
  CHILD_ENV_ALLOWLIST,
  CHILD_FAILURE_DIAGNOSTIC_POLICY,
  EXECUTION_PLAN,
  FINAL_VERIFICATION_LABELS,
  MUTABLE_OUTPUT_PATHS,
  assertDockerDaemonAvailable,
  assertExternalAuthorization,
  assertPinnedImagePresent,
  authenticatedReady,
  buildChildCommandDiagnostic,
  buildChildEnv,
  buildDockerRunSpec,
  buildExecutionInputManifest,
  buildExecutionToolchainBinding,
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
  sanitizeMysqlDiagnostic,
  isRetryableReadinessError,
  sha256,
  validateAuthorizationPacket,
  waitForAuthenticatedMysql,
} = require("../src/mysqlLocalAuthorizedRunner");
const {
  captureMutableOutputs,
  discardMutableOutputSnapshot,
  restoreMutableOutputs,
} = require("../scripts/mysql-local-authorized-runner");

function tempPacketFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-local-mysql-runner-"));
  for (const directory of ["admin", "cloudfunctions", "contracts", "miniprogram", "scripts"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, ".fixture"), `${directory}\n`);
  }
  fs.writeFileSync(path.join(root, "cloudbaserc.json"), "{}\n");
  const files = [
    "backend/tests/mysql_local_readiness.integration.test.js",
    ...Array.from({ length: 6 }, (_, index) =>
      `backend/tests/mysql_${index + 1}.integration.test.js`),
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `// ${file}\n`);
  }
  const command = `node --test --test-reporter=tap --test-concurrency=1 ${files.join(" ")}`;
  const packageBytes = Buffer.from(JSON.stringify({ scripts: { "frozen:check": command } }));
  fs.writeFileSync(path.join(root, "package.json"), packageBytes);
  const packet = {
    schemaVersion: "myroot.local-mysql-authorization-packet.v19",
    releaseVersion: "v1.0.0",
    runtimePackageVersion: "0.5.13",
    status: "PREPARED_NOT_AUTHORIZED_NOT_EXECUTED",
    scope: {
      host: "127.0.0.1",
      port: "EPHEMERAL_RANDOM_HOST_PORT",
      candidateConnectionAuthorized: false,
      productionConnectionAuthorized: false,
      deploymentAuthorized: false,
      commitAuthorized: false,
      pushAuthorized: false,
    },
    container: {
      bindAddress: "127.0.0.1",
      removeAfterRun: true,
      sandboxMarkerDatabase: "myroot_schema_snapshot_sandbox_marker",
      image: `mysql:8.0.43@sha256:${"a".repeat(64)}`,
    },
    executionCommand: "npm run frozen:check",
    postSuccessCommands: [
      "npm run db:schema-snapshot:write",
      "npm run db:schema-snapshot:verify",
      "npm run verify -- --json",
    ],
    executionPlan: EXECUTION_PLAN,
    mutableOutputs: MUTABLE_OUTPUT_PATHS,
    executionPolicy: {
      testFileConcurrency: 1,
      packageJsonSha256: sha256(packageBytes),
      authenticatedReadinessSqlSha256: sha256(Buffer.from(AUTHENTICATED_READINESS_SQL)),
      childFailureDiagnostic: CHILD_FAILURE_DIAGNOSTIC_POLICY,
      childEnvironment: {
        inheritance: "ALLOWLIST_ONLY",
        allowlist: CHILD_ENV_ALLOWLIST,
        explicitOverlay: "FROZEN_TEST_ENABLE_VARIABLES_AND_SANDBOX_MYSQL_ONLY",
      },
      singleUseNonce: "01234567-89ab-cdef-0123-456789abcdef",
      executionInputManifest: null,
      toolchainBinding: null,
    },
    testGroups: files.map((file, index) => ({
      file,
      enableVariable: `GROUP_${index + 1}_ENABLED`,
      sha256: sha256(fs.readFileSync(path.join(root, file))),
    })),
    supportingInputs: [],
    priorAttemptEvidence: [],
    requiredOutcomes: {
      allEnabledTests: 13,
      allEnabledTestsPass: 13,
      enabledTestsFail: 0,
      enabledTestsSkip: 0,
      finalVerificationLabels: FINAL_VERIFICATION_LABELS,
      finalVerificationPassed: 18,
      finalVerificationFailed: 0,
    },
  };
  const runtimeToolchainBinding = buildExecutionToolchainBinding({ npmVersion: "11.8.0" });
  packet.executionPolicy.executionInputManifest = buildExecutionInputManifest(root);
  packet.executionPolicy.toolchainBinding = runtimeToolchainBinding;
  const packetBytes = Buffer.from(JSON.stringify(packet));
  return { root, packet, packetBytes, packetSha256: sha256(packetBytes), runtimeToolchainBinding };
}

test("authorization and CLI guards reject implicit or ambiguous execution", () => {
  assert.throws(() => assertExternalAuthorization({}), { code: "MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED" });
  assert.throws(
    () => assertExternalAuthorization({ MYROOT_LOCAL_MYSQL_AUTHORIZED: "true" }),
    { code: "MYSQL_LOCAL_RUNNER_AUTHORIZED_SHA_INVALID" }
  );
  assert.throws(() => assertExternalAuthorization({
    MYROOT_LOCAL_MYSQL_AUTHORIZED: "true",
    MYROOT_LOCAL_MYSQL_PACKET_SHA256: "a".repeat(64),
  }), { code: "MYSQL_LOCAL_RUNNER_AUTHORIZED_NONCE_INVALID" });
  assert.deepEqual(assertExternalAuthorization({
    MYROOT_LOCAL_MYSQL_AUTHORIZED: "true",
    MYROOT_LOCAL_MYSQL_PACKET_SHA256: "a".repeat(64),
    MYROOT_LOCAL_MYSQL_AUTHORIZATION_NONCE: "01234567-89ab-cdef-0123-456789abcdef",
  }), {
    packetSha256: "a".repeat(64),
    nonce: "01234567-89ab-cdef-0123-456789abcdef",
  });
  assert.deepEqual(parseCliArgs(["--packet", "packet.json"]), { packet: "packet.json" });
  assert.throws(() => parseCliArgs([]), { code: "MYSQL_LOCAL_RUNNER_USAGE_INVALID" });
});

test("authorization nonce is consumed once with a private marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-runner-nonce-"));
  try {
    const input = {
      root,
      packetSha256: "a".repeat(64),
      nonce: "01234567-89ab-cdef-0123-456789abcdef",
    };
    const file = consumeAuthorization(input);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => consumeAuthorization(input), {
      code: "MYSQL_LOCAL_RUNNER_AUTHORIZATION_ALREADY_CONSUMED",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Docker daemon and exact pinned image are proven before authorization consumption", () => {
  const image = `mysql:8.0.43@sha256:${"a".repeat(64)}`;
  assert.throws(() => assertDockerDaemonAvailable(() => ({ status: 1, stderr: "daemon down" })), {
    code: "MYSQL_LOCAL_RUNNER_DOCKER_DAEMON_UNAVAILABLE",
  });
  assert.deepEqual(assertDockerDaemonAvailable(() => ({ status: 0, stdout: "29.2.1\n" })), {
    serverVersion: "29.2.1",
  });
  assert.throws(() => assertPinnedImagePresent(image, () => ({ status: 1 })), {
    code: "MYSQL_LOCAL_RUNNER_PINNED_IMAGE_MISSING",
  });
  assert.throws(() => assertPinnedImagePresent(image, () => ({
    status: 0,
    stdout: JSON.stringify([{ Id: `sha256:${"b".repeat(64)}`, RepoDigests: [
      `mysql@sha256:${"b".repeat(64)}`,
    ] }]),
  })), { code: "MYSQL_LOCAL_RUNNER_PINNED_IMAGE_DIGEST_MISMATCH" });
  assert.deepEqual(assertPinnedImagePresent(image, () => ({
    status: 0,
    stdout: JSON.stringify([{ Id: `sha256:${"a".repeat(64)}`, RepoDigests: [
      `mysql@sha256:${"a".repeat(64)}`,
    ] }]),
  })), {
    imageId: `sha256:${"a".repeat(64)}`,
    digest: `sha256:${"a".repeat(64)}`,
  });
});

test("packet path must stay in the v1 evidence directory and cannot be a symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-runner-packet-path-"));
  try {
    const relative = "docs/evidence/v1.0.0/packet.json";
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), "{}\n");
    assert.equal(resolvePacketPath(root, relative), path.join(root, relative));
    assert.throws(() => resolvePacketPath(root, "../../packet.json"), {
      code: "MYSQL_LOCAL_RUNNER_PACKET_PATH_INVALID",
    });
    const symlink = "docs/evidence/v1.0.0/link.json";
    fs.symlinkSync(path.join(root, relative), path.join(root, symlink));
    assert.throws(() => resolvePacketPath(root, symlink), {
      code: "MYSQL_LOCAL_RUNNER_PACKET_SYMLINK",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frozen inputs reject a symlink in any parent directory", () => {
  const fixture = tempPacketFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-runner-outside-"));
  try {
    fs.renameSync(path.join(fixture.root, "scripts"), path.join(fixture.root, "scripts-real"));
    fs.symlinkSync(outside, path.join(fixture.root, "scripts"));
    assert.throws(() => buildExecutionInputManifest(fixture.root), {
      code: "MYSQL_LOCAL_RUNNER_FILE_PATH_SYMLINK",
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("packet validation freezes scope, package command, and all test bytes", () => {
  const fixture = tempPacketFixture();
  try {
    const result = validateAuthorizationPacket({
      root: fixture.root,
      packetBytes: fixture.packetBytes,
      expectedSha256: fixture.packetSha256,
      runtimeToolchainBinding: fixture.runtimeToolchainBinding,
    });
    assert.equal(result.scriptName, "frozen:check");
    fs.appendFileSync(path.join(fixture.root, fixture.packet.testGroups[0].file), "// drift\n");
    assert.throws(() => validateAuthorizationPacket({
      root: fixture.root,
      packetBytes: fixture.packetBytes,
      expectedSha256: fixture.packetSha256,
      runtimeToolchainBinding: fixture.runtimeToolchainBinding,
    }), { code: "MYSQL_LOCAL_RUNNER_FROZEN_INPUT_DRIFT" });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("execution input manifest rejects added, removed, or changed executable inputs before Docker", () => {
  for (const mutate of [
    (fixture) => fs.writeFileSync(path.join(fixture.root, "scripts", "added.js"), "module.exports = true;\n"),
    (fixture) => fs.rmSync(path.join(fixture.root, "admin", ".fixture")),
    (fixture) => fs.appendFileSync(path.join(fixture.root, "cloudbaserc.json"), " "),
  ]) {
    const fixture = tempPacketFixture();
    try {
      mutate(fixture);
      assert.throws(() => validateAuthorizationPacket({
        root: fixture.root,
        packetBytes: fixture.packetBytes,
        expectedSha256: fixture.packetSha256,
        runtimeToolchainBinding: fixture.runtimeToolchainBinding,
      }), { code: "MYSQL_LOCAL_RUNNER_EXECUTION_INPUT_DRIFT" });
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("packet validation rejects SHA, remote bind, and command drift before Docker", () => {
  const fixture = tempPacketFixture();
  try {
    assert.throws(() => validateAuthorizationPacket({
      root: fixture.root,
      packetBytes: fixture.packetBytes,
      expectedSha256: "b".repeat(64),
      runtimeToolchainBinding: fixture.runtimeToolchainBinding,
    }), { code: "MYSQL_LOCAL_RUNNER_PACKET_SHA_MISMATCH" });
    for (const mutate of [
      (packet) => { packet.scope.host = "mysql.production.internal"; },
      (packet) => { packet.container.bindAddress = "0.0.0.0"; },
      (packet) => { packet.executionCommand = "npm run arbitrary"; },
    ]) {
      const value = structuredClone(fixture.packet);
      mutate(value);
      const bytes = Buffer.from(JSON.stringify(value));
      assert.throws(() => validateAuthorizationPacket({
        root: fixture.root,
        packetBytes: bytes,
        expectedSha256: sha256(bytes),
        runtimeToolchainBinding: fixture.runtimeToolchainBinding,
      }));
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("packet validation rejects duplicate frozen paths", () => {
  const fixture = tempPacketFixture();
  try {
    const value = structuredClone(fixture.packet);
    value.supportingInputs.push({ ...value.testGroups[0] });
    const bytes = Buffer.from(JSON.stringify(value));
    assert.throws(() => validateAuthorizationPacket({
      root: fixture.root,
      packetBytes: bytes,
      expectedSha256: sha256(bytes),
      runtimeToolchainBinding: fixture.runtimeToolchainBinding,
    }), { code: "MYSQL_LOCAL_RUNNER_FROZEN_INPUT_DUPLICATE" });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("packet validation rejects Node or npm toolchain drift", () => {
  const fixture = tempPacketFixture();
  try {
    const value = structuredClone(fixture.packet);
    value.executionPolicy.toolchainBinding.npmVersion = "99.0.0";
    const bytes = Buffer.from(JSON.stringify(value));
    assert.throws(() => validateAuthorizationPacket({
      root: fixture.root,
      packetBytes: bytes,
      expectedSha256: sha256(bytes),
      runtimeToolchainBinding: fixture.runtimeToolchainBinding,
    }), { code: "MYSQL_LOCAL_RUNNER_TOOLCHAIN_DRIFT" });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("only an exact IPv4 loopback random port is accepted", () => {
  assert.equal(parseLoopbackPort("127.0.0.1:49152\n"), 49152);
  for (const value of ["0.0.0.0:49152", "[::]:49152", "127.0.0.1:0", "127.0.0.1:65536"] ) {
    assert.throws(() => parseLoopbackPort(value), { code: "MYSQL_LOCAL_RUNNER_NON_LOOPBACK_PORT" });
  }
});

test("container inspect requires exact ID, ownership label, and one loopback binding", () => {
  const containerId = "a".repeat(64);
  const ownershipToken = crypto.randomUUID();
  const record = [{
    Id: containerId,
    Config: { Labels: { "com.myroot.local-mysql-proof": ownershipToken } },
    NetworkSettings: { Ports: { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] } },
  }];
  assert.equal(parseOwnedContainerInspect(JSON.stringify(record), {
    containerId,
    ownershipToken,
  }).port, 49152);
  record[0].Config.Labels["com.myroot.local-mysql-proof"] = "other";
  assert.throws(() => parseOwnedContainerInspect(JSON.stringify(record), {
    containerId,
    ownershipToken,
  }), { code: "MYSQL_LOCAL_RUNNER_CONTAINER_OWNERSHIP_UNPROVEN" });
});

test("Docker run spec binds random loopback and keeps the password out of argv", () => {
  const password = "S3CRET_DO_NOT_LEAK_abcdefghijklmnopqrstuvwxyz";
  const spec = buildDockerRunSpec({
    containerName: "myroot-mysql-authorized-123-456",
    ownershipToken: "01234567-89ab-cdef-0123-456789abcdef",
    image: `mysql:8.0.43@sha256:${"a".repeat(64)}`,
    rootPassword: password,
  });
  assert.deepEqual(spec.args.slice(0, 2), ["run", "-d"]);
  assert.equal(spec.args.includes("127.0.0.1::3306"), true);
  assert.equal(spec.args.join(" ").includes(password), false);
  assert.equal(spec.env.MYSQL_ROOT_PASSWORD, password);
  assert.equal(spec.env.MYSQL_DATABASE, "myroot_schema_snapshot_sandbox_marker");
});

test("owned cleanup removes only the exact inspected ID and proves absence", () => {
  const exactId = "a".repeat(64);
  const token = "01234567-89ab-cdef-0123-456789abcdef";
  const calls = [];
  const results = [
    {
      status: 0,
      stdout: JSON.stringify([{
        Id: exactId,
        Config: { Labels: { "com.myroot.local-mysql-proof": token } },
      }]),
    },
    { status: 0, stdout: exactId },
    { status: 1, stdout: "" },
  ];
  const result = cleanupOwnedContainer({
    containerId: "",
    containerName: "myroot-mysql-authorized-123-456",
    ownershipToken: token,
    run(command, args) {
      calls.push([command, args]);
      return results.shift();
    },
  });
  assert.equal(result.removed, true);
  assert.deepEqual(calls[1], ["docker", ["rm", "-f", exactId]]);
  assert.equal(calls.some(([, args]) => args.includes("unrelated-mysql")), false);
});

test("owned cleanup refuses a replaced or unlabeled container", () => {
  const calls = [];
  assert.throws(() => cleanupOwnedContainer({
    containerId: "a".repeat(64),
    containerName: "myroot-mysql-authorized-123-456",
    ownershipToken: "01234567-89ab-cdef-0123-456789abcdef",
    run(command, args) {
      calls.push([command, args]);
      return {
        status: 0,
        stdout: JSON.stringify([{
          Id: "b".repeat(64),
          Config: { Labels: { "com.myroot.local-mysql-proof": "other" } },
        }]),
      };
    },
  }), { code: "MYSQL_LOCAL_RUNNER_CONTAINER_OWNERSHIP_UNPROVEN" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 1), ["inspect"]);
});

test("mutable output snapshot restores prior files and removes newly generated outputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-runner-output-rollback-"));
  const existing = "backend/db/schema.sql";
  const generated = "admin/dist";
  try {
    fs.mkdirSync(path.dirname(path.join(root, existing)), { recursive: true });
    fs.writeFileSync(path.join(root, existing), "old snapshot\n");
    const snapshot = captureMutableOutputs(root, [existing, generated]);
    fs.writeFileSync(path.join(root, existing), "new snapshot\n");
    fs.mkdirSync(path.join(root, generated), { recursive: true });
    fs.writeFileSync(path.join(root, generated, "index.js"), "generated\n");
    restoreMutableOutputs(root, snapshot);
    assert.equal(fs.readFileSync(path.join(root, existing), "utf8"), "old snapshot\n");
    assert.equal(fs.existsSync(path.join(root, generated)), false);

    const unused = captureMutableOutputs(root, [existing]);
    discardMutableOutputSnapshot(unused);
    assert.equal(fs.existsSync(unused.backupRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("secret redaction removes every occurrence before output", () => {
  const secret = "S3CRET_DO_NOT_LEAK_123";
  const redacted = redactSecrets(`password=${secret}\nagain=${secret}`, [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.equal((redacted.match(/\[REDACTED\]/g) || []).length, 2);
});

test("child failure diagnostic keeps channels separate and redacts credentials and ephemeral port", () => {
  const secret = "S3cr3t:/?#[]@!$&'()*+,;=";
  const port = 49152;
  const encoded = encodeURIComponent(secret);
  const base64 = Buffer.from(secret).toString("base64");
  const base64url = Buffer.from(secret).toString("base64url");
  const result = buildChildCommandDiagnostic({
    status: 1,
    stdout: `\u001b[31mSTDOUT_FAILURE\u001b[0m password=${secret} ${encoded} ${base64}`,
    stderr: `STDERR_FAILURE mysql://root:${encoded}@127.0.0.1:${port}/db token=abc cookie=session`,
  }, { secrets: [secret], ephemeralPort: port });
  assert.deepEqual(result.termination, {
    kind: "EXIT", exitCode: 1, signal: null, errorCode: null,
  });
  assert.equal(result.outputReason, "CHILD_OUTPUT_RETAINED");
  assert.match(result.stdout.retainedTail, /STDOUT_FAILURE/);
  assert.doesNotMatch(result.stdout.retainedTail, /STDERR_FAILURE/);
  assert.match(result.stderr.retainedTail, /STDERR_FAILURE/);
  assert.doesNotMatch(result.stderr.retainedTail, /STDOUT_FAILURE/);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    secret, encoded, base64, base64url, `127.0.0.1:${port}`,
    "token=abc", "cookie=session", "\\u001b",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.match(serialized, /\[REDACTED\]|EPHEMERAL_PORT/);
});

test("child diagnostic is UTF-8 safe, bounded per channel, and retains the failure tail", () => {
  const prefix = "开头不得保留🙂".repeat(2000);
  const result = buildChildCommandDiagnostic({
    status: 1,
    stdout: `${prefix}\nSTDOUT_FINAL_FAILURE`,
    stderr: `${prefix}\nSTDERR_FINAL_FAILURE`,
  });
  for (const [channel, marker] of [
    [result.stdout, "STDOUT_FINAL_FAILURE"],
    [result.stderr, "STDERR_FINAL_FAILURE"],
  ]) {
    assert.equal(channel.truncated, true);
    assert.ok(Buffer.byteLength(channel.retainedTail)
      <= CHILD_DIAGNOSTIC_MAX_UTF8_BYTES_PER_CHANNEL);
    assert.match(channel.retainedTail, new RegExp(marker));
    assert.doesNotMatch(channel.retainedTail, /�/);
    assert.match(channel.redactedSha256, /^[0-9a-f]{64}$/);
  }
});

test("child diagnostic preserves every redacted top-level TAP failure label outside the retained tail", () => {
  const secret = "DO_NOT_LEAK_TAP_SECRET";
  const prefix = [
    `not ok 2 - first failure ${secret}`,
    "  ---",
    "  failureType: 'testCodeFailure'",
    "  code: 'ERR_ASSERTION'",
    "not ok 7 - runtime principal authority",
    "  ---",
    "  failureType: 'testCodeFailure'",
    "  code: 'ERR_ASSERTION'",
  ].join("\n");
  const result = buildChildCommandDiagnostic({
    status: 1,
    stdout: `${prefix}\n${"x".repeat(9000)}\nFINAL_TAIL`,
    stderr: "",
  }, { secrets: [secret] });
  assert.equal(result.stdout.truncated, true);
  assert.doesNotMatch(result.stdout.retainedTail, /first failure/);
  assert.deepEqual(
    result.tapFailureSummary.failures.map(({ ordinal, name }) => ({ ordinal, name })),
    [
      { ordinal: 2, name: "first failure [REDACTED]" },
      { ordinal: 7, name: "runtime principal authority" },
    ]
  );
  assert.equal(result.tapFailureSummary.truncated, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  for (const failure of result.tapFailureSummary.failures) {
    assert.match(failure.nameSha256, /^[0-9a-f]{64}$/);
    assert.equal(failure.errorCode, "ERR_ASSERTION");
    assert.equal(failure.failureType, "testCodeFailure");
    assert.match(failure.diagnosticSha256, /^[0-9a-f]{64}$/);
  }
});

test("TAP failure label parser ignores nested diagnostics and caps structured output", () => {
  const output = [
    "  not ok 1 - nested failure",
    ...Array.from({ length: 40 }, (_, index) => `not ok ${index + 1} - failure ${index + 1}`),
  ].join("\n");
  const parsed = parseTapFailureLabels(output);
  assert.equal(parsed.failures.length, 32);
  assert.equal(parsed.failures[0].ordinal, 1);
  assert.equal(parsed.failures.at(-1).ordinal, 32);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.failures[0].errorCode, "UNKNOWN");
  assert.equal(parsed.failures[0].failureType, "UNKNOWN");
});

test("child diagnostic distinguishes no output, signal, spawn error, and buffer exhaustion", () => {
  const empty = buildChildCommandDiagnostic({ status: 1, stdout: "", stderr: "" });
  assert.equal(empty.outputReason, "NO_CHILD_OUTPUT");
  assert.equal(empty.stdout.present, false);
  assert.equal(empty.stderr.retainedTail, "");
  assert.deepEqual(buildChildCommandDiagnostic({ signal: "SIGTERM" }).termination, {
    kind: "SIGNAL", exitCode: null, signal: "SIGTERM", errorCode: null,
  });
  assert.deepEqual(buildChildCommandDiagnostic({ error: { code: "ENOENT" } }).termination, {
    kind: "SPAWN_ERROR", exitCode: null, signal: null, errorCode: "ENOENT",
  });
  assert.deepEqual(buildChildCommandDiagnostic({ error: { code: "ENOBUFS" } }).termination, {
    kind: "BUFFER_LIMIT", exitCode: null, signal: null, errorCode: "ENOBUFS",
  });
});

test("child environment allowlist excludes inherited credentials and accepts only explicit overlay", () => {
  const environment = buildChildEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    AWS_SECRET_ACCESS_KEY: "DO_NOT_INHERIT",
    MYROOT_PARENT_TOKEN: "DO_NOT_INHERIT",
    NODE_OPTIONS: "--require /tmp/untrusted.js",
  }, {
    GROUP_ENABLED: "true",
    SCHEMA_SNAPSHOT_MYSQL_PASSWORD: "explicit-sandbox-secret",
  });
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.HOME, "/tmp/home");
  assert.equal(environment.GROUP_ENABLED, "true");
  assert.equal(environment.SCHEMA_SNAPSHOT_MYSQL_PASSWORD, "explicit-sandbox-secret");
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.MYROOT_PARENT_TOKEN, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.NO_COLOR, "1");
  assert.equal(environment.FORCE_COLOR, "0");
});

function readyRows(uuid = "01234567-89ab-cdef-0123-456789abcdef") {
  return [{
    readiness_ok: 1,
    mysql_version: "8.0.43",
    authenticated_account: "root@%",
    instance_uuid: uuid,
  }];
}

test("readiness SQL uses stable non-keyword aliases for pinned MySQL 8.0.43", () => {
  assert.equal(AUTHENTICATED_READINESS_SQL,
    "SELECT 1 AS `readiness_ok`, VERSION() AS `mysql_version`, "
    + "CURRENT_USER() AS `authenticated_account`, @@server_uuid AS `instance_uuid`");
  assert.doesNotMatch(AUTHENTICATED_READINESS_SQL, /\bAS\s+(?:current_user|version|server_uuid)\b/i);
});

test("readiness requires credential-authenticated SELECT 1 and closes each attempt", async () => {
  let clock = 0;
  let attempts = 0;
  let closed = 0;
  let disposableChecks = 0;
  const connect = async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("initializing"), { code: "ER_ACCESS_DENIED_ERROR" });
    return {
      async query(sql) {
        assert.equal(sql, AUTHENTICATED_READINESS_SQL);
        return [readyRows(), []];
      },
      async end() { closed += 1; },
    };
  };
  const readiness = await waitForAuthenticatedMysql({
    connect,
    timeoutMs: 10,
    pollIntervalMs: 1,
    now: () => clock,
    wait: async () => { clock += 1; },
    verifyDisposableServer: async () => { disposableChecks += 1; },
  });
  assert.equal(readiness.serverUuid, "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(attempts, 4);
  assert.equal(closed, 2);
  assert.equal(disposableChecks, 2);
  assert.equal(authenticatedReady(readyRows()), true);
  assert.equal(authenticatedReady([{ ...readyRows()[0], mysql_version: "8.0.44" }]), false);
});

test("deterministic readiness SQL failure stops after one attempt with redacted evidence", async () => {
  let attempts = 0;
  let closed = 0;
  const parseError = Object.assign(new Error("fallback password=hunter2"), {
    code: "ER_PARSE_ERROR",
    errno: 1064,
    sqlState: "42000",
    sqlMessage: "Syntax near authenticated_account\n password=hunter2 token=abc123",
  });
  await assert.rejects(waitForAuthenticatedMysql({
    connect: async () => ({
      async query(sql) {
        attempts += 1;
        assert.equal(sql, AUTHENTICATED_READINESS_SQL);
        throw parseError;
      },
      async end() { closed += 1; },
    }),
    timeoutMs: 90_000,
    pollIntervalMs: 1,
  }), (error) => {
    assert.equal(error.code, "MYSQL_LOCAL_RUNNER_READINESS_DETERMINISTIC_FAILURE");
    assert.match(error.message, /ER_PARSE_ERROR/);
    assert.match(error.message, /authenticated_account/);
    assert.doesNotMatch(error.message, /hunter2|abc123/);
    return true;
  });
  assert.equal(attempts, 1);
  assert.equal(closed, 1);
  assert.deepEqual(sanitizeMysqlDiagnostic(parseError), {
    code: "ER_PARSE_ERROR",
    errno: 1064,
    sqlState: "42000",
    message: "Syntax near authenticated_account password=[REDACTED] token=[REDACTED]",
  });
  assert.equal(isRetryableReadinessError(parseError), false);
  assert.equal(isRetryableReadinessError({ code: "ER_ACCESS_DENIED_ERROR" }), true);
});

test("disposable-server invariant failure is deterministic and never retried", async () => {
  let attempts = 0;
  await assert.rejects(waitForAuthenticatedMysql({
    connect: async () => ({
      async query() { attempts += 1; return [readyRows(), []]; },
      async end() {},
    }),
    verifyDisposableServer: async () => {
      throw Object.assign(new Error("marker not unique"), {
        code: "SCHEMA_SNAPSHOT_SANDBOX_MARKER_INVALID",
      });
    },
  }), { code: "MYSQL_LOCAL_RUNNER_READINESS_DETERMINISTIC_FAILURE" });
  assert.equal(attempts, 1);
});

test("readiness rejects server UUID drift until two authenticated observations agree", async () => {
  let clock = 0;
  let attempts = 0;
  const uuids = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "22222222-2222-2222-2222-222222222222",
  ];
  const result = await waitForAuthenticatedMysql({
    connect: async () => ({
      async query() { return [readyRows(uuids[attempts++]), []]; },
      async end() {},
    }),
    timeoutMs: 10,
    pollIntervalMs: 1,
    now: () => clock,
    wait: async () => { clock += 1; },
  });
  assert.equal(result.serverUuid, uuids[2]);
  assert.equal(attempts, 3);
});

test("real-engine summary cannot treat skips or a zero exit code alone as proof", () => {
  const pass = "ℹ tests 12\nℹ pass 12\nℹ fail 0\nℹ skipped 0\n";
  assert.deepEqual(parseNodeTestSummary(pass), {
    tests: 12,
    passed: 12,
    failed: 0,
    skipped: 0,
  });
  const thirteen = "ℹ tests 13\nℹ pass 13\nℹ fail 0\nℹ skipped 0\n";
  assert.deepEqual(parseNodeTestSummary(thirteen, 13), {
    tests: 13,
    passed: 13,
    failed: 0,
    skipped: 0,
  });
  assert.throws(
    () => parseNodeTestSummary("ℹ tests 12\nℹ pass 6\nℹ fail 0\nℹ skipped 6\n"),
    { code: "MYSQL_LOCAL_RUNNER_REAL_ENGINE_SUMMARY_INVALID" }
  );
  assert.throws(
    () => parseNodeTestSummary(`${pass}${pass}`),
    { code: "MYSQL_LOCAL_RUNNER_REAL_ENGINE_SUMMARY_INVALID" }
  );
  assert.throws(
    () => parseNodeTestSummary(`hidden branch # SKIP\n${pass}`),
    { code: "MYSQL_LOCAL_RUNNER_REAL_ENGINE_SUMMARY_INVALID" }
  );
});

test("schema and final verification outputs require exact structured success", () => {
  const migrationSetDigest = "a".repeat(64);
  assert.equal(parseSchemaSnapshotVerification(JSON.stringify({
    matches: true,
    snapshotPath: "/tmp/schema.sql",
    expectedSha256: "b".repeat(64),
    actualSha256: "b".repeat(64),
  }), migrationSetDigest).matches, true);
  assert.throws(() => parseSchemaSnapshotVerification("not-json", migrationSetDigest), {
    code: "MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_OUTPUT_INVALID",
  });
  assert.throws(() => parseSchemaSnapshotVerification(JSON.stringify({
    matches: false,
    snapshotPath: "/tmp/schema.sql",
    expectedSha256: "b".repeat(64),
    actualSha256: "c".repeat(64),
  }), migrationSetDigest), { code: "MYSQL_LOCAL_RUNNER_SCHEMA_VERIFY_OUTCOME_INVALID" });

  const report = {
    summary: { status: "PASS", passed: 18, failed: 0, total: 18 },
    results: FINAL_VERIFICATION_LABELS.map((label) => ({ label, status: "PASS" })),
  };
  assert.equal(parseFinalVerificationReport(JSON.stringify(report)).passed, 18);
  report.results[0].status = "FAIL";
  assert.throws(() => parseFinalVerificationReport(JSON.stringify(report)), {
    code: "MYSQL_LOCAL_RUNNER_FINAL_VERIFY_OUTCOME_INVALID",
  });
  report.summary = { status: "FAIL", passed: 17, failed: 1, total: 18 };
  assert.deepEqual(parseFinalVerificationFailureLabels(JSON.stringify(report)), [
    FINAL_VERIFICATION_LABELS[0],
  ]);
  report.results[0].label = "Backend tests";
  report.results[0].code = null;
  report.results[0].signal = "SIGTERM";
  report.results[0].errorCode = null;
  report.results[0].stdout = "not ok 1 - exact backend failure\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n";
  const failureDetails = parseFinalVerificationFailureDetails(JSON.stringify(report));
  assert.equal(failureDetails[0].label, "Backend tests");
  assert.equal(failureDetails[0].testFailures.failures[0].name, "exact backend failure");
  assert.deepEqual(failureDetails[0].termination, {
    kind: "SIGNAL", exitCode: null, signal: "SIGTERM", errorCode: null,
  });
  assert.deepEqual(failureDetails[0].testSummary, {
    tests: null, passed: null, failed: null, cancelled: null, skipped: null, todo: null,
  });
  assert.equal(failureDetails[0].stdout.present, true);
  assert.equal(failureDetails[0].stderr.present, false);

  report.results[0].signal = null;
  report.results[0].errorCode = "ENOBUFS";
  report.results[0].stdout = [
    "ℹ tests 1366", "ℹ pass 1357", "ℹ fail 0", "ℹ cancelled 0", "ℹ skipped 9", "ℹ todo 0", "",
  ].join("\n");
  const bufferFailure = parseFinalVerificationFailureDetails(JSON.stringify(report))[0];
  assert.deepEqual(bufferFailure.termination, {
    kind: "BUFFER_LIMIT", exitCode: null, signal: null, errorCode: "ENOBUFS",
  });
  assert.deepEqual(bufferFailure.testSummary, {
    tests: 1366, passed: 1357, failed: 0, cancelled: 0, skipped: 9, todo: 0,
  });
});

test("readiness times out fail-closed without treating authentication failure as ready", async () => {
  let clock = 0;
  await assert.rejects(waitForAuthenticatedMysql({
    connect: async () => { throw Object.assign(new Error("denied"), { code: "ER_ACCESS_DENIED_ERROR" }); },
    timeoutMs: 2,
    pollIntervalMs: 1,
    now: () => clock,
    wait: async () => { clock += 1; },
  }), (error) => error.code === "MYSQL_LOCAL_RUNNER_AUTHENTICATED_READINESS_TIMEOUT"
    && /ER_ACCESS_DENIED_ERROR/.test(error.message));
});

test("CLI fails before invoking Docker when explicit authorization is absent", () => {
  const script = path.join(__dirname, "../scripts/mysql-local-authorized-runner.js");
  const result = spawnSync(process.execPath, [script, "--packet", "missing.json"], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith("MYROOT_LOCAL_MYSQL_"))),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED/);
  assert.doesNotMatch(result.stderr, /docker/);
});
