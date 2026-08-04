#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { buildFormalLaunchSnapshotCleanupPlan } = require("../src/formalLaunchSnapshotCleanup");

function parseArgs(argv = process.argv.slice(2)) {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex === -1 || !argv[inputIndex + 1] || argv.length !== 2) {
    throw new Error("Usage: formal-launch-snapshot-cleanup-dry-run.js --input <snapshot.json>");
  }
  return { input: path.resolve(argv[inputIndex + 1]) };
}

function parseSnapshot(value) {
  const parsed = JSON.parse(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && Object.prototype.hasOwnProperty.call(parsed, "payload_json")) {
    return typeof parsed.payload_json === "string"
      ? JSON.parse(parsed.payload_json)
      : parsed.payload_json;
  }
  return parsed;
}

function main() {
  const { input } = parseArgs();
  const snapshot = parseSnapshot(fs.readFileSync(input, "utf8"));
  const report = buildFormalLaunchSnapshotCleanupPlan(snapshot);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`snapshot cleanup dry-run failed: ${error.code || "ERROR"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, parseSnapshot };
