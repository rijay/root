const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  MYSQL_MIGRATION_STRUCTURE_STATES,
  inspectMysqlMigrationStructure,
  mysqlMigrationStructureSuccessor,
  migrationStructureDriftError,
} = require("./mysqlMigrationStructureGuard");

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
  const [rows] = await connection.execute("SELECT RELEASE_LOCK(?) AS released", [lockName]);
  if (!Array.isArray(rows) || Number(rows[0] && rows[0].released) !== 1) {
    const error = new Error(`Failed to release MySQL migration lock: ${lockName}`);
    error.code = "MYSQL_MIGRATION_LOCK_RELEASE_FAILED";
    throw error;
  }
}

function splitSqlStatements(sql) {
  const source = String(sql || "").replace(/\r\n?/g, "\n");
  const statements = [];
  let delimiter = ";";
  let statement = "";
  let quote = "";
  let blockComment = false;
  let lineComment = false;
  let lineStart = true;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function appendSeparator() {
    if (statement && !/\s$/.test(statement)) statement += " ";
  }

  for (let index = 0; index < source.length;) {
    if (lineStart && !quote && !blockComment && !lineComment
      && statement.trim() === "") {
      const lineEnd = source.indexOf("\n", index);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(index, end);
      const directive = line.match(/^\s*DELIMITER(?:\s+(\S+))?\s*$/i);
      if (directive) {
        if (!directive[1] || /\s/.test(directive[1])) {
          fail("MYSQL_MIGRATION_SQL_DELIMITER_INVALID");
        }
        delimiter = directive[1];
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        lineStart = true;
        continue;
      }
    }

    const character = source[index];
    const next = source[index + 1] || "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        lineStart = true;
        appendSeparator();
      }
      index += 1;
      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        appendSeparator();
        index += 2;
        continue;
      }
      if (character === "\n") lineStart = true;
      index += 1;
      continue;
    }

    if (quote) {
      statement += character;
      lineStart = character === "\n";
      if (character === "\\" && quote !== "`" && index + 1 < source.length) {
        statement += source[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) {
        if (next === quote) {
          statement += next;
          index += 2;
          continue;
        }
        quote = "";
      }
      index += 1;
      continue;
    }

    if (source.startsWith(delimiter, index)) {
      const completed = statement.trim();
      if (completed) statements.push(completed);
      statement = "";
      index += delimiter.length;
      lineStart = false;
      continue;
    }

    if (character === "-" && next === "-"
      && (index + 2 >= source.length || /\s/.test(source[index + 2]))) {
      lineComment = true;
      index += 2;
      continue;
    }
    if (character === "#") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 2;
      continue;
    }
    if (["'", "\"", "`"].includes(character)) quote = character;
    statement += character;
    lineStart = character === "\n";
    index += 1;
  }

  if (quote) fail("MYSQL_MIGRATION_SQL_QUOTE_UNTERMINATED");
  if (blockComment) fail("MYSQL_MIGRATION_SQL_COMMENT_UNTERMINATED");
  const trailing = statement.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
}

function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function expectedMysqlMigrationRows(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return listMigrationFiles(migrationsDir).map((version) => {
    const sql = fs.readFileSync(path.join(migrationsDir, version), "utf8");
    return Object.freeze({ version, checksum: migrationChecksum(sql) });
  });
}

function migrationLedgerError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

async function readMysqlMigrationPlan(pool, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const expected = expectedMysqlMigrationRows(migrationsDir);
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.execute(`
      SELECT COUNT(*) AS table_count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'schema_migrations'
    `);
    const ledgerExists = Number(tables[0] && tables[0].table_count) === 1;
    const actual = ledgerExists ? await currentMigrationRows(connection) : [];
    if (actual.length > expected.length) {
      throw migrationLedgerError("MYSQL_MIGRATION_LEDGER_UNKNOWN_VERSION", {
        actualCount: actual.length,
        expectedCount: expected.length,
      });
    }
    for (let index = 0; index < actual.length; index += 1) {
      const actualRow = actual[index];
      const expectedRow = expected[index];
      if (!expectedRow || actualRow.version !== expectedRow.version) {
        throw migrationLedgerError("MYSQL_MIGRATION_LEDGER_ORDER_DRIFT", {
          index,
          actualVersion: actualRow.version,
          expectedVersion: expectedRow ? expectedRow.version : "",
        });
      }
      if (actualRow.checksum !== expectedRow.checksum) {
        throw migrationLedgerError("MYSQL_MIGRATION_LEDGER_CHECKSUM_DRIFT", {
          version: actualRow.version,
        });
      }
    }
    const pending = expected.slice(actual.length).map((row) => row.version);
    return Object.freeze({
      ready: ledgerExists && pending.length === 0,
      ledgerExists,
      appliedCount: actual.length,
      expectedCount: expected.length,
      versions: Object.freeze(actual.map((row) => row.version)),
      latestVersion: actual.length ? actual[actual.length - 1].version : "",
      expectedLatestVersion: expected.length ? expected[expected.length - 1].version : "",
      pending: Object.freeze(pending),
    });
  } finally {
    connection.release();
  }
}

async function verifyMysqlMigrations(pool, options = {}) {
  const plan = await readMysqlMigrationPlan(pool, options);
  if (!plan.ready) {
    throw migrationLedgerError("MYSQL_MIGRATION_REQUIRED", {
      ledgerExists: plan.ledgerExists,
      appliedCount: plan.appliedCount,
      expectedCount: plan.expectedCount,
      latestVersion: plan.latestVersion,
      expectedLatestVersion: plan.expectedLatestVersion,
      pendingCount: plan.pending.length,
      nextVersion: plan.pending[0] || "",
    });
  }
  return {
    applied: [],
    reconciled: [],
    versions: [...plan.versions],
    latestVersion: plan.latestVersion,
    verifiedOnly: true,
  };
}

function acknowledgementUnknown(error) {
  return Boolean(error && (error.fatal === true || [
    "PROTOCOL_CONNECTION_LOST",
    "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
  ].includes(String(error.code || ""))));
}

function retireConnection(connection) {
  if (!connection || typeof connection.destroy !== "function") return;
  try { connection.destroy(); } catch {}
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
  const reconciled = [];
  let lockName = "";
  let retire = false;
  try {
    lockName = await acquireMigrationLock(connection, options);
    await ensureMigrationTable(connection);
    const existing = new Map((await currentMigrationRows(connection)).map((row) => [row.version, row.checksum]));
    for (const fileName of listMigrationFiles(migrationsDir)) {
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
      const checksum = migrationChecksum(sql);
      const preflight = await inspectMysqlMigrationStructure(connection, fileName);
      if (existing.has(fileName)) {
        if (existing.get(fileName) !== checksum) {
          throw new Error(`MySQL migration checksum changed after apply: ${fileName}`);
        }
        const successor = mysqlMigrationStructureSuccessor(fileName);
        if (successor) {
          const successorInspection = await inspectMysqlMigrationStructure(connection, successor);
          if (existing.has(successor)
            || (successorInspection.supported
              && successorInspection.state === MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE)) {
            continue;
          }
        }
        if (preflight.supported && preflight.state !== MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE) {
          throw migrationStructureDriftError({
            ...preflight,
            differences: preflight.differences.length
              ? preflight.differences
              : Object.freeze(["ledger.structure.absent"]),
          });
        }
        continue;
      }
      if (preflight.supported && preflight.state === MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED) {
        throw migrationStructureDriftError(preflight);
      }
      if (preflight.supported && preflight.state === MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE) {
        await connection.execute(
          "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))",
          [fileName, checksum]
        );
        reconciled.push(Object.freeze({
          version: fileName,
          checksum,
          structureDigest: preflight.structureDigest,
          reason: "STRUCTURE_COMPLETE_LEDGER_MISSING",
        }));
        continue;
      }
      for (const statement of splitSqlStatements(sql)) {
        await connection.query(statement);
      }
      if (preflight.supported) {
        const postcondition = await inspectMysqlMigrationStructure(connection, fileName);
        if (postcondition.state !== MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE) {
          throw migrationStructureDriftError({
            ...postcondition,
            differences: postcondition.differences.length
              ? postcondition.differences
              : Object.freeze(["postcondition.absent"]),
          });
        }
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
      reconciled,
      versions: rows.map((row) => row.version),
      latestVersion: rows.length ? rows[rows.length - 1].version : "",
    };
  } catch (error) {
    retire = acknowledgementUnknown(error);
    throw error;
  } finally {
    if (!retire) {
      try {
        await releaseMigrationLock(connection, lockName);
      } catch {
        // A failed RELEASE_LOCK has no authoritative acknowledgement. Returning
        // this session to the pool could retain the advisory lock indefinitely.
        retire = true;
      }
    }
    if (retire) retireConnection(connection);
    else connection.release();
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
  expectedMysqlMigrationRows,
  getMysqlMigrationState,
  listMigrationFiles,
  migrationLockName,
  migrationChecksum,
  readMysqlMigrationPlan,
  releaseMigrationLock,
  splitSqlStatements,
  verifyMysqlMigrations,
};
