const mysql = require("mysql2/promise");

const {
  applyMysqlMigrations,
  readMysqlMigrationPlan,
  verifyMysqlMigrations,
} = require("../src/mysqlMigrations");
const { validateMysqlConfig } = require("../src/store");

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--plan" || item === "--apply") {
      if (values.mode) throw fail("MYSQL_MIGRATION_COMMAND_INVALID", "Choose exactly one of --plan or --apply");
      values.mode = item.slice(2);
      continue;
    }
    if (["--target", "--release-id", "--authorization"].includes(item)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw fail("MYSQL_MIGRATION_COMMAND_INVALID", `${item} requires a value`);
      values[item.slice(2)] = value;
      index += 1;
      continue;
    }
    throw fail("MYSQL_MIGRATION_COMMAND_INVALID", `Unknown argument: ${item}`);
  }
  if (!values.mode || !["candidate", "production"].includes(values.target)) {
    throw fail("MYSQL_MIGRATION_COMMAND_INVALID", "Use --plan|--apply --target candidate|production");
  }
  if (!values["release-id"] || !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(values["release-id"])) {
    throw fail("MYSQL_MIGRATION_RELEASE_ID_INVALID");
  }
  if (values.mode === "apply" && !/^[0-9a-f]{64}$/.test(values.authorization || "")) {
    throw fail("MYSQL_MIGRATION_AUTHORIZATION_INVALID");
  }
  return Object.freeze(values);
}

function migrationConfigFromEnv(env = process.env) {
  const address = String(env.MYROOT_MYSQL_MIGRATION_ADDRESS || "");
  const matched = address.match(/^([^:]+):(\d+)$/);
  return validateMysqlConfig({
    host: matched ? matched[1] : "",
    port: matched ? Number(matched[2]) : 0,
    user: env.MYROOT_MYSQL_MIGRATION_USERNAME || "",
    password: env.MYROOT_MYSQL_MIGRATION_PASSWORD || "",
    database: env.MYROOT_MYSQL_MIGRATION_DATABASE || "",
    connectionLimit: 1,
    connectTimeout: Math.max(1000, Number(env.MYROOT_MYSQL_MIGRATION_CONNECT_TIMEOUT_MS || 10000)),
  });
}

function assertWriteConfirmation(args, env = process.env) {
  if (args.mode !== "apply") return;
  const expected = `APPLY:${args.target}:${args["release-id"]}:${args.authorization}`;
  if (env.MYROOT_MYSQL_MIGRATION_WRITE_CONFIRM !== expected) {
    throw fail("MYSQL_MIGRATION_WRITE_CONFIRMATION_MISMATCH");
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  assertWriteConfirmation(args, env);
  const config = migrationConfigFromEnv(env);
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    connectTimeout: config.connectTimeout,
    enableKeepAlive: true,
  });
  try {
    const before = await readMysqlMigrationPlan(pool);
    if (args.mode === "plan") {
      const result = {
        ok: true,
        mode: "plan",
        target: args.target,
        releaseId: args["release-id"],
        ready: before.ready,
        appliedCount: before.appliedCount,
        expectedCount: before.expectedCount,
        latestVersion: before.latestVersion,
        expectedLatestVersion: before.expectedLatestVersion,
        pendingCount: before.pending.length,
        nextVersion: before.pending[0] || "",
      };
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const applied = await applyMysqlMigrations(pool, { database: config.database });
    const verified = await verifyMysqlMigrations(pool);
    const result = {
      ok: true,
      mode: "apply",
      target: args.target,
      releaseId: args["release-id"],
      authorization: args.authorization,
      beforeLatestVersion: before.latestVersion,
      applied: applied.applied,
      reconciled: applied.reconciled.map((item) => item.version),
      migrationCount: verified.versions.length,
      latestVersion: verified.latestVersion,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, code: error.code || "MYSQL_MIGRATION_FAILED", message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = {
  assertWriteConfirmation,
  main,
  migrationConfigFromEnv,
  parseArgs,
};
