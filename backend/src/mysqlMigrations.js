const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

function migrationLockName(database = "") {
  const databaseHash = crypto.createHash("sha256").update(String(database || "default")).digest("hex").slice(0, 24);
  return `myroot-migrations-${databaseHash}`;
}

async function acquireMigrationLock(connection, options = {}) {
  const lockName = options.migrationLockName || migrationLockName(options.database);
  const timeoutSeconds = Math.max(1, Number(options.migrationLockTimeoutSeconds || DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS));
  const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS acquired", [lockName, timeoutSeconds]);
  if (Number(rows[0] && rows[0].acquired) !== 1) {
    throw new Error(`Timed out waiting for MySQL migration lock: ${lockName}`);
  }
  return lockName;
}

async function releaseMigrationLock(connection, lockName) {
  if (!lockName) return;
  await connection.execute("SELECT RELEASE_LOCK(?) AS released", [lockName]);
}

function splitSqlStatements(sql) {
  return String(sql || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
}

function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(96) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

async function currentMigrationRows(connection) {
  const [rows] = await connection.query("SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version");
  return rows;
}

async function ensureSnapshotRevisionColumn(connection) {
  const [rows] = await connection.execute(
    `
      SELECT COUNT(*) AS column_count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'root_store_snapshot'
        AND column_name = 'revision'
    `
  );
  if (Number(rows[0] && rows[0].column_count) > 0) return false;
  await connection.query("ALTER TABLE root_store_snapshot ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER schema_version");
  return true;
}

async function applyMysqlMigrations(pool, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const connection = await pool.getConnection();
  const applied = [];
  let lockName = "";
  try {
    lockName = await acquireMigrationLock(connection, options);
    await ensureMigrationTable(connection);
    const existing = new Map((await currentMigrationRows(connection)).map((row) => [row.version, row.checksum]));
    for (const fileName of listMigrationFiles(migrationsDir)) {
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
      const checksum = migrationChecksum(sql);
      if (existing.has(fileName)) {
        if (existing.get(fileName) !== checksum) {
          throw new Error(`MySQL migration checksum changed after apply: ${fileName}`);
        }
        continue;
      }
      for (const statement of splitSqlStatements(sql)) {
        await connection.query(statement);
      }
      await connection.execute(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))",
        [fileName, checksum]
      );
      applied.push(fileName);
    }
    await ensureSnapshotRevisionColumn(connection);
    const rows = await currentMigrationRows(connection);
    return {
      applied,
      versions: rows.map((row) => row.version),
      latestVersion: rows.length ? rows[rows.length - 1].version : "",
    };
  } finally {
    await releaseMigrationLock(connection, lockName).catch(() => {});
    connection.release();
  }
}

async function getMysqlMigrationState(pool) {
  const connection = await pool.getConnection();
  try {
    await ensureMigrationTable(connection);
    const rows = await currentMigrationRows(connection);
    return {
      count: rows.length,
      versions: rows.map((row) => row.version),
      latestVersion: rows.length ? rows[rows.length - 1].version : "",
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  acquireMigrationLock,
  applyMysqlMigrations,
  getMysqlMigrationState,
  listMigrationFiles,
  migrationLockName,
  migrationChecksum,
  releaseMigrationLock,
  splitSqlStatements,
};
