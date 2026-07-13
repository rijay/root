const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  assertSafeOutputDir,
  prepareCandidateSource,
  validateEntryNames,
} = require("./prepare-cloudrun-candidate-source");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("candidate source path validation rejects traversal and forbidden files", () => {
  assert.throws(() => validateEntryNames(["../secret.txt"]), /unsafe ZIP entry/);
  assert.throws(() => validateEntryNames(["node_modules/pkg/index.js"]), /forbidden candidate path/);
  assert.throws(() => validateEntryNames(["config/.env.production"]), /forbidden candidate file/);
  assert.throws(() => assertSafeOutputDir(path.join(os.tmpdir(), "unrelated-output")), /direct \/tmp child/);
});

test("candidate source preparation verifies archive identity and extracted file set", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-candidate-fixture-"));
  const sourceDir = path.join(fixtureRoot, "source");
  const zipPath = path.join(fixtureRoot, "candidate.zip");
  const outputDir = path.join(os.tmpdir(), `myroot-cloudrun-candidate-test-${process.pid}`);
  const manifestPath = `${outputDir}.manifest.json`;
  fs.mkdirSync(path.join(sourceDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "Dockerfile"), "FROM node:22-alpine\n");
  fs.writeFileSync(path.join(sourceDir, "package.json"), `${JSON.stringify({ name: "fixture", version: "9.8.7" })}\n`);
  fs.writeFileSync(path.join(sourceDir, "src", "server.js"), "module.exports = true;\n");

  const zipped = spawnSync("zip", ["-X", "-q", "-r", zipPath, "."], { cwd: sourceDir, encoding: "utf8" });
  assert.equal(zipped.status, 0, zipped.stderr);

  try {
    const report = prepareCandidateSource({
      zipPath,
      outputDir,
      manifestPath,
      expectedVersion: "9.8.7",
      expectedSha256: sha256File(zipPath),
    });
    assert.equal(report.releaseVersion, "9.8.7");
    assert.equal(report.archive.entryCount >= 3, true);
    assert.equal(report.source.fileCount, 3);
    assert.equal(report.safeguards.extractedFileSetMatched, true);
    assert.equal(fs.existsSync(path.join(outputDir, "src", "server.js")), true);
    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(path.join(outputDir, path.basename(manifestPath))), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(manifestPath, { force: true });
  }
});

test("candidate source preparation fails closed on archive hash mismatch", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-candidate-hash-fixture-"));
  const sourceDir = path.join(fixtureRoot, "source");
  const zipPath = path.join(fixtureRoot, "candidate.zip");
  const outputDir = path.join(os.tmpdir(), `myroot-cloudrun-candidate-hash-test-${process.pid}`);
  fs.mkdirSync(path.join(sourceDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(sourceDir, "package.json"), `${JSON.stringify({ version: "1.0.0" })}\n`);
  fs.writeFileSync(path.join(sourceDir, "src", "server.js"), "\n");
  const zipped = spawnSync("zip", ["-X", "-q", "-r", zipPath, "."], { cwd: sourceDir, encoding: "utf8" });
  assert.equal(zipped.status, 0, zipped.stderr);

  try {
    assert.throws(() => prepareCandidateSource({
      zipPath,
      outputDir,
      expectedSha256: "0".repeat(64),
    }), /SHA-256 mismatch/);
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("candidate source CLI requires all production identity guards", () => {
  const { parseArgs } = require("./prepare-cloudrun-candidate-source");
  assert.throws(() => parseArgs(["--zip", "/tmp/candidate.zip", "--output-dir", "/tmp/myroot-cloudrun-candidate-test"]), /expected-version/);
  assert.throws(() => parseArgs([
    "--zip", "/tmp/candidate.zip",
    "--output-dir", "/tmp/myroot-cloudrun-candidate-test",
    "--expected-version", "1.0.0",
    "--expected-sha256", "0".repeat(64),
  ]), /expected-entry-count/);
});
