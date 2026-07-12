#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");
const defaultIgnoredDirectories = new Set([
  ".git",
  ".svn",
  "node_modules",
]);
const defaultIgnoredFiles = new Set([".DS_Store"]);

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizedRuleValue(rule) {
  return normalize(rule && rule.value).toLowerCase();
}

function matchesRule(filePath, rule) {
  const candidate = normalize(filePath).toLowerCase();
  const baseName = path.posix.basename(candidate);
  const value = normalizedRuleValue(rule);
  if (!rule || !rule.type || !value) throw new Error("Invalid packOptions rule");
  if (rule.type === "prefix") return baseName.startsWith(value);
  if (rule.type === "suffix") return baseName.endsWith(value);
  if (rule.type === "folder") return `/${candidate}`.startsWith(`/${value.replace(/^\/+|\/+$/g, "")}/`);
  if (rule.type === "file") return `/${candidate}` === `/${value.replace(/^\/+/, "")}`;
  if (rule.type === "regexp") return new RegExp(value, "im").test(candidate) || new RegExp(value, "im").test(`/${candidate}`);
  if (rule.type === "glob" && typeof path.matchesGlob === "function") {
    return path.matchesGlob(candidate, value) || path.matchesGlob(`/${candidate}`, value);
  }
  throw new Error(`Unsupported packOptions rule type: ${rule.type}`);
}

function isIgnoredByPackOptions(filePath, packOptions = {}) {
  const includes = Array.isArray(packOptions.include) ? packOptions.include : [];
  const ignores = Array.isArray(packOptions.ignore) ? packOptions.ignore : [];
  if (includes.some((rule) => matchesRule(filePath, rule))) return false;
  return ignores.some((rule) => matchesRule(filePath, rule));
}

function collectReleaseSourceFiles(root, packOptions) {
  const files = [];

  function walk(directory, relativeDirectory = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in mini-program release sources: ${normalize(path.join(relativeDirectory, entry.name))}`);
      }
      if (entry.isDirectory() && defaultIgnoredDirectories.has(entry.name)) continue;
      if (entry.isFile() && defaultIgnoredFiles.has(entry.name)) continue;
      const relativePath = normalize(path.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile() && !isIgnoredByPackOptions(relativePath, packOptions)) {
        files.push({ absolutePath, relativePath });
      }
    }
  }

  walk(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildMiniprogramReleaseManifest(options = {}) {
  const packagePayload = JSON.parse(fs.readFileSync(path.join(miniprogramRoot, "package.json"), "utf8"));
  const projectConfig = JSON.parse(fs.readFileSync(path.join(miniprogramRoot, "project.config.json"), "utf8"));
  const version = String(options.version || packagePayload.version || "unknown");
  const outputPath = path.resolve(options.outputPath || path.join("/tmp", `myroot-miniprogram-${version}-files.sha256`));
  const files = collectReleaseSourceFiles(miniprogramRoot, projectConfig.packOptions || {});
  const manifest = files.map(({ absolutePath, relativePath }) => {
    return `${sha256(fs.readFileSync(absolutePath))}  miniprogram/${relativePath}`;
  }).join("\n") + "\n";
  fs.writeFileSync(outputPath, manifest, "utf8");
  return {
    version,
    outputPath,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + fs.statSync(file.absolutePath).size, 0),
    manifestBytes: Buffer.byteLength(manifest),
    manifestSha256: sha256(manifest),
    files: files.map((file) => file.relativePath),
    safeguards: {
      ignoreUploadUnusedFiles: projectConfig.setting && projectConfig.setting.ignoreUploadUnusedFiles === true,
      uploadWithSourceMap: projectConfig.setting && projectConfig.setting.uploadWithSourceMap === true,
      explicitIgnoreRuleCount: Array.isArray(projectConfig.packOptions && projectConfig.packOptions.ignore)
        ? projectConfig.packOptions.ignore.length
        : 0,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.outputPath = argv[++index];
    else if (argv[index] === "--version") options.version = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function main() {
  const result = buildMiniprogramReleaseManifest(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Mini-program release manifest failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildMiniprogramReleaseManifest,
  collectReleaseSourceFiles,
  isIgnoredByPackOptions,
  matchesRule,
};
