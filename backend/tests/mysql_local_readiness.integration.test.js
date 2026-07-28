const assert = require("node:assert/strict");
const test = require("node:test");
const mysql = require("mysql2/promise");
const {
  AUTHENTICATED_READINESS_SQL,
  LOOPBACK_HOST,
  authenticatedReady,
} = require("../src/mysqlLocalAuthorizedRunner");

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
