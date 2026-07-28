const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DISPOSABLE_SERVER_MARKER_SCHEMA,
  SNAPSHOT_FORMAT,
  captureMysqlSchemaSnapshot,
  generateIsolatedMysqlSchemaSnapshot,
  inspectCommittedSnapshotProvenance,
  migrationSetDescriptor,
  normalizeShowCreate,
  renderMysqlSchemaSnapshot,
  verifyCommittedSnapshot,
} = require("../src/mysqlSchemaSnapshot");
const { configFromEnv, parseArgs, writeSnapshotAtomically } = require("../scripts/mysql-schema-snapshot");

const temporaryMigrationDirectories = new Set();

test.after(() => {
  for (const directory of temporaryMigrationDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryMigrationDirectories.clear();
});

function tempMigrationSet() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-schema-snapshot-test-"));
  temporaryMigrationDirectories.add(directory);
  const sql = "CREATE TABLE IF NOT EXISTS sample (id VARCHAR(32) PRIMARY KEY);\n";
  const checksum = require("node:crypto").createHash("sha256").update(sql).digest("hex");
  fs.writeFileSync(path.join(directory, "001_sample.sql"), sql);
  fs.writeFileSync(path.join(directory, "checksums.json"), `${JSON.stringify({
    algorithm: "sha256",
    files: { "001_sample.sql": checksum },
  }, null, 2)}\n`);
  return { directory, checksum };
}

test("migration descriptor binds the exact ordered file set and checksums", () => {
  const { directory, checksum } = tempMigrationSet();
  const descriptor = migrationSetDescriptor({ migrationsDir: directory });
  assert.equal(descriptor.format, SNAPSHOT_FORMAT);
  assert.deepEqual(descriptor.migrations, [{ file: "001_sample.sql", checksum }]);
  fs.appendFileSync(path.join(directory, "001_sample.sql"), "-- drift\n");
  assert.throws(
    () => migrationSetDescriptor({ migrationsDir: directory }),
    { code: "MYSQL_SCHEMA_SNAPSHOT_MIGRATION_CHECKSUM_DRIFT" }
  );
});

test("renderer is deterministic, sorted, and preserves schema options", () => {
  const { directory } = tempMigrationSet();
  const descriptor = migrationSetDescriptor({ migrationsDir: directory });
  const snapshot = renderMysqlSchemaSnapshot({
    descriptor,
    mysqlEngineFamily: "8.0",
    tables: [
      { tableName: "zeta", createSql: "CREATE TABLE `zeta` (`id` int NOT NULL) ENGINE=InnoDB AUTO_INCREMENT=42" },
      { tableName: "alpha", createSql: "CREATE TABLE `alpha` (`id` int NOT NULL) ENGINE=InnoDB" },
    ],
  });
  assert.ok(snapshot.startsWith("-- GENERATED FILE. DO NOT EDIT.\n"));
  assert.ok(snapshot.indexOf("-- table: alpha") < snapshot.indexOf("-- table: zeta"));
  assert.match(snapshot, /AUTO_INCREMENT=42/);
  assert.equal(normalizeShowCreate("CREATE TABLE `x` (`id` int) ENGINE=InnoDB AUTO_INCREMENT=9"),
    "CREATE TABLE `x` (`id` int) ENGINE=InnoDB AUTO_INCREMENT=9");
});

test("committed snapshot verification and offline provenance fail closed on drift", () => {
  const { directory } = tempMigrationSet();
  const descriptor = migrationSetDescriptor({ migrationsDir: directory });
  const snapshot = renderMysqlSchemaSnapshot({
    descriptor,
    mysqlEngineFamily: "8.0",
    tables: [{ tableName: "sample", createSql: "CREATE TABLE `sample` (`id` varchar(32) NOT NULL) ENGINE=InnoDB" }],
  });
  const snapshotPath = path.join(directory, "schema.sql");
  fs.writeFileSync(snapshotPath, snapshot);
  assert.equal(verifyCommittedSnapshot(snapshot, { snapshotPath }).matches, true);
  assert.equal(inspectCommittedSnapshotProvenance({ migrationsDir: directory, snapshotPath }).matches, true);
  fs.appendFileSync(snapshotPath, "-- drift\n");
  assert.equal(verifyCommittedSnapshot(snapshot, { snapshotPath }).matches, false);
  assert.equal(inspectCommittedSnapshotProvenance({ migrationsDir: directory, snapshotPath }).matches, false);

  fs.writeFileSync(snapshotPath, snapshot.replace("-- mysql_engine_family: 8.0", "-- mysql_engine_family: 5.7"));
  assert.equal(inspectCommittedSnapshotProvenance({ migrationsDir: directory, snapshotPath }).matches, false);

  fs.writeFileSync(snapshotPath, snapshot.replace("SET NAMES utf8mb4;", "-- injected header\nSET NAMES utf8mb4;"));
  assert.equal(inspectCommittedSnapshotProvenance({ migrationsDir: directory, snapshotPath }).matches, false);
});

test("CLI accepts only explicit modes and dedicated snapshot environment", () => {
  assert.deepEqual(parseArgs([]), { mode: "verify" });
  assert.deepEqual(parseArgs(["--write"]), { mode: "write" });
  assert.throws(() => parseArgs(["--unknown"]));
  assert.deepEqual(configFromEnv({
    SCHEMA_SNAPSHOT_MYSQL_HOST: "localhost",
    SCHEMA_SNAPSHOT_MYSQL_PORT: "3307",
    SCHEMA_SNAPSHOT_MYSQL_USER: "snapshot",
    SCHEMA_SNAPSHOT_MYSQL_PASSWORD: "local-only",
  }), {
    host: "localhost",
    port: 3307,
    user: "snapshot",
    password: "local-only",
  });
});

test("schema snapshot replacement is atomic and leaves no temporary file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-schema-atomic-"));
  const target = path.join(directory, "schema.sql");
  try {
    fs.writeFileSync(target, "old\n");
    writeSnapshotAtomically(target, "new\n");
    assert.equal(fs.readFileSync(target, "utf8"), "new\n");
    assert.deepEqual(fs.readdirSync(directory), ["schema.sql"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("capture binds the connection default database and schema-qualifies every SHOW CREATE", async () => {
  const { directory, checksum } = tempMigrationSet();
  const queries = [];
  let releases = 0;
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (sql === "SELECT DATABASE() AS current_database") {
        return [[{ current_database: "snapshot_evidence" }], []];
      }
      if (sql === "SELECT VERSION() AS server_version") {
        return [[{ server_version: "8.0.43" }], []];
      }
      if (sql === "SELECT version, checksum FROM schema_migrations ORDER BY version") {
        return [[{ version: "001_sample.sql", checksum }], []];
      }
      if (sql === "SHOW CREATE TABLE `snapshot_evidence`.`sample`") {
        return [[{
          Table: "sample",
          "Create Table": "CREATE TABLE `sample` (`id` varchar(32) NOT NULL) ENGINE=InnoDB",
        }], []];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async execute(sql, values) {
      assert.match(sql, /FROM information_schema\.tables/);
      assert.deepEqual(values, ["snapshot_evidence"]);
      return [[{ table_name: "sample" }], []];
    },
    release() { releases += 1; },
  };
  const snapshot = await captureMysqlSchemaSnapshot({
    async getConnection() { return connection; },
  }, {
    database: "snapshot_evidence",
    migrationsDir: directory,
  });
  assert.match(snapshot, /-- table_count: 1/);
  assert.equal(
    queries.includes("SHOW CREATE TABLE `snapshot_evidence`.`sample`"),
    true
  );
  assert.equal(releases, 1);
});

test("capture rejects a default-database mismatch before reading version, ledger, or schema", async () => {
  const { directory } = tempMigrationSet();
  const queries = [];
  let releases = 0;
  const connection = {
    async query(sql) {
      queries.push(sql);
      return [[{ current_database: "unexpected_database" }], []];
    },
    async execute() {
      throw new Error("schema read must not be reached");
    },
    release() { releases += 1; },
  };
  await assert.rejects(
    captureMysqlSchemaSnapshot({
      async getConnection() { return connection; },
    }, {
      database: "snapshot_evidence",
      migrationsDir: directory,
    }),
    { code: "MYSQL_SCHEMA_SNAPSHOT_DATABASE_DRIFT" }
  );
  assert.deepEqual(queries, ["SELECT DATABASE() AS current_database"]);
  assert.equal(releases, 1);
});

test("an unacknowledged or colliding CREATE DATABASE never authorizes DROP DATABASE", async () => {
  const { directory } = tempMigrationSet();
  const queries = [];
  const mysql = {
    async createConnection() {
      return {
        async query(sql) {
          queries.push(sql);
          if (/information_schema\.schemata/.test(sql)) {
            return [[{ schema_name: DISPOSABLE_SERVER_MARKER_SCHEMA }], []];
          }
          if (/AS object_count/.test(sql)) return [[{ object_count: 0 }], []];
          throw Object.assign(new Error("create acknowledgement unavailable"), { code: "ECONNRESET" });
        },
        async end() {},
      };
    },
    createPool() {
      throw new Error("pool must not be created");
    },
  };
  await assert.rejects(
    generateIsolatedMysqlSchemaSnapshot({
      mysql,
      host: "127.0.0.1",
      migrationsDir: directory,
    }),
    /create acknowledgement unavailable/
  );
  assert.equal(queries.length, 3);
  assert.match(queries[0], /information_schema\.schemata/);
  assert.match(queries[1], /AS object_count/);
  assert.match(queries[2], /^CREATE DATABASE `myroot_schema_snapshot_/);
  assert.equal(queries.some((sql) => /^DROP DATABASE/.test(sql)), false);
});

test("a non-empty disposable marker is rejected before CREATE", async () => {
  const { directory } = tempMigrationSet();
  const queries = [];
  const mysql = {
    async createConnection() {
      return {
        async query(sql) {
          queries.push(sql);
          if (/information_schema\.schemata/.test(sql)) {
            return [[{ schema_name: DISPOSABLE_SERVER_MARKER_SCHEMA }], []];
          }
          if (/AS object_count/.test(sql)) return [[{ object_count: "1" }], []];
          throw new Error("CREATE must not be reached");
        },
        async end() {},
      };
    },
    createPool() {
      throw new Error("pool must not be created");
    },
  };
  await assert.rejects(
    generateIsolatedMysqlSchemaSnapshot({
      mysql,
      host: "localhost",
      migrationsDir: directory,
    }),
    { code: "MYSQL_SCHEMA_SNAPSHOT_SERVER_NOT_DISPOSABLE" }
  );
  assert.equal(queries.length, 2);
  assert.equal(queries.some((sql) => /^CREATE DATABASE/.test(sql)), false);
  assert.equal(queries.some((sql) => /^DROP DATABASE/.test(sql)), false);
});

test("a localhost production tunnel is rejected before CREATE when the disposable marker is absent or mixed", async () => {
  const { directory } = tempMigrationSet();
  for (const schemas of [[], [DISPOSABLE_SERVER_MARKER_SCHEMA, "business_prod"]]) {
    const queries = [];
    const mysql = {
      async createConnection() {
        return {
          async query(sql) {
            queries.push(sql);
            return [schemas.sort().map((schema_name) => ({ schema_name })), []];
          },
          async end() {},
        };
      },
      createPool() {
        throw new Error("pool must not be created");
      },
    };
    await assert.rejects(
      generateIsolatedMysqlSchemaSnapshot({
        mysql,
        host: "127.0.0.1",
        migrationsDir: directory,
      }),
      { code: "MYSQL_SCHEMA_SNAPSHOT_SERVER_NOT_DISPOSABLE" }
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /information_schema\.schemata/);
    assert.equal(queries.some((sql) => /^CREATE DATABASE/.test(sql)), false);
    assert.equal(queries.some((sql) => /^DROP DATABASE/.test(sql)), false);
  }
});
