const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const mysql = require("mysql2/promise");
const {
  AUTHENTICATED_READINESS_SQL,
  LOOPBACK_HOST,
  authenticatedReady,
} = require("../src/mysqlLocalAuthorizedRunner");
const {
  applyMysqlMigrations,
  listMigrationFiles,
} = require("../src/mysqlMigrations");
const { assertDisposableSnapshotServer } = require("../src/mysqlSchemaSnapshot");

const ENABLED = process.env.MYSQL_LOCAL_READINESS_INTEGRATION_ENABLED === "true";

test("pinned MySQL 8.0.43 parses and satisfies the exact authenticated readiness query", {
  skip: !ENABLED,
}, async () => {
  const host = process.env.SCHEMA_SNAPSHOT_MYSQL_HOST;
  const port = Number(process.env.SCHEMA_SNAPSHOT_MYSQL_PORT);
  assert.equal(host, LOOPBACK_HOST);
  assert.equal(Number.isInteger(port) && port > 0 && port <= 65535, true);

  const connection = await mysql.createConnection({
    host,
    port,
    user: process.env.SCHEMA_SNAPSHOT_MYSQL_USER,
    password: process.env.SCHEMA_SNAPSHOT_MYSQL_PASSWORD,
    charset: "utf8mb4",
    timezone: "+08:00",
  });
  try {
    const [rows] = await connection.query(AUTHENTICATED_READINESS_SQL);
    assert.equal(authenticatedReady(rows), true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].readiness_ok, 1);
    assert.equal(rows[0].mysql_version, "8.0.43");
    assert.match(rows[0].authenticated_account, /^root@/);
    assert.match(rows[0].instance_uuid, /^[0-9a-f-]{36}$/i);
  } finally {
    await connection.end();
  }
});

test("068 accepts only empty or confirmed pre-launch data and blocks later drift before pruning", {
  skip: !ENABLED,
}, async () => {
  const serverConfig = {
    host: process.env.SCHEMA_SNAPSHOT_MYSQL_HOST,
    port: Number(process.env.SCHEMA_SNAPSHOT_MYSQL_PORT),
    user: process.env.SCHEMA_SNAPSHOT_MYSQL_USER,
    password: process.env.SCHEMA_SNAPSHOT_MYSQL_PASSWORD,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
  };
  const migrationsDir = path.join(__dirname, "..", "db", "migrations");
  assert.equal(serverConfig.host, LOOPBACK_HOST);
  assert.equal(Number.isInteger(serverConfig.port) && serverConfig.port > 0 && serverConfig.port <= 65535, true);
  const through067Dir = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-migrations-through-067-"));
  const through068Dir = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-migrations-through-068-"));
  const suffix = `${process.pid}_${Date.now()}`;
  const acceptedDatabase = `myroot_068_accepted_${suffix}`;
  const driftedDatabase = `myroot_068_drifted_${suffix}`;
  const dependencyDatabase = `myroot_068_dependency_${suffix}`;
  let server;
  const createdDatabases = [];

  function pool(database) {
    return mysql.createPool({
      ...serverConfig,
      database,
      connectionLimit: 2,
      waitForConnections: true,
    });
  }

  async function seedCampaign(database, timestamp) {
    const connection = await mysql.createConnection({ ...serverConfig, database });
    try {
      await connection.execute(
        `INSERT INTO root_store_snapshot
          (store_key, schema_version, revision, payload_json, updated_at)
         VALUES ('root-checkin', 28, 0, JSON_OBJECT(
           'campaignDefinitions', JSON_ARRAY(JSON_OBJECT('confirmedPrelaunch', TRUE))
         ), ?)`,
        [timestamp]
      );
      await connection.execute(
        `INSERT INTO campaign_definition
          (campaign_id, title, status, start_at, end_at, config_json, created_at, updated_at)
         VALUES ('campaign-local-guard', 'Local guard fixture', 'DRAFT', NULL, NULL, NULL, ?, ?)`,
        [timestamp, timestamp]
      );
    } finally {
      await connection.end();
    }
  }

  try {
    server = await mysql.createConnection(serverConfig);
    await assertDisposableSnapshotServer(server);
    // This suite exercises the historical 068 boundary; the schema-snapshot
    // check separately applies every current migration, including 069 onward.
    for (const fileName of listMigrationFiles(migrationsDir).filter((name) => name < "069_")) {
      fs.copyFileSync(path.join(migrationsDir, fileName), path.join(through068Dir, fileName));
      if (fileName < "068_") fs.copyFileSync(path.join(migrationsDir, fileName), path.join(through067Dir, fileName));
    }
    for (const database of [acceptedDatabase, driftedDatabase, dependencyDatabase]) {
      await server.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
      createdDatabases.push(database);
    }

    const acceptedPool = pool(acceptedDatabase);
    try {
      await applyMysqlMigrations(acceptedPool, { database: acceptedDatabase, migrationsDir: through067Dir });
      await seedCampaign(acceptedDatabase, "2026-07-11 16:15:04.000");
      const result = await applyMysqlMigrations(acceptedPool, { database: acceptedDatabase, migrationsDir: through068Dir });
      assert.equal(result.latestVersion, "068_formal_launch_confirmed_prelaunch_cleanup.sql");
      const [tables] = await acceptedPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
        [acceptedDatabase]
      );
      assert.equal(tables.length, 14);
      assert.equal(tables.some(({ table_name: tableName }) => tableName === "campaign_definition"), false);
      const [snapshots] = await acceptedPool.query(
        "SELECT JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignDefinitions') AS key_present FROM root_store_snapshot WHERE store_key = 'root-checkin'"
      );
      assert.equal(Number(snapshots[0].key_present), 0);
    } finally {
      await acceptedPool.end();
    }

    const driftedPool = pool(driftedDatabase);
    try {
      await applyMysqlMigrations(driftedPool, { database: driftedDatabase, migrationsDir: through067Dir });
      await seedCampaign(driftedDatabase, "2026-08-05 00:00:00.000");
      await assert.rejects(
        () => applyMysqlMigrations(driftedPool, { database: driftedDatabase, migrationsDir: through068Dir }),
        (error) => error.code === "ER_SIGNAL_EXCEPTION" && /timestamp drifted/.test(error.message)
      );
      const [tables] = await driftedPool.query(
        "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = ? AND table_name = 'campaign_definition'",
        [driftedDatabase]
      );
      assert.equal(Number(tables[0].table_count), 1);
      const [snapshots] = await driftedPool.query(
        "SELECT JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignDefinitions') AS key_present FROM root_store_snapshot WHERE store_key = 'root-checkin'"
      );
      assert.equal(Number(snapshots[0].key_present), 1);
    } finally {
      await driftedPool.end();
    }

    const dependencyPool = pool(dependencyDatabase);
    try {
      await applyMysqlMigrations(dependencyPool, { database: dependencyDatabase, migrationsDir: through067Dir });
      await seedCampaign(dependencyDatabase, "2026-07-11 16:15:04.000");
      await dependencyPool.query(`CREATE TABLE unexpected_campaign_reference (
        reference_id VARCHAR(64) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        PRIMARY KEY (reference_id),
        CONSTRAINT fk_unexpected_campaign
          FOREIGN KEY (campaign_id) REFERENCES campaign_definition (campaign_id)
      ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await assert.rejects(
        () => applyMysqlMigrations(dependencyPool, { database: dependencyDatabase, migrationsDir: through068Dir }),
        (error) => error.code === "ER_SIGNAL_EXCEPTION" && /unexpected inbound dependency/.test(error.message)
      );
      const [tables] = await dependencyPool.query(
        "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = ? AND table_name = 'campaign_definition'",
        [dependencyDatabase]
      );
      assert.equal(Number(tables[0].table_count), 1);
      const [snapshots] = await dependencyPool.query(
        "SELECT JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignDefinitions') AS key_present FROM root_store_snapshot WHERE store_key = 'root-checkin'"
      );
      assert.equal(Number(snapshots[0].key_present), 1);
    } finally {
      await dependencyPool.end();
    }
  } finally {
    try {
      for (const database of createdDatabases) await server.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
      try {
        if (server) await server.end();
      } finally {
        fs.rmSync(through067Dir, { recursive: true, force: true });
        fs.rmSync(through068Dir, { recursive: true, force: true });
      }
    }
  }
});
