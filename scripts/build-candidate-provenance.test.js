const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  buildCandidateProvenance,
  deriveDeterministicProvenance,
  parseArgs,
  validateContract,
  verifyCandidateProvenance,
} = require("./build-candidate-provenance");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const CONTRACT_FIXTURE = path.join(
  WORKSPACE_ROOT,
  "contracts",
  "artifact-provenance",
  "v1.0.0.json"
);
const REQUIRED_CHECKS_CONTRACT = path.join(
  WORKSPACE_ROOT,
  "contracts",
  "required-checks",
  "v1.0.0.json"
);

function write(root, relativePath, content = `${relativePath}\n`) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-17T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-17T00:00:00Z",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function fixtureRepository(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-provenance-repo-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);

  write(root, "admin/src/app.js", "module.exports = 'admin';\n");
  write(root, "backend/src/server.js", "module.exports = 'backend';\n");
  write(root, "backend/db/migrations/001.sql", "SELECT 1;\n");
  write(root, "backend/db/schema.sql", "CREATE TABLE fixture (id INT);\n");
  write(root, "cloudfunctions/job/index.js", "module.exports = 'job';\n");
  write(root, "cloudbaserc.json", "{}\n");
  write(root, "docs/design.md", "# Design\n");
  write(
    root,
    "docs/v1.0.0_gate_and_document_authority_decision_2026-07-15.md",
    "# Gate\n"
  );
  write(root, "docs/v1.0.0_product_requirements.md", "# PRD\n");
  if (options.omitModule !== "MINIPROGRAM") {
    write(root, "miniprogram/app.js", "App({});\n");
  }
  write(root, "contracts/route-registry/v1.0.0.json", "{}\n");
  write(root, "contracts/inbox-handler-registry/v1.0.0.json", "{}\n");
  write(root, "scripts/lib/route-registry.js", "module.exports = {};\n");
  write(root, "scripts/route-registry-v1.test.js", "module.exports = true;\n");
  write(root, "scripts/validate-v1-route-registry.js", "module.exports = true;\n");
  write(root, ".github/workflows/ci.yml", "name: fixture-ci\n");
  write(root, "contracts/baseline-signoff/v1.0.0.json", "{}\n");
  write(root, "contracts/formal-launch-readiness/v1.0.0.json", "{}\n");
  write(root, "contracts/platform-control-evidence/v1.0.0.json", "{}\n");
  write(root, "contracts/required-checks/v1.0.0.json", "{}\n");
  write(root, "contracts/release-evidence/v1.0.0.json", "{}\n");
  write(root, "package.json", "{}\n");
  write(root, "scripts/build-candidate-provenance.js", "module.exports = {};\n");
  write(root, "scripts/final-verification.js", "module.exports = {};\n");
  write(root, "scripts/validate-formal-launch-readiness.js", "module.exports = {};\n");

  const contract = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf8"));
  if (options.mutateContract) options.mutateContract(contract);
  write(
    root,
    "contracts/artifact-provenance/v1.0.0.json",
    `${JSON.stringify(contract, null, 2)}\n`
  );
  if (options.symlink) {
    const linkPath = path.join(root, "admin", "src", "linked.js");
    fs.symlinkSync("app.js", linkPath);
  }
  if (options.forbiddenFile) write(root, "backend/.env.production", "DO_NOT_ARCHIVE=true\n");
  return { root, sourceCommit: commit(root, "fixture") };
}

function outputDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `myroot-candidate-provenance-${label}-`));
}

function builder(runRef = "github-actions:run:100:attempt:1") {
  return {
    provider: "GITHUB_ACTIONS",
    repositoryRef: "root/fixture",
    workflowRef: "root/fixture/.github/workflows/ci.yml@refs/heads/main",
    runRef,
    eventName: "pull_request",
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test("contract fixes seven module policies and keeps every authorization false", () => {
  const contract = validateContract(JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf8")));
  assert.deepEqual(contract.requiredArtifactModuleIds, [
    "ADMIN",
    "BACKEND",
    "CLOUD_FUNCTION",
    "CONTENT",
    "MIGRATION",
    "MINIPROGRAM",
    "ROUTE_REGISTRY",
  ]);
  assert.deepEqual(
    contract.moduleSourcePolicies.find(({ moduleId }) => moduleId === "BACKEND"),
    {
      moduleId: "BACKEND",
      includePrefixes: ["backend/", "contracts/"],
      includeFiles: [],
    }
  );
  assert.deepEqual(contract.authorization, {
    runtimeAuthorized: false,
    candidateCreationAuthorized: false,
    deploymentAuthorized: false,
    attestationAuthorized: false,
    gateClosureAuthorized: false,
  });
  assert.equal(
    contract.actionPolicy.status,
    "IMMUTABLE_ACTION_SHAS_VERIFIED_FROM_OFFICIAL_GITHUB_TAG_REFS_2026_07_17"
  );
  assert.deepEqual(contract.actionPolicy.locallyVerifiedImmutableActionRefs, [
    "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  ]);
  assert.deepEqual(contract.actionPolicy.mutableActionRefs, []);
  assert.equal(contract.remoteClosureRequirements.requiredCheckProtectionProofRequired, true);
  assert.equal(contract.remoteClosureRequirements.remoteArtifactReadbackRequired, true);
  assert.equal(
    contract.remoteClosureRequirements.oidcAttestationRequiresExplicitAuthorization,
    true
  );
});

test("CI exposes a least-privilege source-only provenance check with pinned action SHAs", () => {
  const workflow = fs.readFileSync(path.join(WORKSPACE_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const contract = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf8"));
  const requiredChecks = JSON.parse(fs.readFileSync(REQUIRED_CHECKS_CONTRACT, "utf8"));
  assert.deepEqual(requiredChecks.requiredChecks.map(({ jobId, expectedName }) => ({
    jobId,
    expectedName,
  })), [
    { jobId: "candidate-provenance", expectedName: "Source provenance only" },
    { jobId: "verify", expectedName: "Full verification" },
    {
      jobId: "cloudfunctions-node18",
      expectedName: "Cloud Functions Node.js 18 compatibility",
    },
  ]);
  for (const check of requiredChecks.requiredChecks) {
    assert.match(workflow, new RegExp(`^  ${check.jobId}:\\s*$`, "m"));
    assert.match(workflow, new RegExp(`^    name: ${check.expectedName}\\s*$`, "m"));
    assert.deepEqual(check.allowedConclusions, ["success"]);
  }
  assert.equal(requiredChecks.authorization.protectionMutationAuthorized, false);
  assert.equal(requiredChecks.authorization.gateClosureAuthorized, false);
  assert.match(workflow, /^\s{2}candidate-provenance:\s*$/m);
  assert.match(workflow, /^\s{4}name: Source provenance only\s*$/m);
  assert.equal(contract.remoteClosureRequirements.evidenceClass, "SOURCE_PROVENANCE_ONLY");
  assert.equal(
    contract.remoteClosureRequirements.expectedRequiredCheckName,
    "Source provenance only"
  );
  assert.match(workflow, /^\s{6}contents: read\s*$/m);
  assert.match(workflow, /node --test scripts\/build-candidate-provenance\.test\.js/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(workflow, /--source-commit "\$GITHUB_SHA"/);
  assert.match(workflow, /--verify/);
  assert.match(
    workflow,
    /image: mysql:8\.0\.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10/
  );
  assert.match(
    workflow,
    /--health-cmd="MYSQL_PWD=schema_snapshot_ci_only mysql -h 127\.0\.0\.1 -uroot -Nse 'SELECT 1'"/
  );
  assert.doesNotMatch(workflow, /mysqladmin\s+ping/);
  assert.match(workflow, /ACTIVITY_GENERATION_MYSQL_INTEGRATION_ENABLED: "true"/);
  assert.match(workflow, /ACTIVITY_P0_POLICY_MYSQL_INTEGRATION_ENABLED: "true"/);
  assert.equal(
    [...workflow.matchAll(/node-version: "22\.23\.2"/g)].length,
    1,
    "Full verification must use the pinned Node 22 runtime that provides node:sqlite"
  );
  assert.match(workflow, /npm run v1:mysql-001-066-authorized:check/);
  assert.match(workflow, /parseNodeTestSummary\(fs\.readFileSync\(process\.argv\[1\], "utf8"\), 13\)/);
  for (const variable of [
    "MYSQL_LOCAL_READINESS_INTEGRATION_ENABLED",
    "IDENTITY_NOTIFICATION_BINDING_MYSQL_INTEGRATION_ENABLED",
    "NOTIFICATION_PROVIDER_FENCE_MYSQL_INTEGRATION_ENABLED",
    "V1_RUNTIME_ALERT_DELIVERY_MYSQL_INTEGRATION_ENABLED",
    "SETTLEMENT_SOURCE_AUTHORITY_MYSQL_INTEGRATION_ENABLED",
    "V1_RUNTIME_LEDGER_INTEGRATION_ENABLED",
    "MYSQL_RUNTIME_PRINCIPAL_BOOTSTRAP_INTEGRATION_ENABLED",
  ]) {
    assert.match(workflow, new RegExp(`${variable}: "true"`), variable);
  }
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.match(workflow, /official GitHub tag ref/);
  assert.doesNotMatch(workflow, /^\s*(?:id-token|attestations|contents): write\s*$/m);
  const actionRefs = [...new Set(
    [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1])
  )].sort();
  assert.deepEqual(
    actionRefs,
    [...contract.actionPolicy.locallyVerifiedImmutableActionRefs].sort()
  );
  assert.equal(actionRefs.every((ref) => /@[a-f0-9]{40}$/.test(ref)), true);
});

test("source, module and USTAR digests are deterministic while builder refs stay outer", () => {
  const fixture = fixtureRepository();
  const firstOutput = outputDirectory("deterministic-a");
  const secondOutput = outputDirectory("deterministic-b");
  try {
    const first = buildCandidateProvenance({
      repositoryRoot: fixture.root,
      sourceCommit: fixture.sourceCommit,
      outputDirectory: firstOutput,
      builder: builder("github-actions:run:100:attempt:1"),
    });
    const second = buildCandidateProvenance({
      repositoryRoot: fixture.root,
      sourceCommit: fixture.sourceCommit,
      outputDirectory: secondOutput,
      builder: builder("github-actions:run:101:attempt:2"),
    });
    assert.equal(first.payloadDigest, second.payloadDigest);
    assert.equal(first.sourceArchiveSha256, second.sourceArchiveSha256);
    assert.notEqual(first.builderEnvelopeDigest, second.builderEnvelopeDigest);
    assert.deepEqual(
      fs.readFileSync(path.join(firstOutput, "candidate-provenance.payload.json")),
      fs.readFileSync(path.join(secondOutput, "candidate-provenance.payload.json"))
    );
    assert.deepEqual(
      fs.readFileSync(path.join(firstOutput, "candidate-source.tar")),
      fs.readFileSync(path.join(secondOutput, "candidate-source.tar"))
    );

    const payload = readJson(path.join(firstOutput, "candidate-provenance.payload.json"));
    const envelope = readJson(path.join(firstOutput, "candidate-provenance.builder.json"));
    assert.equal(payload.artifactDigestByModule.length, 7);
    payload.artifactDigestByModule.forEach((entry) => {
      assert.match(entry.artifactDigest, /^[a-f0-9]{64}$/);
      assert.equal(entry.artifactKind, "DETERMINISTIC_SOURCE_MODULE_V1");
    });
    assert.equal(Object.hasOwn(payload, "builder"), false);
    assert.equal(envelope.builder.runRef, "github-actions:run:100:attempt:1");
    assert.equal(envelope.governance.requiredCheckStatus, "REMOTE_CONFIGURATION_REQUIRED");
    assert.equal(envelope.governance.oidcAttestationStatus, "REMOTE_ONLY_NOT_AUTHORIZED");
    assert.equal(envelope.governance.attestationPermissionsGranted, false);

    const verified = verifyCandidateProvenance({
      repositoryRoot: fixture.root,
      sourceCommit: fixture.sourceCommit,
      outputDirectory: firstOutput,
    });
    assert.equal(verified.status, "VERIFIED_LOCAL_PROVENANCE_FOUNDATION");
    assert.equal(verified.payloadDigest, first.payloadDigest);
    assert.equal(verified.gateClosureAuthorized, false);

    const listed = spawnSync("tar", ["-tf", path.join(firstOutput, "candidate-source.tar")], {
      encoding: "utf8",
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /^source\/admin\/src\/app\.js$/m);
    assert.match(listed.stdout, /^source\/contracts\/artifact-provenance\/v1\.0\.0\.json$/m);
    assert.match(listed.stdout, /^source\/contracts\/inbox-handler-registry\/v1\.0\.0\.json$/m);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(firstOutput, { recursive: true, force: true });
    fs.rmSync(secondOutput, { recursive: true, force: true });
  }
});

test("source changes alter only the affected module plus source/archive identities", () => {
  const fixture = fixtureRepository();
  try {
    const first = deriveDeterministicProvenance(fixture.root, fixture.sourceCommit);
    write(fixture.root, "backend/src/server.js", "module.exports = 'backend-v2';\n");
    const secondCommit = commit(fixture.root, "backend change");
    const second = deriveDeterministicProvenance(fixture.root, secondCommit);
    const firstByModule = new Map(first.payload.artifactDigestByModule.map((entry) => (
      [entry.moduleId, entry.artifactDigest]
    )));
    const secondByModule = new Map(second.payload.artifactDigestByModule.map((entry) => (
      [entry.moduleId, entry.artifactDigest]
    )));
    assert.notEqual(first.payload.sourceSet.manifestSha256, second.payload.sourceSet.manifestSha256);
    assert.notEqual(first.payload.sourceArchive.sha256, second.payload.sourceArchive.sha256);
    assert.notEqual(firstByModule.get("BACKEND"), secondByModule.get("BACKEND"));
    assert.equal(firstByModule.get("ADMIN"), secondByModule.get("ADMIN"));
    assert.equal(firstByModule.get("MINIPROGRAM"), secondByModule.get("MINIPROGRAM"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("archive and payload tampering fail local verification", () => {
  const fixture = fixtureRepository();
  const archiveOutput = outputDirectory("archive-tamper");
  const payloadOutput = outputDirectory("payload-tamper");
  try {
    buildCandidateProvenance({
      repositoryRoot: fixture.root,
      sourceCommit: fixture.sourceCommit,
      outputDirectory: archiveOutput,
      builder: builder(),
    });
    fs.appendFileSync(path.join(archiveOutput, "candidate-source.tar"), "tamper");
    expectCode(
      () => verifyCandidateProvenance({
        repositoryRoot: fixture.root,
        sourceCommit: fixture.sourceCommit,
        outputDirectory: archiveOutput,
      }),
      "CANDIDATE_PROVENANCE_ARCHIVE_MISMATCH"
    );

    buildCandidateProvenance({
      repositoryRoot: fixture.root,
      sourceCommit: fixture.sourceCommit,
      outputDirectory: payloadOutput,
      builder: builder(),
    });
    const payloadPath = path.join(payloadOutput, "candidate-provenance.payload.json");
    const payload = readJson(payloadPath);
    payload.artifactDigestByModule[0].artifactDigest = "0".repeat(64);
    fs.writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
    expectCode(
      () => verifyCandidateProvenance({
        repositoryRoot: fixture.root,
        sourceCommit: fixture.sourceCommit,
        outputDirectory: payloadOutput,
      }),
      "CANDIDATE_PROVENANCE_PAYLOAD_MISMATCH"
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(archiveOutput, { recursive: true, force: true });
    fs.rmSync(payloadOutput, { recursive: true, force: true });
  }
});

test("missing modules, symlinks and secret-shaped tracked files fail closed", () => {
  const missing = fixtureRepository({ omitModule: "MINIPROGRAM" });
  const symlink = fixtureRepository({ symlink: true });
  const forbidden = fixtureRepository({ forbiddenFile: true });
  try {
    expectCode(
      () => deriveDeterministicProvenance(missing.root, missing.sourceCommit),
      "CANDIDATE_PROVENANCE_REQUIRED_MODULE_EMPTY"
    );
    expectCode(
      () => deriveDeterministicProvenance(symlink.root, symlink.sourceCommit),
      "CANDIDATE_PROVENANCE_UNSUPPORTED_TREE_ENTRY"
    );
    expectCode(
      () => deriveDeterministicProvenance(forbidden.root, forbidden.sourceCommit),
      "CANDIDATE_PROVENANCE_TREE_INVALID"
    );
  } finally {
    fs.rmSync(missing.root, { recursive: true, force: true });
    fs.rmSync(symlink.root, { recursive: true, force: true });
    fs.rmSync(forbidden.root, { recursive: true, force: true });
  }
});

test("contract drift cannot enable attestation or weaken immutable action requirements", () => {
  const authorization = fixtureRepository({
    mutateContract(contract) {
      contract.authorization.attestationAuthorized = true;
    },
  });
  const actionPolicy = fixtureRepository({
    mutateContract(contract) {
      contract.actionPolicy.immutableShaRequiredForClosure = false;
    },
  });
  try {
    expectCode(
      () => deriveDeterministicProvenance(authorization.root, authorization.sourceCommit),
      "CANDIDATE_PROVENANCE_CONTRACT_INVALID"
    );
    expectCode(
      () => deriveDeterministicProvenance(actionPolicy.root, actionPolicy.sourceCommit),
      "CANDIDATE_PROVENANCE_CONTRACT_INVALID"
    );
  } finally {
    fs.rmSync(authorization.root, { recursive: true, force: true });
    fs.rmSync(actionPolicy.root, { recursive: true, force: true });
  }
});

test("CLI requires an exact source commit and a controlled output directory", () => {
  expectCode(
    () => parseArgs(["--output-dir", "/tmp/myroot-candidate-provenance-cli"], {}),
    "CANDIDATE_PROVENANCE_ARGUMENT_INVALID"
  );
  const fixture = fixtureRepository();
  try {
    expectCode(
      () => buildCandidateProvenance({
        repositoryRoot: fixture.root,
        sourceCommit: fixture.sourceCommit,
        outputDirectory: path.join(fixture.root, "myroot-candidate-provenance-inside"),
        builder: builder(),
      }),
      "CANDIDATE_PROVENANCE_OUTPUT_PATH_INVALID"
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
