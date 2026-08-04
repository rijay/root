"use strict";

const crypto = require("node:crypto");

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const AUTHORIZATION_PATTERN = /^[0-9a-f]{64}$/;

function channelError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function connectionConfig(env = process.env) {
  const address = text(env.MYROOT_MYSQL_MIGRATION_ADDRESS);
  const match = address.match(/^([^:]+):(\d+)$/);
  const user = text(env.MYROOT_MYSQL_MIGRATION_USERNAME);
  const password = typeof env.MYROOT_MYSQL_MIGRATION_PASSWORD === "string"
    ? env.MYROOT_MYSQL_MIGRATION_PASSWORD
    : "";
  const database = text(env.MYROOT_MYSQL_MIGRATION_DATABASE);
  if (!match || !user || !password || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw channelError("MYSQL_MIGRATION_CHANNEL_CONFIG_INVALID");
  }
  return Object.freeze({
    host: match[1],
    port: Number(match[2]),
    user,
    password,
    database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(env.MYROOT_MYSQL_MIGRATION_CONNECT_TIMEOUT_MS || 10000)),
    enableKeepAlive: true,
  });
}

function releaseId(env = process.env) {
  const value = text(env.MYROOT_MYSQL_MIGRATION_RELEASE_ID);
  if (!RELEASE_ID_PATTERN.test(value)) throw channelError("MYSQL_MIGRATION_CHANNEL_RELEASE_ID_INVALID");
  return value;
}

function assertApplyAuthorization(event = {}, env = process.env) {
  if (env.MYROOT_MYSQL_MIGRATION_CHANNEL_MODE !== "apply") {
    throw channelError("MYSQL_MIGRATION_CHANNEL_APPLY_DISABLED");
  }
  const authorization = text(event.authorization);
  if (!AUTHORIZATION_PATTERN.test(authorization)) {
    throw channelError("MYSQL_MIGRATION_CHANNEL_AUTHORIZATION_INVALID");
  }
  const expected = `APPLY:production:${releaseId(env)}:${authorization}`;
  const actual = String(env.MYROOT_MYSQL_MIGRATION_WRITE_CONFIRM || "");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw channelError("MYSQL_MIGRATION_CHANNEL_WRITE_CONFIRMATION_MISMATCH");
  }
  return authorization;
}

function runtimeDependencies() {
  return {
    mysql: require("mysql2/promise"),
    migrations: require("./src/mysqlMigrations"),
  };
}

async function execute(event = {}, dependencies = runtimeDependencies(), env = process.env) {
  const action = text(event.action) || "plan";
  if (!new Set(["plan", "apply"]).has(action)) {
    throw channelError("MYSQL_MIGRATION_CHANNEL_ACTION_INVALID");
  }
  const targetReleaseId = releaseId(env);
  if (action === "apply") assertApplyAuthorization(event, env);

  const config = connectionConfig(env);
  const pool = dependencies.mysql.createPool(config);
  try {
    const before = await dependencies.migrations.readMysqlMigrationPlan(pool);
    if (action === "plan") {
      return Object.freeze({
        ok: true,
        mode: "plan",
        target: "production",
        releaseId: targetReleaseId,
        ready: before.ready,
        appliedCount: before.appliedCount,
        expectedCount: before.expectedCount,
        latestVersion: before.latestVersion,
        expectedLatestVersion: before.expectedLatestVersion,
        pendingCount: before.pending.length,
        nextVersion: before.pending[0] || "",
      });
    }

    const applied = await dependencies.migrations.applyMysqlMigrations(pool, {
      database: config.database,
    });
    const verified = await dependencies.migrations.verifyMysqlMigrations(pool);
    return Object.freeze({
      ok: true,
      mode: "apply",
      target: "production",
      releaseId: targetReleaseId,
      beforeLatestVersion: before.latestVersion,
      applied: Object.freeze([...applied.applied]),
      reconciled: Object.freeze(applied.reconciled.map((item) => item.version)),
      migrationCount: verified.versions.length,
      latestVersion: verified.latestVersion,
    });
  } finally {
    await pool.end();
  }
}

async function main(event = {}, _context = {}) {
  return execute(event, runtimeDependencies(), process.env);
}

exports.main = main;
exports.execute = execute;
exports.assertApplyAuthorization = assertApplyAuthorization;
exports.connectionConfig = connectionConfig;
exports.releaseId = releaseId;
