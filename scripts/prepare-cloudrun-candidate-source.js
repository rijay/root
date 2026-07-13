#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SAFE_OUTPUT_NAME = /^myroot-cloudrun-candidate-[A-Za-z0-9._-]+$/;
const FORBIDDEN_SEGMENTS = new Set([".git", "node_modules", "logs", "data", "coverage", ".nyc_output"]);

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function isDirectTempChild(targetPath) {
  const parent = path.dirname(path.resolve(targetPath));
  return [path.resolve(os.tmpdir()), path.resolve("/tmp")].includes(parent);
}

function assertSafeOutputDir(outputDir) {
  const resolved = path.resolve(outputDir);
  if (!isDirectTempChild(resolved) || !SAFE_OUTPUT_NAME.test(path.basename(resolved))) {
    throw new Error("output directory must be a direct /tmp child named myroot-cloudrun-candidate-*");
  }
  return resolved;
}

function validateEntryNames(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("candidate ZIP is empty");
  const seen = new Set();
  for (const rawEntry of entries) {
    const entry = String(rawEntry || "");
    const fileEntry = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    if (!fileEntry || entry.includes("\0") || entry.includes("\\") || entry.startsWith("/")) {
      throw new Error(`unsafe ZIP entry: ${entry || "<empty>"}`);
    }
    const segments = fileEntry.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`unsafe ZIP entry: ${entry}`);
    }
    if (path.posix.normalize(fileEntry) !== fileEntry) throw new Error(`unsafe ZIP entry: ${entry}`);
    if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
      throw new Error(`forbidden candidate path: ${entry}`);
    }
    const base = segments.at(-1);
    if (
      base === ".DS_Store" ||
      /^\.env(?:\.|$)/i.test(base) ||
      /\.log$/i.test(base) ||
      /\.sqlite(?:-|$)/i.test(base) ||
      /\.(?:pem|p12|pfx|key)$/i.test(base)
    ) {
      throw new Error(`forbidden candidate file: ${entry}`);
    }
    if (seen.has(entry)) throw new Error(`duplicate ZIP entry: ${entry}`);
    seen.add(entry);
  }
  return entries;
}

function runUnzip(args) {
  const result = spawnSync("unzip", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(text(result.stderr, `unzip exited with ${result.status}`));
  return result.stdout;
}

function zipEntries(zipPath) {
  return runUnzip(["-Z1", zipPath]).split(/\r?\n/).filter(Boolean);
}

function walkFiles(rootDir, currentDir = rootDir, result = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`candidate source contains symlink: ${path.relative(rootDir, absolute)}`);
    if (entry.isDirectory()) walkFiles(rootDir, absolute, result);
    else if (entry.isFile()) result.push(path.relative(rootDir, absolute).split(path.sep).join("/"));
    else throw new Error(`candidate source contains unsupported entry: ${path.relative(rootDir, absolute)}`);
  }
  return result;
}

function sourceManifest(rootDir, files) {
  const rows = files.map((relativePath) => {
    const absolute = path.join(rootDir, ...relativePath.split("/"));
    const stat = fs.statSync(absolute);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolute),
    };
  });
  const canonical = `${rows.map((row) => `${row.sha256}  ${row.bytes}  ${row.path}`).join("\n")}\n`;
  return {
    files: rows,
    fileCount: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    sha256: sha256Buffer(canonical),
  };
}

function prepareCandidateSource(options = {}) {
  const zipPath = path.resolve(text(options.zipPath));
  const outputDir = assertSafeOutputDir(text(options.outputDir));
  const manifestPath = path.resolve(text(options.manifestPath, `${outputDir}.manifest.json`));
  const expectedVersion = text(options.expectedVersion);
  const expectedSha256 = text(options.expectedSha256).toLowerCase();
  const expectedEntryCount = Number(options.expectedEntryCount || 0);

  if (!fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) throw new Error(`candidate ZIP not found: ${zipPath}`);
  if (
    !isDirectTempChild(manifestPath) ||
    !/^myroot-cloudrun-candidate-[A-Za-z0-9._-]+\.manifest\.json$/.test(path.basename(manifestPath))
  ) {
    throw new Error("manifest path must be a controlled temporary candidate manifest");
  }
  const archiveSha256 = sha256File(zipPath);
  if (expectedSha256 && archiveSha256 !== expectedSha256) {
    throw new Error(`candidate ZIP SHA-256 mismatch: ${archiveSha256}`);
  }

  const entries = validateEntryNames(zipEntries(zipPath));
  if (expectedEntryCount && entries.length !== expectedEntryCount) {
    throw new Error(`candidate ZIP entry count is ${entries.length}; expected ${expectedEntryCount}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  runUnzip(["-q", zipPath, "-d", outputDir]);

  const files = walkFiles(outputDir).sort();
  const expectedFiles = entries.filter((entry) => !entry.endsWith("/")).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error("extracted candidate file set does not match ZIP entries");
  }
  for (const required of ["Dockerfile", "package.json", "src/server.js"]) {
    if (!files.includes(required)) throw new Error(`candidate source missing ${required}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf8"));
  if (expectedVersion && packageJson.version !== expectedVersion) {
    throw new Error(`candidate package version is ${packageJson.version || "missing"}; expected ${expectedVersion}`);
  }

  const manifest = sourceManifest(outputDir, files);
  const report = {
    schemaVersion: 1,
    releaseVersion: packageJson.version,
    archive: {
      path: zipPath,
      bytes: fs.statSync(zipPath).size,
      entryCount: entries.length,
      sha256: archiveSha256,
    },
    source: {
      path: outputDir,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      manifestSha256: manifest.sha256,
    },
    safeguards: {
      directTmpChild: true,
      forbiddenPathsRejected: true,
      symlinksRejected: true,
      extractedFileSetMatched: true,
      packageVersionMatched: !expectedVersion || packageJson.version === expectedVersion,
    },
    files: manifest.files,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { ...report, manifestPath };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => argv[++index];
    if (item === "--zip") options.zipPath = next();
    else if (item === "--output-dir") options.outputDir = next();
    else if (item === "--manifest") options.manifestPath = next();
    else if (item === "--expected-version") options.expectedVersion = next();
    else if (item === "--expected-sha256") options.expectedSha256 = next();
    else if (item === "--expected-entry-count") options.expectedEntryCount = Number(next());
    else if (item === "--json") options.json = true;
    else throw new Error(`unknown argument: ${item}`);
  }
  if (!options.zipPath) throw new Error("--zip is required");
  if (!options.outputDir) throw new Error("--output-dir is required");
  if (!options.expectedVersion) throw new Error("--expected-version is required");
  if (!options.expectedSha256) throw new Error("--expected-sha256 is required");
  if (!Number.isInteger(options.expectedEntryCount) || options.expectedEntryCount <= 0) {
    throw new Error("--expected-entry-count must be a positive integer");
  }
  return options;
}

function printHuman(report) {
  process.stdout.write("# CloudRun candidate source prepared\n\n");
  process.stdout.write(`- releaseVersion: ${report.releaseVersion}\n`);
  process.stdout.write(`- archiveSha256: ${report.archive.sha256}\n`);
  process.stdout.write(`- archiveEntries: ${report.archive.entryCount}\n`);
  process.stdout.write(`- sourceFiles: ${report.source.fileCount}\n`);
  process.stdout.write(`- sourceManifestSha256: ${report.source.manifestSha256}\n`);
  process.stdout.write(`- sourcePath: ${report.source.path}\n`);
  process.stdout.write(`- manifestPath: ${report.manifestPath}\n`);
}

if (require.main === module) {
  try {
    const options = parseArgs();
    const report = prepareCandidateSource(options);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHuman(report);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertSafeOutputDir,
  parseArgs,
  prepareCandidateSource,
  sourceManifest,
  validateEntryNames,
  walkFiles,
};
