#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(BACKEND_ROOT, "migration-channel");
const MIGRATIONS_ROOT = path.join(BACKEND_ROOT, "db", "migrations");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertEmptyOutputDirectory(outputDirectory) {
  const absolute = path.resolve(outputDirectory || "");
  if (!absolute || absolute === path.parse(absolute).root || absolute === BACKEND_ROOT) {
    throw fail("MYSQL_MIGRATION_CHANNEL_OUTPUT_INVALID");
  }
  if (fs.existsSync(absolute) && fs.readdirSync(absolute).length) {
    throw fail("MYSQL_MIGRATION_CHANNEL_OUTPUT_NOT_EMPTY");
  }
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination);
}

function build(outputDirectory) {
  const output = assertEmptyOutputDirectory(outputDirectory);
  copy(path.join(SOURCE_ROOT, "index.js"), path.join(output, "index.js"));
  copy(path.join(SOURCE_ROOT, "package.json"), path.join(output, "package.json"));
  copy(path.join(SOURCE_ROOT, "package-lock.json"), path.join(output, "package-lock.json"));
  copy(path.join(BACKEND_ROOT, "src", "mysqlMigrations.js"), path.join(output, "src", "mysqlMigrations.js"));
  copy(
    path.join(BACKEND_ROOT, "src", "mysqlMigrationStructureGuard.js"),
    path.join(output, "src", "mysqlMigrationStructureGuard.js")
  );
  for (const fileName of fs.readdirSync(MIGRATIONS_ROOT).sort()) {
    if (!/^\d+_[a-z0-9_]+\.sql$/i.test(fileName)) continue;
    copy(path.join(MIGRATIONS_ROOT, fileName), path.join(output, "db", "migrations", fileName));
  }
  const migrationCount = fs.readdirSync(path.join(output, "db", "migrations")).length;
  if (migrationCount !== 74) throw fail("MYSQL_MIGRATION_CHANNEL_MIGRATION_SET_INVALID");
  return Object.freeze({ output, migrationCount });
}

if (require.main === module) {
  const result = build(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { build };
