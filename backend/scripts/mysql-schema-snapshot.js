#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const {
  DEFAULT_SNAPSHOT_PATH,
  generateIsolatedMysqlSchemaSnapshot,
  verifyCommittedSnapshot,
} = require("../src/mysqlSchemaSnapshot");

function parseArgs(argv = process.argv.slice(2)) {
  const mode = argv.includes("--write") ? "write" : "verify";
  if (argv.some((value) => !["--write", "--verify"].includes(value))) {
    throw new Error("Usage: mysql-schema-snapshot.js [--write|--verify]");
  }
  return { mode };
}

function configFromEnv(env = process.env) {
  return {
    host: env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1",
    port: Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306),
    user: env.SCHEMA_SNAPSHOT_MYSQL_USER || "root",
    password: env.SCHEMA_SNAPSHOT_MYSQL_PASSWORD || "",
  };
}

function writeSnapshotAtomically(target, snapshot) {
  const temporary = path.join(path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, snapshot, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function main() {
  const { mode } = parseArgs();
  const snapshot = await generateIsolatedMysqlSchemaSnapshot({
    mysql,
    ...configFromEnv(),
  });
  if (mode === "write") {
    writeSnapshotAtomically(DEFAULT_SNAPSHOT_PATH, snapshot);
    process.stdout.write(`schema snapshot written: ${DEFAULT_SNAPSHOT_PATH}\n`);
    return;
  }
  const verification = verifyCommittedSnapshot(snapshot);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.matches) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`schema snapshot failed: ${error.code || "ERROR"}: ${error.message}\n`);
    if (Array.isArray(error.differences)) {
      process.stderr.write(`structure differences: ${error.differences.join(", ")}\n`);
    }
    process.exitCode = 1;
  });
}

module.exports = { configFromEnv, parseArgs, writeSnapshotAtomically };
