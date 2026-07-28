const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../db/migrations/066_v1_runtime_alert_delivery_severity_slo_authority.sql"
), "utf8");

function procedureBlocks(sql) {
  return sql.split(/\nDROP PROCEDURE IF EXISTS /).slice(1)
    .map((block) => `DROP PROCEDURE IF EXISTS ${block}`);
}

function name(block) {
  return block.match(/CREATE PROCEDURE\s+([a-z0-9_]+)\s*\(/i)?.[1] || null;
}

const procedures = procedureBlocks(migration);

test("066 replaces exactly the two registration procedures without transaction control", () => {
  assert.deepEqual(procedures.map(name), [
    "v1_runtime_alert_delivery_register_dry_run",
    "v1_runtime_alert_delivery_register_controlled",
  ]);
  for (const procedure of procedures) {
    assert.match(procedure, /SQL SECURITY DEFINER/i);
    assert.match(procedure, /MODIFIES SQL DATA/i);
    assert.doesNotMatch(
      procedure,
      /\b(?:START\s+TRANSACTION|COMMIT|ROLLBACK|SET\s+AUTOCOMMIT)\b/i
    );
    assert.doesNotMatch(procedure, /\b(?:PREPARE|EXECUTE\s+IMMEDIATE)\b/i);
  }
});

test("066 binds the persisted alert severity to the exact delivery SLO profile", () => {
  for (const procedure of procedures) {
    assert.match(procedure, /INNER JOIN v1_runtime_alert AS runtime_alert/i);
    assert.match(
      procedure,
      /runtime_alert\.severity = 'BLOCKER'\s+AND p_slo_class = 'BLOCKER_IMMEDIATE'\s+AND p_slo_target_seconds = 300/i
    );
    assert.match(
      procedure,
      /runtime_alert\.severity = 'WARNING'\s+AND p_slo_class = 'WARNING_STANDARD'\s+AND p_slo_target_seconds = 1800/i
    );
    assert.match(
      procedure,
      /MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED'/i
    );
  }
});

test("066 preserves idempotent locking and returns the persisted registration row", () => {
  for (const procedure of procedures) {
    assert.match(procedure, /WHERE runtime_alert_id = p_runtime_alert_id\s+LIMIT 1\s+FOR UPDATE/i);
    assert.match(procedure, /IF v_existing_delivery_id IS NULL THEN\s+INSERT INTO v1_runtime_alert_delivery/i);
    assert.match(procedure, /SELECT v_outcome AS operation_outcome,[\s\S]*FROM v1_runtime_alert_delivery/i);
  }
});
