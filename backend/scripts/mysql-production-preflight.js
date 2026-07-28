#!/usr/bin/env node

const mysql = require("mysql2/promise");
const { mysqlConfigFromEnv } = require("../src/store");
const {
  collectMysqlProductionPreflight,
} = require("../src/mysqlProductionPreflight");

function assertReadOnlyInvocation(argv, env) {
  if (argv.length !== 1 || argv[0] !== "--read-only") {
    throw new Error("Usage: mysql-production-preflight.js --read-only");
  }
  if (env.MYROOT_MYSQL_PREFLIGHT_READ_ONLY_CONFIRM !== "true") {
    throw new Error("MYROOT_MYSQL_PREFLIGHT_READ_ONLY_CONFIRM=true is required");
  }
}

async function main(env = process.env, argv = process.argv.slice(2)) {
  assertReadOnlyInvocation(argv, env);
  const connection = await mysql.createConnection(mysqlConfigFromEnv(env));
  try {
    const report = await collectMysqlProductionPreflight({ connection, env });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "PASS") process.exitCode = 2;
    return report;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`mysql preflight failed: ${error.code || "ERROR"}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertReadOnlyInvocation, main };
