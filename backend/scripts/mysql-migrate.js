const mysql = require("mysql2/promise");

const { applyMysqlMigrations } = require("../src/mysqlMigrations");
const { mysqlConfigFromEnv, validateMysqlConfig } = require("../src/store");

async function main() {
  const config = validateMysqlConfig(mysqlConfigFromEnv(process.env));
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(config.connectionLimit || 2)),
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(config.connectTimeout || 10000)),
    enableKeepAlive: true,
  });
  try {
    const result = await applyMysqlMigrations(pool, { database: config.database });
    console.log(JSON.stringify({
      ok: true,
      database: config.database,
      applied: result.applied,
      migrationCount: result.versions.length,
      latestVersion: result.latestVersion,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
